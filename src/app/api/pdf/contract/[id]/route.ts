import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { renderContractPdfBufferById } from '@/lib/pdf/server'
import { isValidUuid } from '@/lib/security'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  if (!isValidUuid(params.id)) return new NextResponse('Contrat introuvable', { status: 404 })

  const url = new URL(req.url)
  const token = url.searchParams.get('token')
  const download = url.searchParams.get('download') === '1'

  // Mode public : accès via token de signature (page publique destinataire)
  if (token) {
    const admin = createAdminClient()
    const { data: contract, error } = await admin
      .from('contracts')
      .select('organization_id, pdf_snapshot, signature_token')
      .eq('id', params.id)
      .eq('signature_token', token)
      .single()
    if (error || !contract) return new NextResponse('Contrat introuvable ou lien invalide.', { status: 404 })
    if (!contract.pdf_snapshot) return new NextResponse('Le PDF n\'est pas encore disponible.', { status: 409 })

    let publicResult
    try {
      publicResult = await renderContractPdfBufferById(params.id, contract.organization_id)
    } catch (err) {
      console.error('[GET /api/pdf/contract] public render error:', err)
      return new NextResponse('Erreur génération PDF', { status: 500 })
    }
    if (!publicResult) return new NextResponse('Erreur génération PDF', { status: 500 })
    return new NextResponse(publicResult.buffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': download
          ? `attachment; filename="${publicResult.fileName}"`
          : `inline; filename="${publicResult.fileName}"`,
      },
    })
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

  return new NextResponse(result.buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${result.fileName}"`
        : `inline; filename="${result.fileName}"`,
    },
  })
}
