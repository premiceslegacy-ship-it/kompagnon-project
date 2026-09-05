'use server'

import { revalidatePath } from 'next/cache'
import { Resend } from 'resend'
import { buildAtelierCommercialEmail } from '@/lib/email/commercial'
import { getOperatorUser } from '@/lib/operator-auth'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { createAdminClient } from '@/lib/supabase/admin'
import { ORGANIZATION_MODULE_KEYS, normalizeOrganizationModules } from '@/lib/organization-modules'
import { VERTICAL_PACKS, normalizeVerticalPackId } from '@/lib/vertical-packs'
import { activateVerticalPackForOrganization, deactivateVerticalPackForOrganization } from '@/lib/data/mutations/vertical-packs'
import {
  isOverflowMode,
  isSubscriptionTier,
  type OverflowMode,
  type SubscriptionTier,
} from '@/lib/quota-catalog'
import {
  normalizeEinvoicingConfig,
  type EinvoicingConfig,
} from '@/lib/einvoicing-config'
import {
  expireTrialForInstance,
  getEffectiveTier,
  getOperatorClientContext,
  initializeQuotasForTier,
  recordOperatorClientEvent,
  syncClientQuotaConfig,
  TRIAL_DURATION_DAYS,
  UNRESOLVED_ORGANIZATION_ID,
} from '@/lib/operator/trial-lifecycle'

/** Résout l'organization_id depuis operator_clients pour une instance, en prenant
 *  la ligne la plus récemment mise à jour. Fallback UNIQUEMENT si l'appelant n'a
 *  pas d'organizationId explicite (champ de formulaire) : sur une instance mutualisée
 *  à N organisations, ce fallback peut résoudre la mauvaise organisation. */
async function resolveOrganizationId(
  operator: ReturnType<typeof createOperatorAdminClient>,
  sourceInstance: string,
): Promise<string | null> {
  const { data } = await operator
    .from('operator_clients')
    .select('organization_id')
    .eq('source_instance', sourceInstance)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.organization_id ?? null
}

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

// oauth_status / oauth_connected_at / super_pdp_connection_id ne sont pas
// editables depuis ce formulaire (l'activation OAuth se fait cote instance
// cliente) : on les preserve tels quels plutot que de les laisser retomber
// sur leurs valeurs par defaut a chaque soumission.
function parseEinvoicingConfig(
  formData: FormData,
  current: Pick<EinvoicingConfig, 'oauth_status' | 'oauth_connected_at' | 'super_pdp_connection_id'>,
): EinvoicingConfig {
  return normalizeEinvoicingConfig({
    mode: formData.get('einvoicingMode'),
    provider: formData.get('einvoicingProvider'),
    environment: formData.get('einvoicingEnvironment'),
    annuaire_status: formData.get('einvoicingAnnuaireStatus'),
    oauth_status: current.oauth_status,
    oauth_connected_at: current.oauth_connected_at,
    super_pdp_connection_id: current.super_pdp_connection_id,
    emission_enabled: formData.get('einvoicingEmissionEnabled') === 'on',
    reception_enabled: formData.get('einvoicingReceptionEnabled') === 'on',
  })
}

function monthStartDate(): string {
  const periodStart = new Date()
  periodStart.setDate(1)
  periodStart.setHours(0, 0, 0, 0)
  return periodStart.toISOString().split('T')[0]
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
  const fromName = process.env.RESEND_FROM_NAME?.trim() || 'Atelier BTP'

  if (!apiKey || !fromAddress) {
    return { status: 'skipped' as const, error: 'RESEND_API_KEY/RESEND_FROM_ADDRESS manquant' }
  }

  const resend = new Resend(apiKey)
  const html = buildAtelierCommercialEmail({
    subject: input.subject,
    title: input.subject,
    paragraphs: input.bodyLines,
  }).html

  const { error } = await resend.emails.send({
    from: `${fromName} <${fromAddress}>`,
    to: input.to,
    subject: input.subject,
    html,
    replyTo: process.env.RESEND_REPLY_TO_ADDRESS?.trim() || 'contact@orsayn.fr',
  })

  if (error) {
    return { status: 'failed' as const, error: error.message }
  }

  return { status: 'sent' as const, error: null }
}

