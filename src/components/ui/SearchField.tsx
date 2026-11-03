'use client'

import { Search, X } from 'lucide-react'
import { useId, useRef } from 'react'
import styles from './SearchField.module.css'

export type SearchFieldProps = {
  value: string
  onChange: (value: string) => void
  label: string
  placeholder?: string
  disabled?: boolean
  loading?: boolean
  error?: string
}

/** Recherche contrôlée, avec effacement nommé accessible dès qu'une valeur existe. */
export function SearchField({
  value,
  onChange,
  label,
  placeholder,
  disabled = false,
  loading = false,
  error,
}: SearchFieldProps) {
  const generatedId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = `${generatedId.replaceAll(':', '')}-search`
  const errorId = `${inputId}-error`
  const isDisabled = disabled || loading

  return (
    <div className={styles.root}>
      <div className={styles.field} data-invalid={error ? 'true' : undefined}>
        <Search aria-hidden="true" focusable="false" className={styles.icon} />
        <label htmlFor={inputId} className={styles.visuallyHidden}>
          {label}
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="search"
          value={value}
          placeholder={placeholder}
          disabled={isDisabled}
          aria-busy={loading || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(event) => onChange(event.currentTarget.value)}
          className={styles.input}
        />
        {value.length > 0 && (
          <button
            type="button"
            aria-label="Effacer la recherche"
            disabled={isDisabled}
            onClick={() => {
              onChange('')
              inputRef.current?.focus()
            }}
            className={styles.clear}
          >
            <X aria-hidden="true" focusable="false" className={styles.clearIcon} />
          </button>
        )}
      </div>
      {loading && (
        <span className={styles.visuallyHidden} role="status">
          Recherche en cours
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
