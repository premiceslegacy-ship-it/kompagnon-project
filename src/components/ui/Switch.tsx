'use client'

import { useId } from 'react'
import styles from './Switch.module.css'

type SwitchProps = {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
  id?: string
  loading?: boolean
  error?: string
}

/** Interrupteur style Atelier, accessible (role=switch), pour les réglages binaires. */
export function Switch({ checked, onChange, disabled = false, label, id, loading = false, error }: SwitchProps) {
  const errorId = useId()
  const isDisabled = disabled || loading

  return (
    <span className={styles.root}>
      <button
        type="button"
        id={id}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        aria-busy={loading || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={isDisabled}
        onClick={() => onChange(!checked)}
        className={styles.switch}
      >
        <span aria-hidden="true" className={styles.thumb} />
      </button>
      {loading && (
        <span className={styles.visuallyHidden} role="status">
          Chargement
        </span>
      )}
      {error && (
        <span id={errorId} className={styles.error} role="alert">
          {error}
        </span>
      )}
    </span>
  )
}
