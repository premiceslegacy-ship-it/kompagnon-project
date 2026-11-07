'use client'
// @atelier-migrated
// Planning du chantier : la semaine en liste (créneaux prévus et heures pointées), planifier, supprimer.

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import type { ChantierPlanning, Pointage } from '@/lib/data/queries/chantiers'
import { todayParis } from '@/lib/utils'
import { DateRow } from '../FormRows'
import { fmtHours } from '../chantiersModel'
import { RECURRENCE_LABELS, dateFromYmd, fmtWeekLabel, getLocalDateStr, getMonday } from './chantierModel'
import type { ChantierDetailState } from './useChantierDetail'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '

type Slot = { key: string; start: string; end: string | null; kind: 'prevu' | 'pointe'; planning?: ChantierPlanning; pointage?: Pointage }

function toMin(t: string) {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

function fmtTime(t: string) {
  return t.slice(0, 5).replace(':', 'h')
}

/** Planifier un créneau : équipe ou membre, horaires, consignes. */
function PlanSheet({ q, defaultDate, onClose }: { q: ChantierDetailState; defaultDate: string; onClose: () => void }) {
  const [form, setForm] = useState({ date: defaultDate, startTime: '08:00', endTime: '12:00', label: '', equipeId: '', memberId: '', teamSize: '1', notes: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<typeof form>) => setForm(f => ({ ...f, ...patch }))
  const duration = form.startTime && form.endTime ? (toMin(form.endTime) - toMin(form.startTime)) / 60 : 0

  const submit = async () => {
    setLoading(true)
    setError(null)
    const err = await q.handleAddPlanning({
      plannedDate: form.date, startTime: form.startTime, endTime: form.endTime, label: form.label,
      equipeId: form.equipeId || null, memberId: form.memberId || null, teamSize: parseInt(form.teamSize) || 1, notes: form.notes,
    })
    setLoading(false)
    if (err) { setError(err); return }
    onClose()
  }

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Planifier un créneau"
      description={duration > 0 ? `Durée : ${fmtHours(duration)}` : undefined}
      confirmLabel="Planifier"
      confirmLoading={loading}
      confirmDisabled={!form.date || !form.label.trim()}
      onConfirm={submit}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field
            type="select"
            label="Équipe"
            value={form.equipeId}
            onChange={e => {
              const eq = q.allEquipes.find(x => x.id === e.target.value)
              set({ equipeId: e.target.value, memberId: '', label: eq ? eq.name : form.label, teamSize: eq ? String(eq.membres.length || 1) : form.teamSize })
            }}
          >
            <option value="">Aucune équipe</option>
            {q.allEquipes.map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.membres.length} pers.)</option>)}
          </Field>
          {q.initialIndividualMembers.length > 0 && (
            <Field
              type="select"
              label="Membre"
              value={form.memberId}
              onChange={e => {
                const m = q.initialIndividualMembers.find(x => x.id === e.target.value)
                set({ memberId: e.target.value, equipeId: '', label: m ? [m.prenom, m.name].filter(Boolean).join(' ') : form.label, teamSize: '1' })
              }}
            >
              <option value="">Aucun membre</option>
              {q.initialIndividualMembers.map(m => {
                const name = [m.prenom, m.name].filter(Boolean).join(' ') || m.name
                return <option key={m.id} value={m.id}>{name}{m.role_label ? ` · ${m.role_label}` : ''}{m.taux_horaire != null ? ` · ${m.taux_horaire}€/h` : ''}</option>
              })}
            </Field>
          )}
          <Field type="text" label="Libellé" placeholder="Équipe A, Jean-Pierre, sous-traitant…" value={form.label} onChange={e => set({ label: e.target.value })} />
          <Field type="text" label="Personnes" inputMode="numeric" value={form.teamSize} onChange={e => set({ teamSize: e.target.value })} />
        </div>
        <div className={styles.fields}>
          <DateRow label="Date" value={form.date} onChange={v => set({ date: v })} required />
          <DateRow label="Début" type="time" value={form.startTime} onChange={v => set({ startTime: v })} />
          <DateRow label="Fin" type="time" value={form.endTime} onChange={v => set({ endTime: v })} />
        </div>
        <Field type="textarea" label="Notes" placeholder="Consignes, accès, matériel…" value={form.notes} onChange={e => set({ notes: e.target.value })} />
        {error && <p className={screen.error} role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}

