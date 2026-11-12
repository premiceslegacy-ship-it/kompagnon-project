import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { getInvoicesForExport, type InvoiceForExport } from '@/lib/data/queries/invoices'
import { getAccountingPaymentData, type AccountingPaymentForExport, type CreditNoteSourceForExport } from '@/lib/data/queries/accounting-payments'
import { InvoiceIssuanceAuthorityError } from '@/lib/pdf/server'
import { getReceivedInvoicesForExport } from '@/lib/data/queries/received-invoices'
import { generateFec, buildFecFilename, type FecInvoice, type FecPayment, type FecReceivedInvoice, type FecOrgProfile } from '@/lib/exports/fec-generator'
import { generateCsv, buildCsvFilename, type CsvInvoice } from '@/lib/exports/csv-generator'
import { checkNumberingContinuity } from '@/lib/exports/numbering-check'
import { AccountingExportAuthorityError, computeVatBreakdowns, round2 } from '@/lib/exports/vat-rules'
import type { BusinessProfile } from '@/lib/exports/accounting-plan'

type ExportOptions = {
  includeInvoices: boolean
  includeAvoirs: boolean
  includePayments: boolean
  includeReceived: boolean
}

function errorResponse(error: string, status: number) {
  return NextResponse.json({ error }, { status })
}

function parseBooleanParam(value: string | null, defaultValue = true): boolean {
  if (value === null) return defaultValue
  return value !== 'false'
}

function selectedInvoiceEntries(invoices: InvoiceForExport[], options: Pick<ExportOptions, 'includeInvoices' | 'includeAvoirs'>): InvoiceForExport[] {
  return invoices.filter(inv => inv.invoice_type === 'avoir' ? options.includeAvoirs : options.includeInvoices)
}

function selectedCsvRows(
  invoices: InvoiceForExport[],
  payments: readonly AccountingPaymentForExport[],
  options: Pick<ExportOptions, 'includeInvoices' | 'includeAvoirs' | 'includePayments'>,
): InvoiceForExport[] {
  const rows = new Map<string, InvoiceForExport>()
  for (const invoice of selectedInvoiceEntries(invoices, options)) rows.set(invoice.id, invoice)
  if (options.includePayments) {
    for (const payment of payments) rows.set(payment.invoice.id, payment.invoice)
  }
  return [...rows.values()]
}

async function getCurrentRoleSlug(supabase: Awaited<ReturnType<typeof createClient>>, orgId: string, userId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('memberships')
    .select('roles(slug)')
    .eq('organization_id', orgId)
    .eq('user_id', userId)
    .eq('is_active', true)
    .single()

  if (error) {
    console.error('[exports/fec:getCurrentRoleSlug]', error)
    return null
  }

  const roles = data?.roles as { slug?: string | null } | { slug?: string | null }[] | null | undefined
  return Array.isArray(roles) ? (roles[0]?.slug ?? null) : (roles?.slug ?? null)
}

function canExportAccounting(roleSlug: string | null): boolean {
  return roleSlug === 'owner' || roleSlug === 'admin'
}

