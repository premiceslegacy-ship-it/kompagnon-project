import { notFound } from 'next/navigation'
import { upsertOperatorClientSettings } from './actions'
import { getOperatorUsdToEurRate } from '@/lib/operator'
import { getOperatorUser } from '@/lib/operator-auth'
import { createOperatorAdminClient } from '@/lib/supabase/operator'

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
  label: string | null
  updated_at: string
}

type OperatorClientSetting = {
  source_instance: string
  label: string | null
  monthly_fee_ht: number | string | null
  billing_currency: 'EUR' | 'USD'
  is_active: boolean
}

type ClientRow = {
  sourceInstance: string
  label: string
  monthlyFee: number | null
  billingCurrency: 'EUR' | 'USD'
  isActive: boolean
  monthCost: number
  monthCostEur: number
  grossMargin: number | null
  grossMarginEur: number | null
  marginPct: number | null
  lastSeenAt: string | null
  lastStatus: string | null
  monthEventCount: number
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
  if (value === null) return 'A completer'
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

function normalizeFee(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
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
      label: 'Jamais synchronise',
      className: 'bg-slate-500/10 text-slate-600',
    }
  }

  const ageMs = Date.now() - new Date(lastSeenAt).getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  if (lastStatus === 'error' && ageDays <= 2) {
    return {
      label: 'Erreurs recentes',
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
    clientsResult,
    monthlyEventsResult,
    recentEventsResult,
  ] = await Promise.all([
    operator
      .from('operator_client_settings')
      .select('source_instance, label, monthly_fee_ht, billing_currency, is_active')
      .order('source_instance', { ascending: true }),
    operator
      .from('operator_clients')
      .select('source_instance, label, updated_at')
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

  if (settingsResult.error || clientsResult.error || monthlyEventsResult.error || recentEventsResult.error) {
    console.error('[orsayn.page]', {
      settings: settingsResult.error,
      clients: clientsResult.error,
      monthlyEvents: monthlyEventsResult.error,
      recentEvents: recentEventsResult.error,
    })
    notFound()
  }

  const settings = (settingsResult.data ?? []) as OperatorClientSetting[]
  const clients = (clientsResult.data ?? []) as OperatorClient[]
  const monthlyEvents = (monthlyEventsResult.data ?? []) as OperatorUsageEvent[]
  const recentEvents = (recentEventsResult.data ?? []) as OperatorUsageEvent[]

  const settingsBySource = new Map(settings.map((item) => [item.source_instance, item]))
  const clientsBySource = new Map(clients.map((item) => [item.source_instance, item]))
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
    ...clients.map((item) => item.source_instance),
    ...monthlyEvents.map((item) => item.source_instance),
  ])

  const clientRows = Array.from(sourceInstances).map((sourceInstance) => {
    const setting = settingsBySource.get(sourceInstance)
    const client = clientsBySource.get(sourceInstance)
    const monthEvents = monthlyEventsBySource[sourceInstance] ?? []
    const successfulMonthEvents = monthEvents.filter((event) => event.status === 'success')
    const monthCostUsd = successfulMonthEvents.reduce((sum, event) => sum + Number(event.provider_cost ?? 0), 0)
    const billingCurrency = (setting?.billing_currency ?? 'EUR') as 'EUR' | 'USD'
    const monthlyFee = normalizeFee(setting?.monthly_fee_ht)
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
      label,
      monthlyFee,
      billingCurrency,
      isActive: setting?.is_active ?? true,
      monthCost,
      monthCostEur,
      grossMargin,
      grossMarginEur,
      marginPct,
      lastSeenAt: latestEvent?.occurred_at ?? client?.updated_at ?? null,
      lastStatus: latestEvent?.status ?? null,
      monthEventCount: monthEvents.length,
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

  return (
    <main className="flex-1 p-8 max-w-[1500px] mx-auto w-full space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold text-primary">Cockpit Orsayn</h1>
          <p className="mt-2 max-w-3xl text-sm text-secondary">
            Pilotage prive des couts IA et de la marge par client. Les couts providers restent journalises en USD,
            puis convertis en EUR pour les syntheses globales avec un taux fixe V1 de {usdToEurRate.toFixed(2)}.
          </p>
        </div>

        <div className="rounded-3xl border border-[var(--elevation-border)] bg-surface px-5 py-4 shadow-kompagnon">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">Acces operateur</p>
          <p className="mt-2 text-sm font-medium text-primary">{user.email}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-4">
        <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">Cout IA du mois</p>
          <p className="mt-3 text-3xl font-bold text-primary">{formatMoney(costTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary">Equivalent EUR sur {activeRows.length} client(s) actif(s).</p>
        </section>
        <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">CA mensuel saisi</p>
          <p className="mt-3 text-3xl font-bold text-primary">{formatMoney(revenueTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary">{rowsWithFee.length} client(s) avec forfait renseigne.</p>
        </section>
        <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">Marge brute estimee</p>
          <p className="mt-3 text-3xl font-bold text-primary">{formatMoney(grossMarginTotalEur)}</p>
          <p className="mt-2 text-sm text-secondary">Comparaison forfait mensuel HT vs cout IA du mois.</p>
        </section>
        <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">Taux de marge</p>
          <p className="mt-3 text-3xl font-bold text-primary">{formatPercent(marginRate)}</p>
          <p className="mt-2 text-sm text-secondary">{missingBillingRows.length} client(s) encore a completer.</p>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr,0.8fr,0.8fr]">
        <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon">
          <div className="mb-4">
            <h2 className="text-lg font-bold text-primary">Ajouter ou preconfigurer un client</h2>
            <p className="mt-1 text-sm text-secondary">
              Cree une ligne cockpit avant meme le premier event si tu connais deja le `source_instance`.
            </p>
          </div>

          <form action={upsertOperatorClientSettings} className="grid gap-3 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="font-medium text-primary">source_instance</span>
              <input
                required
                name="sourceInstance"
                placeholder="maconnerie-durand"
                className="w-full rounded-2xl border border-[var(--elevation-border)] bg-white px-4 py-3 text-primary outline-none transition focus:border-primary"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-primary">Libelle</span>
              <input
                name="label"
                placeholder="Maconnerie Durand"
                className="w-full rounded-2xl border border-[var(--elevation-border)] bg-white px-4 py-3 text-primary outline-none transition focus:border-primary"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-primary">Mensuel HT</span>
              <input
                name="monthlyFeeHt"
                type="number"
                min="0"
                step="0.01"
                placeholder="390"
                className="w-full rounded-2xl border border-[var(--elevation-border)] bg-white px-4 py-3 text-primary outline-none transition focus:border-primary"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="font-medium text-primary">Devise</span>
              <select
                name="billingCurrency"
                defaultValue="EUR"
                className="w-full rounded-2xl border border-[var(--elevation-border)] bg-white px-4 py-3 text-primary outline-none transition focus:border-primary"
              >
                <option value="EUR">EUR</option>
                <option value="USD">USD</option>
              </select>
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-[var(--elevation-border)] bg-white px-4 py-3 text-sm text-primary">
              <input
                defaultChecked
                name="isActive"
                type="checkbox"
                className="h-4 w-4 rounded border-[var(--elevation-border)]"
              />
              Client actif
            </label>
            <div className="flex items-end justify-end">
              <button
                type="submit"
                className="inline-flex rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-white transition hover:opacity-90"
              >
                Enregistrer
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon space-y-3">
          <div>
            <h2 className="text-lg font-bold text-primary">Peu rentables</h2>
            <p className="mt-1 text-sm text-secondary">Classement sur le mois en equivalent EUR.</p>
          </div>
          {lowMarginRows.length === 0 ? (
            <p className="text-sm text-secondary">Aucune marge calculable pour le moment.</p>
          ) : lowMarginRows.map((row) => (
            <div key={row.sourceInstance} className="flex items-center justify-between gap-4 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-primary">{row.label}</p>
                <p className="text-secondary">{formatPercent(row.marginPct)}</p>
              </div>
              <span className="text-right text-secondary">{formatMoney(row.grossMarginEur ?? 0)}</span>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon space-y-3">
          <div>
            <h2 className="text-lg font-bold text-primary">Clients couteux</h2>
            <p className="mt-1 text-sm text-secondary">Couts IA du mois les plus eleves.</p>
          </div>
          {expensiveRows.length === 0 ? (
            <p className="text-sm text-secondary">Aucune donnee de cout pour le mois en cours.</p>
          ) : expensiveRows.map((row) => (
            <div key={row.sourceInstance} className="flex items-center justify-between gap-4 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-primary">{row.label}</p>
                <p className="text-secondary">{row.monthEventCount} event(s)</p>
              </div>
              <span className="text-right text-secondary">{formatMoney(row.monthCostEur)}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon space-y-4">
        <div>
          <h2 className="text-lg font-bold text-primary">Clients et marge</h2>
          <p className="mt-1 text-sm text-secondary">
            Le cout est converti dans la devise du forfait pour chaque ligne. Les totaux globaux restent normalises en EUR.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] text-left text-secondary">
                <th className="pb-3 font-semibold">Client</th>
                <th className="pb-3 font-semibold">Sync</th>
                <th className="pb-3 font-semibold">Mensuel HT</th>
                <th className="pb-3 font-semibold">Cout du mois</th>
                <th className="pb-3 font-semibold">Marge brute</th>
                <th className="pb-3 font-semibold">Marge %</th>
                <th className="pb-3 font-semibold">Dernier event</th>
                <th className="pb-3 font-semibold">Config</th>
              </tr>
            </thead>
            <tbody>
              {clientRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-secondary">Aucun client dans le cockpit pour le moment.</td>
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
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${syncBadge.className}`}>
                        {syncBadge.label}
                      </span>
                    </td>
                    <td className="py-4 pr-4 text-secondary">
                      {row.monthlyFee === null ? 'A completer' : formatMoney(row.monthlyFee, row.billingCurrency)}
                    </td>
                    <td className="py-4 pr-4 text-secondary">{formatMoney(row.monthCost, row.billingCurrency)}</td>
                    <td className="py-4 pr-4 text-secondary">
                      {row.grossMargin === null ? 'A completer' : formatMoney(row.grossMargin, row.billingCurrency)}
                    </td>
                    <td className="py-4 pr-4 text-secondary">{formatPercent(row.marginPct)}</td>
                    <td className="py-4 pr-4 text-secondary">{formatDate(row.lastSeenAt)}</td>
                    <td className="py-4">
                      <form action={upsertOperatorClientSettings} className="grid gap-2 rounded-2xl border border-[var(--elevation-border)] bg-white p-3">
                        <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
                        <input
                          name="label"
                          defaultValue={row.label === row.sourceInstance ? '' : row.label}
                          placeholder="Libelle"
                          className="w-full rounded-xl border border-[var(--elevation-border)] px-3 py-2 text-primary outline-none transition focus:border-primary"
                        />
                        <div className="grid grid-cols-[1fr,92px] gap-2">
                          <input
                            name="monthlyFeeHt"
                            type="number"
                            min="0"
                            step="0.01"
                            defaultValue={row.monthlyFee ?? ''}
                            placeholder="390"
                            className="w-full rounded-xl border border-[var(--elevation-border)] px-3 py-2 text-primary outline-none transition focus:border-primary"
                          />
                          <select
                            name="billingCurrency"
                            defaultValue={row.billingCurrency}
                            className="w-full rounded-xl border border-[var(--elevation-border)] px-3 py-2 text-primary outline-none transition focus:border-primary"
                          >
                            <option value="EUR">EUR</option>
                            <option value="USD">USD</option>
                          </select>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-secondary">
                          <input
                            name="isActive"
                            type="checkbox"
                            defaultChecked={row.isActive}
                            className="h-4 w-4 rounded border-[var(--elevation-border)]"
                          />
                          Client actif
                        </label>
                        <button
                          type="submit"
                          className="inline-flex justify-center rounded-xl bg-primary px-3 py-2 text-xs font-semibold text-white transition hover:opacity-90"
                        >
                          Sauvegarder
                        </button>
                      </form>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-3xl border border-[var(--elevation-border)] bg-surface p-6 shadow-kompagnon space-y-4">
        <div>
          <h2 className="text-lg font-bold text-primary">Derniers evenements</h2>
          <p className="mt-1 text-sm text-secondary">20 derniers appels synchronises depuis les instances clientes.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[820px] text-sm">
            <thead>
              <tr className="border-b border-[var(--elevation-border)] text-left text-secondary">
                <th className="pb-3 font-semibold">Date</th>
                <th className="pb-3 font-semibold">Client</th>
                <th className="pb-3 font-semibold">Provider</th>
                <th className="pb-3 font-semibold">Feature</th>
                <th className="pb-3 font-semibold">Cout</th>
                <th className="pb-3 font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {recentEvents.slice(0, 20).map((event, index) => (
                <tr key={`${event.source_instance}-${event.occurred_at}-${index}`} className="border-b border-[var(--elevation-border)] last:border-b-0">
                  <td className="py-3 text-primary">{formatDate(event.occurred_at)}</td>
                  <td className="py-3 text-primary">{settingsBySource.get(event.source_instance)?.label || event.source_instance}</td>
                  <td className="py-3 text-secondary">{event.provider}</td>
                  <td className="py-3 text-secondary">{event.feature}</td>
                  <td className="py-3 text-secondary">{formatMoney(Number(event.provider_cost ?? 0), 'USD')}</td>
                  <td className="py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${event.status === 'success' ? 'bg-green-500/10 text-green-700' : 'bg-red-500/10 text-red-600'}`}>
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
