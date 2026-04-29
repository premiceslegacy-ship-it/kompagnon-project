'use client'

import { useState } from 'react'
import { Bot, Sparkles, Loader2, RefreshCw, X } from 'lucide-react'
import { getWeeklySummary } from '@/lib/data/mutations/ai-summary'
import { cleanMarkdown } from '@/lib/utils'

export default function MaSemaineWidget() {
  const [summary, setSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, setIsPending] = useState(false)

  async function handleGenerate() {
    if (isPending) return
    setError(null)
    setIsPending(true)
    try {
      const res = await getWeeklySummary()
      if (res.error) {
        setError(res.error)
      } else if (!res.summary) {
        setError("L'IA n'a pas retourné de résumé. Réessayez dans un instant.")
      } else {
        setSummary(res.summary)
      }
    } catch (err) {
      console.error('[MaSemaineWidget.handleGenerate]', err)
      setError("Impossible de générer le résumé IA pour le moment.")
    } finally {
      setIsPending(false)
    }
  }

  function handleClose() {
    setSummary(null)
    setError(null)
  }

  return (
    <div className="rounded-3xl p-6 card relative overflow-hidden">
      {/* Glow décoratif */}
      <div className="absolute top-0 right-0 w-48 h-48 -mr-12 -mt-12 pointer-events-none" style={{ background: 'radial-gradient(circle, rgba(181,242,45,0.15) 0%, transparent 65%)' }} />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-bold text-secondary uppercase tracking-wider">Résumé IA</h3>
          </div>
          {summary && (
            <button onClick={handleClose} className="p-1 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-colors">
              <X className="w-4 h-4 text-secondary" />
            </button>
          )}
        </div>

        {!summary && !error && (
          <div className="space-y-3">
            <p className="text-sm text-secondary">
              Chantiers, devis, factures : un résumé en quelques secondes.
            </p>
            <button
              onClick={handleGenerate}
              disabled={isPending}
              className="w-full py-3 rounded-2xl bg-accent text-black font-bold text-sm flex items-center justify-center gap-2 hover:scale-[1.01] active:scale-95 transition-all disabled:opacity-60 disabled:cursor-not-allowed shadow-lg shadow-accent/20"
            >
              {isPending
                ? <><Loader2 className="w-4 h-4 animate-spin" />Analyse en cours...</>
                : <><Sparkles className="w-4 h-4" />Ma semaine</>
              }
            </button>
          </div>
        )}

        {error && (
          <div className="space-y-3">
            <p className="text-sm text-red-500">{error}</p>
            <button
              onClick={handleGenerate}
              disabled={isPending}
              className="text-sm text-accent hover:underline flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />Réessayer
            </button>
          </div>
        )}

        {summary && (
          <div className="space-y-3">
            <p className="text-sm text-primary leading-relaxed whitespace-pre-line">{cleanMarkdown(summary)}</p>
            <button
              onClick={handleGenerate}
              disabled={isPending}
              className="text-xs text-secondary hover:text-accent flex items-center gap-1 transition-colors"
            >
              {isPending
                ? <><Loader2 className="w-3 h-3 animate-spin" />Actualisation...</>
                : <><RefreshCw className="w-3 h-3" />Actualiser</>
              }
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
