import { notFound } from 'next/navigation'
import {
  activateOperatorTrial,
  convertOperatorTrial,
  expireOperatorTrial,
  recordOperatorCommercialAction,
  resyncOperatorClientConfig,
  upsertOperatorClientSettings,
  upsertOperatorClientModules,
  upsertOperatorClientVerticalPack,
  upsertOperatorSubscription,
} from './actions'
import EmailsTab from './EmailsTab'
import { getOperatorUsdToEurRate } from '@/lib/operator'
import { getOperatorUser } from '@/lib/operator-auth'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { createAdminClient } from '@/lib/supabase/admin'
import { ORGANIZATION_MODULE_KEYS, normalizeOrganizationModules, type OrganizationModules } from '@/lib/organization-modules'
import { VERTICAL_PACKS, getEligibleVerticalPack } from '@/lib/vertical-packs'
import {
  QUOTA_DEFINITIONS,
  SUBSCRIPTION_TIERS,
  OVERFLOW_MODES,
  type OverflowMode,
  type QuotaFeature,
  type QuotaUnit,
  type SubscriptionTier,
} from '@/lib/quota-catalog'
import {
  DEFAULT_EINVOICING_CONFIG,
  EINVOICING_ANNUAIRE_STATUSES,
  EINVOICING_ENVIRONMENTS,
  EINVOICING_MODES,
  EINVOICING_ONBOARDING_MODELS,
  normalizeEinvoicingConfigFromDb,
  type EinvoicingAnnuaireStatus,
  type EinvoicingConfig,
  type EinvoicingEnvironment,
  type EinvoicingMode,
  type EinvoicingOnboardingModel,
  type EinvoicingProvider,
} from '@/lib/einvoicing-config'

const AI_BILLING_MODES = ['orsayn_shared', 'client_owned'] as const
type AIBillingMode = typeof AI_BILLING_MODES[number]

type OperatorUsageEvent = {
  source_instance: string
  provider: string
  feature: string
  quota_feature: QuotaFeature | null
  model: string
  provider_cost: number | null
  currency: string
  total_tokens: number | null
  status: string
  occurred_at: string
}

type OperatorClient = {
  source_instance: string
  organization_id: string | null
  label: string | null
  updated_at: string
}

type OperatorClientSetting = {
  source_instance: string
  label: string | null
  monthly_fee_ht: number | string | null
  billing_currency: 'EUR' | 'USD'
  is_active: boolean
  app_url: string | null
  config_sync_status: string | null
  config_synced_at: string | null
  config_sync_error: string | null
}

type OperatorClientSubscription = {
  source_instance: string
  tier: SubscriptionTier
  ai_billing_mode: AIBillingMode | null
  mrr_ht: number | string | null
  billing_currency: 'EUR' | 'USD'
  is_active: boolean
  renews_at: string | null
  trial_tier: SubscriptionTier | null
  trial_ends_at: string | null
  trial_converted: boolean | null
  b2brouter_active: boolean
  einvoicing_mode: EinvoicingMode | null
  einvoicing_provider: EinvoicingProvider | null
  einvoicing_environment: EinvoicingEnvironment | null
  einvoicing_onboarding_model: EinvoicingOnboardingModel | null
  b2brouter_account_id: string | null
  einvoicing_annuaire_status: EinvoicingAnnuaireStatus | null
  overflow_mode: OverflowMode
  notes: string | null
}

type OperatorClientEvent = {
  id: string
  source_instance: string
  event_category: string
  event_type: string
  actor_email: string | null
  metadata: Record<string, unknown> | null
  notes: string | null
  created_at: string
}

type OperatorCommercialEvent = {
  id: string
  source_instance: string
  event_type: string
  tier_context: string | null
  sent_at: string
  sent_by: string
  actor_email: string | null
  email_template: string | null
  subject_preview: string | null
  body_text: string | null
  recipient_email: string | null
  delivery_status: string
  auto_send_after: string | null
  notes: string | null
  metadata: Record<string, unknown> | null
}

type OperatorClientQuota = {
  source_instance: string
  quota_feature: QuotaFeature
  quota_unit: QuotaUnit
  quota_monthly: number | string
  current_quantity: number | string
  current_cost_eur: number | string
  period_start: string
}

type ClientRow = {
  sourceInstance: string
  organizationId: string | null
  label: string
  tier: SubscriptionTier
  appUrl: string | null
  configSyncStatus: string | null
  configSyncError: string | null
  monthlyFee: number | null
  billingCurrency: 'EUR' | 'USD'
  aiBillingMode: AIBillingMode
  isActive: boolean
  renewsAt: string | null
  trialEndsAt: string | null
  trialConverted: boolean
  b2brouterActive: boolean
  einvoicingConfig: EinvoicingConfig
  overflowMode: OverflowMode
  notes: string | null
  monthCost: number
  monthCostEur: number
  monthUsageCost: number
  monthUsageCostEur: number
  grossMargin: number | null
  grossMarginEur: number | null
  marginPct: number | null
  lastSeenAt: string | null
  lastStatus: string | null
  monthEventCount: number
  modules: OrganizationModules
  businessActivityId: string | null
  businessVerticalPackId: string | null
  quotas: OperatorClientQuota[]
  events: OperatorClientEvent[]
  commercialEvents: OperatorCommercialEvent[]
}

type UsageAggregateRow = {
  key: string
  label: string
  events: number
  tokens: number
  usageCostEur: number
  orsaynCostEur: number
}

type CommercialRecommendation = {
  id: string
  sourceInstance: string
  clientLabel: string
  title: string
  reason: string
  severity: 'high' | 'medium' | 'low'
  eventType: 'upgrade_prompt_quota' | 'usage_signal_client_owned'
  currentTier: SubscriptionTier
  suggestedTier: SubscriptionTier
  usageCostLabel: string
  notePlaceholder: string
}

const GLOBAL_CURRENCY = 'EUR'

function formatMoney(value: number, currency: 'EUR' | 'USD' = GLOBAL_CURRENCY): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatPercent(value: number | null): string {
  if (value === null) return 'À compléter'
  return new Intl.NumberFormat('fr-FR', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(value / 100)
}

function formatDate(value: string | null): string {
  if (!value) return 'Jamais'

  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function formatDateInput(value: string | null): string {
  if (!value) return ''
  return value.slice(0, 10)
}

function isActiveTrial(value: string | null): boolean {
  return !!value && new Date(value).getTime() > Date.now()
}

function getTrialLabel(value: string | null, converted: boolean): string {
  if (converted) return 'Converti'
  if (!value) return 'Aucun essai'

  const endsAt = new Date(value)
  const daysLeft = Math.ceil((endsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (daysLeft < 0) return 'Essai expiré'
  if (daysLeft === 0) return 'Expire aujourd’hui'
  return `J-${daysLeft}`
}

function getEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    subscription_updated: 'Offre appliquée',
    trial_started: 'Essai activé',
    trial_converted: 'Essai converti',
    trial_ended: 'Essai terminé',
    config_resync_requested: 'Config resynchronisée',
    modules_updated: 'Modules appliqués',
  }

  return labels[eventType] ?? eventType
}

function getCommercialEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    upgrade_prompt_quota: 'Upgrade quota',
    manual_email: 'Email manuel',
    trial_expiry_7d: 'Relance essai J-7',
    trial_expiry_2d: 'Relance essai J-2',
    trial_expired: 'Essai expiré',
    subscription_activated: 'Abonnement activé',
  }

  return labels[eventType] ?? eventType
}

