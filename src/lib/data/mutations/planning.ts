'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { APP_NAME } from '@/lib/brand'
import { dateParis } from '@/lib/utils'
import { AIModuleDisabledError, callAI } from '@/lib/ai/callAI'

// ─── Types ────────────────────────────────────────────────────────────────────

export type PlanningSlotInput = {
  chantierId: string
  plannedDate: string       // YYYY-MM-DD
  startTime?: string | null // HH:MM
  endTime?: string | null   // HH:MM
  label: string
  teamSize?: number
  notes?: string | null
  equipeId?: string | null
  memberId?: string | null  // Membre individuel - exclusif avec equipeId
}

export type AIPlanningSlot = PlanningSlotInput & {
  chantierTitle: string     // pour l'affichage dans la preview
}

export type AIPlanningDeletion = {
  id: string
  chantierId: string
  chantierTitle: string
  plannedDate: string
  startTime?: string | null
  endTime?: string | null
  label: string
}

export type AIUnknownPerson = {
  name: string              // nom tel que mentionné dans la demande
}

export type AITour = {
  date: string              // YYYY-MM-DD
  slotIndices: number[]     // indices dans `slots` qui composent cette tournée, dans l'ordre
}

export type AIPlanningResult = {
  slots: AIPlanningSlot[]
  deletions: AIPlanningDeletion[]
  summary: string           // résumé en langage naturel de ce qui va être créé
  unknownPeople: AIUnknownPerson[]   // noms non résolus → à créer comme nouveaux membres
  tours: AITour[]           // tournées détectées (multi-stop même journée)
  error?: string
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function createPlanningSlot(data: PlanningSlotInput): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  if (!await hasPermission('chantiers.planning')) {
    return { error: 'Action non autorisée.' }
  }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id')
    .eq('id', data.chantierId)
    .eq('organization_id', orgId)
    .maybeSingle()
  if (!chantier) return { error: 'Chantier introuvable ou non autorisé.' }
  if (data.equipeId) {
    const { data: equipe } = await supabase
      .from('chantier_equipes')
      .select('id')
      .eq('id', data.equipeId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!equipe) return { error: 'Équipe introuvable ou non autorisée.' }
  }
  if (data.memberId) {
    const { data: member } = await supabase
      .from('chantier_equipe_membres')
      .select('id')
      .eq('id', data.memberId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!member) return { error: 'Membre introuvable ou non autorisé.' }
  }

  const { error } = await supabase.from('chantier_plannings').insert({
    chantier_id: data.chantierId,
    planned_date: data.plannedDate,
    start_time: data.startTime ?? null,
    end_time: data.endTime ?? null,
    label: data.label,
    team_size: data.teamSize ?? 1,
    notes: data.notes ?? null,
    equipe_id: data.equipeId ?? null,
    member_id: data.memberId ?? null,
    created_by: user.id,
  })

  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
  revalidatePath(`/chantiers/${data.chantierId}`)
  return { error: null }
}

