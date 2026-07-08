'use client'

import { useEffect } from 'react'
import { AlertTriangle } from 'lucide-react'
import * as Sentry from '@sentry/nextjs'

/**
 * Filet de sécurité pour toute l'app authentifiée : sans lui, une erreur
 * non catchée dans une page (Server ou Client Component) affiche l'écran
 * d'erreur brut de Next — perçu comme "l'app plante". Reste dans le layout
 * (app) (sidebar/topbar visibles), seul le contenu de page est remplacé.
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

  return (
    <div className="flex-1 flex items-center justify-center p-8 min-h-[60vh]">
      <div className="card max-w-md w-full p-8 text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-500/10 flex items-center justify-center">
          <AlertTriangle className="w-7 h-7 text-amber-500" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-primary mb-1">Petit pépin technique</h2>
          <p className="text-sm text-secondary">
            Rien de grave : cette page vient de rencontrer un imprévu. Un simple clic sur Réessayer suffit en général.
          </p>
        </div>
        <button
          onClick={reset}
          className="px-5 py-2.5 rounded-xl bg-accent text-white font-semibold hover:opacity-90 transition-opacity"
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
