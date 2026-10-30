'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'

export type VerifyEmailState = { error: string | null }

/**
 * Vérifie le code OTP de confirmation d'email après inscription.
 * Supabase crée la session et confirme l'email de l'utilisateur.
 */
export async function verifyEmailOtp(
  _prevState: VerifyEmailState,
  formData: FormData
): Promise<VerifyEmailState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const token = (formData.get('token') as string)?.trim()

  if (!email || !token) {
    return { error: 'Veuillez saisir le code reçu par email.' }
  }

  // Un OTP à 6 chiffres est devinable si rien ne borne les essais.
  const limit = await checkRateLimit({ scope: 'auth:otp-verify', identifier: email, limit: 5, windowSeconds: 15 * 60 })
  if (!limit.allowed) {
    return { error: 'Trop de codes essayés. Demandez un nouveau code.' }
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })

  if (error) {
    return { error: 'Code invalide ou expiré. Vérifiez le code ou recommencez l\'inscription.' }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