function getSuggestedTier(tier: SubscriptionTier): SubscriptionTier {
  if (tier === 'setup_only') return 'starter'
  if (tier === 'starter') return 'pro'
  if (tier === 'pro') return 'expert'
  return 'expert'
}

function getRecommendationClass(severity: CommercialRecommendation['severity']): string {
  if (severity === 'high') return 'bg-red-500/10 text-red-700'
  if (severity === 'medium') return 'bg-amber-500/10 text-amber-700'
  return 'bg-slate-500/10 text-slate-700 dark:text-slate-200'
}

function normalizeFee(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeAIBillingMode(value: unknown): AIBillingMode {
  return (AI_BILLING_MODES as readonly unknown[]).includes(value) ? value as AIBillingMode : 'orsayn_shared'
}

function formatAIBillingMode(value: AIBillingMode): string {
  return value === 'client_owned' ? 'Clé client' : 'Clé Orsayn'
}

function formatCommercialStatus(row: Pick<ClientRow, 'tier' | 'aiBillingMode'>): string {
  if (row.aiBillingMode === 'client_owned') return 'BYOK - clé client'
  return `Stripe ${row.tier}`
}

function formatQuotaValue(value: number): string {
  if (value < 0) return 'Illimité'
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
}

function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat('fr-FR', {
    notation: value >= 10000 ? 'compact' : 'standard',
    maximumFractionDigits: 1,
  }).format(value)
}

function getUsageFeatureLabel(event: OperatorUsageEvent): string {
  if (event.quota_feature && QUOTA_DEFINITIONS[event.quota_feature]) {
    return QUOTA_DEFINITIONS[event.quota_feature].label
  }

  return event.feature
}

function getQuotaBadgeClass(quota: OperatorClientQuota): string {
  const monthly = normalizeNumber(quota.quota_monthly)
  const current = normalizeNumber(quota.current_quantity)
  if (monthly < 0) return 'bg-slate-500/10 text-slate-600'
  if (monthly === 0 && current > 0) return 'bg-red-500/10 text-red-600'
  const pct = monthly > 0 ? (current / monthly) * 100 : 0
  if (current > monthly) return 'bg-red-500/10 text-red-600'
  if (pct >= 90) return 'bg-orange-500/10 text-orange-700'
  if (pct >= 70) return 'bg-amber-500/10 text-amber-700'
  return 'bg-green-500/10 text-green-700'
}

function convertUsdToCurrency(value: number, currency: 'EUR' | 'USD', usdToEurRate: number): number {
  if (currency === 'USD') return value
  return value * usdToEurRate
}

function convertAmountToEur(value: number, currency: 'EUR' | 'USD', usdToEurRate: number): number {
  if (currency === 'EUR') return value
  return value * usdToEurRate
}

function convertProviderCostToEur(value: number | null, currency: string, usdToEurRate: number): number {
  const amount = Number(value ?? 0)
  if (!Number.isFinite(amount)) return 0
  if (currency.toUpperCase() === 'EUR') return amount
  if (currency.toUpperCase() === 'USD') return amount * usdToEurRate
  return amount
}

function getSyncBadge(lastSeenAt: string | null, lastStatus: string | null) {
  if (!lastSeenAt) {
    return {
      label: 'Jamais synchronisé',
      className: 'bg-slate-500/10 text-slate-600',
    }
  }

  const ageMs = Date.now() - new Date(lastSeenAt).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  if (lastStatus === 'error' && ageDays <= 2) {
    return {
      label: 'Erreurs récentes',
      className: 'bg-red-500/10 text-red-600',
    }
  }

  if (ageDays > 7) {
    return {
      label: 'Silencieux',
      className: 'bg-amber-500/10 text-amber-700',
    }
  }

  return {
    label: 'Actif',
    className: 'bg-green-500/10 text-green-700',
  }
}

function getEinvoicingBadge(config: EinvoicingConfig) {
  if (config.mode === 'b2brouter') {
    return {
      label: `B2Brouter ${config.environment}`,
      className: 'bg-green-500/10 text-green-700',
    }
  }

  if (config.mode === 'export_only') {
    return {
      label: 'Factur-X prêt',
      className: 'bg-amber-500/10 text-amber-700',
    }
  }

  return {
    label: 'Non configuré',
    className: 'bg-slate-500/10 text-slate-600',
  }
}

