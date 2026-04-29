'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { coerceLegalVatRate } from '@/lib/utils'
import { normalizeDimensionSchema } from '@/lib/catalog-pricing'

// ─── Import job tracker ───────────────────────────────────────────────────────

type ImportJobType = 'materials' | 'labor_rates' | 'clients' | 'invoices' | 'quotes'

async function trackImportJob(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  orgId: string
  userId: string
  type: ImportJobType
  fileName?: string
  totalRows: number
  importedRows: number
  skippedRows: number
  skippedReasons: string[]
}) {
  const { supabase, orgId, userId, type, fileName, totalRows, importedRows, skippedRows, skippedReasons } = params
  await supabase.from('import_jobs').insert({
    organization_id: orgId,
    type,
    status: importedRows > 0 ? 'completed' : 'failed',
    file_name: fileName ?? null,
    total_rows: totalRows,
    imported_rows: importedRows,
    skipped_rows: skippedRows,
    error_rows: skippedRows,
    error_details: skippedReasons.length > 0 ? skippedReasons : null,
    started_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    created_by: userId,
  })
}

// ─── Shared ───────────────────────────────────────────────────────────────────

type Result = { error: string | null }
type MaterialVariantInput = {
  label?: string | null
  reference_suffix?: string | null
  dimension_values?: Record<string, number | null>
  purchase_price?: number | null
  sale_price?: number | null
  is_default?: boolean
  position?: number
}

function autoRef(prefix: string): string {
  return `${prefix}-${Date.now().toString(36).toUpperCase().slice(-6)}`
}

function normalizeLaborType(raw: unknown): string {
  const value = String(raw ?? '').trim()
  return ['human', 'machine', 'equipment', 'subcontractor', 'other'].includes(value) ? value : 'human'
}

function parseMaterialVariants(raw: unknown): MaterialVariantInput[] {
  try {
    if (!raw) return []
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return []
    const mapped = parsed.map((entry, index): MaterialVariantInput | null => {
        if (!entry || typeof entry !== 'object') return null
        const record = entry as Record<string, unknown>
        const dimensionValues = record.dimension_values && typeof record.dimension_values === 'object' && !Array.isArray(record.dimension_values)
          ? Object.fromEntries(
              Object.entries(record.dimension_values as Record<string, unknown>).map(([key, value]) => {
                const parsedValue = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
                return [key, Number.isNaN(parsedValue) ? null : parsedValue]
              }),
            )
          : {}
        const salePrice = typeof record.sale_price === 'number' ? record.sale_price : parseFloat(String(record.sale_price ?? ''))
        const purchasePrice = typeof record.purchase_price === 'number' ? record.purchase_price : parseFloat(String(record.purchase_price ?? ''))
        return {
          label: typeof record.label === 'string' ? record.label.trim() || null : null,
          reference_suffix: typeof record.reference_suffix === 'string' ? record.reference_suffix.trim() || null : null,
          dimension_values: dimensionValues,
          sale_price: Number.isNaN(salePrice) ? null : salePrice,
          purchase_price: Number.isNaN(purchasePrice) ? null : purchasePrice,
          is_default: Boolean(record.is_default),
          position: typeof record.position === 'number' ? record.position : index,
        }
      })
    return mapped.filter((entry): entry is MaterialVariantInput => entry !== null)
  } catch {
    return []
  }
}

function parseDimensionSchemaRaw(raw: unknown, mode: 'none' | 'linear' | 'area' | 'volume') {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return normalizeDimensionSchema(parsed, mode)
  } catch {
    return normalizeDimensionSchema(null, mode)
  }
}

