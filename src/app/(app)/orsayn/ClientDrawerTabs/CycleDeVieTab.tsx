'use client'

import {
  activateOperatorTrial,
  convertOperatorTrial,
  expireOperatorTrial,
  resyncOperatorClientConfig,
} from '../actions'
import { getSyncBadge, getTrialLabel, isActiveTrial } from '../utils'
import type { ClientRow } from '../types'

const inputSmCls = 'w-full input-glass px-3 py-2 text-xs text-primary font-body outline-none'
const sectionTitleCls = 'text-sm font-bold uppercase tracking-wide text-secondary font-display'

export default function CycleDeVieTab({ row }: { row: ClientRow }) {
  const syncBadge = getSyncBadge(row.lastSeenAt, row.lastStatus)

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="card px-6 py-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className={sectionTitleCls}>Statut de synchro</p>
          <span className={`inline-flex rounded-pill px-3 py-1 text-xs font-semibold font-display ${syncBadge.className}`}>
            {syncBadge.label}
          </span>
        </div>
        <p className="text-sm text-secondary">Configuration : {row.configSyncStatus ?? 'n/a'}</p>
        {row.configSyncError && (
          <p className="text-sm font-medium text-red-600">{row.configSyncError}</p>
        )}
        <form action={resyncOperatorClientConfig}>
          <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
          {row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}
          <button type="submit" className="w-full rounded-pill bg-slate-500/10 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-500/20 dark:text-slate-200">
            Resync config
          </button>
        </form>
      </div>

      <div className="card px-6 py-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <p className={sectionTitleCls}>Essai</p>
          <span className="text-sm text-secondary">{getTrialLabel(row.trialEndsAt, row.trialConverted)}</span>
        </div>

        {!isActiveTrial(row.trialEndsAt) && (
          <form action={activateOperatorTrial}>
            <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
            {row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}
            <input type="hidden" name="trialDays" value={row.sourceInstance === 'atelier-app' ? '14' : '30'} />
            <button type="submit" className="w-full rounded-pill bg-green-500/10 px-4 py-2.5 text-sm font-semibold text-green-700 transition hover:bg-green-500/20">
              Essai Expert {row.sourceInstance === 'atelier-app' ? '14j' : '30j'}
            </button>
          </form>
        )}

        {isActiveTrial(row.trialEndsAt) && (
          <div className="space-y-3">
            <form action={convertOperatorTrial} className="flex gap-2">
              <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
              {row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}
              <select name="targetTier" defaultValue="pro" className={inputSmCls}>
                <option value="starter">starter</option>
                <option value="pro">pro</option>
                <option value="expert">expert</option>
              </select>
              <button type="submit" className="shrink-0 rounded-pill bg-accent/10 px-4 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/20">
                Convertir
              </button>
            </form>
            <form action={expireOperatorTrial}>
              <input type="hidden" name="sourceInstance" value={row.sourceInstance} />
              {row.organizationId && <input type="hidden" name="organizationId" value={row.organizationId} />}
              <input type="hidden" name="targetTier" value="setup_only" />
              <button type="submit" className="w-full rounded-pill bg-red-500/10 px-4 py-2.5 text-sm font-semibold text-red-700 transition hover:bg-red-500/20">
                Terminer essai
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
