'use client'
// @atelier-migrated
// Feuilles de la tournée : un site (modifier, pointer l'arrivée et le départ), le point de départ.

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AddressMapPicker } from '@/components/maps/AddressMapPicker'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Field } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import type { TourneeSlot } from '@/lib/data/queries/chantiers'
import { createMemberPointageAdmin, createPointage } from '@/lib/data/mutations/chantiers'
import { setPlanningArrivedAt, clearPlanningArrivedAt } from '@/lib/data/mutations/planning'
import { DateRow } from '../FormRows'
import { fmtMin, memberFullName } from './tourneeModel'
import type { TourneeState } from './useTournee'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'

const NB = ' '

/** Formulaire d'un site : ajout ou modification (chantier, heure, durée, affectation, notes). */
export function SiteFormSheet({ q }: { q: TourneeState }) {
  if (!q.modalMode) return null
  const edit = q.modalMode === 'edit'
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.closeModal() }}
      title={edit ? 'Modifier le site' : 'Ajouter un site'}
      confirmLabel={edit ? 'Enregistrer' : 'Ajouter'}
      confirmLoading={q.formSaving}
      confirmDisabled={!q.formChantier}
      onConfirm={q.handleSubmitModal}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="select" label="Chantier" value={q.formChantier} onChange={e => q.setFormChantier(e.target.value)} disabled={edit}>
            <option value="">Choisir un chantier</option>
            {q.chantiers.map(c => <option key={c.id} value={c.id}>{c.title}{c.city ? ` · ${c.city}` : ''}</option>)}
          </Field>
          <DateRow label="Heure d’arrivée" type="time" value={q.formStartTime} onChange={q.setFormStartTime} />
          <Field type="number" label="Durée sur site (min)" min={5} decimals={0} value={q.formDuration} onChange={v => q.setFormDuration(v ?? 60)} />
        </div>
        <div className={styles.fields}>
          <Field
            type="select"
            label="Équipe"
            value={q.formEquipeId}
            onChange={e => {
              const eq = q.equipes.find(x => x.id === e.target.value)
              q.setFormEquipeId(e.target.value)
              q.setFormMemberId('')
              if (eq) { q.setFormLabel(eq.name); q.setFormTeamSize(eq.membres.length || 1) }
            }}
          >
            <option value="">Aucune équipe</option>
            {q.equipes.map(e => <option key={e.id} value={e.id}>{e.name} ({e.membres.length} pers.)</option>)}
          </Field>
          <Field
            type="select"
            label="Membre"
            value={q.formMemberId}
            onChange={e => { q.setFormMemberId(e.target.value); if (e.target.value) q.setFormEquipeId('') }}
          >
            <option value="">Aucun membre</option>
            {q.assignableMembers.map(m => <option key={m.id} value={m.id}>{memberFullName(m)}{m.role_label ? ` · ${m.role_label}` : ''}</option>)}
          </Field>
          {!q.formMemberId && <Field type="number" label="Personnes" min={1} decimals={0} value={q.formTeamSize} onChange={v => q.setFormTeamSize(v ?? 1)} />}
        </div>
        <Field type="textarea" label="Notes" placeholder="Consignes, accès, matériel…" value={q.formNotes} onChange={e => q.setFormNotes(e.target.value)} />
        {q.formError && <p className={screen.error} role="alert">{q.formError}</p>}
      </div>
    </Sheet>
  )
}

