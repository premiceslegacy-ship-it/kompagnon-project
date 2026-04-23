'use server'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { buildPasswordResetOtpEmail } from '@/lib/email/templates'
import { APP_SIGNATURE } from '@/lib/brand'

export type ForgotPasswordState = {
  error: string | null
  success: boolean
}

/**
 * Envoie un code OTP de réinitialisation de mot de passe.
 * - Génère l'OTP via Supabase Admin (sans envoyer l'email Supabase).
 * - Envoie l'email OTP brandé via Resend si l'org est configurée.
 * - Fallback sur Supabase natif (lien) sinon.
 * - Retourne toujours success=true pour ne pas révéler si l'email existe.
 */
export async function forgotPassword(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase()
  if (!email) return { error: 'Veuillez saisir votre adresse email.', success: false }

  const admin = createAdminClient()

  // Chercher l'utilisateur (ne pas révéler s'il existe ou non)
  const { data: userList } = await admin.auth.admin.listUsers()
  const existingUser = userList?.users?.find(u => u.email === email)

  if (!existingUser) {
    return { error: null, success: true }
  }

  // Chercher la config email de l'organisation de l'utilisateur
  const { data: membership } = await admin
    .from('memberships')
    .select('organization_id, organizations(name, email_from_address)')
    .eq('user_id', existingUser.id)
    .eq('is_active', true)
    .single()

  const org = membership?.organizations as { name?: string; email_from_address?: string } | null

  // Si Resend configuré → générer OTP et envoyer via Resend
  if (org?.email_from_address) {
    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email,
    })

    if (!linkError && linkData?.properties?.email_otp) {
      const otp = linkData.properties.email_otp
      const orgName = org.name || APP_SIGNATURE
      const { subject, html } = buildPasswordResetOtpEmail({ otp, orgName })

      await sendEmail({
        organizationId: membership!.organization_id,
        to: email,
        subject,
        html,
      })

      // Rediriger vers la page de saisie du code OTP
      redirect(`/forgot-password/verify?email=${encodeURIComponent(email)}`)
    }
  }

  // Fallback : Supabase envoie son propre email (lien de réinitialisation)
  const supabase = await createClient()
  const redirectTo = `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`
  await supabase.auth.resetPasswordForEmail(email, { redirectTo })

  return { error: null, success: true }
}
