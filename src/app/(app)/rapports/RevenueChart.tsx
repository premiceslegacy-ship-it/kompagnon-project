'use client'
// @atelier-migrated
// Évolution du chiffre d'affaires par mois : facturé HT, facturé de l'année précédente, encaissé TTC.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { MonthSeries } from '@/lib/data/queries/reporting'
import styles from './Rapports.module.css'

type Props = { series: MonthSeries[]; prevSeries: MonthSeries[] }

const compact = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 0 }).format(n)
const full = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const SERIES = [
  { key: 'Facturé HT', color: 'var(--at-accent)' },
  { key: 'Année précédente', color: 'var(--at-encre-3)' },
  { key: 'Encaissé TTC', color: 'var(--at-hausse)' },
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
      <p className={styles.chartNote}>Facturé HT, comparé à l’année précédente, et encaissé TTC.</p>
      <ul className={styles.legend}>
        {SERIES.map(s => <li key={s.key} style={{ ['--swatch' as string]: s.color }}><i aria-hidden="true" />{s.key}</li>)}
      </ul>
      <div role="img" aria-label="Graphique en barres du facturé et de l’encaissé, mois par mois">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="24%" barGap={2}>
            <CartesianGrid strokeDasharray="3 6" stroke="var(--at-trait)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--at-encre-2)' }} axisLine={false} tickLine={false} dy={6} />
            <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: 'var(--at-encre-2)' }} axisLine={false} tickLine={false} width={56} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: 'var(--at-remplissage)' }} />
            {SERIES.map(s => <Bar key={s.key} dataKey={s.key} name={s.key} fill={s.color} maxBarSize={22} radius={[4, 4, 0, 0]} />)}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
