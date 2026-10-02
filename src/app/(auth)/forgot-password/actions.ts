'use server'

import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import { resolveOrganizationFromAddress } from '@/lib/email/resolver'
import { buildPasswordResetOtpEmail } from '@/lib/email/templates'
import { ATELIER_SENDER_NAME } from '@/lib/brand'

export type ForgotPasswordState = {
  error: string | null
  success: boolean
}

const SEND_FAILURE_MESSAGE = "Impossible d'envoyer le code pour le moment. Réessayez dans quelques instants."

/**
 * Envoie un code OTP de réinitialisation de mot de passe.
 * - Génère l'OTP via Supabase Admin (sans envoyer l'email Supabase).
 * - Envoie l'email OTP brandé via Resend.
 * - Aucun secours : si le code ne peut pas partir par nos propres emails, on
 *   renvoie une erreur et l'utilisateur réessaie. On n'envoie jamais l'email
 *   Supabase par défaut, qui n'est pas à notre marque.
 * - Retourne success=true pour un email inconnu, pour ne pas révéler s'il existe.
 */
export async function forgotPassword(
  _prevState: ForgotPasswordState,
  formData: FormData
): Promise<ForgotPasswordState> {
  const email = (formData.get('email') as string)?.trim().toLowerCase()
  if (!email) return { error: 'Veuillez saisir votre adresse email.', success: false }

  const admin = createAdminClient()

  // Chercher l'utilisateur par la table profiles (indexée sur email) plutôt
  // que listUsers() : celui-ci pagine à 50 par défaut et un .find() en mémoire
  // ne trouve jamais un utilisateur au-delà de la première page, sans erreur
  // ni log — l'email n'est alors simplement jamais envoyé.
  const { data: existingProfile } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email)
    .maybeSingle()

  if (!existingProfile) {
    return { error: null, success: true }
  }

  // Chercher la config email de l'organisation de l'utilisateur
  const { data: membership } = await admin
    .from('memberships')
    .select('organization_id, organizations(name, slug, email_from_address, logo_url)')
    .eq('user_id', existingProfile.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const org = membership?.organizations as { name?: string; slug?: string; email_from_address?: string; logo_url?: string | null } | null
  const sharedEmailDomain = process.env.SHARED_EMAIL_DOMAIN
  const orgFromAddress = resolveOrganizationFromAddress({
    organizationAddress: org?.email_from_address,
    slug: org?.slug,
    sharedDomain: sharedEmailDomain,
    deploymentAddress: process.env.RESEND_FROM_ADDRESS,
  })

  if (!membership || !orgFromAddress) {
    console.error('[forgotPassword] organisation ou adresse expéditeur introuvable', { userId: existingProfile.id })
    return { error: SEND_FAILURE_MESSAGE, success: false }
  }

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'recovery',
    email,
  })
  const otp = linkData?.properties?.email_otp
  if (linkError || !otp) {
    console.error('[forgotPassword] génération du code impossible', linkError?.message)
    return { error: SEND_FAILURE_MESSAGE, success: false }
  }

  const orgName = org?.name || ATELIER_SENDER_NAME
  const { subject, html } = buildPasswordResetOtpEmail({ otp, orgName, logoUrl: org?.logo_url })

  const { error: sendError } = await sendEmail({
    organizationId: membership.organization_id,
    to: email,
    subject,
    html,
    // Email de compte, pas un message à un client de l'entreprise : une réponse
    // peut légitimement aller au support Atelier.
    allowAtelierReplyTo: true,
  })
  if (sendError) {
    console.error('[forgotPassword] envoi impossible', sendError)
    return { error: SEND_FAILURE_MESSAGE, success: false }
  }

  // Rediriger vers la page de saisie du code OTP
  redirect(`/forgot-password/verify?email=${encodeURIComponent(email)}`)
}
