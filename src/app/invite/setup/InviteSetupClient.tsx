// @atelier-migrated
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
}

function InviteSetupForm({ initialFullName }: Pick<Props, 'initialFullName'>) {
  const searchParams = useSearchParams()
  const errorKey = searchParams.get('error')
  const errorMsg = errorKey ? INVITE_SETUP_ERRORS[errorKey] : null

  return (
    <form action={completeInviteSetup} className={styles.form}>
      <AuthFields>
        <Field type="text" label="Nom" name="full_name" required autoComplete="name" placeholder="Jean Dupont" defaultValue={initialFullName ?? ''} />
        <Field type="text" label="Poste" name="job_title" list="invite-job-titles" placeholder="Ex : Chef de chantier" />
        <PasswordField label="Mot de passe" name="password" required minLength={8} autoComplete="new-password" placeholder="••••••••" />
      </AuthFields>
      <datalist id="invite-job-titles">
        {JOB_TITLE_SUGGESTIONS.map((title) => (
          <option key={title} value={title} />
        ))}
      </datalist>
      <AuthNote>Le poste est facultatif. Le mot de passe compte au moins 8 caractères : vous en aurez besoin pour vous reconnecter.</AuthNote>
      <AuthError>{errorMsg}</AuthError>
      <AuthSubmit pendingLabel="Chargement…">Accéder à mon espace</AuthSubmit>
    </form>
  )
}

export default function InviteSetupClient({ orgName, initialFullName }: Props) {
  return (
    <AuthLayout title="Bienvenue dans l'équipe" subtitle={`${orgName} vous invite à rejoindre son espace. Choisissez votre mot de passe pour commencer.`}>
      <InviteSetupForm initialFullName={initialFullName} />
    </AuthLayout>
  )
}
