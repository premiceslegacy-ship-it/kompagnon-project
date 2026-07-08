'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { APP_NAME } from '@/lib/brand'
import { dateParis } from '@/lib/utils'
import { getPlanningRecipientUserIds, sendPushToMembers, sendPushToOrgPermission, sendPushToPlanningRecipients, sendPushToUsers } from '@/lib/push'
import { AIModuleDisabledError, AIProviderCreditError, callAI } from '@/lib/ai/callAI'

type PlanningSource = 'chantier' | 'maintenance'

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
  source?: PlanningSource
  maintenanceContractId?: string | null
}

export type AIPlanningDeletion = {
  id: string
  chantierId: string
  chantierTitle: string
  plannedDate: string
  startTime?: string | null
  endTime?: string | null
  label: string
  source?: PlanningSource
  maintenanceContractId?: string | null
  maintenanceInterventionId?: string | null
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

const GENERIC_UNASSIGNED_PLANNING_LABELS = new Set([
  'equipe',
  'équipe',
  'team',
  'intervenant',
  'intervenants',
])

function normalizePlanningLabel(label: string | null | undefined): string {
  return (label ?? '')
    .trim()
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
}

function validatePlanningAssigneeLabel(data: {
  label?: string | null
  memberId?: string | null
  equipeId?: string | null
}): string | null {
  const label = data.label?.trim()
  if (!label) return 'Libellé du créneau requis.'
  if (!data.memberId && !data.equipeId && GENERIC_UNASSIGNED_PLANNING_LABELS.has(normalizePlanningLabel(label))) {
    return 'Choisissez un membre, une équipe existante, ou saisissez un libellé précis pour ce créneau.'
  }
  return null
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

  const validationError = validatePlanningAssigneeLabel(data)
  if (validationError) return { error: validationError }

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
  const recipients = await getPlanningRecipientUserIds(orgId, { memberId: data.memberId, equipeId: data.equipeId })
  sendPushToPlanningRecipients(recipients, {
    title: 'Nouveau créneau planifié',
    body: `${data.label} — ${data.plannedDate}${data.startTime ? ` à ${data.startTime}` : ''}`,
    url: '/mon-espace/dashboard',
  }, user.id).catch(() => {})
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

  const invalidSlot = slots.find(slot => validatePlanningAssigneeLabel(slot))
  if (invalidSlot) return { error: validatePlanningAssigneeLabel(invalidSlot), created: 0 }

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

  // recipientKey préfixé pour distinguer un compte auth (user:) d'un membre sans
  // compte (member:) tout en gardant un seul Map pour l'agrégation par destinataire.
  const slotByRecipient = new Map<string, PlanningSlotInput[]>()
  for (const slot of slots) {
    const recipients = await getPlanningRecipientUserIds(orgId, { memberId: slot.memberId, equipeId: slot.equipeId })
    for (const userId of recipients.userIds) {
      const key = `user:${userId}`
      const list = slotByRecipient.get(key) ?? []
      list.push(slot)
      slotByRecipient.set(key, list)
    }
    for (const memberId of recipients.memberIds) {
      const key = `member:${memberId}`
      const list = slotByRecipient.get(key) ?? []
      list.push(slot)
      slotByRecipient.set(key, list)
    }
  }
  await Promise.allSettled([...slotByRecipient.entries()].map(([recipientKey, userSlots]) => {
    const [kind, id] = recipientKey.split(':')
    const payload = {
      title: 'Nouveaux créneaux planifiés',
      body: `${userSlots.length} créneau${userSlots.length > 1 ? 'x' : ''} ajouté${userSlots.length > 1 ? 's' : ''}`,
      url: '/mon-espace/dashboard',
    }
    return kind === 'user' ? sendPushToUsers([id], payload, user.id) : sendPushToMembers([id], payload)
  }))

  revalidatePath('/chantiers/planning')
  for (const chantierId of new Set(slots.map(s => s.chantierId))) {
    revalidatePath(`/chantiers/${chantierId}`)
  }
  return { error: null, created: slots.length }
}

export type MaintenancePlanningSlotInput = {
  maintenanceContractId: string
  plannedDate: string
  startTime?: string | null
  endTime?: string | null
  label?: string | null
  notes?: string | null
  memberId?: string | null
}

function diffDays(from: string, to: string): number {
  const fromTime = new Date(`${from}T12:00:00`).getTime()
  const toTime = new Date(`${to}T12:00:00`).getTime()
  return Math.round((toTime - fromTime) / 86400000)
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + days)
  return dateParis(d.getTime())
}

