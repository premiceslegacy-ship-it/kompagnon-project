import { METAL_LABELS, type MetalCode } from '@/lib/metal-prices'

export type ManualPriceGridContext = {
  id: string
  label: string
  metalCode: string
  metalLabel: string
  sourceType: 'manual'
  manualPricePerUnit: number
  unit: string
  catalogItemId: string | null
  catalogItemName: string | null
  supplierId: string | null
  supplierName: string | null
  grade: string | null
  thicknessMm: number | null
  formatLabel: string | null
}

export type ManualPriceGridRow = {
  id: string
  organization_id: string
  label: string
  metal_code: string
  source_type: string
  manual_price_eur_kg: number | null
  unit: string
  catalog_item_id: string | null
  supplier_id: string | null
  grade: string | null
  thickness_mm: number | null
  format_label: string | null
  is_active?: boolean
}

export type LinkedMaterialName = { id: string; name: string }
export type LinkedSupplierName = { id: string; name: string }

export function selectManualPriceGridsForAI(
  rows: ManualPriceGridRow[],
  organizationId: string,
  hasMetalPricing: boolean,
  materials: LinkedMaterialName[] = [],
  suppliers: LinkedSupplierName[] = [],
): ManualPriceGridContext[] {
  if (!hasMetalPricing) return []
  const materialNames = new Map(materials.map(material => [material.id, material.name]))
  const supplierNames = new Map(suppliers.map(supplier => [supplier.id, supplier.name]))

  return rows.flatMap(row => {
    const price = Number(row.manual_price_eur_kg)
    if (
      row.organization_id !== organizationId ||
      row.source_type !== 'manual' ||
      row.is_active === false ||
      !Number.isFinite(price) || price <= 0 ||
      !row.unit?.trim()
    ) return []

    return [{
      id: row.id,
      label: row.label,
      metalCode: row.metal_code,
      metalLabel: METAL_LABELS[row.metal_code as MetalCode] ?? row.metal_code,
      sourceType: 'manual' as const,
      manualPricePerUnit: price,
      unit: row.unit,
      catalogItemId: row.catalog_item_id,
      catalogItemName: row.catalog_item_id ? materialNames.get(row.catalog_item_id) ?? null : null,
      supplierId: row.supplier_id,
      supplierName: row.supplier_id ? supplierNames.get(row.supplier_id) ?? null : null,
      grade: row.grade,
      thicknessMm: row.thickness_mm,
      formatLabel: row.format_label,
    }]
  })
}

export function formatManualPriceGridContext(grids: ManualPriceGridContext[]): string[] {
  if (grids.length === 0) {
    return ['Aucune grille de prix manuel métal exploitable n’est configurée. N’invente pas de prix matière : demande le fournisseur, la nuance, le format, l’unité et/ou le prix à l’artisan.']
  }

  const lines = ['Grilles de prix manuels configurées par l’entreprise (source : saisie manuelle de l’entreprise, prix par unité exacte de la grille) :']
  for (const grid of grids) {
    const metadata = [
      grid.catalogItemName ? `article catalogue : ${grid.catalogItemName}` : null,
      grid.supplierName ? `fournisseur : ${grid.supplierName}` : grid.supplierId ? `fournisseur lié (ID ${grid.supplierId})` : null,
      grid.grade ? `nuance : ${grid.grade}` : null,
      grid.thicknessMm != null ? `épaisseur : ${grid.thicknessMm} mm` : null,
      grid.formatLabel ? `format : ${grid.formatLabel}` : null,
    ].filter((value): value is string => Boolean(value))
    lines.push(`- ${grid.label} | ${grid.metalLabel} | ${grid.manualPricePerUnit} € / ${grid.unit} | source : prix manuel entreprise (${grid.sourceType})${metadata.length ? ` | ${metadata.join(' | ')}` : ''}`)
  }
  lines.push('N’applique une grille que si le métal, la nuance, l’épaisseur, le format, le fournisseur, l’article lié et l’unité sont sans ambiguïté. Ne convertis jamais l’unité et ne remplace jamais une variante par une autre. Si aucune source exacte ne correspond, demande une précision au lieu d’estimer le prix matière.')
  return lines
}

export type CatalogPriceReference = {
  name: string
  unit: string | null
  salePrice: number | null
  variants?: Array<{ label: string; unit: string | null; unitPrice: number }>
}

