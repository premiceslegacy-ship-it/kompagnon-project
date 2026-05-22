'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import {
  TrendingUp, TrendingDown, Users, HardHat, Clock, Euro,
  Target, ChevronRight, Plus, Trash2, BarChart2, FileDown, X, AlertTriangle,
} from 'lucide-react'
import type {
  MonthlyReport, AnnualReport, HoursReport,
  TopClientEntry, TopChantierEntry, AnnualObjectives, CustomObjective,
  MemberWithoutRate,
} from '@/lib/data/queries/reporting'
import { saveObjectivesAction } from './actions'

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

function ProgressBar({ label, current, target, format }: {
  label: string; current: number; target: number | null; format: (n: number) => string
}) {
  if (!target) return null
  const pct = Math.min((current / target) * 100, 100)
  const color = pct >= 100 ? 'bg-accent-green' : pct >= 70 ? 'bg-accent' : 'bg-blue-500'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-sm">
        <span className="font-medium text-primary">{label}</span>
        <span className="text-secondary tabular-nums">{format(current)} / {format(target)}</span>
      </div>
      <div className="h-2 bg-secondary/20 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-secondary text-right">{pct.toFixed(0)} %</p>
    </div>
  )
}


function ObjectivesModal({ year, objectives, onClose }: {
  year: number
  objectives: AnnualObjectives
  onClose: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [form, setForm] = useState<AnnualObjectives>({ ...objectives })
  const [error, setError] = useState<string | null>(null)

  function addCustom() {
    setForm(f => ({ ...f, customs: [...f.customs, { label: '', target: 0, unit: '', sort_order: f.customs.length }] }))
  }

  function removeCustom(i: number) {
    setForm(f => ({ ...f, customs: f.customs.filter((_, idx) => idx !== i) }))
  }

  function updateCustom(i: number, field: keyof CustomObjective, value: string | number) {
    setForm(f => ({
      ...f,
      customs: f.customs.map((c, idx) => idx === i ? { ...c, [field]: value } : c),
    }))
  }

  function parseNum(v: string): number | null {
    const n = parseFloat(v.replace(',', '.'))
    return isNaN(n) ? null : n
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveObjectivesAction(year, form)
      if (result.error) { setError(result.error); return }
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative z-10 card rounded-3xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold text-primary">Objectifs {year}</h2>
          <button onClick={onClose} className="p-2 hover:bg-secondary/20 rounded-xl transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">CA HT cible (€)</label>
              <input
                type="number" placeholder="100000" step="1000"
                value={form.revenue_ht_target ?? ''}
                onChange={e => setForm(f => ({ ...f, revenue_ht_target: parseNum(e.target.value) }))}
                className="w-full input-field text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Marge EUR cible (€)</label>
              <input
                type="number" placeholder="30000" step="1000"
                value={form.margin_eur_target ?? ''}
                onChange={e => setForm(f => ({ ...f, margin_eur_target: parseNum(e.target.value) }))}
                className="w-full input-field text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Marge % cible</label>
              <input
                type="number" placeholder="30" step="0.5" min="0" max="100"
                value={form.margin_pct_target ?? ''}
                onChange={e => setForm(f => ({ ...f, margin_pct_target: parseNum(e.target.value) }))}
                className="w-full input-field text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Nb chantiers terminés</label>
              <input
                type="number" placeholder="20" step="1"
                value={form.chantiers_count_target ?? ''}
                onChange={e => setForm(f => ({ ...f, chantiers_count_target: parseNum(e.target.value) }))}
                className="w-full input-field text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Nouveaux clients</label>
              <input
                type="number" placeholder="10" step="1"
                value={form.new_clients_target ?? ''}
                onChange={e => setForm(f => ({ ...f, new_clients_target: parseNum(e.target.value) }))}
                className="w-full input-field text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wide block mb-1">Heures totales</label>
              <input
                type="number" placeholder="2000" step="50"
                value={form.hours_target ?? ''}
                onChange={e => setForm(f => ({ ...f, hours_target: parseNum(e.target.value) }))}
                className="w-full input-field text-sm"
              />
            </div>
          </div>

          {/* Objectifs custom */}
          <div className="border-t border-secondary/20 pt-4">
            <div className="flex justify-between items-center mb-3">
              <p className="text-sm font-semibold text-primary">Objectifs personnalisés</p>
              <button onClick={addCustom} className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 transition-colors font-medium">
                <Plus className="w-3.5 h-3.5" /> Ajouter
              </button>
            </div>
            <div className="space-y-2">
              {form.customs.map((c, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    type="text" placeholder="Libellé"
                    value={c.label}
                    onChange={e => updateCustom(i, 'label', e.target.value)}
                    className="flex-1 input-field text-sm"
                  />
                  <input
                    type="number" placeholder="Cible"
                    value={c.target}
                    onChange={e => updateCustom(i, 'target', parseFloat(e.target.value) || 0)}
                    className="w-24 input-field text-sm"
                  />
                  <input
                    type="text" placeholder="unité"
                    value={c.unit}
                    onChange={e => updateCustom(i, 'unit', e.target.value)}
                    className="w-16 input-field text-sm"
                  />
                  <button onClick={() => removeCustom(i)} className="p-1.5 text-red-500 hover:bg-red-500/10 rounded-lg transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button onClick={onClose} className="flex-1 py-3 rounded-pill border border-secondary/30 text-secondary text-sm font-semibold hover:bg-secondary/10 transition-colors">
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={pending}
              className="flex-1 py-3 rounded-pill bg-accent text-black text-sm font-bold hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50"
            >
              {pending ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


type Props = {
  vue: 'mois' | 'annee'
  year: number
  month: number
  monthlyReport: MonthlyReport | null
  annualReport: AnnualReport | null
  hoursReport: HoursReport | null
  topClients: TopClientEntry[]
  topChantiers: TopChantierEntry[]
  objectives: AnnualObjectives | null
  membersWithoutRate: MemberWithoutRate[]
}

export default function RapportsClient({
  vue, year, month, monthlyReport, annualReport, hoursReport,
  topClients, topChantiers, objectives, membersWithoutRate,
}: Props) {
  const router = useRouter()
  const [showObjectives, setShowObjectives] = useState(false)

  function navigate(newVue: 'mois' | 'annee', periode?: string) {
    const params = new URLSearchParams({ vue: newVue })
    if (periode) params.set('periode', periode)
    router.push(`/rapports?${params.toString()}`)
  }

  const now = new Date()
  const prevYear = year - 1
  const nextYear = year + 1
  const prevMonth = month === 1 ? 12 : month - 1
  const prevMonthYear = month === 1 ? year - 1 : year
  const nextMonth = month === 12 ? 1 : month + 1
  const nextMonthYear = month === 12 ? year + 1 : year
  const isMonthFuture = (vue === 'mois') && (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1))
  const isYearFuture = (vue === 'annee') && year >= now.getFullYear()

  const r = monthlyReport
  const ar = annualReport

  return (
    <main className="page-container space-y-6 md:space-y-8">
      {/* En-tête + nav */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-primary tracking-tight">
            Rapports
          </h1>
          <p className="text-secondary text-sm mt-0.5">
            {vue === 'mois'
              ? `${MONTH_LABELS[month - 1]} ${year}`
              : `Année ${year}`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 items-center">
          {/* Tabs vue */}
          <div className="flex rounded-xl overflow-hidden border border-secondary/20 text-sm font-semibold">
            <button
              onClick={() => navigate('mois', `${year}-${String(month).padStart(2, '0')}`)}
              className={`px-4 py-2 transition-colors ${vue === 'mois' ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}
            >
              Mensuel
            </button>
            <button
              onClick={() => navigate('annee', String(year))}
              className={`px-4 py-2 transition-colors ${vue === 'annee' ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}
            >
              Annuel
            </button>
          </div>

          {/* Nav période */}
          {vue === 'mois' ? (
            <div className="flex items-center gap-1 text-sm">
              <button
                onClick={() => navigate('mois', `${prevMonthYear}-${String(prevMonth).padStart(2, '0')}`)}
                className="px-3 py-2 rounded-xl border border-secondary/20 text-secondary hover:text-primary transition-colors"
              >
                &lsaquo;
              </button>
              <span className="px-2 font-medium text-primary whitespace-nowrap">
                {MONTH_LABELS[month - 1].slice(0, 3)}. {year}
              </span>
              <button
                onClick={() => navigate('mois', `${nextMonthYear}-${String(nextMonth).padStart(2, '0')}`)}
                disabled={isMonthFuture}
                className="px-3 py-2 rounded-xl border border-secondary/20 text-secondary hover:text-primary transition-colors disabled:opacity-30"
              >
                &rsaquo;
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-sm">
              <button
                onClick={() => navigate('annee', String(prevYear))}
                className="px-3 py-2 rounded-xl border border-secondary/20 text-secondary hover:text-primary transition-colors"
              >
                &lsaquo;
              </button>
              <span className="px-2 font-medium text-primary">{year}</span>
              <button
                onClick={() => navigate('annee', String(nextYear))}
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
            <KpiCard
              label="CA HT"
              value={r.caHt > 0 ? fmt(r.caHt) : '-'}
              sub={r.caTtc > 0 ? `${fmt(r.caTtc)} TTC` : undefined}
              delta={<Delta current={r.caHt} prev={r.prevCaHt} />}
              icon={<Euro className="w-4 h-4" />}
            />
            <KpiCard
              label="Encaissé"
              value={r.encaisse > 0 ? fmt(r.encaisse) : '-'}
              delta={<Delta current={r.encaisse} prev={r.prevEncaisse} />}
              icon={<TrendingUp className="w-4 h-4 text-accent-green" />}
            />
            <KpiCard
              label="TVA collectée"
              value={r.tvaDue > 0 ? fmt(r.tvaDue) : '-'}
              delta={<Delta current={r.tvaDue} prev={r.prevTvaDue} />}
              icon={<BarChart2 className="w-4 h-4" />}
            />
            <KpiCard
              label="Bénéfice estimé"
              value={r.hasCostData ? fmt(r.beneficeEstime) : '-'}
              sub={r.hasCostData ? 'CA HT - dépenses - MO' : 'Aucun coût saisi ce mois'}
              icon={<Target className="w-4 h-4" />}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="Chantiers terminés"
              value={String(r.chantiersTermines || '-')}
              icon={<HardHat className="w-4 h-4 text-amber-500" />}
            />
            <KpiCard
              label="Chantiers en cours"
              value={String(r.chantiersEnCours || '-')}
              icon={<HardHat className="w-4 h-4" />}
            />
            <KpiCard
              label="Heures travaillées"
              value={r.heuresTotal > 0 ? fmtH(r.heuresTotal) : '-'}
              delta={<Delta current={r.heuresTotal} prev={r.prevHeuresTotal} />}
              icon={<Clock className="w-4 h-4" />}
            />
            <KpiCard
              label="Factures émises"
              value={r.nouvellesFactures > 0 ? String(r.nouvellesFactures) : '-'}
              sub={r.facturesPayees > 0 ? `${r.facturesPayees} payée(s)` : undefined}
              icon={<ChevronRight className="w-4 h-4" />}
            />
          </div>
        </>
      )}

      {vue === 'annee' && ar && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <KpiCard
              label="CA HT"
              value={ar.caHt > 0 ? fmt(ar.caHt) : '-'}
              sub={ar.caTtc > 0 ? `${fmt(ar.caTtc)} TTC` : undefined}
              delta={<Delta current={ar.caHt} prev={ar.prevCaHt} />}
              icon={<Euro className="w-4 h-4" />}
            />
            <KpiCard
              label="Encaissé"
              value={ar.encaisse > 0 ? fmt(ar.encaisse) : '-'}
              delta={<Delta current={ar.encaisse} prev={ar.prevEncaisse} />}
              icon={<TrendingUp className="w-4 h-4 text-accent-green" />}
            />
            <KpiCard
              label="TVA collectée"
              value={ar.tvaDue > 0 ? fmt(ar.tvaDue) : '-'}
              icon={<BarChart2 className="w-4 h-4" />}
            />
            <KpiCard
              label="Bénéfice estimé"
              value={ar.hasCostData ? fmt(ar.beneficeEstime) : '-'}
              sub={ar.hasCostData ? 'CA HT - dépenses - MO' : 'Aucun coût saisi cette année'}
              icon={<Target className="w-4 h-4" />}
            />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <KpiCard
              label="Chantiers terminés"
              value={String(ar.chantiersTermines || '-')}
              icon={<HardHat className="w-4 h-4 text-amber-500" />}
            />
            <KpiCard
              label="Nouveaux clients"
              value={String(ar.nouveauxClients || '-')}
              icon={<Users className="w-4 h-4 text-blue-500" />}
            />
            <KpiCard
              label="Heures travaillées"
              value={ar.heuresTotal > 0 ? fmtH(ar.heuresTotal) : '-'}
              icon={<Clock className="w-4 h-4" />}
            />
          </div>

          {/* Graphique CA mensuel */}
          <div className="card rounded-3xl p-6">
            <RevenueChart series={ar.series} prevSeries={ar.prevSeries} />
          </div>
        </>
      )}

      {objectives && (
        <div className="card rounded-3xl p-6">
          <div className="flex justify-between items-center mb-5">
            <h2 className="text-lg font-bold text-primary">Objectifs {year}</h2>
            <button
              onClick={() => setShowObjectives(true)}
              className="flex items-center gap-1.5 text-sm text-accent font-semibold hover:text-accent/80 transition-colors"
            >
              <Target className="w-4 h-4" />
              Modifier
            </button>
          </div>
          {[
            objectives.revenue_ht_target && { label: 'CA HT', current: vue === 'mois' ? (r?.caHt ?? 0) : (ar?.caHt ?? 0), target: objectives.revenue_ht_target, format: fmt },
            objectives.margin_eur_target && { label: 'Marge (EUR)', current: vue === 'mois' ? (r?.beneficeEstime ?? 0) : (ar?.beneficeEstime ?? 0), target: objectives.margin_eur_target, format: fmt },
            objectives.chantiers_count_target && { label: 'Chantiers terminés', current: vue === 'mois' ? (r?.chantiersTermines ?? 0) : (ar?.chantiersTermines ?? 0), target: objectives.chantiers_count_target, format: (n: number) => String(Math.round(n)) },
            objectives.new_clients_target && vue === 'annee' && ar && { label: 'Nouveaux clients', current: ar.nouveauxClients, target: objectives.new_clients_target, format: (n: number) => String(Math.round(n)) },
            objectives.hours_target && { label: 'Heures travaillées', current: hoursReport?.total ?? 0, target: objectives.hours_target, format: fmtH },
            ...objectives.customs.map(c => ({ label: c.label, current: 0, target: c.target, format: (n: number) => `${n.toFixed(1)} ${c.unit}` })),
          ].filter(Boolean).map((obj, i) => (
            obj && <div key={i} className="mb-4 last:mb-0">
              <ProgressBar label={obj.label} current={obj.current} target={obj.target} format={obj.format} />
            </div>
          ))}
          {!objectives.revenue_ht_target && !objectives.margin_eur_target && !objectives.chantiers_count_target && !objectives.hours_target && objectives.customs.length === 0 && (
            <button onClick={() => setShowObjectives(true)} className="text-sm text-secondary hover:text-primary transition-colors">
              Aucun objectif défini. Cliquer pour en ajouter.
            </button>
          )}
        </div>
      )}

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
                    <div
                      className="h-full bg-accent rounded-full"
                      style={{ width: `${(p.hours / hoursReport.total) * 100}%` }}
                    />
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
              <p className="text-xs text-secondary mt-0.5">Classés par CA HT sur {vue === 'mois' ? `${MONTH_LABELS[month - 1]} ${year}` : `l'année ${year}`}</p>
            </div>
            <Link href="/clients" className="text-xs text-accent font-semibold hover:underline">
              Voir tous
            </Link>
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
                      <Link
                        href={`/clients/${c.clientId}`}
                        className="text-sm font-medium text-primary truncate hover:text-accent transition-colors"
                      >
                        {c.clientName}
                      </Link>
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
              <p className="text-xs text-secondary mt-0.5">Classés par marge encaissée sur {vue === 'mois' ? `${MONTH_LABELS[month - 1]} ${year}` : `l'année ${year}`}</p>
            </div>
            <Link href="/chantiers" className="text-xs text-accent font-semibold hover:underline">
              Voir tous
            </Link>
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
                      <Link
                        href={`/chantiers/${c.chantierId}`}
                        className="text-sm font-medium text-primary truncate hover:text-accent transition-colors"
                      >
                        {c.chantierTitle}
                      </Link>
                      <span className={`text-sm font-bold tabular-nums flex-shrink-0 ${c.marginEur >= 0 ? 'text-accent-green' : 'text-red-500'}`}>
                        {fmt(c.marginEur)}
                      </span>
                    </div>
                    <div className="flex gap-3 mt-0.5 text-xs text-secondary">
                      {c.clientName && <span>{c.clientName}</span>}
                      <span>Facturé : {fmt(c.caHt)}</span>
                      <span>Encaissé : {fmt(c.encaisseHt)}</span>
                      <span>Marge : {fmtPct(c.marginPct)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showObjectives && objectives && (
        <ObjectivesModal year={year} objectives={objectives} onClose={() => setShowObjectives(false)} />
      )}
    </main>
  )
}
