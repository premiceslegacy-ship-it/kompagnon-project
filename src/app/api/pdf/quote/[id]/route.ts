import { NextResponse } from 'next/server'
import { pdfResponse } from '@/lib/pdf/response'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { isPublicQuoteDocumentState, isSignatureTokenFresh, isValidUuid } from '@/lib/security'
import {
  quoteDocumentPayloadFromSnapshot,
  renderQuotePdfBufferById,
  type QuoteDocumentSnapshotRecord,
} from '@/lib/pdf/server'
import { renderQuotePdf } from '@/lib/pdf/documents/quote'
import { contractDocumentSnapshotFromVerifiedPublication } from '@/lib/contracts/document-authority'
import { z } from 'zod'

export const dynamic = 'force-dynamic'

const linkedQuoteDocumentSchema = z.object({
  id: z.string().uuid(),
  status: z.string(),
  signed_at: z.string().nullable(),
  client_signature_image: z.string().nullable(),
  client_signatory_name: z.string().nullable(),
  client_signatory_role: z.string().nullable(),
  document_snapshot: z.unknown(),
})

export async function GET(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> },
) {
  const { id } = await paramsPromise
  if (!isValidUuid(id)) return new NextResponse('Devis introuvable', { status: 404 })
  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const contractToken = url.searchParams.get('contractToken')
  const download = url.searchParams.get('download') === '1'

  try {
    if (token || contractToken) {
      const admin = createAdminClient()
      let quote: QuoteDocumentSnapshotRecord | null = null
      let organizationId: string
      let quoteIsArchived = false

      if (token) {
        const { data, error } = await admin.from('quotes')
          .select('id, organization_id, client_id, status, is_archived, signed_at, client_signature_image, client_signatory_name, client_signatory_role, document_snapshot, signature_token_expires_at')
          .eq('id', id)
          .eq('signature_token', token)
          .maybeSingle()
        if (error) throw error
        if (!data) return new NextResponse('Lien invalide', { status: 404 })
        quote = data
        organizationId = data.organization_id
        quoteIsArchived = data.is_archived
        if (!isSignatureTokenFresh(data.signature_token_expires_at)) {
          return new NextResponse('Lien expiré', { status: 410 })
        }
      } else {
        // The contract authorizes its sealed linked publication, not a later
        // live quote revision or a reconstructed current-party document.
        const { data: contract, error } = await admin.from('contracts')
          .select(`id, organization_id, client_id, status, archived_at, sent_at, signed_at,
            client_signed_at, client_signature_image, client_signatory_name, client_signatory_role,
            signature_token_expires_at, pdf_reference, signature_document_hash,
            pdf_snapshot, linked_quote_document`)
          .eq('quote_id', id)
          .eq('signature_token', contractToken)
          .maybeSingle()
        if (error) throw error
        if (!contract) return new NextResponse('Lien invalide', { status: 404 })
        if (contract.archived_at || !['sent', 'signed'].includes(contract.status)) {
          return new NextResponse('Contrat clôturé', { status: 410 })
        }
        if (!isSignatureTokenFresh(contract.signature_token_expires_at)) {
          return new NextResponse('Lien expiré', { status: 410 })
        }
        const publication = await contractDocumentSnapshotFromVerifiedPublication(contract)
        const linkedQuote = linkedQuoteDocumentSchema.safeParse(contract.linked_quote_document)
        if (!publication || !linkedQuote.success || linkedQuote.data.id !== id) {
          return NextResponse.json({
            error: 'L’archive du contrat ou de son devis associé n’est pas vérifiée.',
            code: 'QUOTE_DOCUMENT_AUTHORITY_MISSING',
          }, { status: 409 })
        }
        quote = linkedQuote.data
        organizationId = contract.organization_id
      }

      if (!isPublicQuoteDocumentState(quote.status, quoteIsArchived)) {
        return new NextResponse('Devis clôturé', { status: 410 })
      }
      const payload = quoteDocumentPayloadFromSnapshot(quote, organizationId)
      const buffer = await renderQuotePdf({
        quote: payload.quoteRecord,
        organization: payload.organization,
        client: payload.client,
      }, url.origin)
      return pdfResponse(buffer, `devis-${payload.quoteRecord.number ?? id}.pdf`, { download, fallback: 'devis' })
    }

    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new NextResponse('Non authentifié', { status: 401 })
    const orgId = await getCurrentOrganizationId()
    if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })
    const { data: ownQuote, error } = await supabase.from('quotes')
      .select('organization_id')
      .eq('id', id)
      .eq('organization_id', orgId)
      .maybeSingle()
    if (error) throw error
    if (!ownQuote) return new NextResponse('Devis introuvable', { status: 404 })
    const pdf = await renderQuotePdfBufferById(id, orgId)
    if (!pdf) return new NextResponse('Devis introuvable', { status: 404 })
    return pdfResponse(pdf.buffer, pdf.fileName, { download, fallback: 'devis' })
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'QUOTE_DOCUMENT_AUTHORITY_MISSING') {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 })
    }
    console.error('[GET /api/pdf/quote] generation failed:', error)
    return new NextResponse('Erreur génération PDF', { status: 500 })
  }
}
