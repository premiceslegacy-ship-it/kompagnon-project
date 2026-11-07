// @atelier-migrated
import { ErrorPage } from '@/components/errors/ErrorPage'

export const metadata = { title: 'Contrat indisponible' }

/** Lien de signature de contrat expiré, invalide ou contrat archivé (`notFound()` de contrats/signer/[token]). */
export default function ContractLinkUnavailable() {
  return (
    <ErrorPage
      full
      symbol="chain"
      code="Lien indisponible"
      title="Contrat indisponible"
      description="Ce lien n'est plus valable : le contrat est archivé ou le lien a expiré. Contactez l'entreprise qui vous l'a envoyé pour en obtenir un nouveau."
    />
  )
}
