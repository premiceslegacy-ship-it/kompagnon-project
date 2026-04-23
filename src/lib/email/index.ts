import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/admin'
import { APP_SIGNATURE, defaultBrandedSenderName } from '@/lib/brand'

/**
 * Envoie un email d'authentification (signup OTP, etc.) via Resend
 * en utilisant les variables d'environnement du déploiement.
 *
 * Prérequis :
 * - RESEND_API_KEY dans .env.local
 * - RESEND_FROM_ADDRESS dans .env.local (ex: noreply@entreprise.fr)
 * - RESEND_FROM_NAME dans .env.local (ex: Bâti Pro)
 */
export async function sendAuthEmail({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}): Promise<{ error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.RESEND_FROM_ADDRESS
  const fromName = defaultBrandedSenderName(process.env.RESEND_FROM_NAME || APP_SIGNATURE)

  if (!apiKey || !fromAddress) {
    console.error('[sendAuthEmail] RESEND_API_KEY ou RESEND_FROM_ADDRESS manquants dans .env.local')
    return { error: 'Configuration email manquante.' }
  }

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from: `${fromName} <${fromAddress}>`,
    to,
    subject,
    html,
  })

  if (error) {
    console.error('[sendAuthEmail] Resend error:', error.message)
    return { error: "Impossible d'envoyer l'email." }
  }

  return { error: null }
}

/**
 * Envoie un email via Resend en utilisant les paramètres de l'organisation.
 *
 * Prérequis :
 * - RESEND_API_KEY dans .env.local
 * - email_from_name + email_from_address configurés dans organizations (via Settings > Email)
 */
export async function sendEmail({
  organizationId,
  to,
  subject,
  html,
  attachments,
}: {
  organizationId: string
  to: string
  subject: string
  html: string
  attachments?: Array<{ filename: string; content: Buffer }>
}): Promise<{ error: string | null }> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.error('[sendEmail] RESEND_API_KEY manquante dans .env.local')
    return { error: 'Configuration email manquante (clé API).' }
  }

  // Récupérer les paramètres from de l'organisation
  const admin = createAdminClient()
  const { data: org } = await admin
    .from('organizations')
    .select('name, email_from_name, email_from_address')
    .eq('id', organizationId)
    .single()

  if (!org?.email_from_address) {
    return {
      error:
        "L'adresse email expéditeur n'est pas configurée. Rendez-vous dans Paramètres > Email.",
    }
  }

  const fromName = defaultBrandedSenderName(org.email_from_name || org.name || APP_SIGNATURE)
  const from = `${fromName} <${org.email_from_address}>`

  const resend = new Resend(apiKey)
  const { error } = await resend.emails.send({
    from,
    to,
    subject,
    html,
    ...(attachments?.length ? { attachments } : {}),
  })

  if (error) {
    console.error('[sendEmail] Resend error:', error.message)
    return { error: "Impossible d'envoyer l'email. Vérifiez la configuration Resend." }
  }

  return { error: null }
}
