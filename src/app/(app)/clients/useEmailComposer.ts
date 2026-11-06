'use client'
// @atelier-migrated
// Logique de l'email groupé : sélection des destinataires, brouillon de Sarah et envoi.

import { useMemo, useState } from 'react'
import type { Client } from '@/lib/data/queries/clients'
import { buildFilter, recipientCountFor, recipientLabelFor, visibleContactsFor, type CategoryFilter } from './emailModel'

export type EmailComposerOptions = {
  allClients: Client[]
  orgEmail: string | null
  orgName: string
  preselectedClientId?: string
  onClose: () => void
}

export function useEmailComposer({ allClients, orgEmail, orgName, preselectedClientId, onClose }: EmailComposerOptions) {
  const [tab, setTab] = useState<'manual' | 'sarah'>('manual')
  const [object, setObject] = useState('')
  const [body, setBody] = useState('')
  const [category, setCategory] = useState<CategoryFilter>('all')
  const [searchRecipient, setSearchRecipient] = useState('')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(preselectedClientId ? [preselectedClientId] : []))
  const [sarahContext, setSarahContext] = useState('')
  const [sarahTone, setSarahTone] = useState('professionnel')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [sent, setSent] = useState<{ count: number; errors: number } | null>(null)

  const visibleContacts = useMemo(() => visibleContactsFor(allClients, category, searchRecipient), [allClients, category, searchRecipient])
  const visibleIds = visibleContacts.map(c => c.id)
  const allVisibleChecked = visibleIds.length > 0 && visibleIds.every(id => selectedIds.has(id))

  const effectiveIds = Array.from(selectedIds)
  const hasManualSelection = effectiveIds.length > 0
  const recipientCount = recipientCountFor(allClients, category, effectiveIds.length)
  const recipientLabel = recipientLabelFor(category, effectiveIds.length)

  const toggleContact = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAllVisible = () => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (allVisibleChecked) visibleIds.forEach(id => next.delete(id))
      else visibleIds.forEach(id => next.add(id))
      return next
    })
  }

  const changeCategory = (value: CategoryFilter) => {
    setCategory(value)
    setSelectedIds(new Set())
  }

  const handleAskSarah = async () => {
    if (!object.trim()) {
      setAiError("Renseignez l'objet avant de demander à Sarah.")
      return
    }
    setAiLoading(true)
    setAiError(null)
    try {
      const res = await fetch('/api/ai/email-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipients: recipientLabel,
          subject: object.trim(),
          tone: sarahTone,
          context: sarahContext.trim() || undefined,
          orgEmail: orgEmail ?? undefined,
          orgName,
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setAiError(json.error ?? 'Erreur lors de la génération.')
        return
      }
      setBody(json.draft)
      setTab('manual')
    } catch {
      setAiError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setAiLoading(false)
    }
  }

  const handleSend = async () => {
    if (!object.trim()) { setSendError("L'objet est requis."); return }
    if (!body.trim()) { setSendError('Le corps du message est requis.'); return }
    if (recipientCount === 0) { setSendError('Aucun destinataire sélectionné avec une adresse email.'); return }

    setSending(true)
    setSendError(null)
    try {
      const res = await fetch('/api/email/send-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: object.trim(),
          bodyHtml: body.trim(),
          filter: buildFilter(effectiveIds, category),
        }),
      })
      const json = await res.json()
      if (!res.ok || json.error) {
        setSendError(json.error ?? "Erreur lors de l'envoi.")
        return
      }
      setSent({ count: json.sent, errors: json.errors })
    } catch {
      setSendError('Erreur réseau. Veuillez réessayer.')
    } finally {
      setSending(false)
    }
  }

  const handleClose = () => {
    setObject(''); setBody(''); setCategory('all'); setSearchRecipient(''); setSelectedIds(new Set())
    setSarahContext(''); setSarahTone('professionnel'); setAiError(null); setSendError(null); setSent(null); setTab('manual')
    onClose()
  }

  return {
    tab, setTab, object, setObject, body, setBody, category, changeCategory, searchRecipient, setSearchRecipient,
    selectedIds, setSelectedIds, sarahContext, setSarahContext, sarahTone, setSarahTone,
    aiLoading, aiError, sending, sendError, sent,
    visibleContacts, allVisibleChecked, hasManualSelection, recipientCount,
    toggleContact, toggleAllVisible, handleAskSarah, handleSend, handleClose,
  }
}

export type EmailComposer = ReturnType<typeof useEmailComposer>
