import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'refused' | 'expired' | 'converted'

export type Quote = {
  id: string
  number: string | null
  title: string | null
  status: QuoteStatus
  total_ht: number | null
  total_ttc: number | null
  currency: string
  validity_days: number
  valid_until: string | null
  sent_at: string | null
  signed_at: string | null
  created_at: string
  client: {
    id: string
    company_name: string | null
    email: string | null
  } | null
}

export type QuoteItem = {
  id: string
  quote_id: string
  section_id: string | null
  type: 'material' | 'labor' | 'custom'
  material_id: string | null
  labor_rate_id: string | null
  description: string | null
  quantity: number
  unit: string | null
  unit_price: number
  vat_rate: number
  total_ht: number | null
  position: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  is_internal: boolean
}

export type QuoteSection = {
  id: string
  quote_id: string
  title: string | null
  position: number
  items: QuoteItem[]
}

export type QuoteWithItems = Quote & {
  sections: QuoteSection[]
  unsectionedItems: QuoteItem[]
  client_request_description: string | null
  client_request_visible_on_pdf: boolean
  notes_client: string | null
  payment_conditions: string | null
  discount_rate: number | null
  deposit_rate: number | null
  aid_label: string | null
  aid_amount: number | null
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export type QuoteStub = {
  id: string
  number: string | null
  title: string | null
  client_name: string | null
  client_id: string | null
  total_ht: number | null
  client_address_line1: string | null
  client_postal_code: string | null
  client_city: string | null
  client_contact_name: string | null
  client_contact_email: string | null
  client_contact_phone: string | null
}

export async function getQuotesForLinking(): Promise<QuoteStub[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('quotes')
    .select(`
      id, number, title, total_ht, client_id,
      client:clients(company_name, first_name, last_name, contact_name, email, phone, address_line1, postal_code, city)
    `)
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .not('status', 'in', '("refused","cancelled","expired")')
    .order('created_at', { ascending: false })

  if (error) { console.error('[getQuotesForLinking]', error); return [] }

  return (data ?? []).map((q: any) => {
    const c = q.client
    // Nom contact : contact_name (société) > first_name + last_name (particulier)
    const contactName = c?.contact_name
      ?? (c?.first_name || c?.last_name ? [c?.first_name, c?.last_name].filter(Boolean).join(' ') : null)
    return {
      id: q.id,
      number: q.number,
      title: q.title,
      client_name: c?.company_name ?? (c?.first_name || c?.last_name ? [c?.first_name, c?.last_name].filter(Boolean).join(' ') : null),
      client_id: q.client_id ?? null,
      total_ht: q.total_ht ?? null,
      client_address_line1: c?.address_line1 ?? null,
      client_postal_code: c?.postal_code ?? null,
      client_city: c?.city ?? null,
      client_contact_name: contactName,
      client_contact_email: c?.email ?? null,
      client_contact_phone: c?.phone ?? null,
    }
  })
}

export async function getQuotes(): Promise<Quote[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_ttc, currency,
      validity_days, valid_until, sent_at, signed_at, created_at,
      client:clients(id, company_name, contact_name, email)
    `)
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getQuotes]', error)
    return []
  }

  return (data ?? []) as unknown as Quote[]
}

export async function getClientQuotes(clientId: string): Promise<Quote[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_ttc, currency,
      validity_days, valid_until, sent_at, signed_at, created_at,
      client:clients(id, company_name, contact_name, email)
    `)
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('is_archived', false)
    .order('created_at', { ascending: false })

  if (error) {
    console.error('[getClientQuotes]', error)
    return []
  }

  return (data ?? []) as unknown as Quote[]
}

export async function getAcceptedQuotesWithItems(): Promise<QuoteWithItems[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data: quotes, error } = await supabase
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_ttc, currency,
      validity_days, valid_until, sent_at, created_at,
      client:clients(id, company_name, contact_name, email)
    `)
    .eq('organization_id', orgId)
    .eq('is_archived', false)
    .in('status', ['accepted', 'converted'])
    .order('created_at', { ascending: false })

  if (error || !quotes || quotes.length === 0) return []

  const quoteIds = quotes.map(q => q.id)

  const [{ data: sections }, { data: items }] = await Promise.all([
    supabase
      .from('quote_sections')
      .select('id, quote_id, title, position')
      .in('quote_id', quoteIds)
      .order('position'),
    supabase
      .from('quote_items')
      .select('id, quote_id, section_id, type, material_id, labor_rate_id, description, quantity, unit, unit_price, vat_rate, total_ht, position, length_m, width_m, height_m, is_internal')
      .in('quote_id', quoteIds)
      .order('position'),
  ])

  const allSections = (sections ?? []) as Omit<QuoteSection, 'items'>[]
  const allItems = (items ?? []) as QuoteItem[]

  return (quotes as unknown as Quote[]).map(q => {
    const qSections = allSections
      .filter(s => s.quote_id === q.id)
      .map(s => ({ ...s, items: allItems.filter(i => i.section_id === s.id) }))
    return {
      ...q,
      sections: qSections,
      unsectionedItems: allItems.filter(i => i.quote_id === q.id && i.section_id === null),
      client_request_description: null,
      client_request_visible_on_pdf: false,
      notes_client: null,
      payment_conditions: null,
      discount_rate: null,
      deposit_rate: null,
      aid_label: null,
      aid_amount: null,
    }
  })
}

export async function getQuoteById(id: string): Promise<QuoteWithItems | null> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return null

  const { data: quote, error: quoteError } = await supabase
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_ttc, currency,
      validity_days, valid_until, sent_at, created_at,
      notes_client, payment_conditions, discount_rate, deposit_rate,
      aid_label, aid_amount,
      client_request_description, client_request_visible_on_pdf,
      client:clients(id, company_name, contact_name, email)
    `)
    .eq('id', id)
    .eq('organization_id', orgId)
    .single()

  if (quoteError || !quote) return null

  const { data: sections } = await supabase
    .from('quote_sections')
    .select('id, quote_id, title, position')
    .eq('quote_id', id)
    .order('position')

  const { data: items } = await supabase
    .from('quote_items')
    .select('id, quote_id, section_id, type, material_id, labor_rate_id, description, quantity, unit, unit_price, vat_rate, total_ht, position, length_m, width_m, height_m, is_internal')
    .eq('quote_id', id)
    .order('position')

  const allItems = (items ?? []) as QuoteItem[]
  const allSections = (sections ?? []) as Omit<QuoteSection, 'items'>[]

  const sectionsWithItems: QuoteSection[] = allSections.map(s => ({
    ...s,
    items: allItems.filter(i => i.section_id === s.id),
  }))

  const q = quote as unknown as Quote & {
    client_request_description: string | null
    client_request_visible_on_pdf: boolean
    notes_client: string | null
    payment_conditions: string | null
    discount_rate: number | null
    deposit_rate: number | null
    aid_label: string | null
    aid_amount: number | null
  }
  return {
    ...q,
    sections: sectionsWithItems,
    unsectionedItems: allItems.filter(i => i.section_id === null),
    client_request_description: q.client_request_description ?? null,
    client_request_visible_on_pdf: q.client_request_visible_on_pdf ?? true,
  }
}
