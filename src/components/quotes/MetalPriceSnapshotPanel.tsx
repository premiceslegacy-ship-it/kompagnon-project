'use client'

import { Clock } from 'lucide-react'
import { METAL_LABELS, type MetalCode } from '@/lib/metal-prices'
import type { MetalPriceSnapshotRow } from '@/lib/data/queries/metal-price-snapshots'

type Props = {
  snapshots: MetalPriceSnapshotRow[]
}

function fmtEurKg(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n) + ' €/kg'
}

function fmtEur(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtDateHeure(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export default function MetalPriceSnapshotPanel({ snapshots }: Props) {
  if (snapshots.length === 0) return null

  return (
    <div className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
      {/* En-tête */}
      <div className="px-4 sm:px-5 py-3.5 border-b border-[var(--elevation-border)] bg-[var(--elevation-1)]/40 flex items-center gap-2">
        <Clock size={13} className="text-secondary flex-shrink-0" />
        <span className="text-sm font-semibold text-primary">
          Prix matière enregistrés à la validation
        </span>
        <span className="text-xs text-secondary bg-[var(--elevation-1)] border border-[var(--elevation-border)] rounded-full px-2 py-0.5 ml-auto">
          {snapshots.length} ligne{snapshots.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* Table desktop */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--elevation-border)]">
              <th className="px-5 py-3 font-semibold text-secondary text-xs uppercase tracking-wide">Ligne du devis</th>
              <th className="px-4 py-3 font-semibold text-secondary text-xs uppercase tracking-wide">Métal</th>
              <th className="px-4 py-3 font-semibold text-secondary text-xs uppercase tracking-wide text-right">Référence prix</th>
              <th className="px-4 py-3 font-semibold text-secondary text-xs uppercase tracking-wide text-right">Coeff.</th>
              <th className="px-4 py-3 font-semibold text-secondary text-xs uppercase tracking-wide text-right">Prix validé</th>
              <th className="px-4 py-3 font-semibold text-secondary text-xs uppercase tracking-wide">Date du prix</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--elevation-border)]">
            {snapshots.map((s) => (
              <tr key={s.id} className="hover:bg-[var(--elevation-1)]/30 transition-colors">
                <td className="px-5 py-3 text-primary max-w-[220px]">
                  <span className="block truncate" title={s.item_description ?? undefined}>
                    {s.item_description ?? '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-secondary">
                  {METAL_LABELS[s.metal_code as MetalCode] ?? s.metal_code}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-primary">
                  {s.source === 'manual' || s.lme_price_eur_kg === null
                    ? `Prix fixe : ${fmtEurKg(Number(s.computed_price))}`
                    : fmtEurKg(s.lme_price_eur_kg)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-secondary">
                  × {Number(s.coefficient).toFixed(2)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-primary">
                  {fmtEur(s.validated_price)}
                </td>
                <td className="px-4 py-3 text-secondary text-xs whitespace-nowrap">
                  {fmtDateHeure(s.price_date)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Vue mobile : cartes empilées */}
      <div className="sm:hidden divide-y divide-[var(--elevation-border)]">
        {snapshots.map((s) => (
          <div key={s.id} className="px-4 py-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-medium text-primary leading-snug flex-1 min-w-0 break-words">
                {s.item_description ?? '—'}
              </p>
              <span className="text-sm font-bold tabular-nums text-primary whitespace-nowrap">
                {fmtEur(s.validated_price)}
              </span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
              <span>{METAL_LABELS[s.metal_code as MetalCode] ?? s.metal_code}</span>
              <span>
                {s.source === 'manual' || s.lme_price_eur_kg === null
                  ? `Prix fixe : ${fmtEurKg(Number(s.computed_price))}`
                  : `Cours LME : ${fmtEurKg(s.lme_price_eur_kg)}`}
              </span>
              <span>× {Number(s.coefficient).toFixed(2)}</span>
            </div>
            <p className="text-[11px] text-secondary">{fmtDateHeure(s.price_date)}</p>
          </div>
        ))}
      </div>

      {/* Note de bas de panel */}
      <div className="px-4 sm:px-5 py-3 border-t border-[var(--elevation-border)] bg-[var(--elevation-1)]/40">
        <p className="text-[11px] text-secondary leading-relaxed">
          Références matière au moment de la validation, non contractuelles. Le prix final reste celui validé par l'artisan.
        </p>
      </div>
    </div>
  )
}