async function downloadAccountingExport(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse('Non authentifié', 401)

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return errorResponse('Organisation introuvable', 403)

  // Vérifier rôle owner ou admin
  const role = await getCurrentRoleSlug(supabase, orgId, user.id)
  if (!canExportAccounting(role)) {
    return errorResponse('Accès réservé aux administrateurs', 403)
  }

  const url = new URL(req.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const format = url.searchParams.get('format') ?? 'fec'
  const preset = (url.searchParams.get('preset') ?? 'period') as 'fiscal_year' | 'period'
  const options: ExportOptions = {
    includeInvoices: parseBooleanParam(url.searchParams.get('include_invoices')),
    includeAvoirs: parseBooleanParam(url.searchParams.get('include_avoirs')),
    includePayments: parseBooleanParam(url.searchParams.get('include_payments')),
    includeReceived: parseBooleanParam(url.searchParams.get('include_received')),
  }

  if (format !== 'fec' && format !== 'csv') {
    return errorResponse('Format d’export invalide', 400)
  }

  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return errorResponse('Paramètres from/to invalides (format YYYY-MM-DD attendu)', 400)
  }

  if (!options.includeInvoices && !options.includeAvoirs && !options.includePayments && !options.includeReceived) {
    return errorResponse('Sélectionnez au moins un contenu à exporter.', 400)
  }

  if (format === 'csv' && !options.includeInvoices && !options.includeAvoirs && !options.includePayments) {
    return errorResponse('Le CSV simplifié exporte les factures émises, les avoirs ou les paiements enregistrés. Sélectionnez au moins un de ces contenus.', 400)
  }

  const admin = createAdminClient()

  // Charger le profil organisation
  const { data: org } = await admin
    .from('organizations')
    .select('siren, siret, vat_number, is_vat_subject, business_profile, sector')
    .eq('id', orgId)
    .single()

  if (!org) return errorResponse('Organisation introuvable', 500)

  const invoices = options.includeInvoices || options.includeAvoirs
    ? await getInvoicesForExport(from, to, options) : []
  const invoiceEntries = selectedInvoiceEntries(invoices, options)
  const accounting = await getAccountingPaymentData(from, to, {
    includePayments: options.includePayments,
    creditNotes: invoiceEntries.filter(invoice => invoice.invoice_type === 'avoir'),
  })
  const invoiceIdentityRows = selectedCsvRows(invoices, accounting.payments, options)
  const sellerSirens = [...new Set(invoiceIdentityRows.map(invoice => invoice.seller_siren).filter((value): value is string => !!value))]

  if (format === 'fec' && invoiceIdentityRows.some(invoice => !invoice.seller_siren)) {
    return errorResponse('Le SIREN historique d’une facture sélectionnée est absent de son autorité d’émission.', 422)
  }
  if (format === 'fec' && sellerSirens.length > 1) {
    return errorResponse('Les factures sélectionnées relèvent de plusieurs SIREN historiques et ne peuvent pas être exportées dans un FEC unique.', 422)
  }
  if (format === 'fec' && invoiceIdentityRows.length === 0 && !org.siren) {
    return errorResponse('Le numéro SIREN est obligatoire pour générer un FEC. Complétez votre profil entreprise dans les Paramètres.', 422)
  }
  if (format === 'fec' && invoiceIdentityRows.some(invoice => invoice.is_vat_subject && !invoice.seller_vat_number)) {
    return errorResponse('Le numéro de TVA historique d’une facture assujettie est absent de son autorité d’émission.', 422)
  }
  if (format === 'fec' && options.includeReceived && org.is_vat_subject && !org.vat_number) {
    return errorResponse('Le numéro de TVA intracommunautaire est obligatoire pour les achats d’une entreprise assujettie. Complétez votre profil entreprise.', 422)
  }

  const receivedInvoices = options.includeReceived ? await getReceivedInvoicesForExport(from, to) : []

  // Vérification continuité numérotation (warning bloquant pour exercice complet)
  const numberingResult = checkNumberingContinuity(invoiceEntries.map(i => i.number))
  if (numberingResult.hasGaps && preset === 'fiscal_year' && format === 'fec') {
    const gapList = numberingResult.gaps.slice(0, 5).map(g => g.expected).join(', ')
    return errorResponse(
      `Trou(s) détecté(s) dans la numérotation des factures : ${gapList}${numberingResult.gaps.length > 5 ? '...' : ''}. La numérotation continue est obligatoire pour un FEC d'exercice complet (art. 242 nonies A annexe II CGI). Vérifiez vos factures avant d'exporter.`,
      422,
    )
  }

  const siren = sellerSirens[0] ?? org.siren ?? org.siret?.substring(0, 9) ?? 'SIREN_INCONNU'
  const orgProfile: FecOrgProfile = {
    siren,
    is_vat_subject: org.is_vat_subject ?? false,
    business_profile: (org.business_profile as BusinessProfile) ?? 'btp',
  }

  if (format === 'csv') {
    const summaries = summarizePayments(accounting.payments)
    const csvInvoices: CsvInvoice[] = invoiceIdentityRows.map(invoice => buildCsvInvoice(invoice, summaries.get(invoice.id)))
    const hasVatSubjectInvoices = csvInvoices.length > 0
      ? csvInvoices.some(invoice => invoice.is_vat_subject)
      : org.is_vat_subject ?? false
    const content = generateCsv(csvInvoices, hasVatSubjectInvoices, options.includePayments)
    const filename = buildCsvFilename(siren, from, to)

    return new NextResponse(content, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Cache-Control': 'no-store, max-age=0',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    })
  }

  // FEC
  const fecInvoices = invoiceEntries.map(invoice => buildFecInvoice(invoice, accounting.creditNoteSources))
  const fecPayments = buildFecPayments(accounting.payments, fecInvoices, accounting.creditNoteSources)
  const fecReceivedInvoices: FecReceivedInvoice[] = receivedInvoices.map(ri => ({
    id: ri.id,
    invoice_number: ri.invoice_number,
    invoice_date: ri.invoice_date,
    supplier_siret: ri.supplier_siret,
    supplier_name: ri.supplier_name,
    total_ht: ri.total_ht,
    total_tva: ri.total_tva,
    total_ttc: ri.total_ttc,
  }))

  const result = generateFec({
    invoices: fecInvoices,
    payments: fecPayments,
    receivedInvoices: fecReceivedInvoices,
    orgProfile,
    includeInvoices: options.includeInvoices,
    includeAvoirs: options.includeAvoirs,
    includePayments: options.includePayments,
    includeReceivedInvoices: options.includeReceived,
  })

  const filename = buildFecFilename(siren, from, to, preset)

  const headers: Record<string, string> = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store, max-age=0',
    'Content-Disposition': `attachment; filename="${filename}"`,
  }

  if (result.warnings.length > 0) {
    headers['X-Export-Warnings'] = encodeURIComponent(result.warnings.join(' | '))
  }
  if (numberingResult.hasGaps) {
    headers['X-Numbering-Gaps'] = 'true'
  }

  return new NextResponse(result.content, { headers })
}

