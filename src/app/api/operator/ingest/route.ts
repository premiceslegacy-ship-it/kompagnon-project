import { NextRequest, NextResponse } from 'next/server'
import { isOperatorModeEnabled, createOperatorAdminClient } from '@/lib/supabase/operator'
import { getOperatorUsdToEurRate, verifyOperatorSignature, type OperatorUsageEventPayload } from '@/lib/operator'
import { getQuotaFeatureForTechnicalFeature, getQuotaUnit, isQuotaFeature } from '@/lib/quota-catalog'

function isValidPayload(payload: unknown): payload is OperatorUsageEventPayload {
  if (!payload || typeof payload !== 'object') return false
  const value = payload as Record<string, unknown>

  return (
    typeof value.source_instance === 'string' &&
    typeof value.organization_id === 'string' &&
    typeof value.occurred_at === 'string' &&
    typeof value.provider === 'string' &&
    typeof value.feature === 'string' &&
    typeof value.model === 'string' &&
    typeof value.currency === 'string' &&
    typeof value.status === 'string' &&
    typeof value.local_usage_log_id === 'string'
  )
}

function convertProviderCostToEur(value: number | null | undefined, currency: string): number {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return 0
  if (currency.toUpperCase() === 'EUR') return amount
  if (currency.toUpperCase() === 'USD') return amount * getOperatorUsdToEurRate()
  return amount
}

function getPeriodStart(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString().substring(0, 7) + '-01'
  }
  date.setDate(1)
  date.setHours(0, 0, 0, 0)
  return date.toISOString().substring(0, 10)
}

function resolveQuota(payload: OperatorUsageEventPayload) {
  const payloadQuotaFeature = payload.quota_feature && isQuotaFeature(payload.quota_feature)
    ? payload.quota_feature
    : null
  const quotaFeature = payloadQuotaFeature ?? getQuotaFeatureForTechnicalFeature(payload.feature)
  const quotaUnit = payload.quota_unit ?? (quotaFeature ? getQuotaUnit(quotaFeature) : null)
  const quantity = payload.quota_quantity ?? 1

  return { quotaFeature, quotaUnit, quantity }
}

export async function POST(req: NextRequest) {
  if (!isOperatorModeEnabled()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const secret = process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) {
    return NextResponse.json({ error: 'Operator ingest secret missing' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-operator-signature')
  if (!verifyOperatorSignature(rawBody, secret, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: OperatorUsageEventPayload
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isValidPayload(payload)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const operator = createOperatorAdminClient()
  const quota = resolveQuota(payload)

  const { error: clientError } = await operator
    .from('operator_clients')
    .upsert({
      source_instance: payload.source_instance,
      organization_id: payload.organization_id,
      label: payload.source_instance,
      metadata: payload.metadata ?? null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance,organization_id' })

  if (clientError) {
    console.error('[operator/ingest.client]', clientError)
    return NextResponse.json({ error: 'Unable to upsert operator client' }, { status: 500 })
  }

  // Auto-crée la ligne cockpit au premier event - le label peut être corrigé manuellement ensuite
  await operator
    .from('operator_client_settings')
    .upsert({
      source_instance: payload.source_instance,
      label: payload.source_instance,
    }, { onConflict: 'source_instance', ignoreDuplicates: true })

  const { error: usageError } = await operator
    .from('operator_usage_events')
    .upsert({
      source_instance: payload.source_instance,
      organization_id: payload.organization_id,
      occurred_at: payload.occurred_at,
      provider: payload.provider,
      feature: payload.feature,
      model: payload.model,
      provider_cost: payload.provider_cost,
      currency: payload.currency,
      total_tokens: payload.total_tokens,
      status: payload.status,
      local_usage_log_id: payload.local_usage_log_id,
      quota_feature: quota.quotaFeature,
      quota_unit: quota.quotaUnit,
      quota_quantity: quota.quantity,
      overflow_mode: payload.overflow_mode ?? null,
      over_quota: payload.over_quota ?? false,
      metadata: payload.metadata ?? null,
    }, {
      onConflict: 'source_instance,local_usage_log_id',
      ignoreDuplicates: true,
    })
    .select('id')

  if (usageError) {
    console.error('[operator/ingest.usage]', usageError)
    return NextResponse.json({ error: 'Unable to insert usage event' }, { status: 500 })
  }

  if (payload.status === 'success' && quota.quotaFeature && quota.quotaUnit) {
    const { error: quotaError } = await operator.rpc('increment_quota_counter', {
      p_source_instance: payload.source_instance,
      p_local_usage_log_id: payload.local_usage_log_id,
      p_quota_feature: quota.quotaFeature,
      p_quota_unit: quota.quotaUnit,
      p_quantity: quota.quantity,
      p_cost_eur: convertProviderCostToEur(payload.provider_cost, payload.currency),
      p_period_start: getPeriodStart(payload.occurred_at),
      p_occurred_at: payload.occurred_at,
    })

    if (quotaError) {
      console.error('[operator/ingest.quota]', quotaError)
      return NextResponse.json({ error: 'Unable to increment quota counter' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