function durationHours(startTime?: string | null, endTime?: string | null, fallback?: number | null): number | null {
  if (fallback != null && Number.isFinite(Number(fallback))) return Number(fallback)
  if (!startTime || !endTime) return null
  const [sh, sm] = startTime.split(':').map(Number)
  const [eh, em] = endTime.split(':').map(Number)
  const hours = (eh + em / 60) - (sh + sm / 60)
  return hours > 0 ? Math.round(hours * 100) / 100 : null
}

export async function createMaintenancePlanningSlots(slots: MaintenancePlanningSlotInput[]): Promise<{ error: string | null; created: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', created: 0 }

  if (!await hasPermission('chantiers.planning')) {
    return { error: 'Action non autorisée.', created: 0 }
  }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.', created: 0 }

  const contractIds = [...new Set(slots.map(s => s.maintenanceContractId).filter(Boolean))]
  if (contractIds.length === 0) return { error: null, created: 0 }

  const { data: contracts } = await supabase
    .from('maintenance_contracts')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', contractIds)
    .neq('status', 'résilié')

  if ((contracts?.length ?? 0) !== contractIds.length) {
    return { error: 'Contrat entretien introuvable ou non autorisé.', created: 0 }
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
    maintenance_contract_id: s.maintenanceContractId,
    organization_id: orgId,
    created_by: user.id,
    date_intervention: s.plannedDate,
    statut: 'planifiée',
    start_time: s.startTime ?? null,
    end_time: s.endTime ?? null,
    duration_hours: durationHours(s.startTime, s.endTime),
    intervenant_id: s.memberId ?? null,
    intervenant_member_id: s.memberId ?? null,
    rapport: null,
    observations: s.notes ?? s.label ?? null,
  }))

  const { error } = await supabase.from('maintenance_interventions').insert(rows)
  if (error) return { error: error.message, created: 0 }

  for (const slot of slots) {
    await supabase
      .from('maintenance_contracts')
      .update({ prochaine_intervention: slot.plannedDate })
      .eq('id', slot.maintenanceContractId)
      .eq('organization_id', orgId)
      .or(`prochaine_intervention.is.null,prochaine_intervention.gte.${slot.plannedDate}`)
  }

  revalidatePath('/chantiers/planning')
  revalidatePath('/chantiers/entretien')
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

  const invalidSlot = slots.find(slot => validatePlanningAssigneeLabel(slot))
  if (invalidSlot) return { newRouteId: null, error: validatePlanningAssigneeLabel(invalidSlot) }

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

export type PlanningSlotUpdateInput = {
  plannedDate?: string
  startTime?: string | null
  endTime?: string | null
  label?: string
  teamSize?: number
  notes?: string | null
  memberId?: string | null
  equipeId?: string | null
}

