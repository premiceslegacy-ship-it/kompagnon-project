import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

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
  quote_id: string | null
  created_at: string
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
}

export type Pointage = {
  id: string
  chantier_id: string
  tache_id: string | null
  user_id: string
  date: string
  hours: number
  description: string | null
  created_at: string
  start_time: string | null  // "HH:MM" format
  user_name: string
  tache_title: string | null
}

export type ChantierPhoto = {
  id: string
  chantier_id: string
  tache_id: string | null
  storage_path: string
  caption: string | null
  taken_at: string
  created_at: string
  uploaded_by_name: string
  url: string | null
}

export type GlobalPointage = {
  id: string
  chantier_id: string
  chantier_title: string
  user_id: string
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
  name: string
  role_label: string | null
  profile_id: string | null
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
  label: string
  team_size: number
  notes: string | null
  created_at: string
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
      budget_ht, quote_id, created_at,
      contact_name, contact_email, contact_phone,
      recurrence, recurrence_times, recurrence_team_size,
      recurrence_duration_h, recurrence_notes,
      client:clients(id, company_name, email)
    `)
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

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
          budget_ht, quote_id, created_at,
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
    .select('*')
    .eq('chantier_id', chantierId)
    .order('position', { ascending: true })

  if (error) {
    console.error('[getChantierTaches]', error)
    return []
  }

  return (data ?? []) as Tache[]
}

export async function getChantierPointages(chantierId: string): Promise<Pointage[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_pointages')
    .select(`
      id, chantier_id, tache_id, user_id, date, hours, description, created_at, start_time,
      profile:profiles(full_name),
      tache:chantier_taches(title)
    `)
    .eq('chantier_id', chantierId)
    .order('date', { ascending: false })

  if (error) {
    console.error('[getChantierPointages]', error)
    return []
  }

  return (data ?? []).map((p: any) => ({
    id: p.id,
    chantier_id: p.chantier_id,
    tache_id: p.tache_id,
    user_id: p.user_id,
    date: p.date,
    hours: p.hours,
    description: p.description,
    created_at: p.created_at,
    start_time: p.start_time ?? null,
    user_name: p.profile?.full_name ?? 'Inconnu',
    tache_title: p.tache?.title ?? null,
  }))
}

export async function getChantierPhotos(chantierId: string): Promise<ChantierPhoto[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_photos')
    .select(`
      id, chantier_id, tache_id, storage_path, caption, taken_at, created_at,
      uploader:profiles(full_name)
    `)
    .eq('chantier_id', chantierId)
    .order('created_at', { ascending: false })

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

  return rows.map(p => ({
    id: p.id,
    chantier_id: p.chantier_id,
    tache_id: p.tache_id,
    storage_path: p.storage_path,
    caption: p.caption,
    taken_at: p.taken_at,
    created_at: p.created_at,
    uploaded_by_name: p.uploader?.full_name ?? 'Inconnu',
    url: urlMap.get(p.storage_path) ?? null,
  }))
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
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  let q = supabase
    .from('chantier_pointages')
    .select(`
      id, chantier_id, user_id, date, hours, description,
      profile:profiles(full_name),
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

  return (data ?? []).map((p: any) => ({
    id: p.id,
    chantier_id: p.chantier_id,
    chantier_title: p.chantier?.title ?? '-',
    user_id: p.user_id,
    user_name: p.profile?.full_name ?? 'Inconnu',
    date: p.date,
    hours: p.hours,
    description: p.description,
    tache_title: p.tache?.title ?? null,
  }))
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
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const firstOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString().split('T')[0]

  const [{ data: chantiers }] = await Promise.all([
    supabase
      .from('chantiers')
      .select('id, status, end_date')
      .eq('organization_id', orgId)
      .eq('is_archived', false),

    supabase
      .from('chantier_pointages')
      .select('hours, date, chantier_id')
      .in(
        'chantier_id',
        // sous-requête simulée : on filtre côté JS pour les chantiers de cette org
        // (RLS garantit déjà l'isolation)
        [],
      )
      .gte('date', firstOfMonth)
      .lt('date', firstOfNextMonth),
  ])

  // Pour les heures du mois, on refait une requête simple car sous-requête non dispo directement
  const chantierIds = (chantiers ?? []).map(c => c.id)
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

  const total = chantiers?.length ?? 0
  const enCours = chantiers?.filter(c => c.status === 'en_cours').length ?? 0
  const terminesCeMois = chantiers?.filter(c =>
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
      membres:chantier_equipe_membres(id, equipe_id, name, role_label, profile_id)
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
        membres:chantier_equipe_membres(id, equipe_id, name, role_label, profile_id)
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
  chantier_title: string
  chantier_city: string | null
  chantier_status: ChantierStatus
  chantier_color_idx: number   // index stable basé sur l'id
}

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
      equipe_id, label, team_size, notes, created_at,
      chantier:chantiers!inner(title, city, status, organization_id)
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

  return (data ?? []).map((row: any) => ({
    id: row.id,
    chantier_id: row.chantier_id,
    planned_date: row.planned_date,
    start_time: row.start_time,
    end_time: row.end_time,
    equipe_id: row.equipe_id,
    label: row.label,
    team_size: row.team_size,
    notes: row.notes,
    created_at: row.created_at,
    chantier_title: row.chantier?.title ?? '-',
    chantier_city: row.chantier?.city ?? null,
    chantier_status: row.chantier?.status ?? 'planifie',
    chantier_color_idx: colorIdx(row.chantier_id),
  }))
}

export async function getChantierPlannings(chantierId: string): Promise<ChantierPlanning[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_plannings')
    .select('id, chantier_id, planned_date, start_time, end_time, equipe_id, label, team_size, notes, created_at')
    .eq('chantier_id', chantierId)
    .order('planned_date', { ascending: true })
    .order('start_time', { ascending: true, nullsFirst: false })

  if (error) {
    console.error('[getChantierPlannings]', error)
    return []
  }

  return (data ?? []) as ChantierPlanning[]
}
