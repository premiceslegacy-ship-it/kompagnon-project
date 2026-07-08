import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'
import { todayParis } from '@/lib/utils'
import { hasPermission } from '@/lib/data/queries/membership'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChantierStatus = 'planifie' | 'en_cours' | 'suspendu' | 'termine' | 'annule'
export type TacheStatus = 'a_faire' | 'en_cours' | 'termine'

export type Chantier = {
  id: string
  title: string
  description: string | null
  status: ChantierStatus
  address_line1: string | null
  postal_code: string | null
  city: string | null
  start_date: string | null
  end_date: string | null
  estimated_end_date: string | null
  budget_ht: number
  target_margin_pct: number
  montant_periode_ht: number | null
  libelle_facturation_periode: string | null
  periode_facturation: 'none' | 'mensuelle' | 'bimestrielle' | 'trimestrielle' | 'annuelle' | null
  jour_facturation: number | null
  prochaine_facturation: string | null
  default_retention_pct: number
  quote_id: string | null
  created_at: string
  // Réception chantier
  reception_status: 'sans_reserve' | 'avec_reserve' | 'reserve_levee' | null
  reception_at: string | null
  reception_notes: string | null
  // Contact référent
  contact_name: string | null
  contact_email: string | null
  contact_phone: string | null
  // Récurrence
  recurrence: string | null
  recurrence_times: number | null
  recurrence_team_size: number | null
  recurrence_duration_h: number | null
  recurrence_notes: string | null
  client: {
    id: string
    company_name: string | null
    email: string | null
  } | null
}

export type ChantierDetail = Chantier & {
  taches_count: number
  taches_done: number
  total_hours: number
  photos_count: number
}

export type Tache = {
  id: string
  chantier_id: string
  title: string
  description: string | null
  progress_note: string | null
  status: TacheStatus
  position: number
  assigned_to: string | null
  due_date: string | null
  completed_at: string | null
  created_at: string
  jalon_id: string | null
  assignments: TacheAssignment[]
}

export type TacheAssignment = {
  id: string
  tache_id: string
  equipe_id: string | null
  member_id: string | null
  label: string
  color: string | null
}

export type Pointage = {
  id: string
  chantier_id: string
  tache_id: string | null
  user_id: string | null
  member_id: string | null
  date: string
  hours: number
  description: string | null
  created_at: string
  start_time: string | null  // "HH:MM" format
  user_name: string          // nom affiché (user ou membre fantôme)
  tache_title: string | null
}

export type ChantierPhoto = {
  id: string
  chantier_id: string
  tache_id: string | null
  storage_path: string
  title: string | null
  caption: string | null
  taken_at: string
  created_at: string
  uploaded_by_name: string
  url: string | null
  include_in_report: boolean
  shared_with_client_at: string | null
}

export type GlobalPointage = {
  id: string
  chantier_id: string
  chantier_title: string
  user_id: string | null
  member_id: string | null
  member_profile_id: string | null  // profile_id du membre fantôme si lié à un user app
  user_name: string
  date: string
  hours: number
  description: string | null
  tache_title: string | null
}

export type ChantierNote = {
  id: string
  chantier_id: string
  content: string
  created_at: string
  author_name: string
}

export type ChantierStats = {
  total: number
  enCours: number
  terminesCeMois: number
  heuresCeMois: number
}

export type EquipeMembre = {
  id: string
  equipe_id: string
  prenom: string | null
  name: string
  email: string | null
  role_label: string | null
  profile_id: string | null
  taux_horaire: number | null
}

export type Equipe = {
  id: string
  organization_id: string
  name: string
  color: string
  description: string | null
  created_at: string
  membres: EquipeMembre[]
}

