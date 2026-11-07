// @atelier-migrated
'use client'

import { useEffect, useState } from 'react'
import { useFormState } from 'react-dom'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthCenter, AuthError, AuthLink, OtpInput } from '@/components/auth/AuthParts'
import styles from '@/components/auth/Auth.module.css'
import { verifyEmailOtp } from './actions'

const initialState = { error: null as string | null }

export default function VerifyOtpForm({ email }: { email: string; mode?: 'signup' | 'recovery' }) {
  const [state, formAction] = useFormState(verifyEmailOtp, initialState)
  const [code, setCode] = useState('')

  // Un code refusé est effacé : on repart d'une saisie vide.
  useEffect(() => {
    if (state.error) setCode('')
  }, [state])

  return (
    <AuthLayout
      backHref="/login?mode=signup"
      title="Confirmez votre email"
      subtitle={
        <>
          Un code de confirmation a été envoyé à
          <br />
          <b>{email}</b>.
        </>
      }
    >
      <form action={formAction} className={styles.form}>
        <input type="hidden" name="email" value={email} />
        <OtpInput value={code} onChange={setCode} />
        <AuthError>{state.error}</AuthError>
      </form>
      <AuthCenter>
        <AuthLink href="/login?mode=signup" quiet>
          Pas reçu le code ? Recommencer l&apos;inscription
        </AuthLink>
      </AuthCenter>
    </AuthLayout>
  )
}
