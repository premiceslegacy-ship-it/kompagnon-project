'use client'
// @atelier-migrated

import { useEffect, useState, useTransition } from 'react'
import { generateAIReminderDraft } from '@/lib/data/mutations/ai-summary'
import { sendInvoiceReminder, sendQuoteFollowup } from '@/lib/data/mutations/reminders'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import styles from '@/app/(app)/finances/quote-editor/QuoteEditor.module.css'

type Props = {
  type: 'invoice' | 'quote'
  id: string
  onSent: () => void
  onClose: () => void
}

const RANK_LABELS = ['', 'Relance cordiale', 'Relance directe', 'Mise en demeure']

/** Relance rédigée par l'assistante : on relit, on corrige, on envoie. */
export default function AIReminderModal({ type, id, onSent, onClose }: Props) {
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [rank, setRank] = useState(1)
  const [clientEmail, setClientEmail] = useState<string | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isGenerating, startGenerating] = useTransition()
  const [isSending, startSending] = useTransition()

  useEffect(() => {
    generate()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function generate() {
    setDraftError(null)
    setSendError(null)
    startGenerating(async () => {
      const res = await generateAIReminderDraft(type, id)
      setRank(res.rank)
      setClientEmail(res.clientEmail)
      if (res.error) {
        setDraftError(res.error)
      } else {
        setSubject(res.subject!)
        setBody(res.body!)
      }
    })
  }

  function handleSend() {
    setSendError(null)
    startSending(async () => {
      const res = type === 'invoice'
        ? await sendInvoiceReminder(id, { subject, body })
        : await sendQuoteFollowup(id, { subject, body })
      if (res.error) setSendError(res.error)
      else onSent()
    })
  }

  const rankLabel = RANK_LABELS[rank] ?? `Relance ${rank}`
  const canSend = !isGenerating && !isSending && Boolean(clientEmail) && Boolean(subject.trim()) && Boolean(body.trim())

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open && !isSending) onClose() }}
      title={rankLabel}
      description={clientEmail ? `Envoi vers ${clientEmail}.` : undefined}
      onConfirm={handleSend}
      confirmLabel="Envoyer"
      confirmLoading={isSending}
      confirmDisabled={!canSend}
    >
      <div className={styles.detail}>
        {isGenerating && <p className={styles.hint} role="status" style={{ marginTop: 0 }}>L’assistante rédige la relance…</p>}
        {draftError && (
          <>
            <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{draftError}</p>
            <p className={styles.hint}>Vous pouvez rédiger la relance manuellement ci-dessous.</p>
            <div className={styles.inline}>
              <Button variant="secondary" size="md" onClick={generate}>Réessayer</Button>
            </div>
          </>
        )}
        {!isGenerating && (
          <>
            {!clientEmail && (
              <p className={styles.hint} style={{ marginTop: 0 }}>
                Aucun email enregistré pour ce client : ajoutez-en un avant d’envoyer une relance.
              </p>
            )}
            <div className={styles.fields}>
              <Field type="text" label="Objet" value={subject} onChange={event => setSubject(event.target.value)} />
              <Field type="textarea" label="Message" rows={10} value={body} onChange={event => setBody(event.target.value)} />
            </div>
            <div className={styles.inline}>
              <Button variant="text" size="md" onClick={generate} disabled={isSending}>Réécrire</Button>
            </div>
            {sendError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{sendError}</p>}
          </>
        )}
      </div>
    </Sheet>
  )
}
