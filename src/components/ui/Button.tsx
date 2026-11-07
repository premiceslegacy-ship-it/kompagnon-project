'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import styles from './Button.module.css'

type ButtonVariant = 'primary' | 'secondary' | 'text' | 'destructive'
type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  loadingText?: string
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = 'primary',
      size = 'md',
      loading = false,
      loadingText,
      disabled,
      type,
      children,
      onClick,
      onKeyDown,
      'aria-disabled': ariaDisabled,
      'aria-busy': ariaBusy,
      ...props
    },
    ref
  ) => {
    const isUnavailable =
      Boolean(disabled) || loading || ariaDisabled === true || ariaDisabled === 'true'

    return (
      <button
        {...props}
        ref={ref}
        type={type ?? 'button'}
        className={cn(styles.button, styles[variant], styles[size], className)}
        disabled={disabled}
        aria-disabled={loading ? true : ariaDisabled}
        aria-busy={loading ? true : ariaBusy}
        onClick={(event) => {
          if (isUnavailable) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          onClick?.(event)
        }}
        onKeyDown={(event) => {
          if (isUnavailable && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault()
            event.stopPropagation()
            return
          }
          onKeyDown?.(event)
        }}
      >
        {loading && <span className={styles.spinner} aria-hidden="true" />}
        <span className={styles.content}>
          {loading && loadingText !== undefined ? loadingText : children}
        </span>
      </button>
    )
  }
)

Button.displayName = 'Button'
