'use client'
// @atelier-migrated
// Feuilles des heures : détail d'une personne, correction, pointage pour un membre, pointages à vérifier, rapports PDF.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Avatar } from '@/components/ui/Avatar'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import type { GlobalPointage, MissingPointageSlot } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'
import { createMemberPointageAdmin, updatePointage } from '@/lib/data/mutations/chantiers'
import { declareMemberAbsence } from '@/lib/data/mutations/absences'
import { DateRow } from '../FormRows'
import { fmtHours } from '../chantiersModel'
import { reportEntries, reportOptions, reportRange, slotDefaultHours, slotWho, type PersonGroup, type ReportEntry } from './heuresModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'

const NB = ' '
const memberName = (m: IndividualMember) => [m.prenom, m.name].filter(Boolean).join(' ')
const fmtDateFr = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

/** Correction d'un pointage : heures, date, description. */
function EditPointageSheet({ pointage, onClose }: { pointage: GlobalPointage; onClose: () => void }) {
  const router = useRouter()
  const [hours, setHours] = useState(String(pointage.hours))
  const [date, setDate] = useState(pointage.date)
  const [description, setDescription] = useState(pointage.description ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const value = parseFloat(hours.replace(',', '.'))

  const save = async () => {
    if (isNaN(value) || value <= 0) return
    setSaving(true)
    const res = await updatePointage(pointage.id, pointage.chantier_id, { hours: value, date, description: description.trim() || null })
    setSaving(false)
    if (res.error) { setError(res.error); return }
    router.refresh()
    onClose()
  }

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title="Corriger le pointage" description={`${pointage.user_name} · ${pointage.chantier_title}`} confirmLabel="Enregistrer" confirmLoading={saving} confirmDisabled={isNaN(value) || value <= 0} onConfirm={save}>
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="text" label="Heures" inputMode="decimal" value={hours} onChange={e => setHours(e.target.value)} />
          <DateRow label="Date" value={date} onChange={setDate} />
          <Field type="text" label="Description" placeholder="Facultatif" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        {error && <p className={screen.error} role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}

/** Détail d'une personne : ses pointages de la période, à corriger si besoin. */
export function PersonSheet({ person, canManage, onClose }: { person: PersonGroup; canManage: boolean; onClose: () => void }) {
  const [editing, setEditing] = useState<GlobalPointage | null>(null)
  const sorted = [...person.entries].sort((a, b) => b.date.localeCompare(a.date))
  return (
    <>
      <Sheet open onOpenChange={o => { if (!o && !editing) onClose() }} title={person.name} description={`${fmtHours(person.hours)} sur ${person.entries.length} pointage${person.entries.length > 1 ? 's' : ''}`} cancelLabel="Fermer">
        <ListGroup description={canManage ? 'Touchez un pointage pour le corriger.' : undefined}>
          {sorted.map(p => {
            const props = {
              title: `${new Date(`${p.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })} · ${p.chantier_title}`,
              description: [p.tache_title, p.description].filter(Boolean).join(' · ') || undefined,
              trailing: <span className={styles.amount}>{fmtHours(p.hours)}</span>,
            }
            return canManage ? <ListRow key={p.id} {...props} onClick={() => setEditing(p)} /> : <ListRow key={p.id} {...props} />
          })}
        </ListGroup>
      </Sheet>
      {editing && <EditPointageSheet pointage={editing} onClose={() => setEditing(null)} />}
    </>
  )
}

/** Pointer des heures pour un membre sans accès à l'application. */
export function ManualSheet({ members, chantiers, onClose }: { members: IndividualMember[]; chantiers: { id: string; title: string }[]; onClose: () => void }) {
  const router = useRouter()
  const [member, setMember] = useState('')
  const [chantier, setChantier] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const h = parseFloat(hours.replace(',', '.'))

  const submit = async () => {
    if (!member || !chantier || isNaN(h) || h <= 0) return
    setSaving(true)
    const result = await createMemberPointageAdmin(chantier, member, { date, hours: h, description: description.trim() || null })
    setSaving(false)
    if (result.error) { setError(result.error); return }
    router.refresh()
    onClose()
  }

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title="Pointer pour un membre" description="Pour un membre qui n’a pas accès à l’application." confirmLabel="Enregistrer" confirmLoading={saving} confirmDisabled={!member || !chantier || isNaN(h) || h <= 0} onConfirm={submit}>
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="select" label="Membre" value={member} onChange={e => setMember(e.target.value)}>
            <option value="">Choisir…</option>
            {members.map(m => <option key={m.id} value={m.id}>{memberName(m)}</option>)}
          </Field>
          <Field type="select" label="Chantier" value={chantier} onChange={e => setChantier(e.target.value)}>
            <option value="">Choisir…</option>
            {chantiers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Field>
          <DateRow label="Date" value={date} onChange={setDate} />
          <Field type="text" label="Heures" inputMode="decimal" placeholder="7,5" value={hours} onChange={e => setHours(e.target.value)} />
          <Field type="text" label="Description" placeholder="Facultatif" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        {error && <p className={screen.error} role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}

/** Créneaux passés sans heures pointées : pointer ou déclarer une absence. */
export function MissingSheet({ slots, individualMembers, onClose }: { slots: MissingPointageSlot[]; individualMembers: IndividualMember[]; onClose: () => void }) {
  const router = useRouter()
  const [resolved, setResolved] = useState<Set<string>>(new Set())
  const [openId, setOpenId] = useState<string | null>(null)
  const [formHours, setFormHours] = useState('')
  const [formMemberId, setFormMemberId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visible = slots.filter(s => !resolved.has(s.id))
  const slot = visible.find(s => s.id === openId) ?? null

  const open = (s: MissingPointageSlot) => { setError(null); setFormHours(String(slotDefaultHours(s))); setFormMemberId(s.member_id ?? ''); setOpenId(s.id) }

  async function confirmPointer(s: MissingPointageSlot) {
    const hours = Number(formHours.replace(',', '.'))
    if (!formMemberId) { setError('Sélectionnez le membre à pointer.'); return }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) { setError('Nombre d’heures invalide.'); return }
    setBusy(true)
    setError(null)
    const res = await createMemberPointageAdmin(s.chantier_id, formMemberId, { date: s.planned_date, hours, description: s.label?.trim() || 'Pointage régularisé', start_time: s.start_time })
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setResolved(prev => new Set(prev).add(s.id))
    setOpenId(null)
    router.refresh()
  }

  async function markAbsent(s: MissingPointageSlot) {
    if (!s.member_id) return
    setBusy(true)
    setError(null)
    const res = await declareMemberAbsence({ memberId: s.member_id, startDate: s.planned_date, endDate: s.planned_date, reason: 'Absence constatée (créneau non pointé)' })
    setBusy(false)
    if (res.error) { setError(res.error); return }
    setResolved(prev => new Set(prev).add(s.id))
    setOpenId(null)
    router.refresh()
  }

  return (
    <>
      <Sheet open onOpenChange={o => { if (!o && !slot) onClose() }} title={`${visible.length} pointage${visible.length > 1 ? 's' : ''} à vérifier`} description="Ces créneaux planifiés sont passés sans aucune heure pointée. Contactez la personne, puis pointez les heures si c’est un oubli, ou déclarez une absence." cancelLabel="Fermer">
        <ListGroup description={visible.length === 0 ? 'Tout est régularisé.' : undefined}>
          {visible.map(s => (
            <ListRow key={s.id} title={slotWho(s)} description={`${fmtDateFr(s.planned_date)}${s.start_time ? ` · ${s.start_time.slice(0, 5)}${s.end_time ? ` – ${s.end_time.slice(0, 5)}` : ''}` : ''} · ${s.chantier_title}`} onClick={() => open(s)} />
          ))}
        </ListGroup>
      </Sheet>
      {slot && (
        <Sheet open onOpenChange={o => { if (!o) setOpenId(null) }} title={slotWho(slot)} description={`${fmtDateFr(slot.planned_date)} · ${slot.chantier_title}`} confirmLabel="Pointer les heures" confirmLoading={busy} onConfirm={() => confirmPointer(slot)}>
          <div className={styles.stack}>
            <div className={styles.fields}>
              {!slot.member_id && (
                <Field type="select" label="Membre" value={formMemberId} onChange={e => setFormMemberId(e.target.value)}>
                  <option value="">Choisir…</option>
                  {individualMembers.map(m => <option key={m.id} value={m.id}>{memberName(m)}</option>)}
                </Field>
              )}
              <Field type="text" label="Heures" inputMode="decimal" value={formHours} onChange={e => setFormHours(e.target.value)} />
            </div>
            {slot.member_id && (
              <ListGroup description="Déclare une absence ce jour-là pour ce membre.">
                <ListRow title="Marquer absent" disabled={busy} onClick={() => markAbsent(slot)} />
              </ListGroup>
            )}
            {error && <p className={screen.error} role="alert">{error}</p>}
          </div>
        </Sheet>
      )}
    </>
  )
}

/** Rapports d'heures PDF par personne : mois ou année. */
export function ReportsSheet({ pointages, individualMembers, onClose }: { pointages: GlobalPointage[]; individualMembers: IndividualMember[]; onClose: () => void }) {
  const now = new Date()
  const thisYear = now.getFullYear()
  const defaultSel = `${thisYear}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const entries = useMemo(() => reportEntries(pointages, individualMembers), [pointages, individualMembers])
  const options = useMemo(() => reportOptions(thisYear, thisYear - 1), [thisYear])
  const [current, setCurrent] = useState<ReportEntry | null>(null)
  const [selection, setSelection] = useState(defaultSel)

  const download = (m: ReportEntry) => {
    const { from, to } = reportRange(selection)
    window.open(`/api/pdf/member/${m.id}?${new URLSearchParams({ from, to, download: '1', type: m.idType })}`, '_blank')
  }

  return (
    <>
      <Sheet open onOpenChange={o => { if (!o && !current) onClose() }} title="Rapports d’heures" description="Un PDF par personne, par mois ou par année." cancelLabel="Fermer">
        <ListGroup>
          {entries.map(m => <ListRow key={m.id} leading={<Avatar name={m.fullName} />} title={m.fullName} description={m.roleLabel ?? undefined} onClick={() => { setSelection(defaultSel); setCurrent(m) }} />)}
        </ListGroup>
      </Sheet>
      {current && (
        <Sheet open onOpenChange={o => { if (!o) setCurrent(null) }} title={current.fullName} confirmLabel="Télécharger le PDF" onConfirm={() => download(current)}>
          <Field type="select" label="Période" value={selection} onChange={e => setSelection(e.target.value)}>
            {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Field>
        </Sheet>
      )}
    </>
  )
}
