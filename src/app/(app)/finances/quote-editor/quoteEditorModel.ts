// @atelier-migrated
// Logique pure de l'éditeur de devis : types locaux, conversions et calculs.
// Aucun état React ici, pour pouvoir la tester seule.

import type { Client } from '@/lib/data/queries/clients'
import { getClientDisplayName } from '@/lib/client'
import { computeLinearQuantity, computeSurfaceQuantity, computeVolumeQuantity, type DimensionPricingMode } from '@/lib/catalog-pricing'
import type { QuoteItem } from '@/lib/data/queries/quotes'
import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { DEFAULT_CONSUMPTION_L_PER_100KM } from '@/lib/utils/fuel'

export const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

export function clientDisplayName(c: Client) {
  return getClientDisplayName(c)
}

export function getSafeReturnTo(value: string | null, fallback: string) {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export function normalizeSearchText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim()
}

export function findBestClientMatch(clients: Client[], rawSearch: string | null | undefined): Client | null {
  const search = normalizeSearchText(rawSearch)
  if (!search) return null

  let best: { client: Client; score: number } | null = null
  for (const client of clients) {
    const fields = [
      client.company_name,
      client.contact_name,
      [client.first_name, client.last_name].filter(Boolean).join(' '),
      client.email,
      client.phone,
    ].filter(Boolean) as string[]

    let score = 0
    for (const field of fields) {
      const normalized = normalizeSearchText(field)
      if (!normalized) continue
      if (normalized === search) score = Math.max(score, 100)
      else if (normalized.includes(search) || search.includes(normalized)) score = Math.max(score, 80)
      else {
        const searchTokens = search.split(' ').filter(token => token.length >= 2)
        const fieldTokens = normalized.split(' ').filter(token => token.length >= 2)
        const matches = searchTokens.filter(token => fieldTokens.some(fieldToken => fieldToken === token || fieldToken.includes(token) || token.includes(fieldToken))).length
        if (matches > 0) score = Math.max(score, Math.round((matches / searchTokens.length) * 70))
      }
    }

    if (!best || score > best.score) best = { client, score }
  }

  return best && best.score >= 45 ? best.client : null
}

export function getAIClientSearch(aiResult: AIQuoteResult): string | null {
  return aiResult.clientDraft?.siret
    || aiResult.clientDraft?.company_name
    || aiResult.clientDraft?.contact_name
    || [aiResult.clientDraft?.first_name, aiResult.clientDraft?.last_name].filter(Boolean).join(' ')
    || aiResult.clientDraft?.email
    || aiResult.clientDraft?.phone
    || aiResult.clientName
    || null
}

export function getAIClientDraftInput(aiResult: AIQuoteResult) {
  const draft = aiResult.clientDraft
  const clientName = aiResult.clientName?.trim() || null
  const type: 'company' | 'individual' = draft?.type === 'individual' ? 'individual' : 'company'
  const fullName = type === 'individual' && clientName ? clientName.split(/\s+/).filter(Boolean) : []
  const companyName = type === 'company' ? draft?.company_name?.trim() || clientName || '' : ''
  const firstName = draft?.first_name?.trim() || (type === 'individual' && fullName.length > 1 ? fullName.slice(0, -1).join(' ') : '')
  const lastName = draft?.last_name?.trim() || (type === 'individual' ? fullName.at(-1) ?? clientName ?? '' : '')

  if (!companyName && !firstName && !lastName && !draft?.email && !draft?.phone && !draft?.siret) return null

  return {
    type,
    company_name: companyName,
    contact_name: draft?.contact_name?.trim() || '',
    first_name: firstName,
    last_name: lastName,
    email: draft?.email?.trim() || '',
    phone: draft?.phone?.trim() || '',
    siret: draft?.siret?.replace(/\D/g, '').trim() || '',
    address_line1: draft?.address_line1?.trim() || '',
    postal_code: draft?.postal_code?.trim() || '',
    city: draft?.city?.trim() || '',
    status: 'prospect' as const,
    source: 'ai_quote',
  }
}

