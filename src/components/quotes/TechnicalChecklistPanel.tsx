'use client'

import { useState, useTransition, useRef } from 'react'
import { CheckSquare2, Square, ChevronDown, ChevronUp, Trash2, Plus } from 'lucide-react'
import { mergeChecklist, type ChecklistItem } from '@/lib/technical-checklist'
import type { BusinessProfile } from '@/lib/catalog-context'
import { updateQuote } from '@/lib/data/mutations/quotes'

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
  const [collapsed, setCollapsed] = useState(true)
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
    const next = items.map(i => i.id === id ? { ...i, checked: !i.checked } : i)
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
    const newItem: ChecklistItem = {
      id: `custom_${Date.now()}`,
      label,
      category: 'Personnalisé',
      checked: false,
    }
    const next = [...items, newItem]
    setItems(next)
    setNewLabel('')
    persist(next)
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full flex items-center justify-between group"
      >
        <div className="flex items-center gap-2">
          <CheckSquare2 className="w-4 h-4 text-accent shrink-0" />
          <span className="font-semibold text-primary text-sm">Checklist technique</span>
          <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ${checkedCount === items.length ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-white/10 dark:text-gray-300'}`}>
            {checkedCount}/{items.length}
          </span>
        </div>
        {collapsed
          ? <ChevronDown className="w-4 h-4 text-secondary" />
          : <ChevronUp className="w-4 h-4 text-secondary" />
        }
      </button>

      {!collapsed && (
        <div className="space-y-3 pt-1">
          {categories.map(cat => (
            <div key={cat}>
              <p className="text-xs font-semibold text-secondary uppercase tracking-wide mb-1.5">{cat}</p>
              <div className="space-y-1">
                {items.filter(i => i.category === cat).map(item => (
                  <div
                    key={item.id}
                    className="flex items-center gap-1 group/item"
                  >
                    <button
                      onClick={() => toggle(item.id)}
                      className="flex-1 flex items-center gap-2.5 text-left px-2 py-1.5 rounded-lg hover:bg-base transition-colors"
                    >
                      {item.checked
                        ? <CheckSquare2 className="w-4 h-4 text-accent shrink-0" />
                        : <Square className="w-4 h-4 text-secondary shrink-0 group-hover/item:text-primary transition-colors" />
                      }
                      <span className={`text-sm ${item.checked ? 'text-secondary line-through' : 'text-primary'}`}>
                        {item.label}
                      </span>
                    </button>
                    <button
                      onClick={() => removeItem(item.id)}
                      className="p-1 rounded-lg opacity-0 group-hover/item:opacity-100 text-secondary hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all shrink-0"
                      title="Supprimer cet item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Ajout d'un item personnalisé */}
          <div className="flex items-center gap-2 pt-1 border-t border-[var(--elevation-border)]">
            <input
              type="text"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') addItem() }}
              placeholder="Ajouter un point à vérifier..."
              className="flex-1 px-2.5 py-1.5 text-sm bg-base border border-[var(--elevation-border)] rounded-lg text-primary placeholder:text-secondary focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
            <button
              onClick={addItem}
              disabled={!newLabel.trim()}
              className="p-1.5 rounded-lg text-accent border border-accent/30 hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
              title="Ajouter"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