/** Un site de la tournée : adresse, arrivée et départ (qui créent les pointages), modifier, supprimer. */
export function SiteSheet({ q, slot, onClose }: { q: TourneeState; slot: TourneeSlot; onClose: () => void }) {
  const router = useRouter()
  const members = q.membersForSlot(slot)
  const [arrivedAt, setArrivedAt] = useState<Date | null>(() => {
    if (!slot.arrived_at) return null
    const d = new Date(slot.arrived_at)
    return isNaN(d.getTime()) ? null : d
  })
  const [pointing, setPointing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [present, setPresent] = useState(() => new Set(members.map(m => m.id)))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [elapsed, setElapsed] = useState('')

  useEffect(() => {
    if (!arrivedAt) { setElapsed(''); return }
    const tick = () => {
      const totalMin = Math.floor((Date.now() - arrivedAt.getTime()) / 60000)
      const h = Math.floor(totalMin / 60)
      setElapsed(h > 0 ? `${h}h${String(totalMin % 60).padStart(2, '0')}` : `${totalMin}min`)
    }
    tick()
    const id = setInterval(tick, 30000)
    return () => clearInterval(id)
  }, [arrivedAt])

  const address = [slot.chantier_address_line1, slot.chantier_postal_code, slot.chantier_city].filter(Boolean).join(', ')
  const mapsUrl = address ? `https://maps.google.com/maps?q=${encodeURIComponent(address)}` : null

  async function arrive() {
    const now = new Date()
    setArrivedAt(now)
    setError(null)
    setDone(false)
    const result = await setPlanningArrivedAt(slot.id, now.toISOString())
    if (result.error) { setArrivedAt(null); setError(result.error) }
  }

  async function depart() {
    if (!arrivedAt || !slot.chantier_id) return
    setPointing(true)
    setError(null)
    const diffMin = Math.round((Date.now() - arrivedAt.getTime()) / 60000)
    if (diffMin <= 0) { setPointing(false); setError('Durée trop courte pour être enregistrée.'); return }
    const payload = {
      date: slot.planned_date,
      hours: diffMin / 60,
      start_time: `${String(arrivedAt.getHours()).padStart(2, '0')}:${String(arrivedAt.getMinutes()).padStart(2, '0')}`,
      description: `Tournée : ${slot.chantier_title}`,
    }
    let result: { error: string | null } = { error: null }
    if (slot.member_id) {
      result = await createMemberPointageAdmin(slot.chantier_id, slot.member_id, payload)
    } else if (members.length > 0) {
      const presentMembers = members.filter(m => present.has(m.id))
      if (presentMembers.length === 0) { setPointing(false); setError('Sélectionnez au moins une personne présente.'); return }
      for (const member of presentMembers) {
        result = await createMemberPointageAdmin(slot.chantier_id, member.id, { ...payload, description: `Tournée : ${slot.chantier_title} (${member.fullName})` })
        if (result.error) break
      }
    } else {
      result = await createPointage(slot.chantier_id, payload)
    }
    setPointing(false)
    if (result.error) { setError(result.error); return }
    await clearPlanningArrivedAt(slot.id)
    setDone(true)
    setArrivedAt(null)
    router.refresh()
  }

  return (
    <>
      <Sheet open onOpenChange={o => { if (!o && !confirmDelete) onClose() }} title={slot.chantier_title} description={address || undefined} cancelLabel="Fermer">
        <div className={styles.stack}>
          <ListGroup>
            <ListRow title="Horaires" description={`${slot.start_time?.slice(0, 5).replace(':', 'h') ?? '—'}${slot.end_time ? ` → ${slot.end_time.slice(0, 5).replace(':', 'h')}` : ''}${slot.duration_min != null ? ` · ${fmtMin(slot.duration_min)}${NB}sur site` : ''}`} />
            {slot.travel_from_prev_min != null && <ListRow title="Trajet" description={`~${fmtMin(slot.travel_from_prev_min)} depuis le site précédent`} />}
            <ListRow title="Équipe" description={[slot.label, slot.team_size > 1 ? `${slot.team_size}${NB}pers.` : null].filter(Boolean).join(' · ') || 'Non assignée'} />
            {slot.notes && <ListRow title="Notes" description={slot.notes} />}
            {mapsUrl && <ListRow title="Ouvrir l’itinéraire" href={mapsUrl} target="_blank" rel="noopener noreferrer" />}
            {slot.chantier_id && <ListRow title="Ouvrir le chantier" href={`/chantiers/${slot.chantier_id}`} />}
          </ListGroup>

          {!done && !arrivedAt && <ListGroup description="L’arrivée lance le chrono ; le départ crée le pointage."><ListRow title="Arrivée sur le site" onClick={arrive} /></ListGroup>}
          {arrivedAt && !done && (
            <>
              <ListGroup description={`Sur site depuis ${arrivedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}${elapsed ? ` (${elapsed})` : ''}.`}>
                {members.length > 1 && members.map(m => (
                  <CheckRow key={m.id} title={m.fullName} description={m.roleLabel ?? undefined} checked={present.has(m.id)} onCheckedChange={() => setPresent(prev => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next })} />
                ))}
                <ListRow title={pointing ? 'Enregistrement…' : 'Départ du site'} onClick={depart} disabled={pointing} />
              </ListGroup>
            </>
          )}
          {done && <p className={screen.ok} role="status">Pointage enregistré.</p>}
          {error && <p className={screen.error} role="alert">{error}</p>}

          {q.canManage && (
            <ListGroup>
              <ListRow title="Modifier le site" onClick={() => { onClose(); q.openEditModal(slot) }} />
              {q.onDeclareAbsent && slot.member_id && <ListRow title="Déclarer une absence" onClick={() => { onClose(); q.onDeclareAbsent!(slot.member_id!, slot.member_name ?? 'ce membre') }} />}
              <li className={styles.destructiveRow}>
                <button type="button" onClick={() => setConfirmDelete(true)}>Retirer le site</button>
              </li>
            </ListGroup>
          )}
        </div>
      </Sheet>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Retirer « ${slot.chantier_title} » ?`}
        description="Le site est supprimé de la tournée et du planning."
        confirmLabel="Retirer"
        onConfirm={() => { setConfirmDelete(false); onClose(); q.handleDelete(slot.id) }}
      />
    </>
  )
}

/** Point de départ de la tournée : sert au calcul du premier trajet. */
export function DepartureSheet({ q }: { q: TourneeState }) {
  if (!q.showDepartureEditor) return null
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.setShowDepartureEditor(false) }}
      title="Point de départ"
      description="Utilisé pour calculer le trajet vers le premier site. Par défaut, l’adresse de départ de l’organisation."
      confirmLabel="Enregistrer"
      confirmLoading={q.isSavingDeparture}
      onConfirm={q.saveDeparture}
    >
      <AddressMapPicker
        value={{ address: q.departureAddress || null, postalCode: q.departurePostalCode || null, city: q.departureCity || null, latitude: q.departureLatitude, longitude: q.departureLongitude }}
        onChange={next => {
          q.setDepartureAddress(next.address ?? '')
          q.setDeparturePostalCode(next.postalCode ?? '')
          q.setDepartureCity(next.city ?? '')
          q.setDepartureLatitude(next.latitude)
          q.setDepartureLongitude(next.longitude)
        }}
      />
    </Sheet>
  )
}
