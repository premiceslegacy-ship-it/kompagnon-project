'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

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

  // Même borne que la confirmation d'inscription : un OTP de 6 chiffres doit
  // être limité en essais, sinon il est devinable dans son heure de validité.
  const limit = await checkRateLimit({ scope: 'auth:otp-verify', identifier: email, limit: 5, windowSeconds: 15 * 60 })
  if (!limit.allowed) {
    return { error: 'Trop de codes essayés. Demandez un nouveau code.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'recovery' })

  if (error) {
    return { error: 'Code invalide ou expiré. Demandez un nouveau lien de réinitialisation.' }
  }

  // Session créée → rediriger vers la page de saisie du nouveau mot de passe
  revalidatePath('/', 'layout')
  redirect('/reset-password')
}
