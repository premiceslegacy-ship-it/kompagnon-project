import { createClient } from '@/lib/supabase/server'

export type OrgRole = {
  id: string
  name: string
  slug: string
  position: number
}

/**
 * Récupère le code d'invitation de l'organisation courante.
 */
export async function getOrgJoinCode(): Promise<string | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return null

  const { data } = await supabase
    .from('organizations')
    .select('join_code')
    .eq('id', membership.organization_id)
    .single()

  return data?.join_code ?? null
}

/**
 * Récupère les rôles de l'organisation courante (hors Owner).
 * Utilisé pour le dropdown de sélection de rôle lors des invitations.
 */
export async function getOrgRoles(): Promise<OrgRole[]> {
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
    .from('roles')
    .select('id, name, slug, position')
    .eq('organization_id', membership.organization_id)
    .gt('position', 0) // exclure Owner (position 0)
    .order('position', { ascending: true })

  if (error) {
    console.error('[getOrgRoles]', error)
    return []
  }

  return (data ?? []) as OrgRole[]
}
