import { NextResponse } from 'next/server'
import { renderToStream } from '@react-pdf/renderer'
import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { getInvoiceById } from '@/lib/data/queries/invoices'
import { getOrganization } from '@/lib/data/queries/organization'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import InvoicePDF from '@/components/pdf/InvoicePDF'

async function fetchLogoAsDataUrl(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const buf = await res.arrayBuffer()
    const ct = res.headers.get('content-type') ?? 'image/png'
    return `data:${ct};base64,${Buffer.from(buf).toString('base64')}`
  } catch {
    return null
  }
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  const [invoice, organization] = await Promise.all([
    getInvoiceById(params.id),
    getOrganization(),
  ])

  if (!invoice) return new NextResponse('Facture introuvable', { status: 404 })
  if (!organization) return new NextResponse('Organisation introuvable', { status: 500 })

  const logoDataUrl = await fetchLogoAsDataUrl(organization.logo_url)
  const orgWithLogo = { ...organization, logo_url: logoDataUrl ?? organization.logo_url }

  const download = new URL(req.url).searchParams.get('download') === '1'

  const stream = await renderToStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(InvoicePDF, { invoice, organization: orgWithLogo }) as any,
  )

  const fileName = `facture-${invoice.number ?? params.id}.pdf`

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${fileName}"`
        : `inline; filename="${fileName}"`,
    },
  })
}
