'use client'
// @atelier-migrated

import { useState } from 'react'
import { Check, FileText, Sparkles, Trash2 } from 'lucide-react'
import { CheckRow, ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Field } from '@/components/ui/Field'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import type { Tache, TacheStatus } from '@/lib/data/queries/chantiers'
import { DateRow } from '../FormRows'
import type { ChantierDetailState } from './useChantierDetail'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

export const TACHE_LABELS: Record<TacheStatus, string> = { a_faire: 'À faire', en_cours: 'En cours', termine: 'Terminé' }

const submitEvent = { preventDefault() {} } as unknown as React.SyntheticEvent

function toggled(set: Set<string>, id: string) {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function memberLabel(m: { prenom: string | null; name: string; email?: string | null }) {
  return [m.prenom, m.name].filter(Boolean).join(' ') || m.email || 'Membre'
}

/** Détail d'une tâche : état, nom, note d'avancement, assignations, ordre et suppression. */
export function TaskSheet({ q, tacheId, onClose, onDelete }: {
  q: ChantierDetailState
  tacheId: string
  onClose: () => void
  onDelete: (tache: Tache) => void
}) {
  const tache = q.taches.find(t => t.id === tacheId)
  const [title, setTitle] = useState(tache?.title ?? '')
  const [note, setNote] = useState(tache?.progress_note ?? '')
  const [equipeIds, setEquipeIds] = useState(() => new Set((tache?.assignments ?? []).map(a => a.equipe_id).filter(Boolean) as string[]))
  const [memberIds, setMemberIds] = useState(() => new Set((tache?.assignments ?? []).map(a => a.member_id).filter(Boolean) as string[]))
  const [saving, setSaving] = useState(false)
  if (!tache) return null
  const index = q.taches.findIndex(t => t.id === tache.id)
  const canEdit = q.canEditChantier

  const save = async () => {
    setSaving(true)
    const trimmed = title.trim()
    if (trimmed && trimmed !== tache.title) await q.handleRenameTache(tache, trimmed)
    if (note !== (tache.progress_note ?? '')) await q.handleSaveTacheNote(tache, note)
    const before = (tache.assignments ?? [])
    const sameEquipes = before.filter(a => a.equipe_id).map(a => a.equipe_id!).sort().join() === [...equipeIds].sort().join()
    const sameMembers = before.filter(a => a.member_id).map(a => a.member_id!).sort().join() === [...memberIds].sort().join()
    if (!sameEquipes || !sameMembers) await q.handleSaveTacheAssignments(tache, [...equipeIds], [...memberIds])
    setSaving(false)
    onClose()
  }

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Tâche"
      confirmLabel={canEdit ? 'Enregistrer' : undefined}
      onConfirm={canEdit ? save : undefined}
      confirmLoading={saving}
      confirmDisabled={!title.trim()}
      cancelLabel={canEdit ? 'Annuler' : 'Fermer'}
    >
      <div className={styles.stack}>
        <SegmentedControl
          fullWidth
          label="État de la tâche"
          disabled={!canEdit}
          options={(Object.keys(TACHE_LABELS) as TacheStatus[]).map(value => ({ value, label: TACHE_LABELS[value] }))}
          value={tache.status}
          onChange={v => q.handleSetTacheStatus(tache, v as TacheStatus)}
        />
        <div className={styles.fields}>
          <Field type="text" label="Intitulé" value={title} onChange={e => setTitle(e.target.value)} disabled={!canEdit} />
        </div>
        <Field type="textarea" label="Note d'avancement" placeholder="Ce qui a été fait, les difficultés, ce qui reste…" value={note} onChange={e => setNote(e.target.value)} disabled={!canEdit} />
        {canEdit && (
          <>
            <ListGroup title="Équipes" description={q.allEquipes.length === 0 ? 'Aucune équipe créée.' : undefined}>
              {q.allEquipes.map(e => (
                <CheckRow key={e.id} title={e.name} checked={equipeIds.has(e.id)} onCheckedChange={() => setEquipeIds(prev => toggled(prev, e.id))} />
              ))}
            </ListGroup>
            <ListGroup title="Membres" description={q.allAssignableMembers.length === 0 ? 'Aucun membre créé.' : undefined}>
              {q.allAssignableMembers.map(m => (
                <CheckRow key={m.id} title={memberLabel(m)} checked={memberIds.has(m.id)} onCheckedChange={() => setMemberIds(prev => toggled(prev, m.id))} />
              ))}
            </ListGroup>
            <ListGroup>
              <ListRow title="Monter" onClick={() => q.handleMoveTache(tache, -1)} disabled={index <= 0} />
              <ListRow title="Descendre" onClick={() => q.handleMoveTache(tache, 1)} disabled={index >= q.taches.length - 1} />
              <li className={styles.destructiveRow}>
                <button type="button" onClick={() => onDelete(tache)}>Supprimer la tâche</button>
              </li>
            </ListGroup>
          </>
        )}
      </div>
    </Sheet>
  )
}

