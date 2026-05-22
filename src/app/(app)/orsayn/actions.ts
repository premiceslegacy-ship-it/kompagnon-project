'use server'

import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'
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
import {
  DEFAULT_EINVOICING_CONFIG,
  normalizeEinvoicingConfig,
  normalizeEinvoicingConfigFromDb,
  type EinvoicingConfig,
} from '@/lib/einvoicing-config'

const SUPPORTED_BILLING_CURRENCIES = new Set(['EUR', 'USD'])
const AI_BILLING_MODES = new Set(['orsayn_shared', 'client_owned'])
type AIBillingMode = 'orsayn_shared' | 'client_owned'

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

function parseAIBillingMode(value: FormDataEntryValue | null): AIBillingMode {
  const mode = String(value ?? 'orsayn_shared')
  if (!AI_BILLING_MODES.has(mode)) throw new Error('Mode de facturation IA invalide')
  return mode as AIBillingMode
}

function parseEinvoicingConfig(formData: FormData): EinvoicingConfig {
  return normalizeEinvoicingConfig({
    mode: formData.get('einvoicingMode'),
    provider: formData.get('einvoicingProvider'),
    environment: formData.get('einvoicingEnvironment'),
    onboarding_model: formData.get('einvoicingOnboardingModel'),
    b2brouter_account_id: formData.get('b2brouterAccountId'),
    annuaire_status: formData.get('einvoicingAnnuaireStatus'),
  })
}

function monthStartDate(): string {
  const periodStart = new Date()
  periodStart.setDate(1)
  periodStart.setHours(0, 0, 0, 0)
  return periodStart.toISOString().split('T')[0]
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function parseOptionalEmail(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  if (!trimmed) return null
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new Error('Email destinataire invalide')
  }
  return trimmed
}

function getCommercialTemplate(input: {
  eventType: string
  clientLabel: string
  tier: SubscriptionTier
  usageCostLabel: string
  suggestedTier: SubscriptionTier
}) {
  if (input.eventType === 'upgrade_prompt_wa') {
    return {
      template: 'upgrade-prompt-wa',
      subject: `Atelier : usage WhatsApp à optimiser pour ${input.clientLabel}`,
      body: [
        `Bonjour,`,
        `Je vous écris car l'usage WhatsApp de ${input.clientLabel} commence à devenir significatif sur Atelier.`,
        `Votre offre actuelle est ${input.tier}. Vu le volume récent, le palier ${input.suggestedTier} peut être plus confortable pour éviter les limites et garder de la marge sur les automatisations.`,
        `On peut regarder ça ensemble et ajuster l'offre si besoin.`,
      ],
    }
  }

  return {
    template: 'upgrade-prompt-quota',
    subject: `Atelier : point usage IA pour ${input.clientLabel}`,
    body: [
      `Bonjour,`,
      `Je vous fais un point rapide sur l'usage IA de ${input.clientLabel}.`,
      `Ce mois-ci, l'usage indicatif représente ${input.usageCostLabel}. Votre offre actuelle est ${input.tier}.`,
      `Si ce rythme continue, le palier ${input.suggestedTier} peut être plus adapté pour garder une expérience fluide et éviter les limites.`,
      `On peut faire le point ensemble quand vous voulez.`,
    ],
  }
}

