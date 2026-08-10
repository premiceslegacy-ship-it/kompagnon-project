'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { ClientRow } from './types'
import { clientKey, formatCommercialStatus, formatDate, formatMoney, formatPercent, getSyncBadge } from './utils'
import ClientDrawer from './ClientDrawer'

type Props = {
  rows: ClientRow[]
}

export default function ClientsTable({ rows }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const selectedKey = searchParams.get('client')
  const selectedRow = selectedKey ? rows.find((row) => clientKey(row.sourceInstance, row.organizationId) === selectedKey) : null

  function openClient(key: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set('client', key)
    router.replace(`/orsayn?${params.toString()}`, { scroll: false })
  }

  function closeDrawer() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('client')
    const query = params.toString()
    router.replace(query ? `/orsayn?${query}` : '/orsayn', { scroll: false })
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm font-body">
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
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="py-8 text-center text-secondary">
                  Aucun client dans le cockpit pour le moment. Ajoute un `source_instance` ci-dessus ou attends le premier événement synchronisé depuis une instance cliente.
                </td>
              </tr>
            ) : rows.map((row) => {
              const key = clientKey(row.sourceInstance, row.organizationId)
              const syncBadge = getSyncBadge(row.lastSeenAt, row.lastStatus)

              return (
                <tr
                  key={key}
                  onClick={() => openClient(key)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') openClient(key) }}
                  className="cursor-pointer border-b border-[var(--elevation-border)] last:border-b-0 transition-colors hover:bg-interactive/40"
                >
                  <td className="py-4 pr-4">
                    <p className="font-semibold text-primary">{row.label}</p>
                    <p className="mt-1 text-xs text-secondary">{row.sourceInstance}</p>
                  </td>
                  <td className="py-4 pr-4">
                    <span className={`inline-flex rounded-pill px-3 py-1 text-xs font-semibold font-display ${syncBadge.className}`}>
                      {syncBadge.label}
                    </span>
                  </td>
                  <td className="py-4 pr-4 text-secondary tabular-nums">
                    {formatCommercialStatus(row)}
                  </td>
                  <td className="py-4 pr-4 text-secondary tabular-nums">
                    {row.monthlyFee === null ? 'À compléter' : formatMoney(row.monthlyFee, row.billingCurrency)}
                  </td>
                  <td className="py-4 pr-4 text-secondary tabular-nums">
                    {formatMoney(row.monthCost, row.billingCurrency)}
                  </td>
                  <td className="py-4 pr-4 text-secondary tabular-nums">
                    {row.grossMargin === null ? 'À compléter' : formatMoney(row.grossMargin, row.billingCurrency)}
                  </td>
                  <td className="py-4 pr-4 text-secondary tabular-nums">{formatPercent(row.marginPct)}</td>
                  <td className="py-4 text-secondary tabular-nums">{formatDate(row.lastSeenAt)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {selectedRow && <ClientDrawer row={selectedRow} onClose={closeDrawer} />}
    </>
  )
}
