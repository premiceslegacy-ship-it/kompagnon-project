import { NextResponse } from 'next/server'
import { renderToStream } from '@react-pdf/renderer'
import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getOrganization } from '@/lib/data/queries/organization'
import {
  getChantierById,
  getChantierTaches,
  getChantierPointages,
  getChantierNotes,
} from '@/lib/data/queries/chantiers'
import ChantierPDF from '@/components/pdf/ChantierPDF'
import type { ChantierPDFPhoto } from '@/components/pdf/ChantierPDF'

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
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

  // Photos marquées include_in_report — URLs signées 1h
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

    // react-pdf ne peut pas fetcher des URLs signées Supabase directement — on convertit en base64
    const withBase64 = await Promise.all(
      photoRows.map(async p => {
        const signedUrl = urlMap.get(p.storage_path)
        if (!signedUrl) return null
        try {
          const res = await fetch(signedUrl)
          if (!res.ok) return null
          const buffer = await res.arrayBuffer()
          const mime = res.headers.get('content-type') ?? 'image/jpeg'
          const b64 = Buffer.from(buffer).toString('base64')
          return { id: p.id, url: `data:${mime};base64,${b64}`, title: p.title ?? null, caption: p.caption ?? null }
        } catch {
          return null
        }
      })
    )
    reportPhotos = withBase64.filter((p): p is ChantierPDFPhoto => p !== null)
  }

  const stream = await renderToStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(ChantierPDF, {
      chantier,
      taches,
      pointages,
      notes,
      organization,
      periodFrom: dateFrom,
      periodTo: dateTo,
      reportPhotos,
    }) as any,
  )

  const fileName = `rapport-chantier-${chantier.title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.pdf`

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${fileName}"`
        : `inline; filename="${fileName}"`,
    },
  })
}
