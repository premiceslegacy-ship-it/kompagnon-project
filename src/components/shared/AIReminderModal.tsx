'use client'

import { useState, useTransition, useEffect } from 'react'
import { Sparkles, Loader2, Send, X, RefreshCw, Bot } from 'lucide-react'
import { generateAIReminderDraft } from '@/lib/data/mutations/ai-summary'
import { sendInvoiceReminder, sendQuoteFollowup } from '@/lib/data/mutations/reminders'

type Props = {
  type: 'invoice' | 'quote'
  id: string
  onSent: () => void
  onClose: () => void
}

const RANK_LABELS = ['', 'Relance cordiale', 'Relance directe', 'Mise en demeure']
const RANK_COLORS = ['', 'text-blue-600', 'text-amber-600', 'text-red-600']

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
      if (res.error) {
        setSendError(res.error)
      } else {
        onSent()
      }
    })
  }

  const rankLabel = RANK_LABELS[rank] ?? `Relance ${rank}`
  const rankColor = RANK_COLORS[rank] ?? 'text-secondary'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 w-full max-w-lg bg-surface rounded-3xl shadow-2xl border border-[var(--elevation-border)] flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-[var(--elevation-border)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
              <Bot className="w-4 h-4 text-accent" />
            </div>
            <div>
              <p className="text-sm font-bold text-primary">Relance générée par IA</p>
              <p className={`text-xs font-semibold ${rankColor}`}>{rankLabel}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-black/5 dark:hover:bg-white/10 transition-colors">
            <X className="w-4 h-4 text-secondary" />
          </button>
        </div>

        {/* Contenu */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {isGenerating ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-accent" />
              <p className="text-sm text-secondary">Génération en cours...</p>
            </div>
          ) : draftError ? (
            <div className="space-y-3">
              <p className="text-sm text-red-500">{draftError}</p>
              <button onClick={generate} className="text-sm text-accent hover:underline flex items-center gap-1">
                <RefreshCw className="w-3 h-3" />Réessayer
              </button>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                <label className="text-xs font-bold text-secondary uppercase tracking-wider">Objet</label>
                <input
                  type="text"
                  value={subject}
                  onChange={e => setSubject(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--elevation-border)] bg-transparent text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-bold text-secondary uppercase tracking-wider">Corps de l&apos;email</label>
                <textarea
                  rows={10}
                  value={body}
                  onChange={e => setBody(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-[var(--elevation-border)] bg-transparent text-sm text-primary focus:outline-none focus:ring-2 focus:ring-accent resize-none leading-relaxed"
                />
              </div>
              {clientEmail && (
                <p className="text-xs text-secondary">
                  Envoi vers <span className="font-semibold text-primary">{clientEmail}</span>
                </p>
              )}
              {!clientEmail && (
                <p className="text-xs text-amber-600 bg-amber-50 dark:bg-amber-500/10 px-3 py-2 rounded-xl">
                  Aucun email enregistré pour ce client — l&apos;email ne sera pas envoyé mais la relance sera loguée.
                </p>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!isGenerating && !draftError && (
          <div className="px-6 pb-6 pt-4 border-t border-[var(--elevation-border)] flex items-center gap-3">
            <button
              onClick={generate}
              disabled={isGenerating || isSending}
              className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors disabled:opacity-50"
            >
              <Sparkles className="w-4 h-4" />Régénérer
            </button>
            <div className="flex-1" />
            <button
              onClick={onClose}
              disabled={isSending}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-secondary hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
            >
              Annuler
            </button>
            <button
              onClick={handleSend}
              disabled={isSending || !subject || !body}
              className="px-5 py-2 rounded-xl bg-accent text-black text-sm font-bold flex items-center gap-2 hover:scale-[1.02] active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-accent/20"
            >
              {isSending
                ? <><Loader2 className="w-4 h-4 animate-spin" />Envoi...</>
                : <><Send className="w-4 h-4" />Envoyer</>}
            </button>
          </div>
        )}
        {sendError && (
          <p className="text-xs text-red-500 px-6 pb-4">{sendError}</p>
        )}
      </div>
    </div>
  )
}
