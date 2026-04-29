import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

export type IndividualMember = {
  id: string
  organization_id: string
  equipe_id: string | null
  prenom: string | null
  name: string
  email: string | null
  role_label: string | null
  taux_horaire: number | null
  profile_id: string | null
  created_at: string
}

export type MemberPointage = {
  id: string
  chantier_id: string
  chantier_title: string
  tache_id: string | null
  tache_title: string | null
  date: string
  hours: number
  start_time: string | null
  description: string | null
}

export type MemberPlanning = {
  id: string
  chantier_id: string
  chantier_title: string
  chantier_city: string | null
  planned_date: string
  start_time: string | null
  end_time: string | null
  label: string
  notes: string | null
}

/** Membres "fantômes" de l'organisation : sans équipe parente (equipe_id IS NULL). */
export async function getOrgIndividualMembers(): Promise<IndividualMember[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('chantier_equipe_membres')
    .select('id, organization_id, equipe_id, prenom, name, email, role_label, taux_horaire, profile_id, created_at')
    .eq('organization_id', orgId)
    .is('equipe_id', null)
    .order('name', { ascending: true })

  if (error) {
    console.error('[getOrgIndividualMembers]', error)
    return []
  }
  return (data ?? []) as IndividualMember[]
}

/** Membres assignés directement à un chantier (sans équipe parente). */
export async function getChantierIndividualMembers(chantierId: string): Promise<IndividualMember[]> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('chantier_individual_members')
    .select(`
      member:chantier_equipe_membres(
        id, organization_id, equipe_id, prenom, name, email, role_label, taux_horaire, profile_id, created_at
      )
    `)
    .eq('chantier_id', chantierId)

  if (error) {
    console.error('[getChantierIndividualMembers]', error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((row: any) => row.member).filter(Boolean) as IndividualMember[]
}

/** Pointages du membre (jointure chantier + tâche). Utilise admin client si caller-less (cron, espace membre). */
export async function getMemberPointages(
  memberId: string,
  opts?: { dateFrom?: string; dateTo?: string; useAdmin?: boolean },
): Promise<MemberPointage[]> {
  const supabase = opts?.useAdmin ? createAdminClient() : await createClient()

  let q = supabase
    .from('chantier_pointages')
    .select(`
      id, chantier_id, tache_id, date, hours, start_time, description,
      chantiers!inner ( title ),
      chantier_taches ( title )
    `)
    .eq('member_id', memberId)
    .order('date', { ascending: false })

  if (opts?.dateFrom) q = q.gte('date', opts.dateFrom)
  if (opts?.dateTo)   q = q.lte('date', opts.dateTo)

  const { data, error } = await q
  if (error) {
    console.error('[getMemberPointages]', error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id:             r.id,
    chantier_id:    r.chantier_id,
    chantier_title: r.chantiers?.title ?? '',
    tache_id:       r.tache_id,
    tache_title:    r.chantier_taches?.title ?? null,
    date:           r.date,
    hours:          Number(r.hours),
    start_time:     r.start_time,
    description:    r.description,
  })) as MemberPointage[]
}

/** Créneaux planifiés à venir pour ce membre (directement member_id, ou via une équipe à laquelle il appartient). */
export async function getMemberPlannings(
  memberId: string,
  opts?: { dateFrom?: string; dateTo?: string; useAdmin?: boolean },
): Promise<MemberPlanning[]> {
  const supabase = opts?.useAdmin ? createAdminClient() : await createClient()

  // 1. Trouver les équipes auxquelles ce membre appartient
  const { data: memberRow } = await supabase
    .from('chantier_equipe_membres')
    .select('equipe_id')
    .eq('id', memberId)
    .single()

  const equipeId = memberRow?.equipe_id ?? null

  let q = supabase
    .from('chantier_plannings')
    .select(`
      id, chantier_id, planned_date, start_time, end_time, label, notes,
      chantiers!inner ( title, city )
    `)
    .order('planned_date', { ascending: true })

  if (equipeId) {
    q = q.or(`member_id.eq.${memberId},equipe_id.eq.${equipeId}`)
  } else {
    q = q.eq('member_id', memberId)
  }

  if (opts?.dateFrom) q = q.gte('planned_date', opts.dateFrom)
  if (opts?.dateTo)   q = q.lte('planned_date', opts.dateTo)

  const { data, error } = await q
  if (error) {
    console.error('[getMemberPlannings]', error)
    return []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []).map((r: any) => ({
    id:             r.id,
    chantier_id:    r.chantier_id,
    chantier_title: r.chantiers?.title ?? '',
    chantier_city:  r.chantiers?.city ?? null,
    planned_date:   r.planned_date,
    start_time:     r.start_time,
    end_time:       r.end_time,
    label:          r.label,
    notes:          r.notes,
  })) as MemberPlanning[]
}

/** Lookup admin (sans RLS) — utilisé par /mon-espace côté serveur. */
export async function getMemberByIdAdmin(memberId: string): Promise<IndividualMember | null> {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('chantier_equipe_membres')
    .select('id, organization_id, equipe_id, prenom, name, email, role_label, taux_horaire, profile_id, created_at')
    .eq('id', memberId)
    .single()
  if (error) return null
  return data as IndividualMember
}
