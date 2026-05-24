'use client'

import React from 'react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts'
import type { MonthSeries } from '@/lib/data/queries/reporting'

type Props = {
  series: MonthSeries[]
  prevSeries: MonthSeries[]
}

const fmtCompact = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 0 }).format(n)

const fmtFull = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const CHART_COLORS = {
  light: {
    ca: '#ff9f1c',
    caTop: '#ffd38a',
    prev: '#64748b',
    prevTop: '#a8b4c4',
    cash: '#10b981',
    cashTop: '#78e7bd',
    axis: '#64748b',
    grid: 'rgba(100, 116, 139, 0.18)',
    cursor: 'rgba(255, 159, 28, 0.1)',
    shadow: 'rgba(15, 23, 42, 0.2)',
    highlight: 'rgba(255, 255, 255, 0.5)',
    tooltipBg: 'linear-gradient(180deg, rgba(255,255,255,0.99), rgba(248,250,252,0.99))',
    tooltipBorder: 'rgba(15, 23, 42, 0.12)',
    tooltipEdge: '#cbd5e1',
    tooltipTitle: '#64748b',
    tooltipText: '#1e293b',
    legendBg: 'linear-gradient(180deg, #ffffff, #f1f5f9)',
    legendText: '#334155',
  },
  dark: {
    ca: '#ff9f1c',
    caTop: '#ffc166',
    prev: '#a1a1aa',
    prevTop: '#d4d4d8',
    cash: '#b4f481',
    cashTop: '#ddffc0',
    axis: '#a1a1aa',
    grid: 'rgba(255, 255, 255, 0.12)',
    cursor: 'rgba(255, 255, 255, 0.07)',
    shadow: 'rgba(0, 0, 0, 0.58)',
    highlight: 'rgba(255, 255, 255, 0.24)',
    tooltipBg: 'linear-gradient(180deg, rgba(30,30,34,0.99), rgba(10,10,10,0.99))',
    tooltipBorder: 'rgba(255, 255, 255, 0.12)',
    tooltipEdge: '#000000',
    tooltipTitle: '#a1a1aa',
    tooltipText: '#ffffff',
    legendBg: 'linear-gradient(180deg, rgba(255,255,255,0.09), rgba(255,255,255,0.035))',
    legendText: '#f4f4f5',
  },
}

