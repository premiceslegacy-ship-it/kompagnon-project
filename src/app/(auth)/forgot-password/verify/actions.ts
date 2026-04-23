'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export type VerifyRecoveryState = { error: string | null }

/**
 * Vérifie le code OTP de réinitialisation de mot de passe.
 * Supabase crée une session temporaire qui permet d'appeler updateUser({ password }).
 */
export async function verifyRecoveryOtp(
  _prevState: VerifyRecoveryState,
  formData: FormData
): Promise<VerifyRecoveryState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const token = (formData.get('token') as string)?.trim()

  if (!email || !token) {
    return { error: 'Veuillez saisir le code reçu par email.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' })

  if (error) {
    return { error: 'Code invalide ou expiré. Demandez un nouveau lien de réinitialisation.' }
  }

  // Session créée → rediriger vers la page de saisie du nouveau mot de passe
  redirect('/reset-password')
}
