export type DimensionPricingMode = 'none' | 'linear' | 'area' | 'volume'
export type DimensionAxisKey = 'length' | 'width' | 'height'
export type DimensionDisplayUnit = 'm' | 'cm' | 'mm'
export type DimensionFieldRole = 'pricing_axis' | 'display_only' | 'variant_key'

export type MaterialDimensionField = {
  enabled: boolean
  key: DimensionAxisKey
  label: string
  unit: DimensionDisplayUnit
  role: DimensionFieldRole
}

export type MaterialDimensionSchema = MaterialDimensionField[]
type DimensionFieldLike = Omit<MaterialDimensionField, 'key'> & Partial<Pick<MaterialDimensionField, 'key'>>

export type MaterialPriceVariant = {
  id: string
  material_id: string
  organization_id: string
  position: number
  label: string | null
  reference_suffix: string | null
  dimension_values: Record<string, string | number | null>
  sale_price: number | null
  purchase_price: number | null
  is_default: boolean
}

export type DimensionableCatalogItem = {
  sale_price: number | null
  purchase_price: number | null
  unit: string | null
  dimension_pricing_mode?: DimensionPricingMode | null
  dimension_pricing_enabled?: boolean | null
  base_length_m?: number | null
  base_width_m?: number | null
  base_height_m?: number | null
  dimension_schema?: MaterialDimensionSchema | null
  price_variants?: MaterialPriceVariant[] | null
}

export type MaterialSelectionPricing = {
  quantity: number
  unit: string
  unitPrice: number
  purchaseUnitPrice: number
  lengthM: number | null
  widthM: number | null
  heightM: number | null
  variant: MaterialPriceVariant | null
}