async function replaceMaterialPriceVariants(params: {
  supabase: Awaited<ReturnType<typeof createClient>>
  materialId: string
  organizationId: string
  variants: MaterialVariantInput[]
}): Promise<Result> {
  const { supabase, materialId, organizationId, variants } = params
  const { error: deleteError } = await supabase
    .from('material_price_variants')
    .delete()
    .eq('material_id', materialId)
    .eq('organization_id', organizationId)

  if (deleteError) {
    console.error('[replaceMaterialPriceVariants:delete]', deleteError)
    return { error: "Erreur lors de la mise à jour des variantes." }
  }

  if (variants.length === 0) return { error: null }

  const normalized = variants.map((variant, index) => ({
    material_id: materialId,
    organization_id: organizationId,
    label: variant.label ?? null,
    reference_suffix: variant.reference_suffix ?? null,
    dimension_values: variant.dimension_values ?? {},
    purchase_price: variant.purchase_price ?? null,
    sale_price: variant.sale_price ?? null,
    is_default: variant.is_default ?? index === 0,
    position: variant.position ?? index,
  }))

  if (!normalized.some((variant) => variant.is_default) && normalized[0]) {
    normalized[0].is_default = true
  }

  const { error: insertError } = await supabase.from('material_price_variants').insert(normalized)
  if (insertError) {
    console.error('[replaceMaterialPriceVariants:insert]', insertError)
    return { error: "Erreur lors de la mise à jour des variantes." }
  }

  return { error: null }
}

// ─── Import ────────────────────────────────────────────────────────────────────

export type ImportCatalogState = {
  error: string | null
  imported: number
  skipped: number
  skipped_reasons: string[]
}

export async function importMaterials(
  _prevState: ImportCatalogState,
  formData: FormData,
): Promise<ImportCatalogState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', imported: 0, skipped: 0, skipped_reasons: [] }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', imported: 0, skipped: 0, skipped_reasons: [] }

  const rawData = formData.get('items_json') as string
  if (!rawData) return { error: 'Aucune donnée à importer.', imported: 0, skipped: 0, skipped_reasons: [] }

  let rows: Record<string, string>[]
  try { rows = JSON.parse(rawData) } catch {
    return { error: 'Format de données invalide.', imported: 0, skipped: 0, skipped_reasons: [] }
  }

  const skippedReasons: string[] = []
  const toInsert = rows
    .map((row, i) => {
      if (!row.name?.trim()) {
        skippedReasons.push(`Ligne ${i + 1} ignorée : désignation manquante`)
        return null
      }
      const dimMode = (row.dimension_pricing_mode?.trim() as 'none' | 'linear' | 'area' | 'volume') || 'none'
      const dimEnabled = ['1', 'true', 'oui', 'yes'].includes((row.dimension_pricing_enabled ?? '').trim().toLowerCase())
      let parsedSchema = parseDimensionSchemaRaw(row.dimension_schema, dimMode)
      if (row.dimension_schema && typeof row.dimension_schema === 'string' && row.dimension_schema.trim()) {
        try { JSON.parse(row.dimension_schema) } catch {
          skippedReasons.push(`Ligne ${i + 1} (${row.name.trim()}) : dimension_schema JSON invalide, ignoré`)
          parsedSchema = parseDimensionSchemaRaw(null, dimMode)
        }
      }
      return {
        organization_id: organizationId,
        name: row.name.trim(),
        reference: row.reference?.trim() || autoRef('ART'),
        item_kind: row.item_kind?.trim() === 'service' ? 'service' : 'article',
        unit: row.unit?.trim() || null,
        category: row.category?.trim() || null,
        supplier: row.supplier?.trim() || null,
        purchase_price: parseFloat(row.purchase_price) || null,
        margin_rate: parseFloat(row.margin_rate) || 0,
        sale_price: parseFloat(row.sale_price) || null,
        vat_rate: coerceLegalVatRate(row.vat_rate),
        dimension_pricing_enabled: dimEnabled,
        dimension_pricing_mode: dimEnabled && dimMode === 'none' ? 'linear' : dimMode,
        base_length_m: parseFloat(row.base_length_m) || null,
        base_width_m: parseFloat(row.base_width_m) || null,
        base_height_m: parseFloat(row.base_height_m) || null,
        dimension_schema: parsedSchema,
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const skipped = rows.length - toInsert.length
  if (toInsert.length === 0) return { error: 'Aucun matériau valide (colonne "Désignation" requise).', imported: 0, skipped, skipped_reasons: skippedReasons }

  const { error } = await supabase.from('materials').insert(toInsert)
  if (error) {
    console.error('[importMaterials]', error)
    return { error: "Erreur lors de l'import en base de données.", imported: 0, skipped, skipped_reasons: skippedReasons }
  }

  await trackImportJob({ supabase, orgId: organizationId, userId: user.id, type: 'materials', fileName: formData.get('file_name') as string | undefined, totalRows: rows.length, importedRows: toInsert.length, skippedRows: skipped, skippedReasons })
  revalidatePath('/catalog')
  return { error: null, imported: toInsert.length, skipped, skipped_reasons: skippedReasons }
}

export async function importLaborRates(
  _prevState: ImportCatalogState,
  formData: FormData,
): Promise<ImportCatalogState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', imported: 0, skipped: 0, skipped_reasons: [] }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', imported: 0, skipped: 0, skipped_reasons: [] }

  const rawData = formData.get('items_json') as string
  if (!rawData) return { error: 'Aucune donnée à importer.', imported: 0, skipped: 0, skipped_reasons: [] }

  let rows: Record<string, string>[]
  try { rows = JSON.parse(rawData) } catch {
    return { error: 'Format de données invalide.', imported: 0, skipped: 0, skipped_reasons: [] }
  }

  const skippedReasons: string[] = []
  const toInsert = rows
    .map((row, i) => {
      if (!row.designation?.trim()) {
        skippedReasons.push(`Ligne ${i + 1} ignorée : désignation manquante`)
        return null
      }
      return {
        organization_id: organizationId,
        designation: row.designation.trim(),
        reference: row.reference?.trim() || autoRef('MO'),
        unit: row.unit?.trim() || 'h',
        category: row.category?.trim() || null,
        type: normalizeLaborType(row.type),
        cost_rate: parseFloat(row.cost_rate) || null,
        margin_rate: 0,
        rate: parseFloat(row.cost_rate) || parseFloat(row.rate) || null,
        vat_rate: coerceLegalVatRate(row.vat_rate),
      }
    })
    .filter((row): row is NonNullable<typeof row> => row !== null)

  const skipped = rows.length - toInsert.length
  if (toInsert.length === 0) return { error: 'Aucune opération valide (colonne "Désignation" requise).', imported: 0, skipped, skipped_reasons: skippedReasons }

  const { error } = await supabase.from('labor_rates').insert(toInsert)
  if (error) {
    console.error('[importLaborRates]', error)
    return { error: "Erreur lors de l'import en base de données.", imported: 0, skipped, skipped_reasons: skippedReasons }
  }

  await trackImportJob({ supabase, orgId: organizationId, userId: user.id, type: 'labor_rates', fileName: formData.get('file_name') as string | undefined, totalRows: rows.length, importedRows: toInsert.length, skippedRows: skipped, skippedReasons })
  revalidatePath('/catalog')
  return { error: null, imported: toInsert.length, skipped, skipped_reasons: skippedReasons }
}

