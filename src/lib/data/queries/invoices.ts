import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { roundMoney } from '@/lib/utils/money'
import { getCurrentOrganizationId } from './clients'
import { isInvoiceIssuanceSnapshot, InvoiceIssuanceAuthorityError } from '@/lib/pdf/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'sending' | 'sent' | 'viewed' | 'paid' | 'partial' | 'overdue' | 'cancelled'
export type InvoiceType = 'standard' | 'acompte' | 'situation' | 'solde' | 'avoir'

export type PaymentScheduleItem = {
  id: string
  invoice_id: string
  label: string
  due_date: string
  amount: number
  amount_type: 'amount' | 'percentage'
  percentage: number | null
  position: number
  paid_payment_id: string | null
  paid_amount?: number
  remaining_amount?: number
  is_paid?: boolean
}

export type Invoice = {
  id: string
  number: string | null
  title: string | null
  status: InvoiceStatus
  invoice_type: InvoiceType
  total_ht: number | null
  total_ttc: number | null
  credited_ttc?: number
  total_paid: number | null
  currency: string
  issue_date: string | null
  due_date: string | null
  balance_due_date: string | null
  sent_at: string | null
  paid_at: string | null
  created_at: string
  quote_id: string | null
  chantier_id: string | null
  period_from: string | null
  period_to: string | null
  billing_period_key?: string | null
  generation_source?: string | null
  client: {
    id: string
    company_name: string | null
    email: string | null
  } | null
}

export type InvoiceItem = {
  id: string
  description: string | null
  quantity: number
  unit: string | null
  unit_price: number
  unit_cost_ht: number | null
  vat_rate: number
  position: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dim_quantity: number
  is_internal: boolean
  material_id: string | null
}

export type InvoiceWithItems = {
  id: string
  number: string | null
  title: string | null
  status: InvoiceStatus
  invoice_type: InvoiceType
  total_ht: number | null
  total_tva: number | null
  total_ttc: number | null
  credited_ttc?: number
  total_paid: number | null
  currency: string
  issue_date: string | null
  due_date: string | null
  sent_at: string | null
  paid_at: string | null
  created_at: string
  notes_client: string | null
  payment_conditions: string | null
  aid_label: string | null
  aid_amount: number | null
  quote_id: string | null
  chantier_id: string | null
  client_id: string | null
  // Champs situations de travaux
  situation_number: number | null
  cumulative_pct: number | null
  period_from: string | null
  period_to: string | null
  retention_pct: number | null
  retention_amount: number | null
  market_reference: string | null
  is_reverse_charge: boolean
  invoice_type_code?: string | null
  credit_note_for?: string | null
  preceding_invoice_ref?: string | null
  preceding_invoice_date?: string | null
  billing_period_key?: string | null
  generation_source?: string | null
  quote_number: string | null
  pa_status?: string | null
  pa_message_id?: string | null
  client: {
    id: string
    company_name: string | null
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
    address_line1: string | null
    postal_code: string | null
    city: string | null
    siret: string | null
    siren: string | null
    vat_number: string | null
    type: string | null
  } | null
  items: InvoiceItem[]
  payment_schedule: PaymentScheduleItem[]
}

// ─── Situations de travaux ────────────────────────────────────────────────────

export type SituationSummaryItem = {
  id: string
  number: string | null
  title: string | null
  status: InvoiceStatus
  invoice_type: InvoiceType
  situation_number: number | null
  cumulative_pct: number | null
  total_ht: number | null
  total_ttc: number | null
  period_from: string | null
  period_to: string | null
  retention_pct: number | null
  retention_amount: number | null
  issue_date: string | null
  created_at: string
}

export type SituationsSummary = {
  quoteId: string
  quoteHt: number
  quoteTitle: string | null
  quoteNumber: string | null
  situations: SituationSummaryItem[]
  acomptesHt: number
  billedHt: number      // cumul HT situations seules
  remainingHt: number   // reste à facturer
  cumulativePct: number // dernier cumul%
  fullyInvoiced: boolean
}

