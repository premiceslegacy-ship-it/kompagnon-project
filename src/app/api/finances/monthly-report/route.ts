import { NextResponse } from 'next/server'
import JSZip from 'jszip'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { INVOICE_ISSUANCE_AUTHORITY_ERROR_MESSAGE, InvoiceIssuanceAuthorityError, isInvoiceIssuanceSnapshot, renderInvoicePdfBufferById, type InvoicePdfResult } from '@/lib/pdf/server'
import { renderMonthlyReportPdf, type MonthlyReportData, type ReportInvoice, type ReportQuote } from '@/lib/pdf/documents/monthly-report'

function pdfOrigin(): string {
  const origin = process.env.NEXT_PUBLIC_APP_URL
  if (!origin) throw new Error('NEXT_PUBLIC_APP_URL manquant — requis pour charger les polices PDF')
  return origin
}

const REPORTABLE_INVOICE_STATUS: Record<string, true> = {
  sent: true, viewed: true, partial: true, paid: true, overdue: true,
}
const REPORTABLE_INVOICE_STATUSES = Object.keys(REPORTABLE_INVOICE_STATUS)
const REPORTABLE_QUOTE_STATUSES = ['sent', 'viewed', 'accepted', 'refused', 'expired', 'converted', 'fully_invoiced'] as const

function isReportableInvoiceStatus(status: string | null | undefined): boolean {
  return typeof status === 'string' && Object.hasOwn(REPORTABLE_INVOICE_STATUS, status)
}

type MonthlyPayment = {
  id: string
  amount: number | null
  payment_date: string | null
}

type MonthlyInvoiceRecord = {
  id: string
  status: string
  issuance_snapshot: unknown
  total_paid: number | null
  paid_at: string | null
  payments?: MonthlyPayment[] | null
}

type MonthlyPaymentWithInvoice = MonthlyPayment & {
  invoice: MonthlyInvoiceRecord | MonthlyInvoiceRecord[] | null
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}


