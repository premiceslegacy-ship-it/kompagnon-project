import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCachedUser } from './session-cache'

export type UserProfile = {
  id: string
  full_name: string | null
  email: string | null
  avatar_url: string | null
  onboarding_done: boolean
}

export const getCurrentUserProfile = cache(async (): Promise<UserProfile | null> => {
  const user = await getCachedUser()
  if (!user) return null

  const supabase = await createClient()
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
})
