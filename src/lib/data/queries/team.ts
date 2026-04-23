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
}

/**
 * Récupère tous les membres actifs de l'organisation courante.
 */
export async function getTeamMembers(): Promise<TeamMember[]> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return []

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return []

  const { data, error } = await supabase
    .from('memberships')
    .select(`
      id,
      user_id,
      is_active,
      accepted_at,
      roles ( id, name, slug ),
      profiles ( full_name, email, job_title )
    `)
    .eq('organization_id', membership.organization_id)
    .eq('is_active', true)
    .order('accepted_at', { ascending: true })

  if (error) {
    console.error('[getTeamMembers]', error)
    return []
  }

  return (data ?? []).map((row: any) => ({
    membership_id: row.id,
    user_id: row.user_id,
    full_name: row.profiles?.full_name ?? null,
    email: row.profiles?.email ?? '',
    job_title: row.profiles?.job_title ?? null,
    role_id: row.roles?.id ?? '',
    role_name: row.roles?.name ?? '',
    role_slug: row.roles?.slug ?? '',
    is_active: row.is_active,
    joined_at: row.accepted_at ?? null,
  }))
}
