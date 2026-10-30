import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getQuotaFeatureForTechnicalFeature,
  getQuotaUnit,
  isOverflowMode,
  type OverflowMode,
  type QuotaFeature,
  type QuotaUnit,
} from '@/lib/quota-catalog'

const QUOTA_USAGE_ROW_LIMIT = 10000

export type QuotaCheckResult = {
  allowed: boolean
  aiBillingMode: AIBillingMode
  quotaFeature: QuotaFeature | null
  quotaUnit: QuotaUnit | null
  quotaMonthly: number | null
  usedQuantity: number
  requestedQuantity: number
  remaining: number | null
  overflowMode: OverflowMode
  overQuota: boolean
  /** Ligne `usage_logs` réservée à clore (success/error) après l'appel. */
  reservationId?: string | null
}

export type AIBillingMode = 'orsayn_shared' | 'client_owned'

export class AIQuotaExceededError extends Error {
  readonly quotaFeature: QuotaFeature
  readonly quotaMonthly: number
  readonly usedQuantity: number
  readonly requestedQuantity: number

  constructor(params: {
    quotaFeature: QuotaFeature
    quotaMonthly: number
    usedQuantity: number
    requestedQuantity: number
  }) {
    super('Quota IA atteint pour cette organisation.')
    this.name = 'AIQuotaExceededError'
    this.quotaFeature = params.quotaFeature
    this.quotaMonthly = params.quotaMonthly
    this.usedQuantity = params.usedQuantity
    this.requestedQuantity = params.requestedQuantity
  }
}

export function evaluateQuotaAllowance(params: {
  quotaFeature: QuotaFeature
  quotaUnit: QuotaUnit
  quotaMonthly: number
  usedQuantity: number
  requestedQuantity?: number
  overflowMode?: string | null
  aiBillingMode?: AIBillingMode
}): QuotaCheckResult {
  const requestedQuantity = Math.max(0, params.requestedQuantity ?? 1)
  const overflowMode = params.overflowMode && isOverflowMode(params.overflowMode)
    ? params.overflowMode
    : 'block'
  const aiBillingMode = params.aiBillingMode ?? 'orsayn_shared'

  if (params.quotaMonthly < 0) {
    return {
      allowed: true,
      aiBillingMode,
      quotaFeature: params.quotaFeature,
      quotaUnit: params.quotaUnit,
      quotaMonthly: params.quotaMonthly,
      usedQuantity: params.usedQuantity,
      requestedQuantity,
      remaining: null,
      overflowMode,
      overQuota: false,
    }
  }

  const nextQuantity = params.usedQuantity + requestedQuantity
  const overQuota = nextQuantity > params.quotaMonthly
  const remaining = Math.max(params.quotaMonthly - nextQuantity, 0)

  return {
    allowed: !overQuota || overflowMode !== 'block',
    aiBillingMode,
    quotaFeature: params.quotaFeature,
    quotaUnit: params.quotaUnit,
    quotaMonthly: params.quotaMonthly,
    usedQuantity: params.usedQuantity,
    requestedQuantity,
    remaining,
    overflowMode,
    overQuota,
  }
}

function monthStartIso(now = new Date()): string {
  const monthStart = new Date(now)
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  return monthStart.toISOString()
}

function parseQuotaConfig(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {}

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, raw]) => {
        const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
        return [key, Number.isFinite(parsed) ? parsed : -1]
      }),
  )
}

function normalizeAIBillingMode(value: unknown): AIBillingMode {
  return value === 'client_owned' ? 'client_owned' : 'orsayn_shared'
}

