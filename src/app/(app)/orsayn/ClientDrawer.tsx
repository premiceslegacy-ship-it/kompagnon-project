'use client'

import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import type { ClientRow } from './types'
import { formatCommercialStatus, formatMoney, formatPercent, getEinvoicingBadge, getSyncBadge } from './utils'
import OffreTab from './ClientDrawerTabs/OffreTab'
import CycleDeVieTab from './ClientDrawerTabs/CycleDeVieTab'
import ModulesTab from './ClientDrawerTabs/ModulesTab'
import SuiviTab from './ClientDrawerTabs/SuiviTab'

type DrawerTab = 'offre' | 'cycle' | 'modules' | 'suivi'

const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'offre', label: 'Offre' },
  { id: 'cycle', label: 'Cycle de vie' },
  { id: 'modules', label: 'Modules & verticale' },
  { id: 'suivi', label: 'Suivi' },
]

type Props = {
  row: ClientRow
  onClose: () => void
}

export default function ClientDrawer({ row, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<DrawerTab>('offre')
  const syncBadge = getSyncBadge(row.lastSeenAt, row.lastStatus)
  const einvoicingBadge = getEinvoicingBadge(row.einvoicingConfig)

  return (
    <div className="fixed inset-0 z-[9995] flex flex-col bg-base">
      {/* Header pleine largeur */}
      <div className="flex items-center gap-4 border-b border-[var(--elevation-border)] bg-surface px-6 py-4 shadow-sm">
        <button
          onClick={onClose}
          className="flex shrink-0 items-center gap-2 rounded-pill border border-[var(--elevation-border)] px-4 py-2 text-sm font-semibold text-secondary hover:text-primary hover:bg-interactive/60 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-xl font-bold text-primary truncate">{row.label}</h2>
          <p className="text-xs text-secondary font-body">{row.sourceInstance}</p>
        </div>
        <div className="hidden shrink-0 flex-wrap items-center gap-2 sm:flex">
          <span className={`inline-flex rounded-pill px-3 py-1 text-xs font-semibold font-display ${syncBadge.className}`}>
            {syncBadge.label}
          </span>
          <span className={`inline-flex rounded-pill px-3 py-1 text-xs font-semibold ${einvoicingBadge.className}`}>
            {einvoicingBadge.label}
          </span>
          <span className="rounded-pill border border-[var(--elevation-border)] px-3 py-1 text-xs text-secondary font-body">
            {formatCommercialStatus(row)}
          </span>
        </div>
      </div>

      {/* Corps : centré, largeur de lecture confortable, scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-4xl px-6 py-6 space-y-6">
          {/* KPI résumé */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="card px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Forfait HT</p>
              <p className="mt-2 text-xl font-bold text-primary tabular-nums font-display">
                {row.monthlyFee === null ? 'À compléter' : formatMoney(row.monthlyFee, row.billingCurrency)}
              </p>
            </div>
            <div className="card px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Marge brute</p>
              <p className="mt-2 text-xl font-bold text-primary tabular-nums font-display">
                {row.grossMargin === null ? 'À compléter' : formatMoney(row.grossMargin, row.billingCurrency)}
              </p>
            </div>
            <div className="card px-5 py-4">
              <p className="text-xs font-bold uppercase tracking-wide text-secondary font-display">Marge %</p>
              <p className="mt-2 text-xl font-bold text-accent tabular-nums font-display">{formatPercent(row.marginPct)}</p>
            </div>
          </div>

          {/* Onglets */}
          <div className="flex flex-wrap gap-2 border-b border-[var(--elevation-border)] pb-3">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`rounded-pill px-4 py-2 text-xs font-bold font-display uppercase tracking-wide transition-colors ${
                  activeTab === tab.id
                    ? 'bg-accent text-white'
                    : 'border border-[var(--elevation-border)] text-secondary hover:text-primary hover:bg-interactive/60'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'offre' && <OffreTab row={row} />}
          {activeTab === 'cycle' && <CycleDeVieTab row={row} />}
          {activeTab === 'modules' && <ModulesTab row={row} />}
          {activeTab === 'suivi' && <SuiviTab row={row} />}
        </div>
      </div>
    </div>
  )
}