// ─── Materials ────────────────────────────────────────────────────────────────

export type CreateMaterialState = { error: string | null; success: boolean }

export async function createMaterial(
  _prevState: CreateMaterialState,
  formData: FormData,
): Promise<CreateMaterialState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', success: false }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', success: false }

  const name = (formData.get('name') as string)?.trim()
  if (!name) return { error: 'La désignation est requise.', success: false }

  const reference = (formData.get('reference') as string)?.trim() || autoRef('ART')
  const item_kind = (formData.get('item_kind') as string)?.trim() === 'service' ? 'service' : 'article'
  const unit = (formData.get('unit') as string)?.trim() || null
  const category = (formData.get('category') as string)?.trim() || null
  const supplier = (formData.get('supplier') as string)?.trim() || null
  const supplier_id = (formData.get('supplier_id') as string)?.trim() || null
  const purchase_price = parseFloat(formData.get('purchase_price') as string) || null
  const margin_rate = parseFloat(formData.get('margin_rate') as string) || 0
  const sale_price = parseFloat(formData.get('sale_price') as string) || null
  const vat_rate = coerceLegalVatRate(formData.get('vat_rate'))
  const dimension_pricing_mode = (formData.get('dimension_pricing_mode') as string) || 'none'
  const dimension_pricing_enabled = dimension_pricing_mode !== 'none'
  const base_length_m = parseFloat(formData.get('base_length_m') as string) || null
  const base_width_m = parseFloat(formData.get('base_width_m') as string) || null
  const base_height_m = parseFloat(formData.get('base_height_m') as string) || null
  const dimension_schema = parseDimensionSchemaRaw(formData.get('dimension_schema'), dimension_pricing_mode as any)
  const variants = parseMaterialVariants(formData.get('price_variants'))

  const { data: created, error } = await supabase.from('materials').insert({
    organization_id: organizationId,
    name, reference, item_kind, unit, category, supplier, supplier_id,
    purchase_price, margin_rate, sale_price, vat_rate,
    dimension_pricing_mode, dimension_pricing_enabled,
    base_length_m, base_width_m, base_height_m,
    dimension_schema,
  }).select('id').single()

  if (error) {
    console.error('[createMaterial]', error)
    return { error: "Erreur lors de la création du matériau.", success: false }
  }

  if (created?.id) {
    const variantResult = await replaceMaterialPriceVariants({ supabase, materialId: created.id, organizationId, variants })
    if (variantResult.error) return { error: variantResult.error, success: false }
  }

  revalidatePath('/catalog')
  return { error: null, success: true }
}

