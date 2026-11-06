'use client'
// @atelier-migrated
// Éditeur d'un modèle de devis : en-tête, sections, lignes, enregistrement.

import { useState } from 'react'
import type { PrestationType } from '@/lib/data/queries/catalog'
import { createPrestationType, setPrestationTypeItems, updatePrestationType } from '@/lib/data/mutations/catalog'
import {
  blankHeader, blankSection, headerPayload, itemsPayload, modeleTotals, sectionsFromItems, upsertItem,
  type LocalItem, type ModeleHeader, type Section,
} from './modelesModel'

export type ModeleEditorState = ReturnType<typeof useModeleEditor>

export function useModeleEditor({ editing, onSaved }: { editing: PrestationType | null; onSaved: (p: PrestationType) => void }) {
  const [header, setHeaderState] = useState<ModeleHeader>(() => editing ? { name: editing.name, description: editing.description ?? '', is_active: editing.is_active } : blankHeader())
  const [sections, setSections] = useState<Section[]>(() => editing ? sectionsFromItems(editing.items) : [blankSection()])
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const totals = modeleTotals(sections)

  const touch = <T,>(fn: (prev: T) => T) => (prev: T) => { setDirty(true); return fn(prev) }

  function setHeader(patch: Partial<ModeleHeader>) { setDirty(true); setHeaderState(h => ({ ...h, ...patch })) }
  function addSection(title = '') { setSections(touch(prev => [...prev, blankSection(title)])) }
  function renameSection(id: string, title: string) { setSections(touch(prev => prev.map(s => s.tempId === id ? { ...s, title } : s))) }
  function removeSection(id: string) { setSections(touch(prev => prev.filter(s => s.tempId !== id))) }
  function saveItem(sectionId: string, item: LocalItem) { setSections(touch(prev => upsertItem(prev, sectionId, item))) }
  function removeItem(sectionId: string, itemId: string) {
    setSections(touch(prev => prev.map(s => s.tempId === sectionId ? { ...s, items: s.items.filter(i => i.tempId !== itemId) } : s)))
  }

  /** Enregistre l'en-tête puis les lignes ; renvoie vrai si tout est passé. */
  async function save(): Promise<boolean> {
    if (!header.name.trim()) { setError('Le nom est requis.'); return false }
    setSaving(true)
    setError(null)
    const payload = headerPayload(header)
    let prestationId: string
    if (editing) {
      const res = await updatePrestationType(editing.id, payload)
      if (res.error) { setSaving(false); setError(res.error); return false }
      prestationId = editing.id
    } else {
      const res = await createPrestationType(payload)
      if (res.error || !res.id) { setSaving(false); setError(res.error ?? 'Erreur inconnue'); return false }
      prestationId = res.id
    }
    const res = await setPrestationTypeItems(prestationId, itemsPayload(sections))
    setSaving(false)
    if (res.error) { setError(res.error); return false }
    if (res.prestation) onSaved(res.prestation)
    setDirty(false)
    return true
  }

  return { header, setHeader, sections, addSection, renameSection, removeSection, saveItem, removeItem, dirty, saving, error, setError, totals, save }
}
