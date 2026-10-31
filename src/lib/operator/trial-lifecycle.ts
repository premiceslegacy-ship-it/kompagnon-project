import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { getOperatorSigningSecret, signOperatorRequest, OPERATOR_TIMESTAMP_HEADER } from '@/lib/operator'
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
import { getSetupEntitlement, type EntitlementSyncPayload } from '@/lib/subscription-access'
import { TRIAL_DURATION_DAYS, TRIAL_TIER } from '@/lib/subscription-terms'

const AI_BILLING_MODES = new Set(['orsayn_shared', 'client_owned'])
export type AIBillingMode = 'orsayn_shared' | 'client_owned'

export type TrialState = {
  tier: SubscriptionTier
  trial_tier: SubscriptionTier | null
  trial_ends_at: string | null
  trial_converted?: boolean | null
}

// Source unique : src/lib/subscription-terms.ts (le seul essai gratuit : Pro, 7 jours).
export { TRIAL_TIER, TRIAL_DURATION_DAYS }
const _trialTierIsSellable: SubscriptionTier = TRIAL_TIER
void _trialTierIsSellable

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

  const secret = getOperatorSigningSecret(sourceInstance)
  if (!secret) {
    const errorMessage = 'OPERATOR_MASTER_SECRET/OPERATOR_CONFIG_SYNC_SECRET manquant'
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

  // Relire l'autorité juste avant l'envoi : un appel déjà préparé pour un
  // abonnement ne doit pas reprendre son payeur ou son état après l'achat setup.
  const { data: current, error: currentError } = await operator
    .from('operator_client_subscriptions')
    .select('billing_model, access_status, entitlement_revision, einvoicing_mode, einvoicing_provider, einvoicing_environment, einvoicing_annuaire_status, oauth_status, oauth_connected_at, super_pdp_connection_id, super_pdp_emission_enabled, super_pdp_reception_enabled')
    .eq('source_instance', sourceInstance)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (currentError || (current?.billing_model === 'setup' && (
    !Number.isSafeInteger(current.entitlement_revision) || current.entitlement_revision < 0
    || !['active', 'locked'].includes(current.access_status)
  ))) {
    const errorMessage = 'État commercial autoritaire impossible à vérifier'
    await operator.from('operator_client_settings').update({
      config_sync_status: 'failed', config_sync_error: errorMessage, updated_at: new Date().toISOString(),
    }).eq('source_instance', sourceInstance).eq('organization_id', organizationId)
    return { status: 'failed', error: errorMessage }
  }
  if (current?.billing_model === 'setup') {
    tier = 'setup_only'
    aiBillingMode = 'client_owned'
    overflowMode = 'block'
    entitlement = getSetupEntitlement(current.access_status === 'active', current.entitlement_revision)
    einvoicingConfig = normalizeEinvoicingConfigFromDb({
      mode: current.einvoicing_mode,
      provider: current.einvoicing_provider,
      environment: current.einvoicing_environment,
      annuaire_status: current.einvoicing_annuaire_status,
      oauth_status: current.oauth_status,
      oauth_connected_at: current.oauth_connected_at,
      super_pdp_connection_id: current.super_pdp_connection_id,
      emission_enabled: current.super_pdp_emission_enabled,
      reception_enabled: current.super_pdp_reception_enabled,
    })
  }
  const syncedTier = aiBillingMode === 'client_owned' ? 'expert' : tier
  const modules = getModulesForTier(syncedTier)
  const quotaConfig = getQuotaConfigForTier(syncedTier)

  if (aiBillingMode === 'client_owned') {
    // Le vocal live Sarah tourne toujours sur l'agent ElevenLabs centralisé Orsayn,
    // jamais sur une clé fournie par le client : le coût (~0,10-0,12€/min) reste à la
    // charge d'Orsayn quel que soit ai_billing_mode. Ne jamais l'ouvrir automatiquement
    // ici — seul un add-on vocal configuré explicitement dans le cockpit doit l'activer.
    modules.voice_live = false
    quotaConfig.voice_live_minutes = 0
  }

  const body = JSON.stringify({
    source_instance: sourceInstance,
    organization_id: organizationId,
    modules,
    quota_config: quotaConfig,
    overflow_mode: overflowMode,
    ai_billing_mode: aiBillingMode,
    einvoicing_config: einvoicingConfig,
    ...(entitlement ? { entitlement } : {}),
  })
  const { signature, timestamp } = signOperatorRequest(body, secret)

  try {
    const response = await fetch(`${appUrl.replace(/\/$/, '')}/api/operator/config-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-operator-signature': signature,
        [OPERATOR_TIMESTAMP_HEADER]: timestamp,
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
 * Charge un contexte identifié par la clé complète (source_instance, organization_id).
 * Une instance mutualisée ne permet jamais de déduire l'organisation d'un appel.
 */
export async function getOperatorClientContext(sourceInstance: string, organizationId: string | undefined) {
  if (!organizationId || organizationId === UNRESOLVED_ORGANIZATION_ID) {
    throw new TypeError('organization_id explicite requis pour cette opération opérateur.')
  }
  const operator = createOperatorAdminClient()

  const [settingResult, subscriptionResult] = await Promise.all([
    operator
      .from('operator_client_settings')
      .select('app_url')
      .eq('source_instance', sourceInstance)
      .eq('organization_id', organizationId)
      .maybeSingle(),
    operator
      .from('operator_client_subscriptions')
      .select('billing_model, tier, ai_billing_mode, overflow_mode, einvoicing_mode, einvoicing_provider, einvoicing_environment, einvoicing_annuaire_status, oauth_status, oauth_connected_at, super_pdp_connection_id, super_pdp_emission_enabled, super_pdp_reception_enabled, trial_tier, trial_started_at, trial_ends_at, trial_converted, preferred_tier, access_status, access_ends_at')
      .eq('source_instance', sourceInstance)
      .eq('organization_id', organizationId)
      .maybeSingle(),
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
    annuaire_status: subscription?.einvoicing_annuaire_status ?? DEFAULT_EINVOICING_CONFIG.annuaire_status,
    oauth_status: subscription?.oauth_status ?? DEFAULT_EINVOICING_CONFIG.oauth_status,
    oauth_connected_at: subscription?.oauth_connected_at ?? null,
    super_pdp_connection_id: subscription?.super_pdp_connection_id ?? null,
    emission_enabled: subscription?.super_pdp_emission_enabled ?? false,
    reception_enabled: subscription?.super_pdp_reception_enabled ?? false,
  })

  return {
    operator,
    organizationId,
    appUrl: settingResult.data?.app_url ?? null,
    subscription: {
      billingModel: subscription?.billing_model === 'setup' ? 'setup' as const : 'subscription' as const,
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

  if (subscription.billingModel === 'setup' || !subscription.trialTier || !subscription.trialEndsAt || subscription.trialConverted) {
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
      einvoicing_annuaire_status: subscription.einvoicingConfig.annuaire_status,
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
      billing_model: 'subscription',
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