export type ChantierPlanning = {
  id: string
  chantier_id: string
  planned_date: string        // YYYY-MM-DD
  start_time: string | null   // HH:MM
  end_time: string | null     // HH:MM
  equipe_id: string | null
  member_id: string | null
  label: string
  team_size: number
  notes: string | null
  created_at: string
  // Tournée fields (null si hors tournée)
  route_id: string | null
  route_order: number | null
  duration_min: number | null
  travel_from_prev_min: number | null
  arrived_at: string | null
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getChantiers(): Promise<Chantier[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('chantiers')
    .select(`
      id, title, description, status,
      address_line1, postal_code, city,
      start_date, end_date, estimated_end_date,
      budget_ht, target_margin_pct, quote_id, created_at,
      montant_periode_ht, libelle_facturation_periode, periode_facturation, jour_facturation, prochaine_facturation, default_retention_pct,
      contact_name, contact_email, contact_phone,
      recurrence, recurrence_times, recurrence_team_size,
      recurrence_duration_h, recurrence_notes,
      reception_status, reception_at, reception_notes,
      client:clients(id, company_name, email)
    `)
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .eq('is_maintenance', false)
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.error('[getChantiers]', error)
    return []
  }

  return (data ?? []) as unknown as Chantier[]
}

export async function getChantierById(chantierId: string): Promise<ChantierDetail | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const [{ data: chantier, error }, { data: taches }, { data: pointages }, { data: photos }] =
    await Promise.all([
      supabase
        .from('chantiers')
        .select(`
          id, title, description, status,
          address_line1, postal_code, city,
          start_date, end_date, estimated_end_date,
          budget_ht, target_margin_pct, quote_id, created_at,
          montant_periode_ht, libelle_facturation_periode, periode_facturation, jour_facturation, prochaine_facturation, default_retention_pct,
          contact_name, contact_email, contact_phone,
          recurrence, recurrence_times, recurrence_team_size,
          recurrence_duration_h, recurrence_notes,
          client:clients(id, company_name, email)
        `)
        .eq('id', chantierId)
        .eq('organization_id', orgId)
        .single(),

      supabase
        .from('chantier_taches')
        .select('id, status')
        .eq('chantier_id', chantierId),

      supabase
        .from('chantier_pointages')
        .select('hours')
        .eq('chantier_id', chantierId),

      supabase
        .from('chantier_photos')
        .select('id')
        .eq('chantier_id', chantierId),
    ])

  if (error) {
    console.error('[getChantierById]', error)
    return null
  }

  const tachesCount = taches?.length ?? 0
  const tachesDone = taches?.filter(t => t.status === 'termine').length ?? 0
  const totalHours = pointages?.reduce((s, p) => s + (p.hours ?? 0), 0) ?? 0
  const photosCount = photos?.length ?? 0

  return {
    ...(chantier as unknown as Chantier),
    taches_count: tachesCount,
    taches_done: tachesDone,
    total_hours: totalHours,
    photos_count: photosCount,
  }
}

export async function getChantierTaches(chantierId: string): Promise<Tache[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_taches')
    .select(`
      *,
      assignments:chantier_task_assignments(
        id, tache_id, equipe_id, member_id,
        equipe:chantier_equipes(id, name, color),
        member:chantier_equipe_membres(id, prenom, name)
      )
    `)
    .eq('chantier_id', chantierId)
    .order('position', { ascending: true })

  if (error) {
    console.error('[getChantierTaches]', error)
    return []
  }

  return (data ?? []).map((t: any) => ({
    ...t,
    assignments: (t.assignments ?? []).map((a: any) => ({
      id: a.id,
      tache_id: a.tache_id,
      equipe_id: a.equipe_id ?? null,
      member_id: a.member_id ?? null,
      label: a.equipe?.name
        ?? [a.member?.prenom, a.member?.name].filter(Boolean).join(' ')
        ?? 'Assignation',
      color: a.equipe?.color ?? null,
    })),
  })) as Tache[]
}

export async function getChantierPointages(chantierId: string): Promise<Pointage[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_pointages')
    .select(`
      id, chantier_id, tache_id, user_id, member_id, date, hours, description, created_at, start_time,
      profile:profiles(full_name),
      membre:chantier_equipe_membres(prenom, name),
      tache:chantier_taches(title)
    `)
    .eq('chantier_id', chantierId)
    .order('date', { ascending: false })

  if (error) {
    console.error('[getChantierPointages]', error)
    return []
  }

  return (data ?? []).map((p: any) => {
    const membreName = p.membre
      ? `${p.membre.prenom ?? ''} ${p.membre.name}`.trim()
      : null
    return {
      id: p.id,
      chantier_id: p.chantier_id,
      tache_id: p.tache_id,
      user_id: p.user_id ?? null,
      member_id: p.member_id ?? null,
      date: p.date,
      hours: p.hours,
      description: p.description,
      created_at: p.created_at,
      start_time: p.start_time ?? null,
      user_name: p.profile?.full_name ?? membreName ?? 'Inconnu',
      tache_title: p.tache?.title ?? null,
    }
  })
}

