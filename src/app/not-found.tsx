// @atelier-migrated
import { ErrorPage, ErrorPrimaryLink } from '@/components/errors/ErrorPage'

export const metadata = { title: 'Page introuvable' }

/** Adresse inconnue, hors de l'app (visiteur sans compte, lien mal recopié). */
export default function NotFound() {
  return (
    <ErrorPage
      full
      symbol="doc"
      code="Erreur 404"
      title="Cette page n'existe pas"
      description="Vérifiez l'adresse, ou revenez à l'accueil. Rien n'a été construit ici."
      actions={<ErrorPrimaryLink href="/">Aller à l&apos;accueil</ErrorPrimaryLink>}
    />
  )
}
