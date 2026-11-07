'use client'
// @atelier-migrated

import { useEffect, useState } from 'react'
import { CheckRow, ListGroup } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import styles from '@/app/(app)/finances/quote-editor/QuoteEditor.module.css'

export type AttachmentGroup = {
  key: string
  label: string
  items: Array<{ id: string; label: string; meta: string | null }>
}

type Props = {
  title: string
  description?: string
  recipientEmail: string | null
  groups: AttachmentGroup[]
  loading?: boolean
  submitting?: boolean
  error?: string | null
  onCancel: () => void
  onConfirm: (selected: Record<string, string[]>) => void
}

/** Choix des pièces jointes à ajouter à un envoi par email. */
export default function AttachmentPickerModal({
  title, description, recipientEmail, groups, loading, submitting, error, onCancel, onConfirm,
}: Props) {
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})

  useEffect(() => {
    setSelected(prev => {
      const next: Record<string, Set<string>> = {}
      for (const g of groups) next[g.key] = prev[g.key] ?? new Set()
      return next
    })
  }, [groups])

  const toggle = (groupKey: string, id: string) => {
    setSelected(current => {
      const set = new Set(current[groupKey] ?? [])
      if (set.has(id)) set.delete(id)
      else set.add(id)
      return { ...current, [groupKey]: set }
    })
  }

  const totalSelected = Object.values(selected).reduce((acc, set) => acc + set.size, 0)
  const nothingToAttach = groups.length === 0 || groups.every(g => g.items.length === 0)

  const handleConfirm = () => {
    const payload: Record<string, string[]> = {}
    for (const g of groups) payload[g.key] = Array.from(selected[g.key] ?? [])
    onConfirm(payload)
  }

  const summary = totalSelected > 0
    ? `${totalSelected} document${totalSelected > 1 ? 's' : ''} joint${totalSelected > 1 ? 's' : ''} en plus.`
    : 'Aucune pièce jointe en plus du document.'
  const intro = [description, recipientEmail ? `Destinataire : ${recipientEmail}.` : null].filter(Boolean).join(' ')

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open && !submitting) onCancel() }}
      title={title}
      description={intro || undefined}
      onConfirm={handleConfirm}
      confirmLabel="Envoyer"
      confirmLoading={Boolean(submitting)}
      confirmDisabled={Boolean(loading)}
    >
      <div className={styles.detail}>
        {error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}
        {loading ? (
          <p className={styles.hint} role="status">Chargement des documents…</p>
        ) : nothingToAttach ? (
          <p className={styles.hint}>Aucun document de ce client à joindre.</p>
        ) : (
          <>
            {groups.filter(group => group.items.length > 0).map(group => (
              <ListGroup key={group.key} title={group.label}>
                {group.items.map(item => (
                  <CheckRow
                    key={item.id}
                    title={item.label}
                    description={item.meta ?? undefined}
                    checked={selected[group.key]?.has(item.id) ?? false}
                    onCheckedChange={() => toggle(group.key, item.id)}
                  />
                ))}
              </ListGroup>
            ))}
            <p className={styles.hint} style={{ marginTop: 0 }}>{summary}</p>
          </>
        )}
      </div>
    </Sheet>
  )
}
