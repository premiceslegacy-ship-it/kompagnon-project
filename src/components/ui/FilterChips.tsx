'use client'

import { useId } from 'react'
import styles from './FilterChips.module.css'

export type FilterChipOption = {
  value: string
  label: string
  disabled?: boolean
}

export type FilterChipsProps = {
  options: readonly FilterChipOption[]
  value: readonly string[]
  onChange: (value: string[]) => void
  label: string
  disabled?: boolean
  loading?: boolean
  error?: string
}

/** Filtres contrôlés à sélection multiple, annoncés comme boutons à état pressé. */
export function FilterChips({
  options,
  value,
  onChange,
  label,
  disabled = false,
  loading = false,
  error,
}: FilterChipsProps) {
  const generatedId = useId()
  const idPrefix = generatedId.replaceAll(':', '')
  const errorId = `${idPrefix}-error`
  const isDisabled = disabled || loading

  function toggle(optionValue: string) {
    onChange(value.includes(optionValue) ? value.filter((item) => item !== optionValue) : [...value, optionValue])
  }

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={loading || undefined}
      aria-describedby={error ? errorId : undefined}
      className={styles.root}
    >
      <div className={styles.chips}>
        {options.map((option) => {
          const selected = value.includes(option.value)
          return (
            <button
              type="button"
              key={option.value}
              aria-pressed={selected}
              disabled={isDisabled || option.disabled}
              onClick={() => toggle(option.value)}
              className={`${styles.chip}${selected ? ` ${styles.selected}` : ''}`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
      {loading && (
        <span className={styles.visuallyHidden} role="status">
          Chargement
        </span>
      )}
      {error && (
        <p id={errorId} className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
