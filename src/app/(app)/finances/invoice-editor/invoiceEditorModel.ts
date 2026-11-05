// @atelier-migrated
// Logique pure : types locaux, conversions et calculs. Aucun état React ici.

import type { Client } from '@/lib/data/queries/clients'

import { computeLinearQuantity, computeSurfaceQuantity, computeVolumeQuantity, type DimensionPricingMode } from '@/lib/catalog-pricing'

import { getClientDisplayName } from '@/lib/client'

import { DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'

export type LocalItem = {
  id: number
  desc: string
  qty: number
  unit: string
  pu: number
  unit_cost_ht: number | null
  vat: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dimension_pricing_mode: DimensionPricingMode | null
  dim_quantity: number
  is_internal: boolean
  material_id: string | null
  transport_km: number | null
  transport_conso: number | null
  transport_prix_l: number | null
}

export function getSafeReturnTo(value: string | null, fallback: string) {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export function inferDimensionMode(item: {
  unit?: string | null
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
}): DimensionPricingMode | null {
  if (item.height_m != null || item.unit === 'm³') return 'volume'
  if (item.width_m != null && item.length_m != null) return 'area'
  if (item.length_m != null && item.unit === 'ml') return 'linear'
  return null
}

export function getItemDimensionMode(item: Pick<LocalItem, 'dimension_pricing_mode' | 'length_m' | 'width_m' | 'height_m' | 'unit'>): DimensionPricingMode {
  if (item.dimension_pricing_mode && item.dimension_pricing_mode !== 'none') {
    return item.dimension_pricing_mode
  }
  return inferDimensionMode(item) ?? 'none'
}

export function getModeUnit(mode: DimensionPricingMode, fallbackUnit: string): string {
  switch (mode) {
    case 'linear':
      return 'ml'
    case 'area':
      return 'm²'
    case 'volume':
      return 'm³'
    default:
      return fallbackUnit
  }
}

export function getTransportMeta(item: {
  description?: string | null
  quantity?: number | null
  unit?: string | null
  unit_price?: number | null
  is_internal?: boolean | null
}) {
  const label = (item.description ?? '').toLowerCase()
  const isTransportLine = item.is_internal === true && item.unit === 'L' && (label.includes('carburant') || label.includes('transport') || label.includes('trajet'))
  if (!isTransportLine) return { transport_km: null, transport_conso: null, transport_prix_l: null }
  const kmMatch = label.match(/(\d+(?:[,.]\d+)?)\s*km/)
  const kmFromLabel = kmMatch ? Number(kmMatch[1].replace(',', '.')) : null
  return {
    transport_km: kmFromLabel ?? Math.round(((item.quantity ?? 0) / DEFAULT_CONSUMPTION_L_PER_100KM) * 100),
    transport_conso: DEFAULT_CONSUMPTION_L_PER_100KM,
    transport_prix_l: item.unit_price ?? DEFAULT_FUEL_PRICE_EUR_PER_L,
  }
}

export function isEquipmentLine(item: Pick<LocalItem, 'is_internal' | 'unit' | 'transport_prix_l'>) {
  return item.is_internal && item.unit === 'usage' && item.transport_prix_l == null
}

export function getInternalUnitCost(item: Pick<LocalItem, 'unit_cost_ht' | 'is_internal' | 'pu'>) {
  if (item.unit_cost_ht != null) return Number(item.unit_cost_ht) || 0
  return item.is_internal ? (Number(item.pu) || 0) : 0
}

export function getInternalCostTotal(item: Pick<LocalItem, 'unit_cost_ht' | 'is_internal' | 'pu' | 'qty'>) {
  return (Number(item.qty) || 0) * getInternalUnitCost(item)
}

export function parseEquipmentAmortization(description: string, unitPrice: number) {
  const match = description.match(/Amortissement\s*:\s*([\d.,]*)\s*€\s*\/\s*([\d.,]*)\s*usages?/i)
  const name = (description.split(/\n/)[0] ?? '').trim() || 'Équipement amorti'
  const rawPurchasePrice = match?.[1]?.trim() ?? ''
  const rawLifetimeUses = match?.[2]?.trim() ?? ''
  const purchasePrice = rawPurchasePrice ? Number(rawPurchasePrice.replace(',', '.')) : null
  const lifetimeUses = rawLifetimeUses ? Number(rawLifetimeUses.replace(',', '.')) : null

  return {
    name,
    purchasePrice: purchasePrice != null && Number.isFinite(purchasePrice) ? purchasePrice : null,
    lifetimeUses: lifetimeUses != null && Number.isFinite(lifetimeUses) ? lifetimeUses : null,
    costPerUse: unitPrice,
  }
}

export function buildEquipmentDescription(name: string, purchasePrice: number | null, lifetimeUses: number | null) {
  const label = name.trim() || 'Équipement amorti'
  if (purchasePrice != null || lifetimeUses != null) {
    return `${label}\n\nAmortissement : ${purchasePrice ?? ''} € / ${lifetimeUses ?? ''} usages`
  }
  return label
}

export function computeEquipmentCostPerUse(purchasePrice: number | null, lifetimeUses: number | null, fallback: number) {
  if (purchasePrice != null && purchasePrice > 0 && lifetimeUses != null && lifetimeUses > 0) {
    return Math.round((purchasePrice / lifetimeUses) * 100) / 100
  }
  return fallback
}

export function computeDimensionQuantity(
  mode: DimensionPricingMode,
  lengthM: number | null,
  widthM: number | null,
  heightM: number | null,
  fallbackQuantity: number,
  dimQuantity = 1,
): number {
  const mult = dimQuantity > 0 ? dimQuantity : 1
  switch (mode) {
    case 'linear':
      return parseFloat((computeLinearQuantity(lengthM ?? 0) * mult).toFixed(3))
    case 'area':
      return parseFloat((computeSurfaceQuantity(lengthM ?? 0, widthM ?? 0) * mult).toFixed(3))
    case 'volume':
      return parseFloat((computeVolumeQuantity(lengthM ?? 0, widthM ?? 0, heightM ?? 0) * mult).toFixed(3))
    default:
      return fallbackQuantity
  }
}

export function clientDisplayName(c: Client): string {
  return getClientDisplayName(c)
}

export const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

export const INVOICE_SECTION_UNIT = '__section__'

export function isSectionItem(item: Pick<LocalItem, 'unit'>) {
  return item.unit === INVOICE_SECTION_UNIT
}

export type LinkableChantier = { id: string; title: string; client_id: string | null; quote_id: string | null }

export type ScheduleAmountType = 'amount' | 'percentage'
export type LocalScheduleItem = {
  id: string
  label: string
  due_date: string
  amount: number
  amount_type: ScheduleAmountType
  percentage: number | null
  paid_payment_id: string | null
}

// ─── Totaux ─────────────────────────────────────────────────────────────────

export function computeInvoiceTotals(items: LocalItem[]) {
  const clientItems = items.filter(i => !i.is_internal)
  const totalHt = clientItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu), 0)
  const totalTva = clientItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu) * (Number(i.vat) / 100), 0)
  const totalTtc = totalHt + totalTva
  const totalInternalHt = items.reduce((acc, i) => acc + getInternalCostTotal(i), 0)
  const margeHt = totalHt - totalInternalHt
  const margePct = totalHt > 0 ? (margeHt / totalHt) * 100 : 0
  const hasInternal = items.some(i => i.unit_cost_ht != null || i.is_internal)
  const vatByRate = clientItems.reduce<Record<number, number>>((acc, i) => {
    const vatAmt = Number(i.qty) * Number(i.pu) * (Number(i.vat) / 100)
    acc[Number(i.vat)] = (acc[Number(i.vat)] ?? 0) + vatAmt
    return acc
  }, {})
  return { clientItems, totalHt, totalTva, totalTtc, totalInternalHt, margeHt, margePct, hasInternal, vatByRate }
}

/** Montant d'une échéance : en pourcentage du TTC (arrondi au centime) ou fixe. */
export function scheduleAmount(item: Pick<LocalScheduleItem, 'amount_type' | 'percentage' | 'amount'>, totalTtc: number) {
  if (item.amount_type === 'percentage') {
    return Math.round(totalTtc * ((Number(item.percentage) || 0) / 100) * 100) / 100
  }
  return Number(item.amount) || 0
}