export async function updateMaterial(
  materialId: string,
  updates: {
    name?: string
    reference?: string | null
    item_kind?: 'article' | 'service'
    category?: string | null
    unit?: string | null
    supplier?: string | null
    supplier_id?: string | null
    description?: string | null
    purchase_price?: number | null
    margin_rate?: number | null
    sale_price?: number | null
    vat_rate?: number | null
    dimension_pricing_mode?: 'none' | 'linear' | 'area' | 'volume'
    dimension_pricing_enabled?: boolean
    base_length_m?: number | null
    base_width_m?: number | null
    base_height_m?: number | null
    dimension_schema?: unknown
    price_variants?: MaterialVariantInput[]
  },
): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { price_variants, ...materialUpdates } = updates

  const { error } = await supabase
    .from('materials')
    .update({
      ...materialUpdates,
      ...(updates.vat_rate !== undefined ? { vat_rate: coerceLegalVatRate(updates.vat_rate) } : {}),
      ...(updates.dimension_schema !== undefined ? { dimension_schema: parseDimensionSchemaRaw(updates.dimension_schema, (updates.dimension_pricing_mode as any) ?? 'none') } : {}),
    })
    .eq('id', materialId)
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[updateMaterial]', error)
    return { error: "Erreur lors de la mise à jour." }
  }

  if (price_variants !== undefined) {
    const variantResult = await replaceMaterialPriceVariants({ supabase, materialId, organizationId, variants: price_variants })
    if (variantResult.error) return variantResult
  }

  revalidatePath('/catalog')
  return { error: null }
}

export async function deleteMaterial(materialId: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('materials')
    .update({ is_active: false })
    .eq('id', materialId)
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[deleteMaterial]', error)
    return { error: "Erreur lors de la suppression." }
  }

  revalidatePath('/catalog')
  return { error: null }
}

// ─── Labor Rates ──────────────────────────────────────────────────────────────

export type CreateLaborRateState = { error: string | null; success: boolean }

export async function createLaborRate(
  _prevState: CreateLaborRateState,
  formData: FormData,
): Promise<CreateLaborRateState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', success: false }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', success: false }

  const designation = (formData.get('designation') as string)?.trim()
  if (!designation) return { error: "Le nom de l'opération est requis.", success: false }

  const reference = (formData.get('reference') as string)?.trim() || autoRef('MO')
  const unit = (formData.get('unit') as string)?.trim() || 'h'
  const category = (formData.get('category') as string)?.trim() || null
  const type = normalizeLaborType(formData.get('type'))
  const cost_rate = parseFloat(formData.get('cost_rate') as string) || null
  const margin_rate = 0
  const rate = parseFloat(formData.get('rate') as string) || cost_rate
  const vat_rate = coerceLegalVatRate(formData.get('vat_rate'))
  const purchase_price = parseFloat(formData.get('purchase_price') as string) || null
  const lifetime_uses = parseInt(formData.get('lifetime_uses') as string, 10) || null

  const { error } = await supabase.from('labor_rates').insert({
    organization_id: organizationId,
    designation, reference, unit, category, type,
    cost_rate, margin_rate, rate, vat_rate,
    purchase_price, lifetime_uses,
  })

  if (error) {
    console.error('[createLaborRate]', error)
    return { error: "Erreur lors de la création de l'opération.", success: false }
  }

  revalidatePath('/catalog')
  return { error: null, success: true }
}

