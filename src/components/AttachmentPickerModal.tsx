'use client'

import React, { useEffect, useState } from 'react'
import { FileText, Loader2, Paperclip, Send, X } from 'lucide-react'

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

export default function AttachmentPickerModal({
  title, description, recipientEmail, groups, loading, submitting, error, onCancel, onConfirm,
}: Props) {
  const [selected, setSelected] = useState<Record<string, Set<string>>>({})

  useEffect(() => {
    setSelected(prev => {
      const next: Record<string, Set<string>> = {}
      for (const g of groups) {
        next[g.key] = prev[g.key] ?? new Set()
      }
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

  const handleConfirm = () => {
    const payload: Record<string, string[]> = {}
    for (const g of groups) payload[g.key] = Array.from(selected[g.key] ?? [])
    onConfirm(payload)
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-xl font-extrabold text-primary">{title}</h2>
            {description && <p className="text-sm text-secondary mt-1">{description}</p>}
            {recipientEmail && (
              <p className="text-xs text-secondary mt-2">Destinataire : <span className="font-semibold text-primary">{recipientEmail}</span></p>
            )}
          </div>
          <button type="button" onClick={onCancel} className="p-2 rounded hover:bg-base text-secondary hover:text-primary">
            <X className="w-5 h-5" />
          </button>
        </div>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-secondary text-sm gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Chargement des documents…
          </div>
        ) : (
          <div className="space-y-5">
            {groups.length === 0 || groups.every(g => g.items.length === 0) ? (
              <div className="py-6 text-center">
                <Paperclip className="w-6 h-6 text-secondary mx-auto mb-2" />
                <p className="text-sm text-secondary">Aucun document associé à ce client à joindre.</p>
              </div>
            ) : (
              groups.map(group => (
                <div key={group.key}>
                  <h3 className="text-xs font-extrabold text-secondary uppercase tracking-wider mb-2">{group.label}</h3>
                  {group.items.length === 0 ? (
                    <p className="text-sm text-secondary italic">Aucun.</p>
                  ) : (
                    <div className="space-y-2">
                      {group.items.map(item => {
                        const checked = selected[group.key]?.has(item.id) ?? false
                        return (
                          <label
                            key={item.id}
                            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${checked ? 'border-accent bg-accent/5' : 'border-[var(--elevation-border)] hover:border-accent/45'}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggle(group.key, item.id)}
                              className="mt-0.5 w-4 h-4"
                            />
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-primary text-sm truncate">{item.label}</p>
                              {item.meta && <p className="text-xs text-secondary mt-0.5">{item.meta}</p>}
                            </div>
                            <FileText className="w-4 h-4 text-secondary flex-shrink-0" />
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {error && (
          <p className="mt-4 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500 font-semibold">{error}</p>
        )}

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-xs text-secondary">
            {totalSelected > 0
              ? `${totalSelected} document${totalSelected > 1 ? 's' : ''} sélectionné${totalSelected > 1 ? 's' : ''}`
              : 'Aucune pièce jointe additionnelle'}
          </p>
          <div className="flex gap-3">
            <button type="button" onClick={onCancel} disabled={submitting} className="btn-secondary">Annuler</button>
            <button type="button" onClick={handleConfirm} disabled={submitting || loading} className="btn-primary inline-flex items-center gap-2">
              {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /> Envoi…</> : <><Send className="w-4 h-4" /> Envoyer</>}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
