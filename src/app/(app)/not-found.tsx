// @atelier-migrated
import { ErrorPage, ErrorPrimaryLink, ErrorTextLink } from '@/components/errors/ErrorPage'

export const metadata = { title: 'Page introuvable' }

/** Fiche chantier, client ou devis introuvable (`notFound()`), dans l'app : la navigation reste visible. */
export default function AppNotFound() {
  return (
    <ErrorPage
      symbol="doc"
      code="Erreur 404"
      title="Cette page n'est pas aux plans"
      description="Le lien est peut-être ancien, ou la page a été déplacée. Vos devis, factures et chantiers sont intacts."
      actions={
        <>
          <ErrorPrimaryLink href="/dashboard">Retourner à Aujourd&apos;hui</ErrorPrimaryLink>
          <ErrorTextLink href="/finances">Voir les documents</ErrorTextLink>
        </>
      }
    />
  )
}
