'use client'

import React, { useId } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import styles from './AssistantField.module.css'

export type AssistantFieldProps = {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  suggestions?: readonly string[]
  disabled?: boolean
  loading?: boolean
  error?: string
}

export function AssistantField({
  value,
  onChange,
  onSubmit,
  placeholder = 'Pose ta question…',
  suggestions = [],
  disabled = false,
  loading = false,
  error,
}: AssistantFieldProps) {
  const inputId = useId()
  const errorId = useId()
  const canSubmit = value.trim().length > 0 && !disabled && !loading
  const state = disabled ? 'disabled' : loading ? 'thinking' : error ? 'error' : 'idle'

  function submit(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault()
    if (canSubmit) onSubmit()
  }

  return (
    <div className={styles.root} data-state={state} aria-busy={loading || undefined}>
      <div className={styles.surface}>
        <form className={styles.form} onSubmit={submit} aria-label="Assistant">
          <label className={styles.visuallyHidden} htmlFor={inputId}>Votre demande</label>
          <textarea
            id={inputId}
            className={styles.input}
            value={value}
            onChange={(event) => {
              if (!disabled && !loading) onChange(event.currentTarget.value)
            }}
            onKeyDown={(event) => {
              if (loading && event.key === 'Enter') {
                event.preventDefault()
                return
              }
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                submit()
              }
            }}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            readOnly={loading}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? errorId : undefined}
          />
          <Button
            type="submit"
            variant="primary"
            size="md"
            className={styles.sendButton}
            disabled={disabled || (!loading && value.trim().length === 0)}
            loading={loading}
            aria-label={loading ? 'Traitement en cours' : 'Envoyer'}
            aria-busy={loading || undefined}
          >
            {loading ? null : <ArrowUp aria-hidden="true" />}
          </Button>
        </form>
      </div>

      {suggestions.length > 0 && (
        <div className={styles.suggestions} role="group" aria-label="Suggestions">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className={styles.suggestion}
              disabled={disabled || loading}
              onClick={() => {
                if (!disabled && !loading) onChange(suggestion)
              }}
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}

      {error && <p id={errorId} className={styles.error} role="alert">{error}</p>}
    </div>
  )
}
