import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { signOperatorPayload } from '@/lib/operator'
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
import {
  DEFAULT_EINVOICING_CONFIG,
  normalizeEinvoicingConfigFromDb,
  type EinvoicingConfig,
} from '@/lib/einvoicing-config'
import type { EntitlementSyncPayload } from '@/lib/subscription-access'

const AI_BILLING_MODES = new Set(['orsayn_shared', 'client_owned'])
export type AIBillingMode = 'orsayn_shared' | 'client_owned'

export type TrialState = {
  tier: SubscriptionTier
  trial_tier: SubscriptionTier | null
  trial_ends_at: string | null
  trial_converted?: boolean | null
}

export function getEffectiveTier(subscription: TrialState): SubscriptionTier {
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

function monthStartDate(): string {
  const periodStart = new Date()
  periodStart.setDate(1)
  periodStart.setHours(0, 0, 0, 0)
  return periodStart.toISOString().split('T')[0]
}

/**
 * UUID sentinelle réservé aux cas où aucune organisation n'a pu être résolue
 * (paiement Stripe orphelin sur operator_client_settings, dont organization_id
 * fait partie de la PK et ne peut donc pas être NULL). Ne jamais utiliser cette
 * valeur pour un organization_id applicatif réel — voir migration 010.
 */
export const UNRESOLVED_ORGANIZATION_ID = '00000000-0000-0000-0000-000000000000'

export async function recordOperatorClientEvent(input: {
  sourceInstance: string
  organizationId: string | null
  eventCategory: 'subscription' | 'trial' | 'config_sync' | 'einvoicing' | 'module' | 'crm' | 'note' | 'vertical_pack'
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
      organization_id: input.organizationId,
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

export async function initializeQuotasForTier(sourceInstance: string, organizationId: string, tier: SubscriptionTier) {
  const operator = createOperatorAdminClient()
  const periodStart = monthStartDate()
  const quotas = getQuotaConfigForTier(tier)

  const { data: existing, error: existingError } = await operator
    .from('operator_client_quotas')
    .select('quota_feature, current_quantity, current_cost_eur')
    .eq('source_instance', sourceInstance)
    .eq('organization_id', organizationId)
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
      organization_id: organizationId,
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
    .upsert(rows, { onConflict: 'source_instance,organization_id,quota_feature,period_start' })

  if (error) {
    console.error('[initializeQuotasForTier.upsert]', error)
    throw new Error(error.message)
  }
}

export async function syncClientQuotaConfig(
  sourceInstance: string,
  organizationId: string | null,
  appUrl: string | null,
  tier: SubscriptionTier,
  overflowMode: OverflowMode,
  aiBillingMode: AIBillingMode,
  einvoicingConfig: EinvoicingConfig,
  entitlement?: EntitlementSyncPayload,
): Promise<{ status: 'synced' | 'pending_manual' | 'skipped' | 'failed'; error: string | null }> {
  const operator = createOperatorAdminClient()

  if (!organizationId || !appUrl) {
    const errorMessage = !organizationId ? 'organization_id manquant' : 'app_url manquant'
    // organizationId inconnu ici : impossible de cibler une ligne précise sans
    // risquer de mettre à jour la mauvaise organisation d'une instance mutualisée.
    // On ne touche donc que si on le connaît ; sinon l'appelant doit déjà avoir
    // créé la ligne settings via un autre chemin (ingest) pour qu'elle existe.
    if (organizationId) {
      await operator
        .from('operator_client_settings')
        .update({
          config_sync_status: 'pending_manual',
          config_sync_error: errorMessage,
          updated_at: new Date().toISOString(),
        })
        .eq('source_instance', sourceInstance)
        .eq('organization_id', organizationId)
    }
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
      .eq('organization_id', organizationId)
    return { status: 'skipped', error: errorMessage }
  }

  const syncedTier = aiBillingMode === 'client_owned' ? 'expert' : tier
  const body = JSON.stringify({
    source_instance: sourceInstance,
    organization_id: organizationId,
    modules: getModulesForTier(syncedTier),
    quota_config: getQuotaConfigForTier(syncedTier),
    overflow_mode: overflowMode,
    ai_billing_mode: aiBillingMode,
    einvoicing_config: einvoicingConfig,
    ...(entitlement ? { entitlement } : {}),
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
      .eq('organization_id', organizationId)
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
      .eq('organization_id', organizationId)
    return { status: 'failed', error: errorMessage }
  }
}

/**
 * Résout organizationId depuis operator_clients avant de charger settings/subscription,
 * car ces deux dernières tables ont organization_id dans leur clé (composite avec
 * source_instance) : sans le connaître d'abord, .maybeSingle() plante (PGRST116) dès
 * qu'une instance mutualisée porte plusieurs organisations.
 * organizationId optionnel : si déjà connu par l'appelant (ex. résolu via un autre
 * canal), évite une requête et lève l'ambiguïté "quelle organisation de l'instance".
 */
export async function getOperatorClientContext(sourceInstance: string, organizationId?: string) {
  const operator = createOperatorAdminClient()

  let resolvedOrganizationId = organizationId ?? null
  if (!resolvedOrganizationId) {
    const { data: client, error: clientError } = await operator
      .from('operator_clients')
      .select('organization_id')
      .eq('source_instance', sourceInstance)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (clientError) throw new Error(clientError.message)
    resolvedOrganizationId = client?.organization_id ?? null
  }

  const [settingResult, subscriptionResult] = await Promise.all([
    resolvedOrganizationId
      ? operator
        .from('operator_client_settings')
        .select('app_url')
        .eq('source_instance', sourceInstance)
        .eq('organization_id', resolvedOrganizationId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    resolvedOrganizationId
      ? operator
        .from('operator_client_subscriptions')
        .select('tier, ai_billing_mode, overflow_mode, einvoicing_mode, einvoicing_provider, einvoicing_environment, einvoicing_onboarding_model, b2brouter_account_id, einvoicing_annuaire_status, trial_tier, trial_started_at, trial_ends_at, trial_converted, preferred_tier, access_status, access_ends_at')
        .eq('source_instance', sourceInstance)
        .eq('organization_id', resolvedOrganizationId)
        .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

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
    organizationId: resolvedOrganizationId,
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
      trialStartedAt: subscription?.trial_started_at ?? null,
      preferredTier: (subscription?.preferred_tier === 'expert' ? 'expert' : 'pro') as 'pro' | 'expert',
      accessStatus: subscription?.access_status ?? null,
      accessEndsAt: subscription?.access_ends_at ?? null,
    },
  }
}

/**
 * Fait retomber un essai actif sur targetTier (setup_only côté bouton manuel et côté cron),
 * qu'il s'agisse d'une expiration manuelle déclenchée depuis le cockpit ou automatique depuis le cron.
 */
export async function expireTrialForInstance(input: {
  sourceInstance: string
  organizationId?: string
  targetTier: SubscriptionTier
  actorEmail: string | null
  eventType: 'trial_ended' | 'trial_ended_auto'
}): Promise<{ status: 'expired' | 'skipped'; syncStatus?: string; error?: string }> {
  const { sourceInstance, targetTier, actorEmail, eventType } = input
  const { operator, organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance, input.organizationId)

  if (!organizationId) {
    return { status: 'skipped', error: 'organization_id introuvable pour cette instance' }
  }

  if (!subscription.trialTier || !subscription.trialEndsAt || subscription.trialConverted) {
    return { status: 'skipped' }
  }

  const selfServiceTrial = subscription.accessStatus === 'trialing'
  const expiredAt = new Date().toISOString()
  const { error } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: sourceInstance,
      organization_id: organizationId,
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
      trial_ends_at: selfServiceTrial ? subscription.trialEndsAt : null,
      trial_converted: false,
      ...(selfServiceTrial ? {
        access_status: 'expired',
        access_ends_at: expiredAt,
      } : {}),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance,organization_id' })

  if (error) throw new Error(error.message)

  await initializeQuotasForTier(sourceInstance, organizationId, targetTier)
  const syncResult = await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    appUrl,
    targetTier,
    subscription.overflowMode,
    subscription.aiBillingMode,
    subscription.einvoicingConfig,
    selfServiceTrial ? {
      access_status: 'expired',
      effective_tier: targetTier,
      preferred_tier: subscription.preferredTier,
      trial_started_at: subscription.trialStartedAt,
      trial_ends_at: subscription.trialEndsAt,
      access_ends_at: expiredAt,
    } : undefined,
  )
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
    eventCategory: 'trial',
    eventType,
    actorEmail,
    metadata: {
      target_tier: targetTier,
      config_sync_status: syncResult.status,
    },
  })

  return { status: 'expired', syncStatus: syncResult.status, error: syncResult.error ?? undefined }
}