/** Nouvelle tâche : intitulé, échéance, assignations, bibliothèque et import depuis le devis lié. */
export function NewTaskSheet({ q, onClose, onSuggest }: { q: ChantierDetailState; onClose: () => void; onSuggest: () => void }) {
  const [filter, setFilter] = useState('')
  const [assign, setAssign] = useState(false)
  const library = q.taskLibraryTitles.filter(t => !filter || t.toLowerCase().includes(filter.toLowerCase())).slice(0, 30)

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Nouvelle tâche"
      confirmLabel="Ajouter"
      confirmLoading={q.tacheLoading}
      confirmDisabled={!q.newTacheTitle.trim()}
      onConfirm={async () => { await q.handleAddTache(submitEvent); onClose() }}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="text" label="Intitulé" placeholder="Pose du carrelage" value={q.newTacheTitle} onChange={e => q.setNewTacheTitle(e.target.value)} />
          <DateRow label="Échéance" value={q.newTacheDue} onChange={q.setNewTacheDue} />
        </div>
        <ListGroup>
          <ListRow title="Assigner" description={q.newTacheEquipeIds.size + q.newTacheMemberIds.size > 0 ? `${q.newTacheEquipeIds.size + q.newTacheMemberIds.size} sélectionné(s)` : 'Équipes et membres'} onClick={() => setAssign(v => !v)} />
        </ListGroup>
        {assign && (
          <>
            <ListGroup title="Équipes" description={q.allEquipes.length === 0 ? 'Aucune équipe créée.' : undefined}>
              {q.allEquipes.map(e => (
                <CheckRow key={e.id} title={e.name} checked={q.newTacheEquipeIds.has(e.id)} onCheckedChange={() => q.setNewTacheEquipeIds(prev => toggled(prev, e.id))} />
              ))}
            </ListGroup>
            <ListGroup title="Membres" description={q.allAssignableMembers.length === 0 ? 'Aucun membre créé.' : undefined}>
              {q.allAssignableMembers.map(m => (
                <CheckRow key={m.id} title={memberLabel(m)} checked={q.newTacheMemberIds.has(m.id)} onCheckedChange={() => q.setNewTacheMemberIds(prev => toggled(prev, m.id))} />
              ))}
            </ListGroup>
          </>
        )}
        {q.canSuggestAiMilestones && q.linkedQuoteId && (
          <ListGroup description={q.suggestTasksError ?? 'Sarah propose des tâches d’après les prestations du devis lié.'}>
            <ListRow
              title="Importer depuis le devis"
              leading={<Sparkles size={18} aria-hidden="true" />}
              onClick={() => { onClose(); onSuggest() }}
              disabled={q.suggestTasksLoading}
            />
          </ListGroup>
        )}
        {q.taskLibraryTitles.length > 0 && (
          <ListGroup title="Tâches de vos autres chantiers" description="Touchez une tâche pour pré-remplir l'intitulé.">
            <li className={styles.fields} style={{ listStyle: 'none' }}>
              <Field type="text" label="Filtrer" value={filter} onChange={e => setFilter(e.target.value)} />
            </li>
            {library.map(title => (
              <ListRow key={title} title={title} leading={<FileText size={18} aria-hidden="true" />} onClick={() => q.setNewTacheTitle(title)} />
            ))}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

/** Tâches proposées d'après le devis : modifier, valider une à une, tout valider ou tout ignorer. */
export function SuggestionsSheet({ q }: { q: ChantierDetailState }) {
  const open = q.showTaskSuggestions && q.taskSuggestions.length > 0
  const close = () => { q.setTaskSuggestions([]); q.setShowTaskSuggestions(false) }
  return (
    <Sheet
      open={open}
      onOpenChange={o => { if (!o) close() }}
      title={`${q.taskSuggestions.length} tâche${q.taskSuggestions.length > 1 ? 's' : ''} proposée${q.taskSuggestions.length > 1 ? 's' : ''}`}
      description="Corrigez les intitulés, puis validez."
      confirmLabel="Tout valider"
      confirmLoading={q.validateAllLoading}
      onConfirm={q.handleValidateAllSuggestions}
      cancelLabel="Tout ignorer"
    >
      <ListGroup>
        {q.taskSuggestions.map(sugg => (
          <li key={sugg._id} className={fiche.suggRow} style={{ listStyle: 'none' }}>
            <div className={styles.fields} style={{ background: 'none' }}>
              <Field
                type="text"
                label="Intitulé"
                value={sugg.title}
                onChange={e => q.setTaskSuggestions(prev => prev.map(s => s._id === sugg._id ? { ...s, title: e.target.value } : s))}
              />
            </div>
            <button type="button" className={fiche.iconButton} aria-label={`Valider « ${sugg.title} »`} disabled={q.validatingSuggId === sugg._id || q.validateAllLoading} onClick={() => q.handleValidateSuggestion(sugg._id)}>
              <Check size={18} aria-hidden="true" />
            </button>
            <button type="button" className={fiche.iconButton} data-tone="danger" aria-label={`Ignorer « ${sugg.title} »`} onClick={() => q.setTaskSuggestions(prev => prev.filter(s => s._id !== sugg._id))}>
              <Trash2 size={18} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ListGroup>
      {q.suggestTasksError && <p className={screen.error} role="alert">{q.suggestTasksError}</p>}
    </Sheet>
  )
}

/** Nouvelle entrée de journal. */
export function NoteSheet({ q, onClose }: { q: ChantierDetailState; onClose: () => void }) {
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Entrée de journal"
      description="Observations du jour, problèmes rencontrés, décisions prises."
      confirmLabel="Ajouter"
      confirmLoading={q.noteLoading}
      confirmDisabled={!q.noteContent.trim()}
      onConfirm={async () => { await q.handleAddNote(submitEvent); onClose() }}
    >
      <Field type="textarea" label="Note" value={q.noteContent} onChange={e => q.setNoteContent(e.target.value)} />
    </Sheet>
  )
}
