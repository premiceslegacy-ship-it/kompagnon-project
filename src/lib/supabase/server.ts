import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseRuntimeConfig } from './config'

export async function createClient() {
  const cookieStore = await cookies()
  const { supabaseUrl, supabaseAnonKey } = getSupabaseRuntimeConfig()

  return createServerClient(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Appelé depuis un Server Component — ignoré car le middleware
            // gère le rafraîchissement de session.
          }
        },
      },
    }
  )
}