export type RecentPriceReference = { description: string; unit: string | null; unitPrice: number }

export type PriceKnowledgeItem = {
  designation?: string | null
  details?: string | null
  description: string
  quantity?: number
  unit: string
  unit_price: number
  unit_cost_ht?: number | null
  ai_source?: 'catalog' | 'recent_quote' | 'memory' | 'client_input' | 'ai_estimate' | 'document' | null
  ai_warnings?: string[]
  is_estimated?: boolean
}

export type PriceKnowledgeQuote = {
  sections: Array<{ items: PriceKnowledgeItem[] }>
  quoteWarnings?: string[]
}

export type PriceKnowledgeSources = {
  hasMetalPricing: boolean
  catalogPrices: CatalogPriceReference[]
  recentPrices: RecentPriceReference[]
  manualGrids: ManualPriceGridContext[]
}

export type PriceKnowledgeResult<T extends PriceKnowledgeQuote> = {
  quotes: T[]
  clarification: string | null
}

const METAL_ALIASES: Record<string, string[]> = {
  ALU: ['alu', 'aluminium', 'aluminum'],
  XCU: ['cuivre', 'copper'],
  ZNC: ['zinc'],
  PB: ['plomb', 'lead'],
  NI: ['nickel', 'inox', 'acier inoxydable', 'stainless steel'],
  STEEL: ['acier', 'steel'],
}

const GENERIC_CATALOG_WORDS = new Set(['article', 'materiau', 'fourniture', 'achat'])

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[×✕]/g, 'x')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\bm\s+o\b/g, 'mo')
    .trim()
}

export function findCatalogMatch<T extends { id: string }>(
  items: T[],
  raw: Record<string, unknown>,
  fields: Array<keyof T>,
): T | null {
  const explicit = raw.catalog_id ?? raw.catalogId ?? raw.id
  if (typeof explicit === 'string') {
    const byId = items.find(item => item.id === explicit)
    if (byId) return byId
  }
  const input = raw.name ?? raw.designation ?? raw.description ?? raw.catalog_name ?? raw.catalogName
  const search = typeof input === 'string' ? normalizeText(input) : ''
  if (!search) return null
  return items.find(item => fields.some(field => {
    const fieldValue = item[field]
    const value = typeof fieldValue === 'string' ? normalizeText(fieldValue) : ''
    return value.length > 0 && (value.includes(search) || search.includes(value))
  })) ?? null
}

function normalizeUnit(value: string): string {
  const unit = value.trim().toLowerCase()
  if (unit === 'm²' || unit === 'm2') return 'm²'
  if (unit === 'm³' || unit === 'm3') return 'm³'
  if (unit === 'ml') return 'ml'
  if (unit === 'kg') return 'kg'
  if (unit === 'tonne' || unit === 'tonnes') return 'tonne'
  if (unit === 'h' || unit === 'heure' || unit === 'heures') return 'h'
  if (unit === 'j' || unit === 'jour' || unit === 'jours' || unit === 'journée' || unit === 'journées') return 'jour'
  if (unit === 'pièce' || unit === 'piece' || unit === 'pièces' || unit === 'pieces') return 'pièce'
  if (unit === 'u' || unit === 'unité' || unit === 'unite' || unit === 'unités' || unit === 'unites') return 'u'
  return unit
}

function includesPhrase(haystack: string, phrase: string): boolean {
  const normalizedHaystack = ` ${normalizeText(haystack)} `
  const normalizedPhrase = normalizeText(phrase)
  return Boolean(normalizedPhrase) && normalizedHaystack.includes(` ${normalizedPhrase} `)
}

export function matchExactCatalogVariant<T extends { label?: string | null }>(
  variants: readonly T[],
  hints: readonly string[],
): { kind: 'match'; variant: T } | { kind: 'ambiguous' } | null {
  if (variants.length === 0) return null
  const matches = variants.filter(variant =>
    Boolean(variant.label) && hints.some(hint => includesPhrase(hint, variant.label!)),
  )
  return matches.length === 1 ? { kind: 'match', variant: matches[0] } : { kind: 'ambiguous' }
}

function itemText(item: PriceKnowledgeItem): string {
  return [item.designation, item.details, item.description].filter(Boolean).join(' ')
}

