import { recordOperatorCommercialAction } from '../actions'
import {
  formatAIBillingMode,
  formatCommercialStatus,
  formatCompactNumber,
  formatMoney,
  getRecommendationClass,
} from '../utils'
import type { ClientRow, CommercialRecommendation, UsageAggregateRow } from '../types'

const inputSmCls = 'w-full input-glass px-3 py-2 text-primary font-body text-xs outline-none'

type Props = {
  featureUsageRows: UsageAggregateRow[]
  modelUsageRows: UsageAggregateRow[]
  pricingSignalRows: ClientRow[]
  recommendations: CommercialRecommendation[]
}

export default function PricingTab({ featureUsageRows, modelUsageRows, pricingSignalRows, recommendations }: Props) {
  const hasUsageData = featureUsageRows.length > 0 || modelUsageRows.length > 0 || pricingSignalRows.length > 0
  const hasRecommendations = recommendations.length > 0

  if (!hasUsageData && !hasRecommendations) {
    return (
      <section className="card px-8 py-10 text-center">
        <p className="text-sm text-secondary font-body">
          Aucune donnée de pricing ou d&apos;usage IA pour le moment — ces sections s&apos;activeront avec les premiers usages IA et abonnements Stripe.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-8">
      {hasUsageData && (
        <section className="card px-8 py-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-primary font-display">Conso IA & pricing</h2>
            <p className="mt-1 text-sm text-secondary font-body">
              Lecture mensuelle des usages IA : coût réellement porté par Orsayn, coût indicatif des clés client, et signaux pour ajuster les offres.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
            {featureUsageRows.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Features coûteuses</p>
                <div className="divide-y divide-[var(--elevation-border)]">
                  {featureUsageRows.map((row) => (
                    <div key={row.key} className="py-2.5">
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
              </div>
            )}

            {modelUsageRows.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Modèles coûteux</p>
                <div className="divide-y divide-[var(--elevation-border)]">
                  {modelUsageRows.map((row) => (
                    <div key={row.key} className="py-2.5">
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
              </div>
            )}

            {pricingSignalRows.length > 0 && (
              <div className="space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Signaux clients</p>
                <div className="divide-y divide-[var(--elevation-border)]">
                  {pricingSignalRows.map((row) => (
                    <div key={`${row.sourceInstance}:${row.organizationId}`} className="py-2.5">
                      <div className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate font-semibold text-primary">{row.label}</span>
                        <span className="text-secondary tabular-nums">{formatMoney(row.monthUsageCostEur)}</span>
                      </div>
                      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-secondary">
                        <span>{formatCommercialStatus(row)} · {formatAIBillingMode(row.aiBillingMode)}</span>
                        <span>{row.monthEventCount} event(s)</span>
                      </div>
                      {row.aiBillingMode === 'client_owned' && (
                        <p className="mt-1 text-[11px] text-secondary">
                          Usage à garder pour le pricing, non soustrait de ta marge.
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}

      {hasRecommendations && (
        <section className="card px-8 py-6 space-y-5">
          <div>
            <h2 className="text-lg font-bold text-primary font-display">Recommandations commerciales</h2>
            <p className="mt-1 text-sm text-secondary font-body">
              Opportunités détectées automatiquement à partir des quotas, de la marge et des usages IA/WhatsApp.
            </p>
          </div>

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
        </section>
      )}
    </div>
  )
}
