'use client'

import * as React from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:!min-w-[420px] sm:!max-w-sm',
  md: '',
  lg: 'sm:!min-w-[640px] sm:!max-w-2xl',
  xl: 'sm:!min-w-[720px] sm:!max-w-4xl',
}

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

/**
 * Modale partagée : bottom-sheet plein écran sur mobile, panneau centré à
 * partir de sm: (classes .modal-overlay/.modal-panel de globals.css).
 * Remplace le pattern copié-collé <div className="modal-overlay">...
 * répété dans ~48 endroits du code.
 */
export function Modal({ open, onClose, title, subtitle, size = 'md', footer, children, dismissible = true }: ModalProps) {
  const panelRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, dismissible, onClose])

  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (dismissible && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={panelRef}
        className={cn('modal-panel animate-in fade-in duration-200 flex flex-col', SIZE_CLASS[size])}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-title"
      >
        {/* Poignée de drag, cosmétique — signale le bottom-sheet sur mobile */}
        <div className="sm:hidden mx-auto -mt-1 mb-3 h-1 w-10 rounded-full bg-interactive" aria-hidden="true" />

        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="min-w-0">
            <h2 id="modal-title" className="text-lg font-bold text-primary truncate">{title}</h2>
            {subtitle && <p className="text-sm text-secondary mt-0.5">{subtitle}</p>}
          </div>
          {dismissible && (
            <button
              onClick={onClose}
              className="btn-icon !w-9 !h-9 shrink-0"
              aria-label="Fermer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto min-h-0">
          {children}
        </div>

        {footer && (
          <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 mt-5 pt-4 border-t border-black/10 dark:border-white/10">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
