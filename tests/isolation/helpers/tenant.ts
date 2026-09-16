// Helper d'auth pour les tests d'isolation cross-tenant, dérivé du pattern
// de connexion de scripts/sarah-e2e.mts (fabrication manuelle du cookie SSR
// Supabase). Ici on récupère directement le token d'accès plutôt qu'un cookie
// HTTP, car les tests appellent Supabase (anon client) et les routes Next en
// jeu de test, pas uniquement des routes serveur via fetch.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error(
    'SUPABASE_ANON_KEY et SUPABASE_SERVICE_ROLE_KEY requis. ' +
      'Lancer `supabase start` en local et copier les clés affichées, ' +
      'ou fournir SUPABASE_URL/SUPABASE_ANON_KEY/SUPABASE_SERVICE_ROLE_KEY en env.',
  )
}

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}

export type TenantSession = {
  orgId: string
  userId: string
  email: string
  /** Client Supabase authentifié "en tant que" ce user — passe par PostgREST + RLS, jamais service_role. */
  client: SupabaseClient
  accessToken: string
}

/**
 * Authentifie un utilisateur de test avec le client ANON (celui distribué au
 * navigateur) — c'est la seule façon de vérifier que RLS bloque réellement un
 * accès cross-tenant. Un test qui utiliserait le client admin ne prouverait
 * rien : service_role bypass systématiquement la RLS.
 */
export async function signInAsTenant(email: string, password: string): Promise<TenantSession> {
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error || !data.session || !data.user) {
    throw new Error(`Login test échoué pour ${email}: ${error?.message}`)
  }

  const admin = adminClient()
  const { data: membership, error: membershipError } = await admin
    .from('memberships')
    .select('organization_id')
    .eq('user_id', data.user.id)
    .eq('is_active', true)
    .single()
  if (membershipError || !membership) {
    throw new Error(`Aucune organisation active trouvée pour ${email}: ${membershipError?.message}`)
  }

  return {
    orgId: membership.organization_id,
    userId: data.user.id,
    email,
    client: anon,
    accessToken: data.session.access_token,
  }
}
