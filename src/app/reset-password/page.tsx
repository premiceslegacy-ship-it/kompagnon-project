// @atelier-migrated
'use client'

import { useState } from 'react'
import { useFormState } from 'react-dom'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthError, AuthFields, AuthSubmit, PasswordField } from '@/components/auth/AuthParts'
import styles from '@/components/auth/Auth.module.css'
import { useHydrated } from '@/components/auth/useHydrated'
import { resetStatus } from '@/lib/auth-ui'
import { resetPassword, type ResetPasswordState } from './actions'

const initialState: ResetPasswordState = { error: null }

export default function ResetPasswordPage() {
  const [state, action] = useFormState(resetPassword, initialState)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const status = resetStatus(password, confirm)
  const hydrated = useHydrated()

  return (
    <AuthLayout title="Nouveau mot de passe" subtitle="Choisissez un mot de passe d'au moins 8 caractères.">
      <form action={action} className={styles.form}>
        <AuthFields>
          <PasswordField label="Nouveau" name="password" required minLength={8} autoFocus autoComplete="new-password" placeholder="8 caractères minimum" value={password} onChange={(event) => setPassword(event.target.value)} />
          <PasswordField label="Confirmer" name="confirm" required minLength={8} autoComplete="new-password" placeholder="••••••••" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
        </AuthFields>
        <AuthError>{status.mismatch ? 'Les deux mots de passe ne sont pas identiques.' : state.error}</AuthError>
        <AuthSubmit pendingLabel="Mise à jour…" disabled={hydrated && !status.canSubmit}>
          Enregistrer
        </AuthSubmit>
      </form>
    </AuthLayout>
  )
}
