'use client'
// @atelier-migrated

import { useEffect, useState } from 'react'
import { METAL_LABELS, LME_METAL_CODES, type CachedMetalPrice, type MetalPriceTrend } from '@/lib/metal-prices'
import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import styles from './Panels.module.css'

type Props = {
  grids: MetalPriceGrid[]
  onGridSelect?: (grid: MetalPriceGrid, priceEurKg: number) => void
}

type ApiResponse = { prices?: CachedMetalPrice[]; trends?: MetalPriceTrend[]; error?: string }

// Seuil au-delà duquel la variation est mise en avant (hausse comme baisse).
const TREND_ALERT_THRESHOLD_PERCENT = 2

const nf = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtEurKg = (n: number) => `${nf.format(n)} €/kg`
const fmtProposed = (n: number, unit: string) => `${nf.format(n)} €/${unit}`

function updatedLabel(fetchedAt: string | undefined): string | null {
  if (!fetchedAt) return null
  const d = new Date(fetchedAt)
  const time = d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date().toDateString()) return `Mis à jour aujourd’hui à ${time}`
  return `Mis à jour le ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })} à ${time}`
}

/** Cours des métaux du jour et grilles fournisseur pour insérer une ligne de devis. */
export default function MetalPriceBanner({ grids, onGridSelect }: Props) {
  const lmeGrids = grids.filter(g => g.source_type !== 'manual')
  const manualGrids = grids.filter(g => g.source_type === 'manual')
  const hasGrids = grids.length > 0 && Boolean(onGridSelect)

  const [prices, setPrices] = useState<CachedMetalPrice[] | null>(null)
  const [trends, setTrends] = useState<MetalPriceTrend[]>([])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    setErrorMessage(null)
    try {
      const res = await fetch('/api/metal-prices')
      const data: ApiResponse = await res.json()
      if (!res.ok) throw new Error(data.error || 'Cours temporairement indisponibles.')
      setPrices(data.prices ?? [])
      setTrends(data.trends ?? [])
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Cours temporairement indisponibles.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const safePrices = prices ?? []
  const priceMap = Object.fromEntries(safePrices.map(p => [p.metal_code, p]))
  const trendMap = Object.fromEntries(trends.map(t => [t.metal_code, t]))
  const isDemoPrices = safePrices.some(p => p.source === 'atelier_demo_market_data')
  const timeLabel = !loading && !errorMessage ? updatedLabel(safePrices[0]?.fetched_at) : null

  return (
    <div className={styles.stack}>
      {loading ? (
        <p className={styles.note} role="status">Chargement des cours…</p>
      ) : errorMessage ? (
        <p className={`${styles.note} ${styles.noteWarn}`} role="alert">{errorMessage}</p>
      ) : (
        <ListGroup
          title={isDemoPrices ? 'Cours indicatifs Atelier' : 'Cours des métaux'}
          description={timeLabel ?? undefined}
        >
          {LME_METAL_CODES.map(code => {
            const p = priceMap[code]
            const trend = trendMap[code]
            const isAlert = Boolean(trend) && Math.abs(trend.changePercent) >= TREND_ALERT_THRESHOLD_PERCENT
            const trendClass = trend && isAlert ? (trend.changePercent >= 0 ? styles.trendUp : styles.trendDown) : ''
            return (
              <ListRow
                key={code}
                title={METAL_LABELS[code]}
                trailing={
                  <span className={styles.value}>
                    {p ? fmtEurKg(p.price_eur_kg) : '—'}
                    {trend && (
                      <span
                        className={`${styles.trend} ${trendClass}`}
                        title={`Cours du ${new Date(trend.previousDate).toLocaleDateString('fr-FR')} : ${fmtEurKg(trend.previousPriceEurKg)}`}
                      >
                        {trend.changePercent >= 0 ? '+' : ''}{trend.changePercent} %
                      </span>
                    )}
                  </span>
                }
              />
            )
          })}
        </ListGroup>
      )}

      {hasGrids ? (
        <ListGroup
          title="Insérer une ligne depuis une grille fournisseur"
          description="Prix indicatif = cours du jour × coefficient fournisseur (ou prix fixe). Renseignez longueur et largeur sur la ligne pour un calcul au poids réel si la grille a une épaisseur. À valider selon la coupe et le délai de livraison."
        >
          {lmeGrids.map(grid => {
            const course = priceMap[grid.metal_code]
            if (!course) return null
            return (
              <ListRow
                key={grid.id}
                title={grid.label}
                description={fmtProposed(course.price_eur_kg * grid.coefficient, grid.unit)}
                onClick={() => onGridSelect!(grid, course.price_eur_kg)}
                trailing={<span className={styles.chevron} aria-hidden="true">›</span>}
              />
            )
          })}
          {manualGrids.map(grid => {
            const manualPrice = grid.manual_price_eur_kg ?? 0
            return (
              <ListRow
                key={grid.id}
                title={grid.label}
                description={`${fmtProposed(manualPrice, grid.unit)} · prix fixe`}
                onClick={() => onGridSelect!(grid, manualPrice)}
                trailing={<span className={styles.chevron} aria-hidden="true">›</span>}
              />
            )
          })}
        </ListGroup>
      ) : (
        <ListGroup description="Configurez vos grilles matières pour pré-remplir vos lignes de devis en un clic.">
          <ListRow
            title="Configurer les grilles matières"
            href="/settings?tab=devis#metal-prices"
            trailing={<span className={styles.chevron} aria-hidden="true">›</span>}
          />
        </ListGroup>
      )}
    </div>
  )
}
