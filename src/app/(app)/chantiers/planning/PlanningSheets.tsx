'use client'
// @atelier-migrated
// Feuilles du planning : créneau, nouveau créneau, dupliquer, absence, synchronisation, assistante.

import { Check, MapPin } from 'lucide-react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import type { GlobalPlanning } from '@/lib/data/queries/chantiers'
import type { PlanningEventType } from '@/lib/data/mutations/planning'
import { AI_NAME } from '@/lib/brand'
import { DateRow } from '../FormRows'
import { EVENT_TYPE_LABELS, fmtTime, fmtWeekLabel, slotHours, slotWhere } from './planningModel'
import type { PlanningState } from './usePlanning'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'

const NB = ' '

const dayLabel = (ymd: string) => new Date(ymd + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })

/** Détail d'un créneau : ouvrir le chantier, dupliquer, supprimer. */
export function SlotSheet({ q, slot, onClose, onDelete }: { q: PlanningState; slot: GlobalPlanning; onClose: () => void; onDelete: (p: GlobalPlanning) => void }) {
  const who = slot.member_name || slot.equipe_name
  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title={slot.label} description={`${dayLabel(slot.planned_date)} · ${slotHours(slot)}`} cancelLabel="Fermer">
      <div className={styles.stack}>
        <ListGroup>
          <ListRow title={slot.source === 'maintenance' ? 'Entretien' : slot.chantier_id ? 'Chantier' : 'Type'} description={slotWhere(slot)} />
          {who && <ListRow title="Qui" description={`${who}${slot.team_size > 1 ? ` · ${slot.team_size}${NB}pers.` : ''}`} />}
          {slot.notes && <ListRow title="Notes" description={slot.notes} />}
          {slot.source === 'maintenance'
            ? <ListRow title="Ouvrir l’entretien" href="/chantiers/entretien" />
            : slot.chantier_id && <ListRow title="Ouvrir le chantier" href={`/chantiers/${slot.chantier_id}`} />}
        </ListGroup>
        {q.canManage && (
          <ListGroup>
            <ListRow title="Dupliquer au même jour, semaine suivante" onClick={() => { onClose(); q.openDuplicateSlot(slot) }} />
            {slot.source !== 'maintenance' && (
              <li className={styles.destructiveRow}>
                <button type="button" onClick={() => onDelete(slot)}>Supprimer le créneau</button>
              </li>
            )}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

/** Nouveau créneau à la main : chantier ou événement libre, équipe ou membre. */
export function NewSlotSheet({ q }: { q: PlanningState }) {
  if (!q.newSlotModalOpen) return null
  const free = q.newSlotEventType !== 'chantier'
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.closeNewSlotModal() }}
      title="Nouveau créneau"
      confirmLabel="Planifier"
      confirmLoading={q.newSlotLoading}
      confirmDisabled={(free ? !q.newSlotTitle.trim() : !q.newSlotChantierId) || !q.newSlotDate}
      onConfirm={q.handleCreateSlotConfirm}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="select" label="Type" value={q.newSlotEventType} onChange={e => q.setNewSlotEventType(e.target.value as PlanningEventType)}>
            {Object.entries(EVENT_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Field>
          {free ? (
            <Field type="text" label="Titre" placeholder="Visite chez M. Roux" value={q.newSlotTitle} onChange={e => q.setNewSlotTitle(e.target.value)} />
          ) : (
            <Field type="select" label="Chantier" value={q.newSlotChantierId} onChange={e => q.setNewSlotChantierId(e.target.value)}>
              {q.chantiers.map(c => <option key={c.id} value={c.id}>{c.title}{c.city ? ` · ${c.city}` : ''}</option>)}
            </Field>
          )}
        </div>
        <div className={styles.fields}>
          <DateRow label="Date" value={q.newSlotDate} onChange={q.setNewSlotDate} required />
          <DateRow label="Début" type="time" value={q.newSlotStartTime} onChange={q.setNewSlotStartTime} />
          <DateRow label="Fin" type="time" value={q.newSlotEndTime} onChange={q.setNewSlotEndTime} />
        </div>
        <SegmentedControl
          fullWidth
          label="Pour"
          options={[{ value: 'membre', label: 'Un membre' }, { value: 'equipe', label: 'Une équipe' }]}
          value={q.newSlotAssigneeType}
          onChange={v => q.setNewSlotAssigneeType(v as 'membre' | 'equipe')}
        />
        <div className={styles.fields}>
          {q.newSlotAssigneeType === 'membre' ? (
            <Field type="select" label="Membre" value={q.newSlotMemberId} onChange={e => q.setNewSlotMemberId(e.target.value)}>
              <option value="">Aucun</option>
              {q.individualMembers.map(m => <option key={m.id} value={m.id}>{[m.prenom, m.name].filter(Boolean).join(' ')}</option>)}
            </Field>
          ) : (
            <Field type="select" label="Équipe" value={q.newSlotEquipeId} onChange={e => q.setNewSlotEquipeId(e.target.value)}>
              <option value="">Aucune</option>
              {q.equipes.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Field>
          )}
          <Field type="text" label="Libellé" placeholder="Facultatif" value={q.newSlotLabel} onChange={e => q.setNewSlotLabel(e.target.value)} />
        </div>
        {q.newSlotError && <p className={screen.error} role="alert">{q.newSlotError}</p>}
      </div>
    </Sheet>
  )
}

/** Dupliquer un créneau ou toute la semaine vers une date. */
export function DuplicateSheet({ q }: { q: PlanningState }) {
  if (!q.duplicateModalOpen) return null
  const slot = q.duplicateSlot
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.setDuplicateModalOpen(false) }}
      title={slot ? 'Dupliquer le créneau' : 'Dupliquer la semaine'}
      description={slot ? `${slot.label} · ${dayLabel(slot.planned_date)}` : `Semaine du ${fmtWeekLabel(q.weekStart)}`}
      confirmLabel="Dupliquer"
      confirmLoading={q.duplicateLoading}
      confirmDisabled={!q.duplicateTargetDate}
      onConfirm={q.handleDuplicateConfirm}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <DateRow label={slot ? 'Vers le' : 'Vers la semaine du'} value={q.duplicateTargetDate} onChange={q.setDuplicateTargetDate} />
        </div>
        {q.duplicateError && <p className={screen.error} role="alert">{q.duplicateError}</p>}
      </div>
    </Sheet>
  )
}

