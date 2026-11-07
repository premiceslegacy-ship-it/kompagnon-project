'use client'
// @atelier-migrated

import { useEffect } from 'react'
import * as Sentry from '@sentry/browser'
import { ErrorPage, ErrorTextLink } from '@/components/errors/ErrorPage'
import { ErrorRetryButton } from '@/components/errors/ErrorActions'
import { supportHref } from '@/lib/error-pages'

/**
 * Filet de sécurité pour l'espace membre (intervenants terrain, souvent sur
 * mobile avec connexion instable) : message humain + retry plutôt que l'écran
 * d'erreur Next brut.
 */
export default function MemberSpaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error('[mon-espace-error]', error)
    Sentry.captureException(error)
  }, [error])

  const support = supportHref(process.env.NEXT_PUBLIC_SUPPORT_EMAIL)

  return (
    <ErrorPage
      full
      symbol="wifi"
      code="Espace intervenant"
      title="Le réseau a lâché le chantier"
      description="Les sous-sols et les grands hangars n'aiment pas le réseau. Vérifiez votre connexion, puis réessayez."
      actions={
        <>
          <ErrorRetryButton onRetry={reset} />
          {support && <ErrorTextLink href={support}>Contacter le support</ErrorTextLink>}
        </>
      }
    />
  )
}
