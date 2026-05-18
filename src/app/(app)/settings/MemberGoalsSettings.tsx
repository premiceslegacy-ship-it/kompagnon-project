'use client'

import React, { useState, useTransition, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Target, Plus, Trash2, Loader2, Users, Check } from 'lucide-react'
import { upsertMemberGoal, bulkUpsertMemberGoals, deleteMemberGoal, fetchMemberGoalsByMonth } from '@/lib/data/mutations/member-goals'
import type { BulkTarget, GoalDisplayRow } from '@/lib/data/mutations/member-goals'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { TeamMember } from '@/lib/data/queries/team'
import type { MemberGoal } from '@/lib/data/queries/member-goals'

const fieldCls = "w-full rounded-lg border border-black/12 dark:border-white/18 bg-white dark:bg-white/[0.06] px-3 py-2 text-sm text-primary placeholder:text-secondary/60 focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/60 transition-colors"

const METRICS = [
  { value: 'heures_terrain', label: 'Heures terrain', unit: 'h' },
  { value: 'taches_completees', label: 'Tâches complétées', unit: '' },
  { value: 'chantiers_traites', label: 'Chantiers traités', unit: '' },
  { value: 'custom', label: 'Objectif personnalisé', unit: '' },
]

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

type GoalDisplay = GoalDisplayRow


function GoalRowSkeleton() {
  return (
    <div className="flex items-center gap-4 p-3 rounded-2xl border border-black/10 dark:border-white/15 bg-black/[0.02] dark:bg-white/[0.03] animate-pulse">
      <div className="flex-1 space-y-2">
        <div className="h-3.5 w-32 rounded bg-black/10 dark:bg-white/10" />
        <div className="h-3 w-48 rounded bg-black/6 dark:bg-white/6" />
      </div>
      <div className="h-6 w-6 rounded-lg bg-black/8 dark:bg-white/8" />
    </div>
  )
}

/** Wrapper visuel pour chaque groupe du formulaire */
function FormSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-black/10 dark:border-white/15 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-black/8 dark:border-white/10 bg-black/[0.03] dark:bg-white/[0.04]">
        <span className="text-[11px] font-semibold text-secondary uppercase tracking-wider">{label}</span>
      </div>
      <div className="p-3 space-y-2">
        {children}
      </div>
    </div>
  )
}

type SelectedMember =
  | { kind: 'intervenant'; id: string; label: string }
  | { kind: 'org'; membership_id: string; label: string }
  | { kind: 'none' }

type Props = {
  intervenants: IndividualMember[]
  orgMembers: TeamMember[]
  initialGoals: GoalDisplay[]
  currentUserId: string
}

