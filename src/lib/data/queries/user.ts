import { createClient } from '@/lib/supabase/server'

export type UserProfile = {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  onboarding_done: boolean
}

/**
 * Récupère le profil de l'utilisateur connecté.
 * Combine auth.users (email) et la table profiles (full_name, avatar_url, onboarding_done).
 * À appeler uniquement dans les Server Components, Server Actions ou Route Handlers.
 */
export async function getCurrentUserProfile(): Promise<UserProfile | null> {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, onboarding_done')
    .eq('id', user.id)
    .single()

  const profile = data as {
    full_name: string | null
    avatar_url: string | null
    onboarding_done: boolean | null
  } | null

  return {
    id: user.id,
    full_name: profile?.full_name ?? null,
    email: user.email ?? null,
    avatar_url: profile?.avatar_url ?? null,
    onboarding_done: profile?.onboarding_done ?? false,
  }
}