export async function updateLaborRate(
  laborRateId: string,
  updates: {
    designation?: string
    reference?: string | null
    category?: string | null
    unit?: string | null
    type?: string | null
    cost_rate?: number | null
    margin_rate?: number | null
    rate?: number | null
    vat_rate?: number | null
    purchase_price?: number | null
    lifetime_uses?: number | null
  },
): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('labor_rates')
    .update({
      ...updates,
      ...(updates.cost_rate !== undefined && updates.rate === undefined ? { rate: updates.cost_rate } : {}),
      ...(updates.vat_rate !== undefined ? { vat_rate: coerceLegalVatRate(updates.vat_rate) } : {}),
    })
    .eq('id', laborRateId)
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[updateLaborRate]', error)
    return { error: "Erreur lors de la mise à jour." }
  }

  revalidatePath('/catalog')
  return { error: null }
}

export async function createLaborRateQuick(params: {
  designation: string
  rate: number
  unit: string
  category?: string | null
}): Promise<{ error: string | null; laborRate: { id: string; designation: string; rate: number; unit: string } | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', laborRate: null }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', laborRate: null }

  const { data, error } = await supabase
    .from('labor_rates')
    .insert({
      organization_id: organizationId,
      designation: params.designation.trim(),
      reference: autoRef('MO'),
      unit: params.unit || 'h',
      category: params.category ?? null,
      type: 'human',
      cost_rate: params.rate,
      margin_rate: 0,
      rate: params.rate,
      vat_rate: coerceLegalVatRate(20),
    })
    .select('id, designation, rate, unit')
    .single()

  if (error || !data) {
    console.error('[createLaborRateQuick]', error)
    return { error: "Erreur lors de l'enregistrement dans le catalogue.", laborRate: null }
  }

  revalidatePath('/catalog')
  return { error: null, laborRate: data as { id: string; designation: string; rate: number; unit: string } }
}

export async function deleteLaborRate(laborRateId: string): Promise<Result> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.' }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('labor_rates')
    .update({ is_active: false })
    .eq('id', laborRateId)
    .eq('organization_id', organizationId)

  if (error) {
    console.error('[deleteLaborRate]', error)
    return { error: "Erreur lors de la suppression." }
  }

  revalidatePath('/catalog')
  return { error: null }
}

// ─── Prestations types ────────────────────────────────────────────────────────

import type { DistanceRule, PrestationItemType } from '@/lib/data/queries/catalog'

export type PrestationTypeItemInput = {
  position: number
  section_title: string
  item_type: PrestationItemType
  material_id: string | null
  labor_rate_id: string | null
  designation: string
  quantity: number
  unit: string
  unit_price_ht: number
  unit_cost_ht: number
  is_internal: boolean
  save_to_catalog?: boolean  // si true + material_id null : crée l'article ou service dans le catalogue
}

