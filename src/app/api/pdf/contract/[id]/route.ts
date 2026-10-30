import { NextResponse } from 'next/server'
import { pdfResponse } from '@/lib/pdf/response'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import {
  renderContractPdfBufferById,
  renderContractPdfBufferFromPublication,
} from '@/lib/pdf/server'
import type { ContractDocumentPublicationRecord } from '@/lib/contracts/document-authority'
import { isSignatureTokenFresh, isValidUuid } from '@/lib/security'

export async function GET(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> },
) {
  const params = await paramsPromise
  if (!isValidUuid(params.id)) return new NextResponse('Contrat introuvable', { status: 404 })

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const download = url.searchParams.get('download') === '1'

  // Mode public : accès via token de signature (page publique destinataire)
  if (token) {
    const admin = createAdminClient()
    const { data: contract, error } = await admin
      .from('contracts')
      .select(`id, organization_id, status, archived_at, sent_at, signed_at, client_signed_at,
        client_signature_image, client_signatory_name, client_signatory_role,
        signature_document_hash, linked_quote_document, pdf_reference, pdf_snapshot,
        signature_token, signature_token_expires_at`)
      .eq('id', params.id)
      .eq('signature_token', token)
      .single()
    if (error || !contract) return new NextResponse('Contrat introuvable ou lien invalide.', { status: 404 })
    if (!isSignatureTokenFresh(contract.signature_token_expires_at)) {
      return new NextResponse('Lien expiré.', { status: 410 })
    }
    if (contract.status === 'archived' || contract.archived_at) {
      return new NextResponse('Contrat clôturé.', { status: 410 })
    }
    if (!['sent', 'signed'].includes(contract.status)) {
      return new NextResponse('Publication indisponible.', { status: 410 })
    }
    if (contract.status === 'sent' && !contract.signature_document_hash) {
      return NextResponse.json({
        error: 'Cette ancienne publication ne possède pas d’archive de signature vérifiée.',
        code: 'CONTRACT_DOCUMENT_AUTHORITY_MISSING',
      }, { status: 409 })
    }
    if (contract.status === 'signed' && !contract.client_signed_at) {
      return new NextResponse('Le contrat ne possède pas de signature publique vérifiée.', { status: 410 })
    }
    if (!contract.pdf_snapshot) {
      return NextResponse.json({
        error: 'L’archive PDF du contrat signé est indisponible.',
        code: 'CONTRACT_DOCUMENT_ARCHIVE_MISSING',
      }, { status: 409 })
    }

    let publicResult: Awaited<ReturnType<typeof renderContractPdfBufferFromPublication>>
    try {
      publicResult = await renderContractPdfBufferFromPublication(
        contract as ContractDocumentPublicationRecord,
      )
    } catch (err) {
      console.error('[GET /api/pdf/contract] public render error:', err)
      return new NextResponse('Erreur génération PDF', { status: 500 })
    }
    if (!publicResult) return new NextResponse('Erreur génération PDF', { status: 500 })
    return pdfResponse(publicResult.buffer, publicResult.fileName, { download, fallback: 'contrat' })
  }

  // Mode authentifié : accès interne par l'utilisateur de l'organisation
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  const { data: contract, error } = await supabase
    .from('contracts')
    .select('organization_id, pdf_snapshot')
    .eq('id', params.id)
    .maybeSingle()

  if (error) {
    console.error('[GET /api/pdf/contract] lookup error:', error)
    return new NextResponse('Erreur serveur', { status: 500 })
  }
  if (!contract) return new NextResponse('Contrat introuvable', { status: 404 })
  if (contract.organization_id !== orgId) return new NextResponse('Accès refusé', { status: 403 })
  if (!contract.pdf_snapshot) return new NextResponse('Le PDF doit être généré avant consultation.', { status: 409 })

  let result
  try {
    result = await renderContractPdfBufferById(params.id, orgId)
  } catch (err) {
    console.error('[GET /api/pdf/contract] render error:', err)
    return new NextResponse('Erreur génération PDF', { status: 500 })
  }
  if (!result) return new NextResponse('Erreur génération PDF', { status: 500 })

  return pdfResponse(result.buffer, result.fileName, { download, fallback: 'contrat' })
}
