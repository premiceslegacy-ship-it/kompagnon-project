type SupabaseClientLike = {
  from: (table: string) => any
}

type DocumentType = 'invoice' | 'quote'

type DocumentItem = {
  description: string | null
  quantity: number | null
  unit: string | null
  unit_price: number | null
  is_internal?: boolean | null
}

function formatAmount(value: number | null | undefined) {
  return (Number(value) || 0).toFixed(2)
}

function shortId(id: string) {
  return id.slice(0, 8)
}

function normalizeClient(clientRaw: any) {
  const client = Array.isArray(clientRaw) ? clientRaw[0] : clientRaw
  if (!client) return { id: null, label: 'client non renseigne' }

  const fullName = [client.first_name, client.last_name].filter(Boolean).join(' ')
  return {
    id: client.id ?? null,
    label: client.company_name || client.contact_name || fullName || client.email || 'client non renseigne',
  }
}

function buildItemsSummary(items: DocumentItem[]) {
  const visibleItems = items.filter(item => !item.is_internal && (item.description ?? '').trim())
  if (visibleItems.length === 0) return 'aucune ligne renseignee'

  const listed = visibleItems.slice(0, 12).map(item => {
    const quantity = Number(item.quantity ?? 0) || 0
    const unit = item.unit || 'u'
    const unitPrice = formatAmount(item.unit_price)
    return `${item.description?.trim()} (${quantity} ${unit} x ${unitPrice} EUR HT)`
  })
  const remaining = visibleItems.length - listed.length
  return remaining > 0 ? `${listed.join(', ')} + ${remaining} autre(s) ligne(s)` : listed.join(', ')
}

function statusLabel(type: DocumentType, status: string | null | undefined) {
  if (type === 'invoice') {
    if (status === 'paid') return 'payee'
    if (status === 'partial') return 'partiellement payee'
    if (status === 'sent') return 'envoyee'
    if (status === 'cancelled') return 'annulee'
    return 'brouillon'
  }

  if (status === 'accepted') return 'accepte'
  if (status === 'refused') return 'refuse'
  if (status === 'sent') return 'envoye'
  if (status === 'viewed') return 'consulte'
  if (status === 'expired') return 'expire'
  if (status === 'converted') return 'converti'
  return 'brouillon'
}

async function getActivityId(supabase: SupabaseClientLike, orgId: string) {
  const { data } = await supabase
    .from('organizations')
    .select('business_activity_id')
    .eq('id', orgId)
    .maybeSingle()

  return data?.business_activity_id ?? null
}

async function upsertManualDocumentMemory(params: {
  supabase: SupabaseClientLike
  orgId: string
  type: DocumentType
  documentId: string
  content: string
  metadata: Record<string, unknown>
}) {
  const { supabase, orgId, type, documentId, content, metadata } = params
  const idKey = type === 'invoice' ? 'invoice_id' : 'quote_id'
  const { data: existingRows, error: findError } = await supabase
    .from('company_memory')
    .select('id')
    .eq('organization_id', orgId)
    .eq('type', type)
    .eq('source', 'manual')
    .eq('is_active', true)
    .contains('metadata', { [idKey]: documentId })
    .order('created_at', { ascending: false })
    .limit(1)

  if (findError) {
    console.error('[document-memory] lookup failed:', findError)
  }

  const existingId = existingRows?.[0]?.id
  const payload = {
    organization_id: orgId,
    type,
    content,
    metadata,
    source: 'manual',
    confidence: 1.0,
    is_active: true,
    embedding: null,
  }

  const { error } = existingId
    ? await supabase.from('company_memory').update(payload).eq('id', existingId)
    : await supabase.from('company_memory').insert(payload)

  if (error) console.error('[document-memory] upsert failed:', error)
}

