'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendAuthEmail } from '@/lib/email'
import { buildSignupOtpEmail } from '@/lib/email/templates'
import { APP_SIGNATURE } from '@/lib/brand'

export type AuthState = {
  error: string | null
  message?: string
}

/** Traduit les messages d'erreur Supabase (en anglais) en français. */
function translateAuthError(message: string): string {
  const map: Record<string, string> = {
    'Invalid login credentials': 'Email ou mot de passe incorrect.',
    'Email not confirmed': "Votre email n'a pas encore été confirmé. Vérifiez votre boîte mail.",
    'User already registered': 'Un compte existe déjà avec cet email.',
    'Email already in use': 'Un compte existe déjà avec cet email.',
    'Password should be at least 6 characters': 'Le mot de passe doit comporter au moins 6 caractères.',
    'Password should be at least 8 characters': 'Le mot de passe doit comporter au moins 8 caractères.',
    'Signup requires a valid password': 'Veuillez saisir un mot de passe valide.',
    'Unable to validate email address: invalid format': "L'adresse email est invalide.",
    'For security purposes, you can only request this once every 60 seconds':
      'Pour des raisons de sécurité, veuillez attendre 60 secondes avant de réessayer.',
    'Too many requests': 'Trop de tentatives. Veuillez patienter avant de réessayer.',
    'Database error saving new user': 'Erreur lors de la création du compte. Veuillez réessayer.',
    'email rate limit exceeded': 'Trop de tentatives. Veuillez patienter avant de réessayer.',
  }

  // Vérification partielle pour les messages contenant des sous-chaînes connues
  for (const [key, val] of Object.entries(map)) {
    if (message.includes(key)) return val
  }

  console.error('[translateAuthError] unknown error:', message)
  return 'Une erreur est survenue. Veuillez réessayer.'
}

export async function login(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const supabase = await createClient()

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })

  if (error) {
    return { error: translateAuthError(error.message) }
  }

  revalidatePath('/', 'layout')
  redirect('/dashboard')
}

export async function signup(_prevState: AuthState, formData: FormData): Promise<AuthState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase()
  const password = formData.get('password') as string
  const fullName = (formData.get('full_name') as string)?.trim()

  // Tentative d'envoi OTP via Resend (si RESEND_FROM_ADDRESS configuré)
  if (process.env.RESEND_FROM_ADDRESS) {
    const admin = createAdminClient()

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'signup',
      email,
      password,
      options: { data: { full_name: fullName } },
    })

    if (linkError) {
      return { error: translateAuthError(linkError.message) }
    }

    const otp = linkData?.properties?.email_otp
    if (otp) {
      const orgName = process.env.RESEND_FROM_NAME || APP_SIGNATURE
      const { subject, html } = buildSignupOtpEmail({ otp, orgName })
      await sendAuthEmail({ to: email, subject, html })
      // Rediriger vers la page de saisie du code OTP
      redirect(`/verify-email?email=${encodeURIComponent(email)}`)
    }
  }

  // Fallback : signUp classique (Supabase envoie son propre email avec lien)
  const supabase = await createClient()
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })

  if (error) {
    return { error: translateAuthError(error.message) }
  }

  if (!data.session) {
    return {
      error: null,
      message: 'Un email de confirmation vous a été envoyé. Vérifiez votre boîte mail.',
    }
  }

  revalidatePath('/', 'layout')
  redirect('/onboarding')
}
