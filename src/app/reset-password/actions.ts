'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'

export type ResetPasswordState = {
  error: string | null
}

/**
 * Enregistre le nouveau mot de passe après réinitialisation.
 * L'utilisateur est déjà authentifié via la session créée par /auth/callback.
 */
export async function resetPassword(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const password = (formData.get('password') as string)?.trim()
  const confirm = (formData.get('confirm') as string)?.trim()

  if (!password || password.length < 8) {
    return { error: 'Le mot de passe doit contenir au moins 8 caractères.' }
  }
  if (password !== confirm) {
    return { error: 'Les mots de passe ne correspondent pas.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.updateUser({ password })

  if (error) {
    console.error('[resetPassword]', error.message)
    return { error: 'Impossible de mettre à jour le mot de passe. Le lien a peut-être expiré.' }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
