import { createClient } from '@/lib/supabase/server'
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
  year: number
  month: number
}): Promise<MemberGoalWithProgress[]> => {
  const { memberId, membershipId, year, month } = params
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

  // La progression se calcule différemment selon le type de membre
  const [{ data: pointagesByMember }, { data: pointagesByUser }, { data: taches }, { data: chantierWork }] = await Promise.all([
    // Heures pointées — par member_id (intervenant)
    memberId
      ? supabase.from('chantier_pointages').select('hours, chantier_id').eq('member_id', memberId).gte('date', firstOfMonth).lt('date', firstOfNext)
      : Promise.resolve({ data: [] as any[] }),

    // Heures pointées — par user_id (membre org via membership)
    membershipId
      ? supabase.from('chantier_pointages').select('hours, chantier_id').eq('user_id', membershipId).gte('date', firstOfMonth).lt('date', firstOfNext)
      : Promise.resolve({ data: [] as any[] }),

    // Tâches complétées (assigned_to = auth user id)
    membershipId
      ? supabase.from('chantier_taches').select('id').eq('assigned_to', membershipId).eq('status', 'termine').gte('updated_at', firstOfMonth).lt('updated_at', firstOfNext)
      : Promise.resolve({ data: [] as any[] }),

    // Chantiers distincts — via pointages
    memberId
      ? supabase.from('chantier_pointages').select('chantier_id').eq('member_id', memberId).gte('date', firstOfMonth).lt('date', firstOfNext)
      : membershipId
        ? supabase.from('chantier_pointages').select('chantier_id').eq('user_id', membershipId).gte('date', firstOfMonth).lt('date', firstOfNext)
        : Promise.resolve({ data: [] as any[] }),
  ])

  const allPointages = [...(pointagesByMember ?? []), ...(pointagesByUser ?? [])]
  const heuresTerrain = allPointages.reduce((sum: number, p: any) => sum + (p.hours ?? 0), 0)
  const tachesCount = taches?.length ?? 0
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
