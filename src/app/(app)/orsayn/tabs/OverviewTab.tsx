import { formatDate, formatMoney, formatPercent } from '../utils'
import type { ClientRow, OperatorUsageEvent } from '../types'

type FailedWebhookEvent = {
  source_id: string
  event_type: string
  error_msg: string | null
  received_at: string
}

type Props = {
  activeCount: number
  costTotalEur: number
  usageTotalEur: number
  revenueTotalEur: number
  rowsWithFeeCount: number
  grossMarginTotalEur: number
  marginRate: number | null
  missingBillingCount: number
  sharedAppUrlRows: ClientRow[]
  missingOrgIdRows: ClientRow[]
  neverAttemptedRows: ClientRow[]
  technicalFailureRows: ClientRow[]
  failedWebhookEvents: FailedWebhookEvent[]
  instanceOrgCount: Record<string, number>
  recentEvents: OperatorUsageEvent[]
  clientRows: ClientRow[]
}

export default function OverviewTab({
  activeCount,
  costTotalEur,
  usageTotalEur,
  revenueTotalEur,
  rowsWithFeeCount,
  grossMarginTotalEur,
  marginRate,
  missingBillingCount,
  sharedAppUrlRows,
  missingOrgIdRows,
  neverAttemptedRows,
  technicalFailureRows,
  failedWebhookEvents,
  instanceOrgCount,
  recentEvents,
  clientRows,
}: Props) {
  const hasAnyBanner = sharedAppUrlRows.length > 0
    || missingOrgIdRows.length > 0
    || neverAttemptedRows.length > 0
    || technicalFailureRows.length > 0
    || failedWebhookEvents.length > 0

  function labelForEvent(event: OperatorUsageEvent): string {
    const row = clientRows.find(
      (r) => r.sourceInstance === event.source_instance && r.organizationId === event.organization_id,
    )
    return row?.label || event.source_instance
  }

  return (
    <div className="space-y-8">
      {activeCount === 0 && !hasAnyBanner && (
        <section className="card px-8 py-10 text-center">
          <p className="text-sm text-secondary font-body">
            Aucun client actif pour le moment. Ajoute un premier client dans l&apos;onglet Clients pour voir apparaître les indicateurs.
          </p>
        </section>
      )}

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

      {activeCount > 0 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          <section className="card px-8 py-6">
            <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Coût IA porté</p>
            <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(costTotalEur)}</p>
            <p className="mt-2 text-sm text-secondary font-body">
              Usage total indicatif : {formatMoney(usageTotalEur)} sur {activeCount} client(s).
            </p>
          </section>
          <section className="card px-8 py-6">
            <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">CA mensuel saisi</p>
            <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(revenueTotalEur)}</p>
            <p className="mt-2 text-sm text-secondary font-body">{rowsWithFeeCount} client(s) avec forfait renseigné.</p>
          </section>
          <section className="card px-8 py-6">
            <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Marge brute estimée</p>
            <p className="mt-3 text-3xl font-extrabold text-primary font-display tabular-nums">{formatMoney(grossMarginTotalEur)}</p>
            <p className="mt-2 text-sm text-secondary font-body">Comparaison forfait HT vs coût IA réellement porté par Orsayn.</p>
          </section>
          <section className="card px-8 py-6">
            <p className="text-xs font-bold uppercase tracking-wider text-secondary font-display">Taux de marge</p>
            <p className="mt-3 text-3xl font-extrabold text-accent font-display tabular-nums">{formatPercent(marginRate)}</p>
            <p className="mt-2 text-sm text-secondary font-body">{missingBillingCount} client(s) encore à compléter.</p>
          </section>
        </div>
      )}

      {recentEvents.length > 0 && (
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
                {recentEvents.slice(0, 20).map((event, index) => (
                  <tr key={`${event.source_instance}-${event.occurred_at}-${index}`} className="border-b border-[var(--elevation-border)] last:border-b-0">
                    <td className="py-3 text-primary tabular-nums">{formatDate(event.occurred_at)}</td>
                    <td className="py-3 text-primary">{labelForEvent(event)}</td>
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
      )}
    </div>
  )
}