export default async function OrsaynPage() {
  const user = await getOperatorUser()
  if (!user) notFound()

  const operator = createOperatorAdminClient()
  const usdToEurRate = getOperatorUsdToEurRate()
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthStartIso = monthStart.toISOString()

  const [
    settingsResult,
    subscriptionsResult,
    quotasResult,
    clientsResult,
    monthlyEventsResult,
    recentEventsResult,
    operatorEventsResult,
    commercialEventsResult,
  ] = await Promise.all([
    operator
      .from('operator_client_settings')
      .select('source_instance, label, monthly_fee_ht, billing_currency, is_active, app_url, config_sync_status, config_synced_at, config_sync_error')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_client_subscriptions')
      .select('source_instance, tier, ai_billing_mode, mrr_ht, billing_currency, is_active, renews_at, trial_tier, trial_ends_at, trial_converted, b2brouter_active, einvoicing_mode, einvoicing_provider, einvoicing_environment, einvoicing_onboarding_model, b2brouter_account_id, einvoicing_annuaire_status, overflow_mode, notes')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_client_quotas')
      .select('source_instance, quota_feature, quota_unit, quota_monthly, current_quantity, current_cost_eur, period_start')
      .eq('period_start', monthStartIso.slice(0, 10))
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_clients')
      .select('source_instance, organization_id, label, updated_at')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_usage_events')
      .select('source_instance, provider, feature, quota_feature, model, provider_cost, currency, total_tokens, status, occurred_at')
      .gte('occurred_at', monthStartIso)
      .order('occurred_at', { ascending: false })
      .limit(5000),
    operator
      .from('operator_usage_events')
      .select('source_instance, provider, feature, quota_feature, model, provider_cost, currency, total_tokens, status, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(200),
    operator
      .from('operator_client_events')
      .select('id, source_instance, event_category, event_type, actor_email, metadata, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(300),
    operator
      .from('operator_commercial_events')
      .select('id, source_instance, event_type, tier_context, sent_at, sent_by, actor_email, email_template, subject_preview, body_text, recipient_email, delivery_status, auto_send_after, notes, metadata')
      .order('sent_at', { ascending: false })
      .limit(300),
  ])

  if (settingsResult.error || subscriptionsResult.error || quotasResult.error || clientsResult.error || monthlyEventsResult.error || recentEventsResult.error || operatorEventsResult.error || commercialEventsResult.error) {
    console.error('[orsayn.page]', {
      settings: settingsResult.error,
      subscriptions: subscriptionsResult.error,
      quotas: quotasResult.error,
      clients: clientsResult.error,
      monthlyEvents: monthlyEventsResult.error,
      recentEvents: recentEventsResult.error,
      operatorEvents: operatorEventsResult.error,
      commercialEvents: commercialEventsResult.error,
    })
    notFound()
  }

  const settings = (settingsResult.data ?? []) as OperatorClientSetting[]
  const subscriptions = (subscriptionsResult.data ?? []) as OperatorClientSubscription[]
  const quotas = (quotasResult.data ?? []) as OperatorClientQuota[]
  const clients = (clientsResult.data ?? []) as OperatorClient[]
  const monthlyEvents = (monthlyEventsResult.data ?? []) as OperatorUsageEvent[]
  const recentEvents = (recentEventsResult.data ?? []) as OperatorUsageEvent[]
  const operatorEvents = (operatorEventsResult.data ?? []) as OperatorClientEvent[]
  const commercialEvents = (commercialEventsResult.data ?? []) as OperatorCommercialEvent[]

  const settingsBySource = new Map(settings.map((item) => [item.source_instance, item]))
  const subscriptionsBySource = new Map(subscriptions.map((item) => [item.source_instance, item]))
  const clientsBySource = new Map(clients.map((item) => [item.source_instance, item]))
  const quotasBySource = quotas.reduce<Record<string, OperatorClientQuota[]>>((acc, quota) => {
    acc[quota.source_instance] ??= []
    acc[quota.source_instance].push(quota)
    return acc
  }, {})
  const operatorEventsBySource = operatorEvents.reduce<Record<string, OperatorClientEvent[]>>((acc, event) => {
    acc[event.source_instance] ??= []
    acc[event.source_instance].push(event)
    return acc
  }, {})
  const commercialEventsBySource = commercialEvents.reduce<Record<string, OperatorCommercialEvent[]>>((acc, event) => {
    acc[event.source_instance] ??= []
    acc[event.source_instance].push(event)
    return acc
  }, {})

  // Charger les modules pour tous les clients ayant un organization_id
  const orgIds = clients.map((c) => c.organization_id).filter((id): id is string => !!id)
  const admin = createAdminClient()
  const { data: modulesRows } = orgIds.length > 0
    ? await admin.from('organization_modules').select('organization_id, modules').in('organization_id', orgIds)
    : { data: [] }
  const modulesByOrgId = new Map((modulesRows ?? []).map((r) => [r.organization_id, r.modules]))
  const modulesBySource = new Map(
    clients
      .filter((c) => c.organization_id)
      .map((c) => [
        c.source_instance,
        normalizeOrganizationModules(modulesByOrgId.get(c.organization_id!) ?? {}),
      ])
  )

  // Charger l'activité + pack verticale pour tous les clients ayant un organization_id
  const { data: verticalPackRows } = orgIds.length > 0
    ? await admin.from('organizations').select('id, business_activity_id, business_vertical_pack').in('id', orgIds)
    : { data: [] }
  const verticalPackByOrgId = new Map(
    (verticalPackRows ?? []).map((r) => [r.id, { activityId: r.business_activity_id, packId: r.business_vertical_pack }])
  )
  const verticalPackBySource = new Map(
    clients
      .filter((c) => c.organization_id)
      .map((c) => [c.source_instance, verticalPackByOrgId.get(c.organization_id!) ?? { activityId: null, packId: null }])
  )
  const latestEventBySource = new Map<string, OperatorUsageEvent>()

  for (const event of recentEvents) {
    if (!latestEventBySource.has(event.source_instance)) {
      latestEventBySource.set(event.source_instance, event)
    }
  }

  const monthlyEventsBySource = monthlyEvents.reduce<Record<string, OperatorUsageEvent[]>>((acc, event) => {
    acc[event.source_instance] ??= []
    acc[event.source_instance].push(event)
    return acc
  }, {})

  const sourceInstances = new Set<string>([
    ...settings.map((item) => item.source_instance),
    ...subscriptions.map((item) => item.source_instance),
    ...quotas.map((item) => item.source_instance),
    ...clients.map((item) => item.source_instance),
    ...monthlyEvents.map((item) => item.source_instance),
    ...operatorEvents.map((item) => item.source_instance),
    ...commercialEvents.map((item) => item.source_instance),
  ])

  const clientRows = Array.from(sourceInstances).map((sourceInstance) => {
    const setting = settingsBySource.get(sourceInstance)
    const subscription = subscriptionsBySource.get(sourceInstance)
    const client = clientsBySource.get(sourceInstance)
    const monthEvents = monthlyEventsBySource[sourceInstance] ?? []
    const successfulMonthEvents = monthEvents.filter((event) => event.status === 'success')
    const monthCostUsd = successfulMonthEvents.reduce((sum, event) => sum + Number(event.provider_cost ?? 0), 0)
    const billingCurrency = (subscription?.billing_currency ?? setting?.billing_currency ?? 'EUR') as 'EUR' | 'USD'
    const aiBillingMode = normalizeAIBillingMode(subscription?.ai_billing_mode)
    const monthlyFee = normalizeFee(subscription?.mrr_ht ?? setting?.monthly_fee_ht)
    const monthUsageCost = convertUsdToCurrency(monthCostUsd, billingCurrency, usdToEurRate)
    const monthUsageCostEur = convertUsdToCurrency(monthCostUsd, 'EUR', usdToEurRate)
    const monthCost = aiBillingMode === 'client_owned' ? 0 : monthUsageCost
    const monthCostEur = aiBillingMode === 'client_owned' ? 0 : monthUsageCostEur
    const grossMargin = monthlyFee === null ? null : monthlyFee - monthCost
    const grossMarginEur = grossMargin === null ? null : convertAmountToEur(grossMargin, billingCurrency, usdToEurRate)
    const marginPct = monthlyFee && monthlyFee > 0 && grossMargin !== null
      ? (grossMargin / monthlyFee) * 100
      : null
    const latestEvent = latestEventBySource.get(sourceInstance)
    const label = setting?.label?.trim()
      || client?.label?.trim()
      || sourceInstance
    const einvoicingConfig = normalizeEinvoicingConfigFromDb({
      mode: subscription?.einvoicing_mode ?? (subscription?.b2brouter_active ? 'b2brouter' : DEFAULT_EINVOICING_CONFIG.mode),
      provider: subscription?.einvoicing_provider ?? null,
      environment: subscription?.einvoicing_environment ?? DEFAULT_EINVOICING_CONFIG.environment,
      onboarding_model: subscription?.einvoicing_onboarding_model ?? null,
      b2brouter_account_id: subscription?.b2brouter_account_id ?? null,
      annuaire_status: subscription?.einvoicing_annuaire_status ?? DEFAULT_EINVOICING_CONFIG.annuaire_status,
    })

    return {
      sourceInstance,
      organizationId: client?.organization_id ?? null,
      label,
      tier: subscription?.tier ?? 'setup_only',
      appUrl: setting?.app_url ?? null,
      configSyncStatus: setting?.config_sync_status ?? null,
      configSyncError: setting?.config_sync_error ?? null,
      monthlyFee,
      billingCurrency,
      aiBillingMode,
      isActive: subscription?.is_active ?? setting?.is_active ?? true,
      renewsAt: subscription?.renews_at ?? null,
      trialEndsAt: subscription?.trial_ends_at ?? null,
      trialConverted: Boolean(subscription?.trial_converted),
      b2brouterActive: subscription?.b2brouter_active ?? false,
      einvoicingConfig,
      overflowMode: subscription?.overflow_mode ?? 'block',
      notes: subscription?.notes ?? null,
      monthCost,
      monthCostEur,
      monthUsageCost,
      monthUsageCostEur,
      grossMargin,
      grossMarginEur,
      marginPct,
      lastSeenAt: latestEvent?.occurred_at ?? client?.updated_at ?? null,
      lastStatus: latestEvent?.status ?? null,
      monthEventCount: monthEvents.length,
      modules: modulesBySource.get(sourceInstance) ?? normalizeOrganizationModules({}),
      businessActivityId: verticalPackBySource.get(sourceInstance)?.activityId ?? null,
      businessVerticalPackId: verticalPackBySource.get(sourceInstance)?.packId ?? null,
      quotas: (quotasBySource[sourceInstance] ?? []).sort((a, b) => {
        const aDef = QUOTA_DEFINITIONS[a.quota_feature]
        const bDef = QUOTA_DEFINITIONS[b.quota_feature]
        return (aDef?.label ?? a.quota_feature).localeCompare(bDef?.label ?? b.quota_feature, 'fr')
      }),
      events: operatorEventsBySource[sourceInstance] ?? [],
      commercialEvents: commercialEventsBySource[sourceInstance] ?? [],
    } satisfies ClientRow
  }).sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return a.label.localeCompare(b.label, 'fr')
  })

  const activeRows = clientRows.filter((row) => row.isActive)
  const rowsWithFee = activeRows.filter((row) => row.monthlyFee !== null)
  const revenueTotalEur = rowsWithFee.reduce(
    (sum, row) => sum + convertAmountToEur(row.monthlyFee ?? 0, row.billingCurrency, usdToEurRate),
    0,
  )
  const costTotalEur = activeRows.reduce((sum, row) => sum + row.monthCostEur, 0)
  const usageTotalEur = activeRows.reduce((sum, row) => sum + row.monthUsageCostEur, 0)
  const grossMarginTotalEur = revenueTotalEur - costTotalEur
  const marginRate = revenueTotalEur > 0 ? (grossMarginTotalEur / revenueTotalEur) * 100 : null
  const missingBillingRows = clientRows.filter((row) => row.monthlyFee === null)
  const lowMarginRows = rowsWithFee
    .slice()
    .sort((a, b) => (a.grossMarginEur ?? Number.POSITIVE_INFINITY) - (b.grossMarginEur ?? Number.POSITIVE_INFINITY))
    .slice(0, 5)
  const expensiveRows = activeRows
    .slice()
    .sort((a, b) => b.monthUsageCostEur - a.monthUsageCostEur)
    .slice(0, 5)

  const rowBySource = new Map(clientRows.map((row) => [row.sourceInstance, row]))
  const successfulUsageEvents = monthlyEvents.filter((event) => event.status === 'success')

  function buildUsageAggregate(
    keyGetter: (event: OperatorUsageEvent) => string,
    labelGetter: (event: OperatorUsageEvent) => string,
  ): UsageAggregateRow[] {
    const aggregates = new Map<string, UsageAggregateRow>()

    for (const event of successfulUsageEvents) {
      const key = keyGetter(event)
      const sourceRow = rowBySource.get(event.source_instance)
      const usageCostEur = convertProviderCostToEur(event.provider_cost, event.currency, usdToEurRate)
      const current = aggregates.get(key) ?? {
        key,
        label: labelGetter(event),
        events: 0,
        tokens: 0,
        usageCostEur: 0,
        orsaynCostEur: 0,
      }

      current.events += 1
      current.tokens += Number(event.total_tokens ?? 0)
      current.usageCostEur += usageCostEur
      current.orsaynCostEur += sourceRow?.aiBillingMode === 'client_owned' ? 0 : usageCostEur
      aggregates.set(key, current)
    }

    return Array.from(aggregates.values())
      .sort((a, b) => b.usageCostEur - a.usageCostEur)
  }

  const featureUsageRows = buildUsageAggregate(
    (event) => event.quota_feature ?? event.feature,
    getUsageFeatureLabel,
  ).slice(0, 6)
  const modelUsageRows = buildUsageAggregate(
    (event) => `${event.provider}:${event.model}`,
    (event) => `${event.provider} · ${event.model}`,
  ).slice(0, 6)
  const pricingSignalRows = activeRows
    .filter((row) => row.monthUsageCostEur > 0)
    .slice()
    .sort((a, b) => b.monthUsageCostEur - a.monthUsageCostEur)
    .slice(0, 6)

  const recommendations = activeRows.flatMap((row): CommercialRecommendation[] => {
    const items: CommercialRecommendation[] = []
    const suggestedTier = getSuggestedTier(row.tier)
    const usageCostLabel = formatMoney(row.monthUsageCostEur)

    const maxQuota = row.quotas.reduce<{
      feature: string
      pct: number
      label: string
    } | null>((current, quota) => {
      const monthly = normalizeNumber(quota.quota_monthly)
      const consumed = normalizeNumber(quota.current_quantity)
      if (monthly <= 0) return current
      const pct = (consumed / monthly) * 100
      if (!current || pct > current.pct) {
        return {
          feature: quota.quota_feature,
          pct,
          label: QUOTA_DEFINITIONS[quota.quota_feature]?.label ?? quota.quota_feature,
        }
      }
      return current
    }, null)

    if (row.aiBillingMode === 'orsayn_shared' && maxQuota && maxQuota.pct >= 90 && row.tier !== 'expert') {
      items.push({
        id: `${row.sourceInstance}-quota-${maxQuota.feature}`,
        sourceInstance: row.sourceInstance,
        clientLabel: row.label,
        title: 'Quota proche limite',
        reason: `${maxQuota.label} atteint ${Math.round(maxQuota.pct)}% du quota.`,
        severity: maxQuota.pct >= 100 ? 'high' : 'medium',
        eventType: 'upgrade_prompt_quota',
        currentTier: row.tier,
        suggestedTier,
        usageCostLabel,
        notePlaceholder: `Proposer ${suggestedTier} pour ${maxQuota.label}`,
      })
    }

    if (row.aiBillingMode === 'orsayn_shared' && row.marginPct !== null && row.marginPct < 85) {
      items.push({
        id: `${row.sourceInstance}-margin`,
        sourceInstance: row.sourceInstance,
        clientLabel: row.label,
        title: 'Marge à surveiller',
        reason: `Marge estimée ${formatPercent(row.marginPct)} avec coût IA porté par Orsayn.`,
        severity: row.marginPct < 70 ? 'high' : 'medium',
        eventType: 'upgrade_prompt_quota',
        currentTier: row.tier,
        suggestedTier,
        usageCostLabel,
        notePlaceholder: 'Conversation tarifaire ou passage tier supérieur',
      })
    }

    if (row.aiBillingMode === 'client_owned' && row.monthUsageCostEur >= 1) {
      items.push({
        id: `${row.sourceInstance}-client-owned-usage`,
        sourceInstance: row.sourceInstance,
        clientLabel: row.label,
        title: 'Usage BYOK élevé',
        reason: `${usageCostLabel} d'usage indicatif avec clé client.`,
        severity: 'low',
        eventType: 'usage_signal_client_owned',
        currentTier: row.tier,
        suggestedTier,
        usageCostLabel,
        notePlaceholder: 'Signal usage uniquement, sans upgrade Stripe',
      })
    }

    if (items.length === 0 && row.aiBillingMode === 'orsayn_shared' && row.monthUsageCostEur >= 0.5 && row.tier !== 'expert') {
      items.push({
        id: `${row.sourceInstance}-usage`,
        sourceInstance: row.sourceInstance,
        clientLabel: row.label,
        title: 'Usage IA actif',
        reason: `${usageCostLabel} d'usage indicatif ce mois-ci.`,
        severity: 'low',
        eventType: 'upgrade_prompt_quota',
        currentTier: row.tier,
        suggestedTier,
        usageCostLabel,
        notePlaceholder: `Garder en opportunite ${suggestedTier}`,
      })
    }

    return items
  }).sort((a, b) => {
    const score = { high: 3, medium: 2, low: 1 }
    return score[b.severity] - score[a.severity]
  }).slice(0, 8)

  const inputCls = "w-full input-glass px-4 py-3 text-primary font-body text-sm outline-none"
  const inputSmCls = "w-full input-glass px-3 py-2 text-primary font-body text-xs outline-none"

  return (
    <main className="flex-1 px-6 py-8 max-w-[1500px] mx-auto w-full space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-primary tracking-tight">Cockpit Orsayn</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary font-body">
            Pilotage privé des instances client : offre, modules, quotas, santé de synchro, marge et orchestration
            facturation électronique. Les coûts fournisseurs restent journalisés en USD, puis convertis en EUR avec
            un taux fixe V1 de {usdToEurRate.toFixed(2)}.
          </p>
        </div>

        <div className="card px-6 py-4">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Accès opérateur</p>
          <p className="mt-2 text-sm font-medium text-primary font-body">{user.email}</p>
        </div>
      </div>

      {/* KPI Bento Grid */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
        <section className="card px-8 py-6">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Coût IA porté</p>
          <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(costTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary font-body">
            Usage total indicatif : {formatMoney(usageTotalEur)} sur {activeRows.length} client(s).
          </p>
        </section>
        <section className="card px-8 py-6">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">CA mensuel saisi</p>
          <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(revenueTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary font-body">{rowsWithFee.length} client(s) avec forfait renseigné.</p>
        </section>
        <section className="card px-8 py-6">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Marge brute estimée</p>
          <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(grossMarginTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary font-body">Comparaison forfait HT vs coût IA réellement porté par Orsayn.</p>
        </section>
        <section className="card px-8 py-6">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Taux de marge</p>
          <p className="mt-3 text-3xl font-extrabold text-accent font-display tabular-nums">{formatPercent(marginRate)}</p>
          <p className="mt-2 text-sm text-secondary font-body">{missingBillingRows.length} client(s) encore à compléter.</p>
        </section>
      </div>

      <section className="card px-8 py-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-primary font-display">Conso IA & pricing</h2>
          <p className="mt-1 text-sm text-secondary font-body">
            Lecture mensuelle des usages IA : coût réellement porté par Orsayn, coût indicatif des clés client, et signaux pour ajuster les offres.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Features coûteuses</p>
            {featureUsageRows.length === 0 ? (
              <p className="text-sm text-secondary font-body">Aucun usage IA ce mois-ci.</p>
            ) : featureUsageRows.map((row) => (
              <div key={row.key} className="rounded-lg border border-[var(--elevation-border)] bg-interactive/40 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="font-semibold text-primary">{row.label}</span>
                  <span className="text-secondary tabular-nums">{formatMoney(row.usageCostEur)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-secondary">
                  <span>{row.events} appel(s) · {formatCompactNumber(row.tokens)} tokens</span>
                  <span>porté {formatMoney(row.orsaynCostEur)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Modèles coûteux</p>
            {modelUsageRows.length === 0 ? (
              <p className="text-sm text-secondary font-body">Aucun modèle consommé ce mois-ci.</p>
            ) : modelUsageRows.map((row) => (
              <div key={row.key} className="rounded-lg border border-[var(--elevation-border)] bg-interactive/40 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-primary">{row.label}</span>
                  <span className="text-secondary tabular-nums">{formatMoney(row.usageCostEur)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-secondary">
                  <span>{row.events} appel(s)</span>
                  <span>{formatCompactNumber(row.tokens)} tokens</span>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Signaux clients</p>
            {pricingSignalRows.length === 0 ? (
              <p className="text-sm text-secondary font-body">Aucun signal pricing pour le moment.</p>
            ) : pricingSignalRows.map((row) => (
              <div key={row.sourceInstance} className="rounded-lg border border-[var(--elevation-border)] bg-interactive/40 px-4 py-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate font-semibold text-primary">{row.label}</span>
                  <span className="text-secondary tabular-nums">{formatMoney(row.monthUsageCostEur)}</span>
                </div>
                <div className="mt-1 flex items-center justify-between gap-3 text-xs text-secondary">
                  <span>{formatCommercialStatus(row)} · {formatAIBillingMode(row.aiBillingMode)}</span>
                  <span>{row.monthEventCount} event(s)</span>
                </div>
                {row.aiBillingMode === 'client_owned' && (
                  <p className="mt-2 text-[11px] text-secondary">
                    Usage à garder pour le pricing, non soustrait de ta marge.
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="card px-8 py-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-primary font-display">Recommandations commerciales</h2>
          <p className="mt-1 text-sm text-secondary font-body">
            Opportunités détectées automatiquement à partir des quotas, de la marge et des usages IA/WhatsApp.
          </p>
        </div>

        {recommendations.length === 0 ? (
          <p className="text-sm text-secondary font-body">Aucune recommandation commerciale pour le moment.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {recommendations.map((recommendation) => (
              <div key={recommendation.id} className="rounded-lg border border-[var(--elevation-border)] bg-interactive/40 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-primary">{recommendation.clientLabel}</p>
                    <p className="mt-1 text-sm text-secondary">{recommendation.title}</p>
                  </div>
                  <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${getRecommendationClass(recommendation.severity)}`}>
                    {recommendation.severity}
                  </span>
                </div>
                <p className="mt-3 text-xs text-secondary">{recommendation.reason}</p>
                <p className="mt-1 text-xs text-secondary">
                  {recommendation.currentTier} → {recommendation.suggestedTier}
                </p>
                <form action={recordOperatorCommercialAction} className="mt-3 grid gap-2">
                  <input type="hidden" name="sourceInstance" value={recommendation.sourceInstance} />
                  <input type="hidden" name="clientLabel" value={recommendation.clientLabel} />
                  <input type="hidden" name="currentTier" value={recommendation.currentTier} />
                  <input type="hidden" name="suggestedTier" value={recommendation.suggestedTier} />
                  <input type="hidden" name="eventType" value={recommendation.eventType} />
                  <input type="hidden" name="usageCostLabel" value={recommendation.usageCostLabel} />
                  <input
                    name="recipientEmail"
                    type="email"
                    placeholder="email client si envoi"
                    className={inputSmCls}
                  />
                  <input
                    name="notes"
                    placeholder={recommendation.notePlaceholder}
                    className={inputSmCls}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="submit"
                      name="deliveryMode"
                      value="draft"
                      className="rounded-pill bg-slate-500/10 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-500/20 dark:text-slate-200"
                    >
                      Tracer
                    </button>
                    <button
                      type="submit"
                      name="deliveryMode"
                      value="send"
                      className="rounded-pill bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20"
                    >
                      Envoyer
                    </button>
                  </div>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.2fr,0.8fr,0.8fr]">
        <section className="card px-8 py-6">
          <div className="mb-5">
            <h2 className="text-lg font-bold text-primary font-display">Ajouter ou préconfigurer un client</h2>
            <p className="mt-1 text-sm text-secondary font-body">
              Crée une ligne cockpit avant même le premier événement si tu connais déjà le `source_instance`.
            </p>
          </div>

          <form action={upsertOperatorClientSettings} className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1.5 text-sm font-body">
              <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">source_instance</span>
              <input
                required
                name="sourceInstance"
                placeholder="maconnerie-durand"
                className={inputCls}
              />
            </label>
            <label className="space-y-1.5 text-sm font-body">
              <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Libellé</span>
              <input
                name="label"
                placeholder="Maconnerie Durand"
                className={inputCls}
              />
            </label>
            <label className="space-y-1.5 text-sm font-body">
              <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Mensuel HT</span>
              <input
                name="monthlyFeeHt"
                type="number"
                min="0"
                step="0.01"
                placeholder="390"
                className={inputCls}
              />
            </label>
            <label className="space-y-1.5 text-sm font-body">
              <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">URL app client</span>
              <input
                name="appUrl"
                type="url"
                placeholder="https://client.fr"
                className={inputCls}
              />
            </label>
            <label className="space-y-1.5 text-sm font-body">
              <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">Devise</span>
              <select
                name="billingCurrency"
                defaultValue="EUR"
                className={inputCls}
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="input-glass flex items-center gap-3 px-4 py-3 text-sm text-primary font-body">
              <input
                defaultChecked
                name="isActive"
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
              />
              Client actif
            </label>
            <div className="flex items-end justify-end">
              <button
                type="submit"
                className="btn-pill btn-pill-primary inline-flex text-sm"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </section>

        <section className="card px-8 py-6 space-y-3">
          <div>
            <h2 className="text-lg font-bold text-primary font-display">Peu rentables</h2>
            <p className="mt-1 text-sm text-secondary font-body">Classement sur le mois en équivalent EUR.</p>
          </div>
          {lowMarginRows.length === 0 ? (
            <p className="text-sm text-secondary font-body">Aucune marge calculable pour le moment.</p>
          ) : lowMarginRows.map((row) => (
            <div key={row.sourceInstance} className="flex items-center justify-between gap-4 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-primary font-body">{row.label}</p>
                <p className="text-secondary font-body tabular-nums">{formatPercent(row.marginPct)}</p>
              </div>
              <span className="text-right text-secondary font-display tabular-nums text-xs">{formatMoney(row.grossMarginEur ?? 0)}</span>
            </div>
          ))}
        </section>

        <section className="card px-8 py-6 space-y-3">
          <div>
            <h2 className="text-lg font-bold text-primary font-display">Clients coûteux</h2>
            <p className="mt-1 text-sm text-secondary font-body">Coûts IA du mois les plus élevés.</p>
          </div>
          {expensiveRows.length === 0 ? (
            <p className="text-sm text-secondary font-body">Aucune donnée de coût pour le mois en cours.</p>
          ) : expensiveRows.map((row) => (
            <div key={row.sourceInstance} className="flex items-center justify-between gap-4 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold text-primary font-body">{row.label}</p>
                <p className="text-secondary font-body tabular-nums">{row.monthEventCount} événement(s)</p>
              </div>
              <span className="text-right text-secondary font-display tabular-nums text-xs">{formatMoney(row.monthUsageCostEur)}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="card px-8 py-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-primary font-display">Clients et marge</h2>
          <p className="mt-1 text-sm text-secondary font-body">
            Le coût est converti dans la devise du forfait pour chaque ligne. Les totaux globaux restent normalisés en EUR.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm font-body">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] text-left">
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Client</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Synchro</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Offre</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Forfait HT</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Coût du mois</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Marge brute</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Marge %</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Dernier événement</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Configuration</th>
              </tr>
            </thead>
            <tbody>
              {clientRows.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-secondary">
                    Aucun client dans le cockpit pour le moment. Ajoute un `source_instance` ci-dessus ou attends le premier événement synchronisé depuis une instance cliente.
                  </td>
                </tr>
              ) : clientRows.map((row) => {
                const syncBadge = getSyncBadge(row.lastSeenAt, row.lastStatus)

                return (
                  <tr key={row.sourceInstance} className="border-b border-[var(--elevation-border)] align-top last:border-b-0">
                    <td className="py-4 pr-4">
                      <p className="font-semibold text-primary">{row.label}</p>
                      <p className="mt-1 text-xs text-secondary">{row.sourceInstance}</p>
                    </td>
                    <td className="py-4 pr-4">
                      <span className={`inline-flex rounded-pill px-3 py-1 text-xs font-semibold font-display ${syncBadge.className}`}>
                        {syncBadge.label}
                      </span>
                      <p className="mt-2 text-[11px] text-secondary">
                        Configuration : {row.configSyncStatus ?? 'n/a'}
                      </p>
                    </td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">
                      {formatCommercialStatus(row)}
                      {row.aiBillingMode === 'client_owned' && (
                        <p className="mt-1 text-[11px] text-secondary">
                          Sans abonnement Stripe
                        </p>
                      )}
                    </td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">
                      {row.monthlyFee === null ? 'À compléter' : formatMoney(row.monthlyFee, row.billingCurrency)}
                    </td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">
                      {formatMoney(row.monthCost, row.billingCurrency)}
                      {row.aiBillingMode === 'client_owned' && (
                        <p className="mt-1 text-[11px] text-secondary">
                          Usage indicatif {formatMoney(row.monthUsageCost, row.billingCurrency)}
                        </p>
                      )}
                    </td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">
                      {row.grossMargin === null ? 'À compléter' : formatMoney(row.grossMargin, row.billingCurrency)}
                    </td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">{formatPercent(row.marginPct)}</td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">{formatDate(row.lastSeenAt)}</td>
                    <td className="py-4">
                      <form action={upsertOperatorSubscription} className="grid gap-2 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 dark:bg-white/[0.02] p-3 backdrop-blur-frost">
                        {(() => {
                          const einvoicingBadge = getEinvoicingBadge(row.einvoicingConfig)
                          return (
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Offre & orchestration</p>
                              <span className={`rounded-pill px-2 py-0.5 text-[11px] font-semibold ${einvoicingBadge.className}`}>
                                {einvoicingBadge.label}
                              </span>
                            </div>
                          )
                        })()}
                        <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
                        <input
                          name="label"
                          defaultValue={row.label === row.sourceInstance ? '' : row.label}
                          placeholder="Libellé"
                          className={inputSmCls}
                        />
                        <input
                          name="appUrl"
                          type="url"
                          defaultValue={row.appUrl ?? ''}
                          placeholder="https://client.fr"
                          className={inputSmCls}
                        />
                        <div className="grid grid-cols-[1fr,92px] gap-2">
                          <select name="tier" defaultValue={row.tier} className={inputSmCls}>
                            {SUBSCRIPTION_TIERS.map((tier) => (
                              <option key={tier} value={tier}>{tier}</option>
                            ))}
                          </select>
                          <input
                            name="mrrHt"
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={row.monthlyFee ?? ''}
                            placeholder="390"
                            className={inputSmCls}
                          />
                        </div>
                        <div className="grid grid-cols-[1fr,92px] gap-2">
                          <select
                            name="billingCurrency"
                            defaultValue={row.billingCurrency}
                            className={inputSmCls}
                          >
                            <option value="EUR">EUR</option>
                            <option value="USD">USD</option>
                          </select>
                          <select name="overflowMode" defaultValue={row.overflowMode} className={inputSmCls}>
                            {OVERFLOW_MODES.map((mode) => (
                              <option key={mode} value={mode}>{mode}</option>
                            ))}
                          </select>
                        </div>
                        <select name="aiBillingMode" defaultValue={row.aiBillingMode} className={inputSmCls}>
                          {AI_BILLING_MODES.map((mode) => (
                            <option key={mode} value={mode}>{formatAIBillingMode(mode)}</option>
                          ))}
                        </select>
                        <input
                          name="renewsAt"
                          type="date"
                          defaultValue={formatDateInput(row.renewsAt)}
                          className={inputSmCls}
                        />
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--elevation-border)] bg-white/[0.03] px-3 py-2 text-xs">
                          <span className="font-semibold text-primary font-display">Essai</span>
                          <span className="text-secondary">
                            {getTrialLabel(row.trialEndsAt, row.trialConverted)}
                            {row.trialEndsAt && !row.trialConverted ? ` · fin ${formatDate(row.trialEndsAt)}` : ''}
                          </span>
                        </div>
                        <textarea
                          name="notes"
                          defaultValue={row.notes ?? ''}
                          placeholder="Notes abonnement"
                          rows={2}
                          className={inputSmCls}
                        />
                        <div className="rounded-lg border border-[var(--elevation-border)] bg-white/[0.03] p-3">
                          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-secondary font-display">Facturation électronique</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            <select
                              name="einvoicingMode"
                              defaultValue={row.einvoicingConfig.mode}
                              className={inputSmCls}
                            >
                              {EINVOICING_MODES.map((mode) => (
                                <option key={mode} value={mode}>{mode}</option>
                              ))}
                            </select>
                            <select
                              name="einvoicingEnvironment"
                              defaultValue={row.einvoicingConfig.environment}
                              className={inputSmCls}
                            >
                              {EINVOICING_ENVIRONMENTS.map((environment) => (
                                <option key={environment} value={environment}>{environment}</option>
                              ))}
                            </select>
                            <select
                              name="einvoicingOnboardingModel"
                              defaultValue={row.einvoicingConfig.onboarding_model ?? ''}
                              className={inputSmCls}
                            >
                              <option value="">Sans onboarding</option>
                              {EINVOICING_ONBOARDING_MODELS.map((model) => (
                                <option key={model} value={model}>{model}</option>
                              ))}
                            </select>
                            <input
                              name="b2brouterAccountId"
                              defaultValue={row.einvoicingConfig.b2brouter_account_id ?? ''}
                              placeholder="B2Brouter account id"
                              className={inputSmCls}
                            />
                            <select
                              name="einvoicingAnnuaireStatus"
                              defaultValue={row.einvoicingConfig.annuaire_status}
                              className={inputSmCls}
                            >
                              {EINVOICING_ANNUAIRE_STATUSES.map((status) => (
                                <option key={status} value={status}>{status}</option>
                              ))}
                            </select>
                          </div>
                          <p className="mt-2 text-[11px] leading-relaxed text-secondary">
                            Réception UI 2026 uniquement en mode B2Brouter. Avant 2027, l'envoi PDF/mail reste normal pour TPE/PME.
                          </p>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <label className="flex items-center gap-2 text-xs text-secondary font-body">
                            <input
                              name="isActive"
                              type="checkbox"
                              defaultChecked={row.isActive}
                              className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
                            />
                            Actif
                          </label>
                        </div>
                        {row.configSyncError && (
                          <p className="text-[11px] text-red-600">{row.configSyncError}</p>
                        )}
                        <button
                          type="submit"
                          className="inline-flex justify-center rounded-pill bg-accent/10 text-accent px-3 py-2 text-xs font-semibold font-display transition hover:bg-accent/20"
                        >
                          Appliquer l’offre
                        </button>
                      </form>

                      <div className="mt-2 grid gap-2 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 dark:bg-white/[0.02] p-3 backdrop-blur-frost">
                        <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Actions cockpit</p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <form action={resyncOperatorClientConfig}>
                            <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
                            <button
                              type="submit"
                              className="w-full rounded-pill bg-slate-500/10 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-500/20 dark:text-slate-200"
                            >
                              Resync config
                            </button>
                          </form>
                          {!isActiveTrial(row.trialEndsAt) && (
                            <form action={activateOperatorTrial}>
                              <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
                              <input type="hidden" name="trialDays" value="30" />
                              <button
                                type="submit"
                                className="w-full rounded-pill bg-green-500/10 px-3 py-2 text-xs font-semibold text-green-700 transition hover:bg-green-500/20"
                              >
                                Essai Expert 30j
                              </button>
                            </form>
                          )}
                          {isActiveTrial(row.trialEndsAt) && (
                            <>
                              <form action={convertOperatorTrial} className="flex gap-2">
                                <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
                                <select name="targetTier" defaultValue="pro" className={inputSmCls}>
                                  <option value="starter">starter</option>
                                  <option value="pro">pro</option>
                                  <option value="expert">expert</option>
                                </select>
                                <button
                                  type="submit"
                                  className="rounded-pill bg-accent/10 px-3 py-2 text-xs font-semibold text-accent transition hover:bg-accent/20"
                                >
                                  Convertir
                                </button>
                              </form>
                              <form action={expireOperatorTrial}>
                                <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
                                <input type="hidden" name="targetTier" value="setup_only" />
                                <button
                                  type="submit"
                                  className="w-full rounded-pill bg-red-500/10 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-500/20"
                                >
                                  Terminer essai
                                </button>
                              </form>
                            </>
                          )}
                        </div>
                      </div>

                      {row.organizationId && (
                        <form action={upsertOperatorClientModules} className="mt-2 grid gap-2 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 dark:bg-white/[0.02] p-3 backdrop-blur-frost">
                          <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
                          <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display mb-1">Modules</p>
                          {ORGANIZATION_MODULE_KEYS.map((key) => (
                            <label key={key} className="flex items-center gap-2 text-xs text-secondary font-body">
                              <input
                                name={`module_${key}`}
                                type="checkbox"
                                defaultChecked={row.modules[key]}
                                className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
                              />
                              {key}
                            </label>
                          ))}
                          <button
                            type="submit"
                            className="inline-flex justify-center rounded-pill bg-accent/10 text-accent px-3 py-2 text-xs font-semibold font-display transition hover:bg-accent/20"
                          >
                            Appliquer
                          </button>
                        </form>
                      )}
                      {row.organizationId && (() => {
                        const suggestedPack = getEligibleVerticalPack(row.businessActivityId)
                        return (
                          <form action={upsertOperatorClientVerticalPack} className="mt-2 grid gap-2 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 dark:bg-white/[0.02] p-3 backdrop-blur-frost">
                            <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
                            <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display mb-1">
                              Pack verticale métier
                              {suggestedPack && !row.businessVerticalPackId && (
                                <span className="ml-2 rounded-pill bg-accent/10 px-2 py-0.5 text-[10px] font-semibold normal-case text-accent">
                                  Suggéré : {suggestedPack.label}
                                </span>
                              )}
                            </p>
                            <select
                              name="vertical_pack_id"
                              defaultValue={row.businessVerticalPackId ?? ''}
                              className="rounded-md border border-[var(--elevation-border)] bg-transparent px-2 py-1.5 text-xs text-primary"
                            >
                              <option value="">Aucun pack</option>
                              {Object.values(VERTICAL_PACKS).map((pack) => (
                                <option key={pack.id} value={pack.id}>{pack.label}</option>
                              ))}
                            </select>
                            <button
                              type="submit"
                              className="inline-flex justify-center rounded-pill bg-accent/10 text-accent px-3 py-2 text-xs font-semibold font-display transition hover:bg-accent/20"
                            >
                              Appliquer
                            </button>
                          </form>
                        )
                      })()}
                      <div className="mt-2 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 dark:bg-white/[0.02] p-3">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-secondary font-display">Quotas du mois en cours</p>
                        {row.quotas.length === 0 ? (
                          <p className="text-xs text-secondary">Aucun quota initialisé.</p>
                        ) : (
                          <div className="space-y-2">
                            {row.quotas.map((quota) => {
                              const definition = QUOTA_DEFINITIONS[quota.quota_feature]
                              const current = normalizeNumber(quota.current_quantity)
                              const monthly = normalizeNumber(quota.quota_monthly)
                              const pct = monthly > 0 ? Math.round((current / monthly) * 100) : null
                              return (
                                <div key={quota.quota_feature} className="space-y-1 text-xs">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="text-primary">{definition?.label ?? quota.quota_feature}</span>
                                    <span className={`rounded-pill px-2 py-0.5 font-semibold ${getQuotaBadgeClass(quota)}`}>
                                      {monthly < 0 ? 'illimité' : `${pct ?? 0}%`}
                                    </span>
                                  </div>
                                  <div className="flex items-center justify-between gap-3 text-secondary tabular-nums">
                                    <span>{formatQuotaValue(current)} / {formatQuotaValue(monthly)} {quota.quota_unit}</span>
                                    <span>{formatMoney(normalizeNumber(quota.current_cost_eur))}</span>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                      <div className="mt-2 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 dark:bg-white/[0.02] p-3">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-secondary font-display">Journal cockpit</p>
                        {row.events.length === 0 ? (
                          <p className="text-xs text-secondary">Aucune action tracée.</p>
                        ) : (
                          <div className="space-y-2">
                            {row.events.slice(0, 4).map((event) => (
                              <div key={event.id} className="text-xs">
                                <div className="flex items-center justify-between gap-3">
                                  <span className="font-semibold text-primary">{getEventLabel(event.event_type)}</span>
                                  <span className="text-secondary tabular-nums">{formatDate(event.created_at)}</span>
                                </div>
                                <p className="mt-0.5 text-secondary">
                                  {event.actor_email ?? 'system'}
                                  {event.notes ? ` · ${event.notes}` : ''}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="mt-2 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 dark:bg-white/[0.02] p-3">
                        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-secondary font-display">CRM commercial</p>
                        {row.commercialEvents.length === 0 ? (
                          <p className="text-xs text-secondary">Aucune action commerciale tracée.</p>
                        ) : (
                          <div className="space-y-2">
                            {row.commercialEvents.slice(0, 4).map((event) => {
                              const deliveryStatus = typeof event.metadata?.delivery_status === 'string'
                                ? event.metadata.delivery_status
                                : null
                              return (
                                <div key={event.id} className="text-xs">
                                  <div className="flex items-center justify-between gap-3">
                                    <span className="font-semibold text-primary">{getCommercialEventLabel(event.event_type)}</span>
                                    <span className="text-secondary tabular-nums">{formatDate(event.sent_at)}</span>
                                  </div>
                                  <p className="mt-0.5 text-secondary">
                                    {deliveryStatus ? `${deliveryStatus} · ` : ''}{event.subject_preview ?? event.email_template ?? event.sent_by}
                                  </p>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Module emails cockpit ────────────────────────────────────────── */}
      {(() => {
        const pendingAlerts = commercialEvents.filter((e) => e.delivery_status === 'pending_review')
        const sentEmails = commercialEvents.filter((e) => e.delivery_status !== 'pending_review')
        const emailClients = clientRows
          .filter((row) => row.isActive)
          .map((row) => ({
            sourceInstance: row.sourceInstance,
            label: row.label,
            tier: row.tier,
            recipientEmail: (row.commercialEvents.find((e) => e.recipient_email)?.recipient_email) ?? null,
          }))
        return (
          <EmailsTab
            pendingAlerts={pendingAlerts}
            sentEmails={sentEmails}
            clients={emailClients}
          />
        )
      })()}

      <section className="card px-8 py-6 space-y-5">
        <div>
          <h2 className="text-lg font-bold text-primary font-display">Derniers événements</h2>
          <p className="mt-1 text-sm text-secondary font-body">20 derniers appels synchronisés depuis les instances clientes.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm font-body">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] text-left">
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Date</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Client</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Fournisseur</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Fonction</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Coût</th>
                <th className="pb-3 text-xs font-bold uppercase tracking-wide text-secondary font-display">Statut</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-secondary">
                    Aucun événement synchronisé pour le moment.
                  </td>
                </tr>
              ) : recentEvents.slice(0, 20).map((event, index) => (
                <tr key={`${event.source_instance}-${event.occurred_at}-${index}`} className="border-b border-[var(--elevation-border)] last:border-b-0">
                  <td className="py-3 text-primary tabular-nums">{formatDate(event.occurred_at)}</td>
                  <td className="py-3 text-primary">{settingsBySource.get(event.source_instance)?.label || event.source_instance}</td>
                  <td className="py-3 text-secondary">{event.provider}</td>
                  <td className="py-3 text-secondary">{event.feature}</td>
                  <td className="py-3 text-secondary tabular-nums">{formatMoney(Number(event.provider_cost ?? 0), 'USD')}</td>
                  <td className="py-3">
                    <span className={`inline-flex rounded-pill px-3 py-1 text-xs font-semibold font-display ${event.status === 'success' ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
                      {event.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}