export async function syncInvoiceMemoryEntry(supabase: SupabaseClientLike, orgId: string, invoiceId: string) {
  try {
    const [{ data: invoice }, { data: items }, activityId] = await Promise.all([
      supabase
        .from('invoices')
        .select(`
          id, number, title, status, invoice_type, total_ht, total_ttc, total_paid, currency,
          issue_date, due_date, created_at, client_id, quote_id, chantier_id,
          client:clients(id, company_name, contact_name, first_name, last_name, email)
        `)
        .eq('id', invoiceId)
        .eq('organization_id', orgId)
        .maybeSingle(),
      supabase
        .from('invoice_items')
        .select('description, quantity, unit, unit_price, is_internal')
        .eq('invoice_id', invoiceId)
        .order('position'),
      getActivityId(supabase, orgId),
    ])

    if (!invoice) return

    const client = normalizeClient(invoice.client)
    const date = invoice.issue_date ?? invoice.created_at?.split('T')[0] ?? null
    const number = invoice.number ?? shortId(invoice.id)
    const itemsSummary = buildItemsSummary(items ?? [])
    const content = `Facture ${number} creee dans l'app${date ? ` le ${date}` : ''} pour ${client.label}${invoice.title ? ` - Objet : ${invoice.title}` : ''} - ${itemsSummary} - Total HT : ${formatAmount(invoice.total_ht)} EUR - Statut : ${statusLabel('invoice', invoice.status)}`

    await upsertManualDocumentMemory({
      supabase,
      orgId,
      type: 'invoice',
      documentId: invoice.id,
      content,
      metadata: {
        invoice_id: invoice.id,
        client_id: client.id,
        quote_id: invoice.quote_id ?? null,
        chantier_id: invoice.chantier_id ?? null,
        invoice_type: invoice.invoice_type ?? null,
        total_ht: invoice.total_ht ?? 0,
        total_ttc: invoice.total_ttc ?? 0,
        total_paid: invoice.total_paid ?? 0,
        status: invoice.status ?? null,
        date,
        ...(activityId ? { activity_id: activityId } : {}),
      },
    })
  } catch (error) {
    console.error('[syncInvoiceMemoryEntry]', error)
  }
}

export async function syncQuoteMemoryEntry(supabase: SupabaseClientLike, orgId: string, quoteId: string) {
  try {
    const [{ data: quote }, { data: items }, activityId] = await Promise.all([
      supabase
        .from('quotes')
        .select(`
          id, number, title, status, total_ht, total_ttc, currency,
          created_at, sent_at, signed_at, client_id,
          client:clients(id, company_name, contact_name, first_name, last_name, email)
        `)
        .eq('id', quoteId)
        .eq('organization_id', orgId)
        .maybeSingle(),
      supabase
        .from('quote_items')
        .select('description, quantity, unit, unit_price, is_internal')
        .eq('quote_id', quoteId)
        .order('position'),
      getActivityId(supabase, orgId),
    ])

    if (!quote) return

    const client = normalizeClient(quote.client)
    const date = quote.sent_at?.split('T')[0] ?? quote.created_at?.split('T')[0] ?? null
    const number = quote.number ?? shortId(quote.id)
    const itemsSummary = buildItemsSummary(items ?? [])
    const content = `Devis ${number} cree dans l'app${date ? ` le ${date}` : ''} pour ${client.label}${quote.title ? ` - Projet : ${quote.title}` : ''} - ${itemsSummary} - Total HT : ${formatAmount(quote.total_ht)} EUR - Statut : ${statusLabel('quote', quote.status)}`

    await upsertManualDocumentMemory({
      supabase,
      orgId,
      type: 'quote',
      documentId: quote.id,
      content,
      metadata: {
        quote_id: quote.id,
        client_id: client.id,
        total_ht: quote.total_ht ?? 0,
        total_ttc: quote.total_ttc ?? 0,
        status: quote.status ?? null,
        date,
        ...(activityId ? { activity_id: activityId } : {}),
      },
    })
  } catch (error) {
    console.error('[syncQuoteMemoryEntry]', error)
  }
}
