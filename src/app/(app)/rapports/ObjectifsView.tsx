'use client'
// @atelier-migrated
// Rapports : avancement des objectifs de la période et feuille d'édition (annuels ou mensuels).

import { useState, useTransition } from 'react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { saveMonthlyObjectivesAction, saveObjectivesAction } from './actions'
import {
  ANNUAL_STANDARD_OPTS, MONTHLY_STANDARD_OPTS, MONTH_LABELS, entriesToObjectives, formatProgress, nextEntry, objectiveProgress, objectivesEmpty, objectivesToEntries, progressPct, progressTone, ratio,
  type ObjEntry, type StandardKey,
} from './rapportsModel'
import type { RapportsState } from './useRapports'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Rapports.module.css'

const CUSTOM = '__custom__'

function EntryFields({ entry, opts, used, onChange, onRemove }: {
  entry: ObjEntry; opts: typeof ANNUAL_STANDARD_OPTS; used: Set<string>; onChange: (e: ObjEntry) => void; onRemove: () => void
}) {
  const available = opts.filter(o => o.key === (entry.kind === 'standard' ? entry.key : '') || !used.has(o.key))
  const opt = entry.kind === 'standard' ? opts.find(o => o.key === entry.key) : undefined
  return (
    <div>
      <div className={styles.fields}>
        <Field type="select" label="Objectif" value={entry.kind === 'standard' ? entry.key : CUSTOM}
          onChange={e => onChange(e.target.value === CUSTOM ? { kind: 'custom', label: '', target: 0, unit: '' } : { kind: 'standard', key: e.target.value as StandardKey, value: null })}>
          <option value={CUSTOM}>Personnalisé</option>
          {available.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Field>
        {entry.kind === 'standard' ? (
          <Field type="number" label={opt?.unit ? `Cible (${opt.unit})` : 'Cible'} min={0} allowEmpty placeholder={opt?.placeholder} value={entry.value} onChange={n => onChange({ ...entry, value: n })} />
        ) : (
          <>
            <Field type="text" label="Libellé" placeholder="Avis Google, leads…" value={entry.label} onChange={e => onChange({ ...entry, label: e.target.value })} />
            <Field type="number" label="Cible" min={0} allowEmpty placeholder="50" value={entry.target || null} onChange={n => onChange({ ...entry, target: n ?? 0 })} />
            <Field type="text" label="Unité" placeholder="avis" value={entry.unit} onChange={e => onChange({ ...entry, unit: e.target.value })} />
          </>
        )}
      </div>
      <ListGroup><li className={styles.destructiveRow}><button type="button" onClick={onRemove}>Retirer cet objectif</button></li></ListGroup>
    </div>
  )
}

/** Le parent change la `key` à chaque ouverture : la liste repart des objectifs enregistrés. */
function ObjectivesSheet({ q, open, onClose }: { q: RapportsState; open: boolean; onClose: () => void }) {
  const monthly = q.vue === 'mois'
  const opts = monthly ? MONTHLY_STANDARD_OPTS : ANNUAL_STANDARD_OPTS
  const [entries, setEntries] = useState<ObjEntry[]>(() => {
    const o = monthly ? q.monthlyObjectives : q.annualObjectives
    return o ? objectivesToEntries(o, opts) : []
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const used = new Set(entries.flatMap(e => (e.kind === 'standard' ? [e.key] : [])))
  const title = monthly ? `Objectifs ${MONTH_LABELS[q.month - 1]} ${q.year}` : `Objectifs ${q.year}`

  function save() {
    setError(null)
    startTransition(async () => {
      if (monthly && q.monthlyObjectives) {
        const updated = entriesToObjectives(entries, q.monthlyObjectives, opts)
        const result = await saveMonthlyObjectivesAction(q.year, q.month, updated)
        if (result.error) { setError(result.error); return }
        q.setMonthlyObjectives(updated)
      } else if (!monthly && q.annualObjectives) {
        const updated = entriesToObjectives(entries, q.annualObjectives, opts)
        const result = await saveObjectivesAction(q.year, updated)
        if (result.error) { setError(result.error); return }
        q.setAnnualObjectives(updated)
      }
      onClose()
    })
  }

  return (
    <Sheet open={open} onOpenChange={o => { if (!o) onClose() }} title={title} onConfirm={save} confirmLabel="Enregistrer" confirmLoading={pending}>
      <div className={local.stack} style={{ paddingTop: 0 }}>
        {entries.length === 0 && <p className={styles.hint} style={{ margin: '0 16px' }}>Aucun objectif. Ajoutez-en un ci-dessous.</p>}
        {entries.map((entry, i) => (
          <EntryFields key={i} entry={entry} opts={opts} used={used}
            onChange={next => setEntries(es => es.map((e, idx) => (idx === i ? next : e)))}
            onRemove={() => setEntries(es => es.filter((_, idx) => idx !== i))} />
        ))}
        <ListGroup><ListRow title="Ajouter un objectif" className={styles.accentRow} onClick={() => setEntries(es => [...es, nextEntry(es, opts)])} /></ListGroup>
        {error && <p className={screen.error} role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}

export default function ObjectifsView({ q }: { q: RapportsState }) {
  const [openKey, setOpenKey] = useState(0)
  const [open, setOpen] = useState(false)
  const r = q.report
  const rows = objectiveProgress({
    vue: q.vue,
    objectives: q.objectives,
    billedLabel: q.isVatSubject ? 'Facturé HT' : 'Facturé',
    caHt: r?.caHt ?? 0,
    benefice: r?.beneficeEstime ?? 0,
    marginRatio: ratio(r?.beneficeEstime ?? 0, r?.caHt ?? 0),
    chantiers: r?.chantiersTermines ?? 0,
    newClients: q.annualReport?.nouveauxClients ?? 0,
    hours: q.hoursReport?.total ?? 0,
  })
  const openSheet = () => { setOpenKey(k => k + 1); setOpen(true) }
  const empty = objectivesEmpty(q.objectives)
  const canEdit = q.vue === 'mois' ? !!q.monthlyObjectives : !!q.annualObjectives

  return (
    <div className={local.stack}>
      <ListGroup title={q.vue === 'mois' ? `Objectifs ${MONTH_LABELS[q.month - 1]} ${q.year}` : `Objectifs annuels ${q.year}`} description={empty ? 'Aucun objectif défini pour cette période.' : 'Touchez un objectif pour le modifier.'}>
        {rows.map(row => {
          const pct = progressPct(row.current, row.target)
          return (
            <li key={row.key} className={local.progressItem}>
              <button type="button" className={local.progressButton} onClick={openSheet}>
                <span className={local.progressHead}>
                  <span>{row.label}</span>
                  <span className={local.progressText}>{Math.round(pct)} %</span>
                </span>
                <span className={local.progressText}>{formatProgress(row, row.current)} sur {formatProgress(row, row.target)}</span>
                <span className={local.track} aria-hidden="true"><i className={local.fill} data-tone={progressTone(pct) === 'wait' ? undefined : progressTone(pct)} style={{ width: `${pct}%` }} /></span>
              </button>
            </li>
          )
        })}
        {canEdit && <ListRow title={empty ? 'Ajouter un objectif' : 'Modifier les objectifs'} className={styles.accentRow} onClick={openSheet} />}
      </ListGroup>
      {canEdit && <ObjectivesSheet key={openKey} q={q} open={open} onClose={() => setOpen(false)} />}
    </div>
  )
}
