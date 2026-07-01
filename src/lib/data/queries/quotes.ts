import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from './clients'

// ─── Types ────────────────────────────────────────────────────────────────────

export type QuoteStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'refused' | 'expired' | 'converted' | 'fully_invoiced'

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
  client_signature_image?: string | null
  client_signatory_name?: string | null
  client_signatory_role?: string | null
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
  designation: string | null
  details: string | null
  description: string | null
  quantity: number
  unit: string | null
  unit_price: number
  unit_cost_ht: number | null
  ai_confidence: number | null
  ai_source: 'catalog' | 'recent_quote' | 'memory' | 'client_input' | 'ai_estimate' | 'document' | null
  ai_warnings: string[] | null
  vat_rate: number
  total_ht: number | null
  position: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dim_quantity: number
  is_internal: boolean
  metal_grid_id: string | null
  price_pending: boolean
  labor_category: 'atelier' | 'pose' | 'finition' | 'autre' | null
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
  show_section_subtotals: boolean
  variant_group_id: string | null
  variant_label: string | null
  technical_checklist: Array<{ id: string; label: string; category: string; checked: boolean }> | null
}

export type QuoteVariantStub = {
  id: string
  number: string | null
  title: string | null
  variant_label: string | null
  status: QuoteStatus
  total_ht: number | null
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
  internal_cost_labor_ht: number
  internal_cost_parts_ht: number
  internal_cost_other_ht: number
  internal_cost_total_ht: number
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
    .limit(200)

  if (error) { console.error('[getQuotesForLinking]', error); return [] }

  const quoteIds = (data ?? []).map((q: any) => q.id)
  const items = quoteIds.length > 0
    ? await fetchQuoteItemsForLinking(supabase, quoteIds)
    : []

  const materialCostById = await fetchMaterialCostsForQuoteItems(supabase, orgId, items)
  const laborCostById = await fetchLaborCostsForQuoteItems(supabase, orgId, items)

  // Même formule que le Récap marge interne du devis editor :
  // unit_cost_ht sur toutes les lignes + fallback catalogue si l'ancien devis ne l'avait pas persisté
  // + unit_price pour les lignes is_internal sans coût dédié (transport, équipement, saisie libre).
  const totalInternalByQuote: Record<string, number> = {}
  for (const item of items) {
    const qty = Number(item.quantity) || 0
    const unitCost = resolveQuoteItemInternalUnitCost(item, materialCostById, laborCostById)
    const cost = qty * unitCost
    if (!cost) continue
    totalInternalByQuote[item.quote_id] = (totalInternalByQuote[item.quote_id] ?? 0) + cost
  }

  return (data ?? []).map((q: any) => {
    const c = q.client
    const totalInternal = totalInternalByQuote[q.id] ?? 0
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
      internal_cost_labor_ht: 0,
      internal_cost_parts_ht: 0,
      internal_cost_other_ht: roundMoney(totalInternal),
      internal_cost_total_ht: roundMoney(totalInternal),
    }
  })
}

function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100
}

async function fetchQuoteItemsForLinking(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  quoteIds: string[],
) {
  const pageSize = 1000
  const chunkSize = 40
  const allItems: Array<{
    quote_id: string
    type: string | null
    material_id: string | null
    labor_rate_id: string | null
    quantity: number | null
    unit_cost_ht: number | null
    unit_price: number | null
    is_internal: boolean | null
  }> = []

  for (let i = 0; i < quoteIds.length; i += chunkSize) {
    const chunk = quoteIds.slice(i, i + chunkSize)
    let from = 0
    while (true) {
      const { data, error } = await supabase
        .from('quote_items')
        .select('quote_id, type, material_id, labor_rate_id, quantity, unit_cost_ht, unit_price, is_internal')
        .in('quote_id', chunk)
        .order('quote_id', { ascending: true })
        .range(from, from + pageSize - 1)

      if (error) {
        console.error('[fetchQuoteItemsForLinking]', error)
        break
      }

      allItems.push(...((data ?? []) as typeof allItems))
      if (!data || data.length < pageSize) break
      from += pageSize
    }
  }

  return allItems
}

function resolveQuoteItemInternalUnitCost(
  item: {
    material_id: string | null
    labor_rate_id: string | null
    unit_cost_ht: number | null
    unit_price: number | null
    is_internal: boolean | null
  },
  materialCostById: Record<string, number>,
  laborCostById: Record<string, number>,
) {
  if (item.unit_cost_ht != null) return Number(item.unit_cost_ht) || 0
  if (item.material_id && materialCostById[item.material_id] != null) return materialCostById[item.material_id]
  if (item.labor_rate_id && laborCostById[item.labor_rate_id] != null) return laborCostById[item.labor_rate_id]
  return item.is_internal ? (Number(item.unit_price) || 0) : 0
}