// ─── Requête d'aperçu (comptage avant export) ──────────────────────────────────

async function previewAccountingExport(req: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return errorResponse('Non authentifié', 401)

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return errorResponse('Organisation introuvable', 403)

  const role = await getCurrentRoleSlug(supabase, orgId, user.id)
  if (!canExportAccounting(role)) {
    return errorResponse('Accès réservé aux administrateurs', 403)
  }

  let body: {
    from: string
    to: string
    include_invoices?: boolean
    include_avoirs?: boolean
    include_payments?: boolean
    include_received?: boolean
  }
  try {
    body = await req.json()
  } catch {
    return errorResponse('Corps JSON invalide', 400)
  }

  const {
    from,
    to,
    include_invoices = true,
    include_avoirs = true,
    include_payments = true,
    include_received = true,
  } = body
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return errorResponse('Paramètres from/to invalides (format YYYY-MM-DD attendu)', 400)
  }

  const options: ExportOptions = {
    includeInvoices: include_invoices,
    includeAvoirs: include_avoirs,
    includePayments: include_payments,
    includeReceived: include_received,
  }

  const invoices = options.includeInvoices || options.includeAvoirs
    ? await getInvoicesForExport(from, to, options) : []
  const invoiceEntries = selectedInvoiceEntries(invoices, options)
  const accounting = await getAccountingPaymentData(from, to, {
    includePayments: options.includePayments,
    creditNotes: invoiceEntries.filter(invoice => invoice.invoice_type === 'avoir'),
  })
  const receivedInvoices = options.includeReceived ? await getReceivedInvoicesForExport(from, to) : []
  const numberingResult = checkNumberingContinuity(invoiceEntries.map(i => i.number))

  const vatBreakdownTotals = { base20: 0, base10: 0, base55: 0, tva20: 0, tva10: 0, tva55: 0, total: 0 }
  let autoLiqCount = 0

  for (const inv of invoiceEntries) {
    if (!inv.number) continue
    const bds = computeVatBreakdowns(inv.items, {
      isVatSubject: inv.is_vat_subject, isReverseCharge: inv.is_reverse_charge,
      issuedBreakdown: inv.vat_breakdown, issuedTotalHt: inv.total_ht, issuedTotalVat: inv.total_tva,
    })
    for (const bd of bds) {
      if (bd.rate === 20) { vatBreakdownTotals.base20 += bd.baseHt; vatBreakdownTotals.tva20 += bd.vatAmount }
      if (bd.rate === 10) { vatBreakdownTotals.base10 += bd.baseHt; vatBreakdownTotals.tva10 += bd.vatAmount }
      if (bd.rate === 5.5) { vatBreakdownTotals.base55 += bd.baseHt; vatBreakdownTotals.tva55 += bd.vatAmount }
    }
    vatBreakdownTotals.total += inv.total_tva
    if (inv.is_reverse_charge && inv.total_ttc > 0) {
      autoLiqCount++
    }
  }

  const acomptes = options.includeInvoices ? invoices.filter(i => i.invoice_type === 'acompte') : []
  const avoirs = options.includeAvoirs ? invoices.filter(i => i.invoice_type === 'avoir') : []

  const estimatedLines =
    invoiceEntries.length * 2 +
    (accounting.payments.length * 2) +
    receivedInvoices.length * 2

  return NextResponse.json({
    invoiceCount: options.includeInvoices ? invoices.filter(i => i.invoice_type !== 'avoir').length : 0,
    acompteCount: acomptes.length,
    avoirCount: avoirs.length,
    paymentCount: accounting.payments.length,
    receivedInvoiceCount: receivedInvoices.length,
    autoLiqCount,
    vatBreakdowns: vatBreakdownTotals,
    estimatedLines,
    numberingHasGaps: numberingResult.hasGaps,
    numberingGaps: numberingResult.gaps.slice(0, 5).map(g => g.expected),
  })
}

// ─── Helpers de mapping ─────────────────────────────────────────────────────────

function clientDisplayName(client: InvoiceForExport['client']): string {
  if (!client) return ''
  return client.company_name
    ?? client.contact_name
    ?? [client.first_name, client.last_name].filter(Boolean).join(' ')
}