export async function updatePlanningSlot(id: string, data: PlanningSlotUpdateInput): Promise<{ error: string | null }> {
  const supabase = await createClient()
  if (!await hasPermission('chantiers.planning')) return { error: 'Action non autorisée.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: existing } = await supabase
    .from('chantier_plannings')
    .select('id, chantier_id, label, member_id, equipe_id, chantiers!inner(organization_id)')
    .eq('id', id)
    .single()

  if (!existing || (existing as any).chantiers?.organization_id !== orgId) {
    return { error: 'Créneau introuvable ou non autorisé.' }
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

  if (data.equipeId) {
    const { data: equipe } = await supabase
      .from('chantier_equipes')
      .select('id')
      .eq('id', data.equipeId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!equipe) return { error: 'Équipe introuvable ou non autorisée.' }
  }

  const patch: Record<string, unknown> = {}
  if (data.plannedDate !== undefined) patch.planned_date = data.plannedDate
  if (data.startTime !== undefined) patch.start_time = data.startTime
  if (data.endTime !== undefined) patch.end_time = data.endTime
  if (data.label !== undefined) patch.label = data.label
  if (data.teamSize !== undefined) patch.team_size = data.teamSize
  if (data.notes !== undefined) patch.notes = data.notes
  if (data.memberId !== undefined) { patch.member_id = data.memberId; patch.equipe_id = null }
  if (data.equipeId !== undefined) { patch.equipe_id = data.equipeId; patch.member_id = null }

  const nextLabel = data.label ?? (existing as any).label
  const nextMemberId = data.memberId !== undefined ? data.memberId : (data.equipeId !== undefined ? null : (existing as any).member_id)
  const nextEquipeId = data.equipeId !== undefined ? data.equipeId : (data.memberId !== undefined ? null : (existing as any).equipe_id)
  const validationError = validatePlanningAssigneeLabel({
    label: nextLabel,
    memberId: nextMemberId,
    equipeId: nextEquipeId,
  })
  if (validationError) return { error: validationError }

  const { error } = await supabase.from('chantier_plannings').update(patch).eq('id', id)
  if (error) return { error: error.message }

  revalidatePath('/chantiers/planning')
  revalidatePath(`/chantiers/${(existing as any).chantier_id}`)
  return { error: null }
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

export async function deletePlanningEntry(id: string): Promise<{ error: string | null }> {
  if (id.startsWith('maintenance:')) {
    const interventionId = id.replace(/^maintenance:/, '')
    const supabase = await createClient()
    const orgId = await getCurrentOrganizationId()
    if (!orgId) return { error: 'Organisation introuvable.' }
    if (!await hasPermission('chantiers.planning')) return { error: 'Action non autorisée.' }

    const { data: intervention } = await supabase
      .from('maintenance_interventions')
      .select('id')
      .eq('id', interventionId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (!intervention) return { error: 'Intervention introuvable ou non autorisée.' }

    const { error } = await supabase
      .from('maintenance_interventions')
      .delete()
      .eq('id', interventionId)
      .eq('organization_id', orgId)
    if (error) return { error: error.message }
    revalidatePath('/chantiers/planning')
    revalidatePath('/chantiers/entretien')
    return { error: null }
  }

  return deletePlanningSlot(id)
}

export async function duplicatePlanningEntry(
  id: string,
  targetDate: string,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }
  if (!await hasPermission('chantiers.planning')) return { error: 'Action non autorisée.' }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  if (id.startsWith('maintenance:')) {
    const interventionId = id.replace(/^maintenance:/, '')
    const { data: intervention, error: fetchError } = await supabase
      .from('maintenance_interventions')
      .select('maintenance_contract_id, start_time, end_time, duration_hours, intervenant_id, intervenant_member_id, rapport, observations, billable_notes, billable_amount_ht, billable_vat_rate, cost_parts_ht, cost_travel_ht, cost_other_ht')
      .eq('id', interventionId)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (fetchError) return { error: fetchError.message }
    if (!intervention) return { error: 'Intervention introuvable.' }

    const { error } = await supabase.from('maintenance_interventions').insert({
      organization_id: orgId,
      created_by: user.id,
      maintenance_contract_id: intervention.maintenance_contract_id,
      date_intervention: targetDate,
      statut: 'planifiée',
      start_time: intervention.start_time,
      end_time: intervention.end_time,
      duration_hours: intervention.duration_hours,
      intervenant_id: intervention.intervenant_member_id ?? intervention.intervenant_id ?? null,
      intervenant_member_id: intervention.intervenant_member_id ?? intervention.intervenant_id ?? null,
      rapport: intervention.rapport,
      observations: intervention.observations,
      billable_notes: intervention.billable_notes,
      billable_amount_ht: intervention.billable_amount_ht,
      billable_vat_rate: intervention.billable_vat_rate,
      cost_parts_ht: intervention.cost_parts_ht,
      cost_travel_ht: intervention.cost_travel_ht,
      cost_other_ht: intervention.cost_other_ht,
    })
    if (error) return { error: error.message }
    await supabase
      .from('maintenance_contracts')
      .update({ prochaine_intervention: targetDate })
      .eq('id', intervention.maintenance_contract_id)
      .eq('organization_id', orgId)
      .or(`prochaine_intervention.is.null,prochaine_intervention.gte.${targetDate}`)
    revalidatePath('/chantiers/planning')
    revalidatePath('/chantiers/entretien')
    return { error: null }
  }

  const { data: slot, error: fetchError } = await supabase
    .from('chantier_plannings')
    .select('chantier_id, start_time, end_time, label, team_size, notes, equipe_id, member_id, duration_min, travel_from_prev_min, chantiers!inner(organization_id)')
    .eq('id', id)
    .maybeSingle()
  if (fetchError) return { error: fetchError.message }
  if (!slot || (slot as any).chantiers?.organization_id !== orgId) {
    return { error: 'Créneau introuvable ou non autorisé.' }
  }
  const validationError = validatePlanningAssigneeLabel({
    label: slot.label,
    memberId: slot.member_id,
    equipeId: slot.equipe_id,
  })
  if (validationError) return { error: validationError }

  const { error } = await supabase.from('chantier_plannings').insert({
    chantier_id: slot.chantier_id,
    planned_date: targetDate,
    start_time: slot.start_time,
    end_time: slot.end_time,
    label: slot.label,
    team_size: slot.team_size,
    notes: slot.notes,
    equipe_id: slot.equipe_id,
    member_id: slot.member_id,
    duration_min: slot.duration_min,
    travel_from_prev_min: slot.travel_from_prev_min,
    created_by: user.id,
  })
  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
  revalidatePath(`/chantiers/${slot.chantier_id}`)
  return { error: null }
}

export async function duplicatePlanningRange(
  fromDate: string,
  toDate: string,
  targetStartDate: string,
): Promise<{ error: string | null; created: number }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', created: 0 }
  if (!await hasPermission('chantiers.planning')) return { error: 'Action non autorisée.', created: 0 }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.', created: 0 }
  const offset = diffDays(fromDate, targetStartDate)

  const [{ data: chantierSlots, error: chantierError }, { data: maintenanceSlots, error: maintenanceError }] = await Promise.all([
    supabase
      .from('chantier_plannings')
      .select('chantier_id, planned_date, start_time, end_time, label, team_size, notes, equipe_id, member_id, duration_min, travel_from_prev_min, chantiers!inner(organization_id)')
      .eq('chantiers.organization_id', orgId)
      .gte('planned_date', fromDate)
      .lte('planned_date', toDate),
    supabase
      .from('maintenance_interventions')
      .select('maintenance_contract_id, date_intervention, start_time, end_time, duration_hours, intervenant_id, intervenant_member_id, rapport, observations, billable_notes, billable_amount_ht, billable_vat_rate, cost_parts_ht, cost_travel_ht, cost_other_ht')
      .eq('organization_id', orgId)
      .gte('date_intervention', fromDate)
      .lte('date_intervention', toDate)
      .in('statut', ['planifiée']),
  ])

  if (chantierError) return { error: chantierError.message, created: 0 }
  if (maintenanceError) return { error: maintenanceError.message, created: 0 }

  let created = 0
  const chantierRows = (chantierSlots ?? []).map((slot: any) => ({
    chantier_id: slot.chantier_id,
    planned_date: shiftDate(slot.planned_date, offset),
    start_time: slot.start_time,
    end_time: slot.end_time,
    label: slot.label,
    team_size: slot.team_size,
    notes: slot.notes,
    equipe_id: slot.equipe_id,
    member_id: slot.member_id,
    duration_min: slot.duration_min,
    travel_from_prev_min: slot.travel_from_prev_min,
    created_by: user.id,
  }))
  const invalidChantierRow = chantierRows.find(row => validatePlanningAssigneeLabel({
    label: row.label,
    memberId: row.member_id,
    equipeId: row.equipe_id,
  }))
  if (invalidChantierRow) return { error: validatePlanningAssigneeLabel({
    label: invalidChantierRow.label,
    memberId: invalidChantierRow.member_id,
    equipeId: invalidChantierRow.equipe_id,
  }), created }

  if (chantierRows.length > 0) {
    const { error } = await supabase.from('chantier_plannings').insert(chantierRows)
    if (error) return { error: error.message, created }
    created += chantierRows.length
  }

  const maintenanceRows = (maintenanceSlots ?? []).map((slot: any) => ({
    organization_id: orgId,
    created_by: user.id,
    maintenance_contract_id: slot.maintenance_contract_id,
    date_intervention: shiftDate(slot.date_intervention, offset),
    statut: 'planifiée',
    start_time: slot.start_time,
    end_time: slot.end_time,
    duration_hours: slot.duration_hours,
    intervenant_id: slot.intervenant_member_id ?? slot.intervenant_id ?? null,
    intervenant_member_id: slot.intervenant_member_id ?? slot.intervenant_id ?? null,
    rapport: slot.rapport,
    observations: slot.observations,
    billable_notes: slot.billable_notes,
    billable_amount_ht: slot.billable_amount_ht,
    billable_vat_rate: slot.billable_vat_rate,
    cost_parts_ht: slot.cost_parts_ht,
    cost_travel_ht: slot.cost_travel_ht,
    cost_other_ht: slot.cost_other_ht,
  }))
  if (maintenanceRows.length > 0) {
    const { error } = await supabase.from('maintenance_interventions').insert(maintenanceRows)
    if (error) return { error: error.message, created }
    created += maintenanceRows.length
    for (const row of maintenanceRows) {
      await supabase
        .from('maintenance_contracts')
        .update({ prochaine_intervention: row.date_intervention })
        .eq('id', row.maintenance_contract_id)
        .eq('organization_id', orgId)
        .or(`prochaine_intervention.is.null,prochaine_intervention.gte.${row.date_intervention}`)
    }
  }

  revalidatePath('/chantiers/planning')
  revalidatePath('/chantiers/entretien')
  return { error: null, created }
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

  const validationError = validatePlanningAssigneeLabel(data)
  if (validationError) return { id: null, error: validationError }

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
    const recipients = await getPlanningRecipientUserIds(orgId, { memberId: data.memberId, equipeId: data.equipeId })
    sendPushToPlanningRecipients(recipients, {
      title: 'Créneau mis à jour',
      body: `${data.label} — ${data.plannedDate}${data.startTime ? ` à ${data.startTime}` : ''}`,
      url: '/mon-espace/dashboard',
    }, user.id).catch(() => {})
    revalidatePath('/chantiers/planning')
    return { id: existingId, error: null }
  }

  const { data: inserted, error } = await supabase
    .from('chantier_plannings')
    .insert(row)
    .select('id')
    .single()

  if (error) return { id: null, error: error.message }
  const recipients = await getPlanningRecipientUserIds(orgId, { memberId: data.memberId, equipeId: data.equipeId })
  sendPushToPlanningRecipients(recipients, {
    title: 'Nouveau créneau planifié',
    body: `${data.label} — ${data.plannedDate}${data.startTime ? ` à ${data.startTime}` : ''}`,
    url: '/mon-espace/dashboard',
  }, user.id).catch(() => {})
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
  const invalidRow = rows.find(row => validatePlanningAssigneeLabel({
    label: row.label,
    memberId: row.member_id,
    equipeId: row.equipe_id,
  }))
  if (invalidRow) return { newRouteId: null, error: validatePlanningAssigneeLabel({
    label: invalidRow.label,
    memberId: invalidRow.member_id,
    equipeId: invalidRow.equipe_id,
  }) }

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
    departureLatitude?: number | null
    departureLongitude?: number | null
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
      departure_latitude: data.departureLatitude ?? null,
      departure_longitude: data.departureLongitude ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })

  if (error) return { error: error.message }

  // Amorce le point de départ par défaut de l'organisation si jamais configuré,
  // pour que le fallback (PDF, tournées sans surcharge) ait une valeur dès la
  // première saisie faite depuis cette modale.
  const { data: org } = await supabase
    .from('organizations')
    .select('departure_address')
    .eq('id', orgId)
    .maybeSingle()

  if (org && !org.departure_address) {
    await supabase
      .from('organizations')
      .update({
        departure_address: data.departureAddress,
        departure_postal_code: data.departurePostalCode,
        departure_city: data.departureCity,
        departure_latitude: data.departureLatitude ?? null,
        departure_longitude: data.departureLongitude ?? null,
      })
      .eq('id', orgId)
  }

  revalidatePath('/chantiers/planning')
  return { error: null }
}