async function recordOperatorCommercialEvent(input: {
  sourceInstance: string
  organizationId?: string | null
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
      organization_id: input.organizationId ?? null,
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
  // organizationId explicite pour un client SaaS mutualisé déjà rattaché à une
  // organisation ; sentinelle pour le workflow historique per-client (préconfig
  // avant que l'organisation n'existe côté app cliente — voir migration 010).
  const organizationIdRaw = String(formData.get('organizationId') ?? '').trim()
  const organizationId = organizationIdRaw || UNRESOLVED_ORGANIZATION_ID

  const { error } = await operator
    .from('operator_client_settings')
    .upsert({
      source_instance: sourceInstance,
      organization_id: organizationId,
      label: labelRaw || null,
      monthly_fee_ht: parseMonthlyFee(formData.get('monthlyFeeHt')),
      billing_currency: billingCurrency,
      is_active: formData.get('isActive') === 'on',
      app_url: appUrl,
      contact_email: parseOptionalEmail(formData.get('contactEmail')),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'source_instance,organization_id',
    })

  if (error) {
    console.error('[upsertOperatorClientSettings]', error)
    throw new Error(error.message)
  }

  revalidatePath('/orsayn')
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
  const notes = String(formData.get('notes') ?? '').trim() || null
  const contactEmail = parseOptionalEmail(formData.get('contactEmail'))

  const operator = createOperatorAdminClient()
  const organizationIdFieldRaw = String(formData.get('organizationId') ?? '').trim()
  const organizationIdField = organizationIdFieldRaw === UNRESOLVED_ORGANIZATION_ID ? '' : organizationIdFieldRaw
  const organizationId = organizationIdField || await resolveOrganizationId(operator, sourceInstance)

  if (!organizationId) {
    throw new Error('organization_id introuvable pour cette instance — préconfigurez le client avec un organizationId, ou attendez son premier appel IA (ingest).')
  }

  const { data: existingSubscription } = await operator
    .from('operator_client_subscriptions')
    .select('trial_tier, trial_ends_at, trial_converted, oauth_status, oauth_connected_at, super_pdp_connection_id')
    .eq('source_instance', sourceInstance)
    .eq('organization_id', organizationId)
    .maybeSingle()

  const currentOauthFields: Pick<EinvoicingConfig, 'oauth_status' | 'oauth_connected_at' | 'super_pdp_connection_id'> = {
    oauth_status: existingSubscription?.oauth_status ?? 'not_connected',
    oauth_connected_at: existingSubscription?.oauth_connected_at ?? null,
    super_pdp_connection_id: existingSubscription?.super_pdp_connection_id ?? null,
  }
  const einvoicingConfig = parseEinvoicingConfig(formData, currentOauthFields)

  const trialTier = existingSubscription?.trial_tier && isSubscriptionTier(existingSubscription.trial_tier)
    ? existingSubscription.trial_tier
    : null
  const trialEndsAt = existingSubscription?.trial_ends_at ?? null
  const trialConverted = Boolean(existingSubscription?.trial_converted)

  const { error: settingsError } = await operator
    .from('operator_client_settings')
    .upsert({
      source_instance: sourceInstance,
      organization_id: organizationId,
      label: labelRaw || null,
      monthly_fee_ht: mrrHt,
      billing_currency: billingCurrency,
      is_active: formData.get('isActive') === 'on',
      app_url: appUrl,
      contact_email: contactEmail,
      config_sync_status: appUrl ? 'pending' : 'pending_manual',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance,organization_id' })

  if (settingsError) {
    console.error('[upsertOperatorSubscription.settings]', settingsError)
    throw new Error(settingsError.message)
  }

  const { error: subscriptionError } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: sourceInstance,
      organization_id: organizationId,
      tier,
      mrr_ht: mrrHt,
      billing_currency: billingCurrency,
      ai_billing_mode: aiBillingMode,
      is_active: formData.get('isActive') === 'on',
      renews_at: renewsAt && !Number.isNaN(renewsAt.getTime()) ? renewsAt.toISOString() : null,
      trial_tier: trialTier,
      trial_ends_at: trialEndsAt,
      trial_converted: trialConverted,
      einvoicing_mode: einvoicingConfig.mode,
      einvoicing_provider: einvoicingConfig.provider,
      einvoicing_environment: einvoicingConfig.environment,
      einvoicing_annuaire_status: einvoicingConfig.annuaire_status,
      super_pdp_emission_enabled: einvoicingConfig.emission_enabled,
      super_pdp_reception_enabled: einvoicingConfig.reception_enabled,
      overflow_mode: overflowMode,
      notes,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance,organization_id' })

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
  await initializeQuotasForTier(sourceInstance, organizationId, effectiveTier)
  const syncResult = await syncClientQuotaConfig(sourceInstance, organizationId, appUrl, effectiveTier, overflowMode, aiBillingMode, einvoicingConfig)
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
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

export async function activateOperatorTrial(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')
  const requestedOrganizationId = String(formData.get('organizationId') ?? '').trim() || undefined

  const trialDays = TRIAL_DURATION_DAYS
  const trialStartedAt = new Date().toISOString()
  const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
  const { operator, organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance, requestedOrganizationId)
  const trialTier = sourceInstance === 'atelier-app' ? 'pro' : 'expert'

  if (!organizationId) {
    throw new Error('organization_id introuvable pour cette instance — le client doit d\'abord avoir un appel IA synchronisé (ingest) ou être préconfiguré.')
  }

  const { error } = await operator
    .from('operator_client_subscriptions')
    .upsert({
      source_instance: sourceInstance,
      organization_id: organizationId,
      tier: subscription.tier,
      ai_billing_mode: subscription.aiBillingMode,
      overflow_mode: subscription.overflowMode,
      einvoicing_mode: subscription.einvoicingConfig.mode,
      einvoicing_provider: subscription.einvoicingConfig.provider,
      einvoicing_environment: subscription.einvoicingConfig.environment,
      einvoicing_annuaire_status: subscription.einvoicingConfig.annuaire_status,
      trial_tier: trialTier,
      trial_started_at: trialStartedAt,
      trial_ends_at: trialEndsAt,
      trial_converted: false,
      trial_reminders_sent: [],
      is_active: true,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'source_instance,organization_id' })

  if (error) throw new Error(error.message)

  await initializeQuotasForTier(sourceInstance, organizationId, trialTier)
  const syncResult = await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    appUrl,
    trialTier,
    subscription.overflowMode,
    subscription.aiBillingMode,
    subscription.einvoicingConfig,
  )
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
    eventCategory: 'trial',
    eventType: 'trial_started',
    actorEmail: user.email ?? null,
    metadata: {
      trial_tier: trialTier,
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
  const requestedOrganizationId = String(formData.get('organizationId') ?? '').trim() || undefined

  const targetTier = parseTier(formData.get('targetTier'))
  const { operator, organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance, requestedOrganizationId)

  if (!organizationId) {
    throw new Error('organization_id introuvable pour cette instance')
  }

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
      trial_ends_at: null,
      trial_converted: true,
      is_active: true,
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
  )
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
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
  const organizationId = String(formData.get('organizationId') ?? '').trim() || undefined

  const result = await expireTrialForInstance({
    sourceInstance,
    organizationId,
    targetTier,
    actorEmail: user.email ?? null,
    eventType: 'trial_ended',
  })

  if (result.status !== 'expired') {
    throw new Error(result.error ?? 'Aucun essai actif à terminer')
  }
  if (result.syncStatus !== 'synced') {
    throw new Error(`Essai terminé côté cockpit, mais la configuration n’a pas été renvoyée (${result.error ?? result.syncStatus ?? 'erreur inconnue'}). Relance la configuration.`)
  }

  revalidatePath('/orsayn')
}

export async function extendOperatorTrial(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('Identifiant technique requis')
  const requestedOrganizationId = String(formData.get('organizationId') ?? '').trim() || undefined
  const { operator, organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance, requestedOrganizationId)
  if (!organizationId) throw new Error('Organisation introuvable pour cette fiche')

  const baseTime = subscription.trialEndsAt && new Date(subscription.trialEndsAt).getTime() > Date.now()
    ? new Date(subscription.trialEndsAt).getTime()
    : Date.now()
  const trialEndsAt = new Date(baseTime + 7 * 24 * 60 * 60 * 1000).toISOString()
  const selfServiceTrial = subscription.accessStatus !== null
  const trialTier = subscription.trialTier ?? (sourceInstance === 'atelier-app' ? 'pro' : 'expert')
  const { error } = await operator.from('operator_client_subscriptions').upsert({
    source_instance: sourceInstance,
    organization_id: organizationId,
    tier: subscription.tier,
    ai_billing_mode: subscription.aiBillingMode,
    overflow_mode: subscription.overflowMode,
    einvoicing_mode: subscription.einvoicingConfig.mode,
    einvoicing_provider: subscription.einvoicingConfig.provider,
    einvoicing_environment: subscription.einvoicingConfig.environment,
    einvoicing_annuaire_status: subscription.einvoicingConfig.annuaire_status,
    trial_tier: trialTier,
    trial_ends_at: trialEndsAt,
    trial_converted: false,
    ...(selfServiceTrial ? { access_status: 'trialing', access_ends_at: trialEndsAt } : {}),
    trial_reminders_sent: [],
    is_active: true,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'source_instance,organization_id' })
  if (error) throw new Error(error.message)

  await initializeQuotasForTier(sourceInstance, organizationId, trialTier)
  const syncResult = await syncClientQuotaConfig(sourceInstance, organizationId, appUrl, trialTier, subscription.overflowMode, subscription.aiBillingMode, subscription.einvoicingConfig)
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
    eventCategory: 'trial',
    eventType: 'trial_extended',
    actorEmail: user.email ?? null,
    metadata: { added_days: 7, trial_ends_at: trialEndsAt, config_sync_status: syncResult.status },
  })
  if (syncResult.status !== 'synced') throw new Error(`Essai prolongé, mais la configuration n’a pas été renvoyée (${syncResult.error ?? syncResult.status}).`)
  revalidatePath('/orsayn')
}

async function updateOperatorArchiveState(formData: FormData, isArchived: boolean) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')
  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  const organizationId = String(formData.get('organizationId') ?? '').trim()
  if (!sourceInstance || !organizationId) throw new Error('Fiche client incomplète')

  const operator = createOperatorAdminClient()
  const { error } = await operator.from('operator_client_settings')
    .update({ is_active: !isArchived, updated_at: new Date().toISOString() })
    .eq('source_instance', sourceInstance)
    .eq('organization_id', organizationId)
  if (error) throw new Error(error.message)
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
    eventCategory: 'crm',
    eventType: isArchived ? 'client_archived' : 'client_restored',
    actorEmail: user.email ?? null,
  })
  revalidatePath('/orsayn')
}

