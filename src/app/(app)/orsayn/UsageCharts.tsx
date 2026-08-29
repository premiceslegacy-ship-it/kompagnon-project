'use client'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { UsageAggregateRow, UsageHistoryRow } from './types'

type ChartColors = {
  axis: string
  grid: string
  tooltip: string
  border: string
  text: string
  secondary: string
  primary: string
  accent: string
}

const LIGHT: ChartColors = {
  axis: '#686863',
  grid: 'rgba(13,13,13,.10)',
  tooltip: '#ffffff',
  border: 'rgba(13,13,13,.14)',
  text: '#0d0d0d',
  secondary: '#686863',
  primary: '#000ce1',
  accent: '#0d0d0d',
}

function useChartColors(): ChartColors {
  return LIGHT
}

const formatMoney = (value: number) => new Intl.NumberFormat('fr-FR', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
}).format(value)

const formatCompact = (value: number) => new Intl.NumberFormat('fr-FR', {
  notation: 'compact',
  maximumFractionDigits: 1,
}).format(value)

function ChartTooltip({
  active,
  payload,
  label,
  colors,
}: {
  active?: boolean
  payload?: Array<{ dataKey?: string; name?: string; value?: number }>
  label?: string
  colors: ChartColors
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-44 border bg-surface px-3 py-2.5 text-xs" style={{ borderColor: colors.border, color: colors.text }}>
      <p className="mb-2 font-semibold uppercase tracking-[.12em]" style={{ color: colors.secondary }}>{label}</p>
      {payload.map((item) => (
        <div key={item.dataKey} className="flex items-center justify-between gap-5 py-0.5">
          <span>{item.name}</span>
          <strong className="tabular-nums">{formatMoney(Number(item.value ?? 0))}</strong>
        </div>
      ))}
    </div>
  )
}

export function UsageTrendChart({ history }: { history: UsageHistoryRow[] }) {
  const colors = useChartColors()
  return (
    <div className="h-[280px] w-full">
      {history.length === 0 ? (
        <div className="flex h-full items-center justify-center text-sm text-secondary">Aucune consommation enregistrée.</div>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={history} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <CartesianGrid stroke={colors.grid} strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: colors.axis, fontSize: 10, fontWeight: 600 }} />
            <YAxis axisLine={false} tickLine={false} tick={{ fill: colors.axis, fontSize: 10 }} tickFormatter={formatCompact} width={48} />
            <Tooltip content={<ChartTooltip colors={colors} />} cursor={{ stroke: colors.grid }} />
            <Line type="monotone" dataKey="usageCostEur" name="Consommation" stroke={colors.primary} strokeWidth={2.5} dot={{ r: 3, fill: colors.primary, strokeWidth: 0 }} activeDot={{ r: 5 }} />
            <Line type="monotone" dataKey="orsaynCostEur" name="Pris en charge" stroke={colors.accent} strokeWidth={1.5} strokeDasharray="5 5" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export function UsageBreakdownChart({
  rows,
  title,
}: {
  rows: UsageAggregateRow[]
  title: string
}) {
  const colors = useChartColors()
  const data = rows.map((row) => ({ ...row, shortLabel: row.label.length > 24 ? `${row.label.slice(0, 22)}…` : row.label }))
  return (
    <div>
      <p className="mb-3 text-xs font-semibold uppercase tracking-[.12em] text-secondary">{title}</p>
      <div className="h-[220px] w-full">
        {data.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-secondary">Pas encore de données.</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 4, bottom: 0 }}>
              <CartesianGrid stroke={colors.grid} strokeDasharray="3 5" horizontal={false} />
              <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: colors.axis, fontSize: 10 }} tickFormatter={formatCompact} />
              <YAxis type="category" dataKey="shortLabel" width={116} axisLine={false} tickLine={false} tick={{ fill: colors.axis, fontSize: 10 }} />
              <Tooltip content={<ChartTooltip colors={colors} />} cursor={{ fill: colors.grid }} />
              <Bar dataKey="usageCostEur" name="Coût" fill={colors.primary} radius={[0, 3, 3, 0]} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