export async function getSituationsSummary(quoteId: string): Promise<SituationsSummary | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data: quote } = await supabase
    .from('quotes')
    .select('id, number, title, total_ht, status')
    .eq('id', quoteId)
    .eq('organization_id', orgId)
    .single()

  if (!quote) return null

  const { data: situations } = await supabase
    .from('invoices')
    .select('id, number, title, status, invoice_type, situation_number, cumulative_pct, total_ht, total_ttc, period_from, period_to, retention_pct, retention_amount, issue_date, created_at')
    .eq('quote_id', quoteId)
    .eq('organization_id', orgId)
    .in('invoice_type', ['situation', 'solde'])
    .not('status', 'eq', 'cancelled')
    .order('situation_number', { ascending: true })

  const { data: acomptes } = await supabase
    .from('invoices')
    .select('total_ht')
    .eq('quote_id', quoteId)
    .eq('organization_id', orgId)
    .eq('invoice_type', 'acompte')
    .in('status', ['sent', 'partial', 'paid'])

  const quoteHt = quote.total_ht ?? 0
  const acomptesHt = acomptes?.reduce((s, a) => s + (a.total_ht ?? 0), 0) ?? 0
  const billedHt = situations?.reduce((s, si) => s + (si.total_ht ?? 0), 0) ?? 0
  const cumulativePct = situations?.reduce((max, s) => Math.max(max, s.cumulative_pct ?? 0), 0) ?? 0
  const remainingHt = Math.max(0, quoteHt - billedHt - acomptesHt)
  const fullyInvoiced = quote.status === 'fully_invoiced' || cumulativePct >= 99.5

  return {
    quoteId,
    quoteHt,
    quoteTitle: quote.title,
    quoteNumber: quote.number,
    situations: (situations ?? []) as SituationSummaryItem[],
    acomptesHt,
    billedHt,
    remainingHt,
    cumulativePct,
    fullyInvoiced,
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

// Plafond de sécurité : la page finances charge tout en un bloc pour permettre
// le filtrage/recherche instantané côté client. Sans limite, l'historique complet
// d'une organisation ancienne (plusieurs milliers de factures) ralentirait cette
// page à chaque visite. 500 couvre largement l'usage courant ; au-delà, les plus
// anciennes restent consultables via les exports comptables (FEC, rapport PDF).
const FINANCES_LIST_LIMIT = 500

export async function getInvoices(): Promise<Invoice[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id, number, title, status, invoice_type, total_ht, total_ttc, total_paid, currency,
      issue_date, due_date, balance_due_date, sent_at, paid_at, created_at, quote_id, chantier_id,
      period_from, period_to, billing_period_key, generation_source,
      client:clients(id, company_name, contact_name, email)
    `)
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })
    .limit(FINANCES_LIST_LIMIT)

  if (error) {
    console.error('[getInvoices]', error)
    return []
  }

  const sourceInvoiceIds = (data ?? []).filter(row => row.invoice_type !== 'avoir').map(row => row.id)
  try {
    const creditedByInvoice = await getIssuedInvoiceCreditTotals(sourceInvoiceIds)
    return (data ?? []).map(row => ({
      ...row,
      credited_ttc: creditedByInvoice.get(row.id) ?? 0,
    })) as unknown as Invoice[]
  } catch (creditError) {
    console.error('[getInvoices] issued credit-note authority', creditError)
    return []
  }
}

export async function getInvoiceById(invoiceId: string): Promise<InvoiceWithItems | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id, number, title, status, invoice_type, total_ht, total_tva, total_ttc, total_paid, currency,
      issue_date, due_date, sent_at, paid_at, created_at,
      notes_client, payment_conditions, aid_label, aid_amount, quote_id, chantier_id, client_id,
      situation_number, cumulative_pct, period_from, period_to, retention_pct, retention_amount, market_reference, is_reverse_charge,
      invoice_type_code, credit_note_for, preceding_invoice_ref, preceding_invoice_date,
      billing_period_key, generation_source, pa_status, pa_message_id,
      client:clients(id, company_name, contact_name, first_name, last_name, email, phone,
        address_line1, postal_code, city, siret, siren, vat_number, type),
      items:invoice_items(id, description, quantity, unit, unit_price, unit_cost_ht, vat_rate, position, length_m, width_m, height_m, dim_quantity, is_internal, material_id),
      payment_schedule:invoice_payment_schedule(id, invoice_id, label, due_date, amount, amount_type, percentage, position, paid_payment_id)
    `)
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .order('position', { referencedTable: 'invoice_items', ascending: true })
    .order('position', { referencedTable: 'invoice_payment_schedule', ascending: true })
    .single()

  if (error) {
    console.error('[getInvoiceById]', error)
    return null
  }

  const scheduleItems = data.payment_schedule ?? []
  const scheduleIds = scheduleItems.map(item => item.id)
  const paidBySchedule = new Map<string, number>()
  if (scheduleIds.length > 0) {
    const { data: payments, error: paymentsError } = await supabase
      .from('payments')
      .select('payment_schedule_id, amount')
      .eq('invoice_id', invoiceId)
      .eq('organization_id', orgId)
      .in('payment_schedule_id', scheduleIds)

    if (paymentsError) {
      console.error('[getInvoiceById] payment schedule', paymentsError)
      return null
    }
    for (const payment of payments ?? []) {
      const scheduleId = payment.payment_schedule_id
      if (!scheduleId) continue
      paidBySchedule.set(scheduleId, roundMoney((paidBySchedule.get(scheduleId) ?? 0) + (Number(payment.amount) || 0)))
    }
  }

  let creditedTtc = 0
  if (data.invoice_type !== 'avoir') {
    try {
      creditedTtc = (await getIssuedInvoiceCreditTotals([invoiceId])).get(invoiceId) ?? 0
    } catch (creditError) {
      console.error('[getInvoiceById] issued credit-note authority', creditError)
      return null
    }
  }

  const totalTtc = roundMoney(Number(data.total_ttc) || 0)
  const totalPaid = roundMoney(Number(data.total_paid) || 0)
  let scheduleOutstanding = Math.max(0, roundMoney(totalTtc - totalPaid - creditedTtc))
  const invoiceNotPayable = data.invoice_type === 'avoir' || data.status === 'paid' || scheduleOutstanding === 0
  const payment_schedule = scheduleItems.map(item => {
    const amount = item.amount_type === 'percentage'
      ? roundMoney(totalTtc * ((Number(item.percentage) || 0) / 100))
      : roundMoney(Number(item.amount) || 0)
    const ledgerPaid = paidBySchedule.get(item.id) ?? 0
    const paid_amount = item.paid_payment_id ? Math.max(amount, ledgerPaid) : ledgerPaid
    const installmentOutstanding = Math.max(0, roundMoney(amount - paid_amount))
    const remaining_amount = invoiceNotPayable
      ? 0
      : Math.min(installmentOutstanding, scheduleOutstanding)
    scheduleOutstanding = Math.max(0, roundMoney(scheduleOutstanding - remaining_amount))
    return {
      ...item,
      amount,
      paid_amount,
      remaining_amount,
      is_paid: invoiceNotPayable || item.paid_payment_id !== null || remaining_amount === 0,
    }
  })
  return { ...data, payment_schedule, credited_ttc: creditedTtc } as unknown as InvoiceWithItems
}

