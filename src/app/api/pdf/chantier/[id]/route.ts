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
