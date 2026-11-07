'use client'
// @atelier-migrated

import { useEffect } from 'react'
import * as Sentry from '@sentry/browser'
import { ErrorPage, ErrorTextLink } from '@/components/errors/ErrorPage'
import { ErrorReference, ErrorRetryButton } from '@/components/errors/ErrorActions'
import { errorReference, supportHref } from '@/lib/error-pages'

/**
 * Filet de sécurité pour toute l'app authentifiée : sans lui, une erreur
 * non catchée dans une page (Server ou Client Component) affiche l'écran
 * d'erreur brut de Next — perçu comme "l'app plante". Reste dans le layout
 * (app) (barre de navigation visible), seul le contenu de page est remplacé.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[app-error]', error)
    Sentry.captureException(error)
  }, [error])

  const reference = errorReference(error.digest)
  const support = supportHref(process.env.NEXT_PUBLIC_SUPPORT_EMAIL)

  return (
    <ErrorPage
      symbol="alert"
      code="Erreur technique"
      title="Un pépin technique"
      description="Cette page a eu un contretemps. Vos données sont à l'abri : un nouvel essai règle l'affaire dans la plupart des cas."
      actions={
        <>
          <ErrorRetryButton onRetry={reset} />
          {support && <ErrorTextLink href={support}>Contacter le support</ErrorTextLink>}
        </>
      }
      footer={reference ? <ErrorReference value={reference} /> : undefined}
    />
  )
}
