'use client'
// @atelier-migrated

import { useState, useTransition, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import { upsertMemberGoal, bulkUpsertMemberGoals, deleteMemberGoal, fetchMemberGoalsByMonth } from '@/lib/data/mutations/member-goals'
import type { BulkTarget, GoalDisplayRow } from '@/lib/data/mutations/member-goals'
import type { IndividualMember } from '@/lib/data/queries/members'
import type { TeamMember } from '@/lib/data/queries/team'
import type { MemberGoal } from '@/lib/data/queries/member-goals'

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
  const [targetVal, setTargetVal] = useState<number | null>(null)
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
    const t = targetVal ?? 0
    if (t <= 0) {
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
      setTargetVal(null)
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

  const grouped = Object.values(
    goals.reduce<Record<string, GoalDisplay[]>>((acc, g) => {
      const key = g.member_id ?? g.membership_id ?? 'unknown'
      if (!acc[key]) acc[key] = []
      acc[key].push(g)
      return acc
    }, {}),
  )

  return (
    <div className={styles.detail}>
      <p className={styles.hint} style={{ marginTop: 0 }}>
        Fixez des objectifs mensuels par membre : heures terrain, tâches, chantiers.
      </p>

      {hasAnyMember ? (
        <div className={styles.inline}>
          <Button variant="secondary" size="md" onClick={() => { setShowForm(true); setError(null) }}>Ajouter un objectif</Button>
        </div>
      ) : (
        <p className={styles.hint} style={{ marginTop: 0 }}>
          Aucun membre dans l’organisation. Ajoutez des intervenants ou invitez des membres pour leur fixer des objectifs.
        </p>
      )}

      <div className={styles.fields}>
        <Field type="select" label="Mois affiché" value={String(filterMonth)} onChange={e => handleFilterMonth(Number(e.target.value))}>
          {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
        </Field>
        <Field type="select" label="Année" value={String(filterYear)} onChange={e => handleFilterYear(Number(e.target.value))}>
          {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
        </Field>
      </div>

      {error && !showForm && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}

      {loadingGoals ? (
        <p className={styles.hint} role="status" style={{ marginTop: 0 }}>Chargement des objectifs…</p>
      ) : goals.length === 0 ? (
        <p className={styles.hint} style={{ marginTop: 0 }}>Aucun objectif pour {MONTHS[filterMonth - 1]} {filterYear}.</p>
      ) : (
        grouped.map(memberGoals => {
          const first = memberGoals[0]
          return (
            <ListGroup
              key={first.member_id ?? first.membership_id}
              title={first.display_name || '—'}
              description={first.display_sub || undefined}
            >
              {memberGoals.map(g => {
                const metricLabel = METRICS.find(m => m.value === g.metric)?.label ?? g.metric
                return (
                  <ListRow
                    key={g.id}
                    title={g.label ?? metricLabel}
                    description={`Objectif : ${g.target}${g.unit ?? ''}${g.note ? ` · ${g.note}` : ''}`}
                    trailing={
                      <Button variant="destructive" size="sm" onClick={() => handleDelete(g.id)} loading={deleting === g.id}>
                        Supprimer
                      </Button>
                    }
                  />
                )
              })}
            </ListGroup>
          )
        })
      )}

      {showForm && (
        <Sheet
          open
          onOpenChange={open => { if (!open && !isPending) { setShowForm(false); setError(null) } }}
          title="Nouvel objectif"
          onConfirm={handleSubmit}
          confirmLabel={bulkAll ? 'Appliquer à tous' : 'Enregistrer'}
          confirmLoading={isPending}
        >
          <div className={styles.detail}>
            {error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}
            <div className={styles.fields}>
              <Field type="select" label="Pour" value={bulkAll ? '__all__' : selectedValue()} onChange={e => {
                if (e.target.value === '__all__') setBulkAll(true)
                else { setBulkAll(false); handleSelectChange(e.target.value) }
              }}>
                <option value="__all__">Tous les membres</option>
                <option value="">Choisir un membre</option>
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
                  <optgroup label="Membres de l’organisation">
                    {pureOrgMembers.map(m => (
                      <option key={m.user_id} value={`org:${m.membership_id}`}>
                        {m.full_name ?? m.email} · {m.role_name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </Field>
              <Field type="select" label="Mois" value={String(formMonth)} onChange={e => setFormMonth(Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
              </Field>
              <Field type="select" label="Année" value={String(formYear)} onChange={e => setFormYear(Number(e.target.value))}>
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </Field>
            </div>
            <div className={styles.fields}>
              <Field type="select" label="Type d’objectif" value={metric} onChange={e => handleMetricChange(e.target.value)}>
                {METRICS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </Field>
              <Field type="text" label="Libellé" hint="Affiché au membre. Facultatif." value={label} onChange={e => setLabel(e.target.value)} />
              <Field type="number" label="Valeur cible" min={0} decimals={1} allowEmpty value={targetVal} onChange={setTargetVal} />
              <Field type="text" label="Unité" placeholder="h" value={unit} onChange={e => setUnit(e.target.value)} />
              <Field type="text" label="Note interne" hint="Visible des administrateurs seulement." placeholder="Objectif ajusté après entretien" value={note} onChange={e => setNote(e.target.value)} />
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}
