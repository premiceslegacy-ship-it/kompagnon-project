import { createClient } from '@/lib/supabase/server'

export type OrgRole = {
  id: string
  name: string
  slug: string
  position: number
}

export type Permission = {
  key: string
  label: string
  category: string
  position: number
}

export type RoleWithPermissions = OrgRole & {
  color: string | null
  description: string | null
  is_system: boolean
  permissions: Record<string, boolean>
}

export type AllPermissionsData = {
  roles: RoleWithPermissions[]
  allPermissions: Permission[]
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

/**
 * Récupère tous les rôles de l'orga (y compris owner) avec leurs permissions,
 * ainsi que la liste complète des permissions disponibles.
 * Utilisé pour l'interface de gestion des rôles dans les Settings.
 */
export async function getRolesWithPermissions(): Promise<AllPermissionsData> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { roles: [], allPermissions: [] }

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership?.organization_id) return { roles: [], allPermissions: [] }

  const [rolesRes, permsRes, rolePermsRes] = await Promise.all([
    supabase
      .from('roles')
      .select('id, name, slug, position, color, description, is_system')
      .eq('organization_id', membership.organization_id)
      .order('position', { ascending: true }),
    supabase
      .from('permissions')
      .select('key, label, category, position')
      .order('category', { ascending: true })
      .order('position', { ascending: true }),
    supabase
      .from('role_permissions')
      .select('role_id, permission_key, is_allowed')
      .in(
        'role_id',
        // on fait une sous-requête côté JS après avoir les IDs
        []
      ),
  ])

  const roles: RoleWithPermissions[] = []
  const allPermissions: Permission[] = (permsRes.data ?? []) as Permission[]

  if (!rolesRes.data) return { roles, allPermissions }

  // Récupérer les permissions pour tous les rôles de l'org en une seule requête
  const roleIds = rolesRes.data.map((r: any) => r.id)
  const { data: rolePermsData } = await supabase
    .from('role_permissions')
    .select('role_id, permission_key, is_allowed')
    .in('role_id', roleIds)

  // Indexer les permissions par role_id
  const permByRole: Record<string, Record<string, boolean>> = {}
  for (const rp of rolePermsData ?? []) {
    if (!permByRole[rp.role_id]) permByRole[rp.role_id] = {}
    permByRole[rp.role_id][rp.permission_key] = rp.is_allowed
  }

  for (const r of rolesRes.data) {
    roles.push({
      id: r.id,
      name: r.name,
      slug: r.slug,
      position: r.position,
      color: r.color ?? null,
      description: r.description ?? null,
      is_system: r.is_system ?? false,
      permissions: permByRole[r.id] ?? {},
    })
  }

  return { roles, allPermissions }
}
