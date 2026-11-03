import type { ReactNode } from 'react'
import styles from './StatusPill.module.css'

export type StatusPillStatus = 'wait' | 'success' | 'danger' | 'neutral'

type StatusPillProps = {
  status: StatusPillStatus
  children: ReactNode
  className?: string
}

/** A compact, non-interactive semantic status label. */
export function StatusPill({ status, children, className }: StatusPillProps) {
  const classNames = className ? `${styles.pill} ${className}` : styles.pill

  return (
    <span className={classNames} data-status={status}>
      {children}
    </span>
  )
}
