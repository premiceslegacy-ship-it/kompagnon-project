import { NextRequest, NextResponse } from 'next/server'
import { verifyOperatorSignature } from '@/lib/operator'
import { normalizeOrganizationModules } from '@/lib/organization-modules'
import { isOverflowMode } from '@/lib/quota-catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeEinvoicingConfig } from '@/lib/einvoicing-config'
import { isSubscriptionTier } from '@/lib/quota-catalog'
import { isAccessStatus, isSellableTier, type EntitlementSyncPayload } from '@/lib/subscription-access'

type ConfigSyncPayload = {
  source_instance: string
  organization_id: string
  modules: Record<string, unknown>
  quota_config: Record<string, unknown>
  overflow_mode: string
  ai_billing_mode?: string
  einvoicing_config?: Record<string, unknown>
  entitlement?: EntitlementSyncPayload
}

function isValidEntitlement(value: unknown): value is EntitlementSyncPayload {
  if (!isRecord(value)) return false
  return (
    isAccessStatus(value.access_status)
    && typeof value.effective_tier === 'string'
    && isSubscriptionTier(value.effective_tier)
    && isSellableTier(value.preferred_tier)
    && (value.trial_started_at === null || typeof value.trial_started_at === 'string')
    && (value.trial_ends_at === null || typeof value.trial_ends_at === 'string')
    && (value.access_ends_at === null || typeof value.access_ends_at === 'string')
  )
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
    && (value.ai_billing_mode === undefined || typeof value.ai_billing_mode === 'string')
    && (value.einvoicing_config === undefined || isRecord(value.einvoicing_config))
    && (value.entitlement === undefined || isValidEntitlement(value.entitlement))
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
  const aiBillingMode = payload.ai_billing_mode === 'client_owned' ? 'client_owned' : 'orsayn_shared'
  const einvoicingConfig = normalizeEinvoicingConfig(payload.einvoicing_config)
  const normalizedModules = normalizeOrganizationModules(payload.modules)
  const admin = createAdminClient()
  const { error: modulesError } = await admin
    .from('organization_modules')
    .upsert({
      organization_id: payload.organization_id,
      modules: normalizedModules,
      quota_config: normalizeQuotaConfig(payload.quota_config),
      overflow_mode: overflowMode,
      ai_billing_mode: aiBillingMode,
      quota_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' })

  if (modulesError) {
    console.error('[operator/config-sync.modules]', modulesError)
    return NextResponse.json({ error: 'Unable to sync quota config' }, { status: 500 })
  }

  const { error: einvoicingError } = await admin
    .from('organization_einvoicing_config')
    .upsert({
      organization_id: payload.organization_id,
      mode: einvoicingConfig.mode,
      provider: einvoicingConfig.provider,
      environment: einvoicingConfig.environment,
      annuaire_status: einvoicingConfig.annuaire_status,
      super_pdp_emission_enabled: einvoicingConfig.emission_enabled,
      super_pdp_reception_enabled: einvoicingConfig.reception_enabled,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'organization_id' })

  if (einvoicingError) {
    console.error('[operator/config-sync.einvoicing]', einvoicingError)
    return NextResponse.json({ error: 'Unable to sync einvoicing config' }, { status: 500 })
  }

  if (payload.entitlement) {
    const { error: entitlementError } = await admin
      .from('organization_entitlements')
      .upsert({
        organization_id: payload.organization_id,
        ...payload.entitlement,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'organization_id' })

    if (entitlementError) {
      console.error('[operator/config-sync.entitlement]', entitlementError)
      return NextResponse.json({ error: 'Unable to sync entitlement' }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}
