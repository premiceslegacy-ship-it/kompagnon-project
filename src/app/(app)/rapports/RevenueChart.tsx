'use client'
// @atelier-migrated
// Évolution du chiffre d'affaires par mois : une barre pour le facturé HT, deux traits pour l'encaissé TTC et l'année précédente.

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthSeries } from '@/lib/data/queries/reporting'
import styles from './Rapports.module.css'

type Props = { series: MonthSeries[]; prevSeries: MonthSeries[] }

const compact = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1 }).format(n)
const full = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const SERIES = [
  { key: 'Facturé HT', color: 'var(--at-accent)', kind: 'bar' },
  { key: 'Encaissé TTC', color: 'var(--at-hausse)', kind: 'line' },
  { key: 'Année précédente', color: 'var(--at-encre-3)', kind: 'dash' },
] as const

type TooltipProps = { active?: boolean; label?: string; payload?: Array<{ dataKey: string; name: string; value: number }> }

function ChartTooltip({ active, label, payload }: TooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className={styles.tooltip}>
      <p>{label}</p>
      {payload.map(entry => <div key={entry.dataKey}><span>{entry.name}</span><span>{full(entry.value)}</span></div>)}
    </div>
  )
}

export default function RevenueChart({ series, prevSeries }: Props) {
  const data = series.map((s, i) => ({ label: s.label, 'Facturé HT': s.caHt, 'Année précédente': prevSeries[i]?.caHt ?? 0, 'Encaissé TTC': s.encaisse }))
  return (
    <section className={styles.chartCard} aria-labelledby="rapports-evolution">
      <h2 id="rapports-evolution" className={styles.chartTitle}>Évolution par mois</h2>
      <p className={styles.chartNote}>Le facturé en barres ; l’encaissé et l’année précédente en traits.</p>
      <ul className={styles.legend}>
        {SERIES.map(s => <li key={s.key} style={{ ['--swatch' as string]: s.color }} data-kind={s.kind}><i aria-hidden="true" />{s.key}</li>)}
      </ul>
      <div role="img" aria-label="Graphique du facturé, de l’encaissé et de l’année précédente, mois par mois">
        <ResponsiveContainer width="100%" height={240}>
          <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 6" stroke="var(--at-trait)" vertical={false} />
            <XAxis dataKey="label" tickFormatter={(l: string) => l.slice(0, 1).toUpperCase()} interval={0} tick={{ fontSize: 11, fill: 'var(--at-encre-2)' }} axisLine={false} tickLine={false} dy={6} />
            <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: 'var(--at-encre-2)' }} axisLine={false} tickLine={false} width={52} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--at-remplissage)' }} />
            <Bar dataKey="Facturé HT" name="Facturé HT" fill="var(--at-accent)" maxBarSize={18} radius={[5, 5, 0, 0]} />
            <Line dataKey="Encaissé TTC" name="Encaissé TTC" type="linear" stroke="var(--at-hausse)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Line dataKey="Année précédente" name="Année précédente" type="linear" stroke="var(--at-encre-3)" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
