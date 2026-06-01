import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { cache } from 'react'

export type MemberGoal = {
  id: string
  /** Intervenant terrain — null si c'est un membre org */
  member_id: string | null
  /** Membre org avec compte app — null si c'est un intervenant */
  membership_id: string | null
  period_year: number
  period_month: number
  metric: string
  label: string | null
  target: number
  unit: string | null
  note: string | null
}

export type MemberGoalWithProgress = MemberGoal & {
  current: number
  percent: number
}

/**
 * Objectifs du mois pour un membre, avec progression.
 * Accepte memberId et/ou membershipId — les deux peuvent être fournis simultanément
 * (un collaborateur peut avoir une fiche intervenant ET un compte org).
 * La query fait un OR sur les deux colonnes pour récupérer tous les objectifs qui le concernent.
 */
export const getMemberGoalsWithProgress = cache(async (params: {
  memberId?: string
  membershipId?: string
  userId?: string
  year: number
  month: number
}): Promise<MemberGoalWithProgress[]> => {
  const { memberId, membershipId, userId, year, month } = params
  if (!memberId && !membershipId) return []

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  // Construit le filtre OR : member_id = X ou membership_id = Y (ou les deux)
  const orClauses: string[] = []
  if (memberId) orClauses.push(`member_id.eq.${memberId}`)
  if (membershipId) orClauses.push(`membership_id.eq.${membershipId}`)

  const { data: goals } = await supabase
    .from('member_goals')
    .select('id, member_id, membership_id, period_year, period_month, metric, label, target, unit, note')
    .eq('organization_id', orgId)
    .eq('period_year', year)
    .eq('period_month', month)
    .or(orClauses.join(','))
  if (!goals?.length) return []

  const firstOfMonth = `${year}-${String(month).padStart(2, '0')}-01`
  const firstOfNext = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const { data: memberRow } = memberId
    ? await supabase
        .from('chantier_equipe_membres')
        .select('equipe_id, profile_id')
        .eq('id', memberId)
        .maybeSingle()
    : { data: null as { equipe_id: string | null; profile_id: string | null } | null }

  const authUserId = userId ?? memberRow?.profile_id ?? null
  const assignmentFilters = [
    memberId ? `member_id.eq.${memberId}` : null,
    memberRow?.equipe_id ? `equipe_id.eq.${memberRow.equipe_id}` : null,
  ].filter(Boolean).join(',')

  const { data: assignmentRows } = assignmentFilters
    ? await supabase
        .from('chantier_task_assignments')
        .select('tache_id')
        .or(assignmentFilters)
    : { data: [] as any[] }

  const assignedTaskIds = [...new Set((assignmentRows ?? []).map((row: any) => row.tache_id).filter(Boolean))]

  // La progression se calcule différemment selon le type de membre
  const [{ data: pointagesByMember }, { data: pointagesByUser }, { data: tasksByAssignment }, { data: tasksByUser }, { data: chantierWork }] = await Promise.all([
    // Heures pointées — par member_id (intervenant)
    memberId
      ? supabase.from('chantier_pointages').select('hours, chantier_id').eq('member_id', memberId).gte('date', firstOfMonth).lt('date', firstOfNext)
      : Promise.resolve({ data: [] as any[] }),

    // Heures pointées — par user_id (membre org via compte auth)
    authUserId
      ? supabase.from('chantier_pointages').select('hours, chantier_id').eq('user_id', authUserId).gte('date', firstOfMonth).lt('date', firstOfNext)
      : Promise.resolve({ data: [] as any[] }),

    // Tâches complétées — nouvelles assignations multiples
    assignedTaskIds.length > 0
      ? supabase
          .from('chantier_taches')
          .select('id, completed_at, updated_at, chantier:chantiers!inner(organization_id)')
          .eq('chantier.organization_id', orgId)
          .eq('status', 'termine')
          .in('id', assignedTaskIds)
      : Promise.resolve({ data: [] as any[] }),

    // Tâches complétées — ancienne colonne assigned_to = auth user id
    authUserId
      ? supabase
          .from('chantier_taches')
          .select('id, completed_at, updated_at, chantier:chantiers!inner(organization_id)')
          .eq('chantier.organization_id', orgId)
          .eq('assigned_to', authUserId)
          .eq('status', 'termine')
      : Promise.resolve({ data: [] as any[] }),

    // Chantiers distincts — via pointages
    memberId
      ? supabase.from('chantier_pointages').select('chantier_id').eq('member_id', memberId).gte('date', firstOfMonth).lt('date', firstOfNext)
      : authUserId
        ? supabase.from('chantier_pointages').select('chantier_id').eq('user_id', authUserId).gte('date', firstOfMonth).lt('date', firstOfNext)
        : Promise.resolve({ data: [] as any[] }),
  ])

  const allPointages = [...(pointagesByMember ?? []), ...(pointagesByUser ?? [])]
  const heuresTerrain = allPointages.reduce((sum: number, p: any) => sum + (p.hours ?? 0), 0)
  const completedTasks = [...(tasksByAssignment ?? []), ...(tasksByUser ?? [])]
    .filter((task: any) => {
      const completedAt = task.completed_at ?? task.updated_at
      return completedAt >= firstOfMonth && completedAt < firstOfNext
    })
  const tachesCount = new Set(completedTasks.map((task: any) => task.id)).size
  const chantiersCount = new Set([...(chantierWork ?? []).map((p: any) => p.chantier_id)]).size

  const currentByMetric: Record<string, number> = {
    heures_terrain: heuresTerrain,
    taches_completees: tachesCount,
    chantiers_traites: chantiersCount,
    custom: 0,
  }

  return goals.map(g => {
    const current = currentByMetric[g.metric] ?? 0
    const percent = g.target > 0 ? Math.min(100, Math.round((current / g.target) * 100)) : 0
    return { ...g, current, percent }
  })
})

