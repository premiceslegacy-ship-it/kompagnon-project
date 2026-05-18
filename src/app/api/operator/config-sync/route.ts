import { NextRequest, NextResponse } from 'next/server'
import { verifyOperatorSignature } from '@/lib/operator'
import { normalizeOrganizationModules } from '@/lib/organization-modules'
import { isOverflowMode } from '@/lib/quota-catalog'
import { createAdminClient } from '@/lib/supabase/admin'

type ConfigSyncPayload = {
  source_instance: string
  organization_id: string
  modules: Record<string, unknown>
  quota_config: Record<string, unknown>
  overflow_mode: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isValidPayload(value: unknown): value is ConfigSyncPayload {
  if (!isRecord(value)) return false

  return (
    typeof value.source_instance === 'string'
    && typeof value.organization_id === 'string'
    && isRecord(value.modules)
    && isRecord(value.quota_config)
    && typeof value.overflow_mode === 'string'
  )
}

function normalizeQuotaConfig(input: Record<string, unknown>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(input).map(([key, raw]) => {
      const parsed = typeof raw === 'number' ? raw : Number.parseFloat(String(raw))
      return [key, Number.isFinite(parsed) ? parsed : -1]
    }),
  )
}

export async function POST(req: NextRequest) {
  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()

  if (!secret) {
    return NextResponse.json({ error: 'Operator config sync secret missing' }, { status: 500 })
  }

  const rawBody = await req.text()
  const signature = req.headers.get('x-operator-signature')
  if (!verifyOperatorSignature(rawBody, secret, signature)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: unknown
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  if (!isValidPayload(payload)) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }

  const overflowMode = isOverflowMode(payload.overflow_mode) ? payload.overflow_mode : 'block'
  const admin = createAdminClient()
  const { error } = await admin
    .from('organization_modules')
    .upsert({
      organization_id: payload.organization_id,
      modules: normalizeOrganizationModules(payload.modules),
      quota_config: normalizeQuotaConfig(payload.quota_config),
      overflow_mode: overflowMode,
      quota_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' })

  if (error) {
    console.error('[operator/config-sync]', error)
    return NextResponse.json({ error: 'Unable to sync quota config' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
