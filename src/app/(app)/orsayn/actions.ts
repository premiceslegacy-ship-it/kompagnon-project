'use server'

import { revalidatePath } from 'next/cache'
import { getOperatorUser } from '@/lib/operator-auth'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { createAdminClient } from '@/lib/supabase/admin'
import { ORGANIZATION_MODULE_KEYS, normalizeOrganizationModules } from '@/lib/organization-modules'
import {
  getModulesForTier,
  getQuotaConfigForTier,
  getQuotaUnit,
  isOverflowMode,
  isSubscriptionTier,
  QUOTA_FEATURES,
  type OverflowMode,
  type SubscriptionTier,
} from '@/lib/quota-catalog'
import { signOperatorPayload } from '@/lib/operator'

const SUPPORTED_BILLING_CURRENCIES = new Set(['EUR', 'USD'])

function parseMonthlyFee(value: FormDataEntryValue | null): number | null {
  if (typeof value !== 'string') return null

  const normalized = value.replace(',', '.').trim()
  if (!normalized) return null

  const parsed = Number.parseFloat(normalized)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error('Montant mensuel invalide')
  }

  return Math.round(parsed * 100) / 100
}

function normalizeUrl(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    return new URL(trimmed).origin
  } catch {
    throw new Error('URL app client invalide')
  }
}

function parseTier(value: FormDataEntryValue | null): SubscriptionTier {
  const tier = String(value ?? 'setup_only')
  if (!isSubscriptionTier(tier)) throw new Error('Tier invalide')
  return tier
}

function parseOverflowMode(value: FormDataEntryValue | null): OverflowMode {
  const mode = String(value ?? 'block')
  if (!isOverflowMode(mode)) throw new Error('Mode de dépassement invalide')
  return mode
}

function monthStartDate(): string {
  const periodStart = new Date()
  periodStart.setDate(1)
  periodStart.setHours(0, 0, 0, 0)
  return periodStart.toISOString().split('T')[0]
}

export async function upsertOperatorClientSettings(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) {
    throw new Error('Accès opérateur requis')
  }

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) {
    throw new Error('source_instance requis')
  }

  const labelRaw = String(formData.get('label') ?? '').trim()
  const billingCurrency = String(formData.get('billingCurrency') ?? 'EUR').trim().toUpperCase()
  const appUrl = normalizeUrl(formData.get('appUrl'))

  if (!SUPPORTED_BILLING_CURRENCIES.has(billingCurrency)) {
    throw new Error('Devise non supportée')
  }

  const operator = createOperatorAdminClient()
  const { error } = await operator
    .from('operator_client_settings')
    .upsert({
      source_instance: sourceInstance,
      label: labelRaw || null,
      monthly_fee_ht: parseMonthlyFee(formData.get('monthlyFeeHt')),
      billing_currency: billingCurrency,
      is_active: formData.get('isActive') === 'on',
      app_url: appUrl,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'source_instance',
    })

  if (error) {
    console.error('[upsertOperatorClientSettings]', error)
    throw new Error(error.message)
  }

  revalidatePath('/orsayn')
}

async function initializeQuotasForTier(sourceInstance: string, tier: SubscriptionTier) {
  const operator = createOperatorAdminClient()
  const periodStart = monthStartDate()
  const quotas = getQuotaConfigForTier(tier)

  const { data: existing, error: existingError } = await operator
    .from('operator_client_quotas')
    .select('quota_feature, current_quantity, current_cost_eur')
    .eq('source_instance', sourceInstance)
    .eq('period_start', periodStart)

  if (existingError) {
    console.error('[initializeQuotasForTier.existing]', existingError)
    throw new Error(existingError.message)
  }

  const existingByFeature = new Map((existing ?? []).map((row) => [row.quota_feature, row]))
  const rows = QUOTA_FEATURES.map((quotaFeature) => {
    const current = existingByFeature.get(quotaFeature)
    return {
      source_instance: sourceInstance,
      quota_feature: quotaFeature,
      quota_unit: getQuotaUnit(quotaFeature),
      quota_monthly: quotas[quotaFeature],
      current_quantity: current?.current_quantity ?? 0,
      current_cost_eur: current?.current_cost_eur ?? 0,
      period_start: periodStart,
      updated_at: new Date().toISOString(),
    }
  })

  const { error } = await operator
    .from('operator_client_quotas')
    .upsert(rows, { onConflict: 'source_instance,quota_feature,period_start' })

  if (error) {
    console.error('[initializeQuotasForTier.upsert]', error)
    throw new Error(error.message)
  }
}

