'use client'

import { useSearchParams } from 'next/navigation'
import { Field } from '@/components/ui/Field'
import { AuthLayout } from '@/components/auth/AuthLayout'
import { AuthError, AuthFields, AuthNote, AuthSubmit, PasswordField } from '@/components/auth/AuthParts'
import styles from '@/components/auth/Auth.module.css'
import { INVITE_SETUP_ERRORS, JOB_TITLE_SUGGESTIONS } from '@/lib/auth-ui'
import { completeInviteSetup } from './actions'

type Props = {
  orgName: string
  initialFullName: string | null
  invitationId: string
  requiresPasswordSetup: boolean
}

function InviteSetupForm({ initialFullName, invitationId, requiresPasswordSetup }: Props) {
  const searchParams = useSearchParams()
  const errorKey = searchParams.get('error')
  const errorMsg = errorKey ? INVITE_SETUP_ERRORS[errorKey] : null

  return (
    <form action={completeInviteSetup} className={styles.form}>
      <input type="hidden" name="invitation_id" value={invitationId} />
      <AuthFields>
        <Field type="text" label="Nom" name="full_name" required autoComplete="name" placeholder="Jean Dupont" defaultValue={initialFullName ?? ''} />
        <Field type="text" label="Poste" name="job_title" list="invite-job-titles" placeholder="Ex : Chef de chantier" />
        {requiresPasswordSetup && (
          <PasswordField label="Mot de passe" name="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" />
        )}
      </AuthFields>
      <datalist id="invite-job-titles">
        {JOB_TITLE_SUGGESTIONS.map((title) => (
          <option key={title} value={title} />
        ))}
      </datalist>
      <AuthNote>
        {requiresPasswordSetup
          ? 'Le poste est facultatif. Choisissez un mot de passe d’au moins 8 caractères pour vous reconnecter.'
          : 'Le poste est facultatif. Votre mot de passe existant reste inchangé.'}
      </AuthNote>
      <AuthError>{errorMsg}</AuthError>
      <AuthSubmit pendingLabel="Chargement…">Accéder à mon espace</AuthSubmit>
    </form>
  )
}

export default function InviteSetupClient(props: Props) {
  const subtitle = props.requiresPasswordSetup
    ? `${props.orgName} vous invite à rejoindre son espace. Choisissez votre mot de passe pour commencer.`
    : `${props.orgName} vous invite à rejoindre son espace. Complétez votre profil pour continuer.`

  return (
    <AuthLayout title="Bienvenue dans l'équipe" subtitle={subtitle}>
      <InviteSetupForm {...props} />
    </AuthLayout>
  )
}
