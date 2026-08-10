import { notFound } from 'next/navigation'
import { recordOperatorCommercialAction, upsertOperatorClientSettings } from './actions'
import EmailsTab from './EmailsTab'
import ClientsTable from './ClientsTable'
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
} from './types'
import {
  clientKey,
  convertAmountToEur,
  convertProviderCostToEur,
  convertUsdToCurrency,
  formatAIBillingMode,
  formatCommercialStatus,
  formatCompactNumber,
  formatDate,
  formatMoney,
  formatPercent,
  getRecommendationClass,
  getSuggestedTier,
  getUsageFeatureLabel,
  normalizeAIBillingMode,
  normalizeFee,
  normalizeNumber,
} from './utils'

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
    failedWebhookEventsResult,
  ] = await Promise.all([
    operator
      .from('operator_client_settings')
      .select('source_instance, organization_id, label, monthly_fee_ht, billing_currency, is_active, app_url, contact_email, config_sync_status, config_synced_at, config_sync_error')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_client_subscriptions')
      .select('source_instance, organization_id, tier, ai_billing_mode, mrr_ht, billing_currency, is_active, renews_at, trial_tier, trial_started_at, trial_ends_at, trial_converted, preferred_tier, access_status, access_ends_at, cancel_at, stripe_status, payment_failed_at, b2brouter_active, einvoicing_mode, einvoicing_provider, einvoicing_environment, einvoicing_onboarding_model, b2brouter_account_id, einvoicing_annuaire_status, overflow_mode, notes')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_client_quotas')
      .select('source_instance, organization_id, quota_feature, quota_unit, quota_monthly, current_quantity, current_cost_eur, period_start')
      .eq('period_start', monthStartIso.slice(0, 10))
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_clients')
      .select('source_instance, organization_id, label, updated_at')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_usage_events')
      .select('source_instance, organization_id, provider, feature, quota_feature, model, provider_cost, currency, total_tokens, status, occurred_at')
      .gte('occurred_at', monthStartIso)
      .order('occurred_at', { ascending: false })
      .limit(5000),
    operator
      .from('operator_usage_events')
      .select('source_instance, organization_id, provider, feature, quota_feature, model, provider_cost, currency, total_tokens, status, occurred_at')
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

  if (settingsResult.error || subscriptionsResult.error || quotasResult.error || clientsResult.error || monthlyEventsResult.error || recentEventsResult.error || operatorEventsResult.error || commercialEventsResult.error || failedWebhookEventsResult.error) {
    console.error('[orsayn.page]', {
      settings: settingsResult.error,
      subscriptions: subscriptionsResult.error,
      quotas: quotasResult.error,
      clients: clientsResult.error,
      monthlyEvents: monthlyEventsResult.error,
      recentEvents: recentEventsResult.error,
      operatorEvents: operatorEventsResult.error,
      commercialEvents: commercialEventsResult.error,
      failedWebhookEvents: failedWebhookEventsResult.error,
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
  const failedWebhookEvents = failedWebhookEventsResult.data ?? []

  // Clé composite : une instance mutualisée porte plusieurs organisations, chacune
  // avec son propre tier/settings/quotas — une clé source_instance seule les fusionnerait.
  // organization_id peut être null sur operator_clients (usage historique per-client
  // pas encore synchronisé) ou operator_client_events/commercial_events (broadcast,
  // paiement orphelin) : ces lignes sont alors rattachées via UNRESOLVED_ORGANIZATION_ID
  // côté écriture, mais on garde un fallback ici par robustesse de lecture.
  const orgKey = clientKey

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

  // Charger les modules pour tous les clients ayant un organization_id résolu
  // (exclut la sentinelle : paiements orphelins/broadcast n'ont pas d'org réelle)
  const orgIds = [...new Set(
    clients.map((c) => c.organization_id).filter((id): id is string => !!id && id !== UNRESOLVED_ORGANIZATION_ID)
  )]
  const admin = createAdminClient()
  const { data: modulesRows } = orgIds.length > 0
    ? await admin.from('organization_modules').select('organization_id, modules').in('organization_id', orgIds)
    : { data: [] }
  const modulesByOrgId = new Map((modulesRows ?? []).map((r) => [r.organization_id, r.modules]))

  // Charger l'activité + pack verticale + module métal pour ces mêmes organisations
  const { data: verticalPackRows } = orgIds.length > 0
    ? await admin.from('organizations').select('id, business_activity_id, business_vertical_pack, has_metal_pricing').in('id', orgIds)
    : { data: [] }
  const verticalPackByOrgId = new Map(
    (verticalPackRows ?? []).map((r) => [r.id, { activityId: r.business_activity_id, packId: r.business_vertical_pack, hasMetalPricing: Boolean(r.has_metal_pricing) }])
  )

  const latestEventBySource = new Map<string, OperatorUsageEvent>()

  for (const event of recentEvents) {
    const key = orgKey(event.source_instance, event.organization_id)
    if (!latestEventBySource.has(key)) {
      latestEventBySource.set(key, event)
    }
  }

  const monthlyEventsBySource = monthlyEvents.reduce<Record<string, OperatorUsageEvent[]>>((acc, event) => {
    const key = orgKey(event.source_instance, event.organization_id)
    acc[key] ??= []
    acc[key].push(event)
    return acc
  }, {})

  // Une ligne cockpit par (source_instance, organization_id) — pas par instance
  // seule, sinon une instance mutualisée à N organisations n'en affiche qu'une.
  const clientKeys = new Set<string>([
    ...settings.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...subscriptions.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...quotas.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...clients.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...monthlyEvents.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...operatorEvents.map((item) => orgKey(item.source_instance, item.organization_id)),
    ...commercialEvents.map((item) => orgKey(item.source_instance, item.organization_id)),
  ])

  const clientRows = Array.from(clientKeys).map((key) => {
    const setting = settingsBySource.get(key)
    const subscription = subscriptionsBySource.get(key)
    const client = clientsBySource.get(key)
    const sourceInstance = setting?.source_instance ?? subscription?.source_instance ?? client?.source_instance ?? key.split('::')[0]
    const organizationId = setting?.organization_id ?? subscription?.organization_id ?? client?.organization_id ?? null
    const monthEvents = monthlyEventsBySource[key] ?? []
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
    const latestEvent = latestEventBySource.get(key)
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
      organizationId,
      label,
      tier: subscription?.tier ?? 'setup_only',
      appUrl: setting?.app_url ?? null,
      contactEmail: setting?.contact_email ?? null,
      configSyncStatus: setting?.config_sync_status ?? null,
      configSyncError: setting?.config_sync_error ?? null,
      monthlyFee,
      billingCurrency,
      aiBillingMode,
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
      modules: (organizationId ? modulesByOrgId.get(organizationId) : null)
        ? normalizeOrganizationModules(modulesByOrgId.get(organizationId!) ?? {})
        : normalizeOrganizationModules({}),
      businessActivityId: (organizationId ? verticalPackByOrgId.get(organizationId) : null)?.activityId ?? null,
      businessVerticalPackId: (organizationId ? verticalPackByOrgId.get(organizationId) : null)?.packId ?? null,
      hasMetalPricing: (organizationId ? verticalPackByOrgId.get(organizationId) : null)?.hasMetalPricing ?? false,
      quotas: (quotasBySource[key] ?? []).sort((a, b) => {
        const aDef = QUOTA_DEFINITIONS[a.quota_feature]
        const bDef = QUOTA_DEFINITIONS[b.quota_feature]
        return (aDef?.label ?? a.quota_feature).localeCompare(bDef?.label ?? b.quota_feature, 'fr')
      }),
      events: operatorEventsBySource[key] ?? [],
      commercialEvents: commercialEventsBySource[key] ?? [],
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
  const pendingManualRows = clientRows.filter((row) => row.configSyncStatus === 'pending_manual')
  // Une instance mutualisée (plusieurs organisations sur le même sourceInstance) n'a
  // souvent besoin que d'un seul app_url — "app_url manquant" n'y est donc pas un vrai
  // échec de synchro mais un champ à renseigner une fois pour l'instance entière.
  const instanceOrgCount = clientRows.reduce<Record<string, number>>((acc, row) => {
    acc[row.sourceInstance] = (acc[row.sourceInstance] ?? 0) + 1
    return acc
  }, {})
  const sharedAppUrlRows = pendingManualRows.filter(
    (row) => row.configSyncError === 'app_url manquant' && (instanceOrgCount[row.sourceInstance] ?? 0) > 1,
  )
  const missingOrgIdRows = pendingManualRows.filter((row) => row.configSyncError === 'organization_id manquant')
  // pending_manual sans erreur ni synchro passée = jamais tenté (préconfiguré via le
  // formulaire "Ajouter/préconfigurer" qui ne pousse pas la config), pas un échec réel.
  const neverAttemptedRows = pendingManualRows.filter(
    (row) => !row.configSyncError && !row.lastSeenAt && !sharedAppUrlRows.includes(row) && !missingOrgIdRows.includes(row),
  )
  const technicalFailureRows = pendingManualRows.filter(
    (row) => !sharedAppUrlRows.includes(row) && !missingOrgIdRows.includes(row) && !neverAttemptedRows.includes(row),
  )
  const lowMarginRows = rowsWithFee
    .slice()
    .sort((a, b) => (a.grossMarginEur ?? Number.POSITIVE_INFINITY) - (b.grossMarginEur ?? Number.POSITIVE_INFINITY))
    .slice(0, 5)
  const expensiveRows = activeRows
    .slice()
    .sort((a, b) => b.monthUsageCostEur - a.monthUsageCostEur)
    .slice(0, 5)

  const rowBySource = new Map(clientRows.map((row) => [orgKey(row.sourceInstance, row.organizationId), row]))
  const successfulUsageEvents = monthlyEvents.filter((event) => event.status === 'success')

  function buildUsageAggregate(
    keyGetter: (event: OperatorUsageEvent) => string,
    labelGetter: (event: OperatorUsageEvent) => string,
  ): UsageAggregateRow[] {
    const aggregates = new Map<string, UsageAggregateRow>()

    for (const event of successfulUsageEvents) {
      const key = keyGetter(event)
      const sourceRow = rowBySource.get(orgKey(event.source_instance, event.organization_id))
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

      {sharedAppUrlRows.length > 0 && (
        <section className="card border-l-4 border-l-amber-500 bg-amber-500/5 px-6 py-4">
          <p className="text-sm font-bold text-amber-700 font-display">
            {sharedAppUrlRows.length} organisation{sharedAppUrlRows.length > 1 ? 's' : ''} sans URL d&apos;app propre (instance mutualisée)
          </p>
          <p className="mt-1 text-xs text-secondary font-body">
            Ces organisations partagent une même instance avec d&apos;autres clients — une seule URL d&apos;app suffit pour toutes.
            Renseignez <span className="font-mono">app_url</span> (même valeur) sur chacune, puis relancez &quot;Resync config&quot;.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-secondary font-body">
            {sharedAppUrlRows.map((row) => (
              <li key={`${row.sourceInstance}:${row.organizationId}`}>
                <span className="font-semibold text-primary">{row.label}</span> ({row.sourceInstance}, {instanceOrgCount[row.sourceInstance]} organisations sur cette instance)
              </li>
            ))}
          </ul>
        </section>
      )}

      {missingOrgIdRows.length > 0 && (
        <section className="card border-l-4 border-l-red-500 bg-red-500/5 px-6 py-4">
          <p className="text-sm font-bold text-red-700 font-display">
            {missingOrgIdRows.length} instance{missingOrgIdRows.length > 1 ? 's' : ''} sans organisation résolue
          </p>
          <p className="mt-1 text-xs text-secondary font-body">
            Le dernier changement de tier/module n&apos;a pas atteint l&apos;instance cliente — le client peut avoir payé sans que ses droits
            aient été mis à jour. Vérifier <span className="font-mono">organization_id</span> puis relancer &quot;Resync config&quot;.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-secondary font-body">
            {missingOrgIdRows.map((row) => (
              <li key={`${row.sourceInstance}:${row.organizationId}`}>
                <span className="font-semibold text-primary">{row.label}</span> ({row.sourceInstance})
              </li>
            ))}
          </ul>
        </section>
      )}

      {neverAttemptedRows.length > 0 && (
        <section className="card border-l-4 border-l-slate-400 bg-slate-500/5 px-6 py-4">
          <p className="text-sm font-bold text-slate-700 font-display dark:text-slate-200">
            {neverAttemptedRows.length} organisation{neverAttemptedRows.length > 1 ? 's' : ''} préconfigurée{neverAttemptedRows.length > 1 ? 's' : ''}, jamais synchronisée{neverAttemptedRows.length > 1 ? 's' : ''}
          </p>
          <p className="mt-1 text-xs text-secondary font-body">
            Créées via le formulaire de préconfiguration, aucune offre n&apos;a encore été appliquée ni de synchro tentée — ce n&apos;est pas un échec.
            Ouvrir la fiche puis &quot;Appliquer l&apos;offre&quot; (onglet Offre) pour lancer la première synchro.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-secondary font-body">
            {neverAttemptedRows.map((row) => (
              <li key={`${row.sourceInstance}:${row.organizationId}`}>
                <span className="font-semibold text-primary">{row.label}</span> ({row.sourceInstance})
              </li>
            ))}
          </ul>
        </section>
      )}

      {technicalFailureRows.length > 0 && (
        <section className="card border-l-4 border-l-red-500 bg-red-500/5 px-6 py-4">
          <p className="text-sm font-bold text-red-700 font-display">
            {technicalFailureRows.length} instance{technicalFailureRows.length > 1 ? 's' : ''} en échec technique de synchro
          </p>
          <p className="mt-1 text-xs text-secondary font-body">
            La configuration n&apos;a pas pu être poussée vers l&apos;app cliente (réseau, signature HMAC, ou app indisponible).
            Vérifier la connectivité de l&apos;instance puis relancer &quot;Resync config&quot;.
          </p>
          <ul className="mt-2 space-y-1 text-xs text-secondary font-body">
            {technicalFailureRows.map((row) => (
              <li key={`${row.sourceInstance}:${row.organizationId}`}>
                <span className="font-semibold text-primary">{row.label}</span> ({row.sourceInstance})
                {row.configSyncError ? <span className="font-medium text-red-600"> — {row.configSyncError}</span> : ''}
              </li>
            ))}
          </ul>
        </section>
      )}

      {failedWebhookEvents.length > 0 && (
        <section className="card border-l-4 border-l-red-500 bg-red-500/5 px-6 py-4">
          <p className="text-sm font-bold text-red-700 font-display">{failedWebhookEvents.length} événement(s) Stripe à retraiter</p>
          <p className="mt-1 text-xs text-secondary">Une nouvelle livraison Stripe rejouera ces événements : les échecs ne sont plus marqués comme définitivement consommés.</p>
          <ul className="mt-2 space-y-1 text-xs text-secondary">
            {failedWebhookEvents.slice(0, 5).map((event) => (
              <li key={event.source_id}><span className="font-mono">{event.event_type}</span> — {event.error_msg || 'erreur inconnue'}</li>
            ))}
          </ul>
        </section>
      )}

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
              <div key={`${row.sourceInstance}:${row.organizationId}`} className="rounded-lg border border-[var(--elevation-border)] bg-interactive/40 px-4 py-3">
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
              <span className="font-semibold text-primary text-xs uppercase tracking-wide font-display">organization_id (SaaS mutualisé)</span>
              <input
                name="organizationId"
                placeholder="laisser vide pour une instance per-client"
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
            <div key={`${row.sourceInstance}:${row.organizationId}`} className="flex items-center justify-between gap-4 text-sm">
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
            <div key={`${row.sourceInstance}:${row.organizationId}`} className="flex items-center justify-between gap-4 text-sm">
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
            Cliquez une ligne pour ouvrir sa fiche complète (offre, cycle de vie, modules, suivi).
          </p>
        </div>

        <ClientsTable rows={clientRows} />
      </section>

      {/* ── Module emails cockpit ────────────────────────────────────────── */}
      {(() => {
        const pendingAlerts = commercialEvents.filter((e) => e.delivery_status === 'pending_review')
        const sentEmails = commercialEvents.filter((e) => e.delivery_status !== 'pending_review')
        const emailClients = clientRows
          .filter((row) => row.isActive)
          .map((row) => ({
            sourceInstance: row.sourceInstance,
            organizationId: row.organizationId,
            label: row.label,
            tier: row.tier,
            recipientEmail: row.contactEmail
              ?? (row.commercialEvents.find((e) => e.recipient_email)?.recipient_email)
              ?? null,
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
                  <td className="py-3 text-primary">{settingsBySource.get(orgKey(event.source_instance, event.organization_id))?.label || event.source_instance}</td>
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
