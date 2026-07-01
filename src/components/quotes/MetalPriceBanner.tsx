'use client'

import { useEffect, useState, type MouseEvent } from 'react'
import { RefreshCw, AlertTriangle, ChevronRight, Settings, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { METAL_LABELS, LME_METAL_CODES, type CachedMetalPrice, type MetalCode } from '@/lib/metal-prices'
import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'

type Props = {
  grids: MetalPriceGrid[]
  onGridSelect?: (grid: MetalPriceGrid, priceEurKg: number) => void
}

type ApiResponse = { prices?: CachedMetalPrice[]; error?: string }

function fmtEurKg(n: number): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n) + ' €/kg'
}

function fmtProposed(n: number, unit: string): string {
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n) + ' €/' + unit
}

export default function MetalPriceBanner({ grids, onGridSelect }: Props) {
  const lmeGrids = grids.filter(g => g.source_type !== 'manual')
  const manualGrids = grids.filter(g => g.source_type === 'manual')
  const hasGrids = grids.length > 0 && onGridSelect
  const settingsHref = '/settings?tab=devis#metal-prices'

  const [prices, setPrices] = useState<CachedMetalPrice[] | null>(null)
  const [error, setError] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsLinkPending, setSettingsLinkPending] = useState(false)

  async function load() {
    setLoading(true)
    setError(false)
    setErrorMessage(null)
    try {
      const res = await fetch('/api/metal-prices')
      const data: ApiResponse = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cours temporairement indisponibles.')
      setPrices(data.prices ?? [])
    } catch (err) {
      setError(true)
      setErrorMessage(err instanceof Error ? err.message : 'Cours temporairement indisponibles.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  function handleConfigureClick(event: MouseEvent<HTMLAnchorElement>) {
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      event.currentTarget.target === '_blank'
    ) {
      return
    }
    setSettingsLinkPending(true)
  }

  const safePrices = prices ?? []
  const priceMap = Object.fromEntries(safePrices.map(p => [p.metal_code, p]))
  const isDemoPrices = safePrices.some(p => p.source === 'atelier_demo_market_data')

  const fetchedAt = safePrices[0]?.fetched_at
  let timeLabel: string | null = null
  if (fetchedAt) {
    const d = new Date(fetchedAt)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
      timeLabel = 'Mis à jour aujourd\'hui à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    } else {
      timeLabel = 'Mis à jour le ' + d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
        + ' à ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    }
  }

  return (
    <div className="rounded-2xl border border-[var(--elevation-border)] bg-[var(--elevation-1)]/40 overflow-hidden">

      {/* En-tête */}
      <div className="px-4 sm:px-5 py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <span className="text-[10px] font-bold text-secondary uppercase tracking-widest">
          {isDemoPrices ? 'Cours indicatifs Atelier' : 'Cours LME, référence indicative'}
        </span>
        {timeLabel && !loading && !error && (
          <span className="text-xs text-secondary">{timeLabel}</span>
        )}
      </div>

      {/* Cours LME */}
      <div className="px-4 sm:px-5 pb-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-secondary">
            <RefreshCw size={12} className="animate-spin flex-shrink-0 text-accent" />
            <span>Chargement des cours...</span>
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle size={12} className="flex-shrink-0" />
            <span>{errorMessage ?? 'Cours temporairement indisponibles.'}</span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {LME_METAL_CODES.map((code) => {
              const p = priceMap[code]
              return (
                <div key={code} className="flex items-baseline gap-1.5">
                  <span className="text-sm text-secondary">{METAL_LABELS[code]}</span>
                  <span className="text-sm font-bold tabular-nums text-primary">
                    {p ? fmtEurKg(p.price_eur_kg) : '—'}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Grilles ou invitation à en créer */}
      <div className="border-t border-[var(--elevation-border)] px-4 sm:px-5 py-3.5">
        {hasGrids ? (
          <>
            <p className="text-xs text-secondary mb-2.5 font-medium">
              Insérer une ligne depuis une grille fournisseur :
            </p>
            <div className="flex flex-wrap gap-2">
              {lmeGrids.map((grid) => {
                const courseData = priceMap[grid.metal_code]
                if (!courseData) return null
                const proposed = courseData.price_eur_kg * grid.coefficient
                return (
                  <button
                    key={grid.id}
                    type="button"
                    onClick={() => onGridSelect!(grid, courseData.price_eur_kg)}
                    className="group flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-xl border border-[var(--elevation-border)] bg-surface dark:bg-white/[0.03] hover:border-accent/50 hover:bg-accent/5 transition-all text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary group-hover:text-accent transition-colors truncate">
                        {grid.label}
                      </p>
                      <p className="text-xs text-secondary tabular-nums">
                        {fmtProposed(proposed, grid.unit)}
                      </p>
                    </div>
                    <ChevronRight size={13} className="text-secondary group-hover:text-accent transition-colors flex-shrink-0" />
                  </button>
                )
              })}
              {manualGrids.map((grid) => {
                const manualPrice = grid.manual_price_eur_kg ?? 0
                return (
                  <button
                    key={grid.id}
                    type="button"
                    onClick={() => onGridSelect!(grid, manualPrice)}
                    className="group flex items-center gap-2 pl-3 pr-2.5 py-2 rounded-xl border border-[var(--elevation-border)] bg-surface dark:bg-white/[0.03] hover:border-accent/50 hover:bg-accent/5 transition-all text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <p className="text-sm font-medium text-primary group-hover:text-accent transition-colors truncate">
                          {grid.label}
                        </p>
                        <span className="text-[9px] font-bold uppercase tracking-wide text-secondary border border-[var(--elevation-border)] rounded px-1 py-px flex-shrink-0">
                          Prix fixe
                        </span>
                      </div>
                      <p className="text-xs text-secondary tabular-nums">
                        {fmtProposed(manualPrice, grid.unit)}
                      </p>
                    </div>
                    <ChevronRight size={13} className="text-secondary group-hover:text-accent transition-colors flex-shrink-0" />
                  </button>
                )
              })}
            </div>
            <p className="mt-2.5 text-[11px] text-secondary leading-relaxed">
              Prix indicatif = cours LME × coefficient fournisseur (ou prix fixe pour l'acier). À valider selon format, épaisseur, coupe et délai de livraison.
            </p>
          </>
        ) : (
          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-secondary">
              Configurez vos grilles matières pour pré-remplir vos lignes de devis en un clic.
            </p>
            <Link
              href={settingsHref}
              onClick={handleConfigureClick}
              aria-busy={settingsLinkPending || undefined}
              aria-disabled={settingsLinkPending || undefined}
              className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[var(--elevation-border)] text-xs font-semibold transition-colors ${
                settingsLinkPending
                  ? 'text-primary border-accent/50 bg-accent/10 cursor-wait'
                  : 'text-secondary hover:text-primary hover:border-accent/40'
              }`}
            >
              {settingsLinkPending ? <Loader2 size={12} className="animate-spin" /> : <Settings size={12} />}
              {settingsLinkPending ? 'Ouverture...' : 'Configurer'}
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