// Plafond d'affichage : un chantier avec suivi photo quotidien sur plusieurs mois
// peut accumuler des centaines de photos. Sans limite, la fiche chantier attend le
// chargement de toutes les photos + la génération de toutes leurs URLs signées avant
// de s'afficher. On affiche les 60 plus récentes ; les usages qui ont besoin de
// l'intégralité (rapport PDF, envoi photos par email) font leur propre requête directe
// et ne sont pas affectés. Suite possible : bouton "charger plus" côté client pour
// consulter les photos plus anciennes sans changer ce plafond serveur.
const CHANTIER_PHOTOS_INITIAL_LIMIT = 60

export async function getChantierPhotos(chantierId: string): Promise<ChantierPhoto[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_photos')
    .select(`
      id, chantier_id, tache_id, storage_path, title, caption, taken_at, created_at,
      include_in_report, shared_with_client_at,
      uploader:profiles(full_name),
      membre:chantier_equipe_membres(prenom, name)
    `)
    .eq('chantier_id', chantierId)
    .order('created_at', { ascending: false })
    .limit(CHANTIER_PHOTOS_INITIAL_LIMIT)

  if (error) {
    console.error('[getChantierPhotos]', error)
    return []
  }

  const rows = (data ?? []) as any[]
  if (rows.length === 0) return []

  const paths = rows.map(r => r.storage_path as string)
  const { data: signedUrls } = await supabase.storage
    .from('chantier-photos')
    .createSignedUrls(paths, 3600)

  const urlMap = new Map<string, string>()
  signedUrls?.forEach(item => { if (item.signedUrl && item.path) urlMap.set(item.path, item.signedUrl) })

  return rows.map(p => {
    const membreName = p.membre
      ? `${p.membre.prenom ?? ''} ${p.membre.name}`.trim()
      : null
    return {
      id: p.id,
      chantier_id: p.chantier_id,
      tache_id: p.tache_id,
      storage_path: p.storage_path,
      title: p.title ?? null,
      caption: p.caption,
      taken_at: p.taken_at,
      created_at: p.created_at,
      uploaded_by_name: p.uploader?.full_name ?? membreName ?? 'Inconnu',
      url: urlMap.get(p.storage_path) ?? null,
      include_in_report: p.include_in_report ?? false,
      shared_with_client_at: p.shared_with_client_at ?? null,
    }
  })
}

export async function getOrgTaskTitles(excludeChantierId: string): Promise<string[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('chantier_taches')
    .select('title, chantier:chantiers!inner(organization_id)')
    .eq('chantier.organization_id', orgId)
    .neq('chantier_id', excludeChantierId)

  if (error) {
    console.error('[getOrgTaskTitles]', error)
    return []
  }

  return [...new Set((data ?? []).map((r: any) => r.title as string))].sort()
}

export async function getAllPointagesGlobal(opts?: { from?: string; to?: string }): Promise<GlobalPointage[]> {
  if (!await hasPermission('chantiers.manage_pointages')) return []

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  let q = supabase
    .from('chantier_pointages')
    .select(`
      id, chantier_id, user_id, member_id, date, hours, description,
      profile:profiles(full_name),
      membre:chantier_equipe_membres(prenom, name, profile_id),
      tache:chantier_taches(title),
      chantier:chantiers!inner(title, organization_id)
    `)
    .eq('chantier.organization_id', orgId)
    .order('date', { ascending: false })

  if (opts?.from) q = q.gte('date', opts.from)
  if (opts?.to)   q = q.lte('date', opts.to)

  const { data, error } = await q

  if (error) {
    console.error('[getAllPointagesGlobal]', error)
    return []
  }

  return (data ?? []).map((p: any) => {
    const membreName = p.membre
      ? `${p.membre.prenom ?? ''} ${p.membre.name}`.trim()
      : null
    return {
      id: p.id,
      chantier_id: p.chantier_id,
      chantier_title: p.chantier?.title ?? '-',
      user_id: p.user_id ?? null,
      member_id: p.member_id ?? null,
      member_profile_id: p.membre?.profile_id ?? null,
      user_name: p.profile?.full_name ?? membreName ?? 'Inconnu',
      date: p.date,
      hours: p.hours,
      description: p.description,
      tache_title: p.tache?.title ?? null,
    }
  })
}