export default function MemberGoalsSettings({ intervenants, orgMembers, initialGoals, currentUserId }: Props) {
  const router = useRouter()
  const now = new Date()
  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1]

  const linkedProfileIds = new Set(intervenants.map(i => i.profile_id).filter(Boolean))
  const pureOrgMembers = orgMembers.filter(
    m => !linkedProfileIds.has(m.user_id) && m.user_id !== currentUserId,
  )
  const filteredIntervenants = intervenants.filter(i => i.profile_id !== currentUserId)
  const hasAnyMember = filteredIntervenants.length > 0 || pureOrgMembers.length > 0

  const [goals, setGoals] = useState(initialGoals)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [loadingGoals, setLoadingGoals] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [filterMonth, setFilterMonth] = useState(now.getMonth() + 1)
  const [filterYear, setFilterYear] = useState(now.getFullYear())

  const reloadGoals = useCallback(async (year: number, month: number) => {
    setLoadingGoals(true)
    try {
      const res = await fetchMemberGoalsByMonth(year, month)
      if (res.error) setError(res.error)
      else setGoals(res.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur de chargement.')
    } finally {
      setLoadingGoals(false)
    }
  }, [])

  // Charge les vraies données dès le montage (initialGoals peut être vide si le cache serveur est périmé)
  useEffect(() => {
    reloadGoals(filterYear, filterMonth)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleFilterMonth(m: number) {
    setFilterMonth(m)
    reloadGoals(filterYear, m)
  }

  function handleFilterYear(y: number) {
    setFilterYear(y)
    reloadGoals(y, filterMonth)
  }

  const defaultSelected: SelectedMember = filteredIntervenants.length > 0
    ? {
        kind: 'intervenant',
        id: filteredIntervenants[0].id,
        label: [filteredIntervenants[0].prenom, filteredIntervenants[0].name].filter(Boolean).join(' '),
      }
    : pureOrgMembers.length > 0
      ? {
          kind: 'org',
          membership_id: pureOrgMembers[0].membership_id,
          label: pureOrgMembers[0].full_name ?? pureOrgMembers[0].email,
        }
      : { kind: 'none' }

  const [selected, setSelected] = useState<SelectedMember>(defaultSelected)
  const [bulkAll, setBulkAll] = useState(false)
  const [metric, setMetric] = useState('heures_terrain')
  const [label, setLabel] = useState('Heures terrain')
  const [targetVal, setTargetVal] = useState('')
  const [unit, setUnit] = useState('h')
  const [note, setNote] = useState('')
  const [formMonth, setFormMonth] = useState(now.getMonth() + 1)
  const [formYear, setFormYear] = useState(now.getFullYear())

  function handleMetricChange(v: string) {
    const preset = METRICS.find(m => m.value === v)
    setMetric(v)
    setLabel(preset?.label ?? '')
    setUnit(preset?.unit ?? '')
  }

  function handleSelectChange(raw: string) {
    if (raw.startsWith('org:')) {
      const mid = raw.slice(4)
      const m = pureOrgMembers.find(m => m.membership_id === mid)
      setSelected({ kind: 'org', membership_id: mid, label: m?.full_name ?? m?.email ?? '' })
    } else if (raw !== '') {
      const m = filteredIntervenants.find(i => i.id === raw)
      setSelected({
        kind: 'intervenant',
        id: raw,
        label: m ? [m.prenom, m.name].filter(Boolean).join(' ') : '',
      })
    }
  }

  function selectedValue(): string {
    if (selected.kind === 'intervenant') return selected.id
    if (selected.kind === 'org') return `org:${selected.membership_id}`
    return ''
  }

  function handleSubmit() {
    const t = parseFloat(targetVal)
    if (!targetVal || isNaN(t) || t <= 0) {
      setError('La valeur cible doit être un nombre positif.')
      return
    }
    if (!bulkAll && selected.kind === 'none') {
      setError('Choisissez un membre.')
      return
    }
    setError(null)

    startTransition(async () => {
      const base = {
        period_year: formYear,
        period_month: formMonth,
        metric,
        label: label || (METRICS.find(m => m.value === metric)?.label ?? metric),
        target: t,
        unit,
        note: note || undefined,
      }

      let res: { error?: string }

      if (bulkAll) {
        const targets: BulkTarget[] = [
          ...filteredIntervenants.map(i => ({ kind: 'intervenant' as const, id: i.id })),
          ...pureOrgMembers.map(m => ({ kind: 'org' as const, membership_id: m.membership_id })),
        ]
        res = await bulkUpsertMemberGoals(targets, base)
      } else if (selected.kind === 'intervenant') {
        res = await upsertMemberGoal({ ...base, member_id: selected.id })
      } else if (selected.kind === 'org') {
        res = await upsertMemberGoal({ ...base, membership_id: selected.membership_id })
      } else {
        return
      }

      if (res.error) { setError(res.error); return }

      setShowForm(false)
      setTargetVal('')
      setNote('')
      // Cale le filtre sur la période de l'objectif créé et recharge depuis le serveur
      setFilterMonth(formMonth)
      setFilterYear(formYear)
      await reloadGoals(formYear, formMonth)
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    setDeleting(id)
    startTransition(async () => {
      const res = await deleteMemberGoal(id)
      if (res.error) { setError(res.error); setDeleting(null); return }
      setDeleting(null)
      await reloadGoals(filterYear, filterMonth)
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      {/* En-tête */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-xl font-bold text-primary flex items-center gap-2">
            <Target className="w-5 h-5 text-accent" />
            Objectifs membres
          </h3>
          <p className="text-sm text-secondary mt-1">
            Fixez des objectifs mensuels par membre (heures terrain, tâches, chantiers).
          </p>
        </div>
        {hasAnyMember && (
          <button
            onClick={() => { setShowForm(v => !v); setError(null) }}
            className="self-start sm:self-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-black font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4" />
            {showForm ? 'Fermer' : 'Ajouter'}
          </button>
        )}
      </div>

      {!hasAnyMember && (
        <div className="rounded-xl border border-dashed border-black/10 dark:border-white/15 px-4 py-6 text-center text-sm text-secondary">
          Aucun membre dans l&apos;organisation. Ajoutez des intervenants ou invitez des membres pour leur fixer des objectifs.
        </div>
      )}

      {/* Formulaire */}
      {showForm && (
        <div className="rounded-2xl border border-black/12 dark:border-white/18 bg-black/[0.015] dark:bg-white/[0.02] p-4 space-y-3">
          <h4 className="font-semibold text-primary text-sm mb-1">Nouvel objectif</h4>

          {/* Membre cible */}
          <FormSection label="Membre cible">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={() => setBulkAll(v => !v)}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-all ${
                  bulkAll
                    ? 'bg-accent/10 border-accent/40 text-accent'
                    : 'border-black/10 dark:border-white/15 text-secondary hover:text-primary'
                }`}
              >
                {bulkAll ? <Check className="w-4 h-4" /> : <Users className="w-4 h-4" />}
                Tous les membres
              </button>
              {!bulkAll && (
                <select
                  value={selectedValue()}
                  onChange={e => handleSelectChange(e.target.value)}
                  className="{fieldCls}"
                >
                  <option value="">-- Choisir un membre --</option>
                  {filteredIntervenants.length > 0 && (
                    <optgroup label="Intervenants terrain">
                      {filteredIntervenants.map(m => (
                        <option key={m.id} value={m.id}>
                          {[m.prenom, m.name].filter(Boolean).join(' ')}{m.role_label ? ` · ${m.role_label}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {pureOrgMembers.length > 0 && (
                    <optgroup label="Membres de l'organisation">
                      {pureOrgMembers.map(m => (
                        <option key={m.user_id} value={`org:${m.membership_id}`}>
                          {m.full_name ?? m.email} · {m.role_name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              )}
            </div>
          </FormSection>

          {/* Période */}
          <FormSection label="Période">
            <div className="flex gap-2">
              <select
                value={formMonth}
                onChange={e => setFormMonth(Number(e.target.value))}
                className="{fieldCls}"
              >
                {MONTHS.map((m, i) => (
                  <option key={i + 1} value={i + 1}>{m}</option>
                ))}
              </select>
              <select
                value={formYear}
                onChange={e => setFormYear(Number(e.target.value))}
                className="{fieldCls}"
              >
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </FormSection>

          {/* Métrique */}
          <FormSection label="Type d'objectif">
            <select
              value={metric}
              onChange={e => handleMetricChange(e.target.value)}
              className={fieldCls}
            >
              {METRICS.map(m => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
            <input
              type="text"
              placeholder="Libellé affiché au membre (optionnel)"
              value={label}
              onChange={e => setLabel(e.target.value)}
              className={fieldCls}
            />
          </FormSection>

          {/* Valeur cible */}
          <FormSection label="Valeur cible">
            <div className="flex gap-2">
              <input
                type="number"
                min="0"
                step="0.5"
                placeholder="Ex : 140"
                value={targetVal}
                onChange={e => setTargetVal(e.target.value)}
                className="{fieldCls}"
              />
              <input
                type="text"
                placeholder="Unité (ex : h)"
                value={unit}
                onChange={e => setUnit(e.target.value)}
                className={`${fieldCls} !w-24`}
              />
            </div>
          </FormSection>

          {/* Note */}
          <FormSection label="Note interne (admin uniquement)">
            <input
              type="text"
              placeholder="Ex : objectif ajusté suite entretien"
              value={note}
              onChange={e => setNote(e.target.value)}
              className={fieldCls}
            />
          </FormSection>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center pt-1">
            <button
              onClick={handleSubmit}
              disabled={isPending}
              className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-accent text-black font-semibold text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
            >
              {isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Target className="w-4 h-4" />
              }
              {isPending ? 'Enregistrement...' : bulkAll ? 'Appliquer à tous' : 'Enregistrer'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setError(null) }}
              disabled={isPending}
              className="px-4 py-2 rounded-xl text-secondary hover:text-primary text-sm font-medium transition-colors disabled:opacity-40"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Filtre mois / année */}
      <div className="rounded-xl border border-black/10 dark:border-white/15 bg-black/[0.02] dark:bg-white/[0.03] px-4 py-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <span className="text-xs font-semibold text-secondary uppercase tracking-wider mr-1">Période affichée</span>
          <div className="flex gap-2">
            <select
              value={filterMonth}
              onChange={e => handleFilterMonth(Number(e.target.value))}
              className={`${fieldCls} !py-1.5`}
            >
              {MONTHS.map((m, i) => (
                <option key={i + 1} value={i + 1}>{m}</option>
              ))}
            </select>
            <select
              value={filterYear}
              onChange={e => handleFilterYear(Number(e.target.value))}
              className={`${fieldCls} !py-1.5`}
            >
              {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Liste groupée par membre */}
      {loadingGoals ? (
        <div className="space-y-3">
          <GoalRowSkeleton />
          <GoalRowSkeleton />
          <GoalRowSkeleton />
        </div>
      ) : goals.length === 0 ? (
        <div className="flex flex-col items-center py-8 gap-2 text-center rounded-2xl border border-dashed border-black/10 dark:border-white/15">
          <Target className="w-8 h-8 text-secondary opacity-20" />
          <p className="text-sm text-secondary">
            Aucun objectif pour {MONTHS[filterMonth - 1]} {filterYear}.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {Object.entries(
            goals.reduce<Record<string, GoalDisplay[]>>((acc, g) => {
              const key = g.member_id ?? g.membership_id ?? 'unknown'
              if (!acc[key]) acc[key] = []
              acc[key].push(g)
              return acc
            }, {})
          ).map(([, memberGoals]) => {
            const first = memberGoals[0]
            return (
              <div key={first.member_id ?? first.membership_id} className="rounded-2xl border border-black/10 dark:border-white/15 overflow-hidden">
                {/* Header membre */}
                <div className="flex items-center gap-2 px-3 py-2 bg-black/[0.03] dark:bg-white/[0.04] border-b border-black/8 dark:border-white/10">
                  <div className="flex-1 min-w-0">
                    <span className="text-sm font-semibold text-primary">{first.display_name || '—'}</span>
                    {first.display_sub && (
                      <span className="ml-2 text-xs text-secondary">{first.display_sub}</span>
                    )}
                  </div>
                  <span className="text-xs text-secondary tabular-nums">{memberGoals.length} objectif{memberGoals.length > 1 ? 's' : ''}</span>
                </div>
                {/* Lignes objectifs */}
                <div className="divide-y divide-black/6 dark:divide-white/8">
                  {memberGoals.map(g => {
                    const metricLabel = METRICS.find(m => m.value === g.metric)?.label ?? g.metric
                    return (
                      <div key={g.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-primary">{g.label ?? metricLabel}</p>
                          <p className="text-xs text-secondary">
                            Objectif : <span className="font-semibold">{g.target}{g.unit ?? ''}</span>
                            {g.note && <span className="ml-2 italic opacity-70">{g.note}</span>}
                          </p>
                        </div>
                        <button
                          onClick={() => handleDelete(g.id)}
                          disabled={deleting === g.id}
                          className="flex-shrink-0 p-1.5 rounded-lg text-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors disabled:opacity-40"
                        >
                          {deleting === g.id
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : <Trash2 className="w-4 h-4" />
                          }
                        </button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
