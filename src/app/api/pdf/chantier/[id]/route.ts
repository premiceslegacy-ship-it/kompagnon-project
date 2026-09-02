import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getOrganization } from '@/lib/data/queries/organization'
import {
  getChantierById,
  getChantierTaches,
  getChantierPointages,
  getChantierNotes,
} from '@/lib/data/queries/chantiers'
import { renderChantierPdf, type ChantierPDFPhoto } from '@/lib/pdf/documents/chantier'
import { isValidUuid } from '@/lib/security'

function pdfOrigin(): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) throw new Error('NEXT_PUBLIC_APP_URL manquant — requis pour charger les polices PDF')
  return origin
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  if (!isValidUuid(params.id)) return new NextResponse('Chantier introuvable', { status: 404 })

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  const url = new URL(req.url)
  const dateFrom = url.searchParams.get('from') ?? null   // YYYY-MM-DD
  const dateTo   = url.searchParams.get('to')   ?? null   // YYYY-MM-DD
  const download = url.searchParams.get('download') === '1'

  const [chantier, taches, allPointages, allNotes, organization] = await Promise.all([
    getChantierById(params.id),
    getChantierTaches(params.id),
    getChantierPointages(params.id),
    getChantierNotes(params.id),
    getOrganization(),
  ])

  if (!chantier) return new NextResponse('Chantier introuvable', { status: 404 })
  if (!organization) return new NextResponse('Organisation introuvable', { status: 500 })

  // Filtrer pointages et notes par période si fournie
  const pointages = allPointages.filter(p => {
    if (dateFrom && p.date < dateFrom) return false
    if (dateTo   && p.date > dateTo)   return false
    return true
  })

  const notes = allNotes.filter(n => {
    const d = n.created_at.split('T')[0]
    if (dateFrom && d < dateFrom) return false
    if (dateTo   && d > dateTo)   return false
    return true
  })

  // Photos marquées include_in_report - URLs signées 1h
  const { data: photoRows } = await supabase
    .from('chantier_photos')
    .select('id, storage_path, title, caption')
    .eq('chantier_id', params.id)
    .eq('include_in_report', true)
    .order('created_at', { ascending: true })

  let reportPhotos: ChantierPDFPhoto[] = []
  if (photoRows && photoRows.length > 0) {
    const paths = photoRows.map(r => r.storage_path as string)
    const { data: signedUrls } = await supabase.storage
      .from('chantier-photos')
      .createSignedUrls(paths, 3600)
    const urlMap = new Map<string, string>()
    signedUrls?.forEach(item => { if (item.signedUrl && item.path) urlMap.set(item.path, item.signedUrl) })

    // pdf-lib ne peut pas fetcher des URLs signées Supabase directement - on convertit en base64
    const withBase64 = await Promise.all(
      photoRows.map(async p => {
        const signedUrl = urlMap.get(p.storage_path)
        if (!signedUrl) {
          console.error('[pdf/chantier] pas d\'URL signée', { photoId: p.id, path: p.storage_path })
          return null
        }
        try {
          const res = await fetch(signedUrl, { signal: AbortSignal.timeout(10_000) })
          if (!res.ok) {
            console.error('[pdf/chantier] fetch photo echoue', { photoId: p.id, status: res.status })
            return null
          }
          const buffer = await res.arrayBuffer()
          const mime = res.headers.get('content-type') ?? 'image/jpeg'
          const b64 = Buffer.from(buffer).toString('base64')
          return { id: p.id, url: `data:${mime};base64,${b64}`, title: p.title ?? null, caption: p.caption ?? null }
        } catch (err) {
          console.error('[pdf/chantier] fetch photo exception', { photoId: p.id, err: err instanceof Error ? err.message : String(err) })
          return null
        }
      })
    )
    reportPhotos = withBase64.filter((p): p is ChantierPDFPhoto => p !== null)
  }

  void pointages

  let buffer: Buffer
  try {
    buffer = await renderChantierPdf({
      chantier,
      taches,
      notes,
      organization,
      periodFrom: dateFrom,
      periodTo: dateTo,
      reportPhotos,
    }, pdfOrigin())
  } catch (e) {
    console.error('[pdf/chantier] renderChantierPdf error:', e)
    return new NextResponse(`Erreur génération PDF: ${e instanceof Error ? e.message : String(e)}`, { status: 500 })
  }

  const fileName = `rapport-chantier-${chantier.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${fileName}"`
        : `inline; filename="${fileName}"`,
    },
  })
}
