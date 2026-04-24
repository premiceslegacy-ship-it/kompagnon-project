import { createClient } from '@supabase/supabase-js'
import { getSupabaseRuntimeConfig } from './config'

/**
 * Client Supabase avec le service role key — contourne le RLS.
 * À utiliser UNIQUEMENT dans les Server Actions / Route Handlers côté serveur.
 * Ne jamais exposer côté client.
 */
export function createAdminClient() {
  const { supabaseUrl } = getSupabaseRuntimeConfig()

  return createClient(
    supabaseUrl,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