export async function createPlanningSlots(slots: PlanningSlotInput[]): Promise<{ error: string | null; created: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', created: 0 }

  if (!await hasPermission('chantiers.planning')) {
    return { error: 'Action non autorisée.', created: 0 }
  }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.', created: 0 }
  const chantierIds = [...new Set(slots.map(s => s.chantierId))]
  if (chantierIds.length > 0) {
    const { data: chantiers } = await supabase
      .from('chantiers')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', chantierIds)
    if ((chantiers?.length ?? 0) !== chantierIds.length) {
      return { error: 'Chantier introuvable ou non autorisé.', created: 0 }
    }
  }
  const equipeIds = [...new Set(slots.map(s => s.equipeId).filter((id): id is string => !!id))]
  if (equipeIds.length > 0) {
    const { data: equipes } = await supabase
      .from('chantier_equipes')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', equipeIds)
    if ((equipes?.length ?? 0) !== equipeIds.length) {
      return { error: 'Équipe introuvable ou non autorisée.', created: 0 }
    }
  }
  const memberIds = [...new Set(slots.map(s => s.memberId).filter((id): id is string => !!id))]
  if (memberIds.length > 0) {
    const { data: members } = await supabase
      .from('chantier_equipe_membres')
      .select('id')
      .eq('organization_id', orgId)
      .in('id', memberIds)
    if ((members?.length ?? 0) !== memberIds.length) {
      return { error: 'Membre introuvable ou non autorisé.', created: 0 }
    }
  }

  const rows = slots.map(s => ({
    chantier_id: s.chantierId,
    planned_date: s.plannedDate,
    start_time: s.startTime ?? null,
    end_time: s.endTime ?? null,
    label: s.label,
    team_size: s.teamSize ?? 1,
    notes: s.notes ?? null,
    equipe_id: s.equipeId ?? null,
    member_id: s.memberId ?? null,
    created_by: user.id,
  }))

  const { error } = await supabase.from('chantier_plannings').insert(rows)
  if (error) return { error: error.message, created: 0 }

  revalidatePath('/chantiers/planning')
  for (const chantierId of new Set(slots.map(s => s.chantierId))) {
    revalidatePath(`/chantiers/${chantierId}`)
  }
  return { error: null, created: slots.length }
}

// Crée une tournée IA : insère les slots dans l'ordre et les lie par un route_id commun
export async function createAITournee(
  slots: PlanningSlotInput[],
  plannedDate: string,
  departureAddress: string | null,
  departurePostalCode: string | null,
  departureCity: string | null,
): Promise<{ newRouteId: string | null; error: string | null }> {
  if (!await hasPermission('chantiers.planning')) return { newRouteId: null, error: 'Action non autorisée.' }
  if (slots.length < 2) return { newRouteId: null, error: 'Une tournée nécessite au moins 2 arrêts.' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { newRouteId: null, error: 'Non authentifié.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { newRouteId: null, error: 'Organisation introuvable.' }

  const newRouteId = crypto.randomUUID()

  // Enregistrer les métadonnées de la tournée
  const { error: routeError } = await supabase
    .from('tournee_routes')
    .insert({
      id: newRouteId,
      organization_id: orgId,
      planned_date: plannedDate,
      departure_address: departureAddress,
      departure_postal_code: departurePostalCode,
      departure_city: departureCity,
    })
  if (routeError) return { newRouteId: null, error: routeError.message }

  const rows = slots.map((s, i) => ({
    chantier_id: s.chantierId,
    planned_date: s.plannedDate,
    start_time: s.startTime ?? null,
    end_time: s.endTime ?? null,
    label: s.label,
    team_size: s.teamSize ?? 1,
    notes: s.notes ?? null,
    equipe_id: s.equipeId ?? null,
    member_id: s.memberId ?? null,
    route_id: newRouteId,
    route_order: i + 1,
    created_by: user.id,
  }))

  const { error: insertError } = await supabase.from('chantier_plannings').insert(rows)
  if (insertError) return { newRouteId: null, error: insertError.message }

  revalidatePath('/chantiers/planning')
  return { newRouteId, error: null }
}

export async function deletePlanningSlot(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  if (!await hasPermission('chantiers.planning')) {
    return { error: 'Action non autorisée.' }
  }

  // Vérifier que le créneau appartient bien à l'org avant de supprimer
  const { data: planning } = await supabase
    .from('chantier_plannings')
    .select('chantier_id, chantiers!inner(organization_id)')
    .eq('id', id)
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!planning || (planning as any).chantiers?.organization_id !== orgId) {
    return { error: 'Créneau introuvable ou non autorisé.' }
  }

  const { error } = await supabase
    .from('chantier_plannings')
    .delete()
    .eq('id', id)

  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
  revalidatePath(`/chantiers/${planning.chantier_id}`)
  return { error: null }
}

// ─── Tournée ──────────────────────────────────────────────────────────────────

export type TourneeSlotInput = {
  chantierId: string
  plannedDate: string
  startTime?: string | null
  endTime?: string | null
  label: string
  teamSize?: number
  notes?: string | null
  equipeId?: string | null
  memberId?: string | null
  routeId: string
  routeOrder: number
  durationMin?: number | null
  travelFromPrevMin?: number | null
}

export async function upsertTourneeSlot(
  data: TourneeSlotInput,
  existingId?: string,
): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { id: null, error: 'Non authentifié.' }

  if (!await hasPermission('chantiers.planning')) {
    return { id: null, error: 'Action non autorisée.' }
  }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { id: null, error: 'Organisation introuvable.' }

  // Vérifier que le chantier appartient bien à l'org
  const { data: chantier } = await supabase
    .from('chantiers')
    .select('id')
    .eq('id', data.chantierId)
    .eq('organization_id', orgId)
    .single()

  if (!chantier) return { id: null, error: 'Chantier introuvable ou non autorisé.' }
  if (data.equipeId) {
    const { data: equipe } = await supabase
      .from('chantier_equipes')
      .select('id')
      .eq('id', data.equipeId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!equipe) return { id: null, error: 'Équipe introuvable ou non autorisée.' }
  }
  if (data.memberId) {
    const { data: member } = await supabase
      .from('chantier_equipe_membres')
      .select('id')
      .eq('id', data.memberId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!member) return { id: null, error: 'Membre introuvable ou non autorisé.' }
  }

  const row = {
    chantier_id: data.chantierId,
    planned_date: data.plannedDate,
    start_time: data.startTime ?? null,
    end_time: data.endTime ?? null,
    label: data.label,
    team_size: data.teamSize ?? 1,
    notes: data.notes ?? null,
    equipe_id: data.equipeId ?? null,
    member_id: data.memberId ?? null,
    route_id: data.routeId,
    route_order: data.routeOrder,
    duration_min: data.durationMin ?? null,
    travel_from_prev_min: data.travelFromPrevMin ?? null,
    created_by: user.id,
  }

  if (existingId) {
    const { data: existing } = await supabase
      .from('chantier_plannings')
      .select('id, chantiers!inner(organization_id)')
      .eq('id', existingId)
      .single()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (!existing || (existing as any).chantiers?.organization_id !== orgId) {
      return { id: null, error: 'Créneau introuvable ou non autorisé.' }
    }

    const { error } = await supabase
      .from('chantier_plannings')
      .update(row)
      .eq('id', existingId)
    if (error) return { id: null, error: error.message }
    revalidatePath('/chantiers/planning')
    return { id: existingId, error: null }
  }

  const { data: inserted, error } = await supabase
    .from('chantier_plannings')
    .insert(row)
    .select('id')
    .single()

  if (error) return { id: null, error: error.message }
  revalidatePath('/chantiers/planning')
  return { id: inserted?.id ?? null, error: null }
}

