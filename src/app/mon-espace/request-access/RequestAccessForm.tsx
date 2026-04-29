'use client'

import { useState } from 'react'
import { Loader2, Mail, Check } from 'lucide-react'
import { requestMemberSpaceAccess } from '@/lib/data/mutations/members'

export default function RequestAccessForm() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError(null)
    const { error: err } = await requestMemberSpaceAccess(email)
    setLoading(false)
    if (err) {
      setError(err)
    } else {
      // Réponse neutre (pas de leak d'existence d'email)
      setDone(true)
    }
  }

  if (done) {
    return (
      <div className="space-y-3 text-center py-4">
        <div className="w-12 h-12 mx-auto rounded-full bg-emerald-500/15 text-emerald-500 flex items-center justify-center">
          <Check className="w-6 h-6" />
        </div>
        <p className="text-sm text-primary font-semibold">Si cette adresse est enregistrée, un lien vient d&apos;être envoyé.</p>
        <p className="text-xs text-secondary">Vérifiez votre boîte de réception (ainsi que les spams).</p>
        <button
          onClick={() => { setDone(false); setEmail('') }}
          className="text-xs text-accent hover:underline"
        >
          Saisir une autre adresse
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="relative">
        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none" />
        <input
          type="email"
          required
          autoFocus
          className="input w-full pl-10"
          placeholder="vous@exemple.fr"
          value={email}
          onChange={e => setEmail(e.target.value)}
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        type="submit"
        disabled={loading || !email.trim()}
        className="btn-primary w-full flex items-center justify-center gap-2 disabled:opacity-60"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
        {loading ? 'Envoi…' : "M'envoyer un lien"}
      </button>
    </form>
  )
}