export async function archiveOperatorClient(formData: FormData) {
  return updateOperatorArchiveState(formData, true)
}

export async function restoreOperatorClient(formData: FormData) {
  return updateOperatorArchiveState(formData, false)
}

export async function deleteOperatorClient(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')
  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  const organizationId = String(formData.get('organizationId') ?? '').trim()
  const confirmation = String(formData.get('confirmName') ?? '').trim()
  const expectedName = String(formData.get('expectedName') ?? '').trim()
  if (!sourceInstance || !organizationId) throw new Error('Fiche client incomplète')
  if (!expectedName || confirmation !== expectedName) throw new Error('Saisis exactement le nom du client pour confirmer')

  const operator = createOperatorAdminClient()
  // La fiche correspond aux données de configuration du cockpit. Les journaux
  // IA bruts restent conservés pour l'historique et ne sont plus rattachés à
  // une fiche visible une fois ces lignes supprimées.
  const deletes = [
    operator.from('operator_client_quotas').delete().eq('source_instance', sourceInstance).eq('organization_id', organizationId),
    operator.from('operator_client_subscriptions').delete().eq('source_instance', sourceInstance).eq('organization_id', organizationId),
    operator.from('operator_client_settings').delete().eq('source_instance', sourceInstance).eq('organization_id', organizationId),
  ]
  for (const request of deletes) {
    const { error } = await request
    if (error) throw new Error(error.message)
  }
  // Suppression strictement limitée aux données du cockpit opérateur. Aucun appel
  // n'est effectué vers le Supabase ou le Worker de l'artisan.
  console.info('[deleteOperatorClient]', { sourceInstance, organizationId, actor: user.email })
  revalidatePath('/orsayn')
  revalidatePath('/orsayn/clients')
}

