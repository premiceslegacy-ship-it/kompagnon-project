'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { Button } from './Button'
import styles from './Hud.module.css'

const SUCCESS_DURATION_MS = 4_000
const MODAL_LAYERS = 'body > [role="dialog"], body > [role="alertdialog"], body > [data-atelier-modal-layer], body > [data-radix-popper-content-wrapper] > [role="menu"]'
const HIDDEN_STYLE = { visibility: 'hidden' } as const
const noLayer = () => false
const unsubscribe = () => {}
const noSubscription = () => unsubscribe

function hasModalLayer(): boolean {
  return document.querySelector(MODAL_LAYERS) !== null
}

function subscribeToModalLayers(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange)
  observer.observe(document.body, { childList: true })
  return () => observer.disconnect()
}

type HudBaseProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  message: string
}

export type HudVariant = 'success' | 'error'

export type HudProps = HudBaseProps &
  (
    | {
        variant?: 'success'
        onUndo?: () => void
        onRetry?: never
      }
    | {
        variant: 'error'
        onRetry: () => void
        retrying?: boolean
        onUndo?: never
      }
  )

/**
 * Keep mounted from the closed state, at page level outside modal or transformed ancestors.
 * Persistent live channels announce admitted messages; the visual panel keeps its undo budget.
 */
export function Hud(props: HudProps) {
  const { open, onOpenChange, message } = props
  const variant = props.variant ?? 'success'
  const successRegionId = useId()
  const errorRegionId = useId()
  const announcementId = variant === 'error' ? errorRegionId : successRegionId
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const deadline = useRef<number | null>(null)
  const remaining = useRef(SUCCESS_DURATION_MS)
  const hovered = useRef(false)
  const focused = useRef(false)
  const suspended = useRef(false)
  const modalLayerPresent = useSyncExternalStore(
    open ? subscribeToModalLayers : noSubscription,
    open ? hasModalLayer : noLayer,
    noLayer,
  )
  const onOpenChangeRef = useRef(onOpenChange)
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange
  }, [onOpenChange])

  const clearTimer = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
    deadline.current = null
  }, [])

  const startTimer = useCallback(() => {
    if (timer.current !== null || suspended.current || hovered.current || focused.current || remaining.current <= 0) return
    deadline.current = Date.now() + remaining.current
    timer.current = setTimeout(() => {
      timer.current = null
      deadline.current = null
      remaining.current = 0
      onOpenChangeRef.current(false)
    }, remaining.current)
  }, [])
  useLayoutEffect(() => {
    if (!open) return
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null
    return () => {
      if (!focused.current || !origin?.isConnected || hasModalLayer()) return
      remaining.current = 0
      focused.current = false
      origin.focus({ preventScroll: true })
    }
  }, [open])

  useLayoutEffect(() => {
    suspended.current = modalLayerPresent
    if (modalLayerPresent) {
      hovered.current = false
      focused.current = false
      if (timer.current !== null && deadline.current !== null) {
        remaining.current = Math.max(0, deadline.current - Date.now())
        // An already-due timer must still deliver its one expiry notification.
        if (remaining.current > 0) clearTimer()
      }
    } else if (open && variant !== 'error') {
      startTimer()
    }
  }, [clearTimer, modalLayerPresent, open, startTimer, variant])

  useEffect(() => {
    if (!open) {
      clearTimer()
      remaining.current = SUCCESS_DURATION_MS
      hovered.current = false
      focused.current = false
      return
    }

    if (variant === 'error') {
      clearTimer()
      return
    }

    remaining.current = SUCCESS_DURATION_MS
    startTimer()

    return clearTimer
  }, [clearTimer, open, startTimer, variant])

  const pause = (reason: 'hover' | 'focus') => {
    const alreadyPaused = reason === 'hover' ? hovered.current : focused.current
    if (!open || alreadyPaused) return
    if (reason === 'hover') hovered.current = true
    else focused.current = true
    if (variant === 'error') return
    if (timer.current !== null && deadline.current !== null) {
      remaining.current = Math.max(0, deadline.current - Date.now())
      clearTimer()
    }
  }

  const resume = (reason: 'hover' | 'focus') => {
    if (reason === 'hover') hovered.current = false
    else focused.current = false
    if (open && variant !== 'error' && !hovered.current && !focused.current) startTimer()
  }

  const closeAfterUndo = () => {
    clearTimer()
    remaining.current = 0
    onOpenChange(false)
    if (props.variant !== 'error') props.onUndo?.()
  }

  const panel = open ? (
    <div
      className={styles.root}
      style={modalLayerPresent ? HIDDEN_STYLE : undefined}
      onMouseEnter={() => pause('hover')}
      onMouseLeave={() => resume('hover')}
      onFocusCapture={() => pause('focus')}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resume('focus')
      }}
    >
      {variant === 'success' ? (
        <svg className={styles.icon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
          <path d="m4 10.5 4 4 8-9" />
        </svg>
      ) : null}
      <span className={styles.message} aria-hidden="true">{message}</span>
      {props.variant === 'error' ? (
        <Button
          size="sm"
          variant="text"
          onClick={props.onRetry}
          aria-describedby={announcementId}
          loading={props.retrying}
          loadingText="Nouvel essai…"
        >
          Réessayer
        </Button>
      ) : props.onUndo ? (
        <Button size="sm" variant="text" aria-describedby={announcementId} onClick={closeAfterUndo}>
          Annuler
        </Button>
      ) : null}
    </div>
  ) : null

  return (
    <>
      <div id={successRegionId} className={styles.region} role="status" aria-live="polite" aria-atomic="true">
        {open && !modalLayerPresent && variant === 'success' ? message : null}
      </div>
      <div id={errorRegionId} className={styles.region} role="alert" aria-live="assertive" aria-atomic="true">
        {open && !modalLayerPresent && variant === 'error' ? message : null}
      </div>
      {panel}
    </>
  )
}