function detectedMetalCodes(value: string): string[] {
  const normalized = ` ${normalizeText(value)} `
  const codes = Object.entries(METAL_ALIASES)
    .filter(([, aliases]) => aliases.some(alias => normalized.includes(` ${normalizeText(alias)} `)))
    .map(([code]) => code)
  return normalized.includes(' inox ') || normalized.includes(' acier inoxydable ')
    ? codes.filter(code => code !== 'STEEL')
    : codes
}

function hasMetalCode(value: string, metalCode: string): boolean {
  if (metalCode === 'STEEL' && /(?:\binox\b|acier inoxydable)/i.test(value)) return false
  const aliases = METAL_ALIASES[metalCode] ?? []
  const normalized = ` ${normalizeText(value)} `
  return aliases.some(alias => normalized.includes(` ${normalizeText(alias)} `))
}

function thicknessValues(value: string): number[] {
  const withoutFusedSteelGrades = value.replace(
    /(?<![\p{L}\p{N}])s\d{3,4}[a-z]?(?=\d+(?:[.,]\d+)?\s*mm)/giu,
    ' ',
  )
  return [...withoutFusedSteelGrades.matchAll(/(\d+(?:[.,]\d+)?)\s*mm(?![\p{L}\p{N}])/giu)]
    .map(match => Number((match[1] ?? '').replace(',', '.')))
    .filter(Number.isFinite)
}

function gradeDescriptors(value: string): string[] {
  const withoutFormats = value.replace(
    /\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*(?:mm|cm|m))?/giu,
    ' ',
  )
  const fusedPattern = /(?<![\p{L}\p{N}])(s\d{3,4}[a-z]?)(?=\d+(?:[.,]\d+)?\s*mm)/giu
  const fused = [...withoutFormats.matchAll(fusedPattern)].map(match => normalizeText(match[1]))
  const remaining = withoutFormats.replace(fusedPattern, ' ')
  const explicit = [...remaining.matchAll(/(?<![\p{L}\p{N}])(?:s\d{3,4}[a-z]?|\d{3,4}[a-z]?|304l?|316l?)(?![\p{L}\p{N}])/giu)]
    .map(match => normalizeText(match[0]))
  return [...new Set([...fused, ...explicit])]
}

function matchesThickness(value: string, thickness: number): boolean {
  return thicknessValues(value).some(candidate => candidate === thickness)
}

function hasExplicitDifferentThickness(value: string, thickness: number): boolean {
  return thicknessValues(value).some(candidate => candidate !== thickness)
}

function hasDifferentGrade(value: string, grade: string): boolean {
  const candidate = normalizeText(grade)
  return gradeDescriptors(value).some(token => token !== candidate)
}

function hasMatchingGrade(value: string, grade: string): boolean {
  return includesPhrase(value, grade) || gradeDescriptors(value).includes(normalizeText(grade))
}

function gridCompatibility(grid: ManualPriceGridContext, value: string): 'match' | 'possible' | 'no-match' {
  if (!hasMetalCode(value, grid.metalCode)) return 'no-match'
  let missingMetadata = false

  if (grid.catalogItemName && !includesPhrase(value, grid.catalogItemName)) return 'no-match'
  if (grid.supplierName && !includesPhrase(value, grid.supplierName)) return 'no-match'
  if (grid.supplierId && !grid.supplierName) missingMetadata = true
  if (grid.grade) {
    if (hasMatchingGrade(value, grid.grade)) {
      // exact grade is present
    } else if (hasDifferentGrade(value, grid.grade)) return 'no-match'
    else missingMetadata = true
  }
  if (grid.thicknessMm != null) {
    if (!matchesThickness(value, grid.thicknessMm)) {
      if (hasExplicitDifferentThickness(value, grid.thicknessMm)) return 'no-match'
      missingMetadata = true
    }
  }
  if (grid.formatLabel && !includesPhrase(value, grid.formatLabel)) {
    const dimensions = normalizeText(grid.formatLabel)
    if (dimensions && !normalizeText(value).includes(dimensions)) missingMetadata = true
  }
  return missingMetadata ? 'possible' : 'match'
}