export async function setPrestationTypeItems(
  prestationTypeId: string,
  items: PrestationTypeItemInput[],
): Promise<{ error: string | null; prestation?: import('@/lib/data/queries/catalog').PrestationType }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { data: pt } = await supabase
    .from('prestation_types')
    .select('id')
    .eq('id', prestationTypeId)
    .eq('organization_id', orgId)
    .single()
  if (!pt) return { error: 'Prestation introuvable.' }

  // Auto-création des articles libres à enregistrer dans le catalogue
  const resolvedItems = await Promise.all(items.map(async item => {
    if ((item.item_type === 'material' || item.item_type === 'service') && !item.material_id && item.save_to_catalog && item.designation.trim()) {
      const { data: newMat } = await supabase
        .from('materials')
        .insert({
          organization_id: orgId,
          name: item.designation.trim(),
          item_kind: item.item_type === 'service' ? 'service' : 'article',
          unit: item.unit || null,
          sale_price: item.unit_price_ht || null,
          purchase_price: item.unit_cost_ht || null,
          margin_rate: item.unit_price_ht && item.unit_cost_ht
            ? Math.round((item.unit_price_ht - item.unit_cost_ht) / item.unit_price_ht * 100)
            : 0,
          vat_rate: coerceLegalVatRate(20),
          reference: `ART-${Date.now().toString(36).toUpperCase().slice(-6)}`,
        })
        .select('id')
        .single()
      if (newMat) return { ...item, material_id: newMat.id }
    }
    return item
  }))

  const { error: delErr } = await supabase
    .from('prestation_type_items')
    .delete()
    .eq('prestation_type_id', prestationTypeId)
  if (delErr) return { error: delErr.message }

  if (resolvedItems.length > 0) {
    const { error: insErr } = await supabase
      .from('prestation_type_items')
      .insert(resolvedItems.map(({ save_to_catalog: _, ...item }) => ({
        prestation_type_id: prestationTypeId,
        organization_id: orgId,
        ...item,
      })))
    if (insErr) return { error: insErr.message }
  }

  revalidatePath('/catalog')

  const { data: updated } = await supabase
    .from('prestation_types')
    .select('*, items:prestation_type_items(*)')
    .eq('id', prestationTypeId)
    .single()

  return { error: null, prestation: updated ?? undefined }
}

export type PrestationTypeInput = {
  name: string
  description?: string | null
  unit: string
  category?: string | null
  profileKind?: 'article' | 'service' | 'mixed'
  basePriceHt: number
  baseCostHt: number
  distanceRules?: DistanceRule[]
  vatRate?: number
  isActive?: boolean
}

export async function createPrestationType(data: PrestationTypeInput): Promise<{ id: string | null; error: string | null }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { id: null, error: 'Non authentifié.' }
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { id: null, error: 'Organisation introuvable.' }

  const { data: row, error } = await supabase.from('prestation_types').insert({
    organization_id: orgId,
    name: data.name.trim(),
    description: data.description ?? null,
    unit: data.unit || 'm²',
    category: data.category ?? null,
    profile_kind: data.profileKind ?? 'mixed',
    base_price_ht: data.basePriceHt,
    base_cost_ht: data.baseCostHt,
    distance_rules: data.distanceRules ?? [],
    vat_rate: coerceLegalVatRate(data.vatRate, 20),
    is_active: data.isActive ?? true,
    created_by: user.id,
  }).select('id').single()

  if (error) return { id: null, error: error.message }
  revalidatePath('/catalog')
  return { id: row.id, error: null }
}

export async function updatePrestationType(
  id: string,
  data: Partial<PrestationTypeInput>,
): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const patch: Record<string, unknown> = {}
  if (data.name !== undefined)          patch.name            = data.name.trim()
  if (data.description !== undefined)   patch.description     = data.description
  if (data.unit !== undefined)          patch.unit            = data.unit
  if (data.category !== undefined)      patch.category        = data.category
  if (data.profileKind !== undefined)   patch.profile_kind    = data.profileKind
  if (data.basePriceHt !== undefined)   patch.base_price_ht   = data.basePriceHt
  if (data.baseCostHt !== undefined)    patch.base_cost_ht    = data.baseCostHt
  if (data.distanceRules !== undefined) patch.distance_rules  = data.distanceRules
  if (data.vatRate !== undefined)       patch.vat_rate        = coerceLegalVatRate(data.vatRate, 20)
  if (data.isActive !== undefined)      patch.is_active       = data.isActive

  const { error } = await supabase
    .from('prestation_types')
    .update(patch)
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/catalog')
  return { error: null }
}

export async function deletePrestationType(id: string): Promise<{ error: string | null }> {
  const supabase = await createClient()
  const orgId = await getCurrentOrganizationId()
  if (!orgId) return { error: 'Organisation introuvable.' }

  const { error } = await supabase
    .from('prestation_types')
    .delete()
    .eq('id', id)
    .eq('organization_id', orgId)

  if (error) return { error: error.message }
  revalidatePath('/catalog')
  return { error: null }
}

// ─── Import modèles de devis (2 fichiers CSV) ─────────────────────────────────

