// @atelier-migrated
import { ErrorPage } from '@/components/errors/ErrorPage'
import { AuthNotice } from '@/components/auth/AuthParts'
import RequestAccessForm from './RequestAccessForm'

export default async function RequestAccessPage({
  searchParams: searchParamsPromise,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const searchParams = await searchParamsPromise
  const expired = searchParams.error === 'invalid_token'
  const renewed = searchParams.error === 'expired_renewed'

  return (
    <ErrorPage
      full
      symbol="chain"
      code="Espace intervenant"
      title={expired ? 'Lien expiré ou invalide' : 'Recevoir mon lien d’accès'}
      description={
        renewed
          ? undefined
          : expired
            ? 'Demandez-en un nouveau : saisissez votre email, vous le recevrez dans quelques instants.'
            : 'Saisissez l’adresse email que votre entreprise vous a enregistrée. Vous recevrez un lien d’accès personnel valable 30 jours.'
      }
    >
      {renewed && <AuthNotice tone="success">Votre lien avait expiré : un nouveau vient de vous être envoyé par email. Vérifiez votre boîte de réception.</AuthNotice>}
      <RequestAccessForm />
    </ErrorPage>
  )
}
