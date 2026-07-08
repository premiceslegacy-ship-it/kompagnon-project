'use client'

import { useEffect } from 'react'
import * as Sentry from '@sentry/nextjs'
import { APP_NAME } from '@/lib/brand'

/**
 * Filet de sécurité racine : capte les erreurs qui échappent à tous les
 * error.tsx de segment (y compris une erreur dans le root layout lui-même).
 * Doit fournir son propre <html>/<body> car il remplace le layout racine
 * pendant l'affichage de l'erreur.
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

  return (
    <html lang="fr">
      <body>
        <div className="min-h-screen flex items-center justify-center p-8 bg-white text-gray-900">
          <div className="max-w-md w-full text-center space-y-4">
            <h1 className="text-2xl font-bold">Petit pépin technique</h1>
            <p className="text-gray-600">
              Rien de grave : {APP_NAME} vient de rencontrer un imprévu. Un simple clic sur Réessayer suffit en général.
            </p>
            <button
              onClick={reset}
              className="px-5 py-2.5 rounded-xl bg-gray-900 text-white font-semibold hover:bg-gray-700 transition-colors"
            >
              Réessayer
            </button>
            <p className="text-sm text-gray-400">
              Toujours bloqué ?{' '}
              <a href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL}`} className="underline hover:text-gray-600">
                Contactez le support
              </a>
            </p>
          </div>
        </div>
      </body>
    </html>
  )
}
