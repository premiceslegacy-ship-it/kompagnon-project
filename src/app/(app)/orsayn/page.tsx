import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isOperatorEmailAllowed } from '@/lib/operator'
import { createOperatorAdminClient, isOperatorModeEnabled } from '@/lib/supabase/operator'

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

const moneyFmt = new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
})

function formatMoney(value: number): string {
  return moneyFmt.format(value)
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('fr-FR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

export default async function OrsaynPage() {
  if (!isOperatorModeEnabled()) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user?.email || !isOperatorEmailAllowed(user.email)) notFound()

  const operator = createOperatorAdminClient()
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await operator
    .from('operator_usage_events')
    .select('source_instance, provider, feature, model, provider_cost, currency, total_tokens, status, occurred_at')
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: false })
    .limit(500)

  if (error) {
    console.error('[orsayn.page]', error)
    notFound()
  }

  const events = (data ?? []) as OperatorUsageEvent[]
  const successfulEvents = events.filter((event) => event.status === 'success')
  const totalCost = successfulEvents.reduce((sum, event) => sum + Number(event.provider_cost ?? 0), 0)

  const byInstance = Object.entries(successfulEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.source_instance] = (acc[event.source_instance] ?? 0) + Number(event.provider_cost ?? 0)
    return acc
  }, {})).sort((a, b) => b[1] - a[1])

  const byProvider = Object.entries(successfulEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.provider] = (acc[event.provider] ?? 0) + Number(event.provider_cost ?? 0)
    return acc
  }, {})).sort((a, b) => b[1] - a[1])

  const byFeature = Object.entries(successfulEvents.reduce<Record<string, number>>((acc, event) => {
    acc[event.feature] = (acc[event.feature] ?? 0) + Number(event.provider_cost ?? 0)
    return acc
  }, {})).sort((a, b) => b[1] - a[1])

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-primary">Cockpit Orsayn</h1>
        <p className="text-sm text-secondary mt-2">Coûts agrégés privés sur 30 jours glissants. Cette page n’est visible qu’en mode opérateur.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <section className="rounded-3xl p-6 bg-surface shadow-kompagnon border border-[var(--elevation-border)]">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">Coût total</p>
          <p className="mt-3 text-3xl font-bold text-primary">{formatMoney(totalCost)}</p>
        </section>
        <section className="rounded-3xl p-6 bg-surface shadow-kompagnon border border-[var(--elevation-border)]">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">Événements</p>
          <p className="mt-3 text-3xl font-bold text-primary">{events.length}</p>
        </section>
        <section className="rounded-3xl p-6 bg-surface shadow-kompagnon border border-[var(--elevation-border)]">
          <p className="text-xs font-bold uppercase tracking-wider text-secondary">Clients actifs</p>
          <p className="mt-3 text-3xl font-bold text-primary">{byInstance.length}</p>
        </section>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <section className="rounded-3xl p-6 bg-surface shadow-kompagnon border border-[var(--elevation-border)] space-y-3">
          <h2 className="text-lg font-bold text-primary">Par client</h2>
          {byInstance.length === 0 ? <p className="text-sm text-secondary">Aucune donnée.</p> : byInstance.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium text-primary truncate">{key}</span>
              <span className="text-secondary">{formatMoney(value)}</span>
            </div>
          ))}
        </section>

        <section className="rounded-3xl p-6 bg-surface shadow-kompagnon border border-[var(--elevation-border)] space-y-3">
          <h2 className="text-lg font-bold text-primary">Par provider</h2>
          {byProvider.length === 0 ? <p className="text-sm text-secondary">Aucune donnée.</p> : byProvider.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium text-primary">{key}</span>
              <span className="text-secondary">{formatMoney(value)}</span>
            </div>
          ))}
        </section>

        <section className="rounded-3xl p-6 bg-surface shadow-kompagnon border border-[var(--elevation-border)] space-y-3">
          <h2 className="text-lg font-bold text-primary">Par feature</h2>
          {byFeature.length === 0 ? <p className="text-sm text-secondary">Aucune donnée.</p> : byFeature.map(([key, value]) => (
            <div key={key} className="flex items-center justify-between gap-4 text-sm">
              <span className="font-medium text-primary">{key}</span>
              <span className="text-secondary">{formatMoney(value)}</span>
            </div>
          ))}
        </section>
      </div>

      <section className="rounded-3xl p-6 bg-surface shadow-kompagnon border border-[var(--elevation-border)] space-y-4">
        <div>
          <h2 className="text-lg font-bold text-primary">Derniers événements</h2>
          <p className="text-sm text-secondary mt-1">20 derniers appels synchronisés depuis les instances clientes.</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-secondary border-b border-[var(--elevation-border)]">
                <th className="pb-3 font-semibold">Date</th>
                <th className="pb-3 font-semibold">Client</th>
                <th className="pb-3 font-semibold">Provider</th>
                <th className="pb-3 font-semibold">Feature</th>
                <th className="pb-3 font-semibold">Coût</th>
                <th className="pb-3 font-semibold">Statut</th>
              </tr>
            </thead>
            <tbody>
              {events.slice(0, 20).map((event, index) => (
                <tr key={`${event.source_instance}-${event.occurred_at}-${index}`} className="border-b border-[var(--elevation-border)] last:border-b-0">
                  <td className="py-3 text-primary">{formatDate(event.occurred_at)}</td>
                  <td className="py-3 text-primary">{event.source_instance}</td>
                  <td className="py-3 text-secondary">{event.provider}</td>
                  <td className="py-3 text-secondary">{event.feature}</td>
                  <td className="py-3 text-secondary">{formatMoney(Number(event.provider_cost ?? 0))}</td>
                  <td className="py-3">
                    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${event.status === 'success' ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
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
