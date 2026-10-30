import { NextResponse } from 'next/server'
import { pdfResponse } from '@/lib/pdf/response'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { InvoiceIssuanceAuthorityError, renderInvoicePdfBufferById } from '@/lib/pdf/server'
import type { InvoicePdfResult } from '@/lib/pdf/server'
import { isValidUuid } from '@/lib/security'

export async function GET(
  req: Request,
  { params: paramsPromise }: { params: Promise<{ id: string }> },
) {
  const params = await paramsPromise
  if (!isValidUuid(params.id)) return new NextResponse('Facture introuvable', { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  // Vérifier que la facture appartient à cette org
  const { data: inv, error: invErr } = await supabase
    .from('invoices')
    .select('organization_id')
    .eq('id', params.id)
    .maybeSingle()

  if (invErr) {
    console.error('[GET /api/pdf/invoice] lookup error:', invErr)
    return new NextResponse('Erreur serveur', { status: 500 })
  }
  if (!inv) return new NextResponse('Facture introuvable', { status: 404 })
  if (inv.organization_id !== orgId) return new NextResponse('Accès refusé', { status: 403 })

  let result: InvoicePdfResult | null
  try {
    result = await renderInvoicePdfBufferById(params.id, orgId)
  } catch (err) {
    if (err instanceof InvoiceIssuanceAuthorityError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 409 })
    }
    console.error('[GET /api/pdf/invoice] render error:', err)
    return new NextResponse('Erreur génération PDF', { status: 500 })
  }
  if (!result) return new NextResponse('Facture introuvable', { status: 404 })

  const download = new URL(req.url).searchParams.get('download') === '1'

  return pdfResponse(result.buffer, result.fileName, { download })
}
