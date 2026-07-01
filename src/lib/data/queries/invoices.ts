import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'partial' | 'cancelled'
export type InvoiceType = 'standard' | 'acompte' | 'situation' | 'solde'

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
}

export type Invoice = {
  id: string
  number: string | null
  title: string | null
  status: InvoiceStatus
  invoice_type: InvoiceType
  total_ht: number | null
  total_ttc: number | null
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
  billing_period_key?: string | null
  generation_source?: string | null
  quote_number: string | null
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

  if (error) {
    console.error('[getInvoices]', error)
    return []
  }

  return (data ?? []) as unknown as Invoice[]
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
      billing_period_key, generation_source,
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

  return data as unknown as InvoiceWithItems
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

  return (data ?? []) as unknown as Invoice[]
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
  issue_date: string | null
  paid_at: string | null
  total_ht: number
  total_tva: number
  total_ttc: number
  total_paid: number
  status: string
  chantier_id: string | null
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

const EXPORTABLE_INVOICE_STATUSES = ['sent', 'viewed', 'partial', 'paid', 'overdue'] as const

export async function getInvoicesForExport(
  from: string,
  to: string,
): Promise<InvoiceForExport[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id, number, invoice_type, issue_date, paid_at,
      total_ht, total_tva, total_ttc, total_paid, status, chantier_id,
      client:clients(id, company_name, contact_name, first_name, last_name, siret),
      items:invoice_items(unit_price, quantity, vat_rate)
    `)
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .in('status', EXPORTABLE_INVOICE_STATUSES)
    .gte('issue_date', from)
    .lte('issue_date', to)
    .order('issue_date', { ascending: true })

  if (error) {
    console.error('[getInvoicesForExport]', error)
    return []
  }

  // Récupérer les pa_message_id depuis pa_status_events
  const invoiceIds = (data ?? []).map(i => i.id)
  let paMessageIds: Record<string, string> = {}
  if (invoiceIds.length > 0) {
    const { data: paEvents } = await supabase
      .from('pa_status_events')
      .select('invoice_id, pa_message_id')
      .in('invoice_id', invoiceIds)
      .not('pa_message_id', 'is', null)
    for (const ev of paEvents ?? []) {
      if (ev.invoice_id && ev.pa_message_id) {
        paMessageIds[ev.invoice_id] = ev.pa_message_id
      }
    }
  }

  // Récupérer les titres de chantiers
  const chantierIds = [...new Set((data ?? []).map(i => i.chantier_id).filter(Boolean))]
  let chantierTitles: Record<string, string> = {}
  if (chantierIds.length > 0) {
    const { data: chantiers } = await supabase
      .from('chantiers')
      .select('id, title')
      .in('id', chantierIds)
    for (const c of chantiers ?? []) {
      if (c.id) chantierTitles[c.id] = c.title ?? ''
    }
  }

  return (data ?? []).map(inv => ({
    ...inv,
    total_ht: inv.total_ht ?? 0,
    total_tva: inv.total_tva ?? 0,
    total_ttc: inv.total_ttc ?? 0,
    total_paid: inv.total_paid ?? 0,
    pa_message_id: paMessageIds[inv.id] ?? null,
    chantier_title: inv.chantier_id ? (chantierTitles[inv.chantier_id] ?? null) : null,
    client: Array.isArray(inv.client) ? (inv.client[0] ?? null) : inv.client,
    items: Array.isArray(inv.items) ? inv.items : [],
  })) as InvoiceForExport[]
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
