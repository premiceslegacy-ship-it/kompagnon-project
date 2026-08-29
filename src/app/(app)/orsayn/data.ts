import { getOperatorUsdToEurRate } from '@/lib/operator'
import { getOperatorUser } from '@/lib/operator-auth'
import { UNRESOLVED_ORGANIZATION_ID } from '@/lib/operator/trial-lifecycle'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizeOrganizationModules } from '@/lib/organization-modules'
import { QUOTA_DEFINITIONS } from '@/lib/quota-catalog'
import {
  DEFAULT_EINVOICING_CONFIG,
  normalizeEinvoicingConfigFromDb,
} from '@/lib/einvoicing-config'
import type {
  ClientRow,
  CommercialRecommendation,
  OperatorClient,
  OperatorClientEvent,
  OperatorClientQuota,
  OperatorClientSetting,
  OperatorClientSubscription,
  OperatorCommercialEvent,
  OperatorUsageEvent,
  UsageAggregateRow,
  UsageHistoryRow,
} from './types'
import {
  clientKey,
  convertAmountToEur,
  convertProviderCostToEur,
  convertEurToCurrency,
  formatMoney,
  formatPercent,
  getSuggestedTier,
  getLatestQuotaRows,
  getUsageFeatureLabel,
  normalizeAIBillingMode,
  normalizeFee,
  normalizeNumber,
} from './utils'

export type FailedWebhookEvent = {
  source_id: string
  event_type: string
  error_msg: string | null
  received_at: string
}

export type EmailClientOption = {
  sourceInstance: string
  organizationId: string | null
  label: string
  tier: string
  recipientEmail: string | null
}

export type CockpitData = {
  user: { email?: string | null }
  clientRows: ClientRow[]
  activeRows: ClientRow[]
  recentEvents: OperatorUsageEvent[]
  usageHistory: UsageHistoryRow[]
  featureUsageRows: UsageAggregateRow[]
  modelUsageRows: UsageAggregateRow[]
  pricingSignalRows: ClientRow[]
  recommendations: CommercialRecommendation[]
  lowMarginRows: ClientRow[]
  expensiveRows: ClientRow[]
  failedWebhookEvents: FailedWebhookEvent[]
  pendingAlerts: OperatorCommercialEvent[]
  sentEmails: OperatorCommercialEvent[]
  emailClients: EmailClientOption[]
  usdToEurRate: number
  revenueTotalEur: number
  costTotalEur: number
  usageTotalEur: number
  grossMarginTotalEur: number
  marginRate: number | null
  missingBillingCount: number
  syncAttentionRows: ClientRow[]
  trialEndingRows: ClientRow[]
  paymentAttentionRows: ClientRow[]
}

function monthStart(date = new Date()): string {
  const value = new Date(date)
  value.setDate(1)
  value.setHours(0, 0, 0, 0)
  return value.toISOString().slice(0, 10)
}

function twelveMonthStart(date = new Date()): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 11, 1))
}

function monthLabel(month: string): string {
  const date = new Date(`${month}-01T00:00:00Z`)
  return new Intl.DateTimeFormat('fr-FR', { month: 'short' })
    .format(date)
    .replace('.', '')
}

function buildUsageHistory(
  events: OperatorUsageEvent[],
  usdToEurRate: number,
  isClientOwned: (event: OperatorUsageEvent) => boolean = () => false,
): UsageHistoryRow[] {
  const now = new Date()
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - index), 1))
    return date.toISOString().slice(0, 7)
  })
  const buckets = new Map(months.map((month) => [month, {
    month,
    label: monthLabel(month),
    events: 0,
    tokens: 0,
    usageCostEur: 0,
    orsaynCostEur: 0,
  } satisfies UsageHistoryRow]))

  for (const event of events) {
    if (event.status !== 'success') continue
    const month = event.occurred_at.slice(0, 7)
    const current = buckets.get(month)
    if (!current) continue
    const cost = convertProviderCostToEur(event.provider_cost, event.currency, usdToEurRate)
    current.events += 1
    current.tokens += Number(event.total_tokens ?? 0)
    current.usageCostEur += cost
    // Client-owned usage is a useful signal but is not a cost carried by Orsayn.
    current.orsaynCostEur += isClientOwned(event) ? 0 : cost
  }

  return [...buckets.values()]
}