const MATERIAL_WORK_VERBS = /(?:^| )(?:pose|installation|installer|fabrication|fabriquer|montage|remplacement|reparation|depose|mise en oeuvre|main d oeuvre|mo|intervention|refection)(?: |$)/

function isLaborOnlyMetalReference(item: PriceKnowledgeItem): boolean {
  const text = normalizeText(itemText(item))
  const timeUnit = ['h', 'heure', 'heures', 'j', 'jour', 'jours', 'journee', 'journees'].includes(normalizeText(item.unit))
  const includesSupply = /(?:^| )(?:fourniture|achat|approvisionnement|matiere|materiaux)(?: |$)/.test(text)
  return timeUnit && MATERIAL_WORK_VERBS.test(text) && !includesSupply
}

function isStandaloneMetalMaterialLine(item: PriceKnowledgeItem): boolean {
  const label = normalizeText(item.designation || item.description)
  return !isLaborOnlyMetalReference(item) && !MATERIAL_WORK_VERBS.test(label)
}

function hasMetalMaterialForm(value: string): boolean {
  const normalized = normalizeText(value)
  return /(?:^| )(?:tole|tube|profil(?:e)?|barre|plaque|corniere|fer plat)(?=$| |\d)/.test(normalized)
}

function requiresMetalMaterialPrice(item: PriceKnowledgeItem): boolean {
  if (isLaborOnlyMetalReference(item)) return false
  const text = itemText(item)
  return detectedMetalCodes(text).length > 0 || hasMetalMaterialForm(text)
}

function clarificationFor(item: PriceKnowledgeItem, reason?: string): string {
  const title = (item.designation || item.description || 'ce matériau').trim()
  const specificReason = reason ? ` ${reason}` : ''
  return `Prix matière à préciser pour « ${title} ».${specificReason} Indiquez le fournisseur, la nuance, l’épaisseur, le format, l’unité et/ou le prix d’achat afin de ne pas utiliser un prix estimé.`
}

type ExplicitPriceEvidence = { amount: number; unit: string } | { unclear: true } | null
type ExplicitUnitPrice = { amount: number; unit: string; start: number; end: number }

function clauseBounds(text: string, start: number, end: number): { start: number; end: number } {
  let clauseStart = 0
  let clauseEnd = text.length
  for (const delimiter of text.matchAll(/[\n;!?]|(?<!\d)\.(?!\d)/g)) {
    const position = delimiter.index ?? 0
    const afterDelimiter = position + delimiter[0].length
    if (afterDelimiter <= start) clauseStart = afterDelimiter
    else if (position >= end) {
      clauseEnd = position
      break
    }
  }
  return { start: clauseStart, end: clauseEnd }
}

function priceContextBounds(
  text: string,
  price: ExplicitUnitPrice,
  prices: ExplicitUnitPrice[],
): { start: number; end: number } {
  const clause = clauseBounds(text, price.start, price.end)
  const siblings = prices.filter(candidate => candidate.start >= clause.start && candidate.end <= clause.end)
  const index = siblings.findIndex(candidate => candidate.start === price.start)
  let start = clause.start
  let end = clause.end
  const separators = /(?:,|\s+(?:et|puis|ensuite|and)\s+)/giu

  if (index > 0) {
    const previous = siblings[index - 1]
    const gap = text.slice(previous.end, price.start)
    const matches = [...gap.matchAll(separators)]
    const separator = matches[matches.length - 1]
    start = separator
      ? previous.end + (separator.index ?? 0) + separator[0].length
      : previous.end
  }
  if (index >= 0 && index < siblings.length - 1) {
    const next = siblings[index + 1]
    const gap = text.slice(price.end, next.start)
    const separator = [...gap.matchAll(separators)][0]
    end = separator
      ? price.end + (separator.index ?? 0)
      : next.start
  }
  return { start, end }
}

