import { NextRequest, NextResponse } from 'next/server'
import { isOperatorModeEnabled, createOperatorAdminClient } from '@/lib/supabase/operator'
import { verifyOperatorSignature, type OperatorUsageEventPayload } from '@/lib/operator'

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
      metadata: payload.metadata ?? null,
    }, {
      onConflict: 'source_instance,local_usage_log_id',
      ignoreDuplicates: true,
    })

  if (usageError) {
    console.error('[operator/ingest.usage]', usageError)
    return NextResponse.json({ error: 'Unable to insert usage event' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
