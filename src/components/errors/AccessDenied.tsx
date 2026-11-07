// @atelier-migrated
import { ErrorPage, ErrorPrimaryLink, ErrorTextLink } from './ErrorPage'

/** Page « accès réservé » : l'écran existe, mais le rôle de la personne ne lui donne pas ce droit. */
export function AccessDenied({ what = 'cette page' }: { what?: string }) {
  return (
    <ErrorPage
      symbol="lock"
      code="Erreur 403"
      title="Accès réservé"
      description={`Votre rôle ne donne pas accès à ${what}. Demandez au propriétaire du compte si vous en avez besoin.`}
      actions={
        <>
          <ErrorPrimaryLink href="/dashboard">Retourner à Aujourd&apos;hui</ErrorPrimaryLink>
          <ErrorTextLink href="/entreprise">Voir les réglages</ErrorTextLink>
        </>
      }
    />
  )
}
