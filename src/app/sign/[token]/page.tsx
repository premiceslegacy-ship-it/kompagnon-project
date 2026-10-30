import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isPublicQuoteDocumentState, isSignatureTokenFresh } from '@/lib/security'
import { quoteDocumentPayloadFromSnapshot } from '@/lib/pdf/server'
import type { Metadata } from 'next'
import SignClient from './SignClient'

export const metadata: Metadata = {
  title: 'Signature de devis',
  robots: 'noindex',
}

export default async function SignPage({ params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const { token } = await paramsPromise
  const admin = createAdminClient()
  // The snapshot and capability are read together; a later revision cannot
  // replace the identity or amount that this page presents for acceptance.
  const { data: quote, error } = await admin.from('quotes')
    .select(`id, organization_id, status, is_archived, signed_at,
      client_signature_image, client_signatory_name, client_signatory_role,
      signature_token_expires_at, document_snapshot`)
    .eq('signature_token', token)
    .maybeSingle()
  if (error) throw error
  if (!quote || !isPublicQuoteDocumentState(quote.status, quote.is_archived)
    || !isSignatureTokenFresh(quote.signature_token_expires_at)) notFound()

  let payload
  try {
    payload = quoteDocumentPayloadFromSnapshot(quote, quote.organization_id)
  } catch (authorityError) {
    if (authorityError instanceof Error && 'code' in authorityError
      && authorityError.code === 'QUOTE_DOCUMENT_AUTHORITY_MISSING') {
      return (
        <main className="mx-auto max-w-xl p-8">
          <h1 className="text-xl font-semibold">Signature indisponible</h1>
          <p className="mt-3">L’archive de cette proposition n’est pas vérifiée. Demandez une nouvelle proposition à l’entreprise avant de signer.</p>
        </main>
      )
    }
    throw authorityError
  }
  const { quoteRecord: published, organization, client } = payload
  const clientName = client
    ? client.company_name || [client.first_name, client.last_name].filter(Boolean).join(' ') || null
    : null
  const orgAddress = [organization.address_line1,
    `${organization.postal_code ?? ''} ${organization.city ?? ''}`.trim(),
  ].filter(Boolean).join(', ') || null

  if (quote.status !== 'sent' && quote.status !== 'viewed' && !quote.signed_at) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold">Proposition clôturée</h1>
        <p className="mt-3">Ce devis reste consultable, mais n’est plus ouvert à une nouvelle signature.</p>
        <a className="mt-4 inline-block underline" href={`/api/pdf/quote/${quote.id}?token=${encodeURIComponent(token)}`}>
          Consulter le devis {published.number}
        </a>
      </main>
    )
  }

  return (
    <SignClient
      token={token}
      quoteNumber={published.number}
      quoteTitle={published.title}
      totalTtc={published.total_ttc}
      currency={published.currency ?? 'EUR'}
      validUntil={published.valid_until}
      orgName={organization.name}
      orgAddress={orgAddress}
      clientName={clientName}
      quoteId={quote.id}
      alreadySigned={!!quote.signed_at}
      signedAt={quote.signed_at}
      signatoryName={quote.client_signatory_name ?? clientName}
    />
  )
}