export async function getClientInvoices(clientId: string): Promise<Invoice[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id, number, title, status, invoice_type, total_ht, total_ttc, total_paid, currency,
      issue_date, due_date, balance_due_date, sent_at, paid_at, created_at, quote_id, chantier_id,
      period_from, period_to, billing_period_key, generation_source,
      client:clients(id, company_name, contact_name, email)
    `)
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getClientInvoices]', error)
    return []
  }

  const sourceInvoiceIds = (data ?? []).filter(row => row.invoice_type !== 'avoir').map(row => row.id)
  try {
    const creditedByInvoice = await getIssuedInvoiceCreditTotals(sourceInvoiceIds)
    return (data ?? []).map(row => ({
      ...row,
      credited_ttc: creditedByInvoice.get(row.id) ?? 0,
    })) as unknown as Invoice[]
  } catch (creditError) {
    console.error('[getClientInvoices] issued credit-note authority', creditError)
    return []
  }
}

export type InvoiceStub = {
  id: string
  number: string | null
  title: string | null
  status: InvoiceStatus
  total_ht: number | null
  total_ttc: number | null
  total_paid: number | null
  chantier_id: string | null
  issue_date: string | null
}

// ─── Export comptable ──────────────────────────────────────────────────────────

export type InvoiceForExport = {
  id: string
  number: string | null
  invoice_type: string
  credit_note_for: string | null
  vat_breakdown: Array<{ rate: number; taxable_basis: number; tax_amount: number }> | null
  applied_acompte_ht: number | null
  issue_date: string | null
  paid_at: string | null
  total_ht: number
  total_tva: number
  total_ttc: number
  total_paid: number
  credited_ttc: number
  status: string
  chantier_id: string | null
  is_vat_subject: boolean
  is_reverse_charge: boolean
  tva_sur_debits: boolean
  business_profile: string | null
  seller_siren: string | null
  seller_vat_number: string | null
  client: {
    id: string
    company_name: string | null
    contact_name: string | null
    first_name: string | null
    last_name: string | null
    siret: string | null
  } | null
  items: Array<{
    unit_price: number
    quantity: number
    vat_rate: number
  }>
  pa_message_id: string | null
  chantier_title: string | null
}
type InvoiceExportRow = {
  id: string
  status: string
  paid_at: string | null
  total_paid: number | null
  issuance_snapshot: unknown
}

function mapInvoiceForExport(row: InvoiceExportRow): InvoiceForExport {
  if (!isInvoiceIssuanceSnapshot(row.issuance_snapshot, row.id)) throw new InvoiceIssuanceAuthorityError()
  const snapshot = row.issuance_snapshot
  const facts = snapshot.invoice
  const buyer = snapshot.buyer
  const items = snapshot.items
    .filter(item => item.is_internal !== true && item.unit !== '__section__')
    .map(item => ({
      unit_price: item.unit_price,
      quantity: item.quantity ?? 0,
      vat_rate: item.vat_rate ?? 0,
    }))

  return {
    id: row.id,
    number: facts.number,
    invoice_type: facts.invoice_type ?? 'standard',
    credit_note_for: typeof facts.credit_note_for === 'string' ? facts.credit_note_for : null,
    vat_breakdown: facts.vat_breakdown ?? null,
    applied_acompte_ht: facts.applied_acompte_ht ?? null,
    issue_date: facts.issue_date,
    paid_at: row.paid_at,
    total_ht: facts.total_ht ?? 0,
    total_tva: facts.total_tva ?? 0,
    total_ttc: facts.total_ttc ?? 0,
    total_paid: row.total_paid ?? 0,
    credited_ttc: 0,
    status: row.status,
    chantier_id: typeof facts.chantier_id === 'string' ? facts.chantier_id : null,
    is_vat_subject: snapshot.seller.is_vat_subject,
    is_reverse_charge: facts.is_reverse_charge === true,
    tva_sur_debits: snapshot.seller.tva_sur_debits ?? false,
    business_profile: snapshot.seller.business_profile,
    seller_siren: snapshot.seller.siren,
    seller_vat_number: snapshot.seller.vat_number,
    client: buyer ? {
      id: buyer.id,
      company_name: buyer.company_name,
      contact_name: buyer.contact_name,
      first_name: buyer.first_name,
      last_name: buyer.last_name,
      siret: buyer.siret,
    } : null,
    items,
    pa_message_id: null,
    chantier_title: snapshot.chantier?.title ?? null,
  }
}
export async function getIssuedInvoiceCreditTotals(
  sourceInvoiceIds: readonly string[],
  deps?: { client: SupabaseClient; orgId: string },
): Promise<Map<string, number>> {
  const requestedIds = [...new Set(sourceInvoiceIds)]
  const credited = new Map<string, number>()
  if (requestedIds.length === 0) return credited
  if (requestedIds.some(id => !id)) {
    throw new Error('Identifiants de facture invalides pour calculer les avoirs émis.')
  }
  for (const id of requestedIds) credited.set(id, 0)

  const supabase = deps?.client ?? await createClient()
  const orgId = deps?.orgId ?? await getCurrentOrganizationId()
  if (!orgId) throw new Error('Organisation indisponible pour vérifier les avoirs émis.')

  const pageSize = 1000
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('invoices')
      .select('id, status, paid_at, total_paid, issuance_snapshot, credit_note_for, unissued_cancelled_at')
      .eq('organization_id', orgId)
      .eq('invoice_type', 'avoir')
      .or('status.in.(sent,viewed,partial,paid,overdue),and(status.eq.cancelled,unissued_cancelled_at.is.null)')
      .order('id', { ascending: true })
      .range(offset, offset + pageSize - 1)

    if (error) {
      console.error('[getIssuedInvoiceCreditTotals]', error)
      throw new Error('Impossible de vérifier les avoirs émis pour ces factures.')
    }
    const rows = data ?? []
    for (const row of rows) {
      const snapshotSourceId = (row.issuance_snapshot as { invoice?: { credit_note_for?: unknown } } | null)?.invoice?.credit_note_for
      if (!isInvoiceIssuanceSnapshot(row.issuance_snapshot, row.id)) {
        if (requestedIds.includes(row.credit_note_for ?? '')
            || (typeof snapshotSourceId === 'string' && requestedIds.includes(snapshotSourceId))) {
          throw new InvoiceIssuanceAuthorityError()
        }
        continue
      }
      const snapshot = row.issuance_snapshot
      const sourceId = snapshot.invoice.credit_note_for
      const amount = snapshot.invoice.total_ttc
      if (typeof sourceId !== 'string') {
        if (requestedIds.includes(row.credit_note_for ?? '')) throw new InvoiceIssuanceAuthorityError()
        continue
      }
      if (sourceId !== row.credit_note_for) {
        if (requestedIds.includes(sourceId) || requestedIds.includes(row.credit_note_for ?? '')) {
          throw new InvoiceIssuanceAuthorityError()
        }
        continue
      }
      if (!requestedIds.includes(sourceId)) continue
      if (snapshot.invoice.invoice_type !== 'avoir'
          || typeof amount !== 'number'
          || amount <= 0) {
        throw new InvoiceIssuanceAuthorityError()
      }
      credited.set(sourceId, roundMoney((credited.get(sourceId) ?? 0) + amount))
    }
    if (rows.length < pageSize) break
    offset += pageSize
  }
  return credited
}


const EXPORTABLE_INVOICE_STATUSES = ['sent', 'viewed', 'partial', 'paid', 'overdue'] as const

export async function getInvoicesForExport(
  from: string,
  to: string,
  selection: { includeInvoices: boolean; includeAvoirs: boolean },
): Promise<InvoiceForExport[]> {
  if (!selection.includeInvoices && !selection.includeAvoirs) return []

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  let query = supabase
    .from('invoices')
    .select('id, status, paid_at, total_paid, issuance_snapshot')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .in('status', EXPORTABLE_INVOICE_STATUSES)
    .gte('issue_date', from)
    .lte('issue_date', to)
  if (selection.includeInvoices !== selection.includeAvoirs) {
    query = selection.includeInvoices
      ? query.neq('invoice_type', 'avoir')
      : query.eq('invoice_type', 'avoir')
  }
  const { data, error } = await query.order('issue_date', { ascending: true })

  if (error) {
    console.error('[getInvoicesForExport]', error)
    throw new Error('Impossible de vérifier les factures pour cet export comptable.')
  }

  const mappedInvoices: InvoiceForExport[] = (data ?? []).map(mapInvoiceForExport)
  const creditedByInvoice = await getIssuedInvoiceCreditTotals(
    mappedInvoices.filter(invoice => invoice.invoice_type !== 'avoir').map(invoice => invoice.id),
  )
  const invoices = mappedInvoices.map(invoice => ({
    ...invoice,
    credited_ttc: creditedByInvoice.get(invoice.id) ?? 0,
  }))

  // Récupérer les pa_message_id depuis pa_status_events
  const invoiceIds = invoices.map(i => i.id)
  const paMessageIds: Record<string, string> = {}
  if (invoiceIds.length > 0) {
    const { data: paEvents } = await supabase
      .from('pa_status_events')
      .select('invoice_id, pa_message_id')
      .in('invoice_id', invoiceIds)
      .not('pa_message_id', 'is', null)
    for (const ev of paEvents ?? []) {
      if (ev.invoice_id && ev.pa_message_id) paMessageIds[ev.invoice_id] = ev.pa_message_id
    }
  }

  return invoices.map(invoice => ({
    ...invoice,
    pa_message_id: paMessageIds[invoice.id] ?? null,
  }))
}

/** Load frozen invoice contexts for payment-ledger exports, including archived records. */
export async function getInvoiceExportRecordsByIds(
  invoiceIds: readonly string[],
): Promise<InvoiceForExport[]> {
  const requestedIds = [...new Set(invoiceIds)]
  if (requestedIds.length === 0) return []
  if (requestedIds.some(id => !id)) {
    throw new Error('Identifiants de facture invalides pour cet export comptable.')
  }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) throw new Error('Organisation indisponible pour vérifier les factures de cet export.')

  const { data, error } = await supabase
    .from('invoices')
    .select('id, status, paid_at, total_paid, issuance_snapshot')
    .eq('organization_id', orgId)
    .in('id', requestedIds)
  if (error) {
    console.error('[getInvoiceExportRecordsByIds]', error)
    throw new Error('Impossible de vérifier les factures pour cet export comptable.')
  }

  const byId = new Map<string, InvoiceForExport>()
  for (const row of data ?? []) byId.set(row.id, mapInvoiceForExport(row))
  if (byId.size !== requestedIds.length) {
    throw new Error('Une ou plusieurs factures demandées sont absentes de votre organisation ou sans autorité d’émission vérifiée.')
  }
  const mapped = requestedIds.map(id => {
    const invoice = byId.get(id)
    if (!invoice) throw new Error('Une facture demandée est absente de votre organisation.')
    return invoice
  })
  const creditedByInvoice = await getIssuedInvoiceCreditTotals(
    mapped.filter(invoice => invoice.invoice_type !== 'avoir').map(invoice => invoice.id),
  )
  return mapped.map(invoice => ({
    ...invoice,
    credited_ttc: creditedByInvoice.get(invoice.id) ?? 0,
  }))
}

export async function getInvoiceStubs(): Promise<InvoiceStub[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('invoices')
    .select('id, number, title, status, total_ht, total_ttc, total_paid, chantier_id, issue_date')
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getInvoiceStubs]', error)
    return []
  }
  return (data ?? []) as InvoiceStub[]
}
