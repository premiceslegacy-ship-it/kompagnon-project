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
  rate_snapshot: number | null
}

export type MemberPlanning = {
  id: string
  chantier_id: string
  chantier_title: string
  chantier_city: string | null
  chantier_address_line1: string | null
  chantier_postal_code: string | null
  planned_date: string
  start_time: string | null
  end_time: string | null
  label: string
  notes: string | null
  route_id: string | null
  route_order: number | null
  duration_min: number | null
  travel_from_prev_min: number | null
}

export type MemberTask = {
  id: string
  chantier_id: string
  chantier_title: string
  title: string
  status: 'a_faire' | 'en_cours' | 'termine'
  due_date: string | null
  is_overdue: boolean
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
      id, chantier_id, tache_id, date, hours, start_time, description, rate_snapshot,
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
    rate_snapshot:  r.rate_snapshot != null ? Number(r.rate_snapshot) : null,
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
    .select('equipe_id, profile_id')
    .eq('id', memberId)
    .single()

  const equipeId = memberRow?.equipe_id ?? null
  const profileId = memberRow?.profile_id ?? null

  let q = supabase
    .from('chantier_plannings')
    .select(`
      id, chantier_id, planned_date, start_time, end_time, label, notes,
      route_id, route_order, duration_min, travel_from_prev_min,
      chantiers!inner ( title, city, address_line1, postal_code )
    `)
    .order('planned_date', { ascending: true })
    .order('route_order', { ascending: true, nullsFirst: false })

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

  const maintenanceFilters = [
    `intervenant_member_id.eq.${memberId}`,
    `intervenant_id.eq.${memberId}`,
    profileId ? `intervenant_user_id.eq.${profileId}` : null,
  ].filter(Boolean).join(',')

  const { data: maintenanceRows, error: maintenanceError } = await supabase
    .from('maintenance_interventions')
    .select(`
      id, date_intervention, start_time, end_time, duration_hours, rapport, observations,
      contract:maintenance_contracts!inner(
        title,
        chantier:chantiers!maintenance_contracts_chantier_id_fkey(id, title, address_line1, postal_code, city)
      )
    `)
    .or(maintenanceFilters)
    .in('statut', ['planifiée', 'réalisée'])
    .gte('date_intervention', opts?.dateFrom ?? new Date().toISOString().slice(0, 10))
    .lte('date_intervention', opts?.dateTo ?? '9999-12-31')
    .order('date_intervention', { ascending: true })

  if (maintenanceError) {
    console.error('[getMemberPlannings maintenance]', maintenanceError)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chantierPlannings = (data ?? []).map((r: any) => ({
    id:             r.id,
    chantier_id:    r.chantier_id,
    chantier_title: r.chantiers?.title ?? '',
    chantier_city:  r.chantiers?.city ?? null,
    chantier_address_line1: r.chantiers?.address_line1 ?? null,
    chantier_postal_code: r.chantiers?.postal_code ?? null,
    planned_date:   r.planned_date,
    start_time:     r.start_time,
    end_time:       r.end_time,
    label:          r.label,
    notes:          r.notes,
    route_id:       r.route_id ?? null,
    route_order:    r.route_order ?? null,
    duration_min:   r.duration_min ?? null,
    travel_from_prev_min: r.travel_from_prev_min ?? null,
  })) as MemberPlanning[]

  const maintenancePlannings = (maintenanceRows ?? []).map((r: any) => {
    const contract = Array.isArray(r.contract) ? r.contract[0] : r.contract
    const chantier = Array.isArray(contract?.chantier) ? contract.chantier[0] : contract?.chantier
    return {
      id:             `maintenance:${r.id}`,
      chantier_id:    chantier?.id ?? '',
      chantier_title: contract?.title ? `Entretien - ${contract.title}` : 'Entretien',
      chantier_city:  chantier?.city ?? null,
      chantier_address_line1: chantier?.address_line1 ?? null,
      chantier_postal_code: chantier?.postal_code ?? null,
      planned_date:   r.date_intervention,
      start_time:     r.start_time ?? null,
      end_time:       r.end_time ?? null,
      label:          'Intervention entretien',
      notes:          r.rapport ?? r.observations ?? null,
      route_id:       null,
      route_order:    null,
      duration_min:   r.duration_hours ? Math.round(Number(r.duration_hours) * 60) : null,
      travel_from_prev_min: null,
    }
  }) as MemberPlanning[]

  return [...chantierPlannings, ...maintenancePlannings]
    .sort((a, b) => `${a.planned_date} ${a.start_time ?? '99:99'}`.localeCompare(`${b.planned_date} ${b.start_time ?? '99:99'}`))
}

/** Tâches assignées au membre, directement ou via son équipe. */
export async function getMemberTasks(
  memberId: string,
  opts?: { useAdmin?: boolean },
): Promise<MemberTask[]> {
  const supabase = opts?.useAdmin ? createAdminClient() : await createClient()
  const today = new Date().toISOString().slice(0, 10)

  const { data: memberRow } = await supabase
    .from('chantier_equipe_membres')
    .select('id, organization_id, equipe_id, profile_id')
    .eq('id', memberId)
    .maybeSingle()

  if (!memberRow) return []

  const filters = [
    `member_id.eq.${memberId}`,
    memberRow.equipe_id ? `equipe_id.eq.${memberRow.equipe_id}` : null,
  ].filter(Boolean).join(',')

  const { data: assignmentRows } = await supabase
    .from('chantier_task_assignments')
    .select('tache_id')
    .or(filters)

  const assignedTaskIds = [...new Set((assignmentRows ?? []).map((row: any) => row.tache_id).filter(Boolean))]

  const taskRows: any[] = []
  if (assignedTaskIds.length > 0) {
    const { data } = await supabase
      .from('chantier_taches')
      .select(`
        id, chantier_id, title, status, due_date,
        chantier:chantiers!inner(id, title, organization_id, is_archived, status)
      `)
      .eq('chantier.organization_id', memberRow.organization_id)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .neq('status', 'termine')
      .in('id', assignedTaskIds)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(30)
    taskRows.push(...(data ?? []))
  }

  if (memberRow.profile_id) {
    const { data } = await supabase
      .from('chantier_taches')
      .select(`
        id, chantier_id, title, status, due_date,
        chantier:chantiers!inner(id, title, organization_id, is_archived, status)
      `)
      .eq('chantier.organization_id', memberRow.organization_id)
      .eq('chantier.is_archived', false)
      .not('chantier.status', 'in', '("termine","annule")')
      .neq('status', 'termine')
      .eq('assigned_to', memberRow.profile_id)
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(30)
    taskRows.push(...(data ?? []))
  }

  return Array.from(new Map(taskRows.map((task: any) => [task.id, task])).values()).map((task: any) => ({
    id: task.id,
    chantier_id: task.chantier_id,
    chantier_title: task.chantier?.title ?? '',
    title: task.title,
    status: task.status,
    due_date: task.due_date ?? null,
    is_overdue: Boolean(task.due_date && task.due_date < today && task.status !== 'termine'),
  }))
}

/** Lookup admin (sans RLS) - utilisé par /mon-espace côté serveur. */
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
