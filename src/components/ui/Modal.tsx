'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  footer?: React.ReactNode
  children: React.ReactNode
  /** Si false, ni Escape ni le clic sur l'overlay ne ferment la modale. */
  dismissible?: boolean
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:!min-w-[420px] sm:!max-w-sm',
  md: '',
  lg: 'sm:!min-w-[640px] sm:!max-w-2xl',
  xl: 'sm:!min-w-[720px] sm:!max-w-4xl',
}

/** Modale historique : panneau mobile et fenêtre centrée sur grand écran. */
export function Modal({ open, onClose, title, subtitle, size = 'md', footer, children, dismissible = true }: ModalProps) {
  const titleId = React.useId()
  const subtitleId = React.useId()

  React.useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, dismissible, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div
      data-atelier-modal-layer=""
      className="fixed inset-0 z-[9980] flex items-end justify-center bg-[var(--at-voile)] p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col overflow-y-auto rounded-t-[var(--at-rayon-feuille)] border border-trait bg-carte p-4 pb-6 pt-5 text-encre shadow-[var(--at-ombre-alerte)] animate-in fade-in duration-[var(--at-duree-sortie)] sm:max-h-[90vh] sm:w-auto sm:min-w-[480px] sm:max-w-2xl sm:rounded-[var(--at-rayon-feuille)] sm:p-8',
          SIZE_CLASS[size]
        )}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitle ? subtitleId : undefined}
      >
        <div className="mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-encre-3 sm:hidden" aria-hidden="true" />

        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="truncate text-titre-ligne font-bold text-encre">{title}</h2>
            {subtitle ? <p id={subtitleId} className="mt-0.5 text-note text-encre-2">{subtitle}</p> : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              onClick={onClose}
              className="relative grid size-11 shrink-0 place-items-center rounded-full bg-transparent text-encre-2 transition-colors hover:bg-remplissage focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-texte"
              aria-label="Fermer"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>

        {footer ? <div className="mt-5 flex flex-col-reverse gap-2 border-t border-trait pt-4 sm:flex-row sm:justify-end">{footer}</div> : null}
      </div>
    </div>,
    document.body
  )
}