export async function GET(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Non authentifié', { status: 401 })

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return new NextResponse('Organisation introuvable', { status: 403 })

  const month = new URL(req.url).searchParams.get('month') // YYYY-MM
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return new NextResponse('Paramètre month invalide (format YYYY-MM attendu)', { status: 400 })
  }

  const monthStart = `${month}-01`
  const [y, m] = month.split('-').map(Number)
  const nextMonth = new Date(y, m, 1) // 1er du mois suivant
  const monthEnd = `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}-01`

  const admin = createAdminClient()

  // ── Charger organisation ──────────────────────────────────────────────────
  const { data: orgData } = await admin
    .from('organizations')
    .select('name, siret, email, logo_url')
    .eq('id', orgId)
    .single()

  if (!orgData) return new NextResponse('Organisation introuvable', { status: 500 })

  // Archiving only hides an invoice from day-to-day views. It does not cancel
  // its issuance or remove its recorded cash from the monthly export.
  // ── Charger factures du mois ──────────────────────────────────────────────
  const { data: rawInvoices, error: invoicesError } = await admin
    .from('invoices')
    .select(`
      id, status, issuance_snapshot, total_paid, paid_at,
      payments:payments(id, amount, payment_date)
    `)
    .eq('organization_id', orgId)
    .in('status', REPORTABLE_INVOICE_STATUSES)
    .gte('issue_date', monthStart)
    .lt('issue_date', monthEnd)
    .order('issue_date', { ascending: true })

  // Factures encaissées sur le mois, même si elles ont été émises avant.
  const { data: rawPayments, error: paymentsError } = await admin
    .from('payments')
    .select(`
      id, amount, payment_date,
      invoice:invoices!inner(
        id, status, issuance_snapshot, total_paid, paid_at,
        payments:payments(id, amount, payment_date)
      )
    `)
    .eq('organization_id', orgId)
    .gte('payment_date', monthStart)
    .lt('payment_date', monthEnd)

  // Compatibilité avec les factures marquées payées avant l'historique détaillé des paiements.
  const { data: rawPaidInvoices, error: paidInvoicesError } = await admin
    .from('invoices')
    .select(`
      id, status, issuance_snapshot, total_paid, paid_at,
      payments:payments(id, amount, payment_date)
    `)
    .eq('organization_id', orgId)
    .eq('status', 'paid')
    .gte('paid_at', monthStart)
    .lt('paid_at', monthEnd)
  if (invoicesError || paymentsError || paidInvoicesError) {
    console.error('[monthly-report] invoice authority source query failed:', {
      invoicesError,
      paymentsError,
      paidInvoicesError,
    })
    return new NextResponse('Impossible de vérifier l’intégralité des factures émises pour ce rapport.', { status: 500 })
  }


  const invoiceRows = (rawInvoices ?? []) as unknown as MonthlyInvoiceRecord[]
  const paidInvoiceRows = (rawPaidInvoices ?? []) as unknown as MonthlyInvoiceRecord[]
  const paymentRows = (rawPayments ?? []) as unknown as MonthlyPaymentWithInvoice[]
  const paymentInvoices = paymentRows
    .map(payment => Array.isArray(payment.invoice) ? payment.invoice[0] : payment.invoice)
    .filter((invoice): invoice is MonthlyInvoiceRecord =>
      invoice !== null && isReportableInvoiceStatus(invoice.status),
    )
  const invoiceSources = [...invoiceRows, ...paidInvoiceRows, ...paymentInvoices]
  if (invoiceSources.some(invoice => !isInvoiceIssuanceSnapshot(invoice.issuance_snapshot, invoice.id))) {
    return new NextResponse(INVOICE_ISSUANCE_AUTHORITY_ERROR_MESSAGE, { status: 409 })
  }

  // ── Charger devis du mois ─────────────────────────────────────────────────
  const { data: rawQuotes } = await admin
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, currency, created_at,
      client:clients(company_name, contact_name, first_name, last_name, email)
    `)
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .in('status', REPORTABLE_QUOTE_STATUSES)
    .gte('created_at', monthStart)
    .lt('created_at', monthEnd)
    .order('created_at', { ascending: true })

  // ── Normaliser les données ─────────────────────────────────────────────────
  function clientName(client: Record<string, unknown> | null): string | null {
    if (!client) return null
    const company = stringValue(client.company_name)
    const first = stringValue(client.first_name)
    const last = stringValue(client.last_name)
    const contact = stringValue(client.contact_name)
    const email = stringValue(client.email)
    return company ?? ([first, last].filter(Boolean).join(' ') || contact || email || null)
  }

  function normalizeInvoice(invoice: MonthlyInvoiceRecord): ReportInvoice {
    if (!isInvoiceIssuanceSnapshot(invoice.issuance_snapshot, invoice.id)) {
      throw new Error(INVOICE_ISSUANCE_AUTHORITY_ERROR_MESSAGE)
    }
    const facts = invoice.issuance_snapshot.invoice
    const items = invoice.issuance_snapshot.items
    const internalTotal = items.reduce((sum, item) => {
      const unitCost = item.unit_cost_ht == null
        ? (item.is_internal === true ? numberValue(item.unit_price) : 0)
        : numberValue(item.unit_cost_ht)
      return sum + unitCost * numberValue(item.quantity)
    }, 0)
    const payments = (invoice.payments ?? []).map(payment => ({
      id: payment.id,
      amount: payment.amount ?? 0,
      payment_date: payment.payment_date,
    }))

    return {
      id: invoice.id,
      number: stringValue(facts.number),
      title: stringValue(facts.title),
      status: invoice.status,
      invoice_type: stringValue(facts.invoice_type) ?? 'standard',
      total_ht: numberValue(facts.total_ht),
      total_tva: numberValue(facts.total_tva),
      total_ttc: numberValue(facts.total_ttc),
      total_paid: invoice.total_paid ?? 0,
      currency: stringValue(facts.currency) ?? 'EUR',
      issue_date: stringValue(facts.issue_date),
      due_date: stringValue(facts.due_date),
      paid_at: invoice.paid_at,
      created_at: stringValue(facts.created_at) ?? stringValue(facts.issue_date) ?? '',
      client_name: clientName(invoice.issuance_snapshot.buyer),
      items_cost_total: internalTotal,
      payments,
    }
  }

  const invoiceMap = new Map<string, ReportInvoice>()
  invoiceRows.forEach(invoice => {
    invoiceMap.set(invoice.id, normalizeInvoice(invoice))
  })
  paidInvoiceRows.forEach(invoice => {
    if (!invoiceMap.has(invoice.id)) invoiceMap.set(invoice.id, normalizeInvoice(invoice))
  })
  paymentRows.forEach(payment => {
    const invoice = Array.isArray(payment.invoice) ? payment.invoice[0] : payment.invoice
    if (!invoice || !isReportableInvoiceStatus(invoice.status)) return

    const normalized = invoiceMap.get(invoice.id) ?? normalizeInvoice(invoice)
    if (!normalized.payments.some(existing => existing.id === payment.id)) {
      normalized.payments.push({
        id: payment.id,
        amount: payment.amount ?? 0,
        payment_date: payment.payment_date,
      })
    }
    invoiceMap.set(invoice.id, normalized)
  })
  const invoices = Array.from(invoiceMap.values())
    .sort((a, b) => (a.issue_date ?? a.created_at).localeCompare(b.issue_date ?? b.created_at))

  const quotes: ReportQuote[] = (rawQuotes ?? []).map((q: any) => {
    const c = Array.isArray(q.client) ? q.client[0] : q.client
    return {
      id: q.id,
      number: q.number,
      title: q.title,
      status: q.status,
      total_ht: q.total_ht ?? 0,
      currency: q.currency ?? 'EUR',
      created_at: q.created_at,
      client_name: clientName(c),
    }
  })


  // ── Générer le PDF de synthèse ────────────────────────────────────────────
  const reportData: MonthlyReportData = { month, organization: orgData, invoices, quotes }
  const reportBuffer = await renderMonthlyReportPdf(reportData, pdfOrigin())

  // ── Construire le ZIP ─────────────────────────────────────────────────────
  const zip = new JSZip()
  zip.file(`rapport-${month}.pdf`, reportBuffer)

  const facturesFolder = zip.folder('factures')!
  for (const invoice of invoices) {
    let result: InvoicePdfResult | null
    try {
      result = await renderInvoicePdfBufferById(invoice.id, orgId)
    } catch (err) {
      if (err instanceof InvoiceIssuanceAuthorityError) {
        return new NextResponse(err.message, { status: 409 })
      }
      console.error('[GET /api/finances/monthly-report] invoice PDF error:', err)
      return new NextResponse('Erreur génération du PDF de facture', { status: 500 })
    }
    if (!result) return new NextResponse('Facture introuvable pendant la création de l’archive', { status: 404 })
    facturesFolder.file(result.fileName, result.buffer)
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })

  const MONTHS_FR = ['janvier', 'fevrier', 'mars', 'avril', 'mai', 'juin', 'juillet', 'aout', 'septembre', 'octobre', 'novembre', 'decembre']
  const [yr, mo] = month.split('-').map(Number)
  const zipName = `atelier-${MONTHS_FR[mo - 1]}-${yr}.zip`

  return new NextResponse(zipBuffer, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
    },
  })
}