function priceContextRelation(
  item: PriceKnowledgeItem,
  context: string,
  priceTextStart: number,
  priceTextEnd: number,
  laborOnly: boolean,
): 'match' | 'possible' | 'none' {
  const itemTextValue = itemText(item)
  const itemTokens = normalizeText(itemTextValue)
    .split(' ')
    .filter(token => (token.length >= 3 || token === 'mo') && !GENERIC_CATALOG_WORDS.has(token))
  const withoutPrice = `${context.slice(0, priceTextStart)} ${context.slice(priceTextEnd)}`
  const contextTokens = new Set(normalizeText(withoutPrice).split(' '))
  if (!itemTokens.some(token => contextTokens.has(token))) return 'none'

  const itemCodes = detectedMetalCodes(itemTextValue).sort()
  const contextCodes = detectedMetalCodes(withoutPrice).sort()
  if (itemCodes.length > 0 && contextCodes.length > 0 && !itemCodes.some(code => contextCodes.includes(code))) return 'possible'
  if (laborOnly) return 'match'

  const itemGrades = gradeDescriptors(itemTextValue)
  const contextGrades = gradeDescriptors(withoutPrice)
  if (itemGrades.length > 0 && contextGrades.length > 0 &&
      (itemGrades.some(grade => !contextGrades.includes(grade)) || contextGrades.some(grade => !itemGrades.includes(grade)))) {
    return 'possible'
  }
  const itemThicknesses = thicknessValues(itemTextValue)
  const contextThicknesses = thicknessValues(withoutPrice)
  if (itemThicknesses.length > 0 && contextThicknesses.length > 0 &&
      (itemThicknesses.some(value => !contextThicknesses.includes(value)) || contextThicknesses.some(value => !itemThicknesses.includes(value)))) {
    return 'possible'
  }
  return 'match'
}

function explicitPriceEvidence(requestText: string, item: PriceKnowledgeItem): ExplicitPriceEvidence {
  if (!requestText.trim()) return null
  const units = '(kg|m²|m2|m³|m3|ml|m|pi[eè]ces?|unit[eé]s?|u|tonnes?|h|heures?|jours?|j)'
  const pattern = new RegExp(`(?:\\b(\\d[\\d\\s.,]*?)\\s*(?:€|eur(?:os?)?)\\s*(?:/|par)\\s*${units}(?![\\p{L}\\p{N}])|€\\s*(\\d[\\d\\s.,]*?)\\s*(?:/|par)\\s*${units}(?![\\p{L}\\p{N}]))`, 'giu')
  const prices: ExplicitUnitPrice[] = [...requestText.matchAll(pattern)].map(match => {
    const start = match.index ?? 0
    const rawAmount = (match[1] ?? match[3] ?? '').replace(/\s/g, '').replace(',', '.')
    return {
      amount: Number(rawAmount),
      unit: match[2] ?? match[4] ?? '',
      start,
      end: start + match[0].length,
    }
  })
  const laborOnly = isLaborOnlyMetalReference(item)
  const candidates: ExplicitUnitPrice[] = []
  let possibleMatch = false

  for (const price of prices) {
    const priceUnit = normalizeUnit(price.unit)
    if (laborOnly && priceUnit !== 'h' && priceUnit !== 'jour') continue
    const bounds = priceContextBounds(requestText, price, prices)
    const context = requestText.slice(bounds.start, bounds.end)
    const contextWithoutPrice = `${context.slice(0, price.start - bounds.start)} ${context.slice(price.end - bounds.start)}`
    const isHourlyLaborPrice = (priceUnit === 'h' || priceUnit === 'jour') &&
      MATERIAL_WORK_VERBS.test(normalizeText(contextWithoutPrice))
    if (isHourlyLaborPrice && !laborOnly) continue
    const relation = priceContextRelation(
      item,
      context,
      price.start - bounds.start,
      price.end - bounds.start,
      laborOnly,
    )
    if (relation === 'none') continue
    if (relation === 'possible') {
      possibleMatch = true
      continue
    }
    candidates.push(price)
  }

  const uniqueCandidates = new Map(candidates.map(price => [`${normalizeUnit(price.unit)}:${price.amount}`, price]))
  if (uniqueCandidates.size > 1) return { unclear: true }
  const candidate = [...uniqueCandidates.values()][0]
  if (candidate) {
    if (!Number.isFinite(candidate.amount) || candidate.amount <= 0) return { unclear: true }
    return normalizeUnit(candidate.unit) === normalizeUnit(item.unit)
      ? { amount: candidate.amount, unit: item.unit }
      : { unclear: true }
  }
  if (possibleMatch) return { unclear: true }

  const amountPattern = /(?:\b\d[\d\s.,]*\s*(?:€|eur(?:os?)?)|€\s*\d[\d\s.,]*)/giu
  for (const match of requestText.matchAll(amountPattern)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (prices.some(price => start >= price.start && end <= price.end)) continue
    const bounds = clauseBounds(requestText, start, end)
    const context = requestText.slice(bounds.start, bounds.end)
    const relation = priceContextRelation(
      item,
      context,
      start - bounds.start,
      end - bounds.start,
      laborOnly,
    )
    if (relation !== 'none') return { unclear: true }
  }
  return null
}

