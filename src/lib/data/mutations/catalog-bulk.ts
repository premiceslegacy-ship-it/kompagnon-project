'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { coerceLegalVatRate } from '@/lib/utils'
import type {
  CatalogDraftItem,
  CatalogDraftMaterial,
  CatalogDraftLaborRate,
  CatalogDraftPrestationType,
  CatalogDraftSupplier,
} from '@/app/api/ai/catalog-extract/route'

function autoRef(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

export type BulkCreateResult = {
  created: number
  errors: Array<{ item: CatalogDraftItem; error: string }>
}

async function createMaterialFromDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  item: CatalogDraftMaterial,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('materials').insert({
    organization_id: orgId,
    name: item.name.trim(),
    reference: item.reference?.trim() || autoRef(item.kind === 'service' ? 'SVC' : 'ART'),
    item_kind: item.kind === 'service' ? 'service' : 'article',
    unit: item.unit || null,
    category: item.category || null,
    supplier: item.supplier_name || null,
    purchase_price: item.purchase_price ?? null,
    margin_rate: item.margin_rate ?? 0,
    sale_price: item.sale_price != null
      ? item.sale_price
      : item.purchase_price != null
        ? parseFloat((item.purchase_price * (1 + (item.margin_rate ?? 0) / 100)).toFixed(4))
        : 0,
    vat_rate: coerceLegalVatRate(item.vat_rate, 20),
    description: item.description ?? null,
    dimension_pricing_mode: item.dimension_pricing_mode ?? 'none',
    dimension_pricing_enabled: (item.dimension_pricing_mode ?? 'none') !== 'none',
    base_length_m: item.base_length_m ?? null,
    base_width_m: item.base_width_m ?? null,
    base_height_m: item.base_height_m ?? null,
  })
  if (error) return { error: error.message }
  return { error: null }
}

async function createLaborRateFromDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  item: CatalogDraftLaborRate,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('labor_rates').insert({
    organization_id: orgId,
    designation: item.designation.trim(),
    reference: autoRef('MO'),
    unit: item.unit || 'h',
    category: item.category || null,
    type: item.type || 'human',
    cost_rate: item.cost_rate ?? null,
    margin_rate: 0,
    rate: item.rate,
    vat_rate: coerceLegalVatRate(item.vat_rate, 20),
  })
  if (error) return { error: error.message }
  return { error: null }
}

async function createPrestationTypeFromDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  userId: string,
  item: CatalogDraftPrestationType,
): Promise<{ error: string | null }> {
  const { data: pt, error: ptErr } = await supabase
    .from('prestation_types')
    .insert({
      organization_id: orgId,
      name: item.name.trim(),
      description: item.description ?? null,
      unit: item.unit || 'm²',
      category: item.category ?? null,
      profile_kind: 'mixed',
      base_price_ht: item.base_price_ht ?? 0,
      base_cost_ht: item.base_cost_ht ?? 0,
      distance_rules: [],
      vat_rate: coerceLegalVatRate(item.vat_rate, 20),
      is_active: true,
      created_by: userId,
    })
    .select('id')
    .single()

  if (ptErr || !pt) return { error: ptErr?.message ?? 'Erreur création modèle' }

  if (item.lines && item.lines.length > 0) {
    const itemsToInsert = item.lines.map((line, idx) => ({
      prestation_type_id: pt.id,
      organization_id: orgId,
      position: idx,
      section_title: '',
      item_type: line.item_type,
      material_id: null,
      labor_rate_id: null,
      designation: line.designation,
      quantity: line.quantity ?? 1,
      unit: line.unit || 'u',
      unit_price_ht: line.unit_price_ht ?? 0,
      unit_cost_ht: 0,
      is_internal: false,
    }))

    const { error: linesErr } = await supabase
      .from('prestation_type_items')
      .insert(itemsToInsert)

    if (linesErr) return { error: linesErr.message }
  }

  return { error: null }
}

async function createSupplierFromDraft(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  item: CatalogDraftSupplier,
): Promise<{ error: string | null }> {
  const { error } = await supabase.from('suppliers').insert({
    organization_id: orgId,
    name: item.name.trim(),
    contact_name: item.contact_name ?? null,
    email: item.email ?? null,
    phone: item.phone ?? null,
    address: item.address ?? null,
    siret: item.siret ?? null,
    payment_terms: item.payment_terms ?? null,
  })
  if (error) return { error: error.message }
  return { error: null }
}

export async function bulkCreateFromAI(items: CatalogDraftItem[]): Promise<BulkCreateResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { created: 0, errors: items.map(item => ({ item, error: 'Non authentifié.' })) }

  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { created: 0, errors: items.map(item => ({ item, error: 'Organisation introuvable.' })) }

  let created = 0
  const errors: BulkCreateResult['errors'] = []

  for (const item of items) {
    let result: { error: string | null }

    if (item.kind === 'material' || item.kind === 'service') {
      result = await createMaterialFromDraft(supabase, orgId, item as CatalogDraftMaterial)
    } else if (item.kind === 'labor_rate') {
      result = await createLaborRateFromDraft(supabase, orgId, item as CatalogDraftLaborRate)
    } else if (item.kind === 'prestation_type') {
      result = await createPrestationTypeFromDraft(supabase, orgId, user.id, item as CatalogDraftPrestationType)
    } else if (item.kind === 'supplier') {
      result = await createSupplierFromDraft(supabase, orgId, item as CatalogDraftSupplier)
    } else {
      result = { error: 'Type inconnu' }
    }

    if (result.error) {
      errors.push({ item, error: result.error })
    } else {
      created++
    }
  }

  if (created > 0) revalidatePath('/catalog')

  return { created, errors }
}
