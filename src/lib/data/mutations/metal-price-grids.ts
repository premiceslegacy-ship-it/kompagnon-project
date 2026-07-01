'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getCurrentOrganizationId } from '@/lib/data/queries/clients'
import { hasPermission } from '@/lib/data/queries/membership'
import { METAL_CODES, type MetalCode } from '@/lib/metal-prices'

export type MetalPriceGrid = {
  id: string
  organization_id: string
  label: string
  metal_code: MetalCode
  source_type: 'lme' | 'manual'
  coefficient: number
  manual_price_eur_kg: number | null
  unit: string
  catalog_item_id: string | null
  supplier_id: string | null
  thickness_mm: number | null
  format_label: string | null
  grade: string | null
  is_active: boolean
  position: number
  created_at: string
  updated_at: string
}

export type UpsertGridState = {
  error: string | null
  success: boolean
}

const GRID_UNITS = new Set(['kg', 'm²', 'ml', 'pièce', 'tonne'])

async function getMetalPricingOrganizationId(): Promise<{ organizationId: string | null; error: string | null }> {
  const supabase = await createClient()
  const organizationId = await getCurrentOrganizationId()
  if (!organizationId) return { organizationId: null, error: 'Organisation introuvable.' }

  const { data: org, error } = await supabase
    .from('organizations')
    .select('has_metal_pricing')
    .eq('id', organizationId)
    .single()

  if (error) return { organizationId: null, error: error.message }
  if (!org?.has_metal_pricing) return { organizationId: null, error: 'Module prix matières non activé.' }
  return { organizationId, error: null }
}

function isMetalCode(value: string): value is MetalCode {
  return METAL_CODES.includes(value as MetalCode)
}

function validateGridInput(params: {
  label: string
  metalCode: string
  sourceType: string
  coefficient: number
  manualPriceEurKg: number | null
  unit: string
}): string | null {
  if (!params.label) return "Le libellé est requis."
  if (params.label.length > 120) return "Le libellé doit faire 120 caractères maximum."
  if (!isMetalCode(params.metalCode)) return "Le métal source est invalide."
  if (params.sourceType !== 'lme' && params.sourceType !== 'manual') return "La source est invalide."
  if (params.metalCode === 'STEEL' && params.sourceType !== 'manual') {
    return "L'acier ne dispose pas de cotation LME, utilisez la saisie manuelle."
  }
  if (params.sourceType === 'manual') {
    if (params.manualPriceEurKg === null || !Number.isFinite(params.manualPriceEurKg) || params.manualPriceEurKg <= 0) {
      return 'Le prix manuel doit être un nombre positif.'
    }
  } else {
    if (!Number.isFinite(params.coefficient) || params.coefficient <= 0 || params.coefficient > 100) {
      return 'Le coefficient doit être compris entre 0 et 100.'
    }
  }
  if (!GRID_UNITS.has(params.unit)) return 'L\'unité est invalide.'
  return null
}

function normalizeOptionalUuid(value: FormDataEntryValue | null): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return id || null
}