export async function getChantierNotes(chantierId: string): Promise<ChantierNote[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_notes')
    .select(`
      id, chantier_id, content, created_at,
      author:profiles(full_name)
    `)
    .eq('chantier_id', chantierId)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getChantierNotes]', error)
    return []
  }

  return (data ?? []).map((n: any) => ({
    id: n.id,
    chantier_id: n.chantier_id,
    content: n.content,
    created_at: n.created_at,
    author_name: n.author?.full_name ?? 'Inconnu',
  }))
}

export async function getChantierStats(): Promise<ChantierStats> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { total: 0, enCours: 0, terminesCeMois: 0, heuresCeMois: 0 }

  const now = new Date()
  const [cy, cm] = todayParis().split('-').map(Number)
  const firstOfMonth = `${cy}-${String(cm).padStart(2, '0')}-01`
  const nm = cm === 12 ? 1 : cm + 1
  const ny = cm === 12 ? cy + 1 : cy
  const firstOfNextMonth = `${ny}-${String(nm).padStart(2, '0')}-01`

  const [{ data: chantiers }, { data: activeMaintenanceContracts }] = await Promise.all([
    supabase
      .from('chantiers')
      .select('id, status, end_date, is_maintenance, maintenance_contract_id')
      .eq('organization_id', orgId)
      .eq('is_archived', false),
    supabase
      .from('maintenance_contracts')
      .select('id')
      .eq('organization_id', orgId)
      .eq('status', 'actif'),
  ])

  // Pour les heures du mois, on refait une requête simple car sous-requête non dispo directement
  const activeMaintenanceIds = new Set((activeMaintenanceContracts ?? []).map(c => c.id))
  const reportableChantiers = (chantiers ?? []).filter(c =>
    !c.is_maintenance || !c.maintenance_contract_id || activeMaintenanceIds.has(c.maintenance_contract_id)
  )

  const chantierIds = reportableChantiers.map(c => c.id)
  let heuresCeMois = 0
  if (chantierIds.length > 0) {
    const { data: pointagesMois } = await supabase
      .from('chantier_pointages')
      .select('hours')
      .in('chantier_id', chantierIds)
      .gte('date', firstOfMonth)
      .lt('date', firstOfNextMonth)
    heuresCeMois = pointagesMois?.reduce((s, p) => s + (p.hours ?? 0), 0) ?? 0
  }

  const total = reportableChantiers.length
  const enCours = reportableChantiers.filter(c => c.status === 'en_cours').length
  const terminesCeMois = reportableChantiers.filter(c =>
    c.status === 'termine' &&
    c.end_date &&
    c.end_date >= firstOfMonth &&
    c.end_date < firstOfNextMonth
  ).length ?? 0

  return { total, enCours, terminesCeMois, heuresCeMois }
}

// ─── Équipes ──────────────────────────────────────────────────────────────────

export async function getEquipes(): Promise<Equipe[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('chantier_equipes')
    .select(`
      id, organization_id, name, color, description, created_at,
      membres:chantier_equipe_membres(id, equipe_id, prenom, name, email, role_label, profile_id, taux_horaire)
    `)
    .eq('organization_id', orgId)
    .order('name', { ascending: true })

  if (error) {
    console.error('[getEquipes]', error)
    return []
  }

  return (data ?? []) as unknown as Equipe[]
}

