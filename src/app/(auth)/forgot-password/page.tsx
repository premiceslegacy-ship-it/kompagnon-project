// @atelier-migrated
'use client'

import { useFormState } from 'react-dom'
import { Field } from '@/components/ui/Field'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthCenter, AuthError, AuthFields, AuthLink, AuthSubmit, AuthSuccessMark } from '@/components/auth/AuthParts'
import styles from '@/components/auth/Auth.module.css'
import { forgotPassword, type ForgotPasswordState } from './actions'

const initialState: ForgotPasswordState = { error: null, success: false }

export default function ForgotPasswordPage() {
  const [state, action] = useFormState(forgotPassword, initialState)

  if (state.success) {
    return (
      <AuthLayout
        title="Vérifiez votre boîte mail"
        subtitle="Si un compte existe pour cette adresse, vous recevrez un code dans quelques minutes. Vérifiez également vos spams."
      >
        <AuthSuccessMark />
        <AuthCenter>
          <AuthLink href="/login">Retour à la connexion</AuthLink>
        </AuthCenter>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      backHref="/login"
      backLabel="Connexion"
      title="Mot de passe oublié"
      subtitle="Entrez votre adresse email, nous vous envoyons un code pour choisir un nouveau mot de passe."
    >
      <form action={action} className={styles.form}>
        <AuthFields>
          <Field type="text" inputType="email" label="Email" name="email" required autoFocus autoComplete="email" placeholder="vous@entreprise.fr" />
        </AuthFields>
        <AuthError>{state.error}</AuthError>
        <AuthSubmit pendingLabel="Envoi en cours…">Envoyer le code</AuthSubmit>
      </form>
    </AuthLayout>
  )
}
