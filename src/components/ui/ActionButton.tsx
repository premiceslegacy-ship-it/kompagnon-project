'use client'

import * as React from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ActionButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * Force l'etat occupe (spinner + desactivation). Si non fourni, le bouton
   * detecte automatiquement un onClick asynchrone (qui retourne une Promise)
   * et reste occupe jusqu'a sa resolution. Empeche le double-clic.
   */
  loading?: boolean
  /** Texte optionnel affiche a la place des enfants pendant le chargement. */
  loadingText?: string
}

/**
 * Bouton d'action avec retour visuel immediat sur les operations asynchrones.
 *
 * Conserve l'apparence existante : on passe les memes classes CSS
 * (btn-primary, btn-secondary, btn-danger, btn-icon, ...) via `className`.
 * La seule difference est l'affichage d'un spinner et le blocage du
 * double-clic pendant que l'action se termine.
 */
export const ActionButton = React.forwardRef<HTMLButtonElement, ActionButtonProps>(
  (
    { className, loading, loadingText, children, disabled, onClick, type, ...props },
    ref
  ) => {
    const [autoPending, setAutoPending] = React.useState(false)
    const mounted = React.useRef(true)
    React.useEffect(() => {
      mounted.current = true
      return () => {
        mounted.current = false
      }
    }, [])

    const isLoading = loading ?? autoPending

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        if (!onClick) return
        // Etat pilote manuellement : on ne touche pas a l'auto-pending.
        if (loading !== undefined) {
          onClick(e)
          return
        }
        const result = onClick(e) as unknown
        if (result && typeof (result as Promise<unknown>).then === 'function') {
          setAutoPending(true)
          Promise.resolve(result).finally(() => {
            if (mounted.current) setAutoPending(false)
          })
        }
      },
      [onClick, loading]
    )

    return (
      <button
        ref={ref}
        type={type ?? 'button'}
        className={cn('relative', className)}
        disabled={disabled || isLoading}
        aria-busy={isLoading || undefined}
        onClick={onClick ? handleClick : undefined}
        {...props}
      >
        {isLoading && (
          <Loader2
            className="absolute left-1/2 top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 animate-spin"
            aria-hidden="true"
          />
        )}
        <span
          className={cn(
            'inline-flex items-center justify-center gap-2',
            isLoading && !loadingText && 'invisible'
          )}
        >
          {isLoading && loadingText ? loadingText : children}
        </span>
      </button>
    )
  }
)
ActionButton.displayName = 'ActionButton'
