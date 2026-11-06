'use client'
// @atelier-migrated
// Segment Travaux : tâches à trois états, journal, réception.

import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import type { Tache } from '@/lib/data/queries/chantiers'
import AICreditsErrorModal from '@/components/shared/AICreditsErrorModal'
import ReceptionSection from './ReceptionSection'
import { NewTaskSheet, NoteSheet, SuggestionsSheet, TACHE_LABELS, TaskSheet } from './TaskSheets'
import type { ChantierDetailState } from './useChantierDetail'
import screen from '@/components/layout/Screen.module.css'
import fiche from './ChantierFiche.module.css'

function dueLabel(d: string | null) {
  return d ? `échéance ${new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}` : null
}

export default function TravauxSegment({ q }: { q: ChantierDetailState }) {
  const [taskId, setTaskId] = useState<string | null>(null)
  const [newTask, setNewTask] = useState(false)
  const [newNote, setNewNote] = useState(false)
  const [deleting, setDeleting] = useState<Tache | null>(null)
  const [deletingNoteId, setDeletingNoteId] = useState<string | null>(null)
  const canEdit = q.canEditChantier
  const done = q.tachesDone

  return (
    <>
      <ListGroup
        title={q.taches.length ? `${done} sur ${q.taches.length} terminée${done > 1 ? 's' : ''}` : 'Tâches'}
        description={q.taches.length === 0 ? 'Aucune tâche pour l’instant.' : canEdit ? 'Touchez le rond pour changer l’état d’une tâche.' : undefined}
      >
        {q.taches.map(t => {
          const who = (t.assignments ?? []).map(a => a.label).join(', ')
          return (
            <ListRow
              key={t.id}
              title={t.title}
              className={t.status === 'termine' ? fiche.done : undefined}
              description={[TACHE_LABELS[t.status], who, dueLabel(t.due_date), t.progress_note ? 'avec note' : null].filter(Boolean).join(' · ')}
              leading={
                <button
                  type="button"
                  className={fiche.tick}
                  disabled={!canEdit}
                  aria-label={`${TACHE_LABELS[t.status]}, toucher pour changer l’état`}
                  onClick={() => q.handleStatusToggle(t)}
                >
                  <span className={fiche.tickDot} data-state={t.status}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.2 8.3 3.1 3.1 6.5-6.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                </button>
              }
              onClick={() => setTaskId(t.id)}
            />
          )
        })}
        {canEdit && <ListRow title="Ajouter une tâche" className={fiche.linkRow} onClick={() => setNewTask(true)} />}
      </ListGroup>

      {q.suggestTasksLoading && <p className={screen.note} role="status">Sarah prépare les tâches d’après le devis…</p>}
      {!q.showTaskSuggestions && q.suggestTasksError && <p className={screen.error} role="alert">{q.suggestTasksError}</p>}

      {canEdit && (
        <ListGroup
          title="Journal"
          description={q.notes.length === 0 ? 'Observations du jour, problèmes rencontrés, décisions prises.' : undefined}
        >
          <ListRow title="Ajouter une note" className={fiche.linkRow} onClick={() => setNewNote(true)} />
          {q.notes.map(note => (
            <ListRow
              key={note.id}
              title={`${note.author_name} · ${new Date(note.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}`}
              description={note.content}
              trailing={
                <button type="button" className={fiche.iconButton} data-tone="danger" aria-label="Supprimer la note" onClick={() => setDeletingNoteId(note.id)}>
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              }
            />
          ))}
        </ListGroup>
      )}

      {canEdit && <ReceptionSection chantier={q.chantier} reserves={q.initialReserves} canEdit={canEdit} />}

      {taskId && (
        <TaskSheet
          q={q}
          tacheId={taskId}
          onClose={() => setTaskId(null)}
          onDelete={t => { setTaskId(null); setDeleting(t) }}
        />
      )}
      {newTask && <NewTaskSheet q={q} onClose={() => setNewTask(false)} onSuggest={q.handleSuggestTasks} />}
      {newNote && <NoteSheet q={q} onClose={() => setNewNote(false)} />}
      <SuggestionsSheet q={q} />
      {q.suggestTasksCreditsError && <AICreditsErrorModal onClose={() => q.setSuggestTasksCreditsError(false)} />}

      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title={`Supprimer « ${deleting?.title ?? ''} » ?`}
        description="La tâche sera retirée du chantier."
        confirmLabel="Supprimer"
        onConfirm={() => { if (deleting) q.handleDeleteTache(deleting); setDeleting(null) }}
      />
      <AlertDialog
        open={deletingNoteId !== null}
        onOpenChange={o => { if (!o) setDeletingNoteId(null) }}
        title="Supprimer cette note ?"
        description="L’entrée sera retirée du journal."
        confirmLabel="Supprimer"
        onConfirm={() => {
          const note = q.notes.find(n => n.id === deletingNoteId)
          if (note) q.handleDeleteNote(note)
          setDeletingNoteId(null)
        }}
      />
    </>
  )
}
