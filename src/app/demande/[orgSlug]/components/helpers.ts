import {
  buildMaterialSelectionPricing,
  computeLinearQuantity,
  computeSurfaceQuantity,
  computeVolumeQuantity,
  getDimensionFieldDefinition,
  type DimensionPricingMode,
} from '@/lib/catalog-pricing'
import type { PublicMaterial, PublicPrestationLine } from './types'

export const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

export const BLOCKED_EMAIL_DOMAINS = new Set([
  'yopmail.com', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc',
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.biz',
  'tempmail.com', 'temp-mail.org', 'trashmail.com', 'trashmail.me',
  'throwaway.email', 'sharklasers.com', 'fakeinbox.com', 'maildrop.cc',
  'getnada.com', 'mailnesia.com', 'dispostable.com', 'filzmail.com',
])

export function getDimensionMode(
  mode: DimensionPricingMode | null | undefined,
  enabled?: boolean | null,
): DimensionPricingMode {
  if (mode && mode !== 'none') return mode
  return enabled ? 'area' : 'none'
}

export function buildDimensionSelection(params: {
  priceVariants?: PublicMaterial['price_variants'] | PublicPrestationLine['price_variants']
  mode: DimensionPricingMode
  fallbackUnit: string | null
  baseLengthM: number | null
  baseWidthM: number | null
  baseHeightM: number | null
  lengthM?: number | null
  widthM?: number | null
  heightM?: number | null
  dimensionCount?: number
}) {
  const requestedLengthM = params.lengthM ?? null
  const requestedWidthM = params.widthM ?? null
  const requestedHeightM = params.heightM ?? null
  const pricing = buildMaterialSelectionPricing({
    item: {
      sale_price: 0,
      purchase_price: 0,
      unit: params.fallbackUnit,
      dimension_pricing_mode: params.mode,
      base_length_m: params.baseLengthM,
      base_width_m: params.baseWidthM,
      base_height_m: params.baseHeightM,
      price_variants: (params.priceVariants as any) ?? [],
    },
    requestedLengthM,
    requestedWidthM,
    requestedHeightM,
  })

  const lengthM = requestedLengthM ?? pricing.lengthM ?? params.baseLengthM ?? null
  const widthM = requestedWidthM ?? pricing.widthM ?? params.baseWidthM ?? null
  const heightM = requestedHeightM ?? pricing.heightM ?? params.baseHeightM ?? null
  const dimensionCount = Math.max(1, Math.floor(params.dimensionCount ?? 1))

  if (params.mode === 'linear' && lengthM != null) {
    return {
      quantity: computeLinearQuantity(lengthM) * dimensionCount,
      unit: 'ml',
      length_m: lengthM,
      width_m: null,
      height_m: null,
      dimension_count: dimensionCount,
    }
  }

  if (params.mode === 'area') {
    return {
      quantity: (lengthM != null && widthM != null ? computeSurfaceQuantity(lengthM, widthM) : pricing.quantity) * dimensionCount,
      unit: 'm²',
      length_m: lengthM,
      width_m: widthM,
      height_m: null,
      dimension_count: dimensionCount,
    }
  }

  if (params.mode === 'volume') {
    return {
      quantity: lengthM != null && widthM != null && heightM != null
        ? computeVolumeQuantity(lengthM, widthM, heightM) * dimensionCount
        : pricing.quantity * dimensionCount,
      unit: 'm³',
      length_m: lengthM,
      width_m: widthM,
      height_m: heightM,
      dimension_count: dimensionCount,
    }
  }

  return {
    quantity: pricing.quantity,
    unit: pricing.unit,
    length_m: pricing.lengthM,
    width_m: pricing.widthM,
    height_m: pricing.heightM,
    dimension_count: dimensionCount,
  }
}

export function formatDimensionSummary(
  mode: DimensionPricingMode,
  lengthM: number | null | undefined,
  widthM: number | null | undefined,
  heightM: number | null | undefined,
): string {
  switch (mode) {
    case 'linear':
      return `${lengthM ?? 0} m`
    case 'area':
      return `${lengthM ?? 0} m × ${widthM ?? 0} m`
    case 'volume':
      return `${lengthM ?? 0} m × ${widthM ?? 0} m × ${heightM ?? 0} m`
    default:
      return ''
  }
}

export function getDimensionFieldMeta(
  schema: PublicMaterial['dimension_schema'] | PublicPrestationLine['dimension_schema'] | null | undefined,
  axis: 'length' | 'width' | 'height',
  mode: DimensionPricingMode,
) {
  return getDimensionFieldDefinition(schema, axis, mode)
}

export function formatDimensionInputValue(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return ''
  return String(value)
}

export function parseDimensionInputValue(value: string): number | null | undefined {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  if (!/^\d*\.?\d*$/.test(normalized) || normalized === '.') return undefined
  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : undefined
}

export function groupByCategory<T extends { category: string | null }>(items: T[]): Array<{ label: string; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = item.category?.trim() || 'Autres'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
}
