'use client'

import React, { useState, useRef, useEffect } from 'react'
import { Bot, Send, Loader2, X, Sparkles, ChevronDown } from 'lucide-react'
import { cleanMarkdown } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function ChantierAIAssistant({ chantierId, chantierTitle, onClose, onPlanningCreated }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `Bonjour ! Je suis votre assistant pour le chantier **${chantierTitle}**.\n\nJe connais les tâches, les pointages, les dépenses et la rentabilité en temps réel. Je peux aussi ajouter des heures, enregistrer une dépense, créer une note ou mettre à jour le statut d'une tâche.\n\nComment puis-je vous aider ?`,
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    inputRef.current?.focus()
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

    // Construire l'historique pour l'API (sans le message de bienvenue)
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
        setError(data.error ?? 'Erreur inconnue')
        return
      }

      const assistantMsg: Message = {
        id: crypto.randomUUID(),
        role: 'assistant',
        content: data.reply,
        toolsExecuted: data.toolsExecuted ?? null,
      }
      setMessages(prev => [...prev, assistantMsg])
      if (data.planningCreated) onPlanningCreated?.()
    } catch {
      setError('Impossible de contacter l\'IA. Vérifiez votre connexion.')
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Suggestions rapides
  const QUICK = [
    'Où en est la rentabilité ?',
    'Ajoute 4h de travail aujourd\'hui',
    'Quelles tâches sont en cours ?',
    'Quel est le budget restant ?',
  ]

  return (
    <div className="fixed inset-0 z-[110] flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />

      {/* Panel */}
      <div className="w-full max-w-md bg-surface border-l border-[var(--elevation-border)] flex flex-col shadow-2xl dark:bg-[#0d0d0d]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--elevation-border)]">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
              <Bot className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-primary">Assistant Chantier</p>
              <p className="text-xs text-secondary truncate max-w-[200px]">{chantierTitle}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[var(--elevation-border)] text-secondary transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {messages.map(msg => (
            <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'assistant' && (
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                  <Bot className="w-3 h-3 text-white" />
                </div>
              )}
              <div className={`max-w-[82%] ${msg.role === 'user'
                ? 'bg-accent text-white rounded-2xl rounded-tr-sm px-3.5 py-2.5'
                : 'bg-[var(--elevation-border)] text-primary rounded-2xl rounded-tl-sm px-3.5 py-2.5'
              }`}>
                <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.role === 'assistant' ? cleanMarkdown(msg.content) : msg.content}</p>
                {msg.toolsExecuted && (
                  <div className="mt-2 pt-2 border-t border-white/10">
                    <p className="text-xs opacity-70 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      {msg.toolsExecuted}
                    </p>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="flex justify-start">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center mr-2 mt-0.5 shrink-0">
                <Bot className="w-3 h-3 text-white" />
              </div>
              <div className="bg-[var(--elevation-border)] rounded-2xl rounded-tl-sm px-3.5 py-3">
                <Loader2 className="w-4 h-4 animate-spin text-accent" />
              </div>
            </div>
          )}

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-3.5 py-2.5 text-sm text-red-500">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick suggestions (visible si peu de messages) */}
        {messages.length <= 2 && !loading && (
          <div className="px-4 pb-2">
            <p className="text-xs text-secondary mb-2 flex items-center gap-1">
              <ChevronDown className="w-3 h-3" /> Suggestions rapides
            </p>
            <div className="flex flex-wrap gap-1.5">
              {QUICK.map(q => (
                <button
                  key={q}
                  onClick={() => { setInput(q); inputRef.current?.focus() }}
                  className="text-xs px-2.5 py-1 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary hover:border-accent/50 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div className="px-4 py-3 border-t border-[var(--elevation-border)]">
          <div className="flex items-end gap-2 bg-[var(--elevation-border)] rounded-2xl px-3.5 py-2.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Poser une question ou donner une instruction…"
              rows={3}
              className="flex-1 min-h-[4.5rem] max-h-40 bg-transparent text-sm text-primary placeholder:text-secondary resize-none outline-none leading-relaxed overflow-y-auto"
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
            >
              <Send className="w-3.5 h-3.5 text-white" />
            </button>
          </div>
          <p className="text-[10px] text-secondary/60 text-center mt-1.5">Entrée pour envoyer · Maj+Entrée pour saut de ligne</p>
        </div>
      </div>
    </div>
  )
}
