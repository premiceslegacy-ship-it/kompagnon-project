'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSignatureTokenFresh, normalizeSignatureImage } from '@/lib/security'
import { sendEmail } from '@/lib/email'
import { renderOrganizationEmail } from '@/lib/email/organization'
import { escHtml } from '@/lib/email/layout'

export type SubmitClientSignatureInput = {
  token: string
  signatoryName: string
  signatoryRole?: string | null
  signatureImage: string
}

export type SubmitClientSignatureResult = {
  error: string | null
  signedAt: string | null
  orgName: string | null
  contractTitle: string | null
  quoteAccepted: boolean
}

function cleanText(value: string | null | undefined): string | null {
  const text = value?.trim()
  return text ? text : null
}


type ContractSignatureAuthorityResult = {
  ok: boolean
  code?: string
  already_signed?: boolean
  contract_id?: string
  organization_id?: string
  title?: string
  signed_at?: string
  quote_id?: string | null
  quote_status?: string | null
}

function signatureFailure(error: string): SubmitClientSignatureResult {
  return { error, signedAt: null, orgName: null, contractTitle: null, quoteAccepted: false }
}

function signatureAuthorityError(code: string | undefined): string {
  switch (code) {
    case 'not_found': return 'Contrat introuvable ou lien invalide.'
    case 'archived': return `Ce contrat est archivé et n'est plus disponible à la signature.`
    case 'expired': return 'Ce lien de signature a expiré.'
    case 'quote_changed':
    case 'quote_expired':
      return 'Le devis associé a été modifié ou a expiré. Le contrat n’a pas été signé. Contactez l’organisation pour recevoir une nouvelle proposition.'
    case 'quote_unavailable':
      return 'Le devis associé n’est plus disponible. Le contrat n’a pas été signé.'
    case 'publication_unavailable':
      return 'Ce lien n’est plus associé à une publication vérifiable du contrat.'
    case 'archive_unavailable':
      return 'Le contrat est signé mais son archive est indisponible.'
    default:
      return 'Ce contrat n’est plus disponible à la signature.'
  }
}

async function submitContractSignature(
  input: SubmitClientSignatureInput,
  acceptQuote: boolean,
): Promise<SubmitClientSignatureResult> {
  const signatoryName = input.signatoryName?.trim() ?? ''
  const signatoryRole = cleanText(input.signatoryRole)
  const signatureImage = normalizeSignatureImage(input.signatureImage) ?? ''
  if (!signatoryName) return signatureFailure('Veuillez renseigner votre nom.')
  if (!signatureImage) return signatureFailure('Signature invalide ou manquante.')

  const reqHeaders = await headers()
  const signedIp = reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? reqHeaders.get('x-real-ip')
    ?? 'inconnue'
  const userAgent = reqHeaders.get('user-agent') ?? ''
  const admin = createAdminClient()
  const { data, error } = await admin.rpc('sign_contract_with_quote', {
    p_token: input.token?.trim() ?? '',
    p_signatory_name: signatoryName,
    p_signatory_role: signatoryRole,
    p_signature_image: signatureImage,
    p_signed_ip: signedIp,
    p_signed_user_agent: userAgent,
    p_accept_quote: acceptQuote,
  })

  if (error) {
    console.error('[submitContractSignature] authority RPC', error, {
      hasIp: signedIp !== 'inconnue',
      userAgentLength: userAgent.length,
    })
    return signatureFailure('Une erreur est survenue. Veuillez réessayer.')
  }

  const result = data as ContractSignatureAuthorityResult | null
  if (!result?.ok) return signatureFailure(signatureAuthorityError(result?.code))
  if (!result.signed_at || !result.organization_id || !result.title) {
    return signatureFailure('Le contrat signé est disponible, mais son reçu est incomplet.')
  }

  const { data: organization } = await admin
    .from('organizations')
    .select('name')
    .eq('id', result.organization_id)
    .single()

  return {
    error: null,
    signedAt: result.signed_at,
    orgName: organization?.name ?? null,
    contractTitle: result.title,
    quoteAccepted: ['accepted', 'converted', 'fully_invoiced'].includes(result.quote_status ?? ''),
  }
}

/**
 * Enregistre la signature du contrat sur l'autorité publiée, sans recharger ni
 * reconstruire les conditions juridiques après le consentement.
 */
export async function submitClientSignature(input: SubmitClientSignatureInput): Promise<SubmitClientSignatureResult> {
  return submitContractSignature(input, false)
}

export type SubmitClientSignatureWithQuoteInput = SubmitClientSignatureInput & {
  acceptQuote: boolean
}

/** La validation éventuelle du devis et la signature sont une transaction DB unique. */
export async function submitClientSignatureWithQuote(
  input: SubmitClientSignatureWithQuoteInput,
): Promise<SubmitClientSignatureResult> {
  return submitContractSignature(input, input.acceptQuote)
}

export type SendQuoteDeclineMessageInput = {
  token: string
  senderName: string
  message: string
}

/**
 * Envoie un message de refus/contre-proposition au mail de l'organisation.
 * Utilisé depuis la page de signature quand le client ne souhaite pas valider le devis.
 */
export async function sendQuoteDeclineMessage(input: SendQuoteDeclineMessageInput): Promise<{ error: string | null }> {
  const admin = createAdminClient()

  const { data: contract } = await admin
    .from('contracts')
    .select('id, organization_id, title, counterparty_name, quote_id, status, signature_token_expires_at, signature_document_hash')
    .eq('signature_token', input.token)
    .single()

  if (!contract) return { error: 'Contrat introuvable.' }
  if (!isSignatureTokenFresh(contract.signature_token_expires_at)) return { error: 'Ce lien de signature a expiré.' }
  if (contract.status === 'archived') return { error: 'Ce contrat est archivé.' }
  if (contract.status !== 'sent' || !contract.signature_document_hash) {
    return { error: 'Ce lien ne correspond plus à une publication active.' }
  }

  const { data: org } = await admin
    .from('organizations')
    .select('id, name, email, logo_url, primary_color, email_signature')
    .eq('id', contract.organization_id)
    .single()

  if (!org?.email) return { error: "Impossible de trouver l'adresse e-mail de contact." }

  const senderName = input.senderName?.trim() || contract.counterparty_name
  const message = input.message?.trim()
  if (!message) return { error: 'Veuillez rédiger votre message.' }

  const subject = `Réponse de ${senderName} - contrat ${contract.title}`
  const html = renderOrganizationEmail({
    subject,
    orgName: org.name,
    logoUrl: org.logo_url,
    primaryColor: org.primary_color,
    replyTo: org.email,
    signature: org.email_signature,
    bodyHtml: `<p style="font-size:12px;color:#6E6A62">Message reçu via le portail de signature</p>
      <p><strong>De :</strong> ${escHtml(senderName)}</p>
      <p><strong>Contrat concerné :</strong> ${escHtml(contract.title)}</p>
      <p style="margin-top:16px;padding:16px;background:#F7F4EE;border:1px solid #D9D2C7;border-radius:8px;white-space:pre-line">${escHtml(message)}</p>`,
    includeSignature: Boolean(org.email_signature),
  })

  const mail = await sendEmail({
    organizationId: org.id,
    to: org.email,
    subject,
    html,
  })

  return { error: mail.error ?? null }
}