export function isLikelyInternalAIItem(sectionTitle: string, item: AIQuoteResult['sections'][number]['items'][number]) {
  if (item.is_internal === true) return true
  const haystack = normalizeSearchText(`${sectionTitle} ${item.description}`)
  return [
    'main d oeuvre',
    'main d',
    'mo interne',
    'ressource interne',
    'cout interne',
    'cout de revient',
    'deplacement',
    'transport',
    'carburant',
    'frais de route',
    'coordination interne',
    'preparation interne',
  ].some(token => haystack.includes(token))
}

export function inferLaborCategory(sectionTitle: string | null | undefined, description: string | null | undefined): LocalItem['labor_category'] {
  const haystack = normalizeSearchText(`${sectionTitle ?? ''} ${description ?? ''}`)
  if (!haystack) return null
  if (['thermolaquage', 'galvanisation', 'galva', 'traitement surface', 'finition st', 'sous traitance finition'].some(token => haystack.includes(token))) return 'finition'
  if (['pose', 'scellement', 'fixation', 'installation', 'chantier', 'livraison'].some(token => haystack.includes(token))) return 'pose'
  if (['atelier', 'fabrication', 'debit', 'faconnage', 'soudure', 'assemblage', 'meulage', 'decoupe', 'pliage'].some(token => haystack.includes(token))) return 'atelier'
  return null
}

export type LocalItem = {
  _tempId: string
  id: string | null
  description: string
  quantity: number
  unit: string
  unit_price: number
  unit_cost_ht: number | null
  vat_rate: number
  type: 'material' | 'labor' | 'custom'
  material_id: string | null
  labor_rate_id: string | null
  position: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dimension_pricing_mode: 'none' | 'linear' | 'area' | 'volume' | null
  dim_quantity: number
  is_estimated: boolean  // UI uniquement - non persisté en DB
  is_internal: boolean
  // Métadonnées transport - UI uniquement, non persistées en DB
  transport_km: number | null
  transport_conso: number | null
  transport_prix_l: number | null
  // Module prix matières
  metal_grid_id: string | null
  // Cours LME (€/kg) au moment de la sélection de grille - UI uniquement, non persisté en DB.
  // Permet de recalculer le prix au poids réel (L × l × épaisseur × densité) quand
  // l'artisan saisit les dimensions de la pièce après avoir choisi la grille.
  metal_lme_price_eur_kg: number | null
  price_pending: boolean
  labor_category: 'atelier' | 'pose' | 'finition' | 'autre' | null
}

export type LaborCategoryValue = NonNullable<LocalItem['labor_category']>

export const LABOR_CATEGORY_OPTIONS: Record<ResolvedCatalogContext['businessProfile'], Array<{ value: LaborCategoryValue | ''; label: string }>> = {
  cleaning: [
    { value: '', label: 'Main d\'oeuvre' },
    { value: 'atelier', label: 'Préparation' },
    { value: 'pose', label: 'Intervention' },
    { value: 'finition', label: 'Remise en état' },
    { value: 'autre', label: 'Autre' },
  ],
  btp: [
    { value: '', label: 'Main d\'oeuvre' },
    { value: 'atelier', label: 'Préparation' },
    { value: 'pose', label: 'Réalisation' },
    { value: 'finition', label: 'Finition' },
    { value: 'autre', label: 'Autre' },
  ],
  industry: [
    { value: '', label: 'Main d\'oeuvre' },
    { value: 'atelier', label: 'Atelier' },
    { value: 'pose', label: 'Pose' },
    { value: 'finition', label: 'Finition' },
    { value: 'autre', label: 'Autre' },
  ],
}

export function getLaborCategoryOptions(profile: ResolvedCatalogContext['businessProfile']) {
  return LABOR_CATEGORY_OPTIONS[profile] ?? LABOR_CATEGORY_OPTIONS.btp
}

export type LocalSection = {
  _tempId: string
  id: string | null
  title: string
  position: number
  items: LocalItem[]
}