const AXES: DimensionAxisKey[] = ['length', 'width', 'height']
const UNIT_TO_METERS: Record<DimensionDisplayUnit, number> = { m: 1, cm: 0.01, mm: 0.001 }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function roundDimension(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

export function displayUnitToMeters(value: number | null | undefined, unit: DimensionDisplayUnit): number | null {
  if (value == null || Number.isNaN(value)) return null
  return roundDimension(value * UNIT_TO_METERS[unit])
}

export function metersToDisplayUnit(value: number | null | undefined, unit: DimensionDisplayUnit): number | null {
  if (value == null || Number.isNaN(value)) return null
  return roundDimension(value / UNIT_TO_METERS[unit])
}

export function getEffectiveMode(item: Pick<DimensionableCatalogItem, 'dimension_pricing_mode' | 'dimension_pricing_enabled'>): DimensionPricingMode {
  if (item.dimension_pricing_mode && item.dimension_pricing_mode !== 'none') return item.dimension_pricing_mode
  return item.dimension_pricing_enabled ? 'area' : 'none'
}

function isAxisRequired(mode: DimensionPricingMode, axis: DimensionAxisKey): boolean {
  if (axis === 'length') return mode === 'linear' || mode === 'area' || mode === 'volume'
  if (axis === 'width') return mode === 'area' || mode === 'volume'
  return mode === 'volume'
}

function defaultAxisLabel(axis: DimensionAxisKey, mode: DimensionPricingMode): string {
  if (axis === 'height' && mode === 'volume') return 'Hauteur / épaisseur'
  if (axis === 'length') return 'Longueur'
  if (axis === 'width') return 'Largeur'
  return 'Hauteur'
}

function normalizeSchemaEntry(raw: unknown, axis: DimensionAxisKey, mode: DimensionPricingMode): MaterialDimensionField {
  if (isPlainObject(raw)) {
    const unit = raw.unit === 'm' || raw.unit === 'cm' || raw.unit === 'mm' ? raw.unit : 'm'
    const role = raw.role === 'pricing_axis' || raw.role === 'display_only' || raw.role === 'variant_key'
      ? raw.role
      : isAxisRequired(mode, axis)
        ? 'pricing_axis'
        : 'variant_key'

    return {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : isAxisRequired(mode, axis),
      key: axis,
      label: typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim() : defaultAxisLabel(axis, mode),
      unit,
      role,
    }
  }

  return {
    enabled: isAxisRequired(mode, axis),
    key: axis,
    label: defaultAxisLabel(axis, mode),
    unit: 'm',
    role: isAxisRequired(mode, axis) ? 'pricing_axis' : 'variant_key',
  }
}

export function getDimensionFieldDefinition(
  rawSchema: MaterialDimensionSchema | null | undefined,
  axis: DimensionAxisKey,
  mode: DimensionPricingMode,
): MaterialDimensionField {
  const rawEntry = Array.isArray(rawSchema) ? rawSchema.find((entry) => entry?.key === axis) : null
  const normalized = normalizeSchemaEntry(rawEntry, axis, mode)
  if (isAxisRequired(mode, axis)) {
    return { ...normalized, enabled: true, role: 'pricing_axis' }
  }
  return normalized
}

export function normalizeDimensionSchema(
  rawSchema: MaterialDimensionSchema | Record<DimensionAxisKey, DimensionFieldLike> | null | undefined,
  mode: DimensionPricingMode,
): MaterialDimensionSchema {
  return AXES.map((axis) => {
    if (isPlainObject(rawSchema) && axis in rawSchema) {
      return normalizeSchemaEntry((rawSchema as Record<DimensionAxisKey, DimensionFieldLike>)[axis], axis, mode)
    }
    return getDimensionFieldDefinition(Array.isArray(rawSchema) ? rawSchema : null, axis, mode)
  }).filter((entry) => entry.enabled || isAxisRequired(mode, entry.key))
}

export function computeLinearQuantity(lengthM: number): number {
  return roundDimension(Math.max(lengthM, 0))
}

export function computeSurfaceQuantity(lengthM: number, widthM: number): number {
  return roundDimension(Math.max(lengthM, 0) * Math.max(widthM, 0))
}

export function computeVolumeQuantity(lengthM: number, widthM: number, heightM: number): number {
  return roundDimension(Math.max(lengthM, 0) * Math.max(widthM, 0) * Math.max(heightM, 0))
}

export function getBaseQuantity(item: Pick<DimensionableCatalogItem, 'base_length_m' | 'base_width_m' | 'base_height_m' | 'dimension_pricing_mode' | 'dimension_pricing_enabled'>): { quantity: number; unit: string } | null {
  const mode = getEffectiveMode(item)
  const L = item.base_length_m ?? 0
  const W = item.base_width_m ?? 0
  const H = item.base_height_m ?? 0

  switch (mode) {
    case 'linear':
      return L > 0 ? { quantity: computeLinearQuantity(L), unit: 'ml' } : null
    case 'area':
      return L > 0 && W > 0 ? { quantity: computeSurfaceQuantity(L, W), unit: 'm²' } : null
    case 'volume':
      return L > 0 && W > 0 && H > 0 ? { quantity: computeVolumeQuantity(L, W, H), unit: 'm³' } : null
    default:
      return null
  }
}

export function hasDimensionPricing(item: Pick<DimensionableCatalogItem, 'base_length_m' | 'base_width_m' | 'base_height_m' | 'dimension_pricing_mode' | 'dimension_pricing_enabled'>): boolean {
  return getBaseQuantity(item) !== null
}

export function getBaseSurface(item: Pick<DimensionableCatalogItem, 'base_length_m' | 'base_width_m'>): number | null {
  const L = item.base_length_m ?? null
  const W = item.base_width_m ?? null
  if (!L || !W || L <= 0 || W <= 0) return null
  return computeSurfaceQuantity(L, W)
}

export function getDimensionUnitPrice(totalPrice: number | null | undefined, baseQuantity: number | null): number {
  if (!totalPrice || !baseQuantity || baseQuantity <= 0) return 0
  return roundMoney(totalPrice / baseQuantity)
}

function normalizeVariantValue(value: unknown): string {
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value.trim()
  return ''
}

export function resolvePriceVariant(
  variants: MaterialPriceVariant[] | null | undefined,
  dimensionValues?: Record<string, unknown> | null,
): MaterialPriceVariant | null {
  const safeVariants = (variants ?? []).filter(Boolean)
  if (safeVariants.length === 0) return null

  const normalizedSelection = Object.fromEntries(
    Object.entries(dimensionValues ?? {})
      .map(([key, value]) => [key, normalizeVariantValue(value)])
      .filter(([, value]) => value !== ''),
  )

  const exact = safeVariants.find((variant) => {
    const entries = Object.entries(variant.dimension_values ?? {})
      .map(([key, value]) => [key, normalizeVariantValue(value)])
      .filter(([, value]) => value !== '')
    return entries.length > 0 && entries.every(([key, value]) => normalizedSelection[key] === value)
  })

  return exact ?? safeVariants.find((variant) => variant.is_default) ?? safeVariants[0] ?? null
}

export function buildDimensionRequestPricing(params: {
  salePrice: number | null
  purchasePrice: number | null
  baseLengthM: number | null
  baseWidthM: number | null
  baseHeightM?: number | null
  requestedLengthM: number | null
  requestedWidthM: number | null
  requestedHeightM?: number | null
  mode?: DimensionPricingMode | null
  fallbackUnit?: string | null
}): {
  quantity: number
  unit: string
  unitPrice: number
  purchaseUnitPrice: number
  lengthM: number | null
  widthM: number | null
  heightM: number | null
} {
  const {
    salePrice,
    purchasePrice,
    baseLengthM,
    baseWidthM,
    baseHeightM,
    requestedLengthM,
    requestedWidthM,
    requestedHeightM,
    mode = 'area',
    fallbackUnit,
  } = params

  const item = {
    base_length_m: baseLengthM,
    base_width_m: baseWidthM,
    base_height_m: baseHeightM,
    dimension_pricing_mode: mode,
    dimension_pricing_enabled: mode !== 'none',
  }
  const base = getBaseQuantity(item)
  const L = requestedLengthM && requestedLengthM > 0 ? requestedLengthM : baseLengthM
  const W = requestedWidthM && requestedWidthM > 0 ? requestedWidthM : baseWidthM
  const H = requestedHeightM && requestedHeightM > 0 ? requestedHeightM : baseHeightM

  if (!base || !L) {
    return {
      quantity: 1,
      unit: fallbackUnit ?? 'u',
      unitPrice: roundMoney(salePrice ?? 0),
      purchaseUnitPrice: roundMoney(purchasePrice ?? 0),
      lengthM: null,
      widthM: null,
      heightM: null,
    }
  }

  const unitPriceSale = getDimensionUnitPrice(salePrice, base.quantity)
  const unitPricePurchase = getDimensionUnitPrice(purchasePrice, base.quantity)
  const effectiveMode = mode ?? 'none'

  if (effectiveMode === 'linear') {
    return {
      quantity: computeLinearQuantity(L),
      unit: 'ml',
      unitPrice: unitPriceSale,
      purchaseUnitPrice: unitPricePurchase,
      lengthM: L,
      widthM: null,
      heightM: null,
    }
  }

  if (effectiveMode === 'volume' && W && H) {
    return {
      quantity: computeVolumeQuantity(L, W, H),
      unit: 'm³',
      unitPrice: unitPriceSale,
      purchaseUnitPrice: unitPricePurchase,
      lengthM: L,
      widthM: W,
      heightM: H,
    }
  }

  if (effectiveMode === 'area' && W) {
    return {
      quantity: computeSurfaceQuantity(L, W),
      unit: 'm²',
      unitPrice: unitPriceSale,
      purchaseUnitPrice: unitPricePurchase,
      lengthM: L,
      widthM: W,
      heightM: null,
    }
  }

  return {
    quantity: 1,
    unit: fallbackUnit ?? 'u',
    unitPrice: roundMoney(salePrice ?? 0),
    purchaseUnitPrice: roundMoney(purchasePrice ?? 0),
    lengthM: null,
    widthM: null,
    heightM: null,
  }
}

export function buildMaterialSelectionPricing(params: {
  item: DimensionableCatalogItem
  requestedLengthM?: number | null
  requestedWidthM?: number | null
  requestedHeightM?: number | null
  dimensionValues?: Record<string, unknown> | null
}): MaterialSelectionPricing {
  const variant = resolvePriceVariant(params.item.price_variants, params.dimensionValues)
  const pricing = buildDimensionRequestPricing({
    salePrice: variant?.sale_price ?? params.item.sale_price ?? null,
    purchasePrice: variant?.purchase_price ?? params.item.purchase_price ?? null,
    baseLengthM: params.item.base_length_m ?? null,
    baseWidthM: params.item.base_width_m ?? null,
    baseHeightM: params.item.base_height_m ?? null,
    requestedLengthM: params.requestedLengthM ?? null,
    requestedWidthM: params.requestedWidthM ?? null,
    requestedHeightM: params.requestedHeightM ?? null,
    mode: getEffectiveMode(params.item),
    fallbackUnit: params.item.unit ?? null,
  })

  return {
    ...pricing,
    variant,
  }
}

export function buildCatalogPricingPreview(item: DimensionableCatalogItem): {
  quantity: number
  unit: string
  unitPrice: number
  purchaseUnitPrice: number
  lengthM: number | null
  widthM: number | null
  heightM: number | null
  variant: MaterialPriceVariant | null
} {
  return buildMaterialSelectionPricing({ item })
}

export function formatPublicUnit(unit: string): string {
  return unit === 'ml' ? 'm' : unit
}

export function formatDimensionLabel(item: Pick<DimensionableCatalogItem, 'base_length_m' | 'base_width_m' | 'base_height_m' | 'dimension_pricing_mode' | 'dimension_pricing_enabled'>): string {
  const mode = getEffectiveMode(item)
  const L = item.base_length_m
  const W = item.base_width_m
  const H = item.base_height_m

  if (mode === 'linear') return L ? `${L} ml` : '—'
  if (mode === 'area') return L && W ? `${L} × ${W} m` : '—'
  if (mode === 'volume') return L && W && H ? `${L} × ${W} × ${H} m` : '—'
  return '—'
}
