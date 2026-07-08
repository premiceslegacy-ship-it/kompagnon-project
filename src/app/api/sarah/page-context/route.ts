import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'

import { CHANTIER_STATUS_LABELS, INVOICE_STATUS_LABELS, QUOTE_STATUS_LABELS, humanStatus } from '@/lib/status-labels'
import { CLIENT_NAME_JOIN, clientNameFromJoin } from '@/lib/client'

export const dynamic = 'force-dynamic'

// Retourne un label contextuel riche pour la page courante, en résolvant les IDs en noms réels
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  // Le client transmet le pathname ET la query string de la page courante
  // combinés (ex: "/finances/invoice-editor?id=..."), car les éditeurs
  // identifient leur document par un paramètre de requête, pas un segment
  // de chemin. On les sépare ici pour retrouver les search params de la page.
  const rawPathname = searchParams.get('pathname') ?? '/'
  const [pathname, pageQueryString] = rawPathname.split('?')
  const pageSearchParams = new URLSearchParams(pageQueryString ?? '')

  try {
    const orgId = await getCurrentOrganizationId()
    if (!orgId) return NextResponse.json({ label: 'Atelier', context: null })
    if (!await hasPermission('ai.sarah')) {
      return NextResponse.json({ label: getStaticLabel(pathname), context: null })
    }

    const supabase = await createClient()

    // Fiche chantier (/chantiers/[id])
    const chantierMatch = pathname.match(/\/chantiers\/([a-zA-Z0-9_-]+)$/)
    if (chantierMatch && !pathname.includes('/planning') && !pathname.includes('/entretien')) {
      const chantierId = chantierMatch[1]
      const { data } = await supabase
        .from('chantiers')
        .select('title, status, client:clients(company_name, contact_name, first_name, last_name)')
        .eq('id', chantierId)
        .eq('organization_id', orgId)
        .single()

      if (data) {
        const client = (data.client as unknown) as { company_name: string | null; contact_name: string | null; first_name: string | null; last_name: string | null } | null
        const clientName = client?.company_name
          ?? (client?.first_name || client?.last_name ? `${client.first_name ?? ''} ${client.last_name ?? ''}`.trim() : null)
          ?? client?.contact_name
          ?? null
        return NextResponse.json({
          label: `Chantier "${data.title}"`,
          context: {
            type: 'chantier',
            id: chantierId,
            title: data.title,
            status: humanStatus(CHANTIER_STATUS_LABELS, data.status),
            clientName,
          },
        })
      }
    }

    // Fiche client (/clients/[id])
    const clientMatch = pathname.match(/\/clients\/([a-zA-Z0-9_-]+)/)
    if (clientMatch) {
      const clientId = clientMatch[1]
      const { data } = await supabase
        .from('clients')
        .select('company_name, contact_name, first_name, last_name, type')
        .eq('id', clientId)
        .eq('organization_id', orgId)
        .single()

      if (data) {
        const name = data.company_name
          ?? (data.first_name || data.last_name ? `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim() : null)
          ?? data.contact_name
          ?? 'Client'
        return NextResponse.json({
          label: `Client : ${name}`,
          context: { type: 'client', id: clientId, name, clientType: data.type },
        })
      }
    }

    // Éditeur de devis (/finances/quote-editor?id=...)
    const isQuoteEditor = pathname.includes('/quote-editor')
    const quoteId = isQuoteEditor
      ? pageSearchParams.get('id') ?? pathname.match(/\/quote-editor\/([a-zA-Z0-9_-]+)/)?.[1]
      : null
    if (quoteId || isQuoteEditor) {
      if (quoteId) {
        const { data } = await supabase
          .from('quotes')
          .select(`reference, status, total_ttc, ${CLIENT_NAME_JOIN}`)
          .eq('id', quoteId)
          .eq('organization_id', orgId)
          .single()
        if (data) {
          const clientName = clientNameFromJoin((data as any).client)
          return NextResponse.json({
            label: `Devis ${data.reference}${clientName ? ` — ${clientName}` : ''}`,
            context: { type: 'quote', id: quoteId, reference: data.reference, status: humanStatus(QUOTE_STATUS_LABELS, data.status), clientName, totalTtc: data.total_ttc },
          })
        }
      }
      return NextResponse.json({ label: 'Editeur de devis', context: { type: 'quote' } })
    }

    // Éditeur de facture (/finances/invoice-editor?id=...)
    const isInvoiceEditor = pathname.includes('/invoice-editor')
    const invoiceId = isInvoiceEditor
      ? pageSearchParams.get('id') ?? pathname.match(/\/invoice-editor\/([a-zA-Z0-9_-]+)/)?.[1]
      : null
    if (invoiceId || isInvoiceEditor) {
      if (invoiceId) {
        const { data } = await supabase
          .from('invoices')
          .select(`number, status, total_ttc, ${CLIENT_NAME_JOIN}`)
          .eq('id', invoiceId)
          .eq('organization_id', orgId)
          .single()
        if (data) {
          const clientName = clientNameFromJoin((data as any).client)
          return NextResponse.json({
            label: `Facture ${data.number}${clientName ? ` — ${clientName}` : ''}`,
            context: { type: 'invoice', id: invoiceId, reference: data.number, status: humanStatus(INVOICE_STATUS_LABELS, data.status), clientName, totalTtc: data.total_ttc },
          })
        }
      }
      return NextResponse.json({ label: 'Editeur de facture', context: { type: 'invoice' } })
    }

    // Pages statiques — pas besoin de BDD
    return NextResponse.json({ label: getStaticLabel(pathname), context: null })
  } catch {
    return NextResponse.json({ label: getStaticLabel(pathname), context: null })
  }
}

function getStaticLabel(pathname: string): string {
  if (pathname.includes('/chantiers/planning')) return 'Planning global'
  if (pathname.includes('/chantiers/entretien')) return 'Entretien & maintenance'
  if (pathname.includes('/chantiers')) return 'Chantiers'
  if (pathname.includes('/finances/recurring')) return 'Factures récurrentes'
  if (pathname.includes('/finances')) return 'Finances'
  if (pathname.includes('/clients')) return 'Clients'
  if (pathname.includes('/dashboard')) return 'Tableau de bord'
  if (pathname.includes('/atelier-ia')) return 'Atelier IA'
  if (pathname.includes('/rapports')) return 'Rapports'
  if (pathname.includes('/settings')) return 'Paramètres'
  return 'Atelier'
}
