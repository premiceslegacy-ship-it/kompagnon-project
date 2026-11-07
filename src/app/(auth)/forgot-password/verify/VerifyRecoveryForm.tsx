// @atelier-migrated
'use client'

import { useEffect, useState } from 'react'
import { useFormState } from 'react-dom'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthCenter, AuthError, AuthLink, OtpInput } from '@/components/auth/AuthParts'
import styles from '@/components/auth/Auth.module.css'
import { verifyRecoveryOtp } from './actions'

const initialState = { error: null as string | null }

export default function VerifyRecoveryForm({ email }: { email: string }) {
  const [state, formAction] = useFormState(verifyRecoveryOtp, initialState)
  const [code, setCode] = useState('')

  useEffect(() => {
    if (state.error) setCode('')
  }, [state])

  return (
    <AuthLayout
      backHref="/forgot-password"
      title="Saisissez le code"
      subtitle={
        <>
          Nous venons d&apos;envoyer un code à
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
        <AuthLink href="/forgot-password" quiet>
          Pas reçu le code ? Renvoyer
        </AuthLink>
      </AuthCenter>
    </AuthLayout>
  )
}
