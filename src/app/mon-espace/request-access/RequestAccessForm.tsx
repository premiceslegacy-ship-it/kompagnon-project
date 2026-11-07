'use client'
// @atelier-migrated

import { useState } from 'react'
import { Field } from '@/components/ui/Field'
import { Button } from '@/components/ui/Button'
import { AuthError, AuthFields, AuthLinkButton, AuthNotice } from '@/components/auth/AuthParts'
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
      // Réponse neutre (pas de fuite sur l'existence d'une adresse)
      setDone(true)
    }
  }

  if (done) {
    return (
      <div>
        <AuthNotice tone="success">
          Si cette adresse est enregistrée, un nouveau lien vient d&apos;être envoyé. Vérifiez votre boîte de réception, ainsi que les spams.
        </AuthNotice>
        <AuthLinkButton quiet onClick={() => { setDone(false); setEmail('') }}>
          Saisir une autre adresse
        </AuthLinkButton>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit}>
      <AuthFields>
        <Field type="text" inputType="email" label="Email" required autoFocus autoComplete="email" placeholder="vous@exemple.fr" value={email} onChange={(event) => setEmail(event.target.value)} />
      </AuthFields>
      <AuthError>{error}</AuthError>
      <Button type="submit" size="lg" loading={loading} loadingText="Envoi…" aria-disabled={!email.trim() ? true : undefined} style={{ width: '100%', marginTop: 22 }}>
        Recevoir un nouveau lien
      </Button>
    </form>
  )
}
