import { NextRequest, NextResponse } from 'next/server'
import { syncUsageLogToOperator } from '@/lib/ai/callAI'
import { verifyCronSecret } from '@/lib/cron-auth'
import { getOperatorSourceInstance } from '@/lib/operator'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const BATCH_SIZE = 100

type UsageLog = {
  id: string
  organization_id: string
  created_at: string
  provider: string
  feature: string
  model: string
  provider_cost: number | string | null
  currency: string
  total_tokens: number | null
  status: string
  quota_feature: string | null
  quota_unit: string | null
  quota_quantity: number | string | null
  overflow_mode: string | null
  over_quota: boolean | null
  metadata: Record<string, unknown> | null
}

async function runJob() {
  const admin = createAdminClient()
  const { data, error } = await admin
    .from('usage_logs')
    .select('id, organization_id, created_at, provider, feature, model, provider_cost, currency, total_tokens, status, quota_feature, quota_unit, quota_quantity, overflow_mode, over_quota, metadata')
    .in('operator_sync_status', ['pending', 'failed'])
    // Une ligne `reserved` est un appel en vol : l'ingest cockpit dédoublonne sur
    // local_usage_log_id (ignoreDuplicates), donc un envoi à ce stade figerait
    // l'événement en `reserved` et le succès final ne serait jamais compté.
    .neq('status', 'reserved')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) {
    console.error('[cron operator-usage-sync] select', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const logs = (data ?? []) as UsageLog[]
  const sourceInstance = getOperatorSourceInstance()

  // Petits groupes pour éviter une rafale de connexions sortantes, tout en
  // restant largement sous la durée maximale d'un Worker.
  for (let offset = 0; offset < logs.length; offset += 5) {
    await Promise.all(logs.slice(offset, offset + 5).map((log) => syncUsageLogToOperator(log.id, {
      source_instance: sourceInstance,
      organization_id: log.organization_id,
      occurred_at: log.created_at,
      provider: log.provider,
      feature: log.feature,
      model: log.model,
      provider_cost: log.provider_cost === null ? null : Number(log.provider_cost),
      currency: log.currency,
      total_tokens: log.total_tokens,
      status: log.status,
      quota_feature: log.quota_feature,
      quota_unit: log.quota_unit,
      quota_quantity: log.quota_quantity === null ? null : Number(log.quota_quantity),
      overflow_mode: log.overflow_mode,
      over_quota: log.over_quota,
      metadata: log.metadata,
    })))
  }

  const ids = logs.map((log) => log.id)
  let synced = 0
  let failed = 0
  if (ids.length > 0) {
    const { data: states } = await admin
      .from('usage_logs')
      .select('operator_sync_status')
      .in('id', ids)
    synced = states?.filter((row) => row.operator_sync_status === 'synced').length ?? 0
    failed = states?.filter((row) => row.operator_sync_status === 'failed').length ?? 0
  }

  return NextResponse.json({ candidates: logs.length, synced, failed, batchSize: BATCH_SIZE })
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob()
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req.headers.get('x-cron-secret'))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob()
}
