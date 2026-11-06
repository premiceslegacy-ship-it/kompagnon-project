'use client'
// @atelier-migrated
// Devis : une clause réutilisable (création, modification, suppression).

import { useState, useTransition } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { deleteQuoteClauseTemplate, upsertQuoteClauseTemplate } from '@/lib/data/mutations/clause-templates'
import type { QuoteClauseTemplate } from '@/lib/data/queries/clause-templates'
import { CLAUSE_CATEGORIES, clauseFormValid, clausePayload, type ClauseForm } from './devisModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

type Props = {
  /** Clause en cours d'édition : formulaire vide pour une nouvelle, null pour fermé. */
  form: ClauseForm | null
  onChange: (form: ClauseForm | null) => void
  onSaved: (clause: QuoteClauseTemplate) => void
  onDeleted: (id: string) => void
}

export default function ClauseSheet({ form, onChange, onSaved, onDeleted }: Props) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const set = (patch: Partial<ClauseForm>) => form && onChange({ ...form, ...patch })

  function close() { setError(null); onChange(null) }

  function save() {
    if (!form || !clauseFormValid(form)) return
    setError(null)
    startTransition(async () => {
      const result = await upsertQuoteClauseTemplate(clausePayload(form) as Parameters<typeof upsertQuoteClauseTemplate>[0])
      if (!result) { setError('La clause n’a pas pu être enregistrée.'); return }
      onSaved(result)
      close()
    })
  }

  function remove() {
    const id = form?.id
    if (!id) return
    startTransition(async () => {
      const result = await deleteQuoteClauseTemplate(id)
      setConfirmDelete(false)
      if (result.error) { setError(result.error); return }
      onDeleted(id)
      close()
    })
  }

  return (
    <>
      <Sheet
        open={form !== null}
        onOpenChange={open => { if (!open) close() }}
        title={form?.id ? 'Clause' : 'Nouvelle clause'}
        onConfirm={save}
        confirmLabel={form?.id ? 'Enregistrer' : 'Ajouter'}
        confirmLoading={pending}
        confirmDisabled={!form || !clauseFormValid(form)}
      >
        {form && (
          <div className={local.sheetBody}>
            <div className={styles.fields}>
              <Field type="text" label="Titre" placeholder="Validité prix matière" value={form.title} onChange={e => set({ title: e.target.value })} />
              <Field type="text" label="Catégorie" list="clause-categories" placeholder="Général" value={form.category} onChange={e => set({ category: e.target.value })} />
            </div>
            <datalist id="clause-categories">
              {CLAUSE_CATEGORIES.map(c => <option key={c} value={c} />)}
            </datalist>
            <Field type="textarea" rows={6} label="Contenu" placeholder="Texte de la clause…" value={form.body} onChange={e => set({ body: e.target.value })} />
            {error && <p className={screen.error} role="alert">{error}</p>}
            {form.id && (
              <ListGroup>
                <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirmDelete(true)}>Supprimer la clause</button></li>
              </ListGroup>
            )}
          </div>
        )}
      </Sheet>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer « ${form?.title ?? ''} » ?`}
        description="La clause quitte la liste ; les devis déjà rédigés ne changent pas."
        confirmLabel="Supprimer"
        confirmLoading={pending}
        onConfirm={remove}
      />
    </>
  )
}
