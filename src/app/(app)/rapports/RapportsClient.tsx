'use client'

import React, { useState, useTransition, useCallback } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  TrendingUp, TrendingDown, Users, HardHat, Clock, Euro,
  Target, ChevronRight, Plus, Trash2, BarChart2, FileDown, X, AlertTriangle, Calendar, Wrench,
} from 'lucide-react'
import { ActionButton } from '@/components/ui/ActionButton'
import type {
  MonthlyReport, AnnualReport, HoursReport,
  TopClientEntry, TopChantierEntry, AnnualObjectives, MonthlyObjectives, CustomObjective,
  MemberWithoutRate, MaintenanceReport,
} from '@/lib/data/queries/reporting'
import {
  saveObjectivesAction,
  saveMonthlyObjectivesAction,
  fetchMonthlyDataAction,
  fetchAnnualDataAction,
} from './actions'

const RevenueChart = dynamic(() => import('./RevenueChart'), { ssr: false })

const MONTH_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

const fmt = (n: number) => {
  const parts = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).formatToParts(Math.round(Math.abs(n)))
  const num = parts.map(p => p.type === 'group' ? ' ' : p.value).join('')
  return (n < 0 ? '-' : '') + num + ' €'
}

const fmtPct = (n: number) => `${(n * 100).toFixed(1)} %`

const fmtH = (n: number) => {
  const h = Math.floor(n)
  const min = Math.round((n - h) * 60)
  return min === 0 ? `${h}:00` : `${h}:${String(min).padStart(2, '0')}`
}