function catalogMatch(item: PriceKnowledgeItem, references: CatalogPriceReference[]):
  | { kind: 'match'; price: number; unit: string; label: string }
  | { kind: 'ambiguous' }
  | null {
  const text = itemText(item)
  const matches: Array<{ price: number; unit: string; label: string }> = []
  let ambiguous = false

  for (const reference of references) {
    const variantLabels = (reference.variants ?? []).map(variant => variant.label)
    const nameMatches = normalizeText(item.designation) === normalizeText(reference.name) ||
      variantLabels.some(label => normalizeText(item.designation) === normalizeText(`${reference.name} ${label}`))
    if (!nameMatches) continue

    const variants = reference.variants ?? []
    if (variants.length > 0) {
      const variantMatch = matchExactCatalogVariant(variants, [text])
      if (variantMatch?.kind === 'ambiguous') {
        ambiguous = true
      } else if (variantMatch?.kind === 'match') {
        const variant = variantMatch.variant
        if (Number.isFinite(variant.unitPrice) && variant.unitPrice > 0 && variant.unit) {
          matches.push({ price: variant.unitPrice, unit: variant.unit, label: `${reference.name} ${variant.label}` })
        }
      }
      continue
    }

    if (reference.salePrice != null && Number.isFinite(reference.salePrice) && reference.salePrice > 0 && reference.unit) {
      matches.push({ price: reference.salePrice, unit: reference.unit, label: reference.name })
    }
  }

  if (ambiguous || matches.length > 1) return { kind: 'ambiguous' }
  return matches.length === 1 ? { kind: 'match', ...matches[0] } : null
}

function recentMatch(item: PriceKnowledgeItem, references: RecentPriceReference[]):
  | { kind: 'match'; price: number; unit: string; label: string }
  | { kind: 'ambiguous' }
  | null {
  const matches = references.filter(reference =>
    normalizeText(item.designation) === normalizeText(reference.description) ||
    normalizeText(item.description) === normalizeText(reference.description),
  )
  const unique = new Map<string, RecentPriceReference>()
  for (const match of matches) unique.set(`${match.unit}:${match.unitPrice}`, match)
  if (unique.size > 1) return { kind: 'ambiguous' }
  const match = [...unique.values()][0]
  return match && match.unit && Number.isFinite(match.unitPrice) && match.unitPrice > 0
    ? { kind: 'match', price: match.unitPrice, unit: match.unit, label: match.description }
    : null
}

export function roundPriceToCents(price: number): number {
  return Math.round((price + Number.EPSILON) * 100) / 100
}

export function roundDocumentQuantity(quantity: number): number {
  return Math.round((quantity + Number.EPSILON) * 1000) / 1000
}

function priceRoundingWarning(original: number, rounded: number): string {
  return original === rounded ? '' : `Montant source arrondi au centime : ${original} € → ${rounded} €.`
}

function zeroRoundedPriceClarification(item: PriceKnowledgeItem, price: number, unit: string): string {
  const title = (item.designation || item.description || 'ce matériau').trim()
  return `Le prix unitaire de « ${title} » (${price} € / ${unit}) s’arrondit à 0,00 € ; indiquez un prix non nul compatible avec cette unité.`
}

function applyKnownPrice(item: PriceKnowledgeItem, price: number, unit: string, source: 'catalog' | 'recent_quote' | 'client_input', warning: string): PriceKnowledgeItem | null {
  if (item.unit.trim() !== unit.trim()) return null
  return {
    ...item,
    unit,
    unit_price: price,
    ai_source: source,
    is_estimated: false,
    ai_warnings: [...(item.ai_warnings ?? []), warning].filter(Boolean).slice(-5),
  }
}

