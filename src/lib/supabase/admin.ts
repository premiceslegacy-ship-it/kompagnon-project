import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseRuntimeConfig } from './config'

declare global {
  // eslint-disable-next-line no-var
  var __supabaseAdmin: SupabaseClient | undefined
}

/**
 * Client Supabase avec le service role key — contourne le RLS.
 * À utiliser UNIQUEMENT dans les Server Actions / Route Handlers côté serveur.
 * Ne jamais exposer côté client.
 *
 * Singleton via globalThis pour éviter la saturation du pool Postgres en charge.
 */
export function createAdminClient(): SupabaseClient {
  if (globalThis.__supabaseAdmin) return globalThis.__supabaseAdmin

  const { supabaseUrl } = getSupabaseRuntimeConfig()

  globalThis.__supabaseAdmin = createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )

  return globalThis.__supabaseAdmin
}
