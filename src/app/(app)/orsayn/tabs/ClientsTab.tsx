import { upsertOperatorClientSettings } from '../actions'
import ClientsTable from '../ClientsTable'
import { formatMoney, formatPercent } from '../utils'
import type { ClientRow } from '../types'

const inputCls = 'w-full input-glass px-4 py-3 text-primary font-body text-sm outline-none'

type Props = {
  clientRows: ClientRow[]
  lowMarginRows: ClientRow[]
  expensiveRows: ClientRow[]
}

export default function ClientsTab({ clientRows, lowMarginRows, expensiveRows }: Props) {
  const hasRankings = lowMarginRows.length > 0 || expensiveRows.length > 0

  return (
    <div className="space-y-8">
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

      {hasRankings && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          {lowMarginRows.length > 0 && (
            <section className="card px-8 py-6 space-y-1">
              <div className="mb-3">
                <h2 className="text-lg font-bold text-primary font-display">Peu rentables</h2>
                <p className="mt-1 text-sm text-secondary font-body">Classement sur le mois en équivalent EUR.</p>
              </div>
              <div className="divide-y divide-[var(--elevation-border)]">
                {lowMarginRows.map((row) => (
                  <div key={`${row.sourceInstance}:${row.organizationId}`} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-primary font-body">{row.label}</p>
                      <p className="text-secondary font-body tabular-nums">{formatPercent(row.marginPct)}</p>
                    </div>
                    <span className="text-right text-secondary font-display tabular-nums text-xs">{formatMoney(row.grossMarginEur ?? 0)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          {expensiveRows.length > 0 && (
            <section className="card px-8 py-6 space-y-1">
              <div className="mb-3">
                <h2 className="text-lg font-bold text-primary font-display">Clients coûteux</h2>
                <p className="mt-1 text-sm text-secondary font-body">Coûts IA du mois les plus élevés.</p>
              </div>
              <div className="divide-y divide-[var(--elevation-border)]">
                {expensiveRows.map((row) => (
                  <div key={`${row.sourceInstance}:${row.organizationId}`} className="flex items-center justify-between gap-4 py-2.5 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-primary font-body">{row.label}</p>
                      <p className="text-secondary font-body tabular-nums">{row.monthEventCount} événement(s)</p>
                    </div>
                    <span className="text-right text-secondary font-display tabular-nums text-xs">{formatMoney(row.monthUsageCostEur)}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

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
    </div>
  )
}