async function fetchMaterialCostsForQuoteItems(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  orgId: string,
  items: Array<{ material_id: string | null }>,
) {
  const ids = [...new Set(items.map(i => i.material_id).filter(Boolean))] as string[]
  if (!ids.length) return {} as Record<string, number>

  const { data, error } = await supabase
    .from('materials')
    .select('id, purchase_price')
    .eq('organization_id', orgId)
    .in('id', ids)

  if (error) {
    console.error('[fetchMaterialCostsForQuoteItems]', error)
    return {}
  }

  return Object.fromEntries((data ?? []).map(row => [row.id, Number(row.purchase_price) || 0]))
}

async function fetchLaborCostsForQuoteItems(
  supabase: Awaited<ReturnType<typeof import('@/lib/supabase/server').createClient>>,
  orgId: string,
  items: Array<{ labor_rate_id: string | null }>,
) {
  const ids = [...new Set(items.map(i => i.labor_rate_id).filter(Boolean))] as string[]
  if (!ids.length) return {} as Record<string, number>

  const { data, error } = await supabase
    .from('labor_rates')
    .select('id, cost_rate, rate')
    .eq('organization_id', orgId)
    .in('id', ids)

  if (error) {
    console.error('[fetchLaborCostsForQuoteItems]', error)
    return {}
  }

  return Object.fromEntries((data ?? []).map(row => [row.id, Number(row.cost_rate ?? row.rate) || 0]))
}

export async function getQuotes(): Promise<Quote[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('quotes')
    .select(`
      id, number, title, status, total_ht, total_ttc, currency,
      validity_days, valid_until, sent_at, signed_at,
      client_signature_image, client_signatory_name, client_signatory_role,
      created_at,
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
      validity_days, valid_until, sent_at, signed_at,
      client_signature_image, client_signatory_name, client_signatory_role,
      created_at,
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
      validity_days, valid_until, sent_at, signed_at,
      client_signature_image, client_signatory_name, client_signatory_role,
      created_at,
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
      .select('id, quote_id, section_id, type, material_id, labor_rate_id, designation, details, description, quantity, unit, unit_price, unit_cost_ht, ai_confidence, ai_source, ai_warnings, vat_rate, total_ht, position, length_m, width_m, height_m, dim_quantity, is_internal, metal_grid_id, price_pending, labor_category')
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
      show_section_subtotals: false,
      variant_group_id: null,
      variant_label: null,
      technical_checklist: null,
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
      validity_days, valid_until, sent_at, signed_at,
      client_signature_image, client_signatory_name, client_signatory_role,
      created_at,
      notes_client, payment_conditions, discount_rate, deposit_rate,
      aid_label, aid_amount,
      show_section_subtotals,
      variant_group_id, variant_label,
      technical_checklist,
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
    .select('id, quote_id, section_id, type, material_id, labor_rate_id, designation, details, description, quantity, unit, unit_price, unit_cost_ht, ai_confidence, ai_source, ai_warnings, vat_rate, total_ht, position, length_m, width_m, height_m, dim_quantity, is_internal, metal_grid_id, price_pending, labor_category')
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
    show_section_subtotals: boolean
    variant_group_id: string | null
    variant_label: string | null
    technical_checklist: Array<{ id: string; label: string; category: string; checked: boolean }> | null
  }
  return {
    ...q,
    sections: sectionsWithItems,
    unsectionedItems: allItems.filter(i => i.section_id === null),
    client_request_description: q.client_request_description ?? null,
    client_request_visible_on_pdf: q.client_request_visible_on_pdf ?? true,
    show_section_subtotals: q.show_section_subtotals ?? false,
    variant_group_id: q.variant_group_id ?? null,
    variant_label: q.variant_label ?? null,
    technical_checklist: q.technical_checklist ?? null,
  }
}

export async function getQuoteVariants(variantGroupId: string): Promise<QuoteVariantStub[]> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return []

  const { data, error } = await supabase
    .from('quotes')
    .select('id, number, title, variant_label, status, total_ht')
    .eq('organization_id', orgId)
    .eq('variant_group_id', variantGroupId)
    .eq('is_archived', false)
    .order('created_at', { ascending: true })

  if (error) return []
  return (data ?? []) as QuoteVariantStub[]
}