export default function PlanningSection({ q }: { q: ChantierDetailState }) {
  const [selected, setSelected] = useState(() => dateFromYmd(todayParis()))
  const weekStart = useMemo(() => getMonday(selected), [selected])
  const [planning, setPlanning] = useState(false)
  const [openId, setOpenId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ChantierPlanning | null>(null)
  const chantier = q.chantier

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d
  })
  const todayStr = todayParis()

  const slotsOf = (dateStr: string): Slot[] => {
    const out: Slot[] = []
    for (const pl of q.plannings.filter(p => p.planned_date === dateStr)) {
      out.push({ key: `pl-${pl.id}`, start: pl.start_time ?? '00:00', end: pl.end_time, kind: 'prevu', planning: pl })
    }
    for (const p of q.pointages.filter(x => x.date === dateStr)) {
      const start = p.start_time ?? '00:00'
      const endMin = toMin(start) + Math.round(p.hours * 60)
      out.push({ key: `pt-${p.id}`, start, end: `${String(Math.floor(endMin / 60) % 24).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`, kind: 'pointe', pointage: p })
    }
    return out.sort((a, b) => toMin(a.start) - toMin(b.start))
  }

  const rec = chantier.recurrence
  let recLabel = ''
  if (rec && rec !== 'none') {
    recLabel = rec === 'plurihebdomadaire' ? `${chantier.recurrence_times ?? '?'} fois/semaine` : RECURRENCE_LABELS[rec] ?? rec
    if (chantier.recurrence_team_size) recLabel += ` · ${chantier.recurrence_team_size} pers.`
    if (chantier.recurrence_duration_h) recLabel += ` · ${fmtHours(chantier.recurrence_duration_h)}/passage`
  }

  const step = (delta: number) => setSelected(d => { const n = new Date(d); n.setDate(n.getDate() + delta); return n })
  const withSlots = days.map(d => ({ d, dateStr: getLocalDateStr(d), slots: slotsOf(getLocalDateStr(d)) })).filter(x => x.slots.length > 0)
  const open = q.plannings.find(p => p.id === openId) ?? null
  const equipeOf = (pl: ChantierPlanning) => q.allEquipes.find(e => e.id === pl.equipe_id)

  return (
    <>
      <ListGroup
        title={fmtWeekLabel(weekStart)}
        description={recLabel ? `Récurrence : ${recLabel}.` : withSlots.length === 0 ? 'Aucun créneau cette semaine. Planifiez les passages de vos équipes.' : undefined}
        action={
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button type="button" className={fiche.iconButton} aria-label="Semaine précédente" onClick={() => step(-7)}><ChevronLeft size={20} aria-hidden="true" /></button>
            <button type="button" className={fiche.iconButton} aria-label="Semaine suivante" onClick={() => step(7)}><ChevronRight size={20} aria-hidden="true" /></button>
          </span>
        }
      >
        <ListRow title="Planifier un créneau" className={fiche.linkRow} onClick={() => setPlanning(true)} />
        {weekStart.getTime() !== getMonday(dateFromYmd(todayStr)).getTime() && (
          <ListRow title="Revenir à cette semaine" onClick={() => setSelected(dateFromYmd(todayStr))} />
        )}
      </ListGroup>

      {withSlots.map(({ d, dateStr, slots }) => (
        <ListGroup key={dateStr} title={`${d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${dateStr === todayStr ? ' · aujourd’hui' : ''}`}>
          {slots.map(s => {
            const hours = s.end ? `${fmtTime(s.start)} – ${fmtTime(s.end)}` : fmtTime(s.start)
            if (s.planning) {
              const pl = s.planning
              return (
                <ListRow
                  key={s.key}
                  title={pl.label}
                  description={`${hours} · ${pl.team_size}${NB}pers.${pl.notes ? ` · ${pl.notes}` : ''}`}
                  trailing={<StatusPill status="neutral">Prévu</StatusPill>}
                  onClick={() => setOpenId(pl.id)}
                />
              )
            }
            const p = s.pointage!
            return (
              <ListRow
                key={s.key}
                title={p.user_name}
                description={[hours, fmtHours(p.hours), p.tache_title].filter(Boolean).join(' · ')}
                trailing={<StatusPill status="success">Pointé</StatusPill>}
              />
            )
          })}
        </ListGroup>
      ))}

      {planning && <PlanSheet q={q} defaultDate={getLocalDateStr(selected)} onClose={() => setPlanning(false)} />}

      {open && (
        <Sheet open onOpenChange={o => { if (!o) setOpenId(null) }} title={open.label} description={`${new Date(open.planned_date + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}${open.start_time ? ` · ${fmtTime(open.start_time)}${open.end_time ? ` – ${fmtTime(open.end_time)}` : ''}` : ''}`} cancelLabel="Fermer">
          <div className={styles.stack}>
            <ListGroup description={[equipeOf(open)?.name, `${open.team_size} personne${open.team_size > 1 ? 's' : ''}`].filter(Boolean).join(' · ')}>
              {open.notes && <ListRow title="Notes" description={open.notes} />}
              <li className={styles.destructiveRow}>
                <button type="button" onClick={() => { setDeleting(open); setOpenId(null) }}>Supprimer le créneau</button>
              </li>
            </ListGroup>
          </div>
        </Sheet>
      )}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title="Supprimer ce créneau ?"
        description="Le passage prévu sera retiré du planning."
        confirmLabel="Supprimer"
        onConfirm={() => { if (deleting) q.handleDeletePlanning(deleting.id); setDeleting(null) }}
      />
    </>
  )
}