export function roundCurrency(n: number) {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function getInternalCostTotal(item: LocalItem) {
  const unitCost = item.unit_cost_ht != null ? item.unit_cost_ht : (item.is_internal ? item.unit_price : 0)
  return item.quantity * unitCost
}

export function getInternalSaleTotal(item: LocalItem) {
  return item.is_internal ? item.quantity * item.unit_price : 0
}

export function resolvePersistedSectionId(section: LocalSection | undefined): string | null | undefined {
  if (!section) return undefined
  if (section._tempId === '_unsectioned') return null
  return section.id
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

export function itemToLocal(i: QuoteItem): LocalItem {
  const dimensionMode = inferDimensionMode(i)
  const isTransportLine = (i.is_internal ?? false) && i.unit === 'L' && (i.description ?? '').toLowerCase().includes('carburant')
  return {
    _tempId: i.id,
    id: i.id,
    description: i.description ?? '',
    quantity: i.quantity,
    unit: i.unit ?? 'u',
    unit_price: i.unit_price,
    unit_cost_ht: i.unit_cost_ht ?? null,
    length_m: i.length_m ?? null,
    width_m: i.width_m ?? null,
    height_m: i.height_m ?? null,
    dimension_pricing_mode: dimensionMode,
    dim_quantity: (i as { dim_quantity?: number }).dim_quantity ?? 1,
    vat_rate: i.vat_rate,
    type: i.type,
    material_id: i.material_id,
    labor_rate_id: i.labor_rate_id,
    position: i.position,
    is_estimated: false,
    is_internal: i.is_internal ?? false,
    transport_km: isTransportLine ? Math.round(i.quantity / DEFAULT_CONSUMPTION_L_PER_100KM * 100) : null,
    transport_conso: isTransportLine ? DEFAULT_CONSUMPTION_L_PER_100KM : null,
    transport_prix_l: isTransportLine ? i.unit_price : null,
    metal_grid_id: i.metal_grid_id ?? null,
    metal_lme_price_eur_kg: null,
    price_pending: (i as { price_pending?: boolean }).price_pending ?? false,
    labor_category: (i as { labor_category?: 'atelier' | 'pose' | 'finition' | 'autre' | null }).labor_category ?? null,
  }
}

// ─── Props ──────────────────────────────────────────────────────────────────

// ─── Totaux ─────────────────────────────────────────────────────────────────

export function computeQuoteTotals(sections: LocalSection[]) {
  const allItems = sections.flatMap(s => s.items)
  const visibleItems = allItems.filter(i => !i.is_internal)
  const internalItems = allItems.filter(i => i.is_internal)
  // Totaux client = hors lignes internes (celles-ci n'apparaissent pas sur le PDF)
  const totalHt = visibleItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const totalTva = visibleItems.reduce((sum, i) => sum + i.quantity * i.unit_price * (i.vat_rate / 100), 0)
  const totalTtc = totalHt + totalTva
  // Coût interne réel = unit_cost_ht sur toutes les lignes (achat matière + coût horaire MO).
  // Les lignes sans unit_cost_ht (saisie libre) contribuent leur unit_price comme coût proxy.
  const totalInternalHt = allItems.reduce((sum, i) => sum + getInternalCostTotal(i), 0)
  const internalOnlyHt = internalItems.reduce((sum, i) => sum + getInternalCostTotal(i), 0)
  const internalSaleToDistributeHt = internalItems.reduce((sum, i) => sum + getInternalSaleTotal(i), 0)
  const margeHt = totalHt - totalInternalHt
  const margePct = totalHt > 0 ? (margeHt / totalHt) * 100 : 0
  const hasInternalItems = allItems.some(i => i.unit_cost_ht != null || i.is_internal)
  const pendingSupplierPrices = visibleItems.filter(i => i.price_pending).length
  const canDistributeInternalCosts = internalSaleToDistributeHt > 0 && visibleItems.some(i => !i.price_pending && i.quantity > 0)
  return {
    allItems, visibleItems, internalItems,
    totalHt, totalTva, totalTtc,
    totalInternalHt, internalOnlyHt, internalSaleToDistributeHt,
    margeHt, margePct, hasInternalItems, pendingSupplierPrices, canDistributeInternalCosts,
  }
}

export function formatGridLabel(label: string, details: string[]) {
  return details.length > 0 ? `${label} · ${details.join(' · ')}` : label
}
