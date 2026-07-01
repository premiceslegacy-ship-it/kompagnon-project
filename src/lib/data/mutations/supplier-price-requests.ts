'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'

export type SPRStatus = 'a_demander' | 'demande' | 'recu' | 'integre'

export type SupplierPriceRequest = {
  id: string
  organization_id: string
  supplier_id: string | null
  quote_id: string | null
  quote_item_id: string | null
  designation: string
  description: string | null
  quantity: number | null
  unit: string | null
  status: SPRStatus
  sent_at: string | null
  response_at: string | null
  valid_until: string | null
  unit_price_ht: number | null
  currency: string
  attachment_url: string | null
  notes: string | null
  created_by: string | null
  created_at: string
  updated_at: string
  supplier?: { id: string; name: string } | null
}

export type UpsertSPRInput = {
  id?: string
  supplier_id?: string | null
  quote_id?: string | null
  quote_item_id?: string | null
  designation: string
  description?: string | null
  quantity?: number | null
  unit?: string | null
  status?: SPRStatus
  sent_at?: string | null
  response_at?: string | null
  valid_until?: string | null
  unit_price_ht?: number | null
  currency?: string
  attachment_url?: string | null
  notes?: string | null
}

const SPR_STATUSES: SPRStatus[] = ['a_demander', 'demande', 'recu', 'integre']

function isSPRStatus(value: string): value is SPRStatus {
  return SPR_STATUSES.includes(value as SPRStatus)
}

function normalizeOptionalNumber(value: number | null | undefined, fieldLabel: string): { value: number | null; error: string | null } {
  if (value == null) return { value: null, error: null }
  if (!Number.isFinite(value) || value < 0) return { value: null, error: `${fieldLabel} doit être un nombre positif.` }
  return { value, error: null }
}

async function validateOptionalLinks(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  organizationId: string
  supplierId?: string | null
  quoteId?: string | null
  quoteItemId?: string | null
}): Promise<string | null> {
  const { supabase, organizationId, supplierId, quoteId, quoteItemId } = params

  if (supplierId) {
    const { data, error } = await supabase
      .from('suppliers')
      .select('id')
      .eq('id', supplierId)
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .maybeSingle()
    if (error || !data) return 'Fournisseur invalide.'
  }

  if (quoteId) {
    const { data, error } = await supabase
      .from('quotes')
      .select('id')
      .eq('id', quoteId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (error || !data) return 'Devis invalide.'
  }

  if (quoteItemId) {
    const { data, error } = await supabase
      .from('quote_items')
      .select('id, quote_id')
      .eq('id', quoteItemId)
      .maybeSingle()
    if (error || !data) return 'Ligne de devis invalide.'
    if (quoteId && data.quote_id !== quoteId) return 'La ligne ne correspond pas au devis.'

    const { data: quote, error: quoteError } = await supabase
      .from('quotes')
      .select('id')
      .eq('id', data.quote_id)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (quoteError || !quote) return 'Ligne de devis invalide.'
  }

  return null
}

export async function upsertSupplierPriceRequest(
  input: UpsertSPRInput,
): Promise<{ data: SupplierPriceRequest | null; error: string | null }> {
  if (!(await hasPermission('quotes.edit'))) return { data: null, error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  const { data: { user } } = await supabase.auth.getUser()
  if (!orgId || !user) return { data: null, error: 'Non authentifié.' }

  if (!input.designation?.trim()) return { data: null, error: 'La désignation est requise.' }
  const status = input.status ?? 'a_demander'
  if (!isSPRStatus(status)) return { data: null, error: 'Statut invalide.' }

  const quantity = normalizeOptionalNumber(input.quantity, 'La quantité')
  if (quantity.error) return { data: null, error: quantity.error }
  const unitPrice = normalizeOptionalNumber(input.unit_price_ht, 'Le prix unitaire')
  if (unitPrice.error) return { data: null, error: unitPrice.error }

  const linkError = await validateOptionalLinks({
    supabase,
    organizationId: orgId,
    supplierId: input.supplier_id,
    quoteId: input.quote_id,
    quoteItemId: input.quote_item_id,
  })
  if (linkError) return { data: null, error: linkError }

  const payload = {
    organization_id: orgId,
    supplier_id: input.supplier_id ?? null,
    quote_id: input.quote_id ?? null,
    quote_item_id: input.quote_item_id ?? null,
    designation: input.designation.trim(),
    description: input.description ?? null,
    quantity: quantity.value,
    unit: input.unit ?? null,
    status,
    sent_at: input.sent_at ?? null,
    response_at: input.response_at ?? null,
    valid_until: input.valid_until ?? null,
    unit_price_ht: unitPrice.value,
    currency: input.currency ?? 'EUR',
    attachment_url: input.attachment_url ?? null,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
    ...(input.id ? {} : { created_by: user.id }),
  }

  const { data, error } = input.id
    ? await supabase
        .from('supplier_price_requests')
        .update(payload)
        .eq('id', input.id)
        .eq('organization_id', orgId)
        .select('*, supplier:suppliers(id, name)')
        .single()
    : await supabase
        .from('supplier_price_requests')
        .insert(payload)
        .select('*, supplier:suppliers(id, name)')
        .single()

  if (error) { console.error('[upsertSupplierPriceRequest]', error); return { data: null, error: error.message } }

  revalidatePath('/finances')
  return { data: data as SupplierPriceRequest, error: null }
}

export async function updateSPRStatus(
  id: string,
  status: SPRStatus,
  extra?: { sent_at?: string; response_at?: string; unit_price_ht?: number | null },
): Promise<{ error: string | null }> {
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }
  if (!isSPRStatus(status)) return { error: 'Statut invalide.' }
  const unitPrice = normalizeOptionalNumber(extra?.unit_price_ht, 'Le prix unitaire')
  if (unitPrice.error) return { error: unitPrice.error }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('supplier_price_requests')
    .update({ status, updated_at: new Date().toISOString(), ...extra, ...(extra && 'unit_price_ht' in extra ? { unit_price_ht: unitPrice.value } : {}) })
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances')
  return { error: null }
}

export async function deleteSupplierPriceRequest(id: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('quotes.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Non authentifié.' }

  const { error } = await supabase
    .from('supplier_price_requests')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/finances')
  return { error: null }
}