/** Déclarer une absence, puis lister les créneaux déjà planifiés qui restent à replanifier. */
export function AbsenceSheet({ q }: { q: PlanningState }) {
  if (!q.absenceModalOpen) return null
  const done = q.absenceConflicts !== null
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.closeAbsenceModal() }}
      title="Déclarer une absence"
      confirmLabel={done ? 'Terminé' : 'Déclarer l’absence'}
      confirmLoading={q.absenceLoading}
      confirmDisabled={!done && (!q.absenceMemberId || !q.absenceStartDate || !q.absenceEndDate)}
      onConfirm={done ? q.closeAbsenceModal : q.handleDeclareAbsenceConfirm}
      cancelLabel={done ? 'Fermer' : 'Annuler'}
    >
      <div className={styles.stack}>
        {!done ? (
          <>
            <div className={styles.fields}>
              {q.absencePickMember ? (
                <Field
                  type="select"
                  label="Membre"
                  value={q.absenceMemberId ?? ''}
                  onChange={e => {
                    const m = q.individualMembers.find(mm => mm.id === e.target.value)
                    q.setAbsenceMemberId(e.target.value || null)
                    q.setAbsenceMemberName(m ? [m.prenom, m.name].filter(Boolean).join(' ') : '')
                  }}
                >
                  <option value="">Choisir un membre…</option>
                  {q.individualMembers.map(m => <option key={m.id} value={m.id}>{[m.prenom, m.name].filter(Boolean).join(' ')}</option>)}
                </Field>
              ) : (
                <div className={styles.fieldRow}><span>Membre</span><span>{q.absenceMemberName}</span></div>
              )}
              <DateRow label="Début" value={q.absenceStartDate} onChange={v => { q.setAbsenceStartDate(v); if (q.absenceEndDate < v) q.setAbsenceEndDate(v) }} />
              <DateRow label="Fin" value={q.absenceEndDate} onChange={q.setAbsenceEndDate} />
            </div>
            <Field type="textarea" label="Motif" placeholder="Congés, maladie, etc. (facultatif)" value={q.absenceReason} onChange={e => q.setAbsenceReason(e.target.value)} />
            {q.absenceError && <p className={screen.error} role="alert">{q.absenceError}</p>}
          </>
        ) : (
          <>
            <p className={screen.ok} role="status">Absence enregistrée pour {q.absenceMemberName}.</p>
            {q.absenceConflicts!.length > 0 ? (
              <ListGroup
                title={`${q.absenceConflicts!.length} créneau${q.absenceConflicts!.length > 1 ? 'x' : ''} à replanifier`}
                description="Ces créneaux déjà planifiés tombent pendant l’absence."
              >
                {q.absenceConflicts!.map(slot => (
                  <ListRow
                    key={slot.id}
                    title={slot.chantier_title}
                    description={`${new Date(slot.planned_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}${slot.start_time ? ` · ${fmtTime(slot.start_time)}${slot.end_time ? ` – ${fmtTime(slot.end_time)}` : ''}` : ''}`}
                  />
                ))}
              </ListGroup>
            ) : (
              <p className={screen.note}>Aucun créneau n’est planifié sur cette période.</p>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}

/** Lien d'abonnement au calendrier (Apple, Google, Outlook). */
export function IcalSheet({ q }: { q: PlanningState }) {
  if (!q.showIcalModal || !q.icalUrl || !q.webcalUrl) return null
  return (
    <Sheet open onOpenChange={o => { if (!o) q.setShowIcalModal(false) }} title="Synchroniser le calendrier" description="Google Calendar, Apple Calendar ou Outlook affichent automatiquement votre planning." cancelLabel="Fermer">
      <div className={styles.stack}>
        <ListGroup description="Ce lien est personnel à votre organisation : ne le partagez pas publiquement.">
          <ListRow title="Ouvrir dans mon calendrier" href={q.webcalUrl} />
          <ListRow title={q.icalCopied ? 'Lien copié' : 'Copier le lien'} description={q.icalUrl} onClick={q.copyIcalUrl} />
        </ListGroup>
      </div>
    </Sheet>
  )
}

/** Planifier avec Sarah : décrire la semaine, vérifier la proposition, confirmer. */
export function AiSheet({ q }: { q: PlanningState }) {
  if (!q.aiModalOpen) return null
  const close = () => { q.setAiModalOpen(false); q.setPlanningBriefBanner(null) }
  const s = q.aiStatus
  const working = s === 'loading' || s === 'saving'
  const nTours = q.aiTours.length

  let confirmLabel: string | undefined
  let onConfirm: (() => void) | undefined
  let disabled = false
  if (s === 'idle' || s === 'error') { confirmLabel = 'Proposer les créneaux'; onConfirm = q.handleAiGenerate; disabled = !q.aiPrompt.trim() }
  else if (s === 'new_member') { confirmLabel = 'Ajouter le membre'; onConfirm = q.handleNewMemberSave; disabled = !q.newMemberNom.trim() && !q.newMemberPrenom.trim() }
  else if (s === 'preview') { confirmLabel = `Confirmer (${q.aiSlots.length} créneau${q.aiSlots.length > 1 ? 'x' : ''}${q.aiDeletions.length ? `, ${q.aiDeletions.length} suppression${q.aiDeletions.length > 1 ? 's' : ''}` : ''})`; onConfirm = q.handleAiConfirm }

  return (
    <Sheet
      open
      onOpenChange={o => {
        if (o || working) return
        if (s === 'preview') q.setAiStatus('idle')
        else if (s === 'new_member') q.handleNewMemberSkip()
        else close()
      }}
      title={`${AI_NAME}, planification`}
      description={`Semaine du ${fmtWeekLabel(q.weekStart)}`}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      confirmDisabled={disabled}
      confirmLoading={s === 'saving' || q.newMemberSaving}
      cancelLabel={s === 'new_member' ? 'Ignorer' : s === 'preview' ? 'Modifier' : s === 'done' ? 'Fermer' : 'Annuler'}
      dismissible={!working}
    >
      <div className={styles.stack}>
        {q.planningBriefBanner && <p className={screen.ok} role="status">{q.planningBriefBanner}</p>}

        {(s === 'idle' || s === 'error') && (
          <>
            <Field
              type="textarea"
              label="Votre semaine"
              placeholder="Chantier Martin lundi 8h-12h, équipe Karim + Ahmed (2 pers.)…"
              value={q.aiPrompt}
              onChange={e => q.setAiPrompt(e.target.value)}
              hint={`${AI_NAME} vous montre d’abord sa proposition : rien n’est enregistré sans votre validation.`}
            />
            <p className={screen.note}>Exemples : « Dupont toute la journée mardi et mercredi, moi seul » · « Visite Excella jeudi après-midi » · « Supprime le créneau Dupont mardi matin ».</p>
            {s === 'error' && <p className={screen.error} role="alert">{q.aiError}</p>}
          </>
        )}

        {s === 'loading' && <p className={screen.note} role="status">{AI_NAME} organise votre semaine…</p>}
        {s === 'saving' && <p className={screen.note} role="status">Enregistrement en cours…</p>}
        {s === 'done' && <p className={screen.ok} role="status"><Check size={14} aria-hidden="true" /> Planning créé.</p>}

        {s === 'new_member' && q.newMemberCurrent && (
          <>
            <p className={screen.note}>« {q.newMemberCurrent.name} » ne correspond à aucun membre enregistré. L’ajouter à votre organisation ?{q.newMemberQueue.length > 0 ? ` ${q.newMemberQueue.length} autre${q.newMemberQueue.length > 1 ? 's' : ''} à vérifier ensuite.` : ''}</p>
            <div className={styles.fields}>
              <Field type="text" label="Prénom" value={q.newMemberPrenom} onChange={e => q.setNewMemberPrenom(e.target.value)} />
              <Field type="text" label="Nom" value={q.newMemberNom} onChange={e => q.setNewMemberNom(e.target.value)} />
              <Field type="text" label="Email" inputMode="email" hint="Facultatif" value={q.newMemberEmail} onChange={e => q.setNewMemberEmail(e.target.value)} />
              <Field type="text" label="Taux horaire (€/h)" inputMode="decimal" hint="Facultatif" value={q.newMemberTaux} onChange={e => q.setNewMemberTaux(e.target.value)} />
            </div>
            {q.newMemberError && <p className={screen.error} role="alert">{q.newMemberError}</p>}
          </>
        )}

        {s === 'preview' && (
          <>
            <p className={screen.note}>{q.aiSummary}</p>
            {nTours > 0 && <p className={screen.note}><MapPin size={14} aria-hidden="true" /> {nTours} tournée{nTours > 1 ? 's' : ''} détectée{nTours > 1 ? 's' : ''} ({q.aiTours.reduce((a, t) => a + t.slotIndices.length, 0)} arrêts).</p>}
            {q.aiDeletions.length > 0 && (
              <ListGroup title="À supprimer">
                {q.aiDeletions.map((d, i) => (
                  <ListRow key={`${d.id}-${i}`} title={d.chantierTitle} description={`${dayLabel(d.plannedDate)}${d.startTime ? ` · ${d.startTime}${d.endTime ? `–${d.endTime}` : ''}` : ''}${d.label ? ` · ${d.label}` : ''}`} />
                ))}
              </ListGroup>
            )}
            <ListGroup title="À créer">
              {q.aiSlots.map((slot, i) => (
                <ListRow
                  key={i}
                  title={slot.chantierTitle}
                  description={`${dayLabel(slot.plannedDate)}${slot.startTime ? ` · ${slot.startTime}${slot.endTime ? `–${slot.endTime}` : ''}` : ''} · ${slot.teamSize ?? 1}${NB}pers.${q.aiTours.some(t => t.slotIndices.includes(i)) ? ' · tournée' : ''}${slot.label && slot.label !== 'Equipe' ? ` · ${slot.label}` : ''}`}
                />
              ))}
            </ListGroup>
          </>
        )}
      </div>
    </Sheet>
  )
}