function Delta({ current, prev }: { current: number; prev: number }) {
  if (prev === 0 && current === 0) return null
  if (prev === 0) return <span className="text-xs font-semibold text-accent-green">Nouveau</span>
  const pct = Math.round(((current - prev) / prev) * 100)
  if (pct === 0) return <span className="text-xs text-secondary">= période préc.</span>
  const up = pct > 0
  return (
    <span className={`text-xs font-semibold flex items-center gap-0.5 ${up ? 'text-accent-green' : 'text-red-500'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{pct}% vs préc.
    </span>
  )
}

function KpiCard({ label, value, sub, delta, icon }: {
  label: string; value: string; sub?: string; delta?: React.ReactNode; icon: React.ReactNode
}) {
  return (
    <div className="rounded-3xl p-6 card flex flex-col justify-between transition-all duration-300 ease-out">
      <div className="flex justify-between items-start">
        <p className="text-sm font-semibold text-secondary tracking-wider uppercase">{label}</p>
        <span className="text-accent">{icon}</span>
      </div>
      <p className="text-2xl font-bold text-primary tabular-nums mt-4">{value}</p>
      {sub && <p className="text-xs text-secondary mt-1">{sub}</p>}
      {delta && <div className="mt-2">{delta}</div>}
    </div>
  )
}

function ProgressBar({ label, current, target, format, onClear }: {
  label: string; current: number; target: number | null; format: (n: number) => string; onClear?: () => void
}) {
  if (!target) return null
  const pct = Math.min((current / target) * 100, 100)
  const color = pct >= 100 ? 'bg-accent-green' : pct >= 70 ? 'bg-accent' : 'bg-blue-500'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm items-center">
        <span className="font-medium text-primary">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-secondary tabular-nums">{format(current)} / {format(target)}</span>
          {onClear && (
            <button onClick={onClear} title="Supprimer cet objectif" className="p-0.5 text-secondary hover:text-red-500 transition-colors">
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="h-2 bg-secondary/20 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-secondary text-right">{pct.toFixed(0)} %</p>
    </div>
  )
}

// Entrée unifiée dans la liste d'objectifs : soit un champ standard, soit un custom libre
type ObjEntry =
  | { kind: 'standard'; key: StandardKey; value: number | null }
  | { kind: 'custom'; id?: string; label: string; target: number; unit: string }

type StandardKey =
  | 'revenue_ht_target'
  | 'margin_eur_target'
  | 'margin_pct_target'
  | 'chantiers_count_target'
  | 'new_clients_target'
  | 'hours_target'

const ANNUAL_STANDARD_OPTS: { key: StandardKey; label: string; unit: string; placeholder: string; step: string }[] = [
  { key: 'revenue_ht_target',      label: 'Facturé',            unit: '€',  placeholder: '100000', step: '1000' },
  { key: 'margin_eur_target',      label: 'Marge (EUR)',         unit: '€',  placeholder: '30000',  step: '1000' },
  { key: 'margin_pct_target',      label: 'Marge (%)',           unit: '%',  placeholder: '30',     step: '0.5'  },
  { key: 'chantiers_count_target', label: 'Chantiers terminés', unit: '',   placeholder: '20',     step: '1'    },
  { key: 'new_clients_target',     label: 'Nouveaux clients',   unit: '',   placeholder: '10',     step: '1'    },
  { key: 'hours_target',           label: 'Heures totales',     unit: 'h',  placeholder: '2000',   step: '50'   },
]

const MONTHLY_STANDARD_OPTS: { key: Exclude<StandardKey, 'new_clients_target'>; label: string; unit: string; placeholder: string; step: string }[] = [
  { key: 'revenue_ht_target',      label: 'Facturé',            unit: '€',  placeholder: '10000',  step: '500'  },
  { key: 'margin_eur_target',      label: 'Marge (EUR)',         unit: '€',  placeholder: '3000',   step: '500'  },
  { key: 'margin_pct_target',      label: 'Marge (%)',           unit: '%',  placeholder: '30',     step: '0.5'  },
  { key: 'chantiers_count_target', label: 'Chantiers terminés', unit: '',   placeholder: '2',      step: '1'    },
  { key: 'hours_target',           label: 'Heures totales',     unit: 'h',  placeholder: '160',    step: '10'   },
]

function annualToEntries(obj: AnnualObjectives): ObjEntry[] {
  const entries: ObjEntry[] = []
  for (const opt of ANNUAL_STANDARD_OPTS) {
    const val = obj[opt.key as keyof AnnualObjectives] as number | null
    if (val != null) entries.push({ kind: 'standard', key: opt.key, value: val })
  }
  for (const c of obj.customs) {
    entries.push({ kind: 'custom', id: c.id, label: c.label, target: c.target, unit: c.unit })
  }
  return entries
}

function monthlyToEntries(obj: MonthlyObjectives): ObjEntry[] {
  const entries: ObjEntry[] = []
  for (const opt of MONTHLY_STANDARD_OPTS) {
    const val = obj[opt.key as keyof MonthlyObjectives] as number | null
    if (val != null) entries.push({ kind: 'standard', key: opt.key, value: val })
  }
  for (const c of obj.customs) {
    entries.push({ kind: 'custom', id: c.id, label: c.label, target: c.target, unit: c.unit })
  }
  return entries
}

function entriesToAnnual(entries: ObjEntry[], base: AnnualObjectives): AnnualObjectives {
  const result: AnnualObjectives = {
    ...base,
    revenue_ht_target: null, margin_eur_target: null, margin_pct_target: null,
    chantiers_count_target: null, new_clients_target: null, hours_target: null,
    customs: [],
  }
  let customOrder = 0
  for (const e of entries) {
    if (e.kind === 'standard') {
      (result as any)[e.key] = e.value
    } else {
      result.customs.push({ id: e.id, label: e.label, target: e.target, unit: e.unit, sort_order: customOrder++ })
    }
  }
  return result
}

function entriesToMonthly(entries: ObjEntry[], base: MonthlyObjectives): MonthlyObjectives {
  const result: MonthlyObjectives = {
    ...base,
    revenue_ht_target: null, margin_eur_target: null, margin_pct_target: null,
    chantiers_count_target: null, hours_target: null,
    customs: [],
  }
  let customOrder = 0
  for (const e of entries) {
    if (e.kind === 'standard') {
      (result as any)[e.key] = e.value
    } else {
      result.customs.push({ id: e.id, label: e.label, target: e.target, unit: e.unit, sort_order: customOrder++ })
    }
  }
  return result
}

function ObjEntryRow({
  entry,
  standardOpts,
  usedStandardKeys,
  onChange,
  onRemove,
}: {
  entry: ObjEntry
  standardOpts: typeof ANNUAL_STANDARD_OPTS
  usedStandardKeys: Set<string>
  onChange: (e: ObjEntry) => void
  onRemove: () => void
}) {
  const availableStandards = standardOpts.filter(
    o => o.key === (entry.kind === 'standard' ? entry.key : '') || !usedStandardKeys.has(o.key)
  )

  return (
    <div className="flex gap-2 items-start p-3 rounded-2xl bg-secondary/5 border border-secondary/10">
      <div className="flex-1 space-y-2">
        {/* Ligne 1 : type */}
        <div className="relative">
          <select
            value={entry.kind === 'standard' ? entry.key : '__custom__'}
            onChange={e => {
              const val = e.target.value
              if (val === '__custom__') {
                onChange({ kind: 'custom', label: '', target: 0, unit: '' })
              } else {
                onChange({ kind: 'standard', key: val as StandardKey, value: null })
              }
            }}
            className="w-full appearance-none input text-sm pr-8 cursor-pointer"
          >
            <option value="__custom__">Personnalisé</option>
            {availableStandards.map(o => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-secondary">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </span>
        </div>

        {/* Ligne 2 : valeur + unité/libellé */}
        {entry.kind === 'standard' ? (() => {
          const opt = standardOpts.find(o => o.key === entry.key)!
          return (
            <div className="flex gap-2 items-center">
              <input
                type="number"
                placeholder={opt.placeholder}
                step={opt.step}
                value={entry.value ?? ''}
                onChange={e => {
                  const n = parseFloat(e.target.value)
                  onChange({ ...entry, value: isNaN(n) ? null : n })
                }}
                className="flex-1 input text-sm"
              />
              {opt.unit && (
                <span className="flex-shrink-0 px-2 py-1 rounded-lg bg-secondary/10 border border-secondary/15 text-xs font-medium text-secondary">
                  {opt.unit}
                </span>
              )}
            </div>
          )
        })() : (
          <div className="space-y-2">
            <input
              type="text"
              placeholder="Libellé (ex: Avis Google, leads...)"
              value={entry.label}
              onChange={e => onChange({ ...entry, label: e.target.value })}
              className="w-full input text-sm"
            />
            <div className="flex gap-2 items-center">
              <input
                type="number"
                placeholder="Cible (ex: 50)"
                value={entry.target || ''}
                onChange={e => onChange({ ...entry, target: parseFloat(e.target.value) || 0 })}
                className="flex-1 input text-sm"
              />
              <input
                type="text"
                placeholder="unité (ex: avis)"
                value={entry.unit}
                onChange={e => onChange({ ...entry, unit: e.target.value })}
                className="w-32 input text-sm"
              />
            </div>
          </div>
        )}
      </div>

      <button
        onClick={onRemove}
        className="mt-1 p-1.5 text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors flex-shrink-0"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  )
}

function ObjectivesModalAnnual({ year, objectives, onClose, onSaved }: {
  year: number
  objectives: AnnualObjectives
  onClose: () => void
  onSaved: (updated: AnnualObjectives) => void
}) {
  const [pending, startTransition] = useTransition()
  const [entries, setEntries] = useState<ObjEntry[]>(() => annualToEntries(objectives))
  const [error, setError] = useState<string | null>(null)

  const usedStandardKeys = new Set(entries.filter(e => e.kind === 'standard').map(e => (e as any).key as string))
  const availableToAdd = ANNUAL_STANDARD_OPTS.filter(o => !usedStandardKeys.has(o.key))

  function addEntry() {
    if (availableToAdd.length > 0) {
      setEntries(e => [...e, { kind: 'standard', key: availableToAdd[0].key, value: null }])
    } else {
      setEntries(e => [...e, { kind: 'custom', label: '', target: 0, unit: '' }])
    }
  }

  function handleSave() {
    startTransition(async () => {
      const updated = entriesToAnnual(entries, objectives)
      const result = await saveObjectivesAction(year, updated)
      if (result.error) { setError(result.error); return }
      onSaved(updated)
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 card rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-primary">Objectifs annuels {year}</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary/20 rounded-xl transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {entries.length === 0 && (
            <p className="text-sm text-secondary text-center py-4">Aucun objectif. Ajoutez-en un ci-dessous.</p>
          )}
          {entries.map((entry, i) => (
            <ObjEntryRow
              key={i}
              entry={entry}
              standardOpts={ANNUAL_STANDARD_OPTS}
              usedStandardKeys={usedStandardKeys}
              onChange={updated => setEntries(es => es.map((e, idx) => idx === i ? updated : e))}
              onRemove={() => setEntries(es => es.filter((_, idx) => idx !== i))}
            />
          ))}

          <button
            onClick={addEntry}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-dashed border-secondary/30 text-sm text-secondary hover:text-primary hover:border-secondary/60 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter un objectif
          </button>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-3 rounded-pill border border-secondary/30 text-secondary text-sm font-semibold hover:bg-secondary/10 transition-colors">
              Annuler
            </button>
            <ActionButton onClick={handleSave} loading={pending} className="flex-1 py-3 rounded-pill bg-accent text-black text-sm font-bold hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
              Enregistrer
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}

function ObjectivesModalMonthly({ year, month, objectives, onClose, onSaved }: {
  year: number
  month: number
  objectives: MonthlyObjectives
  onClose: () => void
  onSaved: (updated: MonthlyObjectives) => void
}) {
  const [pending, startTransition] = useTransition()
  const [entries, setEntries] = useState<ObjEntry[]>(() => monthlyToEntries(objectives))
  const [error, setError] = useState<string | null>(null)

  const usedStandardKeys = new Set(entries.filter(e => e.kind === 'standard').map(e => (e as any).key as string))
  const availableToAdd = MONTHLY_STANDARD_OPTS.filter(o => !usedStandardKeys.has(o.key))

  function addEntry() {
    if (availableToAdd.length > 0) {
      setEntries(e => [...e, { kind: 'standard', key: availableToAdd[0].key, value: null }])
    } else {
      setEntries(e => [...e, { kind: 'custom', label: '', target: 0, unit: '' }])
    }
  }

  function handleSave() {
    startTransition(async () => {
      const updated = entriesToMonthly(entries, objectives)
      const result = await saveMonthlyObjectivesAction(year, month, updated)
      if (result.error) { setError(result.error); return }
      onSaved(updated)
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 card rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-primary">Objectifs {MONTH_LABELS[month - 1]} {year}</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary/20 rounded-xl transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-3">
          {entries.length === 0 && (
            <p className="text-sm text-secondary text-center py-4">Aucun objectif. Ajoutez-en un ci-dessous.</p>
          )}
          {entries.map((entry, i) => (
            <ObjEntryRow
              key={i}
              entry={entry}
              standardOpts={MONTHLY_STANDARD_OPTS as typeof ANNUAL_STANDARD_OPTS}
              usedStandardKeys={usedStandardKeys}
              onChange={updated => setEntries(es => es.map((e, idx) => idx === i ? updated : e))}
              onRemove={() => setEntries(es => es.filter((_, idx) => idx !== i))}
            />
          ))}

          <button
            onClick={addEntry}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-2xl border border-dashed border-secondary/30 text-sm text-secondary hover:text-primary hover:border-secondary/60 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Ajouter un objectif
          </button>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-3 rounded-pill border border-secondary/30 text-secondary text-sm font-semibold hover:bg-secondary/10 transition-colors">
              Annuler
            </button>
            <ActionButton onClick={handleSave} loading={pending} className="flex-1 py-3 rounded-pill bg-accent text-black text-sm font-bold hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50">
              Enregistrer
            </ActionButton>
          </div>
        </div>
      </div>
    </div>
  )
}

type Props = {
  initialVue: 'mois' | 'annee'
  initialYear: number
  initialMonth: number
  initialMonthlyReport: MonthlyReport | null
  initialAnnualReport: AnnualReport | null
  initialHoursReport: HoursReport | null
  initialTopClients: TopClientEntry[]
  initialTopChantiers: TopChantierEntry[]
  initialMaintenanceReport: MaintenanceReport | null
  initialAnnualObjectives: AnnualObjectives | null
  initialMonthlyObjectives: MonthlyObjectives | null
  membersWithoutRate: MemberWithoutRate[]
  isVatSubject: boolean
}

export default function RapportsClient({
  initialVue, initialYear, initialMonth,
  initialMonthlyReport, initialAnnualReport,
  initialHoursReport, initialTopClients, initialTopChantiers, initialMaintenanceReport,
  initialAnnualObjectives, initialMonthlyObjectives,
  membersWithoutRate,
  isVatSubject,
}: Props) {
  const [vue, setVue] = useState(initialVue)
  const [year, setYear] = useState(initialYear)
  const [month, setMonth] = useState(initialMonth)

  const [monthlyReport, setMonthlyReport] = useState(initialMonthlyReport)
  const [annualReport, setAnnualReport] = useState(initialAnnualReport)
  const [hoursReport, setHoursReport] = useState(initialHoursReport)
  const [topClients, setTopClients] = useState(initialTopClients)
  const [topChantiers, setTopChantiers] = useState(initialTopChantiers)
  const [maintenanceReport, setMaintenanceReport] = useState(initialMaintenanceReport)
  const [annualObjectives, setAnnualObjectives] = useState(initialAnnualObjectives)
  const [monthlyObjectives, setMonthlyObjectives] = useState(initialMonthlyObjectives)

  const [loading, startTransition] = useTransition()
  const [showObjectives, setShowObjectives] = useState(false)

  const now = new Date()

  const goMonthly = useCallback((y: number, m: number) => {
    startTransition(async () => {
      setVue('mois')
      setYear(y)
      setMonth(m)
      const data = await fetchMonthlyDataAction(y, m)
      setMonthlyReport(data.monthlyReport)
      setHoursReport(data.hoursReport)
      setTopClients(data.topClients)
      setTopChantiers(data.topChantiers)
      setMaintenanceReport(data.maintenanceReport)
      setMonthlyObjectives(data.objectives)
    })
  }, [])

  const goAnnual = useCallback((y: number) => {
    startTransition(async () => {
      setVue('annee')
      setYear(y)
      const data = await fetchAnnualDataAction(y)
      setAnnualReport(data.annualReport)
      setHoursReport(data.hoursReport)
      setTopClients(data.topClients)
      setTopChantiers(data.topChantiers)
      setMaintenanceReport(data.maintenanceReport)
      setAnnualObjectives(data.objectives)
    })
  }, [])

  const prevYear = year - 1
  const nextYear = year + 1
  const prevMonth = month === 1 ? 12 : month - 1
  const prevMonthYear = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextMonthYear = month === 12 ? year + 1 : year
  const isMonthFuture = vue === 'mois' && (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1))
  const isYearFuture = vue === 'annee' && year >= now.getFullYear()

  const r = monthlyReport
  const ar = annualReport
  const mr = maintenanceReport
  const objectives = vue === 'mois' ? monthlyObjectives : annualObjectives
  const maintenanceActualCost = mr ? mr.laborCost + mr.partsCost + mr.travelCost + mr.otherCost : 0
  const maintenanceActualMarginPct = mr && mr.revenueHt > 0 ? mr.marginEur / mr.revenueHt : 0
  const maintenanceExpectedMarginPct = mr && mr.expectedRevenueHt > 0 ? mr.expectedMarginHt / mr.expectedRevenueHt : 0
  const monthlyActualMarginPct = r && r.caHt > 0 ? r.beneficeEstime / r.caHt : 0
  const annualActualMarginPct = ar && ar.caHt > 0 ? ar.beneficeEstime / ar.caHt : 0
  const billedLabel = isVatSubject ? 'Facturé HT' : 'Facturé'
  const billedSub = (ttc: number) => isVatSubject && ttc > 0 ? `${fmt(ttc)} TTC facturé` : 'Factures émises, non forcément encaissées'
  const collectedLabel = isVatSubject ? 'Encaissé TTC' : 'Encaissé'
  const vatLabel = isVatSubject ? 'TVA facturée' : 'TVA non applicable'

  const objectivesEmpty = !objectives ||
    (!objectives.revenue_ht_target && !objectives.margin_eur_target &&
     !objectives.margin_pct_target &&
     !objectives.chantiers_count_target && !objectives.hours_target &&
     objectives.customs.length === 0)

  function clearAnnualField(key: keyof Omit<AnnualObjectives, 'id' | 'year' | 'customs'>) {
    if (!annualObjectives) return
    const updated = { ...annualObjectives, [key]: null }
    setAnnualObjectives(updated)
    saveObjectivesAction(year, updated)
  }

  function clearMonthlyField(key: keyof Omit<MonthlyObjectives, 'id' | 'year' | 'month' | 'customs'>) {
    if (!monthlyObjectives) return
    const updated = { ...monthlyObjectives, [key]: null }
    setMonthlyObjectives(updated)
    saveMonthlyObjectivesAction(year, month, updated)
  }

  function removeAnnualCustom(id: string | undefined, idx: number) {
    if (!annualObjectives) return
    const updated = { ...annualObjectives, customs: annualObjectives.customs.filter((_, i) => i !== idx) }
    setAnnualObjectives(updated)
    saveObjectivesAction(year, updated)
  }

  function removeMonthlyCustom(id: string | undefined, idx: number) {
    if (!monthlyObjectives) return
    const updated = { ...monthlyObjectives, customs: monthlyObjectives.customs.filter((_, i) => i !== idx) }
    setMonthlyObjectives(updated)
    saveMonthlyObjectivesAction(year, month, updated)
  }

  return (
    <main className={`page-container space-y-6 md:space-y-8 transition-opacity duration-150 ${loading ? 'opacity-60 pointer-events-none' : ''}`}>
      {/* En-tête + nav */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-primary tracking-tight">
            Rapports
          </h1>
          <p className="text-secondary text-sm mt-0.5">
            {vue === 'mois' ? `${MONTH_LABELS[month - 1]} ${year}` : `Année ${year}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Tabs vue */}
          <div className="flex rounded-xl overflow-hidden border border-secondary/20 text-sm font-semibold">
            <button
              onClick={() => vue !== 'mois' && goMonthly(year, month)}
              className={`px-4 py-2 transition-colors ${vue === 'mois' ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}
            >
              Mensuel
            </button>
            <button
              onClick={() => vue !== 'annee' && goAnnual(year)}
              className={`px-4 py-2 transition-colors ${vue === 'annee' ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}
            >
              Annuel
            </button>
          </div>

          {/* Nav période */}
          {vue === 'mois' ? (
            <div className="flex items-center gap-1 text-sm">
              <button
                onClick={() => goMonthly(prevMonthYear, prevMonth)}
                className="px-3 py-2 rounded-xl border border-secondary/20 text-secondary hover:text-primary transition-colors"
              >
                &lsaquo;
              </button>
              <span className="px-2 font-medium text-primary whitespace-nowrap">
                {MONTH_LABELS[month - 1].slice(0, 3)}. {year}
              </span>
              <button
                onClick={() => goMonthly(nextMonthYear, nextMonth)}
                disabled={isMonthFuture}
                className="px-3 py-2 rounded-xl border border-secondary/20 text-secondary hover:text-primary transition-colors disabled:opacity-30"
              >
                &rsaquo;
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-sm">
              <button
                onClick={() => goAnnual(prevYear)}
                className="px-3 py-2 rounded-xl border border-secondary/20 text-secondary hover:text-primary transition-colors"
              >
                &lsaquo;
              </button>
              <span className="px-2 font-medium text-primary">{year}</span>
              <button
                onClick={() => goAnnual(nextYear)}
                disabled={isYearFuture}
                className="px-3 py-2 rounded-xl border border-secondary/20 text-secondary hover:text-primary transition-colors disabled:opacity-30"
              >
                &rsaquo;
              </button>
            </div>
          )}

          {/* Export PDF */}
          <a
            href={`/api/exports/rapport-pdf?vue=${vue}&periode=${vue === 'mois' ? `${year}-${String(month).padStart(2, '0')}` : year}`}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-secondary/20 text-sm text-secondary hover:text-primary transition-colors"
          >
            <FileDown className="w-4 h-4" />
            PDF
          </a>
        </div>
      </div>

      {membersWithoutRate.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/50">
          <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {membersWithoutRate.length === 1
                ? '1 intervenant sans taux horaire'
                : `${membersWithoutRate.length} intervenants sans taux horaire`}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Le coût main d&apos;oeuvre est sous-estimé dans le bénéfice estimé.{' '}
              Renseignez le taux dans l&apos;onglet Equipes &amp; Intervenants du chantier concerné.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {membersWithoutRate.map((m, i) => (
                <Link
                  key={i}
                  href="/chantiers/heures"
                  className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/60 transition-colors"
                >
                  {m.personName}
                  <span className="opacity-60">({m.hoursTotal % 1 === 0 ? m.hoursTotal : m.hoursTotal.toFixed(1)}h)</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {vue === 'mois' && r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label={billedLabel} value={r.caHt > 0 ? fmt(r.caHt) : '-'} sub={billedSub(r.caTtc)} delta={<Delta current={r.caHt} prev={r.prevCaHt} />} icon={<Euro className="w-4 h-4" />} />
            <KpiCard label={collectedLabel} value={r.encaisse > 0 ? fmt(r.encaisse) : '-'} sub="Paiements enregistrés" delta={<Delta current={r.encaisse} prev={r.prevEncaisse} />} icon={<TrendingUp className="w-4 h-4 text-accent-green" />} />
            <KpiCard label={vatLabel} value={isVatSubject && r.tvaDue > 0 ? fmt(r.tvaDue) : '-'} delta={isVatSubject ? <Delta current={r.tvaDue} prev={r.prevTvaDue} /> : undefined} icon={<BarChart2 className="w-4 h-4" />} />
            <KpiCard label="Bénéfice estimé" value={r.hasCostData ? fmt(r.beneficeEstime) : '-'} sub={r.hasCostData ? `${fmtPct(monthlyActualMarginPct)} · avant impôts et charges fixes` : 'Aucun coût réel saisi ce mois'} icon={<Target className="w-4 h-4" />} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Bénéfice prévu sur factures" value={r.hasProjectedCostData ? fmt(r.projectedMarginHt) : '-'} sub={r.hasProjectedCostData ? `${fmtPct(r.projectedMarginPct)} · coûts des lignes facturées` : 'Aucun coût interne sur les lignes'} icon={<BarChart2 className="w-4 h-4" />} />
            <KpiCard label="Chantiers terminés" value={String(r.chantiersTermines || '-')} icon={<HardHat className="w-4 h-4 text-amber-500" />} />
            <KpiCard label="Chantiers en cours" value={String(r.chantiersEnCours || '-')} icon={<HardHat className="w-4 h-4" />} />
            <KpiCard label="Heures travaillées" value={r.heuresTotal > 0 ? fmtH(r.heuresTotal) : '-'} delta={<Delta current={r.heuresTotal} prev={r.prevHeuresTotal} />} icon={<Clock className="w-4 h-4" />} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <KpiCard
              label="Contrats à facturer"
              value={r.recurringContractsDue > 0 ? String(r.recurringContractsDue) : '-'}
              sub={r.recurringExpectedHt > 0 ? `${fmt(r.recurringExpectedHt)} HT prévu ce mois` : 'Aucune facture de période à générer'}
              icon={<Calendar className="w-4 h-4" />}
            />
            <KpiCard
              label="Facturation périodique"
              value={r.recurringBilledHt > 0 ? fmt(r.recurringBilledHt) : '-'}
              sub="Factures de période déjà générées"
              icon={<Euro className="w-4 h-4" />}
            />
          </div>
        </>
      )}

      {vue === 'annee' && ar && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label={billedLabel} value={ar.caHt > 0 ? fmt(ar.caHt) : '-'} sub={billedSub(ar.caTtc)} delta={<Delta current={ar.caHt} prev={ar.prevCaHt} />} icon={<Euro className="w-4 h-4" />} />
            <KpiCard label={collectedLabel} value={ar.encaisse > 0 ? fmt(ar.encaisse) : '-'} sub="Paiements enregistrés" delta={<Delta current={ar.encaisse} prev={ar.prevEncaisse} />} icon={<TrendingUp className="w-4 h-4 text-accent-green" />} />
            <KpiCard label={vatLabel} value={isVatSubject && ar.tvaDue > 0 ? fmt(ar.tvaDue) : '-'} icon={<BarChart2 className="w-4 h-4" />} />
            <KpiCard label="Bénéfice estimé" value={ar.hasCostData ? fmt(ar.beneficeEstime) : '-'} sub={ar.hasCostData ? `${fmtPct(annualActualMarginPct)} · avant impôts et charges fixes` : 'Aucun coût réel saisi cette année'} icon={<Target className="w-4 h-4" />} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Bénéfice prévu sur factures" value={ar.hasProjectedCostData ? fmt(ar.projectedMarginHt) : '-'} sub={ar.hasProjectedCostData ? `${fmtPct(ar.projectedMarginPct)} · coûts des lignes facturées` : 'Aucun coût interne sur les lignes'} icon={<BarChart2 className="w-4 h-4" />} />
            <KpiCard label="Chantiers terminés" value={String(ar.chantiersTermines || '-')} icon={<HardHat className="w-4 h-4 text-amber-500" />} />
            <KpiCard label="Nouveaux clients" value={String(ar.nouveauxClients || '-')} icon={<Users className="w-4 h-4 text-blue-500" />} />
            <KpiCard label="Heures travaillées" value={ar.heuresTotal > 0 ? fmtH(ar.heuresTotal) : '-'} icon={<Clock className="w-4 h-4" />} />
          </div>
          <div className="card rounded-3xl p-6">
            <RevenueChart series={ar.series} prevSeries={ar.prevSeries} />
          </div>
        </>
      )}

      {mr && (mr.interventionsDone > 0 || mr.hoursTotal > 0 || mr.revenueHt > 0 || mr.partsCost > 0 || mr.travelCost > 0 || mr.expectedRevenueHt > 0 || mr.expectedCostHt > 0) && (
        <section className="card rounded-3xl p-6 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-primary">Entretien / Maintenance</h2>
              <p className="text-xs text-secondary mt-0.5">Production récurrente issue des contrats d&apos;entretien</p>
            </div>
            <Link href="/chantiers/entretien" className="text-sm font-semibold text-accent hover:opacity-80">
              Voir le module
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard label="Interventions" value={mr.interventionsDone > 0 ? String(mr.interventionsDone) : '-'} icon={<Wrench className="w-4 h-4" />} />
            <KpiCard label="Heures entretien" value={mr.hoursTotal > 0 ? fmtH(mr.hoursTotal) : '-'} sub={mr.laborCost > 0 ? `${fmt(mr.laborCost)} coût MO` : undefined} icon={<Clock className="w-4 h-4" />} />
            <KpiCard label="Facturé HT" value={mr.revenueHt > 0 ? fmt(mr.revenueHt) : '-'} sub="Factures émises sur la période" icon={<Euro className="w-4 h-4" />} />
            <KpiCard label="Encaissé HT" value={mr.encaisseHt > 0 ? fmt(mr.encaisseHt) : '-'} sub={mr.revenueHt > 0 && mr.encaisseHt < mr.revenueHt ? `${fmt(mr.revenueHt - mr.encaisseHt)} en attente` : 'Factures marquées payées'} icon={<TrendingUp className="w-4 h-4 text-accent-green" />} />
          </div>
          {maintenanceActualCost > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-2 gap-4">
              <KpiCard label="Coûts terrain" value={fmt(mr.partsCost + mr.travelCost + mr.otherCost)} sub={`Pièces ${fmt(mr.partsCost)} · déplacement ${fmt(mr.travelCost)}`} icon={<HardHat className="w-4 h-4" />} />
              <KpiCard label="Marge estimée" value={mr.marginEur > 0 ? fmt(mr.marginEur) : '-'} sub={mr.revenueHt > 0 ? `${fmtPct(maintenanceActualMarginPct)} · après coûts terrain et MO` : undefined} icon={<Target className="w-4 h-4" />} />
            </div>
          )}
          {(mr.expectedRevenueHt > 0 || mr.expectedCostHt > 0) && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KpiCard label="Prévu / période" value={mr.expectedRevenueHt > 0 ? fmt(mr.expectedRevenueHt) : '-'} sub="Prix récurrents actifs" icon={<Calendar className="w-4 h-4" />} />
                <KpiCard label="Coût prévu / période" value={mr.expectedCostHt > 0 ? fmt(mr.expectedCostHt) : '-'} sub="Référence catalogue entretien" icon={<HardHat className="w-4 h-4" />} />
                <KpiCard label="Marge prévue / période" value={fmt(mr.expectedMarginHt)} sub={`${fmtPct(maintenanceExpectedMarginPct)} prévu`} icon={<Target className="w-4 h-4" />} />
              </div>
              {maintenanceActualCost > 0 ? (
                <div className="rounded-2xl bg-secondary/5 border border-secondary/10 p-4 space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-primary">Jauge marge entretien</span>
                    <span className="text-secondary">
                      Réel {fmt(mr.marginEur)} · Prévu {fmt(mr.expectedMarginHt)}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary/15 overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${maintenanceActualMarginPct >= 0.2 ? 'bg-accent-green' : maintenanceActualMarginPct >= 0.05 ? 'bg-accent' : 'bg-red-500'}`}
                      style={{ width: `${Math.max(0, Math.min(100, maintenanceActualMarginPct * 100))}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-xs text-secondary">
                    <span>CA réel {fmt(mr.revenueHt)}</span>
                    <span>Coûts réels {fmt(maintenanceActualCost)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-secondary">Aucun coût réel saisi sur la période. La jauge sera disponible dès qu&apos;une heure ou dépense est enregistrée.</p>
              )}
            </>
          )}
        </section>
      )}

      {/* Objectifs */}
      <div className="card rounded-3xl p-6">
        <div className="flex justify-between items-center mb-5">
          <h2 className="text-lg font-bold text-primary">
            Objectifs {vue === 'mois' ? `${MONTH_LABELS[month - 1]} ${year}` : year}
          </h2>
          <button
            onClick={() => setShowObjectives(true)}
            className="flex items-center gap-1.5 text-sm text-accent font-semibold hover:text-accent/80 transition-colors"
          >
            <Target className="w-4 h-4" />
            Modifier
          </button>
        </div>

        {objectivesEmpty ? (
          <button onClick={() => setShowObjectives(true)} className="text-sm text-secondary hover:text-primary transition-colors">
            Aucun objectif défini. Cliquer pour en ajouter.
          </button>
        ) : vue === 'mois' && monthlyObjectives ? (
          <div className="space-y-4">
            {monthlyObjectives.revenue_ht_target && (
              <ProgressBar label={billedLabel} current={r?.caHt ?? 0} target={monthlyObjectives.revenue_ht_target} format={fmt} onClear={() => clearMonthlyField('revenue_ht_target')} />
            )}
            {monthlyObjectives.margin_eur_target && (
              <ProgressBar label="Bénéfice estimé (EUR)" current={r?.beneficeEstime ?? 0} target={monthlyObjectives.margin_eur_target} format={fmt} onClear={() => clearMonthlyField('margin_eur_target')} />
            )}
            {monthlyObjectives.margin_pct_target && (
              <ProgressBar label="Bénéfice estimé (%)" current={monthlyActualMarginPct * 100} target={monthlyObjectives.margin_pct_target} format={n => `${n.toFixed(1)} %`} onClear={() => clearMonthlyField('margin_pct_target')} />
            )}
            {monthlyObjectives.chantiers_count_target && (
              <ProgressBar label="Chantiers terminés" current={r?.chantiersTermines ?? 0} target={monthlyObjectives.chantiers_count_target} format={n => String(Math.round(n))} onClear={() => clearMonthlyField('chantiers_count_target')} />
            )}
            {monthlyObjectives.hours_target && (
              <ProgressBar label="Heures travaillées" current={hoursReport?.total ?? 0} target={monthlyObjectives.hours_target} format={fmtH} onClear={() => clearMonthlyField('hours_target')} />
            )}
            {monthlyObjectives.customs.map((c, i) => (
              <ProgressBar key={i} label={c.label} current={0} target={c.target} format={n => `${n.toFixed(1)} ${c.unit}`} onClear={() => removeMonthlyCustom(c.id, i)} />
            ))}
          </div>
        ) : vue === 'annee' && annualObjectives ? (
          <div className="space-y-4">
            {annualObjectives.revenue_ht_target && (
              <ProgressBar label={billedLabel} current={ar?.caHt ?? 0} target={annualObjectives.revenue_ht_target} format={fmt} onClear={() => clearAnnualField('revenue_ht_target')} />
            )}
            {annualObjectives.margin_eur_target && (
              <ProgressBar label="Bénéfice estimé (EUR)" current={ar?.beneficeEstime ?? 0} target={annualObjectives.margin_eur_target} format={fmt} onClear={() => clearAnnualField('margin_eur_target')} />
            )}
            {annualObjectives.margin_pct_target && (
              <ProgressBar label="Bénéfice estimé (%)" current={annualActualMarginPct * 100} target={annualObjectives.margin_pct_target} format={n => `${n.toFixed(1)} %`} onClear={() => clearAnnualField('margin_pct_target')} />
            )}
            {annualObjectives.chantiers_count_target && (
              <ProgressBar label="Chantiers terminés" current={ar?.chantiersTermines ?? 0} target={annualObjectives.chantiers_count_target} format={n => String(Math.round(n))} onClear={() => clearAnnualField('chantiers_count_target')} />
            )}
            {annualObjectives.new_clients_target && ar && (
              <ProgressBar label="Nouveaux clients" current={ar.nouveauxClients} target={annualObjectives.new_clients_target} format={n => String(Math.round(n))} onClear={() => clearAnnualField('new_clients_target')} />
            )}
            {annualObjectives.hours_target && (
              <ProgressBar label="Heures travaillées" current={hoursReport?.total ?? 0} target={annualObjectives.hours_target} format={fmtH} onClear={() => clearAnnualField('hours_target')} />
            )}
            {annualObjectives.customs.map((c, i) => (
              <ProgressBar key={i} label={c.label} current={0} target={c.target} format={n => `${n.toFixed(1)} ${c.unit}`} onClear={() => removeAnnualCustom(c.id, i)} />
            ))}
          </div>
        ) : null}
      </div>

      <div className="card rounded-3xl p-6">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-primary">
            Heures par personne
            {hoursReport && hoursReport.total > 0 && (
              <span className="ml-2 text-sm font-normal text-secondary">({fmtH(hoursReport.total)} total)</span>
            )}
          </h2>
        </div>
        {hoursReport && hoursReport.byPerson.length > 0 ? (
          <div className="space-y-3">
            {hoursReport.byPerson.map((p, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <span className="text-xs font-bold text-accent">{p.personName.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-sm font-medium text-primary truncate">{p.personName}</span>
                    <span className="text-sm font-semibold tabular-nums text-primary ml-2">{fmtH(p.hours)}</span>
                  </div>
                  <div className="h-1.5 bg-secondary/20 rounded-full overflow-hidden">
                    <div className="h-full bg-accent rounded-full" style={{ width: `${(p.hours / hoursReport.total) * 100}%` }} />
                  </div>
                </div>
                <span className="text-xs text-secondary w-10 text-right">
                  {((p.hours / hoursReport.total) * 100).toFixed(0)} %
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-secondary">Aucune heure pointee sur cette periode.</p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card rounded-3xl p-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-bold text-primary">Meilleurs clients</h2>
              <p className="text-xs text-secondary mt-0.5">Classés par facturé sur {vue === 'mois' ? `${MONTH_LABELS[month - 1]} ${year}` : `l'année ${year}`}</p>
            </div>
            <Link href="/clients" className="text-xs text-accent font-semibold hover:underline">Voir tous</Link>
          </div>
          {topClients.length === 0 ? (
            <p className="text-sm text-secondary">Aucune donnée pour cette période.</p>
          ) : (
            <div className="space-y-3">
              {topClients.slice(0, 10).map((c, i) => (
                <div key={c.clientId} className="flex items-start gap-3">
                  <span className="w-6 text-xs font-bold text-secondary mt-0.5 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <Link href={`/clients/${c.clientId}`} className="text-sm font-medium text-primary truncate hover:text-accent transition-colors">{c.clientName}</Link>
                      <span className="text-sm font-bold tabular-nums text-primary flex-shrink-0">{fmt(c.caHt)}</span>
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-secondary">
                      <span>Marge : {fmt(c.marginEur)}</span>
                      {c.chantiersCount > 0 && <span>{c.chantiersCount} chantier{c.chantiersCount > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card rounded-3xl p-6">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-bold text-primary">Meilleurs chantiers</h2>
              <p className="text-xs text-secondary mt-0.5">Classés par marge HT encaissée sur {vue === 'mois' ? `${MONTH_LABELS[month - 1]} ${year}` : `l'année ${year}`}</p>
            </div>
            <Link href="/chantiers" className="text-xs text-accent font-semibold hover:underline">Voir tous</Link>
          </div>
          {topChantiers.length === 0 ? (
            <p className="text-sm text-secondary">Aucune donnée pour cette période.</p>
          ) : (
            <div className="space-y-3">
              {[...topChantiers].sort((a, b) => b.marginEur - a.marginEur).slice(0, 10).map((c, i) => (
                <div key={c.chantierId} className="flex items-start gap-3">
                  <span className="w-6 text-xs font-bold text-secondary mt-0.5 flex-shrink-0">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline gap-2">
                      <Link href={`/chantiers/${c.chantierId}`} className="text-sm font-medium text-primary truncate hover:text-accent transition-colors">{c.chantierTitle}</Link>
                      <span className={`text-sm font-bold tabular-nums flex-shrink-0 ${c.marginEur >= 0 ? 'text-accent-green' : 'text-red-500'}`}>{fmt(c.marginEur)}</span>
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-secondary">
                      {c.clientName && <span>{c.clientName}</span>}
                      <span>{billedLabel} : {fmt(c.caHt)}</span>
                      <span>{collectedLabel} : {fmt(c.encaisseTtc)}</span>
                      <span>Marge HT : {fmtPct(c.marginPct)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showObjectives && vue === 'annee' && annualObjectives && (
        <ObjectivesModalAnnual
          year={year}
          objectives={annualObjectives}
          onClose={() => setShowObjectives(false)}
          onSaved={updated => setAnnualObjectives(updated)}
        />
      )}
      {showObjectives && vue === 'mois' && monthlyObjectives && (
        <ObjectivesModalMonthly
          year={year}
          month={month}
          objectives={monthlyObjectives}
          onClose={() => setShowObjectives(false)}
          onSaved={updated => setMonthlyObjectives(updated)}
        />
      )}
    </main>
  )
}
