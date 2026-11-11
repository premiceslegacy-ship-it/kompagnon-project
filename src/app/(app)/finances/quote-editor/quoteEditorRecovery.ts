import type { LocalItem, LocalSection } from './quoteEditorModel'

export type QuoteEditorRecoveryScope = {
  userId: string | null
  organizationId: string | null
  quoteId: string | null
}

export type QuoteEditorRecoveryHeader = {
  title: string
  clientId: string
  validityDays: number
  notesClient: string
  clientRequestVisibleOnPdf: boolean
  aidLabel: string
  aidAmount: number | null
  showAid: boolean
  aidMode: '€' | '%'
  parentQuoteId: string | null
  showSectionSubtotals: boolean
  variantLabel: string
}

export type QuoteEditorRecoveryDraft = {
  header: QuoteEditorRecoveryHeader
  sections: LocalSection[]
  deletedSectionIds: string[]
  deletedItemIds: string[]
}

export type QuoteEditorRecoveryDraftInput = QuoteEditorRecoveryDraft

function isRecoveryHeader(value: unknown): value is QuoteEditorRecoveryHeader {
  if (!value || typeof value !== 'object') return false
  const header = value as Record<string, unknown>
  return typeof header.title === 'string'
    && typeof header.clientId === 'string'
    && typeof header.validityDays === 'number' && Number.isFinite(header.validityDays)
    && typeof header.notesClient === 'string'
    && typeof header.clientRequestVisibleOnPdf === 'boolean'
    && typeof header.aidLabel === 'string'
    && isNullableFiniteNumber(header.aidAmount)
    && typeof header.showAid === 'boolean'
    && (header.aidMode === '€' || header.aidMode === '%')
    && (typeof header.parentQuoteId === 'string' || header.parentQuoteId === null)
    && typeof header.showSectionSubtotals === 'boolean'
    && typeof header.variantLabel === 'string'
}

const STORAGE_PREFIX = 'atelier:quote-editor-recovery:v1:'
const MAX_RECOVERY_BYTES = 1_000_000

type RecoveryStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export function quoteEditorRecoveryKey(scope: QuoteEditorRecoveryScope): string | null {
  if (!scope.userId || !scope.organizationId) return null
  return `${STORAGE_PREFIX}${scope.organizationId}:${scope.userId}:${scope.quoteId ?? 'new'}`
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isLocalItem(value: unknown): value is LocalItem {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return typeof item._tempId === 'string'
    && (typeof item.id === 'string' || item.id === null)
    && typeof item.description === 'string'
    && Number.isFinite(item.quantity)
    && typeof item.unit === 'string'
    && Number.isFinite(item.unit_price)
    && isNullableFiniteNumber(item.unit_cost_ht)
    && Number.isFinite(item.vat_rate)
    && ['material', 'labor', 'custom'].includes(String(item.type))
    && (typeof item.material_id === 'string' || item.material_id === null)
    && (typeof item.labor_rate_id === 'string' || item.labor_rate_id === null)
    && Number.isFinite(item.position)
    && isNullableFiniteNumber(item.length_m)
    && isNullableFiniteNumber(item.width_m)
    && isNullableFiniteNumber(item.height_m)
    && ['none', 'linear', 'area', 'volume', null].includes(item.dimension_pricing_mode as string | null)
    && Number.isFinite(item.dim_quantity)
    && typeof item.is_estimated === 'boolean'
    && typeof item.is_internal === 'boolean'
    && isNullableFiniteNumber(item.transport_km)
    && isNullableFiniteNumber(item.transport_conso)
    && isNullableFiniteNumber(item.transport_prix_l)
    && (typeof item.metal_grid_id === 'string' || item.metal_grid_id === null)
    && typeof item.price_pending === 'boolean'
    && ['atelier', 'pose', 'finition', 'autre', null].includes(item.labor_category as string | null)
}

function isLocalSections(value: unknown): value is LocalSection[] {
  return Array.isArray(value) && value.every(section => {
    if (!section || typeof section !== 'object') return false
    const candidate = section as Record<string, unknown>
    return typeof candidate._tempId === 'string'
      && (typeof candidate.id === 'string' || candidate.id === null)
      && typeof candidate.title === 'string'
      && Number.isFinite(candidate.position)
      && Array.isArray(candidate.items)
      && candidate.items.every(isLocalItem)
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function readQuoteEditorRecoveryDraft(
  storage: RecoveryStorage | null,
  scope: QuoteEditorRecoveryScope,
): QuoteEditorRecoveryDraft | null {
  const key = quoteEditorRecoveryKey(scope)
  if (!storage || !key) return null

  try {
    const raw = storage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!isRecoveryHeader(parsed.header) || !isLocalSections(parsed.sections)
      || !isStringArray(parsed.deletedSectionIds) || !isStringArray(parsed.deletedItemIds)) {
      storage.removeItem(key)
      return null
    }
    return {
      header: parsed.header,
      sections: parsed.sections,
      deletedSectionIds: parsed.deletedSectionIds,
      deletedItemIds: parsed.deletedItemIds,
    }
  } catch {
    try { storage.removeItem(key) } catch { /* Storage may be unavailable. */ }
    return null
  }
}

export function writeQuoteEditorRecoveryDraft(
  storage: RecoveryStorage | null,
  scope: QuoteEditorRecoveryScope,
  draft: QuoteEditorRecoveryDraftInput,
): boolean {
  const key = quoteEditorRecoveryKey(scope)
  if (!storage || !key) return false

  try {
    const serialized = JSON.stringify(draft)
    if (serialized.length > MAX_RECOVERY_BYTES) return false
    storage.setItem(key, serialized)
    return true
  } catch {
    return false
  }
}

export function clearQuoteEditorRecoveryDraft(storage: RecoveryStorage | null, scope: QuoteEditorRecoveryScope): void {
  const key = quoteEditorRecoveryKey(scope)
  if (!storage || !key) return
  try { storage.removeItem(key) } catch { /* Storage may be unavailable. */ }
}
