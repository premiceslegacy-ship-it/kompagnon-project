'use client'
// @atelier-migrated

import { useRef, useState, useTransition } from 'react'
import { mergeChecklist, type ChecklistItem } from '@/lib/technical-checklist'
import type { BusinessProfile } from '@/lib/catalog-context'
import { updateQuote } from '@/lib/data/mutations/quotes'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { CheckRow, ListGroup } from '@/components/ui/ListGroup'
import styles from './Panels.module.css'

/** Points techniques à vérifier avant d'envoyer le devis, par catégorie. */
export default function TechnicalChecklistPanel({
  quoteId,
  initialChecklist,
  businessProfile,
}: {
  quoteId: string
  initialChecklist: ChecklistItem[] | null | undefined
  businessProfile?: BusinessProfile | null
}) {
  const [items, setItems] = useState<ChecklistItem[]>(() => mergeChecklist(initialChecklist, businessProfile))
  const [newLabel, setNewLabel] = useState('')
  const [, startTransition] = useTransition()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkedCount = items.filter(i => i.checked).length
  const categories = [...new Set(items.map(i => i.category))]

  function persist(next: ChecklistItem[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      startTransition(async () => {
        await updateQuote(quoteId, { technical_checklist: next })
      })
    }, 800)
  }

  function toggle(id: string) {
    const next = items.map(i => (i.id === id ? { ...i, checked: !i.checked } : i))
    setItems(next)
    persist(next)
  }

  function removeItem(id: string) {
    const next = items.filter(i => i.id !== id)
    setItems(next)
    persist(next)
  }

  function addItem() {
    const label = newLabel.trim()
    if (!label) return
    const next = [...items, { id: `custom_${Date.now()}`, label, category: 'Personnalisé', checked: false }]
    setItems(next)
    setNewLabel('')
    persist(next)
  }

  return (
    <div className={styles.stack}>
      <p className={styles.note}>{checkedCount} point{checkedCount > 1 ? 's' : ''} sur {items.length} vérifié{checkedCount > 1 ? 's' : ''}.</p>
      {categories.map(cat => (
        <ListGroup key={cat} title={cat}>
          {items.filter(i => i.category === cat).map(item => (
            <CheckRow key={item.id} title={item.label} checked={item.checked} onCheckedChange={() => toggle(item.id)} />
          ))}
        </ListGroup>
      ))}
      <div className={styles.addRow}>
        <Field
          type="text"
          label="Nouveau point"
          placeholder="Point à vérifier"
          value={newLabel}
          onChange={event => setNewLabel(event.target.value)}
          onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addItem() } }}
        />
        <Button variant="secondary" size="md" onClick={addItem} disabled={!newLabel.trim()}>Ajouter</Button>
      </div>
      {items.some(i => i.category === 'Personnalisé') && (
        <div className={styles.actions}>
          {items.filter(i => i.category === 'Personnalisé').map(item => (
            <Button key={item.id} variant="text" size="sm" onClick={() => removeItem(item.id)}>
              Retirer « {item.label} »
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