export async function getChantierEquipes(chantierId: string): Promise<Equipe[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_equipe_chantiers')
    .select(`
      equipe:chantier_equipes(
        id, organization_id, name, color, description, created_at,
        membres:chantier_equipe_membres(id, equipe_id, prenom, name, email, role_label, profile_id, taux_horaire)
      )
    `)
    .eq('chantier_id', chantierId)

  if (error) {
    console.error('[getChantierEquipes]', error)
    return []
  }

  return (data ?? [])
    .map((row: any) => row.equipe)
    .filter(Boolean) as Equipe[]
}

export type GlobalPlanning = ChantierPlanning & {
  source?: 'chantier' | 'maintenance'
  maintenance_intervention_id?: string | null
  maintenance_contract_id?: string | null
  chantier_title: string
  chantier_city: string | null
  chantier_status: ChantierStatus
  chantier_color_idx: number   // index stable basé sur l'id
  chantier_address_line1: string | null
  chantier_postal_code: string | null
  member_name?: string | null
  equipe_name?: string | null
}

// Alias utilisé dans la vue Tournée
export type TourneeSlot = GlobalPlanning

export async function getAllPlannings(opts?: {
  from?: string  // YYYY-MM-DD
  to?: string    // YYYY-MM-DD
}): Promise<GlobalPlanning[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  let q = supabase
    .from('chantier_plannings')
    .select(`
      id, chantier_id, planned_date, start_time, end_time,
      equipe_id, member_id, label, team_size, notes, created_at,
      route_id, route_order, duration_min, travel_from_prev_min, arrived_at,
      chantier:chantiers!inner(title, city, status, organization_id, address_line1, postal_code),
      member:chantier_equipe_membres(prenom, name),
      equipe:chantier_equipes(name)
    `)
    .eq('chantier.organization_id', orgId)
    .order('planned_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })

  if (opts?.from) q = q.gte('planned_date', opts.from)
  if (opts?.to)   q = q.lte('planned_date', opts.to)

  const { data, error } = await q

  if (error) {
    console.error('[getAllPlannings]', error)
    return []
  }

  // Numéro de couleur stable par chantier_id
  const colorIdx = (id: string) => {
    let h = 0
    for (const c of id) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
    return Math.abs(h) % 12
  }

  const chantierPlannings = (data ?? []).map((row: any) => {
    const memberRow = Array.isArray(row.member) ? row.member[0] : row.member
    const equipeRow = Array.isArray(row.equipe) ? row.equipe[0] : row.equipe
    const memberName = memberRow
      ? [memberRow.prenom, memberRow.name].filter(Boolean).join(' ') || null
      : null
    return ({
    id: row.id,
    source: 'chantier' as const,
    maintenance_intervention_id: null,
    maintenance_contract_id: null,
    chantier_id: row.chantier_id,
    planned_date: row.planned_date,
    start_time: row.start_time,
    end_time: row.end_time,
    equipe_id: row.equipe_id,
    member_id: row.member_id,
    label: row.label,
    team_size: row.team_size,
    notes: row.notes,
    created_at: row.created_at,
    route_id: row.route_id ?? null,
    route_order: row.route_order ?? null,
    duration_min: row.duration_min ?? null,
    travel_from_prev_min: row.travel_from_prev_min ?? null,
    arrived_at: row.arrived_at ?? null,
    chantier_title: row.chantier?.title ?? '-',
    chantier_city: row.chantier?.city ?? null,
    chantier_status: row.chantier?.status ?? 'planifie',
    chantier_color_idx: colorIdx(row.chantier_id),
    member_name: memberName,
    equipe_name: equipeRow?.name ?? null,
    chantier_address_line1: row.chantier?.address_line1 ?? null,
    chantier_postal_code: row.chantier?.postal_code ?? null,
  })})

  let maintenanceQuery = supabase
    .from('maintenance_interventions')
    .select(`
      id, date_intervention, start_time, end_time, duration_hours,
      rapport, observations, statut, intervenant_member_id, intervenant_id, intervenant_user_id, created_at,
      intervenant:chantier_equipe_membres!maintenance_interventions_intervenant_member_id_fkey(prenom, name),
      contract:maintenance_contracts!inner(
        id, title, chantier_id, organization_id, site_address_line1, site_postal_code, site_city,
        chantier:chantiers!maintenance_contracts_chantier_id_fkey(id, title, city, status, address_line1, postal_code)
      )
    `)
    .eq('organization_id', orgId)
    .in('statut', ['planifiée', 'réalisée'])
    .order('date_intervention', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })

  if (opts?.from) maintenanceQuery = maintenanceQuery.gte('date_intervention', opts.from)
  if (opts?.to) maintenanceQuery = maintenanceQuery.lte('date_intervention', opts.to)

  const { data: maintenanceRows, error: maintenanceError } = await maintenanceQuery

  if (maintenanceError) {
    console.error('[getAllPlannings maintenance]', maintenanceError)
  }

  const maintenancePlannings = (maintenanceRows ?? []).map((row: any) => {
    const contract = Array.isArray(row.contract) ? row.contract[0] : row.contract
    const chantier = Array.isArray(contract?.chantier) ? contract.chantier[0] : contract?.chantier
    const supportId = chantier?.id ?? contract?.chantier_id ?? `maintenance:${contract?.id ?? row.id}`
    const notes = row.rapport ?? row.observations ?? null
    const intervenantRow = Array.isArray(row.intervenant) ? row.intervenant[0] : row.intervenant
    const memberName = intervenantRow
      ? [intervenantRow.prenom, intervenantRow.name].filter(Boolean).join(' ') || null
      : null
    return {
      id: `maintenance:${row.id}`,
      source: 'maintenance' as const,
      maintenance_intervention_id: row.id,
      maintenance_contract_id: contract?.id ?? null,
      chantier_id: supportId,
      planned_date: row.date_intervention,
      start_time: row.start_time ? String(row.start_time).slice(0, 5) : null,
      end_time: row.end_time ? String(row.end_time).slice(0, 5) : null,
      equipe_id: null,
      member_id: row.intervenant_member_id ?? row.intervenant_id ?? null,
      label: 'Entretien',
      team_size: 1,
      notes,
      created_at: row.created_at,
      route_id: null,
      route_order: null,
      duration_min: row.duration_hours ? Math.round(Number(row.duration_hours) * 60) : null,
      travel_from_prev_min: null,
      arrived_at: null,
      chantier_title: contract?.title ?? 'Entretien',
      chantier_city: chantier?.city ?? contract?.site_city ?? null,
      chantier_status: chantier?.status ?? 'en_cours',
      chantier_color_idx: colorIdx(supportId),
      chantier_address_line1: chantier?.address_line1 ?? contract?.site_address_line1 ?? null,
      chantier_postal_code: chantier?.postal_code ?? contract?.site_postal_code ?? null,
      member_name: memberName,
      equipe_name: null,
    }
  })

  return [...chantierPlannings, ...maintenancePlannings]
    .sort((a, b) =>
      a.planned_date.localeCompare(b.planned_date)
      || (a.start_time ?? '99:99').localeCompare(b.start_time ?? '99:99')
      || a.chantier_title.localeCompare(b.chantier_title, 'fr')
    )
}

export async function getChantierPlannings(chantierId: string): Promise<ChantierPlanning[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_plannings')
    .select('id, chantier_id, planned_date, start_time, end_time, equipe_id, member_id, label, team_size, notes, created_at, route_id, route_order, duration_min, travel_from_prev_min')
    .eq('chantier_id', chantierId)
    .order('planned_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('[getChantierPlannings]', error)
    return []
  }

  return (data ?? []) as ChantierPlanning[]
}

// ─── Réserves ─────────────────────────────────────────────────────────────────

export type ChantierReserve = {
  id: string
  chantier_id: string
  description: string
  lot: string | null
  status: 'ouverte' | 'levee'
  resolved_at: string | null
  resolved_notes: string | null
  position: number
  created_at: string
}

export async function getChantierReserves(chantierId: string): Promise<ChantierReserve[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('chantier_reserves')
    .select('id, chantier_id, description, lot, status, resolved_at, resolved_notes, position, created_at')
    .eq('chantier_id', chantierId)
    .eq('organization_id', orgId)
    .order('position', { ascending: true })

  if (error) {
    console.error('[getChantierReserves]', error)
    return []
  }

  return (data ?? []) as ChantierReserve[]
}
