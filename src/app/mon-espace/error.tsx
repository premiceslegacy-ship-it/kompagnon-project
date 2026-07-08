'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'

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

  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="card max-w-sm w-full p-6 text-center space-y-4">
        <div className="w-12 h-12 mx-auto rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-amber-500" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-primary mb-1">Petit pépin technique</h2>
          <p className="text-sm text-secondary">
            Rien de grave : vérifiez votre connexion et réessayez.
          </p>
        </div>
        <button
          onClick={reset}
          className="w-full px-5 py-2.5 rounded-xl bg-accent text-white font-semibold hover:opacity-90 transition-opacity"
        >
          Réessayer
        </button>
        <p className="text-xs text-secondary">
          Toujours bloqué ?{' '}
          <a href={`mailto:${process.env.NEXT_PUBLIC_SUPPORT_EMAIL}`} className="underline hover:text-primary">
            Contactez le support
          </a>
        </p>
      </div>
    </div>
  )
}
