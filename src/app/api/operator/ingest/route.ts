import { NextRequest, NextResponse } from 'next/server'
import { isOperatorModeEnabled, createOperatorAdminClient } from '@/lib/supabase/operator'
import { getOperatorUsdToEurRate, hasOperatorMasterSecret, readOperatorRequest, type OperatorUsageEventPayload } from '@/lib/operator'
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
  // UTC : le mois de quota local est borné en UTC par les Workers, un setDate
  // en heure locale décalerait l'événement du 1er d'un mois selon le fuseau.
  const date = new Date(value)
  date.setUTCDate(1)
  date.setUTCHours(0, 0, 0, 0)
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

  if (!hasOperatorMasterSecret()) {
    return NextResponse.json({ error: 'Operator ingest secret missing' }, { status: 500 })
  }

  const rawBody = await req.text()
  const check = readOperatorRequest<OperatorUsageEventPayload>(rawBody, req.headers, { requireMaster: true })
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status })
  }
  const payload = check.body

  if (!isValidPayload(payload)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  // Une quantité négative décrémenterait le compteur ; une date illisible
  // ferait échouer l'insertion en base à chaque retry de l'instance.
  if (Number.isNaN(new Date(payload.occurred_at).getTime())) {
    return NextResponse.json({ error: 'Invalid occurred_at' }, { status: 400 })
  }
  if (payload.quota_quantity != null && (!Number.isFinite(payload.quota_quantity) || payload.quota_quantity < 0)) {
    return NextResponse.json({ error: 'Invalid quota_quantity' }, { status: 400 })
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
    // Certaines bases cockpit historiques ont conservé par erreur l'ancienne
    // contrainte UNIQUE(source_instance), incompatible avec une instance SaaS
    // mutualisée. Les tables settings/subscriptions/usage sont déjà, elles,
    // correctement indexées par organisation : ne pas perdre la consommation
    // d'une nouvelle organisation pour cette ligne de compatibilité legacy.
    const legacySourceConstraint = clientError.code === '23505'
      && String(clientError.message).includes('operator_clients_source_instance_key')
    if (legacySourceConstraint) {
      console.warn('[operator/ingest.client] legacy source_instance constraint ignored')
    } else {
      console.error('[operator/ingest.client]', clientError)
      return NextResponse.json({ error: 'Unable to upsert operator client' }, { status: 500 })
    }
  }

  // Auto-crée la ligne cockpit au premier event - le label peut être corrigé manuellement ensuite
  const { error: settingsUpsertError } = await operator
    .from('operator_client_settings')
    .upsert({
      source_instance: payload.source_instance,
      organization_id: payload.organization_id,
      label: payload.source_instance,
    }, { onConflict: 'source_instance,organization_id', ignoreDuplicates: true })

  if (settingsUpsertError) {
    console.error('[operator/ingest.settings]', settingsUpsertError)
  }

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
      p_organization_id: payload.organization_id,
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
