import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoiceStatus = 'draft' | 'sent' | 'paid' | 'cancelled'
export type InvoiceType = 'standard' | 'acompte' | 'situation' | 'solde'

export type Invoice = {
  id: string
  number: string | null
  title: string | null
  status: InvoiceStatus
  invoice_type: InvoiceType
  total_ht: number | null
  total_ttc: number | null
  currency: string
  issue_date: string | null
  due_date: string | null
  balance_due_date: string | null
  sent_at: string | null
  paid_at: string | null
  created_at: string
  quote_id: string | null
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
  vat_rate: number
  position: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
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
  client_id: string | null
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
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getInvoices(): Promise<Invoice[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('invoices')
    .select(`
      id, number, title, status, invoice_type, total_ht, total_ttc, currency,
      issue_date, due_date, balance_due_date, sent_at, paid_at, created_at, quote_id,
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
      id, number, title, status, invoice_type, total_ht, total_tva, total_ttc, currency,
      issue_date, due_date, sent_at, paid_at, created_at,
      notes_client, payment_conditions, aid_label, aid_amount, quote_id, chantier_id, client_id,
      client:clients(id, company_name, contact_name, first_name, last_name, email, phone,
        address_line1, postal_code, city, siret, siren, vat_number, type),
      items:invoice_items(id, description, quantity, unit, unit_price, vat_rate, position, length_m, width_m, height_m, is_internal, material_id)
    `)
    .eq('id', invoiceId)
    .eq('organization_id', orgId)
    .order('position', { referencedTable: 'invoice_items', ascending: true })
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
      id, number, title, status, invoice_type, total_ht, total_ttc, currency,
      issue_date, due_date, balance_due_date, sent_at, paid_at, created_at, quote_id,
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
  chantier_id: string | null
  issue_date: string | null
}

export async function getInvoiceStubs(): Promise<InvoiceStub[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('invoices')
    .select('id, number, title, status, total_ht, chantier_id, issue_date')
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
