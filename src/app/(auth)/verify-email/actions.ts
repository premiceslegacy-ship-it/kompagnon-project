'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'signup' })

  if (error) {
    return { error: 'Code invalide ou expiré. Vérifiez le code ou recommencez l\'inscription.' }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}