type RawPrestationTypeRow = Record<string, string>
type RawPrestationLineRow = Record<string, string>

export async function importPrestationTypes(
  _prevState: ImportCatalogState,
  formData: FormData,
): Promise<ImportCatalogState> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Non authentifié.', imported: 0, skipped: 0, skipped_reasons: [] }

  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { error: 'Organisation introuvable.', imported: 0, skipped: 0, skipped_reasons: [] }

  const headersJson = formData.get('headers_json') as string
  const linesJson = formData.get('lines_json') as string | null

  if (!headersJson) return { error: 'Aucune donnée de modèles à importer.', imported: 0, skipped: 0, skipped_reasons: [] }

  let headerRows: RawPrestationTypeRow[]
  let lineRows: RawPrestationLineRow[] = []

  try { headerRows = JSON.parse(headersJson) } catch {
    return { error: 'Format du fichier modèles invalide.', imported: 0, skipped: 0, skipped_reasons: [] }
  }

  if (linesJson) {
    try { lineRows = JSON.parse(linesJson) } catch {
      return { error: 'Format du fichier lignes invalide.', imported: 0, skipped: 0, skipped_reasons: [] }
    }
  }

  // Grouper les lignes par template_ref
  const linesByRef: Record<string, RawPrestationLineRow[]> = {}
  for (const line of lineRows) {
    const ref = line.template_ref?.trim()
    if (!ref) continue
    if (!linesByRef[ref]) linesByRef[ref] = []
    linesByRef[ref].push(line)
  }

  const skippedReasons: string[] = []
  let imported = 0

  for (let i = 0; i < headerRows.length; i++) {
    const row = headerRows[i]
    if (!row.name?.trim()) {
      skippedReasons.push(`Ligne ${i + 1} ignorée : nom manquant`)
      continue
    }

    const templateRef = row.template_ref?.trim() || row.name.trim()

    const { data: pt, error: ptErr } = await supabase
      .from('prestation_types')
      .insert({
        organization_id: organizationId,
        name: row.name.trim(),
        description: row.description?.trim() || null,
        unit: row.unit?.trim() || 'm²',
        category: row.category?.trim() || null,
        profile_kind: 'mixed',
        base_price_ht: parseFloat(row.base_price_ht) || 0,
        base_cost_ht: parseFloat(row.base_cost_ht) || 0,
        distance_rules: [],
        vat_rate: coerceLegalVatRate(row.vat_rate, 20),
        is_active: true,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (ptErr || !pt) {
      skippedReasons.push(`Ligne ${i + 1} (${row.name}) : ${ptErr?.message ?? 'erreur insertion'}`)
      continue
    }

    // Insérer les lignes liées à ce template_ref
    const matchedLines = linesByRef[templateRef] ?? []
    if (matchedLines.length > 0) {
      const itemsToInsert = matchedLines.map((line, idx) => ({
        prestation_type_id: pt.id,
        organization_id: organizationId,
        position: parseInt(line.position ?? String(idx), 10) || idx,
        section_title: '',
        item_type: (['material', 'service', 'labor', 'transport', 'free', 'equipment'] as const).includes(line.item_type as PrestationItemType) ? line.item_type as PrestationItemType : 'free',
        material_id: null,
        labor_rate_id: null,
        designation: line.designation?.trim() || '—',
        quantity: parseFloat(line.quantity) || 1,
        unit: line.unit?.trim() || 'u',
        unit_price_ht: parseFloat(line.unit_price_ht) || 0,
        unit_cost_ht: parseFloat(line.unit_cost_ht) || 0,
        is_internal: false,
      }))

      await supabase.from('prestation_type_items').insert(itemsToInsert)
    }

    imported++
  }

  const skipped = headerRows.length - imported
  await trackImportJob({
    supabase, orgId: organizationId, userId: user.id,
    type: 'quotes',
    fileName: formData.get('file_name') as string | undefined,
    totalRows: headerRows.length, importedRows: imported, skippedRows: skipped, skippedReasons,
  })

  revalidatePath('/catalog')
  return { error: imported === 0 ? 'Aucun modèle importé.' : null, imported, skipped, skipped_reasons: skippedReasons }
}