export async function reorderTournee(
  routeId: string,
  orderedSlotIds: string[],
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  if (!await hasPermission('chantiers.planning')) {
    return { error: 'Action non autorisée.' }
  }

  // Vérifier org ownership via le premier slot
  if (orderedSlotIds.length === 0) return { error: null }
  const { data: check } = await supabase
    .from('chantier_plannings')
    .select('chantier_id, chantiers!inner(organization_id)')
    .eq('id', orderedSlotIds[0])
    .single()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!check || (check as any).chantiers?.organization_id !== orgId) {
    return { error: 'Créneau introuvable ou non autorisé.' }
  }

  for (let i = 0; i < orderedSlotIds.length; i++) {
    const { error } = await supabase
      .from('chantier_plannings')
      .update({ route_order: i + 1 })
      .eq('id', orderedSlotIds[i])
      .eq('route_id', routeId)
    if (error) return { error: error.message }
  }

  revalidatePath('/chantiers/planning')
  return { error: null }
}

export async function updateTourneeSlotTravelTimes(
  updates: Array<{ id: string; travel_from_prev_min: number | null }>,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  if (!await hasPermission('chantiers.planning')) {
    return { error: 'Action non autorisée.' }
  }

  const ids = updates.map(u => u.id)
  if (ids.length > 0) {
    const { data: slots } = await supabase
      .from('chantier_plannings')
      .select('id, chantiers!inner(organization_id)')
      .in('id', ids)

    const allowedIds = new Set(
      ((slots ?? []) as any[])
        .filter(s => s.chantiers?.organization_id === orgId)
        .map(s => s.id),
    )
    if (allowedIds.size !== ids.length) {
      return { error: 'Créneau introuvable ou non autorisé.' }
    }
  }

  for (const u of updates) {
    const { error } = await supabase
      .from('chantier_plannings')
      .update({ travel_from_prev_min: u.travel_from_prev_min })
      .eq('id', u.id)
    if (error) return { error: error.message }
  }

  revalidatePath('/chantiers/planning')
  return { error: null }
}

