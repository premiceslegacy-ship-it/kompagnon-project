// @atelier-migrated
'use client'

import { useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { Field } from '@/components/ui/Field'
import { AuthError, AuthFields, AuthFine, AuthNotice, AuthSubmit, PasswordField, PasswordRule } from '@/components/auth/AuthParts'
import styles from '@/components/auth/Auth.module.css'
import { useHydrated } from '@/components/auth/useHydrated'
import { canSignup, passwordRuleMet } from '@/lib/auth-ui'
import { signup } from '../actions'
import { useAuthSubmit } from './useAuthSubmit'

export default function SignupForm() {
  const searchParams = useSearchParams()
  const { state, pending, submit } = useAuthSubmit(signup, 'Inscription impossible pour le moment. Veuillez réessayer.')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const hydrated = useHydrated()

  return (
    <form method="post" onSubmit={submit} className={styles.form}>
      <input type="hidden" name="intent" value={searchParams.get('intent') === 'trial' ? 'trial' : 'none'} />
      <input type="hidden" name="preferred_tier" value={searchParams.get('preferred') === 'expert' ? 'expert' : 'pro'} />
      <input type="hidden" name="signup_source" value={searchParams.get('source') ?? 'app'} />
      <input type="hidden" name="utm_source" value={searchParams.get('utm_source') ?? ''} />
      <input type="hidden" name="utm_medium" value={searchParams.get('utm_medium') ?? ''} />
      <input type="hidden" name="utm_campaign" value={searchParams.get('utm_campaign') ?? ''} />
      {state.message && <AuthNotice tone="success">{state.message}</AuthNotice>}
      <AuthFields>
        <Field type="text" label="Nom complet" name="full_name" required autoComplete="name" placeholder="Jean Dupont" value={name} onChange={(event) => setName(event.target.value)} />
        <Field type="text" inputType="email" label="Email" name="email" required autoComplete="email" placeholder="vous@entreprise.fr" value={email} onChange={(event) => setEmail(event.target.value)} />
        <PasswordField label="Mot de passe" name="password" required autoComplete="new-password" placeholder="8 caractères minimum" value={password} onChange={(event) => setPassword(event.target.value)} />
      </AuthFields>
      <PasswordRule met={passwordRuleMet(password)}>8 caractères minimum</PasswordRule>
      <AuthError>{state.error}</AuthError>
      <AuthSubmit pending={pending} pendingLabel="Création…" disabled={hydrated && !canSignup({ name, email, password })}>
        Créer mon compte
      </AuthSubmit>
      <AuthFine>En continuant, vous acceptez les Conditions d&apos;utilisation et la Politique de confidentialité.</AuthFine>
    </form>
  )
}
