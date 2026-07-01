'use client'

import { useState, useTransition } from 'react'
import { Plus, Pencil, Trash2, ChevronDown, ChevronUp, Save, X, Loader2 } from 'lucide-react'
import type { QuoteClauseTemplate } from '@/lib/data/queries/clause-templates'
import { upsertQuoteClauseTemplate, deleteQuoteClauseTemplate } from '@/lib/data/mutations/clause-templates'

const SUGGESTED_CATEGORIES = [
  'Validité & prix matière',
  'Délai & planning',
  'Plans & cotes',
  'Tolérances',
  'Finition & sous-traitance',
  'Réception & garanties',
  'Paiement',
  'Général',
]

type FormState = {
  id?: string
  title: string
  body: string
  category: string
  position: number
}

const emptyForm = (): FormState => ({ title: '', body: '', category: '', position: 0 })

export default function ClauseTemplatesSettings({
  initialClauses,
}: {
  initialClauses: QuoteClauseTemplate[]
}) {
  const [clauses, setClauses] = useState<QuoteClauseTemplate[]>(initialClauses)
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [isPending, startTransition] = useTransition()
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const categories = [...new Set(clauses.map(c => c.category ?? 'Général').filter(Boolean))]

  function openNew() {
    setForm({ ...emptyForm(), position: clauses.length })
    setEditingId('new')
    setExpandedId(null)
  }

  function openEdit(c: QuoteClauseTemplate) {
    setForm({ id: c.id, title: c.title, body: c.body, category: c.category ?? '', position: c.position })
    setEditingId(c.id)
    setExpandedId(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setForm(emptyForm())
    setSaveStatus('idle')
  }

  function handleSave() {
    if (!form.title.trim() || !form.body.trim()) return
    setSaveStatus('saving')
    startTransition(async () => {
      const result = await upsertQuoteClauseTemplate({
        ...form,
        category: form.category.trim() || null,
      } as Parameters<typeof upsertQuoteClauseTemplate>[0])
      if (!result) { setSaveStatus('error'); return }
      setClauses(prev => {
        const exists = prev.findIndex(c => c.id === result.id)
        if (exists >= 0) {
          const updated = [...prev]
          updated[exists] = result
          return updated
        }
        return [...prev, result]
      })
      setSaveStatus('saved')
      setTimeout(() => { setSaveStatus('idle'); cancelEdit() }, 800)
    })
  }

  function handleDelete(id: string) {
    setDeletingId(id)
    startTransition(async () => {
      const result = await deleteQuoteClauseTemplate(id)
      if (result.error) {
        setSaveStatus('error')
        setDeletingId(null)
        return
      }
      setClauses(prev => prev.filter(c => c.id !== id))
      setDeletingId(null)
      if (editingId === id) cancelEdit()
    })
  }

  const grouped = categories.length > 0
    ? categories.map(cat => ({
        cat,
        items: clauses.filter(c => (c.category ?? 'Général') === cat).sort((a, b) => a.position - b.position),
      }))
    : [{ cat: 'Général', items: clauses }]

  if (clauses.length === 0 && editingId === null) {
    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold text-primary mb-1">Clauses réutilisables</h2>
            <p className="text-sm text-secondary">Créez des clauses types à insérer rapidement dans vos devis (conditions matière, délais, tolérances...).</p>
          </div>
          <button onClick={openNew} className="btn-primary flex items-center gap-2 text-sm shrink-0">
            <Plus className="w-4 h-4" />
            Nouvelle clause
          </button>
        </div>
        <div className="rounded-2xl border border-dashed border-[var(--elevation-border)] p-10 text-center">
          <p className="text-secondary text-sm">Aucune clause. Créez votre première clause type.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-bold text-primary mb-1">Clauses réutilisables</h2>
          <p className="text-sm text-secondary">Ces clauses sont disponibles à l&apos;insertion dans l&apos;éditeur de devis (champ texte d&apos;introduction ou conditions).</p>
        </div>
        {editingId === null && (
          <button onClick={openNew} className="btn-primary flex items-center gap-2 text-sm shrink-0">
            <Plus className="w-4 h-4" />
            Nouvelle clause
          </button>
        )}
      </div>

      {/* Formulaire création / édition */}
      {editingId !== null && (
        <div className="rounded-2xl border border-accent/40 bg-surface dark:bg-white/5 p-6 space-y-4">
          <h3 className="font-semibold text-primary">{editingId === 'new' ? 'Nouvelle clause' : 'Modifier la clause'}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1 block">Titre</label>
              <input
                type="text"
                placeholder="ex : Validité prix matière"
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1 block">Catégorie</label>
              <input
                type="text"
                list="clause-categories"
                placeholder="ex : Validité & prix matière"
                value={form.category}
                onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <datalist id="clause-categories">
                {SUGGESTED_CATEGORIES.map(c => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>
          <div>
            <label className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1 block">Contenu</label>
            <textarea
              rows={5}
              placeholder="Texte de la clause..."
              value={form.body}
              onChange={e => setForm(f => ({ ...f, body: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 resize-y"
            />
          </div>
          <div className="flex items-center justify-between gap-3">
            <button onClick={cancelEdit} className="btn-secondary text-sm flex items-center gap-1.5">
              <X className="w-4 h-4" />
              Annuler
            </button>
            <button
              onClick={handleSave}
              disabled={isPending || !form.title.trim() || !form.body.trim()}
              className={`px-6 py-2.5 rounded-full font-bold text-sm flex items-center gap-2 transition-all shadow-sm disabled:opacity-50 ${saveStatus === 'saved' ? 'bg-green-500 text-white' : saveStatus === 'error' ? 'bg-red-500 text-white' : 'bg-accent text-black'}`}
            >
              {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saveStatus === 'saving' ? 'Enregistrement...' : saveStatus === 'saved' ? 'Enregistré !' : saveStatus === 'error' ? 'Erreur' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {/* Liste par catégorie */}
      {grouped.map(({ cat, items }) => items.length === 0 ? null : (
        <div key={cat} className="space-y-2">
          {categories.length > 0 && (
            <p className="text-xs font-semibold text-secondary uppercase tracking-wide px-1">{cat}</p>
          )}
          {items.map(clause => (
            <div key={clause.id} className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
              <div className="flex items-center gap-3 px-4 py-3">
                <button
                  onClick={() => setExpandedId(expandedId === clause.id ? null : clause.id)}
                  className="flex-1 text-left flex items-center gap-2 min-w-0"
                >
                  <span className="font-medium text-primary text-sm truncate">{clause.title}</span>
                  {expandedId === clause.id
                    ? <ChevronUp className="w-4 h-4 text-secondary shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-secondary shrink-0" />
                  }
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => openEdit(clause)}
                    disabled={editingId !== null}
                    className="p-1.5 rounded-lg hover:bg-base text-secondary hover:text-primary transition-colors disabled:opacity-40"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(clause.id)}
                    disabled={deletingId === clause.id || isPending}
                    className="p-1.5 rounded-lg hover:bg-red-50 text-secondary hover:text-red-500 transition-colors disabled:opacity-40 dark:hover:bg-red-900/20"
                  >
                    {deletingId === clause.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
              {expandedId === clause.id && (
                <div className="px-4 pb-4 border-t border-[var(--elevation-border)] pt-3">
                  <p className="text-sm text-secondary whitespace-pre-wrap">{clause.body}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