export async function duplicateTournee(
  routeId: string,
  targetDate: string,
): Promise<{ newRouteId: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { newRouteId: null, error: 'Non authentifié.' }

  if (!await hasPermission('chantiers.planning')) {
    return { newRouteId: null, error: 'Action non autorisée.' }
  }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { newRouteId: null, error: 'Organisation introuvable.' }

  const { data: slots, error: fetchError } = await supabase
    .from('chantier_plannings')
    .select('chantier_id, start_time, end_time, label, team_size, notes, equipe_id, member_id, route_order, duration_min, travel_from_prev_min, chantiers!inner(organization_id)')
    .eq('route_id', routeId)
    .order('route_order', { ascending: true })

  if (fetchError) return { newRouteId: null, error: fetchError.message }
  if (!slots?.length) return { newRouteId: null, error: 'Tournée introuvable.' }

  // Vérifier org ownership
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if ((slots[0] as any).chantiers?.organization_id !== orgId) {
    return { newRouteId: null, error: 'Non autorisé.' }
  }

  const newRouteId = crypto.randomUUID()
  const rows = slots.map((s: any) => ({
    chantier_id: s.chantier_id,
    planned_date: targetDate,
    start_time: s.start_time,
    end_time: s.end_time,
    label: s.label,
    team_size: s.team_size,
    notes: s.notes,
    equipe_id: s.equipe_id,
    member_id: s.member_id,
    route_id: newRouteId,
    route_order: s.route_order,
    duration_min: s.duration_min,
    travel_from_prev_min: s.travel_from_prev_min,
    created_by: user.id,
  }))

  const { error: insertError } = await supabase.from('chantier_plannings').insert(rows)
  if (insertError) return { newRouteId: null, error: insertError.message }

  revalidatePath('/chantiers/planning')
  return { newRouteId, error: null }
}

// ─── Tournée routes — métadonnées par route_id ───────────────────────────────

export async function upsertTourneeRoute(
  routeId: string,
  data: {
    plannedDate: string
    departureAddress: string | null
    departurePostalCode: string | null
    departureCity: string | null
  },
): Promise<{ error: string | null }> {
  if (!await hasPermission('chantiers.planning')) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('tournee_routes')
    .upsert({
      id: routeId,
      organization_id: orgId,
      planned_date: data.plannedDate,
      departure_address: data.departureAddress,
      departure_postal_code: data.departurePostalCode,
      departure_city: data.departureCity,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
  return { error: null }
}

export async function getTourneeRoute(routeId: string): Promise<{
  departure_address: string | null
  departure_postal_code: string | null
  departure_city: string | null
} | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data } = await supabase
    .from('tournee_routes')
    .select('departure_address, departure_postal_code, departure_city')
    .eq('id', routeId)
    .eq('organization_id', orgId)
    .maybeSingle()

  return data ?? null
}

export async function getAllTourneeRoutes(): Promise<Record<string, { address: string | null; postal_code: string | null; city: string | null }>> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return {}

  const { data } = await supabase
    .from('tournee_routes')
    .select('id, departure_address, departure_postal_code, departure_city')
    .eq('organization_id', orgId)

  if (!data) return {}
  return Object.fromEntries(data.map(r => [r.id, { address: r.departure_address, postal_code: r.departure_postal_code, city: r.departure_city }]))
}