function buildFecInvoice(inv: InvoiceForExport, credits: ReadonlyMap<string, CreditNoteSourceForExport>): FecInvoice {
  if (!inv.number || !inv.issue_date) throw new AccountingExportAuthorityError()
  const source = credits.get(inv.id)
  return {
    id: inv.id,
    number: inv.number ?? '',
    invoice_type: inv.invoice_type as FecInvoice['invoice_type'],
    issue_date: inv.issue_date ?? '',
    total_ht: inv.total_ht,
    total_tva: inv.total_tva,
    total_ttc: inv.total_ttc,
    vat_breakdown: inv.vat_breakdown,
    applied_acompte_ht: inv.applied_acompte_ht,
    credit_note_source: source ? {
      invoice_type: source.invoice_type as FecInvoice['invoice_type'],
      paid_amount_before_credit: source.paid_amount_before_credit,
    } : null,
    is_vat_subject: inv.is_vat_subject,
    is_reverse_charge: inv.is_reverse_charge,
    tva_sur_debits: inv.tva_sur_debits,
    business_profile: (inv.business_profile as BusinessProfile | null) ?? null,
    pa_message_id: inv.pa_message_id,
    client: inv.client ? {
      id: inv.client.id,
      display_name: clientDisplayName(inv.client),
      siret: inv.client.siret,
    } : null,
    items: inv.items,
    chantier_title: inv.chantier_title,
  }
}

function buildCsvInvoice(inv: InvoiceForExport, summary?: PaymentSummary): CsvInvoice {
  const bds = computeVatBreakdowns(inv.items, {
    isVatSubject: inv.is_vat_subject, isReverseCharge: inv.is_reverse_charge,
    issuedBreakdown: inv.vat_breakdown, issuedTotalHt: inv.total_ht, issuedTotalVat: inv.total_tva,
  })
  return {
    number: inv.number ?? '',
    issue_date: inv.issue_date,
    invoice_type: inv.invoice_type,
    client_name: clientDisplayName(inv.client),
    client_siret: inv.client?.siret ?? null,
    total_ht: inv.total_ht,
    total_tva: inv.total_tva,
    total_ttc: inv.total_ttc,
    total_paid: inv.total_paid,
    credited_ttc: inv.credited_ttc,
    paid_in_period: round2(summary?.amount ?? 0),
    last_payment_in_period: summary?.lastDate ?? null,
    status: inv.status,
    chantier_title: inv.chantier_title,
    tva_sur_debits: inv.tva_sur_debits,
    is_vat_subject: inv.is_vat_subject,
    has_auto_liquidation: inv.is_reverse_charge,
    pa_message_id: inv.pa_message_id,
    vat_breakdown: bds.map(bd => ({
      rate: bd.rate,
      base_ht: bd.baseHt,
      vat_amount: bd.vatAmount,
    })),
  }
}

type PaymentSummary = { amount: number; lastDate: string }

function summarizePayments(payments: readonly AccountingPaymentForExport[]): Map<string, PaymentSummary> {
  const summaries = new Map<string, PaymentSummary>()
  for (const payment of payments) {
    const summary = summaries.get(payment.invoice.id)
    if (summary) {
      summary.amount += payment.amount
      if (payment.payment_date > summary.lastDate) summary.lastDate = payment.payment_date
    } else {
      summaries.set(payment.invoice.id, { amount: payment.amount, lastDate: payment.payment_date })
    }
  }
  return summaries
}

function buildFecPayments(
  payments: readonly AccountingPaymentForExport[],
  invoices: readonly FecInvoice[],
  credits: ReadonlyMap<string, CreditNoteSourceForExport>,
): FecPayment[] {
  const contexts = new Map(invoices.map(invoice => [invoice.id, invoice]))
  return payments.map(payment => {
    let invoice = contexts.get(payment.invoice.id)
    if (!invoice) {
      invoice = buildFecInvoice(payment.invoice, credits)
      contexts.set(invoice.id, invoice)
    }
    return {
      id: payment.id, invoice, amount: payment.amount, payment_date: payment.payment_date,
      reference: payment.reference, prior_paid_amount: payment.prior_paid_amount,
    }
  })
}

function accountingErrorResponse(error: unknown) {
  if (error instanceof InvoiceIssuanceAuthorityError || error instanceof AccountingExportAuthorityError) {
    return errorResponse(error.message, 409)
  }
  console.error('[exports/fec] accounting export failed:', error)
  return errorResponse('Impossible de préparer cet export comptable.', 500)
}

export async function GET(req: Request) {
  try {
    return await downloadAccountingExport(req)
  } catch (error) {
    return accountingErrorResponse(error)
  }
}

export async function POST(req: Request) {
  try {
    return await previewAccountingExport(req)
  } catch (error) {
    return accountingErrorResponse(error)
  }
}