export function applyManualPriceKnowledge<T extends PriceKnowledgeQuote>(
  quotes: T[],
  sources: PriceKnowledgeSources,
  requestText = '',
  documentProvided = false,
): PriceKnowledgeResult<T> {
  let clarification: string | null = null
  const updatedQuotes = quotes.map(quote => ({
    ...quote,
    sections: quote.sections.map(section => ({
      ...section,
      items: section.items.map(item => {
        if (item.quantity !== undefined) {
          const quantity = roundDocumentQuantity(item.quantity)
          if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 9_999_999.999) {
            clarification ??= `La quantité de « ${item.designation || item.description} » ne peut pas être enregistrée avec cette unité. Choisissez une quantité positive à trois décimales maximum ou une autre unité.`
            return item
          }
          if (quantity !== item.quantity) {
            item = { ...item, quantity, ai_warnings: [...(item.ai_warnings ?? []), `Quantité du document arrondie à trois décimales : ${item.quantity} → ${quantity}.`].slice(-5) }
          }
        }
        const text = itemText(item)
        const detectedCodes = detectedMetalCodes(text)
        const explicit = explicitPriceEvidence(requestText, item)

        if (explicit && !('unclear' in explicit)) {
          const roundedPrice = roundPriceToCents(explicit.amount)
          if (roundedPrice <= 0) {
            clarification ??= zeroRoundedPriceClarification(item, explicit.amount, explicit.unit)
            return item
          }
          const roundingWarning = priceRoundingWarning(explicit.amount, roundedPrice)
          return {
            ...item,
            unit: explicit.unit,
            unit_price: roundedPrice,
            ai_source: 'client_input' as const,
            is_estimated: false,
            ai_warnings: [...(item.ai_warnings ?? []), 'Prix unitaire explicitement indiqué dans la demande ; montant et unité conservés.', roundingWarning].filter(Boolean).slice(-5),
          }
        }

        if (explicit?.unclear) {
          clarification ??= clarificationFor(item, 'Le montant indiqué ne précise pas une unité tarifaire compatible.')
          return item
        }

        if (documentProvided && item.ai_source === 'document' && item.is_estimated === false && Number.isFinite(item.unit_price) && item.unit_price > 0) {
          const sourcePrice = Number(item.unit_price)
          const roundedPrice = roundPriceToCents(sourcePrice)
          if (roundedPrice <= 0) {
            clarification ??= zeroRoundedPriceClarification(item, sourcePrice, item.unit)
            return item
          }
          const documentWarning = 'Prix attribué au document par l’IA, sans vérification indépendante du montant, de l’unité ou du fournisseur ; confirmez-le avant validation.'
          const roundingWarning = priceRoundingWarning(sourcePrice, roundedPrice)
          return {
            ...item,
            unit_price: roundedPrice,
            ai_warnings: [...(item.ai_warnings ?? []).filter(warning => !warning.includes('sans vérification indépendante')), `${documentWarning}${roundingWarning ? ` ${roundingWarning}` : ''}`].slice(-5),
          }
        }

        const fromCatalog = catalogMatch(item, sources.catalogPrices)
        if (fromCatalog?.kind === 'ambiguous') {
          clarification ??= clarificationFor(item, 'Aucune variante catalogue exacte n’est identifiée ou plusieurs variantes restent possibles ; précisez la variante.')
          return item
        }
        if (fromCatalog?.kind === 'match') {
          const roundedPrice = roundPriceToCents(fromCatalog.price)
          if (roundedPrice <= 0) {
            clarification ??= zeroRoundedPriceClarification(item, fromCatalog.price, fromCatalog.unit)
            return item
          }
          const baseWarning = `Prix repris du catalogue de l’entreprise : ${fromCatalog.label}, ${fromCatalog.price} € / ${fromCatalog.unit}.`
          const warning = `${baseWarning} ${priceRoundingWarning(fromCatalog.price, roundedPrice)}`.trim()
          const priced = applyKnownPrice(item, roundedPrice, fromCatalog.unit, 'catalog', warning)
          if (!priced) clarification ??= clarificationFor(item, `Le catalogue indique l’unité « ${fromCatalog.unit} », différente de l’unité demandée « ${item.unit} ».`)
          return priced ?? item
        }

        const candidates = sources.hasMetalPricing && isStandaloneMetalMaterialLine(item)
          ? sources.manualGrids.filter(grid => detectedCodes.includes(grid.metalCode))
          : []
        const compatible = candidates.map(grid => ({ grid, match: gridCompatibility(grid, text) }))
        const exact = compatible.filter(candidate => candidate.match === 'match')
        const possible = compatible.filter(candidate => candidate.match === 'possible')
        if (exact.length > 1 || (exact.length === 1 && possible.length > 0) || (exact.length === 0 && possible.length > 0)) {
          clarification ??= clarificationFor(item, 'Les grilles manuelles possibles ne permettent pas d’identifier sans ambiguïté le fournisseur ou les caractéristiques matière.')
          return item
        }
        if (exact.length === 1) {
          const grid = exact[0].grid
          const roundedPrice = roundPriceToCents(grid.manualPricePerUnit)
          if (roundedPrice <= 0) {
            clarification ??= zeroRoundedPriceClarification(item, grid.manualPricePerUnit, grid.unit)
            return item
          }
          const baseWarning = `Prix manuel de l’entreprise repris de la grille « ${grid.label} » : ${grid.manualPricePerUnit} € / ${grid.unit}.`
          const warning = `${baseWarning} ${priceRoundingWarning(grid.manualPricePerUnit, roundedPrice)}`.trim()
          const priced = applyKnownPrice(item, roundedPrice, grid.unit, 'client_input', warning)
          if (!priced) clarification ??= clarificationFor(item, `La grille « ${grid.label} » est tarifée en « ${grid.unit} », différente de l’unité demandée « ${item.unit} » ; aucune conversion n’a été appliquée.`)
          return priced ?? item
        }

        const fromRecent = recentMatch(item, sources.recentPrices)
        if (fromRecent?.kind === 'ambiguous') {
          clarification ??= clarificationFor(item, 'Plusieurs prix d’entreprise existent pour cette désignation.')
          return item
        }
        if (fromRecent?.kind === 'match') {
          const roundedPrice = roundPriceToCents(fromRecent.price)
          if (roundedPrice <= 0) {
            clarification ??= zeroRoundedPriceClarification(item, fromRecent.price, fromRecent.unit)
            return item
          }
          const baseWarning = `Prix repris d’un devis récent de l’entreprise : ${fromRecent.label}, ${fromRecent.price} € / ${fromRecent.unit}.`
          const warning = `${baseWarning} ${priceRoundingWarning(fromRecent.price, roundedPrice)}`.trim()
          const priced = applyKnownPrice(item, roundedPrice, fromRecent.unit, 'recent_quote', warning)
          if (!priced) clarification ??= clarificationFor(item, `Le devis récent indique l’unité « ${fromRecent.unit} », différente de l’unité demandée « ${item.unit} ».`)
          return priced ?? item
        }

        if (requiresMetalMaterialPrice(item)) {
          const missing = !isStandaloneMetalMaterialLine(item)
            ? 'Cette ligne combine matière métallique et travaux ; séparez le matériau de la pose ou indiquez un prix unitaire complet.'
            : detectedCodes.length === 0
              ? 'La matière métallique ou sa nuance n’est pas identifiée avec certitude.'
              : candidates.length > 0
                ? 'Aucune grille ne correspond exactement à la matière ou à ses caractéristiques.'
                : 'Aucun prix catalogue, manuel ou de devis récent ne correspond exactement.'
          clarification ??= clarificationFor(item, missing)
        }
        return item
      }),
    })),
  })) as T[]

  const centRoundedQuotes = updatedQuotes.map(quote => ({
    ...quote,
    sections: quote.sections.map(section => ({
      ...section,
      items: section.items.map(item => {
        const sourcePrice = item.unit_price
        if (!Number.isFinite(sourcePrice)) return item
        const roundedPrice = roundPriceToCents(sourcePrice)
        if (roundedPrice === sourcePrice) return item
        if (sourcePrice > 0 && roundedPrice <= 0) {
          clarification ??= zeroRoundedPriceClarification(item, sourcePrice, item.unit)
          return item
        }
        const warning = priceRoundingWarning(sourcePrice, roundedPrice)
        return {
          ...item,
          unit_price: roundedPrice,
          ai_warnings: [...(item.ai_warnings ?? []), warning].filter(Boolean).slice(-5),
        }
      }),
    })),
  })) as T[]
  return { quotes: centRoundedQuotes, clarification }
}