export async function checkQuota(params: {
  supabase: SupabaseClient
  organizationId: string
  technicalFeature: string
  quantity?: number
  now?: Date
  /** Réserve atomiquement la quantité (appel IA facturant). */
  reserve?: boolean
  provider?: string
  model?: string
  inputKind?: string
}): Promise<QuotaCheckResult> {
  const quotaFeature = getQuotaFeatureForTechnicalFeature(params.technicalFeature)
  if (!quotaFeature) {
    return {
      allowed: true,
      aiBillingMode: 'orsayn_shared',
      quotaFeature: null,
      quotaUnit: null,
      quotaMonthly: null,
      usedQuantity: 0,
      requestedQuantity: params.quantity ?? 1,
      remaining: null,
      overflowMode: 'block',
      overQuota: false,
    }
  }

  const quotaUnit = getQuotaUnit(quotaFeature)
  const { data: modules, error: modulesError } = await params.supabase
    .from('organization_modules')
    .select('quota_config, overflow_mode, ai_billing_mode')
    .eq('organization_id', params.organizationId)
    .maybeSingle()

  const aiBillingMode = normalizeAIBillingMode((modules as { ai_billing_mode?: unknown } | null)?.ai_billing_mode)

  if (modulesError) {
    console.error('[checkQuota.organization_modules]', modulesError)
    // Poste de coût : une erreur de lecture ne doit pas lever la limite.
    return {
      allowed: false,
      aiBillingMode,
      quotaFeature,
      quotaUnit,
      quotaMonthly: null,
      usedQuantity: 0,
      requestedQuantity: params.quantity ?? 1,
      remaining: null,
      overflowMode: 'block',
      overQuota: false,
    }
  }

  const quotaConfig = parseQuotaConfig(modules?.quota_config)
  if (aiBillingMode === 'client_owned') {
    return {
      allowed: true,
      aiBillingMode,
      quotaFeature,
      quotaUnit,
      quotaMonthly: -1,
      usedQuantity: 0,
      requestedQuantity: params.quantity ?? 1,
      remaining: null,
      overflowMode: 'charge',
      overQuota: false,
    }
  }

  // Une feature absente de `quota_config` valait -1 (illimité) : un quota
  // oublié dans la config cockpit ouvrait un usage non borné. En mode `block`
  // on la traite comme 0 ; les modes facturants gardent l'illimité.
  const quotaMonthly = quotaConfig[quotaFeature]
    ?? (String(modules?.overflow_mode ?? 'block') === 'block' ? 0 : -1)
  const overflowMode = isOverflowMode(String(modules?.overflow_mode ?? 'block'))
    ? String(modules?.overflow_mode ?? 'block') as OverflowMode
    : 'block'

  if (quotaMonthly < 0) {
    return {
      ...evaluateQuotaAllowance({
        quotaFeature,
        quotaUnit,
        quotaMonthly,
        usedQuantity: 0,
        requestedQuantity: params.quantity ?? 1,
        overflowMode,
        aiBillingMode,
      }),
    }
  }

  const { data: usageRows, error: usageError } = await params.supabase
    .from('usage_logs')
    .select('quota_quantity')
    .eq('organization_id', params.organizationId)
    .eq('quota_feature', quotaFeature)
    // Même périmètre que `reserve_quota` : un `error` ambigu et un appel en vol
    // (`reserved`) consomment réellement le quota.
    .in('status', ['success', 'reserved', 'error'])
    .gte('created_at', monthStartIso(params.now))
    .limit(QUOTA_USAGE_ROW_LIMIT)

  if (usageError) {
    console.error('[checkQuota.usage_logs]', usageError)
    return {
      allowed: false,
      aiBillingMode,
      quotaFeature,
      quotaUnit,
      quotaMonthly,
      usedQuantity: 0,
      requestedQuantity: params.quantity ?? 1,
      remaining: null,
      overflowMode,
      overQuota: false,
    }
  }

  // Somme tronquée = sous-comptage silencieux = quota levé : fail-closed. La
  // réservation recompte côté SQL sans limite de lignes, elle n'en dépend pas.
  if (!params.reserve && (usageRows?.length ?? 0) >= QUOTA_USAGE_ROW_LIMIT) {
    console.error('[checkQuota.usage_logs] truncated at', QUOTA_USAGE_ROW_LIMIT)
    return {
      allowed: false,
      aiBillingMode,
      quotaFeature,
      quotaUnit,
      quotaMonthly,
      usedQuantity: 0,
      requestedQuantity: params.quantity ?? 1,
      remaining: null,
      overflowMode,
      overQuota: false,
    }
  }

  const usedQuantity = (usageRows ?? []).reduce((sum, row) => {
    const quantity = Number((row as { quota_quantity?: number | string | null }).quota_quantity ?? 1)
    return sum + (Number.isFinite(quantity) ? quantity : 1)
  }, 0)

  // Réservation atomique : la lecture ci-dessus ne voit pas les appels déjà en
  // vol (la ligne n'est écrite qu'après la réponse du fournisseur). Le RPC
  // pose un verrou par (org, feature) et insère une ligne `reserved` qui
  // compte dans la somme, ce qui ferme la fenêtre de course.
  if (params.reserve) {
    const requested = Math.max(1, params.quantity ?? 1)
    const { data: reservation, error: reserveError } = await params.supabase.rpc('reserve_quota', {
      p_org: params.organizationId,
      p_feature: quotaFeature,
      p_quantity: requested,
      // Les modes facturants (`upgrade_prompt`, `charge`) laissent dépasser :
      // le RPC ne doit refuser que sous `block`, sinon il bloque ce que
      // `evaluateQuotaAllowance` autorise.
      p_limit: overflowMode === 'block' ? quotaMonthly : -1,
      p_month_start: monthStartIso(params.now),
      p_provider: params.provider ?? 'openrouter',
      p_model: params.model ?? 'unknown',
      p_input_kind: params.inputKind ?? 'text',
    })

    const row = Array.isArray(reservation) ? reservation[0] : reservation
    if (reserveError || !row) {
      console.error('[checkQuota.reserve_quota]', reserveError)
      return {
        allowed: false,
        aiBillingMode,
        quotaFeature,
        quotaUnit,
        quotaMonthly,
        usedQuantity,
        requestedQuantity: requested,
        remaining: null,
        overflowMode,
        overQuota: false,
      }
    }

    const usedAfter = Number(row.used ?? usedQuantity)
    const reservationId = typeof row.reservation_id === 'string' && row.reservation_id.length > 0
      ? row.reservation_id
      : null
    // An "allowed" RPC response without a durable row id would let callAI
    // proceed without the atomic reservation protecting concurrent requests.
    if (!Number.isFinite(usedAfter) || (row.allowed === true && !reservationId)) {
      console.error('[checkQuota.reserve_quota] invalid reservation response')
      return {
        allowed: false,
        aiBillingMode,
        quotaFeature,
        quotaUnit,
        quotaMonthly,
        usedQuantity,
        requestedQuantity: requested,
        remaining: null,
        overflowMode,
        overQuota: false,
      }
    }

    return {
      allowed: row.allowed === true,
      aiBillingMode,
      quotaFeature,
      quotaUnit,
      quotaMonthly,
      usedQuantity: usedAfter,
      requestedQuantity: requested,
      remaining: Math.max(quotaMonthly - usedAfter, 0),
      overflowMode,
      overQuota: usedAfter > quotaMonthly,
      reservationId,
    }
  }

  return {
    ...evaluateQuotaAllowance({
      quotaFeature,
      quotaUnit,
      quotaMonthly,
      usedQuantity,
      requestedQuantity: params.quantity ?? 1,
      overflowMode,
      aiBillingMode,
    }),
  }
}
