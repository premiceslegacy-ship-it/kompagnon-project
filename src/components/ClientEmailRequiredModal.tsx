'use client'

import React, { useState } from 'react'
import { getClientDisplayName } from '@/lib/client'
import { updateClientEmailInline } from '@/lib/data/mutations/clients'
import { ActionButton } from '@/components/ui/ActionButton'
import { Mail, X } from 'lucide-react'

type ClientEmailTarget = {
  id: string
  type?: string | null
  company_name?: string | null
  contact_name?: string | null
  first_name?: string | null
  last_name?: string | null
  email?: string | null
}

type Props = {
  open: boolean
  client: ClientEmailTarget | null
  documentLabel: string
  onCancel: () => void
  onSaved: (email: string) => void | Promise<void>
}

export default function ClientEmailRequiredModal({ open, client, documentLabel, onCancel, onSaved }: Props) {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  if (!open || !client) return null

  async function handleSubmit() {
    if (!client) return
    setSaving(true)
    setError(null)
    const result = await updateClientEmailInline(client.id, email)
    if (result.error || !result.email) {
      setError(result.error ?? 'Impossible d’enregistrer l’email.')
      setSaving(false)
      return
    }
    await onSaved(result.email)
    setSaving(false)
    setEmail('')
  }

  return (
    <div className="modal-overlay z-[320]">
      <div className="modal-panel space-y-5 sm:max-w-md">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0">
              <Mail className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-primary">Email client manquant</h3>
              <p className="text-sm text-secondary mt-1">
                Ajoutez l’email de {getClientDisplayName(client)} pour envoyer {documentLabel}.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="text-secondary hover:text-primary transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">Adresse email</label>
          <input
            type="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="client@exemple.fr"
            className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
            autoFocus
          />
        </div>

        {error && (
          <p className="text-sm text-red-500 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-xl p-3">
            {error}
          </p>
        )}

        <div className="flex flex-col-reverse sm:flex-row justify-end gap-3">
          <button type="button" onClick={onCancel} disabled={saving} className="btn-secondary">
            Annuler
          </button>
          <ActionButton
            onClick={handleSubmit}
            loading={saving}
            disabled={!email.trim()}
            className="btn-primary inline-flex items-center justify-center gap-2 min-w-[12rem]"
          >
            Enregistrer et envoyer
          </ActionButton>
        </div>
      </div>
    </div>
  )
}
