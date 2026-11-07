'use client'

import * as React from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Button } from './Button'
import styles from './Sheet.module.css'

const SheetDepthContext = React.createContext(0)

/** Returns the number of open Sheet ancestors surrounding the current component. */
export function useSheetDepth(): number {
  return React.useContext(SheetDepthContext)
}

export interface SheetProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  children: React.ReactNode
  description?: string
  onCancel?: () => void
  /** Libellé du bouton de gauche ; « Fermer » quand les changements sont déjà appliqués. */
  cancelLabel?: string
  onConfirm?: () => void
  confirmLabel?: string
  confirmLoading?: boolean
  confirmDisabled?: boolean
  dismissible?: boolean
  className?: string
  onAfterClose?: () => void
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  height: number
  lastY: number
  lastTime: number
  lastVelocity: number
}

const DRAG_ESCAPE_HORIZONTAL_PX = 8
const FAST_DRAG_MIN_DISTANCE_PX = 16
const FAST_DRAG_VELOCITY_PX_PER_MS = 0.5
const FAST_DRAG_STALE_AFTER_MS = 80
const DRAG_RETURN_RATIO = 0.25
const DRAG_RETURN_MAX_PX = 160

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  description,
  onCancel,
  cancelLabel = 'Annuler',
  onConfirm,
  confirmLabel = 'OK',
  confirmLoading = false,
  confirmDisabled = false,
  dismissible = true,
  className,
  onAfterClose,
}: SheetProps) {
  const depth = useSheetDepth()
  const panelRef = React.useRef<HTMLDivElement>(null)
  const descriptionId = React.useId()
  const previousFocusRef = React.useRef<HTMLElement | null>(null)
  const dragRef = React.useRef<DragState | null>(null)

  if (open && depth >= 2) {
    throw new Error('Sheet accepte au maximum deux niveaux ouverts.')
  }

  const requestDismiss = React.useCallback(() => {
    try {
      onCancel?.()
    } finally {
      onOpenChange(false)
      if (typeof window.requestAnimationFrame === 'function') {
        window.requestAnimationFrame(() => {
          const panel = panelRef.current
          if (panel?.isConnected && panel.getAttribute('data-state') === 'open') {
            panel.style.setProperty('--sheet-drag-y', '0px')
          }
        })
      }
    }
  }, [onCancel, onOpenChange])

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (nextOpen) {
      onOpenChange(true)
      return
    }
    if (dismissible) requestDismiss()
  }, [dismissible, onOpenChange, requestDismiss])

  const handleOpenAutoFocus = React.useCallback((_event: Event) => {
    const activeElement = document.activeElement
    previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
    panelRef.current?.style.setProperty('--sheet-drag-y', '0px')
    panelRef.current?.removeAttribute('data-dragging')
  }, [])

  const handleCloseAutoFocus = React.useCallback((event: Event) => {
    event.preventDefault()
    const previousFocus = previousFocusRef.current
    previousFocusRef.current = null
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    onAfterClose?.()
  }, [onAfterClose])

  const handlePointerDown = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (window.innerWidth >= 900 || !dismissible || !event.isPrimary || event.button !== 0) return
    if (event.target instanceof Element && event.target.closest('button, a, input, select, textarea, [role="button"], [data-sheet-no-drag]')) return

    const panel = panelRef.current
    if (!panel) return
    const bounds = panel.getBoundingClientRect()
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      height: bounds.height || window.innerHeight,
      lastY: 0,
      lastTime: event.timeStamp,
      lastVelocity: 0,
    }
    panel.setAttribute('data-dragging', 'true')
    if (typeof event.currentTarget.setPointerCapture === 'function') event.currentTarget.setPointerCapture(event.pointerId)
  }, [dismissible])

  const handlePointerMove = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const panel = panelRef.current
    if (!drag || !panel || event.pointerId !== drag.pointerId) return

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (Math.abs(dx) >= DRAG_ESCAPE_HORIZONTAL_PX && Math.abs(dx) > Math.abs(dy)) {
      dragRef.current = null
      panel.removeAttribute('data-dragging')
      panel.style.setProperty('--sheet-drag-y', '0px')
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
      return
    }

    const now = event.timeStamp
    const elapsed = now - drag.lastTime
    if (elapsed > 0) drag.lastVelocity = (dy - drag.lastY) / elapsed
    drag.lastY = dy
    drag.lastTime = now
    panel.style.setProperty('--sheet-drag-y', `${Math.max(0, dy)}px`)
    if (dy > 0) event.preventDefault()
  }, [])

  const finishDrag = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const panel = panelRef.current
    if (!drag || !panel || event.pointerId !== drag.pointerId) return

    dragRef.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    panel.removeAttribute('data-dragging')

    const dy = Math.max(0, event.clientY - drag.startY)
    const lastMoveAge = event.timeStamp - drag.lastTime
    const velocity = lastMoveAge <= FAST_DRAG_STALE_AFTER_MS ? drag.lastVelocity : 0
    const distanceThreshold = Math.min(drag.height * DRAG_RETURN_RATIO, DRAG_RETURN_MAX_PX)
    const shouldDismiss = dy >= distanceThreshold || (velocity > FAST_DRAG_VELOCITY_PX_PER_MS && dy >= FAST_DRAG_MIN_DISTANCE_PX)

    if (shouldDismiss) {
      requestDismiss()
    } else {
      panel.style.setProperty('--sheet-drag-y', '0px')
    }
  }, [requestDismiss])

  const handlePointerCancel = React.useCallback((event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current
    const panel = panelRef.current
    if (!drag || !panel || event.pointerId !== drag.pointerId) return
    dragRef.current = null
    panel.removeAttribute('data-dragging')
    panel.style.setProperty('--sheet-drag-y', '0px')
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} style={{ zIndex: 60 + depth * 2 }} />
        <Dialog.Content
          ref={panelRef}
          className={`${styles.panel}${className ? ` ${className}` : ''}`}
          style={{ zIndex: 61 + depth * 2 }}
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={handleOpenAutoFocus}
          onCloseAutoFocus={handleCloseAutoFocus}
          onEscapeKeyDown={(event) => {
            if (!dismissible) event.preventDefault()
          }}
          onPointerDownOutside={(event) => {
            if (!dismissible) event.preventDefault()
          }}
        >
          <SheetDepthContext.Provider value={depth + 1}>
            <header
              className={styles.header}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={finishDrag}
              onPointerCancel={handlePointerCancel}
            >
              <span className={styles.handle} aria-hidden="true" />
              <Button className={styles.headerAction} variant="text" size="md" onClick={requestDismiss}>
                {cancelLabel}
              </Button>
              <div className={styles.heading}>
                <Dialog.Title className={styles.title}>{title}</Dialog.Title>
                {description ? <Dialog.Description id={descriptionId} className={styles.description}>{description}</Dialog.Description> : null}
              </div>
              {onConfirm ? (
                <Button
                  className={styles.headerAction}
                  variant="text"
                  size="md"
                  loading={confirmLoading}
                  disabled={confirmDisabled}
                  onClick={onConfirm}
                >
                  {confirmLabel}
                </Button>
              ) : <span aria-hidden="true" />}
            </header>
            <div className={styles.body} data-sheet-scrollable>
              {children}
            </div>
          </SheetDepthContext.Provider>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
