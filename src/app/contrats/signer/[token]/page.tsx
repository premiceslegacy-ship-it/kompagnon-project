import { notFound } from 'next/navigation'
import { z } from 'zod'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSignatureTokenFresh } from '@/lib/security'
import { contractDocumentSnapshotFromVerifiedPublication } from '@/lib/contracts/document-authority'
import type { ContractDocumentPublicationRecord } from '@/lib/contracts/document-authority'
import type { Metadata } from 'next'
import ContractSignClient from './ContractSignClient'

export const metadata: Metadata = {
  title: 'Signature de contrat',
  robots: 'noindex',
}

const linkedQuoteDocumentSchema = z.object({
  id: z.string().min(1),
  status: z.string(),
  document_snapshot: z.object({
    version: z.literal(1),
    quote: z.object({
      id: z.string().min(1),
      number: z.string().nullable(),
      title: z.string().nullable(),
      total_ttc: z.number().nullable(),
    }).passthrough(),
  }).passthrough(),
}).passthrough()

export default async function ContractSignPage({ params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const params = await paramsPromise
  const admin = createAdminClient()

  const { data: contract } = await admin
    .from('contracts')
    .select(`
      id, organization_id, status, sent_at, signed_at, archived_at, client_signed_at,
      client_signature_image, client_signatory_name, client_signatory_role,
      signature_token_expires_at, signature_document_hash, pdf_reference, pdf_snapshot,
      linked_quote_document
    `)
    .eq('signature_token', params.token)
    .single()

  if (!contract) notFound()
  if (!isSignatureTokenFresh(contract.signature_token_expires_at)) notFound()

  const publication = await contractDocumentSnapshotFromVerifiedPublication(
    contract as ContractDocumentPublicationRecord,
  )
  const archived = contract.status === 'archived' || contract.archived_at !== null
  const alreadySigned = contract.status === 'signed' && !!contract.client_signed_at
  const publicationUnavailable = !publication
    || (!alreadySigned && (contract.status !== 'sent' || !contract.signature_document_hash))
    || (contract.status === 'signed' && !alreadySigned)
  const pdfReady = !publicationUnavailable && !!contract.pdf_reference && !!contract.pdf_snapshot

  const linkedQuoteRecord = linkedQuoteDocumentSchema.safeParse(contract.linked_quote_document)
  const linkedQuoteData = linkedQuoteRecord.success
    && linkedQuoteRecord.data.id === linkedQuoteRecord.data.document_snapshot.quote.id
    ? linkedQuoteRecord.data
    : null
  const quoteStatus = linkedQuoteData?.status ?? ''
  const quote = linkedQuoteData?.document_snapshot.quote
  const linkedQuote = quote && ['sent', 'viewed'].includes(quoteStatus)
    ? { id: quote.id, number: quote.number, title: quote.title, total_ttc: quote.total_ttc }
    : null
  const linkedQuoteForDownload = quote
    ? { id: quote.id, accepted: ['accepted', 'converted', 'fully_invoiced'].includes(quoteStatus) }
    : null

  return (
    <ContractSignClient
      token={params.token}
      contractId={contract.id}
      contractTitle={publication?.contract.title ?? ''}
      contractType={publication?.contract.type ?? 'maintenance'}
      counterpartyName={publication?.counterparty.name ?? ''}
      orgName={publication?.organization?.name ?? ''}
      orgLogoUrl={publication?.organization?.logo_url ?? null}
      orgEmail={publication?.organization?.email ?? null}
      pdfReady={pdfReady}
      alreadySigned={alreadySigned && !publicationUnavailable}
      signedAt={contract.client_signed_at}
      archived={archived}
      publicationUnavailable={publicationUnavailable}
      linkedQuote={linkedQuote}
      linkedQuoteForDownload={linkedQuoteForDownload}
    />
  )
}
