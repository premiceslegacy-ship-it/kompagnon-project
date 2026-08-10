'use client'

import { useState } from 'react'
import { X } from 'lucide-react'
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
    <div className="fixed inset-0 z-[9995] flex items-stretch justify-end bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-xl flex-col bg-[rgb(var(--bg-surface))] border-l border-[var(--elevation-border)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-[var(--elevation-border)] px-6 py-5">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold text-primary truncate">{row.label}</h2>
            <p className="mt-1 text-xs text-secondary font-body">{row.sourceInstance}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className={`inline-flex rounded-pill px-2.5 py-0.5 text-[11px] font-semibold font-display ${syncBadge.className}`}>
                {syncBadge.label}
              </span>
              <span className={`inline-flex rounded-pill px-2.5 py-0.5 text-[11px] font-semibold ${einvoicingBadge.className}`}>
                {einvoicingBadge.label}
              </span>
              <span className="text-[11px] text-secondary">{formatCommercialStatus(row)}</span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-xl border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* KPI résumé */}
        <div className="grid grid-cols-3 gap-3 border-b border-[var(--elevation-border)] px-6 py-4 text-xs">
          <div>
            <p className="text-secondary">Forfait HT</p>
            <p className="mt-1 font-semibold text-primary tabular-nums">
              {row.monthlyFee === null ? 'À compléter' : formatMoney(row.monthlyFee, row.billingCurrency)}
            </p>
          </div>
          <div>
            <p className="text-secondary">Marge brute</p>
            <p className="mt-1 font-semibold text-primary tabular-nums">
              {row.grossMargin === null ? 'À compléter' : formatMoney(row.grossMargin, row.billingCurrency)}
            </p>
          </div>
          <div>
            <p className="text-secondary">Marge %</p>
            <p className="mt-1 font-semibold text-primary tabular-nums">{formatPercent(row.marginPct)}</p>
          </div>
        </div>

        {/* Onglets */}
        <div className="flex gap-1 overflow-x-auto border-b border-[var(--elevation-border)] px-4 pt-3">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold font-display uppercase tracking-wide transition-colors ${
                activeTab === tab.id
                  ? 'bg-accent text-white'
                  : 'text-secondary hover:text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Corps scrollable */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {activeTab === 'offre' && <OffreTab row={row} />}
          {activeTab === 'cycle' && <CycleDeVieTab row={row} />}
          {activeTab === 'modules' && <ModulesTab row={row} />}
          {activeTab === 'suivi' && <SuiviTab row={row} />}
        </div>
      </div>
    </div>
  )
}
