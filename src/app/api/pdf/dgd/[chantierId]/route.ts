import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { renderDgdPdfBufferByChantierId } from '@/lib/pdf/server'

export async function GET(
  req: Request,
  { params }: { params: { chantierId: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifie', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  const { data: chantier } = await supabase
    .from('chantiers')
    .select('organization_id')
    .eq('id', params.chantierId)
    .single()

  if (!chantier) return new NextResponse('Chantier introuvable', { status: 404 })
  if (chantier.organization_id !== orgId) return new NextResponse('Acces refuse', { status: 403 })

  let result
  try {
    result = await renderDgdPdfBufferByChantierId(params.chantierId, orgId)
  } catch (err) {
    console.error('[GET /api/pdf/dgd] render error:', err)
    return new NextResponse(`Erreur generation PDF: ${err instanceof Error ? err.message : 'inconnue'}`, { status: 500 })
  }
  if (!result) return new NextResponse('Erreur generation PDF', { status: 500 })

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
