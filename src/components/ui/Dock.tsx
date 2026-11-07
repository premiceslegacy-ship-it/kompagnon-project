'use client'

import React, { type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import styles from './Dock.module.css'

export type DockProps = {
  totalLabel: string
  total: ReactNode
  actionLabel: string
  onAction: () => void
  disabled?: boolean
  loading?: boolean
  loadingText?: string
}

export function Dock({
  totalLabel,
  total,
  actionLabel,
  onAction,
  disabled = false,
  loading = false,
  loadingText,
}: DockProps) {
  return (
    <aside className={styles.dock} aria-label="Total et action principale">
      <div className={styles.total} aria-live="polite">
        <span className={styles.totalLabel}>{totalLabel}</span>
        <strong className={styles.totalValue}>{total}</strong>
      </div>
      <Button
        type="button"
        variant="primary"
        size="md"
        className={styles.action}
        onClick={onAction}
        disabled={disabled}
        loading={loading}
        loadingText={loadingText}
      >
        {actionLabel}
      </Button>
    </aside>
  )
}
