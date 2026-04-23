import { createClient } from '@supabase/supabase-js'

/**
 * Client Supabase avec le service role key — contourne le RLS.
 * À utiliser UNIQUEMENT dans les Server Actions / Route Handlers côté serveur.
 * Ne jamais exposer côté client.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
