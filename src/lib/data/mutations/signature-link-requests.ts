'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPublicQuoteDocumentState, isSignatureTokenFresh } from '@/lib/security'
import { checkRateLimit, getClientIp } from '@/lib/rate-limit'
import { sendEmail } from '@/lib/email'
import { buildSignatureLinkRequestedEmail } from '@/lib/email/templates'
import { getClientGreetingName } from '@/lib/client'
import { sendPushToOrgPermission } from '@/lib/push'

export type SignatureLinkRequestResult = {
  error: string | null
  /** Une demande était déjà ouverte : l'artisan n'est pas prévenu une seconde fois. */
  alreadyRequested: boolean
}

const UNIQUE_VIOLATION = '23505'
const UNAVAILABLE = 'Ce devis n’est plus ouvert à la signature. Contactez directement l’entreprise.'

/**
 * Le client d'un artisan demande un nouveau lien de signature depuis un lien expiré.
 * - Pas d'auth requise : la capacité est le jeton expiré lui-même, jamais prolongé ici.
 * - Aucun lien n'est émis : l'artisan est prévenu (email et notification) et renvoie
 *   le devis s'il est d'accord, ce qui crée un lien neuf et clôt la demande.
 */
export async function requestNewQuoteSignatureLink(rawToken: string): Promise<SignatureLinkRequestResult> {
  const token = rawToken?.trim()
  if (!token) return { error: 'Lien de signature invalide.', alreadyRequested: false }

  const requestHeaders = await headers()
  const limit = await checkRateLimit({
    scope: 'public_signature_link_request',
    identifier: getClientIp(requestHeaders),
    limit: 10,
    windowSeconds: 60 * 60,
  })
  if (!limit.allowed) {
    return { error: 'Trop de demandes envoyées récemment. Réessayez plus tard ou contactez l’entreprise.', alreadyRequested: false }
  }

  const admin = createAdminClient()
  const { data: quote, error: fetchError } = await admin
    .from('quotes')
    .select('id, number, title, status, is_archived, organization_id, client_id, signed_at, signature_token_expires_at')
    .eq('signature_token', token)
    .maybeSingle()

  if (fetchError) {
    console.error('[requestNewQuoteSignatureLink] fetch error:', fetchError)
    return { error: 'Une erreur est survenue. Réessayez dans un instant.', alreadyRequested: false }
  }
  if (!quote) return { error: 'Lien de signature invalide.', alreadyRequested: false }
  if (quote.signed_at || !isPublicQuoteDocumentState(quote.status, quote.is_archived)
    || (quote.status !== 'sent' && quote.status !== 'viewed')) {
    return { error: UNAVAILABLE, alreadyRequested: false }
  }
  if (isSignatureTokenFresh(quote.signature_token_expires_at)) {
    return { error: 'Ce lien est encore valide : rechargez la page pour signer le devis.', alreadyRequested: false }
  }

  const { error: insertError } = await admin
    .from('signature_link_requests')
    .insert({ organization_id: quote.organization_id, quote_id: quote.id })

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) return { error: null, alreadyRequested: true }
    console.error('[requestNewQuoteSignatureLink] insert error:', insertError)
    return { error: 'Une erreur est survenue. Réessayez dans un instant.', alreadyRequested: false }
  }

  const [{ data: org }, { data: client }] = await Promise.all([
    admin.from('organizations').select('id, name, email, email_from_address, logo_url').eq('id', quote.organization_id).single(),
    quote.client_id
      ? admin.from('clients').select('company_name, contact_name, first_name, last_name, email').eq('id', quote.client_id).single()
      : Promise.resolve({ data: null }),
  ])

  const clientName = getClientGreetingName(client as Parameters<typeof getClientGreetingName>[0])
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const quoteEditorPath = `/finances/quote-editor?id=${quote.id}`
  const proEmail = org?.email_from_address || org?.email

  if (org && proEmail) {
    const { subject, html } = buildSignatureLinkRequestedEmail({
      orgName: org.name,
      logoUrl: org.logo_url,
      clientName,
      quoteNumber: quote.number,
      quoteTitle: quote.title,
      quoteEditorUrl: `${appUrl.replace(/\/$/, '')}${quoteEditorPath}`,
    })
    await sendEmail({ organizationId: org.id, to: proEmail, subject, html })
      .catch(err => console.error('[requestNewQuoteSignatureLink] pro email error:', err))
  }

  sendPushToOrgPermission(quote.organization_id, 'quotes.send', {
    title: `Nouveau lien demandé${quote.number ? ` · devis ${quote.number}` : ''}`,
    body: `${clientName} souhaite signer : renvoyez le devis pour lui envoyer un lien neuf.`,
    url: quoteEditorPath,
  }).catch(() => {})

  return { error: null, alreadyRequested: false }
}
