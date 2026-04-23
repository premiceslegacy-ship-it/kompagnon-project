'use server'

import { headers } from 'next/headers'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendEmail } from '@/lib/email'
import {
  buildQuoteAcceptedClientEmail,
  buildQuoteAcceptedProfessionalEmail,
} from '@/lib/email/templates'
import { getClientGreetingName } from '@/lib/client'

export type AcceptQuoteResult = {
  error: string | null
  quoteNumber: string | null
  quoteTitle: string | null
  orgName: string | null
  signedAt: string | null
}

/**
 * Enregistre l'acceptation d'un devis via son token de signature public.
 * - Pas d'auth requise (page publique client)
 * - Envoie 2 emails : confirmation client + notification professionnel
 */
export async function acceptQuoteByToken(token: string): Promise<AcceptQuoteResult> {
  const admin = createAdminClient()

  // 1. Charger le devis par token
  const { data: quote, error: fetchErr } = await admin
    .from('quotes')
    .select(`
      id, number, title, status, total_ttc, currency, organization_id,
      client_id, signature_token, signed_at
    `)
    .eq('signature_token', token)
    .single()

  if (fetchErr || !quote) return { error: 'Devis introuvable ou lien invalide.', quoteNumber: null, quoteTitle: null, orgName: null, signedAt: null }

  // Déjà signé → retourner succès silencieux
  if (quote.signed_at) {
    const { data: org } = await admin.from('organizations').select('name').eq('id', quote.organization_id).single()
    return { error: null, quoteNumber: quote.number, quoteTitle: quote.title, orgName: org?.name ?? null, signedAt: quote.signed_at }
  }

  // Devis annulé / refusé → bloquer
  if (['refused', 'expired', 'archived'].includes(quote.status)) {
    return { error: 'Ce devis n\'est plus disponible à la signature.', quoteNumber: null, quoteTitle: null, orgName: null, signedAt: null }
  }

  // 2. Récupérer IP + user-agent
  const reqHeaders = await headers()
  const ip = reqHeaders.get('x-forwarded-for')?.split(',')[0]?.trim()
    ?? reqHeaders.get('x-real-ip')
    ?? 'inconnue'
  const userAgent = reqHeaders.get('user-agent') ?? ''

  const signedAt = new Date()

  // 3. Enregistrer la signature
  const { error: updateErr } = await admin
    .from('quotes')
    .update({
      status: 'accepted',
      accepted_at: signedAt.toISOString(),
      signed_at: signedAt.toISOString(),
      signed_ip: ip,
      signed_user_agent: userAgent,
    })
    .eq('id', quote.id)

  if (updateErr) {
    console.error('[acceptQuoteByToken] update error:', updateErr)
    return { error: 'Une erreur est survenue. Veuillez réessayer.', quoteNumber: null, quoteTitle: null, orgName: null, signedAt: null }
  }

  // 4. Charger org + client pour les emails
  const [{ data: org }, { data: client }] = await Promise.all([
    admin.from('organizations').select('id, name, email, email_from_address, email_from_name').eq('id', quote.organization_id).single(),
    quote.client_id
      ? admin.from('clients').select('company_name, contact_name, first_name, last_name, email').eq('id', quote.client_id).single()
      : Promise.resolve({ data: null }),
  ])

  const clientName = getClientGreetingName(client as any)
  const clientEmail = (client as any)?.email as string | null

  // 5. Email de confirmation → CLIENT
  if (clientEmail && org) {
    const { subject, html } = buildQuoteAcceptedClientEmail({
      orgName: org.name,
      clientName,
      quoteNumber: quote.number,
      quoteTitle: quote.title,
      totalTtc: quote.total_ttc,
      currency: quote.currency ?? 'EUR',
      signedAt,
    })
    await sendEmail({
      organizationId: org.id,
      to: clientEmail,
      subject,
      html,
    }).catch(err => console.error('[acceptQuoteByToken] client email error:', err))
  }

  // 6. Email de notification → PROFESSIONNEL
  if (org) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const quoteEditorUrl = `${appUrl}/finances/quote-editor?id=${quote.id}`

    const { subject, html } = buildQuoteAcceptedProfessionalEmail({
      orgName: org.name,
      clientName,
      clientEmail: clientEmail ?? '',
      quoteNumber: quote.number,
      quoteTitle: quote.title,
      totalTtc: quote.total_ttc,
      currency: quote.currency ?? 'EUR',
      signedAt,
      quoteEditorUrl,
    })

    // Envoyer à l'email de contact de l'org
    const proEmail = org.email_from_address || org.email
    if (proEmail) {
      await sendEmail({
        organizationId: org.id,
        to: proEmail,
        subject,
        html,
      }).catch(err => console.error('[acceptQuoteByToken] pro email error:', err))
    }
  }

  return {
    error: null,
    quoteNumber: quote.number,
    quoteTitle: quote.title,
    orgName: org?.name ?? null,
    signedAt: signedAt.toISOString(),
  }
}
