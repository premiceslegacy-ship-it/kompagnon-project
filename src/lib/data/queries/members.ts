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
  pointage_id: string | null
}

export type MemberAccessibleChantier = {
  id: string
  title: string
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
      chantiers!inner ( title, city, address_line1, postal_code, recurrence_notes )
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

  const planningIds = (data ?? []).map((r: any) => r.id).filter(Boolean)
  const maintenanceIds = (maintenanceRows ?? []).map((r: any) => r.id).filter(Boolean)

  const pointageOwnerFilter = profileId ? `member_id.eq.${memberId},user_id.eq.${profileId}` : `member_id.eq.${memberId}`
  const [{ data: planningPointages }, { data: maintenancePointages }] = await Promise.all([
    planningIds.length > 0
      ? supabase
          .from('chantier_pointages')
          .select('id, chantier_planning_id')
          .or(pointageOwnerFilter)
          .in('chantier_planning_id', planningIds)
      : Promise.resolve({ data: [] as any[] }),
    maintenanceIds.length > 0
      ? supabase
          .from('chantier_pointages')
          .select('id, maintenance_intervention_id')
          .or(pointageOwnerFilter)
          .in('maintenance_intervention_id', maintenanceIds)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const pointageByPlanningId = new Map((planningPointages ?? []).map((p: any) => [p.chantier_planning_id, p.id]))
  const pointageByMaintenanceId = new Map((maintenancePointages ?? []).map((p: any) => [p.maintenance_intervention_id, p.id]))

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
    notes:          r.notes ?? r.chantiers?.recurrence_notes ?? null,
    route_id:       r.route_id ?? null,
    route_order:    r.route_order ?? null,
    duration_min:   r.duration_min ?? null,
    travel_from_prev_min: r.travel_from_prev_min ?? null,
    pointage_id:    pointageByPlanningId.get(r.id) ?? null,
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
      pointage_id:    pointageByMaintenanceId.get(r.id) ?? null,
    }
  }) as MemberPlanning[]

  return [...chantierPlannings, ...maintenancePlannings]
    .sort((a, b) => `${a.planned_date} ${a.start_time ?? '99:99'}`.localeCompare(`${b.planned_date} ${b.start_time ?? '99:99'}`))
}

/** Chantiers qu'un membre peut voir/pointer depuis /mon-espace. */
export async function getMemberAccessibleChantiers(
  memberId: string,
  organizationId: string,
): Promise<MemberAccessibleChantier[]> {
  const admin = createAdminClient()
  const { data: member } = await admin
    .from('chantier_equipe_membres')
    .select('id, organization_id, equipe_id, profile_id')
    .eq('id', memberId)
    .eq('organization_id', organizationId)
    .maybeSingle()

  if (!member) return []

  const ids = new Set<string>()

  const directPromise = admin
    .from('chantier_individual_members')
    .select('chantier_id, chantier:chantiers!inner(id, organization_id, status, is_archived)')
    .eq('member_id', memberId)
    .eq('chantier.organization_id', organizationId)
    .eq('chantier.is_archived', false)
    .in('chantier.status', ['en_cours', 'planifie', 'suspendu'])

  const teamPromise = member.equipe_id
    ? admin
        .from('chantier_equipe_chantiers')
        .select('chantier_id, chantier:chantiers!inner(id, organization_id, status, is_archived)')
        .eq('equipe_id', member.equipe_id)
        .eq('chantier.organization_id', organizationId)
        .eq('chantier.is_archived', false)
        .in('chantier.status', ['en_cours', 'planifie', 'suspendu'])
    : Promise.resolve({ data: [] as any[] })

  const planningFilters = [
    `member_id.eq.${memberId}`,
    member.equipe_id ? `equipe_id.eq.${member.equipe_id}` : null,
  ].filter(Boolean).join(',')

  const planningPromise = planningFilters
    ? admin
        .from('chantier_plannings')
        .select('chantier_id, chantier:chantiers!inner(id, organization_id, status, is_archived)')
        .or(planningFilters)
        .eq('chantier.organization_id', organizationId)
        .eq('chantier.is_archived', false)
        .in('chantier.status', ['en_cours', 'planifie', 'suspendu'])
    : Promise.resolve({ data: [] as any[] })

  const maintenanceFilters = [
    `intervenant_member_id.eq.${memberId}`,
    `intervenant_id.eq.${memberId}`,
    member.profile_id ? `intervenant_user_id.eq.${member.profile_id}` : null,
  ].filter(Boolean).join(',')

  const maintenancePromise = maintenanceFilters
    ? admin
        .from('maintenance_interventions')
        .select('contract:maintenance_contracts!inner(chantier_id, organization_id, chantier:chantiers!maintenance_contracts_chantier_id_fkey(id, organization_id, status, is_archived))')
        .or(maintenanceFilters)
        .eq('organization_id', organizationId)
    : Promise.resolve({ data: [] as any[] })

  const [directRows, teamRows, planningRows, maintenanceRows] = await Promise.all([
    directPromise,
    teamPromise,
    planningPromise,
    maintenancePromise,
  ])

  for (const row of directRows.data ?? []) if ((row as any).chantier_id) ids.add((row as any).chantier_id)
  for (const row of teamRows.data ?? []) if ((row as any).chantier_id) ids.add((row as any).chantier_id)
  for (const row of planningRows.data ?? []) if ((row as any).chantier_id) ids.add((row as any).chantier_id)
  for (const row of maintenanceRows.data ?? []) {
    const contract = Array.isArray((row as any).contract) ? (row as any).contract[0] : (row as any).contract
    const chantier = Array.isArray(contract?.chantier) ? contract.chantier[0] : contract?.chantier
    if (
      contract?.chantier_id &&
      chantier?.organization_id === organizationId &&
      chantier?.is_archived === false &&
      ['en_cours', 'planifie', 'suspendu'].includes(chantier?.status)
    ) {
      ids.add(contract.chantier_id)
    }
  }

  if (ids.size === 0) return []

  const { data: chantiers } = await admin
    .from('chantiers')
    .select('id, title')
    .eq('organization_id', organizationId)
    .in('id', [...ids])
    .order('title', { ascending: true })

  return (chantiers ?? []) as MemberAccessibleChantier[]
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
