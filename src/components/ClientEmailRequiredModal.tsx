'use client'
// @atelier-migrated

import { useState } from 'react'
import { getClientDisplayName } from '@/lib/client'
import { updateClientEmailInline } from '@/lib/data/mutations/clients'
import { Field } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import styles from '@/app/(app)/finances/quote-editor/QuoteEditor.module.css'

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

/** Demande l'email du client au moment d'envoyer un document, puis l'enregistre sur sa fiche. */
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
    <Sheet
      open
      onOpenChange={next => { if (!next && !saving) onCancel() }}
      title="Email du client manquant"
      description={`Ajoutez l’email de ${getClientDisplayName(client)} pour envoyer ${documentLabel}.`}
      onConfirm={handleSubmit}
      confirmLabel="Enregistrer et envoyer"
      confirmLoading={saving}
      confirmDisabled={!email.trim()}
    >
      <div className={styles.detail}>
        {error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}
        <div className={styles.fields}>
          <Field
            type="email"
            label="Adresse email"
            placeholder="client@exemple.fr"
            autoComplete="email"
            value={email}
            onChange={event => setEmail(event.target.value)}
            autoFocus
          />
        </div>
      </div>
    </Sheet>
  )
}
