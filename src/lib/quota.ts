import type { SupabaseClient } from '@supabase/supabase-js'
import {
  getQuotaFeatureForTechnicalFeature,
  getQuotaUnit,
  isOverflowMode,
  type OverflowMode,
  type QuotaFeature,
  type QuotaUnit,
} from '@/lib/quota-catalog'

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
    return {
      allowed: true,
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

  const quotaMonthly = quotaConfig[quotaFeature] ?? -1
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
    .eq('status', 'success')
    .gte('created_at', monthStartIso(params.now))
    .limit(10000)

  if (usageError) {
    console.error('[checkQuota.usage_logs]', usageError)
    return {
      allowed: true,
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