async function validateOptionalLinks(params: {
  organizationId: string
  catalogItemId: string | null
  supplierId: string | null
}): Promise<string | null> {
  if (!params.catalogItemId && !params.supplierId) return null

  const supabase = await createClient()
  const checks = await Promise.all([
    params.catalogItemId
      ? supabase
          .from('materials')
          .select('id')
          .eq('id', params.catalogItemId)
          .eq('organization_id', params.organizationId)
          .eq('is_active', true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    params.supplierId
      ? supabase
          .from('suppliers')
          .select('id')
          .eq('id', params.supplierId)
          .eq('organization_id', params.organizationId)
          .eq('is_active', true)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  const [catalogCheck, supplierCheck] = checks
  if (params.catalogItemId && (catalogCheck.error || !catalogCheck.data)) return 'Article catalogue invalide.'
  if (params.supplierId && (supplierCheck.error || !supplierCheck.data)) return 'Fournisseur invalide.'
  return null
}

export async function createMetalPriceGrid(
  _prevState: UpsertGridState,
  formData: FormData,
): Promise<UpsertGridState> {
  if (!(await hasPermission('settings.edit'))) return { error: 'Permission refusée.', success: false }

  const supabase = await createClient()
  const { organizationId, error: orgError } = await getMetalPricingOrganizationId()
  if (!organizationId) return { error: orgError, success: false }

  const label = (formData.get('label') as string)?.trim()
  const metal_code = (formData.get('metal_code') as string)?.trim()
  const source_type = (formData.get('source_type') as string)?.trim() || 'lme'
  const coefficient = parseFloat(formData.get('coefficient') as string)
  const manual_price_raw = formData.get('manual_price_eur_kg')
  const manual_price_eur_kg = manual_price_raw ? parseFloat(manual_price_raw as string) : null
  const unit = (formData.get('unit') as string)?.trim() || 'kg'
  const catalog_item_id = normalizeOptionalUuid(formData.get('catalog_item_id'))
  const supplier_id = normalizeOptionalUuid(formData.get('supplier_id'))

  const validationError = validateGridInput({ label, metalCode: metal_code, sourceType: source_type, coefficient, manualPriceEurKg: manual_price_eur_kg, unit })
  if (validationError) return { error: validationError, success: false }
  const linkError = await validateOptionalLinks({ organizationId, catalogItemId: catalog_item_id, supplierId: supplier_id })
  if (linkError) return { error: linkError, success: false }

  const thickness_raw = formData.get('thickness_mm')
  const thickness_mm = thickness_raw ? parseFloat(thickness_raw as string) || null : null
  const format_label = (formData.get('format_label') as string | null)?.trim() || null
  const grade = (formData.get('grade') as string | null)?.trim() || null

  const { error } = await supabase.from('metal_price_grids').insert({
    organization_id: organizationId,
    label,
    metal_code,
    source_type,
    coefficient: source_type === 'manual' ? 1 : coefficient,
    manual_price_eur_kg: source_type === 'manual' ? manual_price_eur_kg : null,
    unit,
    catalog_item_id,
    supplier_id,
    thickness_mm,
    format_label,
    grade,
  })

  if (error) return { error: error.message, success: false }

  revalidatePath('/settings')
  return { error: null, success: true }
}

export async function updateMetalPriceGrid(
  _prevState: UpsertGridState,
  formData: FormData,
): Promise<UpsertGridState> {
  if (!(await hasPermission('settings.edit'))) return { error: 'Permission refusée.', success: false }

  const supabase = await createClient()
  const { organizationId, error: orgError } = await getMetalPricingOrganizationId()
  if (!organizationId) return { error: orgError, success: false }

  const id = (formData.get('id') as string)?.trim()
  const label = (formData.get('label') as string)?.trim()
  const metal_code = (formData.get('metal_code') as string)?.trim()
  const source_type = (formData.get('source_type') as string)?.trim() || 'lme'
  const coefficient = parseFloat(formData.get('coefficient') as string)
  const manual_price_raw = formData.get('manual_price_eur_kg')
  const manual_price_eur_kg = manual_price_raw ? parseFloat(manual_price_raw as string) : null
  const unit = (formData.get('unit') as string)?.trim() || 'kg'
  const catalog_item_id = normalizeOptionalUuid(formData.get('catalog_item_id'))
  const supplier_id = normalizeOptionalUuid(formData.get('supplier_id'))

  if (!id) return { error: 'ID manquant.', success: false }
  const validationError = validateGridInput({ label, metalCode: metal_code, sourceType: source_type, coefficient, manualPriceEurKg: manual_price_eur_kg, unit })
  if (validationError) return { error: validationError, success: false }
  const linkError = await validateOptionalLinks({ organizationId, catalogItemId: catalog_item_id, supplierId: supplier_id })
  if (linkError) return { error: linkError, success: false }

  const thickness_raw = formData.get('thickness_mm')
  const thickness_mm = thickness_raw ? parseFloat(thickness_raw as string) || null : null
  const format_label = (formData.get('format_label') as string | null)?.trim() || null
  const grade = (formData.get('grade') as string | null)?.trim() || null

  const { error } = await supabase
    .from('metal_price_grids')
    .update({
      label,
      metal_code,
      source_type,
      coefficient: source_type === 'manual' ? 1 : coefficient,
      manual_price_eur_kg: source_type === 'manual' ? manual_price_eur_kg : null,
      unit,
      catalog_item_id,
      supplier_id,
      thickness_mm,
      format_label,
      grade,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('organization_id', organizationId)

  if (error) return { error: error.message, success: false }

  revalidatePath('/settings')
  return { error: null, success: true }
}

export async function deleteMetalPriceGrid(id: string): Promise<{ error: string | null }> {
  if (!(await hasPermission('settings.edit'))) return { error: 'Permission refusée.' }

  const supabase = await createClient()
  const { organizationId, error: orgError } = await getMetalPricingOrganizationId()
  if (!organizationId) return { error: orgError }

  const { error } = await supabase
    .from('metal_price_grids')
    .delete()
    .eq('id', id)
    .eq('organization_id', organizationId)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  return { error: null }
}

export async function getMetalPriceGrids(): Promise<MetalPriceGrid[]> {
  const supabase = await createClient()
  const { organizationId } = await getMetalPricingOrganizationId()
  if (!organizationId) return []

  const { data, error } = await supabase
    .from('metal_price_grids')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return []
  return (data ?? []) as MetalPriceGrid[]
}

export type ImportGridRow = {
  label: string
  metal_code: string
  source_type: 'lme' | 'manual'
  coefficient?: number
  manual_price_eur_kg?: number
  unit?: string
  grade?: string
  thickness_mm?: number
  format_label?: string
}

export type ImportGridsResult = {
  inserted: number
  errors: string[]
}

export async function importMetalPriceGrids(rows: ImportGridRow[]): Promise<ImportGridsResult> {
  if (!(await hasPermission('settings.edit'))) return { inserted: 0, errors: ['Permission refusée.'] }

  const { organizationId, error: orgError } = await getMetalPricingOrganizationId()
  if (!organizationId) return { inserted: 0, errors: [orgError ?? 'Organisation introuvable.'] }

  const errors: string[] = []
  const valid = rows.filter((row, i) => {
    const err = validateGridInput({
      label: row.label,
      metalCode: row.metal_code,
      sourceType: row.source_type,
      coefficient: row.coefficient ?? 1,
      manualPriceEurKg: row.manual_price_eur_kg ?? null,
      unit: row.unit ?? 'kg',
    })
    if (err) { errors.push(`Ligne ${i + 2} : ${err}`); return false }
    return true
  })

  if (valid.length === 0) return { inserted: 0, errors }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('metal_price_grids')
    .select('position')
    .eq('organization_id', organizationId)
    .order('position', { ascending: false })
    .limit(1)
  const basePosition = (existing?.[0]?.position ?? 0) + 1

  const payload = valid.map((row, i) => ({
    organization_id: organizationId,
    label: row.label,
    metal_code: row.metal_code,
    source_type: row.source_type,
    coefficient: row.source_type === 'manual' ? 1 : (row.coefficient ?? 1.35),
    manual_price_eur_kg: row.source_type === 'manual' ? (row.manual_price_eur_kg ?? null) : null,
    unit: row.unit ?? 'kg',
    grade: row.grade ?? null,
    thickness_mm: row.thickness_mm ?? null,
    format_label: row.format_label ?? null,
    position: basePosition + i,
  }))

  const { error } = await supabase.from('metal_price_grids').insert(payload)
  if (error) return { inserted: 0, errors: [error.message] }

  revalidatePath('/settings')
  return { inserted: valid.length, errors }
}
