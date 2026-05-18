import { notFound } from 'next/navigation'
import { upsertOperatorClientSettings, upsertOperatorClientModules, upsertOperatorSubscription } from './actions'
import { getOperatorUsdToEurRate } from '@/lib/operator'
import { getOperatorUser } from '@/lib/operator-auth'
import { createOperatorAdminClient } from '@/lib/supabase/operator'
import { createAdminClient } from '@/lib/supabase/admin'
import { ORGANIZATION_MODULE_KEYS, normalizeOrganizationModules, type OrganizationModules } from '@/lib/organization-modules'
import {
  QUOTA_DEFINITIONS,
  SUBSCRIPTION_TIERS,
  OVERFLOW_MODES,
  type OverflowMode,
  type QuotaFeature,
  type QuotaUnit,
  type SubscriptionTier,
} from '@/lib/quota-catalog'

type OperatorUsageEvent = {
  source_instance: string
  provider: string
  feature: string
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
  mrr_ht: number | string | null
  billing_currency: 'EUR' | 'USD'
  is_active: boolean
  renews_at: string | null
  trial_tier: SubscriptionTier | null
  trial_ends_at: string | null
  b2brouter_active: boolean
  overflow_mode: OverflowMode
  notes: string | null
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
  isActive: boolean
  renewsAt: string | null
  trialEndsAt: string | null
  b2brouterActive: boolean
  overflowMode: OverflowMode
  notes: string | null
  monthCost: number
  monthCostEur: number
  grossMargin: number | null
  grossMarginEur: number | null
  marginPct: number | null
  lastSeenAt: string | null
  lastStatus: string | null
  monthEventCount: number
  modules: OrganizationModules
  quotas: OperatorClientQuota[]
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

function formatQuotaValue(value: number): string {
  if (value < 0) return 'Illimité'
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(value)
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
  ] = await Promise.all([
    operator
      .from('operator_client_settings')
      .select('source_instance, label, monthly_fee_ht, billing_currency, is_active, app_url, config_sync_status, config_synced_at, config_sync_error')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_client_subscriptions')
      .select('source_instance, tier, mrr_ht, billing_currency, is_active, renews_at, trial_tier, trial_ends_at, b2brouter_active, overflow_mode, notes')
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
      .select('source_instance, provider, feature, model, provider_cost, currency, total_tokens, status, occurred_at')
      .gte('occurred_at', monthStartIso)
      .order('occurred_at', { ascending: false })
      .limit(5000),
    operator
      .from('operator_usage_events')
      .select('source_instance, provider, feature, model, provider_cost, currency, total_tokens, status, occurred_at')
      .order('occurred_at', { ascending: false })
      .limit(200),
  ])

  if (settingsResult.error || subscriptionsResult.error || quotasResult.error || clientsResult.error || monthlyEventsResult.error || recentEventsResult.error) {
    console.error('[orsayn.page]', {
      settings: settingsResult.error,
      subscriptions: subscriptionsResult.error,
      quotas: quotasResult.error,
      clients: clientsResult.error,
      monthlyEvents: monthlyEventsResult.error,
      recentEvents: recentEventsResult.error,
    })
    notFound()
  }

  const settings = (settingsResult.data ?? []) as OperatorClientSetting[]
  const subscriptions = (subscriptionsResult.data ?? []) as OperatorClientSubscription[]
  const quotas = (quotasResult.data ?? []) as OperatorClientQuota[]
  const clients = (clientsResult.data ?? []) as OperatorClient[]
  const monthlyEvents = (monthlyEventsResult.data ?? []) as OperatorUsageEvent[]
  const recentEvents = (recentEventsResult.data ?? []) as OperatorUsageEvent[]

  const settingsBySource = new Map(settings.map((item) => [item.source_instance, item]))
  const subscriptionsBySource = new Map(subscriptions.map((item) => [item.source_instance, item]))
  const clientsBySource = new Map(clients.map((item) => [item.source_instance, item]))
  const quotasBySource = quotas.reduce<Record<string, OperatorClientQuota[]>>((acc, quota) => {
    acc[quota.source_instance] ??= []
    acc[quota.source_instance].push(quota)
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
  ])

  const clientRows = Array.from(sourceInstances).map((sourceInstance) => {
    const setting = settingsBySource.get(sourceInstance)
    const subscription = subscriptionsBySource.get(sourceInstance)
    const client = clientsBySource.get(sourceInstance)
    const monthEvents = monthlyEventsBySource[sourceInstance] ?? []
    const successfulMonthEvents = monthEvents.filter((event) => event.status === 'success')
    const monthCostUsd = successfulMonthEvents.reduce((sum, event) => sum + Number(event.provider_cost ?? 0), 0)
    const billingCurrency = (subscription?.billing_currency ?? setting?.billing_currency ?? 'EUR') as 'EUR' | 'USD'
    const monthlyFee = normalizeFee(subscription?.mrr_ht ?? setting?.monthly_fee_ht)
    const monthCost = convertUsdToCurrency(monthCostUsd, billingCurrency, usdToEurRate)
    const monthCostEur = convertUsdToCurrency(monthCostUsd, 'EUR', usdToEurRate)
    const grossMargin = monthlyFee === null ? null : monthlyFee - monthCost
    const grossMarginEur = grossMargin === null ? null : convertAmountToEur(grossMargin, billingCurrency, usdToEurRate)
    const marginPct = monthlyFee && monthlyFee > 0 && grossMargin !== null
      ? (grossMargin / monthlyFee) * 100
      : null
    const latestEvent = latestEventBySource.get(sourceInstance)
    const label = setting?.label?.trim()
      || client?.label?.trim()
      || sourceInstance

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
      isActive: subscription?.is_active ?? setting?.is_active ?? true,
      renewsAt: subscription?.renews_at ?? null,
      trialEndsAt: subscription?.trial_ends_at ?? null,
      b2brouterActive: subscription?.b2brouter_active ?? false,
      overflowMode: subscription?.overflow_mode ?? 'block',
      notes: subscription?.notes ?? null,
      monthCost,
      monthCostEur,
      grossMargin,
      grossMarginEur,
      marginPct,
      lastSeenAt: latestEvent?.occurred_at ?? client?.updated_at ?? null,
      lastStatus: latestEvent?.status ?? null,
      monthEventCount: monthEvents.length,
      modules: modulesBySource.get(sourceInstance) ?? normalizeOrganizationModules({}),
      quotas: (quotasBySource[sourceInstance] ?? []).sort((a, b) => {
        const aDef = QUOTA_DEFINITIONS[a.quota_feature]
        const bDef = QUOTA_DEFINITIONS[b.quota_feature]
        return (aDef?.label ?? a.quota_feature).localeCompare(bDef?.label ?? b.quota_feature, 'fr')
      }),
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
  const grossMarginTotalEur = revenueTotalEur - costTotalEur
  const marginRate = revenueTotalEur > 0 ? (grossMarginTotalEur / revenueTotalEur) * 100 : null
  const missingBillingRows = clientRows.filter((row) => row.monthlyFee === null)
  const lowMarginRows = rowsWithFee
    .slice()
    .sort((a, b) => (a.grossMarginEur ?? Number.POSITIVE_INFINITY) - (b.grossMarginEur ?? Number.POSITIVE_INFINITY))
    .slice(0, 5)
  const expensiveRows = activeRows
    .slice()
    .sort((a, b) => b.monthCostEur - a.monthCostEur)
    .slice(0, 5)

  const inputCls = "w-full input-glass px-4 py-3 text-primary font-body text-sm outline-none"
  const inputSmCls = "w-full input-glass px-3 py-2 text-primary font-body text-xs outline-none"

  return (
    <main className="flex-1 px-6 py-8 max-w-[1500px] mx-auto w-full space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold text-primary tracking-tight">Cockpit Orsayn</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary font-body">
            Pilotage privé des coûts IA et de la marge par client. Les coûts fournisseurs restent journalisés en USD,
            puis convertis en EUR pour les synthèses globales avec un taux fixe V1 de {usdToEurRate.toFixed(2)}.
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
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Coût IA du mois</p>
          <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(costTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary font-body">Équivalent EUR sur {activeRows.length} client(s) actif(s).</p>
        </section>
        <section className="card px-8 py-6">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">CA mensuel saisi</p>
          <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(revenueTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary font-body">{rowsWithFee.length} client(s) avec forfait renseigné.</p>
        </section>
        <section className="card px-8 py-6">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Marge brute estimée</p>
          <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(grossMarginTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary font-body">Comparaison forfait mensuel HT vs coût IA du mois.</p>
        </section>
        <section className="card px-8 py-6">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Taux de marge</p>
          <p className="mt-3 text-3xl font-extrabold text-accent font-display tabular-nums">{formatPercent(marginRate)}</p>
          <p className="mt-2 text-sm text-secondary font-body">{missingBillingRows.length} client(s) encore à compléter.</p>
        </section>
      </div>

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
              <span className="text-right text-secondary font-display tabular-nums text-xs">{formatMoney(row.monthCostEur)}</span>
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
                    <td className="py-4 pr-4 text-secondary tabular-nums">{row.tier}</td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">
                      {row.monthlyFee === null ? 'À compléter' : formatMoney(row.monthlyFee, row.billingCurrency)}
                    </td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">{formatMoney(row.monthCost, row.billingCurrency)}</td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">
                      {row.grossMargin === null ? 'À compléter' : formatMoney(row.grossMargin, row.billingCurrency)}
                    </td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">{formatPercent(row.marginPct)}</td>
                    <td className="py-4 pr-4 text-secondary tabular-nums">{formatDate(row.lastSeenAt)}</td>
                    <td className="py-4">
                      <form action={upsertOperatorSubscription} className="grid gap-2 rounded-lg border border-[var(--elevation-border)] bg-interactive/40 dark:bg-white/[0.02] p-3 backdrop-blur-frost">
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
                        <input
                          name="renewsAt"
                          type="date"
                          defaultValue={formatDateInput(row.renewsAt)}
                          className={inputSmCls}
                        />
                        <textarea
                          name="notes"
                          defaultValue={row.notes ?? ''}
                          placeholder="Notes abonnement"
                          rows={2}
                          className={inputSmCls}
                        />
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                          <label className="flex items-center gap-2 text-xs text-secondary font-body">
                            <input
                              name="isActive"
                              type="checkbox"
                              defaultChecked={row.isActive}
                              className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
                            />
                            Actif
                          </label>
                          <label className="flex items-center gap-2 text-xs text-secondary font-body">
                            <input
                              name="trialActive"
                              type="checkbox"
                              defaultChecked={!!row.trialEndsAt && new Date(row.trialEndsAt) > new Date()}
                              className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
                            />
                            Essai 30j
                          </label>
                          <label className="flex items-center gap-2 text-xs text-secondary font-body">
                            <input
                              name="b2brouterActive"
                              type="checkbox"
                              defaultChecked={row.b2brouterActive}
                              className="h-4 w-4 rounded border-[var(--elevation-border)] accent-accent"
                            />
                            B2Brouter
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
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

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