// ─── Agent IA - Parsing langage naturel ──────────────────────────────────────

export async function planWeekWithAI(prompt: string, weekMondayDate: string): Promise<AIPlanningResult> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { slots: [], deletions: [], unknownPeople: [], tours: [], summary: '', error: 'Organisation introuvable.' }

  if (!await hasPermission('chantiers.planning')) {
    return { slots: [], deletions: [], unknownPeople: [], tours: [], summary: '', error: 'Action non autorisée.' }
  }

  // Récupérer les chantiers actifs pour que Claude puisse les matcher
  const { data: chantiers } = await supabase
    .from('chantiers')
    .select('id, title, city, address_line1, postal_code, status')
    .eq('organization_id', orgId)
    .in('status', ['en_cours', 'planifie', 'suspendu'])
    .order('created_at', { ascending: false })
    .limit(20)

  if (!chantiers?.length) {
    return { slots: [], deletions: [], summary: '', unknownPeople: [], tours: [], error: 'Aucun chantier actif trouvé. Créez d\'abord un chantier.' }
  }

  // Récupérer les équipes avec leurs membres, et les membres individuels (sans équipe)
  const [equipesRaw, membresRaw] = await Promise.all([
    supabase
      .from('chantier_equipes')
      .select('id, name, membres:chantier_equipe_membres(id, prenom, name, role_label, taux_horaire)')
      .eq('organization_id', orgId)
      .order('name', { ascending: true })
      .limit(50),
    supabase
      .from('chantier_equipe_membres')
      .select('id, prenom, name, role_label, taux_horaire')
      .eq('organization_id', orgId)
      .is('equipe_id', null)
      .order('name', { ascending: true })
      .limit(80),
  ])

  type EquipeWithMembres = { id: string; name: string; membres: Array<{ id: string; prenom: string | null; name: string; role_label: string | null; taux_horaire: number | null }> }
  const equipes: EquipeWithMembres[] = (equipesRaw.data ?? []) as EquipeWithMembres[]
  const membres = membresRaw.data ?? []

  const equipesContext = equipes.map(e => {
    const membresStr = e.membres.map(m => {
      const full = [m.prenom, m.name].filter(Boolean).join(' ')
      const role = m.role_label ? `, ${m.role_label}` : ''
      const taux = m.taux_horaire != null ? `, ${m.taux_horaire}€/h` : ''
      return `    - MEMBER_ID: ${m.id} | "${full}"${role}${taux}`
    }).join('\n')
    return `- EQUIPE_ID: ${e.id} | "${e.name}"${membresStr ? `\n${membresStr}` : ' (aucun membre)'}`
  }).join('\n') || '(aucune équipe)'

  const membresContext = membres.map(m => {
    const full = [m.prenom, m.name].filter(Boolean).join(' ')
    const role = m.role_label ? `, ${m.role_label}` : ''
    const taux = m.taux_horaire != null ? `, ${m.taux_horaire}€/h` : ''
    return `- MEMBER_ID: ${m.id} | "${full}"${role}${taux}`
  }).join('\n') || '(aucun membre individuel sans équipe)'

  // Tous les IDs membres valides (équipes + individuels)
  const allMembresIds = [
    ...equipes.flatMap(e => e.membres.map(m => m.id)),
    ...membres.map(m => m.id),
  ]

  // Calculer les dates de la semaine
  const monday = new Date(weekMondayDate)
  const weekDays: Record<string, string> = {}
  const dayNames = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche']
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    weekDays[dayNames[i]] = dateParis(d.getTime())
  }

  const chantiersContext = chantiers.map(c => {
    const adresse = [c.address_line1, c.postal_code, c.city].filter(Boolean).join(', ')
    return `- ID: ${c.id} | "${c.title}"${adresse ? ` | ${adresse}` : ''}`
  }).join('\n')
  const weekEndDate = weekDays['dimanche']

  const { data: existingPlannings } = await supabase
    .from('chantier_plannings')
    .select(`
      id, chantier_id, planned_date, start_time, end_time, label,
      chantier:chantiers!inner(title, organization_id)
    `)
    .eq('chantier.organization_id', orgId)
    .gte('planned_date', weekMondayDate)
    .lte('planned_date', weekEndDate)
    .order('planned_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })

  const existingContext = (existingPlannings ?? []).map((p: any) => (
    `- SLOT_ID: ${p.id} | CHANTIER_ID: ${p.chantier_id} | "${p.chantier?.title ?? 'Chantier'}" | ${p.planned_date} ${p.start_time ?? 'sans heure'}${p.end_time ? `-${p.end_time}` : ''} | ${p.label}`
  )).join('\n') || '(aucun créneau existant cette semaine)'

  const systemPrompt = `Tu t'appelles Sarah. Tu es chiffreuse et assistante de planification chez ATELIER by Orsayn. Tu dois parser une description de planning en langage naturel et retourner un JSON structure. Tu connais les chantiers, les equipes et les membres de l'organisation. Tu es efficace et tu places les bonnes personnes aux bons endroits.

Chantiers disponibles (avec adresses si connues) :
${chantiersContext}

Équipes disponibles (avec leurs membres) :
${equipesContext}

Membres individuels disponibles (sans équipe parente) :
${membresContext}

Créneaux existants cette semaine, supprimables uniquement si l'utilisateur le demande explicitement :
${existingContext}

Dates de la semaine du ${weekMondayDate} :
- lundi: ${weekDays['lundi']}
- mardi: ${weekDays['mardi']}
- mercredi: ${weekDays['mercredi']}
- jeudi: ${weekDays['jeudi']}
- vendredi: ${weekDays['vendredi']}
- samedi: ${weekDays['samedi']}
- dimanche: ${weekDays['dimanche']}

Règles d'assignation :
- Matcher chaque mention de chantier avec l'ID le plus proche dans la liste (correspondance approximative par nom)
- Si une mention nomme une **équipe** existante, remplir equipeId avec son EQUIPE_ID, memberId = null
- Si une mention nomme une **personne individuelle** (prénom/nom) qui figure dans les membres ou membres d'équipe listés, remplir memberId avec son MEMBER_ID, equipeId = null
- equipeId et memberId sont **mutuellement exclusifs** (jamais les deux dans le même slot)
- Si la personne ou l'équipe mentionnée n'existe pas dans les listes, laisser equipeId et memberId à null, mettre le nom dans label, et ajouter le nom dans unknownPeople
- start_time et end_time au format "HH:MM", null si non précisé
- team_size = nombre de personnes (1 si non précisé ou si memberId rempli)
- label = nom de l'équipe ou des personnes mentionnées, sinon "Équipe"
- Si un créneau couvre "toute la journée", start_time = "08:00", end_time = "17:00"
- Si "matin" : start_time = "08:00", end_time = "12:00"
- Si "après-midi" : start_time = "13:00", end_time = "17:00"

Règles pour les tournées :
- Si l'utilisateur demande une tournée (plusieurs chantiers dans une même journée, à enchaîner), créer un slot par chantier sur la même date
- Grouper ces slots dans "tours" en listant leurs indices (0-based) dans l'ordre de visite
- Une tournée = plusieurs chantiers différents le même jour enchaînés par une même équipe/personne
- Si les créneaux sont indépendants (jours différents ou équipes différentes), ne pas créer de tour

Règles pour les suppressions :
- Si l'utilisateur demande de supprimer/retirer/annuler un créneau existant, remplir deletions avec le SLOT_ID correspondant
- Ne mets jamais un créneau en deletions par déduction vague : il faut une correspondance claire avec les créneaux existants

Retourne UNIQUEMENT ce JSON (sans markdown) :
{
  "slots": [
    {
      "chantierId": "uuid",
      "chantierTitle": "titre pour affichage",
      "plannedDate": "YYYY-MM-DD",
      "startTime": "HH:MM" | null,
      "endTime": "HH:MM" | null,
      "label": "Équipe Martin",
      "teamSize": 2,
      "notes": null,
      "equipeId": "uuid" | null,
      "memberId": "uuid" | null
    }
  ],
  "deletions": [
    {
      "id": "slot_id",
      "chantierId": "uuid",
      "chantierTitle": "titre pour affichage",
      "plannedDate": "YYYY-MM-DD",
      "startTime": "HH:MM" | null,
      "endTime": "HH:MM" | null,
      "label": "libellé existant"
    }
  ],
  "unknownPeople": [
    { "name": "nom tel que mentionné" }
  ],
  "tours": [
    { "date": "YYYY-MM-DD", "slotIndices": [0, 1, 2] }
  ],
  "summary": "Résumé en 1-2 phrases de ce qui va être planifié"
}`

  try {
    const { data } = await callAI<any>({
      organizationId: orgId,
      provider: 'openrouter',
      feature: 'planning_ai',
      model: 'anthropic/claude-haiku-4-5',
      inputKind: 'text',
      request: {
        body: {
          max_tokens: 1500,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
        },
      },
      metadata: {
        mutation: 'planWeekWithAI',
        week_monday_date: weekMondayDate,
        app_name: APP_NAME,
      },
    })

    const text: string = data.choices?.[0]?.message?.content?.trim() ?? ''
    // Nettoyer le JSON si l'IA a ajouté des backticks malgré la consigne
    const cleaned = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '').trim()
    const parsed = JSON.parse(cleaned) as {
      slots?: AIPlanningSlot[]
      deletions?: AIPlanningDeletion[]
      unknownPeople?: AIUnknownPerson[]
      tours?: AITour[]
      summary: string
    }

    // Valider que les chantierId existent bien
    const validChantierIds = new Set(chantiers.map(c => c.id))
    const validEquipeIds = new Set(equipes.map(e => e.id))
    const validMemberIds = new Set(allMembresIds)
    const existingById = new Map((existingPlannings ?? []).map((p: any) => [p.id, p]))

    const validSlots = (parsed.slots ?? [])
      .filter(s => validChantierIds.has(s.chantierId))
      .map(s => ({
        ...s,
        equipeId: s.equipeId && validEquipeIds.has(s.equipeId) ? s.equipeId : null,
        memberId: s.memberId && validMemberIds.has(s.memberId) ? s.memberId : null,
      }))
      // Garantir l'exclusivité (member prioritaire si la personne est nommément citée)
      .map(s => s.memberId ? { ...s, equipeId: null } : s)

    const validDeletions = (parsed.deletions ?? [])
      .filter(d => existingById.has(d.id))
      .map(d => {
        const existing: any = existingById.get(d.id)
        return {
          id: existing.id,
          chantierId: existing.chantier_id,
          chantierTitle: existing.chantier?.title ?? d.chantierTitle ?? 'Chantier',
          plannedDate: existing.planned_date,
          startTime: existing.start_time,
          endTime: existing.end_time,
          label: existing.label,
        }
      })

    // Déduplication des inconnus (noms distincts, insensible à la casse)
    const seenNames = new Set<string>()
    const unknownPeople = (parsed.unknownPeople ?? []).filter(p => {
      const key = p.name.trim().toLowerCase()
      if (!key || seenNames.has(key)) return false
      seenNames.add(key)
      return true
    })

    // Valider les tours : les indices doivent pointer dans validSlots
    const tours = (parsed.tours ?? []).filter(t =>
      t.slotIndices.length > 1 &&
      t.slotIndices.every(i => i >= 0 && i < validSlots.length)
    )

    return { slots: validSlots, deletions: validDeletions, unknownPeople, tours, summary: parsed.summary ?? '' }
  } catch (error) {
    if (error instanceof AIModuleDisabledError) {
      return { slots: [], deletions: [], unknownPeople: [], tours: [], summary: '', error: 'Module IA planning désactivé.' }
    }

    console.error('[planWeekWithAI]', error)
    return { slots: [], deletions: [], unknownPeople: [], tours: [], summary: '', error: 'Réponse IA invalide. Reformulez votre demande.' }
  }
}
