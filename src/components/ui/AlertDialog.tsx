'use client'

import * as React from 'react'
import * as AlertDialogPrimitive from '@radix-ui/react-alert-dialog'
import { Button } from './Button'
import styles from './AlertDialog.module.css'

export interface AlertDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
  title: string
  description?: React.ReactNode
  confirmLabel: string
  onConfirm: () => void
  onCancel?: () => void
  cancelLabel?: string
  confirmLoading?: boolean
  confirmDisabled?: boolean
}

export function AlertDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = 'Annuler',
  confirmLoading = false,
  confirmDisabled = false,
}: AlertDialogProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const descriptionId = React.useId()
  const previousFocusRef = React.useRef<HTMLElement | null>(null)

  const handleOpenChange = React.useCallback((nextOpen: boolean) => {
    if (!nextOpen && confirmLoading) return
    onOpenChange(nextOpen)
  }, [confirmLoading, onOpenChange])
  const handleCancel = React.useCallback(() => {
    if (!confirmLoading) onCancel?.()
  }, [confirmLoading, onCancel])

  return (
    <AlertDialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Overlay className={styles.overlay} />
        <AlertDialogPrimitive.Content
          ref={contentRef}
          className={styles.content}
          aria-describedby={description ? descriptionId : undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            const activeElement = document.activeElement
            previousFocusRef.current = activeElement instanceof HTMLElement ? activeElement : null
            const target = confirmLoading ? contentRef.current : cancelRef.current
            target?.focus({ preventScroll: true })
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            const previousFocus = previousFocusRef.current
            previousFocusRef.current = null
            if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
          }}
          onEscapeKeyDown={(event) => {
            if (confirmLoading) event.preventDefault()
            else onCancel?.()
          }}
        >
          <div className={styles.message}>
            <AlertDialogPrimitive.Title className={styles.title}>{title}</AlertDialogPrimitive.Title>
            {description ? <AlertDialogPrimitive.Description id={descriptionId} className={styles.description}>{description}</AlertDialogPrimitive.Description> : null}
          </div>
          <div className={styles.actions}>
            <AlertDialogPrimitive.Cancel asChild>
              <Button
                ref={cancelRef}
                variant="text"
                size="md"
                disabled={confirmLoading}
                onClick={handleCancel}
              >
                {cancelLabel}
              </Button>
            </AlertDialogPrimitive.Cancel>
            <Button
              variant="text"
              size="md"
              loading={confirmLoading}
              disabled={confirmDisabled}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </AlertDialogPrimitive.Content>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}