/**
 * Objectifs d'un intervenant avec progression — version admin (sans RLS).
 * Utilisée dans /mon-espace où l'utilisateur n'est pas authentifié via Supabase Auth.
 */
export async function getMemberGoalsWithProgressAdmin(params: {
  memberId: string
  organizationId: string
  year: number
  month: number
}): Promise<MemberGoalWithProgress[]> {
  const { memberId, organizationId, year, month } = params
  const admin = createAdminClient()

  const { data: goals } = await admin
    .from('member_goals')
    .select('id, member_id, membership_id, period_year, period_month, metric, label, target, unit, note')
    .eq('organization_id', organizationId)
    .eq('period_year', year)
    .eq('period_month', month)
    .eq('member_id', memberId)

  if (!goals?.length) return []

  const firstOfMonth = `${year}-${String(month).padStart(2, '0')}-01`
  const firstOfNext = month === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(month + 1).padStart(2, '0')}-01`

  const { data: memberRow } = await admin
    .from('chantier_equipe_membres')
    .select('equipe_id, profile_id')
    .eq('id', memberId)
    .maybeSingle()

  const assignmentFilters = [
    `member_id.eq.${memberId}`,
    memberRow?.equipe_id ? `equipe_id.eq.${memberRow.equipe_id}` : null,
  ].filter(Boolean).join(',')

  const { data: assignmentRows } = await admin
    .from('chantier_task_assignments')
    .select('tache_id')
    .or(assignmentFilters)

  const assignedTaskIds = [...new Set((assignmentRows ?? []).map((row: any) => row.tache_id).filter(Boolean))]

  const [{ data: pointages }, { data: chantierWork }, { data: tasksByAssignment }, { data: tasksByProfile }] = await Promise.all([
    admin.from('chantier_pointages').select('hours, chantier_id').eq('member_id', memberId).gte('date', firstOfMonth).lt('date', firstOfNext),
    admin.from('chantier_pointages').select('chantier_id').eq('member_id', memberId).gte('date', firstOfMonth).lt('date', firstOfNext),
    assignedTaskIds.length > 0
      ? admin
          .from('chantier_taches')
          .select('id, completed_at, updated_at, chantier:chantiers!inner(organization_id)')
          .eq('chantier.organization_id', organizationId)
          .eq('status', 'termine')
          .in('id', assignedTaskIds)
      : Promise.resolve({ data: [] as any[] }),
    memberRow?.profile_id
      ? admin
          .from('chantier_taches')
          .select('id, completed_at, updated_at, chantier:chantiers!inner(organization_id)')
          .eq('chantier.organization_id', organizationId)
          .eq('assigned_to', memberRow.profile_id)
          .eq('status', 'termine')
      : Promise.resolve({ data: [] as any[] }),
  ])

  const heuresTerrain = (pointages ?? []).reduce((sum: number, p: any) => sum + (p.hours ?? 0), 0)
  const chantiersCount = new Set((chantierWork ?? []).map((p: any) => p.chantier_id)).size
  const completedTasks = [...(tasksByAssignment ?? []), ...(tasksByProfile ?? [])]
    .filter((task: any) => {
      const completedAt = task.completed_at ?? task.updated_at
      return completedAt >= firstOfMonth && completedAt < firstOfNext
    })
  const tachesCount = new Set(completedTasks.map((task: any) => task.id)).size

  const currentByMetric: Record<string, number> = {
    heures_terrain: heuresTerrain,
    taches_completees: tachesCount,
    chantiers_traites: chantiersCount,
    custom: 0,
  }

  return goals.map(g => {
    const current = currentByMetric[g.metric] ?? 0
    const percent = g.target > 0 ? Math.min(100, Math.round((current / g.target) * 100)) : 0
    return { ...g, current, percent }
  })
}

/** Objectifs de tous les membres pour un mois — pour l'UI admin. */
export async function getAllMemberGoals(year: number, month: number): Promise<(MemberGoal & {
  display_name: string
  display_sub: string | null
})[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  // 1. Goals + intervenants terrain (FK directe)
  const { data } = await supabase
    .from('member_goals')
    .select(`
      id, member_id, membership_id, period_year, period_month, metric, label, target, unit, note,
      intervenant:chantier_equipe_membres(name, prenom, role_label),
      membership:memberships(id, user_id, roles(name))
    `)
    .eq('organization_id', orgId)
    .eq('period_year', year)
    .eq('period_month', month)
    .order('created_at', { ascending: true })

  if (!data?.length) return []

  // 2. Profils séparément pour les membership_id
  const userIds = (data as any[])
    .map(r => {
      const m = Array.isArray(r.membership) ? r.membership[0] : r.membership
      return m?.user_id ?? null
    })
    .filter(Boolean)

  const profileById: Record<string, string> = {}
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', userIds)
    for (const p of profiles ?? []) {
      profileById[p.id] = p.full_name ?? ''
    }
  }

  return (data as any[]).map(row => {
    let display_name = ''
    let display_sub: string | null = null

    if (row.intervenant) {
      display_name = [row.intervenant.prenom, row.intervenant.name].filter(Boolean).join(' ')
      display_sub = row.intervenant.role_label ?? 'Intervenant'
    } else {
      const membership = Array.isArray(row.membership) ? row.membership[0] : row.membership
      const role = membership ? (Array.isArray(membership.roles) ? membership.roles[0] : membership.roles) : null
      display_name = profileById[membership?.user_id] ?? ''
      display_sub = role?.name ?? null
    }

    return { ...row, display_name, display_sub }
  })
}
