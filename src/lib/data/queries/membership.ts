import { createClient } from '@/lib/supabase/server'

export type CurrentMembershipContext = {
  userId: string
  email: string | null
  organizationId: string
  roleSlug: string | null
  roleName: string | null
}

export async function getCurrentMembershipContext(): Promise<CurrentMembershipContext | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data, error } = await supabase
    .from('memberships')
    .select('organization_id, roles(name, slug)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (error || !data?.organization_id) return null

  const role = Array.isArray(data.roles) ? data.roles[0] : data.roles

  return {
    userId: user.id,
    email: user.email ?? null,
    organizationId: data.organization_id,
    roleSlug: role?.slug ?? null,
    roleName: role?.name ?? null,
  }
}
