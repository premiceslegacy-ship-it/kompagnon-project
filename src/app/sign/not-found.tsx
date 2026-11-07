// @atelier-migrated
import { ErrorPage } from '@/components/errors/ErrorPage'

export const metadata = { title: 'Lien indisponible' }

/** Lien de signature de devis expiré ou invalide (`notFound()` de sign/[token]). */
export default function SignLinkUnavailable() {
  return (
    <ErrorPage
      full
      symbol="chain"
      code="Lien indisponible"
      title="Ce lien a fait son temps"
      description="Pour votre sécurité, un lien de signature ne reste valable que quelques jours. Demandez à l'entreprise qui vous l'a envoyé de vous en renvoyer un."
    />
  )
}
