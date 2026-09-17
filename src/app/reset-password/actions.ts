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
    console.error('[resetPassword]', error.status, error.message)

    if (error.message.toLowerCase().includes('different from the old password')) {
      return { error: 'Ce mot de passe est identique à l\'ancien. Choisissez-en un différent.' }
    }
    if (error.status === 504 || error.status === 500 || error.message.toLowerCase().includes('deadline') || error.message.toLowerCase().includes('context canceled')) {
      return { error: 'Le service est momentanément indisponible. Réessayez dans quelques instants.' }
    }
    if (error.status === 401 || error.status === 403) {
      return { error: 'Le lien a expiré. Demandez un nouveau lien de réinitialisation.' }
    }
    return { error: 'Impossible de mettre à jour le mot de passe. Réessayez ou redemandez un lien.' }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
