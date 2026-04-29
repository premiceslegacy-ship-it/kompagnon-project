'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'

/**
 * Sauvegarde les permissions d'un rôle.
 * Utilise le client admin pour contourner la RLS (qui exige settings.edit_roles
 * via user_has_permission — non fiable avec le client standard).
 * La vérification d'autorisation est faite manuellement avant.
 */
export async function saveRolePermissions(
  roleId: string,
  permissions: Record<string, boolean>
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const admin = createAdminClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié' }

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié' }

  // Vérifier que l'appelant est owner ou admin
  const { data: callerMembership } = await supabase
    .from('memberships')
    .select('roles ( slug )')
    .eq('user_id', user.id)
    .eq('organization_id', orgId)
    .eq('is_active', true)
    .single()

  const callerSlug = (callerMembership as any)?.roles?.slug ?? ''
  if (!['owner', 'admin'].includes(callerSlug)) {
    return { error: 'Action réservée aux administrateurs.' }
  }

  // Vérifier que le rôle appartient à cette org et n'est pas owner
  const { data: role, error: roleErr } = await admin
    .from('roles')
    .select('id, slug')
    .eq('id', roleId)
    .eq('organization_id', orgId)
    .single()

  if (roleErr || !role) return { error: 'Rôle introuvable' }
  if (role.slug === 'owner') return { error: 'Les permissions du dirigeant ne peuvent pas être modifiées' }

  // DELETE via admin (contourne la RLS)
  const { error: delErr } = await admin
    .from('role_permissions')
    .delete()
    .eq('role_id', roleId)

  if (delErr) return { error: delErr.message }

  // INSERT uniquement les permissions activées
  const entries = Object.entries(permissions).filter(([, v]) => v)
  if (entries.length > 0) {
    const { error: insErr } = await admin
      .from('role_permissions')
      .insert(entries.map(([key]) => ({
        role_id: roleId,
        permission_key: key,
        is_allowed: true,
      })))

    if (insErr) return { error: insErr.message }
  }

  revalidatePath('/settings')
  return { error: null }
}
