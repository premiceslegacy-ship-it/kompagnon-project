'use client'

import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import type { MonthSeries } from '@/lib/data/queries/reporting'

type Props = {
  series: MonthSeries[]
  prevSeries: MonthSeries[]
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 0 }).format(n)

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-2xl p-3 text-xs shadow-xl border border-secondary/20 min-w-[140px] bg-white text-primary dark:bg-zinc-950 dark:border-white/15">
      <p className="font-bold text-primary mb-2">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex justify-between gap-4 mb-0.5">
          <span style={{ color: entry.color }}>{entry.name}</span>
          <span className="font-semibold text-primary tabular-nums">
            {new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function RevenueChart({ series, prevSeries }: Props) {
  const currentYear = series[0] ? new Date().getFullYear() : new Date().getFullYear()

  const data = series.map((s, i) => ({
    label: s.label,
    'CA HT': s.caHt,
    'CA N-1': prevSeries[i]?.caHt ?? 0,
    'Encaissé': s.encaisse,
  }))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap="25%">
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(127,127,127,0.15)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-secondary, #888)' }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={fmt}
          tick={{ fontSize: 11, fill: 'var(--color-secondary, #888)' }}
          axisLine={false}
          tickLine={false}
          width={60}
        />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(127,127,127,0.08)' }} />
        <Legend
          wrapperStyle={{ fontSize: 11, paddingTop: 12 }}
          formatter={(value) => <span style={{ color: 'var(--color-secondary, #888)', fontWeight: 500 }}>{value}</span>}
        />
        <Bar dataKey="CA HT" fill="var(--color-accent, #6ee7b7)" radius={[4, 4, 0, 0]} maxBarSize={32} />
        <Bar dataKey="CA N-1" fill="#94a3b8" radius={[4, 4, 0, 0]} maxBarSize={32} />
        <Bar dataKey="Encaissé" fill="var(--color-accent-green, #22c55e)" radius={[4, 4, 0, 0]} maxBarSize={32} />
      </BarChart>
    </ResponsiveContainer>
  )
}
