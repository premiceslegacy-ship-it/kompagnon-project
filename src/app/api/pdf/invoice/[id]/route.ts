import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { renderInvoicePdfBufferById } from '@/lib/pdf/server'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  // Vérifier que la facture appartient à cette org
  const { data: inv } = await supabase
    .from('invoices')
    .select('organization_id')
    .eq('id', params.id)
    .single()

  if (!inv) return new NextResponse('Facture introuvable', { status: 404 })
  if (inv.organization_id !== orgId) return new NextResponse('Accès refusé', { status: 403 })

  const result = await renderInvoicePdfBufferById(params.id, orgId)
  if (!result) return new NextResponse('Erreur génération PDF', { status: 500 })

  const download = new URL(req.url).searchParams.get('download') === '1'

  return new NextResponse(result.buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${result.fileName}"`
        : `inline; filename="${result.fileName}"`,
    },
  })
}
