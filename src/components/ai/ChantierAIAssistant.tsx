'use client'
// @atelier-migrated

import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { cleanMarkdown } from '@/lib/utils'
import { AI_NAME } from '@/lib/brand'
import { Sheet } from '@/components/ui/Sheet'
import styles from './AssistantChat.module.css'

type Message = {
  id: string
  role: 'user' | 'assistant'
  content: string
  toolsExecuted?: string | null
}

type Props = {
  chantierId: string
  chantierTitle: string
  onClose: () => void
  onPlanningCreated?: () => void
}

const QUICK = [
  'On en est où sur la rentabilité ?',
  'Pointe 4 h pour moi aujourd’hui',
  'Quelles tâches sont en cours ?',
  'Combien reste-t-il sur le budget ?',
]

/** Conversation avec l'assistante sur un chantier : tâches, pointages, budget. */
export default function ChantierAIAssistant({ chantierId, chantierTitle, onClose, onPlanningCreated }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Bonjour, je suis ${AI_NAME}. Je connais le chantier ${chantierTitle} : tâches, pointages, rentabilité, budget.\n\nVoulez-vous pointer des heures, ajouter une note ou faire le point ?`,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [briefBanner, setBriefBanner] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Si l'assistante a préparé un contexte sur ce chantier, il devient le premier message.
  useEffect(() => {
    fetch('/api/sarah/briefs?target=marco')
      .then(r => r.json())
      .then(({ brief }: { brief: { id: string; payload: { description?: string; chantier_id?: string; chantier_title?: string } } | null }) => {
        if (!brief?.payload?.description?.trim()) return
        if (brief.payload.chantier_id && brief.payload.chantier_id !== chantierId) return
        setBriefBanner('Un message préparé par l’assistante a été ajouté ci-dessous.')
        setInput(brief.payload.description.trim())
        fetch('/api/sarah/briefs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ briefId: brief.id }),
        }).catch(() => {})
      })
      .catch(() => {})
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const textarea = inputRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`
  }, [input])

  async function handleSend() {
    const text = input.trim()
    if (!text || loading) return

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setLoading(true)
    setError(null)

    const history = [...messages, userMsg]
      .filter(m => m.id !== 'welcome')
      .map(m => ({ role: m.role, content: m.content }))

    try {
      const res = await fetch('/api/ai/chantier-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chantierId, messages: history }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Une erreur est survenue.')
        return
      }
      setMessages(prev => [...prev, {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
        toolsExecuted: data.toolsExecuted ?? null,
      }])
      if (data.planningCreated) onPlanningCreated?.()
    } catch {
      setError('Impossible de joindre l’assistante. Vérifiez votre connexion.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open) onClose() }}
      title={AI_NAME}
      description={chantierTitle}
      cancelLabel="Fermer"
    >
      <div className={styles.chat}>
        {briefBanner && <p className={styles.banner} role="status">{briefBanner}</p>}

        <div className={styles.messages} aria-live="polite">
          {messages.map(msg => (
            <p key={msg.id} className={`${styles.bubble} ${msg.role === 'user' ? styles.user : styles.assistant}`}>
              {msg.role === 'assistant' ? cleanMarkdown(msg.content) : msg.content}
              {msg.toolsExecuted && <span className={styles.tools}>{msg.toolsExecuted}</span>}
            </p>
          ))}
          {loading && <p className={styles.status} role="status">{AI_NAME} réfléchit…</p>}
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div ref={messagesEndRef} />
        </div>

        {messages.length <= 2 && !loading && (
          <div className={styles.chips}>
            {QUICK.map(q => (
              <button key={q} type="button" className={styles.chip} onClick={() => { setInput(q); inputRef.current?.focus() }}>
                {q}
              </button>
            ))}
          </div>
        )}

        <div className={styles.composer}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Posez une question ou donnez une instruction"
            aria-label="Message"
            rows={2}
          />
          <button type="button" className={styles.send} onClick={handleSend} disabled={!input.trim() || loading}>
            Envoyer
          </button>
        </div>
        <p className={styles.fine}>Entrée pour envoyer · Maj + Entrée pour un saut de ligne</p>
      </div>
    </Sheet>
  )
}