function getAiBillingModeFromEvent(event: OperatorUsageEvent, row: ClientRow | undefined): 'orsayn_shared' | 'client_owned' {
  const metadataMode = event.metadata && (event.metadata as Record<string, unknown>).ai_billing_mode
  if (metadataMode === 'client_owned') return 'client_owned'
  return row?.aiBillingMode ?? 'orsayn_shared'
}

export async function getCockpitData(): Promise<CockpitData | null> {
  const user = await getOperatorUser()
  if (!user) return null

  const operator = createOperatorAdminClient()
  const usdToEurRate = getOperatorUsdToEurRate()
  const currentMonth = monthStart()
  const twelveMonthsAgo = twelveMonthStart().toISOString()

  const [
    settingsResult,
    subscriptionsResult,
    quotasResult,
    clientsResult,
    usageEventsResult,
    recentEventsResult,
    operatorEventsResult,
    commercialEventsResult,
    failedWebhookEventsResult,
  ] = await Promise.all([
    operator
      .from('operator_client_settings')
      .select('source_instance, organization_id, label, monthly_fee_ht, billing_currency, is_active, app_url, contact_email, config_sync_status, config_synced_at, config_sync_error')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_client_subscriptions')
      .select('source_instance, organization_id, tier, ai_billing_mode, mrr_ht, billing_currency, is_active, renews_at, trial_tier, trial_started_at, trial_ends_at, trial_converted, preferred_tier, access_status, access_ends_at, cancel_at, stripe_status, payment_failed_at, einvoicing_mode, einvoicing_provider, einvoicing_environment, einvoicing_annuaire_status, oauth_status, oauth_connected_at, super_pdp_connection_id, super_pdp_emission_enabled, super_pdp_reception_enabled, overflow_mode, notes')
      .order('source_instance', { ascending: true }),
    // L'historique des quotas sert à la fiche client et ne doit pas être limité au mois courant.
    operator
      .from('operator_client_quotas')
      .select('source_instance, organization_id, quota_feature, quota_unit, quota_monthly, current_quantity, current_cost_eur, period_start')
      .order('period_start', { ascending: false }),
    operator
      .from('operator_clients')
      .select('source_instance, organization_id, label, updated_at')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_usage_events')
      .select('source_instance, organization_id, provider, feature, quota_feature, model, provider_cost, currency, total_tokens, quota_quantity, over_quota, status, occurred_at, metadata')
      .gte('occurred_at', twelveMonthsAgo)
      .order('occurred_at', { ascending: false })
      .limit(15000),
    operator
      .from('operator_usage_events')
      .select('source_instance, organization_id, provider, feature, quota_feature, model, provider_cost, currency, total_tokens, quota_quantity, over_quota, status, occurred_at, metadata')
      .order('occurred_at', { ascending: false })
      .limit(200),
    operator
      .from('operator_client_events')
      .select('id, source_instance, organization_id, event_category, event_type, actor_email, metadata, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(300),
    operator
      .from('operator_commercial_events')
      .select('id, source_instance, organization_id, event_type, tier_context, sent_at, sent_by, actor_email, email_template, subject_preview, body_text, recipient_email, delivery_status, auto_send_after, notes, metadata')
      .order('sent_at', { ascending: false })
      .limit(300),
    operator
      .from('webhook_events')
      .select('source_id, event_type, error_msg, received_at')
      .eq('status', 'failed')
      .order('received_at', { ascending: false })
      .limit(50),
  ])

  const errors = {
    settings: settingsResult.error,
    subscriptions: subscriptionsResult.error,
    quotas: quotasResult.error,
    clients: clientsResult.error,
    usage: usageEventsResult.error,
    recentUsage: recentEventsResult.error,
    events: operatorEventsResult.error,
    commercial: commercialEventsResult.error,
    webhooks: failedWebhookEventsResult.error,
  }
  if (Object.values(errors).some(Boolean)) {
    // Une table indisponible ne doit pas masquer tout le cockpit : les sections concernées
    // restent vides et l'erreur est visible dans les logs du Worker.
    console.error('[orsayn.page]', errors)
  }

  const settings = (settingsResult.data ?? []) as OperatorClientSetting[]
  const subscriptions = (subscriptionsResult.data ?? []) as OperatorClientSubscription[]
  const quotas = (quotasResult.data ?? []) as OperatorClientQuota[]
  const clients = (clientsResult.data ?? []) as OperatorClient[]
  const orgKey = clientKey
  const configuredClientKeys = new Set<string>([
    ...settings.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...subscriptions.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...quotas.map((item) => orgKey(item.source_instance, item.organization_id)),
  ])
  const usageEvents = ((usageEventsResult.data ?? []) as OperatorUsageEvent[])
    .filter((event) => configuredClientKeys.has(orgKey(event.source_instance, event.organization_id)))
  const recentEvents = ((recentEventsResult.data ?? []) as OperatorUsageEvent[])
    .filter((event) => configuredClientKeys.has(orgKey(event.source_instance, event.organization_id)))
  const operatorEvents = ((operatorEventsResult.data ?? []) as OperatorClientEvent[])
    .filter((event) => configuredClientKeys.has(orgKey(event.source_instance, event.organization_id)))
  const commercialEvents = ((commercialEventsResult.data ?? []) as OperatorCommercialEvent[])
    .filter((event) => configuredClientKeys.has(orgKey(event.source_instance, event.organization_id)))
  const failedWebhookEvents = (failedWebhookEventsResult.data ?? []) as FailedWebhookEvent[]

  const settingsBySource = new Map(settings.map((item) => [orgKey(item.source_instance, item.organization_id), item]))
  const subscriptionsBySource = new Map(subscriptions.map((item) => [orgKey(item.source_instance, item.organization_id), item]))
  const clientsBySource = new Map(clients.map((item) => [orgKey(item.source_instance, item.organization_id), item]))
  const quotasBySource = quotas.reduce<Record<string, OperatorClientQuota[]>>((acc, quota) => {
    const key = orgKey(quota.source_instance, quota.organization_id)
    acc[key] ??= []
    acc[key].push(quota)
    return acc
  }, {})
  const operatorEventsBySource = operatorEvents.reduce<Record<string, OperatorClientEvent[]>>((acc, event) => {
    const key = orgKey(event.source_instance, event.organization_id)
    acc[key] ??= []
    acc[key].push(event)
    return acc
  }, {})
  const commercialEventsBySource = commercialEvents.reduce<Record<string, OperatorCommercialEvent[]>>((acc, event) => {
    const key = orgKey(event.source_instance, event.organization_id)
    acc[key] ??= []
    acc[key].push(event)
    return acc
  }, {})

  const orgIds = [...new Set(
    [...settings, ...subscriptions, ...quotas]
      .map((item) => item.organization_id)
      .filter((id): id is string => Boolean(id) && id !== UNRESOLVED_ORGANIZATION_ID),
  )]
  const admin = createAdminClient()
  const [{ data: modulesRows }, { data: verticalPackRows }] = await Promise.all([
    orgIds.length > 0
      ? admin.from('organization_modules').select('organization_id, modules').in('organization_id', orgIds)
      : Promise.resolve({ data: [] as { organization_id: string; modules: unknown }[] }),
    orgIds.length > 0
      ? admin.from('organizations').select('id, business_activity_id, business_vertical_pack, has_metal_pricing').in('id', orgIds)
      : Promise.resolve({ data: [] as { id: string; business_activity_id: string | null; business_vertical_pack: string | null; has_metal_pricing: boolean | null }[] }),
  ])
  const modulesByOrgId = new Map((modulesRows ?? []).map((row) => [row.organization_id, row.modules]))
  const verticalPackByOrgId = new Map((verticalPackRows ?? []).map((row) => [row.id, {
    activityId: row.business_activity_id,
    packId: row.business_vertical_pack,
    hasMetalPricing: Boolean(row.has_metal_pricing),
  }]))

  const latestEventBySource = new Map<string, OperatorUsageEvent>()
  for (const event of recentEvents) {
    const key = orgKey(event.source_instance, event.organization_id)
    if (!latestEventBySource.has(key)) latestEventBySource.set(key, event)
  }

  const currentMonthEventsBySource = usageEvents.reduce<Record<string, OperatorUsageEvent[]>>((acc, event) => {
    if (event.occurred_at.slice(0, 10) < currentMonth) return acc
    const key = orgKey(event.source_instance, event.organization_id)
    acc[key] ??= []
    acc[key].push(event)
    return acc
  }, {})
  const billingModeBySource = new Map(
    subscriptions.map((subscription) => [
      orgKey(subscription.source_instance, subscription.organization_id),
      normalizeAIBillingMode(subscription.ai_billing_mode),
    ]),
  )
  const isClientOwnedEvent = (event: OperatorUsageEvent) => {
    const metadataMode = event.metadata?.ai_billing_mode
    return metadataMode === 'client_owned' || billingModeBySource.get(orgKey(event.source_instance, event.organization_id)) === 'client_owned'
  }
  const usageHistoryBySource = new Map<string, UsageHistoryRow[]>()
  const usageHistory = buildUsageHistory(usageEvents, usdToEurRate, isClientOwnedEvent)
  const usageEventsBySource = usageEvents.reduce<Record<string, OperatorUsageEvent[]>>((acc, event) => {
    const key = orgKey(event.source_instance, event.organization_id)
    acc[key] ??= []
    acc[key].push(event)
    return acc
  }, {})
  for (const [key, events] of Object.entries(usageEventsBySource)) {
    usageHistoryBySource.set(key, buildUsageHistory(events, usdToEurRate, isClientOwnedEvent))
  }

  const clientKeys = new Set<string>([
    ...settings.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...subscriptions.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...quotas.map((item) => orgKey(item.source_instance, item.organization_id)),
  ])

  const clientRows = Array.from(clientKeys).map((key) => {
    const setting = settingsBySource.get(key)
    const subscription = subscriptionsBySource.get(key)
    const client = clientsBySource.get(key)
    const sourceInstance = setting?.source_instance ?? subscription?.source_instance ?? client?.source_instance ?? key.split('::')[0]
    const organizationId = setting?.organization_id ?? subscription?.organization_id ?? client?.organization_id ?? null
    const isOrganizationResolved = Boolean(organizationId) && organizationId !== UNRESOLVED_ORGANIZATION_ID
    const monthEvents = currentMonthEventsBySource[key] ?? []
    const successfulMonthEvents = monthEvents.filter((event) => event.status === 'success')
    const billingCurrency = (subscription?.billing_currency ?? setting?.billing_currency ?? 'EUR') as 'EUR' | 'USD'
    const aiBillingMode = normalizeAIBillingMode(subscription?.ai_billing_mode)
    const monthlyFee = normalizeFee(subscription?.mrr_ht ?? setting?.monthly_fee_ht)
    const monthUsageCostEur = successfulMonthEvents.reduce((sum, event) => sum + convertProviderCostToEur(event.provider_cost, event.currency, usdToEurRate), 0)
    const monthUsageCost = convertEurToCurrency(monthUsageCostEur, billingCurrency, usdToEurRate)
    const monthCost = aiBillingMode === 'client_owned' ? 0 : monthUsageCost
    const monthCostEur = aiBillingMode === 'client_owned' ? 0 : monthUsageCostEur
    const grossMargin = monthlyFee === null ? null : monthlyFee - monthCost
    const grossMarginEur = grossMargin === null ? null : convertAmountToEur(grossMargin, billingCurrency, usdToEurRate)
    const marginPct = monthlyFee && monthlyFee > 0 && grossMargin !== null ? (grossMargin / monthlyFee) * 100 : null
    const latestEvent = latestEventBySource.get(key)
    const label = setting?.label?.trim() || client?.label?.trim() || sourceInstance
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
    const usageHistoryForClient = usageHistoryBySource.get(key) ?? buildUsageHistory([], usdToEurRate)

    return {
      sourceInstance,
      organizationId,
      isOrganizationResolved,
      label,
      tier: subscription?.tier ?? 'setup_only',
      appUrl: setting?.app_url ?? null,
      contactEmail: setting?.contact_email ?? null,
      configSyncStatus: setting?.config_sync_status ?? null,
      configSyncError: setting?.config_sync_error ?? null,
      monthlyFee,
      billingCurrency,
      aiBillingMode,
      isArchived: setting?.is_active === false,
      isActive: subscription?.is_active ?? setting?.is_active ?? true,
      renewsAt: subscription?.renews_at ?? null,
      trialEndsAt: subscription?.trial_ends_at ?? null,
      trialConverted: Boolean(subscription?.trial_converted),
      preferredTier: subscription?.preferred_tier === 'expert' ? 'expert' : 'pro',
      accessStatus: subscription?.access_status ?? null,
      accessEndsAt: subscription?.access_ends_at ?? null,
      cancelAt: subscription?.cancel_at ?? null,
      stripeStatus: subscription?.stripe_status ?? null,
      paymentFailedAt: subscription?.payment_failed_at ?? null,
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
      modules: isOrganizationResolved && modulesByOrgId.has(organizationId)
        ? normalizeOrganizationModules(modulesByOrgId.get(organizationId) ?? {})
        : normalizeOrganizationModules({}),
      businessActivityId: isOrganizationResolved ? verticalPackByOrgId.get(organizationId)?.activityId ?? null : null,
      businessVerticalPackId: isOrganizationResolved ? verticalPackByOrgId.get(organizationId)?.packId ?? null : null,
      hasMetalPricing: isOrganizationResolved ? verticalPackByOrgId.get(organizationId)?.hasMetalPricing ?? false : false,
      quotas: (quotasBySource[key] ?? []).slice().sort((a, b) => {
        const period = b.period_start.localeCompare(a.period_start)
        if (period !== 0) return period
        const aLabel = QUOTA_DEFINITIONS[a.quota_feature]?.label ?? a.quota_feature
        const bLabel = QUOTA_DEFINITIONS[b.quota_feature]?.label ?? b.quota_feature
        return aLabel.localeCompare(bLabel, 'fr')
      }),
      events: operatorEventsBySource[key] ?? [],
      commercialEvents: commercialEventsBySource[key] ?? [],
      usageHistory: usageHistoryForClient,
    } satisfies ClientRow
  }).sort((a, b) => {
    if (a.isArchived !== b.isArchived) return a.isArchived ? 1 : -1
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    return a.label.localeCompare(b.label, 'fr')
  })

  const activeRows = clientRows.filter((row) => row.isActive && !row.isArchived)
  const rowsWithFee = activeRows.filter((row) => row.monthlyFee !== null)
  const revenueTotalEur = rowsWithFee.reduce((sum, row) => sum + convertAmountToEur(row.monthlyFee ?? 0, row.billingCurrency, usdToEurRate), 0)
  const costTotalEur = activeRows.reduce((sum, row) => sum + row.monthCostEur, 0)
  const usageTotalEur = activeRows.reduce((sum, row) => sum + row.monthUsageCostEur, 0)
  const grossMarginTotalEur = revenueTotalEur - costTotalEur
  const marginRate = revenueTotalEur > 0 ? (grossMarginTotalEur / revenueTotalEur) * 100 : null
  const lowMarginRows = rowsWithFee.slice().sort((a, b) => (a.grossMarginEur ?? Infinity) - (b.grossMarginEur ?? Infinity)).slice(0, 5)
  const expensiveRows = activeRows.slice().sort((a, b) => b.monthUsageCostEur - a.monthUsageCostEur).slice(0, 5)
  const rowBySource = new Map(clientRows.map((row) => [orgKey(row.sourceInstance, row.organizationId), row]))
  const successfulUsageEvents = usageEvents.filter((event) => event.status === 'success' && event.occurred_at.slice(0, 10) >= currentMonth)

  function buildUsageAggregate(keyGetter: (event: OperatorUsageEvent) => string, labelGetter: (event: OperatorUsageEvent) => string): UsageAggregateRow[] {
    const aggregates = new Map<string, UsageAggregateRow>()
    for (const event of successfulUsageEvents) {
      const key = keyGetter(event)
      const sourceRow = rowBySource.get(orgKey(event.source_instance, event.organization_id))
      const usageCostEur = convertProviderCostToEur(event.provider_cost, event.currency, usdToEurRate)
      const current = aggregates.get(key) ?? { key, label: labelGetter(event), events: 0, tokens: 0, usageCostEur: 0, orsaynCostEur: 0 }
      current.events += 1
      current.tokens += Number(event.total_tokens ?? 0)
      current.usageCostEur += usageCostEur
      current.orsaynCostEur += getAiBillingModeFromEvent(event, sourceRow) === 'client_owned' ? 0 : usageCostEur
      aggregates.set(key, current)
    }
    return [...aggregates.values()].sort((a, b) => b.usageCostEur - a.usageCostEur)
  }

  const featureUsageRows = buildUsageAggregate((event) => event.quota_feature ?? event.feature, getUsageFeatureLabel).slice(0, 6)
  const modelUsageRows = buildUsageAggregate((event) => `${event.provider}:${event.model}`, (event) => `${event.provider} · ${event.model}`).slice(0, 6)
  const pricingSignalRows = activeRows.filter((row) => row.monthUsageCostEur > 0).slice().sort((a, b) => b.monthUsageCostEur - a.monthUsageCostEur).slice(0, 6)

  const recommendations = activeRows.flatMap((row): CommercialRecommendation[] => {
    const items: CommercialRecommendation[] = []
    const suggestedTier = getSuggestedTier(row.tier)
    const usageCostLabel = formatMoney(row.monthUsageCostEur)
    const maxQuota = getLatestQuotaRows(row.quotas).reduce<{ feature: string; pct: number; label: string } | null>((current, quota) => {
      const monthly = normalizeNumber(quota.quota_monthly)
      const consumed = normalizeNumber(quota.current_quantity)
      if (monthly <= 0) return current
      const pct = (consumed / monthly) * 100
      return !current || pct > current.pct ? {
        feature: quota.quota_feature,
        pct,
        label: QUOTA_DEFINITIONS[quota.quota_feature]?.label ?? 'Autre consommation IA',
      } : current
    }, null)
    const idPrefix = `${row.sourceInstance}-${row.organizationId ?? 'unknown'}`
    if (row.aiBillingMode === 'orsayn_shared' && maxQuota && maxQuota.pct >= 90 && row.tier !== 'expert') {
      items.push({ id: `${idPrefix}-quota-${maxQuota.feature}`, sourceInstance: row.sourceInstance, organizationId: row.organizationId, clientLabel: row.label, title: 'Forfait presque atteint', reason: `${maxQuota.label} atteint ${Math.round(maxQuota.pct)} % du forfait.`, severity: maxQuota.pct >= 100 ? 'high' : 'medium', eventType: 'upgrade_prompt_quota', currentTier: row.tier, suggestedTier, usageCostLabel, notePlaceholder: `Proposer ${suggestedTier} pour ${maxQuota.label}` })
    }
    if (row.aiBillingMode === 'orsayn_shared' && row.marginPct !== null && row.marginPct < 85) {
      items.push({ id: `${idPrefix}-margin`, sourceInstance: row.sourceInstance, organizationId: row.organizationId, clientLabel: row.label, title: 'Marge à surveiller', reason: `Marge estimée ${formatPercent(row.marginPct)} avec le coût IA pris en charge.`, severity: row.marginPct < 70 ? 'high' : 'medium', eventType: 'upgrade_prompt_quota', currentTier: row.tier, suggestedTier, usageCostLabel, notePlaceholder: 'Préparer un échange tarifaire' })
    }
    if (row.aiBillingMode === 'client_owned' && row.monthUsageCostEur >= 1) {
      items.push({ id: `${idPrefix}-client-owned-usage`, sourceInstance: row.sourceInstance, organizationId: row.organizationId, clientLabel: row.label, title: 'Consommation élevée', reason: `${usageCostLabel} de consommation indicative avec la clé du client.`, severity: 'low', eventType: 'usage_signal_client_owned', currentTier: row.tier, suggestedTier, usageCostLabel, notePlaceholder: 'Noter ce signal, sans modifier le forfait' })
    }
    return items
  }).sort((a, b) => ({ high: 3, medium: 2, low: 1 }[b.severity] - ({ high: 3, medium: 2, low: 1 }[a.severity]))).slice(0, 8)

  const pendingAlerts = commercialEvents.filter((event) => event.delivery_status === 'pending_review')
  const sentEmails = commercialEvents.filter((event) => event.delivery_status !== 'pending_review')
  const emailClients = clientRows.filter((row) => row.isActive && !row.isArchived).map((row) => ({
    sourceInstance: row.sourceInstance,
    organizationId: row.organizationId,
    label: row.label,
    tier: row.tier,
    recipientEmail: row.contactEmail ?? row.commercialEvents.find((event) => event.recipient_email)?.recipient_email ?? null,
  }))
  const syncAttentionRows = clientRows.filter((row) => !row.isArchived && ['failed', 'pending_manual'].includes(row.configSyncStatus ?? ''))
  const trialEndingRows = activeRows.filter((row) => {
    if (!row.trialEndsAt || row.trialConverted) return false
    const remaining = new Date(row.trialEndsAt).getTime() - Date.now()
    return remaining > 0 && remaining <= 7 * 24 * 60 * 60 * 1000
  })
  const paymentAttentionRows = activeRows.filter((row) => Boolean(row.paymentFailedAt) || ['past_due', 'unpaid'].includes(row.stripeStatus ?? ''))

  return {
    user,
    clientRows,
    activeRows,
    recentEvents,
    usageHistory,
    featureUsageRows,
    modelUsageRows,
    pricingSignalRows,
    recommendations,
    lowMarginRows,
    expensiveRows,
    failedWebhookEvents,
    pendingAlerts,
    sentEmails,
    emailClients,
    usdToEurRate,
    revenueTotalEur,
    costTotalEur,
    usageTotalEur,
    grossMarginTotalEur,
    marginRate,
    missingBillingCount: clientRows.filter((row) => !row.isArchived && row.monthlyFee === null).length,
    syncAttentionRows,
    trialEndingRows,
    paymentAttentionRows,
  }
}