export async function getTourneeRoute(routeId: string): Promise<{
  departure_address: string | null
  departure_postal_code: string | null
  departure_city: string | null
  departure_latitude: number | null
  departure_longitude: number | null
} | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data } = await supabase
    .from('tournee_routes')
    .select('departure_address, departure_postal_code, departure_city, departure_latitude, departure_longitude')
    .eq('id', routeId)
    .eq('organization_id', orgId)
    .maybeSingle()

  return data ?? null
}

export async function getAllTourneeRoutes(): Promise<Record<string, { address: string | null; postal_code: string | null; city: string | null; latitude: number | null; longitude: number | null }>> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return {}

  const { data } = await supabase
    .from('tournee_routes')
    .select('id, departure_address, departure_postal_code, departure_city, departure_latitude, departure_longitude')
    .eq('organization_id', orgId)

  if (!data) return {}
  return Object.fromEntries(data.map(r => [r.id, {
    address: r.departure_address,
    postal_code: r.departure_postal_code,
    city: r.departure_city,
    latitude: r.departure_latitude,
    longitude: r.departure_longitude,
  }]))
}

// ─── Agent IA - Parsing langage naturel ──────────────────────────────────────

export async function planWeekWithAI(prompt: string, weekMondayDate: string): Promise<AIPlanningResult> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { slots: [], deletions: [], unknownPeople: [], tours: [], summary: '', error: 'Organisation introuvable.' }

  if (!await hasPermission('chantiers.planning')) {
    return { slots: [], deletions: [], unknownPeople: [], tours: [], summary: '', error: 'Action non autorisée.' }
  }

  const [{ data: chantiers }, { data: maintenanceContracts }] = await Promise.all([
    supabase
      .from('chantiers')
      .select('id, title, city, address_line1, postal_code, status, is_maintenance')
      .eq('organization_id', orgId)
      .eq('is_archived', false)
      .in('status', ['en_cours', 'planifie', 'suspendu'])
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('maintenance_contracts')
      .select(`
        id, title, status, site_name, site_address_line1, site_postal_code, site_city, chantier_id,
        chantier:chantiers!maintenance_contracts_chantier_id_fkey(id, title, city, address_line1, postal_code, status)
      `)
      .eq('organization_id', orgId)
      .neq('status', 'résilié')
      .order('created_at', { ascending: false })
      .limit(30),
  ])

  if (!chantiers?.length && !maintenanceContracts?.length) {
    return { slots: [], deletions: [], summary: '', unknownPeople: [], tours: [], error: 'Aucun chantier ou contrat entretien actif trouvé.' }
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

  const chantiersContext = (chantiers ?? []).filter(c => !(c as any).is_maintenance).map(c => {
    const adresse = [c.address_line1, c.postal_code, c.city].filter(Boolean).join(', ')
    return `- ID: ${c.id} | "${c.title}"${adresse ? ` | ${adresse}` : ''}`
  }).join('\n') || '(aucun chantier travaux)'
  const maintenanceContext = (maintenanceContracts ?? []).map((contract: any) => {
    const chantier = Array.isArray(contract.chantier) ? contract.chantier[0] : contract.chantier
    const adresse = [
      contract.site_address_line1 ?? chantier?.address_line1,
      contract.site_postal_code ?? chantier?.postal_code,
      contract.site_city ?? chantier?.city,
    ].filter(Boolean).join(', ')
    const site = contract.site_name ? ` | site: ${contract.site_name}` : ''
    const support = chantier?.id ? ` | CHANTIER_ID_SUPPORT: ${chantier.id}` : ''
    return `- MAINTENANCE_CONTRACT_ID: ${contract.id} | "${contract.title}"${site}${support}${adresse ? ` | ${adresse}` : ''}`
  }).join('\n') || '(aucun contrat entretien)'
  const weekEndDate = weekDays['dimanche']

  const [{ data: existingPlannings }, { data: existingMaintenance }] = await Promise.all([
    supabase
      .from('chantier_plannings')
      .select(`
        id, chantier_id, planned_date, start_time, end_time, label,
        chantier:chantiers!inner(title, organization_id)
      `)
      .eq('chantier.organization_id', orgId)
      .gte('planned_date', weekMondayDate)
      .lte('planned_date', weekEndDate)
      .order('planned_date', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false }),
    supabase
      .from('maintenance_interventions')
      .select('id, maintenance_contract_id, date_intervention, start_time, end_time, observations, intervenant_member_id, contract:maintenance_contracts!inner(title, organization_id)')
      .eq('contract.organization_id', orgId)
      .gte('date_intervention', weekMondayDate)
      .lte('date_intervention', weekEndDate)
      .in('statut', ['planifiée'])
      .order('date_intervention', { ascending: true })
      .order('start_time', { ascending: true, nullsFirst: false }),
  ])

  const existingChantierContext = (existingPlannings ?? []).map((p: any) => (
    `- SLOT_ID: ${p.id} | CHANTIER_ID: ${p.chantier_id} | "${p.chantier?.title ?? 'Chantier'}" | ${p.planned_date} ${p.start_time ?? 'sans heure'}${p.end_time ? `-${p.end_time}` : ''} | ${p.label}`
  )).join('\n')
  const existingMaintenanceContext = (existingMaintenance ?? []).map((p: any) => {
    const contract = Array.isArray(p.contract) ? p.contract[0] : p.contract
    return `- SLOT_ID: maintenance:${p.id} | MAINTENANCE_CONTRACT_ID: ${p.maintenance_contract_id} | "${contract?.title ?? 'Entretien'}" | ${p.date_intervention} ${p.start_time ?? 'sans heure'}${p.end_time ? `-${p.end_time}` : ''} | ${p.observations ?? 'Entretien'}`
  }).join('\n')
  const existingContext = [existingChantierContext, existingMaintenanceContext].filter(Boolean).join('\n') || '(aucun créneau existant cette semaine)'

  const systemPrompt = `Tu t'appelles Nora. Tu es assistante de planification chez ATELIER by Orsayn. Tu dois parser une description de planning en langage naturel et retourner un JSON structure. Tu connais les chantiers, les equipes et les membres de l'organisation. Tu es efficace et tu places les bonnes personnes aux bons endroits.

Chantiers disponibles (avec adresses si connues) :
${chantiersContext}

Contrats entretien disponibles :
${maintenanceContext}

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
- Si la demande parle d'entretien, maintenance, intervention de contrat ou passage périodique, matcher dans "Contrats entretien disponibles" et créer un slot source="maintenance" avec maintenanceContractId.
- Sinon créer un slot source="chantier" avec chantierId.
- Si une mention nomme une **équipe** existante, remplir equipeId avec son EQUIPE_ID, memberId = null
- Si une mention nomme une **personne individuelle** (prénom/nom) qui figure dans les membres ou membres d'équipe listés, remplir memberId avec son MEMBER_ID, equipeId = null
- equipeId et memberId sont **mutuellement exclusifs** (jamais les deux dans le même slot)
- Si la personne ou l'équipe mentionnée n'existe pas dans les listes, laisser equipeId et memberId à null, mettre le nom dans label, et ajouter le nom dans unknownPeople
- start_time et end_time au format "HH:MM", null si non précisé
- team_size = nombre de personnes (1 si non précisé ou si memberId rempli)
- label = nom de l'équipe ou des personnes mentionnées. Si aucun membre/équipe n'est résolu, ne mets jamais "Équipe" seul : utilise un libellé précis comme "Intervenant à préciser - [mission]" ou le nom libre mentionné.
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
      "source": "chantier" | "maintenance",
      "chantierId": "uuid",
      "maintenanceContractId": "uuid" | null,
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
      "source": "chantier" | "maintenance",
      "chantierId": "uuid",
      "maintenanceContractId": "uuid" | null,
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
    const validChantierIds = new Set((chantiers ?? []).map(c => c.id))
    const validMaintenanceContractIds = new Set((maintenanceContracts ?? []).map(c => c.id))
    const validEquipeIds = new Set(equipes.map(e => e.id))
    const validMemberIds = new Set(allMembresIds)
    const existingById = new Map<string, any>([
      ...(existingPlannings ?? []).map((p: any) => [p.id, { ...p, source: 'chantier' }] as const),
      ...(existingMaintenance ?? []).map((p: any) => [`maintenance:${p.id}`, { ...p, source: 'maintenance' }] as const),
    ])

    const validSlots = (parsed.slots ?? [])
      .filter(s => {
        if (s.source === 'maintenance' || s.maintenanceContractId) {
          return Boolean(s.maintenanceContractId && validMaintenanceContractIds.has(s.maintenanceContractId))
        }
        return validChantierIds.has(s.chantierId)
      })
      .map(s => ({
        ...s,
        source: (s.source === 'maintenance' || s.maintenanceContractId) ? 'maintenance' as const : 'chantier' as const,
        maintenanceContractId: s.maintenanceContractId ?? null,
        equipeId: s.equipeId && validEquipeIds.has(s.equipeId) ? s.equipeId : null,
        memberId: s.memberId && validMemberIds.has(s.memberId) ? s.memberId : null,
      }))
      // Garantir l'exclusivité (member prioritaire si la personne est nommément citée)
      .map(s => s.memberId ? { ...s, equipeId: null } : s)

    const validDeletions = (parsed.deletions ?? [])
      .filter(d => existingById.has(d.id))
      .map(d => {
        const existing: any = existingById.get(d.id)
        if (existing.source === 'maintenance') {
          const contract = Array.isArray(existing.contract) ? existing.contract[0] : existing.contract
          return {
            id: `maintenance:${existing.id}`,
            source: 'maintenance' as const,
            chantierId: '',
            maintenanceContractId: existing.maintenance_contract_id,
            maintenanceInterventionId: existing.id,
            chantierTitle: contract?.title ?? d.chantierTitle ?? 'Entretien',
            plannedDate: existing.date_intervention,
            startTime: existing.start_time,
            endTime: existing.end_time,
            label: existing.observations ?? 'Entretien',
          }
        }
        return {
          id: existing.id,
          source: 'chantier' as const,
          chantierId: existing.chantier_id,
          maintenanceContractId: null,
          maintenanceInterventionId: null,
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
    if (error instanceof AIProviderCreditError && error.aiBillingMode === 'client_owned') {
      return { slots: [], deletions: [], unknownPeople: [], tours: [], summary: '', error: 'Rechargez vos crédits OpenRouter ou vérifiez la clé OpenRouter de votre organisation pour continuer.' }
    }

    console.error('[planWeekWithAI]', error)
    return { slots: [], deletions: [], unknownPeople: [], tours: [], summary: '', error: 'Réponse IA invalide. Reformulez votre demande.' }
  }
}

export async function setPlanningArrivedAt(slotId: string, arrivedAt: string): Promise<{ error: string | null }> {
  if (!await hasPermission('chantiers.manage_pointages')) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: { user } } = await supabase.auth.getUser()

  const { data: existing } = await supabase
    .from('chantier_plannings')
    .select('id, chantier_id, member:chantier_equipe_membres(prenom, name), chantiers!inner(organization_id, title)')
    .eq('id', slotId)
    .single()

  if (!existing || (existing as any).chantiers?.organization_id !== orgId) {
    return { error: 'Créneau introuvable ou non autorisé.' }
  }

  const { error } = await supabase
    .from('chantier_plannings')
    .update({ arrived_at: arrivedAt })
    .eq('id', slotId)

  if (error) return { error: error.message }

  const memberInfo = (existing as any).member
  const memberLabel = memberInfo?.prenom ?? memberInfo?.name ?? 'Un intervenant'
  const chantierTitle = (existing as any).chantiers?.title ?? 'Chantier'
  sendPushToOrgPermission(
    orgId,
    'chantiers.manage_pointages',
    {
      title: 'Arrivée sur site',
      body: `${memberLabel} est arrivé sur ${chantierTitle}`,
      url: `/chantiers/${(existing as any).chantier_id}`,
    },
    user?.id ?? null,
  ).catch(() => {})

  revalidatePath('/chantiers/planning')
  return { error: null }
}

export async function clearPlanningArrivedAt(slotId: string): Promise<{ error: string | null }> {
  if (!await hasPermission('chantiers.manage_pointages')) return { error: 'Action non autorisée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: existing } = await supabase
    .from('chantier_plannings')
    .select('id, chantiers!inner(organization_id)')
    .eq('id', slotId)
    .single()

  if (!existing || (existing as any).chantiers?.organization_id !== orgId) {
    return { error: 'Créneau introuvable ou non autorisé.' }
  }

  const { error } = await supabase
    .from('chantier_plannings')
    .update({ arrived_at: null })
    .eq('id', slotId)

  if (error) return { error: error.message }
  revalidatePath('/chantiers/planning')
  return { error: null }
}
