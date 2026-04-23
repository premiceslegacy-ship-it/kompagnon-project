import { NextResponse } from 'next/server'
import { renderToStream } from '@react-pdf/renderer'
import React from 'react'
import { createClient } from '@/lib/supabase/server'
import { getQuoteById } from '@/lib/data/queries/quotes'
import { getOrganization } from '@/lib/data/queries/organization'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import QuotePDF from '@/components/pdf/QuotePDF'
import type { Client } from '@/lib/data/queries/clients'

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
  // 1. Auth check
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  // 2. Load quote + verify it belongs to this org
  const quote = await getQuoteById(params.id)
  if (!quote) return new NextResponse('Devis introuvable', { status: 404 })

  // Verify ownership
  const { data: quoteOrg } = await supabase
    .from('quotes')
    .select('organization_id')
    .eq('id', params.id)
    .single()

  if (quoteOrg?.organization_id !== orgId) {
    return new NextResponse('Accès refusé', { status: 403 })
  }

  // 3. Load organization + client
  const organization = await getOrganization()
  if (!organization) return new NextResponse('Organisation introuvable', { status: 500 })

  const logoDataUrl = await fetchLogoAsDataUrl(organization.logo_url)
  const orgWithLogo = { ...organization, logo_url: logoDataUrl ?? organization.logo_url }

  let client: Client | null = null
  if (quote.client) {
    const { data } = await supabase
      .from('clients')
      .select('*')
      .eq('id', quote.client.id)
      .single()
    client = data as Client | null
  }

  // 4. Also fetch notes_client and payment_conditions (not in QuoteWithItems by default)
  const { data: quoteExtra } = await supabase
    .from('quotes')
    .select('notes_client, payment_conditions')
    .eq('id', params.id)
    .single()

  const fullQuote = {
    ...quote,
    notes_client: quoteExtra?.notes_client ?? null,
    payment_conditions: quoteExtra?.payment_conditions ?? null,
  }

  // 5. Render PDF
  const download = new URL(req.url).searchParams.get('download') === '1'

  const stream = await renderToStream(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement(QuotePDF, { quote: fullQuote, organization: orgWithLogo, client }) as any,
  )

  const fileName = `devis-${quote.number ?? params.id}.pdf`

  return new NextResponse(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': download
        ? `attachment; filename="${fileName}"`
        : `inline; filename="${fileName}"`,
    },
  })
}