export async function resyncOperatorClientConfig(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')
  const requestedOrganizationId = String(formData.get('organizationId') ?? '').trim() || undefined

  const { organizationId, appUrl, subscription } = await getOperatorClientContext(sourceInstance, requestedOrganizationId)
  const effectiveTier = getEffectiveTier({
    tier: subscription.tier,
    trial_tier: subscription.trialTier,
    trial_ends_at: subscription.trialEndsAt,
    trial_converted: subscription.trialConverted,
  })

  if (!organizationId) {
    throw new Error('organization_id introuvable pour cette instance')
  }

  await initializeQuotasForTier(sourceInstance, organizationId, effectiveTier)
  const syncResult = await syncClientQuotaConfig(
    sourceInstance,
    organizationId,
    appUrl,
    effectiveTier,
    subscription.overflowMode,
    subscription.aiBillingMode,
    subscription.einvoicingConfig,
  )
  await recordOperatorClientEvent({
    sourceInstance,
    organizationId,
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

  const operator = createOperatorAdminClient()
  const organizationId = await resolveOrganizationId(operator, sourceInstance)

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
    organizationId,
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
    organizationId,
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

// ── Module emails cockpit ──────────────────────────────────────────────────────

export async function sendOperatorEmail(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const subject = String(formData.get('subject') ?? '').trim()
  const bodyText = String(formData.get('bodyText') ?? '').trim()
  const recipientEmailsRaw = String(formData.get('recipientEmails') ?? '').trim()

  if (!subject) throw new Error('Sujet requis')
  if (!bodyText) throw new Error('Corps du message requis')

  const recipientEmails = recipientEmailsRaw
    .split(/[\n,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))

  if (recipientEmails.length === 0) throw new Error('Au moins un email destinataire valide requis')

  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromAddress = process.env.RESEND_FROM_ADDRESS?.trim()
  const fromName = process.env.RESEND_FROM_NAME?.trim() || 'Atelier BTP'
  if (!apiKey || !fromAddress) throw new Error('RESEND non configuré dans le cockpit')

  const resend = new Resend(apiKey)
  const bodyLines = bodyText.split('\n').filter(Boolean)
  const html = buildAtelierCommercialEmail({ subject, title: subject, paragraphs: bodyLines }).html

  const operator = createOperatorAdminClient()
  let sent = 0
  let failed = 0

  // Un envoi individuel par destinataire — chaque mail est "personnel"
  for (const to of recipientEmails) {
    const { error } = await resend.emails.send({
      from: `${fromName} <${fromAddress}>`,
      to,
      subject,
      html,
      replyTo: process.env.RESEND_REPLY_TO_ADDRESS?.trim() || 'contact@orsayn.fr',
    })
    const deliveryStatus = error ? 'failed' : 'sent'
    if (error) failed++
    else sent++

    await operator.from('operator_commercial_events').insert({
      source_instance: String(formData.get('sourceInstance') ?? '').trim() || 'cockpit-broadcast',
      organization_id: String(formData.get('organizationId') ?? '').trim() || null,
      event_type: 'manual_email',
      tier_context: String(formData.get('tierContext') ?? '').trim() || null,
      sent_by: 'operator_manual',
      actor_email: user.email ?? null,
      delivery_status: deliveryStatus,
      email_template: 'manual_free',
      subject_preview: subject,
      body_text: bodyText,
      recipient_email: to,
      notes: String(formData.get('notes') ?? '').trim() || null,
      metadata: { delivery_error: error?.message ?? null },
    })
  }

  revalidatePath('/orsayn')
  if (failed > 0 && sent === 0) throw new Error(`Tous les envois ont échoué (${failed})`)
}

export async function validateQuotaAlert(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const alertId = String(formData.get('alertId') ?? '').trim()
  const action = String(formData.get('action') ?? '').trim() // 'send' | 'ignore' | 'update_body'
  if (!alertId) throw new Error('alertId requis')

  const operator = createOperatorAdminClient()
  const { data: alert } = await operator
    .from('operator_commercial_events')
    .select('id, source_instance, subject_preview, body_text, metadata')
    .eq('id', alertId)
    .eq('delivery_status', 'pending_review')
    .maybeSingle()

  if (!alert) throw new Error('Alerte introuvable ou déjà traitée')

  if (action === 'ignore') {
    await operator
      .from('operator_commercial_events')
      .update({ delivery_status: 'ignored', actor_email: user.email ?? null })
      .eq('id', alertId)
    revalidatePath('/orsayn')
    return
  }

  if (action === 'update_body') {
    const newBody = String(formData.get('bodyText') ?? '').trim()
    const newSubject = String(formData.get('subject') ?? '').trim()
    const recipientEmail = String(formData.get('recipientEmail') ?? '').trim().toLowerCase() || null
    await operator
      .from('operator_commercial_events')
      .update({
        body_text: newBody || alert.body_text,
        subject_preview: newSubject || alert.subject_preview,
        recipient_email: recipientEmail,
        actor_email: user.email ?? null,
      })
      .eq('id', alertId)
    revalidatePath('/orsayn')
    return
  }

  // action === 'send'
  const recipientEmail = String(formData.get('recipientEmail') ?? '').trim().toLowerCase()
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    throw new Error('Email destinataire invalide')
  }

  const subject = alert.subject_preview ?? 'Message Orsayn'
  const bodyLines = (alert.body_text ?? '').split('\n').filter(Boolean)
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const fromAddress = process.env.RESEND_FROM_ADDRESS?.trim()
  const fromName = process.env.RESEND_FROM_NAME?.trim() || 'Atelier BTP'

  let deliveryStatus: 'sent' | 'failed' | 'skipped' = 'skipped'
  let deliveryError: string | null = null

  if (apiKey && fromAddress) {
    const resend = new Resend(apiKey)
    const html = buildAtelierCommercialEmail({ subject, title: subject, paragraphs: bodyLines }).html
    const { error } = await resend.emails.send({
      from: `${fromName} <${fromAddress}>`,
      to: recipientEmail,
      subject,
      html,
      replyTo: process.env.RESEND_REPLY_TO_ADDRESS?.trim() || 'contact@orsayn.fr',
    })
    deliveryStatus = error ? 'failed' : 'sent'
    deliveryError = error?.message ?? null
  }

  const meta = (alert.metadata ?? {}) as Record<string, unknown>
  await operator
    .from('operator_commercial_events')
    .update({
      delivery_status: deliveryStatus,
      recipient_email: recipientEmail,
      actor_email: user.email ?? null,
      auto_send_after: null,
      metadata: { ...meta, delivery_error: deliveryError, validated_by: user.email },
    })
    .eq('id', alertId)

  revalidatePath('/orsayn')
  if (deliveryStatus === 'failed') throw new Error(deliveryError ?? 'Envoi échoué')
}

export async function upsertOperatorClientModules(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')
  const requestedOrganizationId = String(formData.get('organizationId') ?? '').trim() || undefined

  const operator = createOperatorAdminClient()
  const orgId = requestedOrganizationId ?? await resolveOrganizationId(operator, sourceInstance)

  if (!orgId) {
    throw new Error('Client introuvable ou organization_id manquant')
  }

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
    organizationId: orgId,
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

export async function upsertOperatorClientVerticalPack(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')
  const requestedOrganizationId = String(formData.get('organizationId') ?? '').trim() || undefined

  const operator = createOperatorAdminClient()
  const orgId = requestedOrganizationId ?? await resolveOrganizationId(operator, sourceInstance)

  if (!orgId) {
    throw new Error('Client introuvable ou organization_id manquant')
  }

  const rawPackId = String(formData.get('vertical_pack_id') ?? '').trim()
  const packId = normalizeVerticalPackId(rawPackId)

  if (rawPackId && !packId) throw new Error('Pack verticale inconnu')

  const result = packId
    ? await activateVerticalPackForOrganization({ organizationId: orgId, packId, actorUserId: user.id })
    : await deactivateVerticalPackForOrganization({ organizationId: orgId })

  if (result.error) {
    console.error('[upsertOperatorClientVerticalPack]', result.error)
    throw new Error(result.error)
  }

  await recordOperatorClientEvent({
    sourceInstance,
    organizationId: orgId,
    eventCategory: 'vertical_pack',
    eventType: packId ? 'vertical_pack_activated' : 'vertical_pack_deactivated',
    actorEmail: user.email ?? null,
    metadata: { pack_id: packId ?? null },
  })

  revalidatePath('/orsayn')
}

/**
 * Active/désactive has_metal_pricing pour un client — geste manuel volontaire.
 * Pas d'activation automatique : la clé METALPRICEAPI_KEY reste posée à la
 * main par Samuel, client par client, donc l'activation du flag doit rester
 * sous son contrôle explicite plutôt que suivre le tier ou l'activité déclarée.
 */
export async function upsertOperatorClientMetalPricing(formData: FormData) {
  const user = await getOperatorUser()
  if (!user) throw new Error('Accès opérateur requis')

  const sourceInstance = String(formData.get('sourceInstance') ?? '').trim()
  if (!sourceInstance) throw new Error('source_instance requis')
  const requestedOrganizationId = String(formData.get('organizationId') ?? '').trim() || undefined

  const operator = createOperatorAdminClient()
  const orgId = requestedOrganizationId ?? await resolveOrganizationId(operator, sourceInstance)

  if (!orgId) {
    throw new Error('Client introuvable ou organization_id manquant')
  }

  const hasMetalPricing = formData.get('hasMetalPricing') === 'on'

  const admin = createAdminClient()
  const { error } = await admin
    .from('organizations')
    .update({ has_metal_pricing: hasMetalPricing })
    .eq('id', orgId)

  if (error) {
    console.error('[upsertOperatorClientMetalPricing]', error)
    throw new Error(error.message)
  }

  await recordOperatorClientEvent({
    sourceInstance,
    organizationId: orgId,
    eventCategory: 'module',
    eventType: hasMetalPricing ? 'metal_pricing_activated' : 'metal_pricing_deactivated',
    actorEmail: user.email ?? null,
    metadata: { has_metal_pricing: hasMetalPricing, manual: true },
  })

  revalidatePath('/orsayn')
}
