'use client'

import { useEffect, useState, useTransition } from 'react'
import { CheckCircle2, KeyRound, Loader2, Trash2 } from 'lucide-react'
import {
  getAICredentialsState,
  saveOpenRouterKey,
  removeOpenRouterKey,
  type AICredentialsState,
} from '@/lib/data/mutations/ai-credentials'

// N'affiche jamais la clé une fois enregistrée (write-only) : seule sa
// présence est connue côté client. La clé déchiffrée ne quitte jamais le
// serveur — voir src/lib/ai/openrouter-credentials.ts.
export default function OpenRouterKeyTab() {
  const [state, setState] = useState<AICredentialsState | null>(null)
  const [keyInput, setKeyInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  useEffect(() => {
    getAICredentialsState().then(setState)
  }, [])

  if (!state || state.aiBillingMode !== 'client_owned') return null

  function handleSave(formData: FormData) {
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      const result = await saveOpenRouterKey(formData)
      if (result.error) {
        setError(result.error)
        return
      }
      setKeyInput('')
      setSuccess(true)
      setState((prev) => (prev ? { ...prev, hasOwnKey: true } : prev))
    })
  }

  function handleRemove() {
    setError(null)
    setSuccess(false)
    startTransition(async () => {
      const result = await removeOpenRouterKey()
      if (result.error) {
        setError(result.error)
        return
      }
      setState((prev) => (prev ? { ...prev, hasOwnKey: false } : prev))
    })
  }

  return (
    <section className="rounded-2xl border border-[var(--elevation-border)] bg-surface dark:bg-white/5 p-5 space-y-4">
      <div className="flex items-center gap-3">
        <KeyRound className="h-5 w-5 text-secondary" />
        <div>
          <p className="font-semibold text-primary">Clé OpenRouter</p>
          <p className="text-sm text-secondary">
            Votre offre utilise votre propre clé OpenRouter pour l&apos;IA, pas la clé partagée Atelier.
          </p>
        </div>
      </div>

      {state.hasOwnKey ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 dark:border-emerald-500/30 dark:bg-emerald-500/10">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm text-emerald-800 dark:text-emerald-200">Clé enregistrée et active.</p>
          </div>
          <button
            onClick={handleRemove}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50 dark:text-red-400"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Retirer
          </button>
        </div>
      ) : (
        <form action={handleSave} className="space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-secondary">Clé OpenRouter (sk-or-...)</span>
            <input
              name="openrouterKey"
              type="password"
              autoComplete="off"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-or-v1-..."
              className="w-full input-glass px-3 py-2 text-sm text-primary outline-none"
            />
          </label>
          <button
            type="submit"
            disabled={isPending || !keyInput}
            className="inline-flex items-center gap-2 rounded-xl bg-accent px-4 py-2.5 text-sm font-semibold text-black hover:opacity-90 disabled:opacity-50"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Enregistrer la clé
          </button>
        </form>
      )}

      {success && <p className="text-sm text-emerald-600 dark:text-emerald-400">Clé enregistrée.</p>}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </section>
  )
}
