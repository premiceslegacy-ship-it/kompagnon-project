import { createClient } from '@/lib/supabase/server'
import { cache } from 'react'

export type CurrentMembershipContext = {
  userId: string
  membershipId: string
  email: string | null
  organizationId: string
  roleSlug: string | null
  roleName: string | null
}

export const getCurrentMembershipContext = cache(async function getCurrentMembershipContext(): Promise<CurrentMembershipContext | null> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data, error } = await supabase
    .from('memberships')
    .select('id, organization_id, roles(name, slug)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (error || !data?.organization_id) return null

  const role = Array.isArray(data.roles) ? data.roles[0] : data.roles

  return {
    userId: user.id,
    membershipId: data.id,
    email: user.email ?? null,
    organizationId: data.organization_id,
    roleSlug: role?.slug ?? null,
    roleName: role?.name ?? null,
  }
})

/**
 * Charge l'ensemble des permissions actives de l'utilisateur courant.
 * Mis en cache par requête React (cache()) pour éviter les appels répétés.
 * L'owner a toujours toutes les permissions sans vérification DB.
 */
export const getUserPermissions = cache(async function getUserPermissions(): Promise<Set<string>> {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new Set()

  const { data: membership } = await supabase
    .from('memberships')
    .select('organization_id, roles ( slug, id )')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  if (!membership) return new Set()

  const role = Array.isArray(membership.roles) ? membership.roles[0] : membership.roles as any
  if (!role) return new Set()

  // L'owner a tout sans requête supplémentaire
  if (role.slug === 'owner') return new Set(['*'])

  const { data: rolePerms } = await supabase
    .from('role_permissions')
    .select('permission_key, is_allowed')
    .eq('role_id', role.id)
    .eq('is_allowed', true)

  return new Set((rolePerms ?? []).map((rp: any) => rp.permission_key))
})

/**
 * Vérifie si l'utilisateur courant a une permission donnée.
 * À utiliser dans les Server Actions pour bloquer les opérations non autorisées.
 */
export async function hasPermission(key: string): Promise<boolean> {
  const perms = await getUserPermissions()
  return perms.has('*') || perms.has(key)
}

/**
 * Variante stricte pour les Server Actions : retourne un message d'erreur
 * standard si la permission manque.
 */
export async function requirePermission(key: string): Promise<string | null> {
  return await hasPermission(key) ? null : 'Action non autorisée.'
}

/**
 * Les taux horaires sont des données de coût interne.
 * Ils restent réservés aux owners/admins, indépendamment des permissions chantier.
 */
export async function canManageLaborRates(): Promise<boolean> {
  const membership = await getCurrentMembershipContext()
  return membership?.roleSlug === 'owner' || membership?.roleSlug === 'admin'
}

/**
 * Vérifie si l'utilisateur peut utiliser les assistants IA (Sarah, Chloé, Marco, Nora, Léa).
 * Par défaut : owner uniquement. L'owner peut accorder ai.sarah à un second membre (admin/secrétaire).
 * Maximum 2 personnes par organisation — contrôle géré par la permission ai.sarah.
 */
export async function canUseAI(): Promise<boolean> {
  return hasPermission('ai.sarah')
}