async function syncClientQuotaConfig(sourceInstance: string, organizationId: string | null, appUrl: string | null, tier: SubscriptionTier, overflowMode: OverflowMode) {
  const operator = createOperatorAdminClient()

  if (!organizationId || !appUrl) {
    await operator
      .from('operator_client_settings')
      .update({
        config_sync_status: 'pending_manual',
        config_sync_error: !organizationId ? 'organization_id manquant' : 'app_url manquant',
        updated_at: new Date().toISOString(),
      })
      .eq('source_instance', sourceInstance)
    return
  }

  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) {
    await operator
      .from('operator_client_settings')
      .update({
        config_sync_status: 'skipped',
        config_sync_error: 'OPERATOR_CONFIG_SYNC_SECRET/OPERATOR_INGEST_SECRET manquant',
        updated_at: new Date().toISOString(),
      })
      .eq('source_instance', sourceInstance)
    return
  }

  const body = JSON.stringify({
    source_instance: sourceInstance,
    organization_id: organizationId,
    modules: getModulesForTier(tier),
    quota_config: getQuotaConfigForTier(tier),
    overflow_mode: overflowMode,
  })
  const signature = signOperatorPayload(body, secret)

  try {
    const response = await fetch(`${appUrl.replace(/\/$/, '')}/api/operator/config-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operator-signature': signature,
      },
      body,
    })

    if (!response.ok) {
      throw new Error(`config-sync ${response.status}: ${await response.text()}`)
    }

    await operator
      .from('operator_client_settings')
      .update({
        config_sync_status: 'synced',
        config_synced_at: new Date().toISOString(),
        config_sync_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('source_instance', sourceInstance)
  } catch (error) {
    await operator
      .from('operator_client_settings')
      .update({
        config_sync_status: 'failed',
        config_sync_error: error instanceof Error ? error.message : 'Config sync failed',
        updated_at: new Date().toISOString(),
      })
      .eq('source_instance', sourceInstance)
  }
}

export async function upsertOperatorSubscription(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')

  const tier = parseTier(formData.get('tier'))
  const overflowMode = parseOverflowMode(formData.get('overflowMode'))
  const billingCurrency = String(formData.get('billingCurrency') ?? 'EUR').trim().toUpperCase()
  if (!SUPPORTED_BILLING_CURRENCIES.has(billingCurrency)) throw new Error('Devise non supportée')

  const labelRaw = String(formData.get('label') ?? '').trim()
  const appUrl = normalizeUrl(formData.get('appUrl'))
  const mrrHt = parseMonthlyFee(formData.get('mrrHt'))
  const renewsAt = formData.get('renewsAt') ? new Date(String(formData.get('renewsAt'))) : null
  const trialActive = formData.get('trialActive') === 'on'
  const b2brouterActive = formData.get('b2brouterActive') === 'on'
  const notes = String(formData.get('notes') ?? '').trim() || null

  const operator = createOperatorAdminClient()
  const { data: client } = await operator
    .from('operator_clients')
    .select('organization_id')
    .eq('source_instance', sourceInstance)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error: settingsError } = await operator
    .from('operator_client_settings')
    .upsert({
      source_instance: sourceInstance,
      label: labelRaw || null,
      monthly_fee_ht: mrrHt,
      billing_currency: billingCurrency,
      is_active: formData.get('isActive') === 'on',
      app_url: appUrl,
      config_sync_status: appUrl ? 'pending' : 'pending_manual',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance' })

  if (settingsError) {
    console.error('[upsertOperatorSubscription.settings]', settingsError)
    throw new Error(settingsError.message)
  }

  const { error: subscriptionError } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: sourceInstance,
      tier,
      mrr_ht: mrrHt,
      billing_currency: billingCurrency,
      is_active: formData.get('isActive') === 'on',
      renews_at: renewsAt && !Number.isNaN(renewsAt.getTime()) ? renewsAt.toISOString() : null,
      trial_tier: trialActive ? 'expert' : null,
      trial_ends_at: trialActive ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() : null,
      b2brouter_active: b2brouterActive,
      overflow_mode: overflowMode,
      notes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance' })

  if (subscriptionError) {
    console.error('[upsertOperatorSubscription.subscription]', subscriptionError)
    throw new Error(subscriptionError.message)
  }

  await initializeQuotasForTier(sourceInstance, tier)
  await syncClientQuotaConfig(sourceInstance, client?.organization_id ?? null, appUrl, tier, overflowMode)

  revalidatePath('/orsayn')
}

export async function upsertOperatorClientModules(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')

  const operator = createOperatorAdminClient()
  const { data: client, error: clientError } = await operator
    .from('operator_clients')
    .select('organization_id')
    .eq('source_instance', sourceInstance)
    .maybeSingle()

  if (clientError || !client?.organization_id) {
    throw new Error('Client introuvable ou organization_id manquant')
  }

  const orgId = client.organization_id
  const admin = createAdminClient()

  const { data: current } = await admin
    .from('organization_modules')
    .select('modules')
    .eq('organization_id', orgId)
    .maybeSingle()

  const nextModules = normalizeOrganizationModules({
    ...(current?.modules ?? {}),
    ...Object.fromEntries(
      ORGANIZATION_MODULE_KEYS.map((key) => [key, formData.get(`module_${key}`) === 'on'])
    ),
  })

  const { error } = await admin
    .from('organization_modules')
    .upsert({ organization_id: orgId, modules: nextModules }, { onConflict: 'organization_id' })

  if (error) {
    console.error('[upsertOperatorClientModules]', error)
    throw new Error(error.message)
  }

  revalidatePath('/orsayn')
}
