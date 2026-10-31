import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { hasOperatorSigningSecret, readOperatorRequest } from '@/lib/operator'
import { normalizeOrganizationModules } from '@/lib/organization-modules'
import { isOverflowMode, isQuotaFeature, SUBSCRIPTION_TIERS } from '@/lib/quota-catalog'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeEinvoicingConfig } from '@/lib/einvoicing-config'
import { ACCESS_STATUSES, SELLABLE_TIERS } from '@/lib/subscription-access'

const ORGANIZATION_ID_PATTERN = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i
const nullableTimestampSchema = z.union([
  z.string().refine((value) => Number.isFinite(Date.parse(value))),
  z.null(),
])

const commonEntitlementFields = {
  access_status: z.enum(ACCESS_STATUSES),
  effective_tier: z.enum(SUBSCRIPTION_TIERS),
  preferred_tier: z.enum(SELLABLE_TIERS),
  trial_started_at: nullableTimestampSchema,
  trial_ends_at: nullableTimestampSchema,
  access_ends_at: nullableTimestampSchema,
}

const entitlementSchema = z.discriminatedUnion('billing_model', [
  z.object({
    ...commonEntitlementFields,
    billing_model: z.literal('subscription'),
  }),
  z.object({
    ...commonEntitlementFields,
    billing_model: z.literal('setup'),
    revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  }),
])

const configSyncPayloadSchema = z.object({
  source_instance: z.string().min(1).refine((value) => value === value.trim()),
  organization_id: z.string().regex(ORGANIZATION_ID_PATTERN),
  modules: z.record(z.string(), z.unknown()),
  quota_config: z.record(z.string(), z.union([z.number(), z.string()])),
  overflow_mode: z.string(),
  ai_billing_mode: z.string().optional(),
  einvoicing_config: z.record(z.string(), z.unknown()).optional(),
  entitlement: entitlementSchema.optional(),
}).strict()

type ConfigSyncPayload = z.infer<typeof configSyncPayloadSchema>

function normalizeQuotaConfig(input: Record<string, number | string>): Record<string, number> | null {
  const normalized: Record<string, number> = {}
  for (const [key, raw] of Object.entries(input)) {
    if (!isQuotaFeature(key) || (typeof raw !== 'number' && typeof raw !== 'string')) return null
    if (typeof raw === 'string' && raw.trim() === '') return null
    const parsed = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(parsed)) return null
    normalized[key] = parsed
  }
  return normalized
}

export async function POST(req: NextRequest) {
  if (!hasOperatorSigningSecret()) {
    return NextResponse.json({ error: 'Operator config sync secret missing' }, { status: 500 })
  }

  const rawBody = await req.text()
  const check = readOperatorRequest<ConfigSyncPayload>(rawBody, req.headers)
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status })
  }

  const parsed = configSyncPayloadSchema.safeParse(check.body)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid payload' }, { status: 400 })
  }
  const payload = parsed.data

  const overflowMode = isOverflowMode(payload.overflow_mode) ? payload.overflow_mode : 'block'
  const aiBillingMode = payload.ai_billing_mode === 'client_owned' ? 'client_owned' : 'orsayn_shared'
  const quotaConfig = normalizeQuotaConfig(payload.quota_config)
  if (!quotaConfig) {
    return NextResponse.json({ error: 'Invalid quota config' }, { status: 400 })
  }
  const einvoicingConfig = payload.einvoicing_config === undefined
    ? null
    : normalizeEinvoicingConfig(payload.einvoicing_config)
  const normalizedModules = normalizeOrganizationModules(payload.modules)
  if (payload.entitlement?.billing_model === 'setup' && (
    aiBillingMode !== 'client_owned'
    || payload.entitlement.effective_tier !== 'setup_only'
    || normalizedModules.voice_live
    || quotaConfig.voice_live_minutes !== 0
    || overflowMode !== 'block'
    || !['active', 'locked'].includes(payload.entitlement.access_status)
    || payload.entitlement.trial_started_at !== null
    || payload.entitlement.trial_ends_at !== null
    || payload.entitlement.access_ends_at !== null
  )) {
    return NextResponse.json({ error: 'Invalid setup entitlement' }, { status: 400 })
  }

  const { data, error } = await createAdminClient().rpc('apply_operator_config', {
    p_organization_id: payload.organization_id,
    p_modules: normalizedModules,
    p_quota_config: quotaConfig,
    p_overflow_mode: overflowMode,
    p_ai_billing_mode: aiBillingMode,
    p_einvoicing_config: einvoicingConfig ? {
      mode: einvoicingConfig.mode,
      provider: einvoicingConfig.provider,
      environment: einvoicingConfig.environment,
      annuaire_status: einvoicingConfig.annuaire_status,
      oauth_status: einvoicingConfig.oauth_status,
      oauth_connected_at: einvoicingConfig.oauth_connected_at,
      super_pdp_connection_id: einvoicingConfig.super_pdp_connection_id,
      super_pdp_emission_enabled: einvoicingConfig.emission_enabled,
      super_pdp_reception_enabled: einvoicingConfig.reception_enabled,
    } : null,
    p_entitlement: payload.entitlement ?? null,
  })

  if (error) {
    if (error.code === 'PT409') {
      return NextResponse.json({ error: 'Configuration d’accès plus récente déjà appliquée' }, { status: 409 })
    }
    console.error('[operator/config-sync.rpc]', { code: error.code })
    return NextResponse.json({ error: 'Unable to sync organization config' }, { status: 500 })
  }

  if (data !== 'applied') {
    console.error('[operator/config-sync.rpc]', { result: 'unexpected' })
    return NextResponse.json({ error: 'Unable to sync organization config' }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}
