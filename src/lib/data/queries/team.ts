import { createClient } from '@/lib/supabase/server'

export type TeamMember = {
  membership_id: string
  user_id: string
  full_name: string | null
  email: string
  job_title: string | null
  role_id: string
  role_name: string
  role_slug: string
  is_active: boolean
  joined_at: string | null
  labor_cost_per_hour?: number | null
}

/**
 * Récupère tous les membres actifs de l'organisation courante.
 *
 * memberships.user_id → auth.users, PAS public.profiles.
 * Supabase ne peut pas résoudre le join profiles(...) automatiquement depuis memberships.
 * On récupère donc les memberships + roles d'abord, puis les profiles séparément via user_id.
 */
export async function getTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: myMembership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!myMembership?.organization_id) return []

  // 1. Memberships + rôles
  const { data: memberships, error } = await supabase
    .from('memberships')
    .select('id, user_id, is_active, accepted_at, labor_cost_per_hour, roles ( id, name, slug )')
    .eq('organization_id', myMembership.organization_id)
    .eq('is_active', true)
    .order('accepted_at', { ascending: true })

  if (error) {
    console.error('[getTeamMembers]', error)
    return []
  }
  if (!memberships?.length) return []

  // 2. Profiles via user_id (relation auth.users → public.profiles par id)
  const userIds = memberships.map((m: any) => m.user_id)
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, email, job_title')
    .in('id', userIds)

  const profileById: Record<string, any> = {}
  for (const p of profiles ?? []) profileById[p.id] = p

  return memberships.map((row: any) => ({
    membership_id: row.id,
    user_id: row.user_id,
    full_name: profileById[row.user_id]?.full_name ?? null,
    email: profileById[row.user_id]?.email ?? '',
    job_title: profileById[row.user_id]?.job_title ?? null,
    role_id: row.roles?.id ?? '',
    role_name: row.roles?.name ?? '',
    role_slug: row.roles?.slug ?? '',
    is_active: row.is_active,
    joined_at: row.accepted_at ?? null,
    labor_cost_per_hour: row.labor_cost_per_hour ?? null,
  }))
}