async function sendOperatorCommercialEmail(input: {
  to: string
  subject: string
  bodyLines: string[]
}) {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromAddress = process.env.RESEND_FROM_ADDRESS?.trim()
  const fromName = process.env.RESEND_FROM_NAME?.trim() || 'Orsayn'

  if (!apiKey || !fromAddress) {
    return { status: 'skipped' as const, error: 'RESEND_API_KEY/RESEND_FROM_ADDRESS manquant' }
  }

  const resend = new Resend(apiKey)
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827">
      ${input.bodyLines.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}
      <p style="margin-top:24px;color:#6b7280;font-size:13px">Orsayn</p>
    </div>
  `

  const { error } = await resend.emails.send({
    from: `${fromName} <${fromAddress}>`,
    to: input.to,
    subject: input.subject,
    html,
  })

  if (error) {
    return { status: 'failed' as const, error: error.message }
  }

  return { status: 'sent' as const, error: null }
}

type TrialState = {
  tier: SubscriptionTier
  trial_tier: SubscriptionTier | null
  trial_ends_at: string | null
  trial_converted?: boolean | null
}

function getEffectiveTier(subscription: TrialState): SubscriptionTier {
  if (
    subscription.trial_tier
    && subscription.trial_ends_at
    && !subscription.trial_converted
    && new Date(subscription.trial_ends_at).getTime() > Date.now()
  ) {
    return subscription.trial_tier
  }

  return subscription.tier
}

async function recordOperatorClientEvent(input: {
  sourceInstance: string
  eventCategory: 'subscription' | 'trial' | 'config_sync' | 'einvoicing' | 'module' | 'crm' | 'note'
  eventType: string
  actorEmail: string | null
  metadata?: Record<string, unknown>
  notes?: string | null
}) {
  const operator = createOperatorAdminClient()
  const { error } = await operator
    .from('operator_client_events')
    .insert({
      source_instance: input.sourceInstance,
      event_category: input.eventCategory,
      event_type: input.eventType,
      actor_email: input.actorEmail,
      metadata: input.metadata ?? {},
      notes: input.notes ?? null,
    })

  if (error) {
    console.error('[recordOperatorClientEvent]', error)
  }
}

async function recordOperatorCommercialEvent(input: {
  sourceInstance: string
  eventType: string
  tierContext: string | null
  actorEmail: string | null
  emailTemplate: string | null
  subjectPreview: string | null
  notes: string | null
  metadata?: Record<string, unknown>
}) {
  const operator = createOperatorAdminClient()
  const { error } = await operator
    .from('operator_commercial_events')
    .insert({
      source_instance: input.sourceInstance,
      event_type: input.eventType,
      tier_context: input.tierContext,
      sent_by: 'operator_manual',
      actor_email: input.actorEmail,
      email_template: input.emailTemplate,
      subject_preview: input.subjectPreview,
      notes: input.notes,
      metadata: input.metadata ?? {},
    })

  if (error) {
    console.error('[recordOperatorCommercialEvent]', error)
    throw new Error(error.message)
  }
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

async function syncClientQuotaConfig(
  sourceInstance: string,
  organizationId: string | null,
  appUrl: string | null,
  tier: SubscriptionTier,
  overflowMode: OverflowMode,
  einvoicingConfig: EinvoicingConfig,
): Promise<{ status: 'synced' | 'pending_manual' | 'skipped' | 'failed'; error: string | null }> {
  const operator = createOperatorAdminClient()

  if (!organizationId || !appUrl) {
    const errorMessage = !organizationId ? 'organization_id manquant' : 'app_url manquant'
    await operator
      .from('operator_client_settings')
      .update({
        config_sync_status: 'pending_manual',
        config_sync_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('source_instance', sourceInstance)
    return { status: 'pending_manual', error: errorMessage }
  }

  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) {
    const errorMessage = 'OPERATOR_CONFIG_SYNC_SECRET/OPERATOR_INGEST_SECRET manquant'
    await operator
      .from('operator_client_settings')
      .update({
        config_sync_status: 'skipped',
        config_sync_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('source_instance', sourceInstance)
    return { status: 'skipped', error: errorMessage }
  }

  const body = JSON.stringify({
    source_instance: sourceInstance,
    organization_id: organizationId,
    modules: getModulesForTier(tier),
    quota_config: getQuotaConfigForTier(tier),
    overflow_mode: overflowMode,
    einvoicing_config: einvoicingConfig,
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
    return { status: 'synced', error: null }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Config sync failed'
    await operator
      .from('operator_client_settings')
      .update({
        config_sync_status: 'failed',
        config_sync_error: errorMessage,
        updated_at: new Date().toISOString(),
      })
      .eq('source_instance', sourceInstance)
    return { status: 'failed', error: errorMessage }
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
  const aiBillingMode = parseAIBillingMode(formData.get('aiBillingMode'))
  const renewsAt = formData.get('renewsAt') ? new Date(String(formData.get('renewsAt'))) : null
  const einvoicingConfig = parseEinvoicingConfig(formData)
  const notes = String(formData.get('notes') ?? '').trim() || null

  const operator = createOperatorAdminClient()
  const { data: client } = await operator
    .from('operator_clients')
    .select('organization_id')
    .eq('source_instance', sourceInstance)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { data: existingSubscription } = await operator
    .from('operator_client_subscriptions')
    .select('trial_tier, trial_ends_at, trial_converted')
    .eq('source_instance', sourceInstance)
    .maybeSingle()

  const trialTier = existingSubscription?.trial_tier && isSubscriptionTier(existingSubscription.trial_tier)
    ? existingSubscription.trial_tier
    : null
  const trialEndsAt = existingSubscription?.trial_ends_at ?? null
  const trialConverted = Boolean(existingSubscription?.trial_converted)

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
      ai_billing_mode: aiBillingMode,
      is_active: formData.get('isActive') === 'on',
      renews_at: renewsAt && !Number.isNaN(renewsAt.getTime()) ? renewsAt.toISOString() : null,
      trial_tier: trialTier,
      trial_ends_at: trialEndsAt,
      trial_converted: trialConverted,
      b2brouter_active: einvoicingConfig.mode === 'b2brouter',
      einvoicing_mode: einvoicingConfig.mode,
      einvoicing_provider: einvoicingConfig.provider,
      einvoicing_environment: einvoicingConfig.environment,
      einvoicing_onboarding_model: einvoicingConfig.onboarding_model,
      b2brouter_account_id: einvoicingConfig.b2brouter_account_id,
      einvoicing_annuaire_status: einvoicingConfig.annuaire_status,
      overflow_mode: overflowMode,
      notes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance' })

  if (subscriptionError) {
    console.error('[upsertOperatorSubscription.subscription]', subscriptionError)
    throw new Error(subscriptionError.message)
  }

  const effectiveTier = getEffectiveTier({
    tier,
    trial_tier: trialTier,
    trial_ends_at: trialEndsAt,
    trial_converted: trialConverted,
  })
  await initializeQuotasForTier(sourceInstance, effectiveTier)
  const syncResult = await syncClientQuotaConfig(sourceInstance, client?.organization_id ?? null, appUrl, effectiveTier, overflowMode, einvoicingConfig)
  await recordOperatorClientEvent({
    sourceInstance,
    eventCategory: 'subscription',
    eventType: 'subscription_updated',
    actorEmail: user.email ?? null,
    metadata: {
      tier,
      effective_tier: effectiveTier,
      mrr_ht: mrrHt,
      overflow_mode: overflowMode,
      einvoicing_mode: einvoicingConfig.mode,
      ai_billing_mode: aiBillingMode,
      config_sync_status: syncResult.status,
    },
    notes,
  })

  revalidatePath('/orsayn')
}

async function getOperatorClientContext(sourceInstance: string) {
  const operator = createOperatorAdminClient()
  const [clientResult, settingResult, subscriptionResult] = await Promise.all([
    operator
      .from('operator_clients')
      .select('organization_id')
      .eq('source_instance', sourceInstance)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    operator
      .from('operator_client_settings')
      .select('app_url')
      .eq('source_instance', sourceInstance)
      .maybeSingle(),
    operator
      .from('operator_client_subscriptions')
      .select('tier, ai_billing_mode, overflow_mode, einvoicing_mode, einvoicing_provider, einvoicing_environment, einvoicing_onboarding_model, b2brouter_account_id, einvoicing_annuaire_status, trial_tier, trial_ends_at, trial_converted')
      .eq('source_instance', sourceInstance)
      .maybeSingle(),
  ])

  if (clientResult.error) throw new Error(clientResult.error.message)
  if (settingResult.error) throw new Error(settingResult.error.message)
  if (subscriptionResult.error) throw new Error(subscriptionResult.error.message)

  const subscription = subscriptionResult.data
  const tier = subscription && isSubscriptionTier(subscription.tier) ? subscription.tier : 'setup_only'
  const aiBillingMode = subscription && AI_BILLING_MODES.has(String(subscription.ai_billing_mode))
    ? String(subscription.ai_billing_mode) as AIBillingMode
    : 'orsayn_shared'
  const overflowMode = subscription && isOverflowMode(subscription.overflow_mode) ? subscription.overflow_mode : 'block'
  const einvoicingConfig = normalizeEinvoicingConfigFromDb({
    mode: subscription?.einvoicing_mode ?? DEFAULT_EINVOICING_CONFIG.mode,
    provider: subscription?.einvoicing_provider ?? null,
    environment: subscription?.einvoicing_environment ?? DEFAULT_EINVOICING_CONFIG.environment,
    onboarding_model: subscription?.einvoicing_onboarding_model ?? null,
    b2brouter_account_id: subscription?.b2brouter_account_id ?? null,
    annuaire_status: subscription?.einvoicing_annuaire_status ?? DEFAULT_EINVOICING_CONFIG.annuaire_status,
  })

  return {
    operator,
    organizationId: clientResult.data?.organization_id ?? null,
    appUrl: settingResult.data?.app_url ?? null,
    subscription: {
      tier,
      aiBillingMode,
      overflowMode,
      einvoicingConfig,
      trialTier: subscription?.trial_tier && isSubscriptionTier(subscription.trial_tier)
        ? subscription.trial_tier
        : null,
      trialEndsAt: subscription?.trial_ends_at ?? null,
      trialConverted: Boolean(subscription?.trial_converted),
    },
  }
}

export async function activateOperatorTrial(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')

  const daysRaw = Number.parseInt(String(formData.get('trialDays') ?? '30'), 10)
  const trialDays = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 90) : 30
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
  const { operator, organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance)

  const { error } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: sourceInstance,
      tier: subscription.tier,
      ai_billing_mode: subscription.aiBillingMode,
      overflow_mode: subscription.overflowMode,
      einvoicing_mode: subscription.einvoicingConfig.mode,
      einvoicing_provider: subscription.einvoicingConfig.provider,
      einvoicing_environment: subscription.einvoicingConfig.environment,
      einvoicing_onboarding_model: subscription.einvoicingConfig.onboarding_model,
      b2brouter_account_id: subscription.einvoicingConfig.b2brouter_account_id,
      einvoicing_annuaire_status: subscription.einvoicingConfig.annuaire_status,
      b2brouter_active: subscription.einvoicingConfig.mode === 'b2brouter',
      trial_tier: 'expert',
      trial_ends_at: trialEndsAt,
      trial_converted: false,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance' })

  if (error) throw new Error(error.message)

  await initializeQuotasForTier(sourceInstance, 'expert')
  const syncResult = await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    appUrl,
    'expert',
    subscription.overflowMode,
    subscription.einvoicingConfig,
  )
  await recordOperatorClientEvent({
    sourceInstance,
    eventCategory: 'trial',
    eventType: 'trial_started',
    actorEmail: user.email ?? null,
    metadata: {
      trial_tier: 'expert',
      trial_days: trialDays,
      trial_ends_at: trialEndsAt,
      config_sync_status: syncResult.status,
    },
  })

  revalidatePath('/orsayn')
}

export async function convertOperatorTrial(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')

  const targetTier = parseTier(formData.get('targetTier'))
  const { operator, organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance)

  const { error } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: sourceInstance,
      tier: targetTier,
      ai_billing_mode: subscription.aiBillingMode,
      overflow_mode: subscription.overflowMode,
      einvoicing_mode: subscription.einvoicingConfig.mode,
      einvoicing_provider: subscription.einvoicingConfig.provider,
      einvoicing_environment: subscription.einvoicingConfig.environment,
      einvoicing_onboarding_model: subscription.einvoicingConfig.onboarding_model,
      b2brouter_account_id: subscription.einvoicingConfig.b2brouter_account_id,
      einvoicing_annuaire_status: subscription.einvoicingConfig.annuaire_status,
      b2brouter_active: subscription.einvoicingConfig.mode === 'b2brouter',
      trial_tier: null,
      trial_ends_at: null,
      trial_converted: true,
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance' })

  if (error) throw new Error(error.message)

  await initializeQuotasForTier(sourceInstance, targetTier)
  const syncResult = await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    appUrl,
    targetTier,
    subscription.overflowMode,
    subscription.einvoicingConfig,
  )
  await recordOperatorClientEvent({
    sourceInstance,
    eventCategory: 'trial',
    eventType: 'trial_converted',
    actorEmail: user.email ?? null,
    metadata: {
      target_tier: targetTier,
      config_sync_status: syncResult.status,
    },
  })

  revalidatePath('/orsayn')
}

export async function expireOperatorTrial(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')

  const targetTier = parseTier(formData.get('targetTier'))
  const { operator, organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance)

  const { error } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: sourceInstance,
      tier: targetTier,
      ai_billing_mode: subscription.aiBillingMode,
      overflow_mode: subscription.overflowMode,
      einvoicing_mode: subscription.einvoicingConfig.mode,
      einvoicing_provider: subscription.einvoicingConfig.provider,
      einvoicing_environment: subscription.einvoicingConfig.environment,
      einvoicing_onboarding_model: subscription.einvoicingConfig.onboarding_model,
      b2brouter_account_id: subscription.einvoicingConfig.b2brouter_account_id,
      einvoicing_annuaire_status: subscription.einvoicingConfig.annuaire_status,
      b2brouter_active: subscription.einvoicingConfig.mode === 'b2brouter',
      trial_tier: null,
      trial_ends_at: null,
      trial_converted: false,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance' })

  if (error) throw new Error(error.message)

  await initializeQuotasForTier(sourceInstance, targetTier)
  const syncResult = await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    appUrl,
    targetTier,
    subscription.overflowMode,
    subscription.einvoicingConfig,
  )
  await recordOperatorClientEvent({
    sourceInstance,
    eventCategory: 'trial',
    eventType: 'trial_ended',
    actorEmail: user.email ?? null,
    metadata: {
      target_tier: targetTier,
      config_sync_status: syncResult.status,
    },
  })

  revalidatePath('/orsayn')
}

export async function resyncOperatorClientConfig(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')

  const { organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance)
  const effectiveTier = getEffectiveTier({
    tier: subscription.tier,
    trial_tier: subscription.trialTier,
    trial_ends_at: subscription.trialEndsAt,
    trial_converted: subscription.trialConverted,
  })

  await initializeQuotasForTier(sourceInstance, effectiveTier)
  const syncResult = await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    appUrl,
    effectiveTier,
    subscription.overflowMode,
    subscription.einvoicingConfig,
  )
  await recordOperatorClientEvent({
    sourceInstance,
    eventCategory: 'config_sync',
    eventType: 'config_resync_requested',
    actorEmail: user.email ?? null,
    metadata: {
      effective_tier: effectiveTier,
      config_sync_status: syncResult.status,
      error: syncResult.error,
    },
  })

  revalidatePath('/orsayn')
}

export async function recordOperatorCommercialAction(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')

  const clientLabel = String(formData.get('clientLabel') ?? sourceInstance).trim() || sourceInstance
  const currentTier = parseTier(formData.get('currentTier'))
  const suggestedTier = parseTier(formData.get('suggestedTier'))
  const eventType = String(formData.get('eventType') ?? 'upgrade_prompt_quota').trim()
  const usageCostLabel = String(formData.get('usageCostLabel') ?? 'non renseigné').trim()
  const notes = String(formData.get('notes') ?? '').trim() || null
  const recipientEmail = parseOptionalEmail(formData.get('recipientEmail'))
  const deliveryMode = String(formData.get('deliveryMode') ?? 'draft')
  const template = getCommercialTemplate({
    eventType,
    clientLabel,
    tier: currentTier,
    usageCostLabel,
    suggestedTier,
  })

  let deliveryStatus: 'draft' | 'sent' | 'failed' | 'skipped' = 'draft'
  let deliveryError: string | null = null

  if (deliveryMode === 'send') {
    if (!recipientEmail) {
      deliveryStatus = 'failed'
      deliveryError = 'Email destinataire requis pour envoyer'
    } else {
      const result = await sendOperatorCommercialEmail({
        to: recipientEmail,
        subject: template.subject,
        bodyLines: template.body,
      })
      deliveryStatus = result.status
      deliveryError = result.error
    }
  }

  await recordOperatorCommercialEvent({
    sourceInstance,
    eventType,
    tierContext: currentTier,
    actorEmail: user.email ?? null,
    emailTemplate: template.template,
    subjectPreview: template.subject,
    notes,
    metadata: {
      client_label: clientLabel,
      suggested_tier: suggestedTier,
      usage_cost_label: usageCostLabel,
      recipient_email: recipientEmail,
      delivery_mode: deliveryMode,
      delivery_status: deliveryStatus,
      delivery_error: deliveryError,
    },
  })

  await recordOperatorClientEvent({
    sourceInstance,
    eventCategory: 'crm',
    eventType: deliveryMode === 'send' ? 'commercial_email_requested' : 'commercial_action_logged',
    actorEmail: user.email ?? null,
    metadata: {
      commercial_event_type: eventType,
      email_template: template.template,
      suggested_tier: suggestedTier,
      delivery_status: deliveryStatus,
      delivery_error: deliveryError,
    },
    notes,
  })

  if (deliveryMode === 'send' && deliveryStatus === 'failed') {
    throw new Error(deliveryError ?? 'Envoi email impossible')
  }

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

  await recordOperatorClientEvent({
    sourceInstance,
    eventCategory: 'module',
    eventType: 'modules_updated',
    actorEmail: user.email ?? null,
    metadata: {
      enabled_modules: Object.entries(nextModules)
        .filter(([, enabled]) => enabled)
        .map(([key]) => key),
    },
  })

  revalidatePath('/orsayn')
}
