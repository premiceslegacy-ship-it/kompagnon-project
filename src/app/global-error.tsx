'use client'
// @atelier-migrated

import { useEffect } from 'react'
import * as Sentry from '@sentry/browser'
import { ErrorPage, ErrorTextLink } from '@/components/errors/ErrorPage'
import { ErrorReference, ErrorRetryButton } from '@/components/errors/ErrorActions'
import { errorReference, supportHref } from '@/lib/error-pages'

/**
 * Filet de sécurité racine : capte les erreurs qui échappent à tous les
 * error.tsx de segment (y compris une erreur dans le root layout lui-même).
 * Doit fournir son propre <html>/<body> car il remplace le layout racine
 * pendant l'affichage de l'erreur : les rôles de couleur Atelier peuvent être
 * absents, la page retombe alors sur les couleurs du navigateur.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[global-error]', error)
    Sentry.captureException(error)
  }, [error])

  const reference = errorReference(error.digest)
  const support = supportHref(process.env.NEXT_PUBLIC_SUPPORT_EMAIL)

  return (
    <html lang="fr">
      <body style={{ margin: 0 }}>
        <ErrorPage
          full
          symbol="alert"
          code="Erreur technique"
          title="Atelier fait une pause"
          description="Un imprévu a interrompu l'affichage. Vos données sont à l'abri. Rechargez pour reprendre là où vous en étiez."
          actions={
            <>
              <ErrorRetryButton onRetry={reset} />
              {support && <ErrorTextLink href={support}>Contacter le support</ErrorTextLink>}
            </>
          }
          footer={reference ? <ErrorReference value={reference} /> : undefined}
        />
      </body>
    </html>
  )
}