function useIsDarkMode() {
  const [isDark, setIsDark] = React.useState(false)

  React.useEffect(() => {
    const root = document.documentElement
    const sync = () => setIsDark(root.classList.contains('dark'))
    sync()

    const observer = new MutationObserver(sync)
    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  return isDark
}

function CustomTooltip({ active, payload, label, colors, seriesByKey }: any) {
  if (!active || !payload?.length) return null
  return (
    <div
      style={{
        minWidth: 192,
        borderRadius: 16,
        border: `1px solid ${colors.tooltipBorder}`,
        background: colors.tooltipBg,
        color: colors.tooltipText,
        padding: '13px 15px',
        boxShadow: `inset 0 1.5px 0 rgba(255,255,255,0.18), 0 4px 0 0 ${colors.tooltipEdge}, 0 4px 0 1px rgba(15,23,42,0.08), 0 12px 24px rgba(15,23,42,0.22)`,
      }}
    >
      <p
        style={{
          marginBottom: 12,
          color: colors.tooltipTitle,
          fontSize: 11,
          fontWeight: 900,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </p>
      {payload.map((entry: any) => (
        <div
          key={entry.dataKey}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, marginBottom: 6 }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: colors.tooltipText, fontSize: 12, fontWeight: 800 }}>
            <span
              style={{
                width: 10,
                height: 10,
                flexShrink: 0,
                borderRadius: 3,
                background: seriesByKey[entry.dataKey]?.color ?? colors.ca,
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 0 rgba(0,0,0,0.24)',
              }}
            />
            {entry.name}
          </span>
          <span style={{ color: colors.tooltipText, fontSize: 12, fontWeight: 900, fontVariantNumeric: 'tabular-nums' }}>
            {fmtFull(entry.value)}
          </span>
        </div>
      ))}
    </div>
  )
}

function TactileBar(props: any) {
  const { x, y, width, height, fill, shadowColor, highlightColor } = props
  if (!height || height <= 0) return null
  const r = Math.min(6, width / 2)
  const bodyWidth = Math.max(width - 2, 0)
  return (
    <g>
      <rect
        x={x + 1}
        y={y + 3}
        width={bodyWidth}
        height={height}
        rx={r}
        ry={r}
        fill={shadowColor}
      />
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={r}
        ry={r}
        fill={fill}
      />
      <rect
        x={x + 1}
        y={y + 1}
        width={bodyWidth}
        height={Math.min(6, height / 3)}
        rx={r}
        ry={r}
        fill={highlightColor}
      />
    </g>
  )
}

export default function RevenueChart({ series, prevSeries }: Props) {
  const isDark = useIsDarkMode()
  const colors = isDark ? CHART_COLORS.dark : CHART_COLORS.light
  const chartId = React.useId().replace(/:/g, '')
  const legend = [
    { key: 'CA HT', color: colors.ca, label: 'CA HT' },
    { key: 'CA N-1 HT', color: colors.prev, label: 'CA N-1 HT' },
    { key: 'Encaissé TTC', color: colors.cash, label: 'Encaissé TTC' },
  ]
  const seriesByKey = Object.fromEntries(legend.map(s => [s.key, s]))
  const data = series.map((s, i) => ({
    label: s.label,
    'CA HT': s.caHt,
    'CA N-1 HT': prevSeries[i]?.caHt ?? 0,
    'Encaissé TTC': s.encaisse,
  }))

  return (
    <div className="report-revenue-chart">
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-lg font-black tracking-tight text-primary">
            CA annuel par mois
          </p>
          <p className="mt-1 text-xs font-semibold text-secondary">
            Comparaison du CA HT avec N-1 et paiements encaissés TTC
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {legend.map(s => (
            <div
              key={s.key}
              className="report-chart-legend-item"
              style={{
                background: colors.legendBg,
                borderColor: `${s.color}55`,
                color: s.color,
              }}
            >
              <span
                style={{
                  width: 12,
                  height: 12,
                  flexShrink: 0,
                  borderRadius: 4,
                  background: s.color,
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.42), 0 2px 0 rgba(15,23,42,0.18)',
                }}
              />
              <span style={{ color: s.color }}>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={278}>
        <BarChart data={data} margin={{ top: 10, right: 6, left: 0, bottom: 0 }} barCategoryGap="28%" barGap={3}>
          <defs>
            <linearGradient id={`${chartId}-ca`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.caTop} />
              <stop offset="100%" stopColor={colors.ca} />
            </linearGradient>
            <linearGradient id={`${chartId}-prev`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.prevTop} />
              <stop offset="100%" stopColor={colors.prev} />
            </linearGradient>
            <linearGradient id={`${chartId}-cash`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={colors.cashTop} />
              <stop offset="100%" stopColor={colors.cash} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="4 8"
            stroke={colors.grid}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10, fill: colors.axis, fontWeight: 800 }}
            axisLine={false}
            tickLine={false}
            dy={8}
          />
          <YAxis
            tickFormatter={fmtCompact}
            tick={{ fontSize: 10, fill: colors.axis, fontWeight: 700 }}
            axisLine={false}
            tickLine={false}
            width={58}
          />
          <Tooltip
            content={<CustomTooltip colors={colors} seriesByKey={seriesByKey} />}
            cursor={{ fill: colors.cursor, radius: 10 } as any}
          />
          <Bar
            dataKey="CA HT"
            name="CA HT"
            shape={<TactileBar shadowColor={colors.shadow} highlightColor={colors.highlight} />}
            maxBarSize={28}
            radius={[6, 6, 0, 0]}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={`url(#${chartId}-ca)`} />
            ))}
          </Bar>
          <Bar
            dataKey="CA N-1 HT"
            name="CA N-1 HT"
            shape={<TactileBar shadowColor={colors.shadow} highlightColor={colors.highlight} />}
            maxBarSize={28}
            radius={[6, 6, 0, 0]}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={`url(#${chartId}-prev)`} />
            ))}
          </Bar>
          <Bar
            dataKey="Encaissé TTC"
            name="Encaissé TTC"
            shape={<TactileBar shadowColor={colors.shadow} highlightColor={colors.highlight} />}
            maxBarSize={28}
            radius={[6, 6, 0, 0]}
          >
            {data.map((_, i) => (
              <Cell key={i} fill={`url(#${chartId}-cash)`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
