// @atelier-migrated
'use client'

import { Field } from '@/components/ui/Field'
import { AuthAside, AuthError, AuthFields, AuthLink, AuthSubmit, PasswordField } from '@/components/auth/AuthParts'
import styles from '@/components/auth/Auth.module.css'
import { login } from '../actions'
import { useAuthSubmit } from './useAuthSubmit'

export default function LoginForm() {
  const { state, pending, submit } = useAuthSubmit(login, 'Connexion impossible pour le moment. Veuillez réessayer.')
  return (
    <form method="post" onSubmit={submit} className={styles.form}>
      <AuthFields>
        <Field type="text" inputType="email" label="Email" name="email" required autoComplete="email" placeholder="vous@entreprise.fr" />
        <PasswordField label="Mot de passe" name="password" required autoComplete="current-password" placeholder="••••••••" />
      </AuthFields>
      <AuthError>{state.error}</AuthError>
      <AuthAside>
        <AuthLink href="/forgot-password" quiet>
          Mot de passe oublié ?
        </AuthLink>
      </AuthAside>
      <AuthSubmit pending={pending} pendingLabel="Connexion…">
        Se connecter
      </AuthSubmit>
    </form>
  )
}
