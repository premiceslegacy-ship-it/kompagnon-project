import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'

/**
 * Retourne l'utilisateur Supabase Auth pour le render courant.
 * Dédupliqué via React cache() — un seul appel réseau par render, peu importe
 * combien de Server Components l'importent.
 */
export const getCachedUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

/**
 * Retourne l'organization_id de l'utilisateur connecté pour le render courant.
 * Dédupliqué via React cache().
 */
export const getCachedOrganizationId = cache(async (): Promise<string | null> => {
  const user = await getCachedUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase
    .from('memberships')
    .select('organization_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .single()

  return data?.organization_id ?? null
})
