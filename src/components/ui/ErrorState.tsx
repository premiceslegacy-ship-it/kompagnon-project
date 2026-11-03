'use client'

import { createElement, useId } from 'react'
import { Button } from './Button'
import { HEADING_TAGS, type HeadingLevel } from './heading-level'
import styles from './ErrorState.module.css'

const DEFAULT_RETRY_LABEL = 'Réessayer'

export type ErrorStateProps = {
  title: string
  description: string
  retryLabel?: string
  onRetry: () => void
  retrying?: boolean
  headingLevel?: HeadingLevel
  className?: string
}

/** État d’erreur explicite, avec un nouvel essai déclenché par l’appelant. */
export function ErrorState({
  title,
  description,
  retryLabel = DEFAULT_RETRY_LABEL,
  onRetry,
  retrying = false,
  headingLevel = 2,
  className,
}: ErrorStateProps) {
  const titleId = useId()
  const descriptionId = useId()
  const headingElement = createElement(
    HEADING_TAGS[headingLevel],
    {
      id: titleId,
      className: styles.title,
    },
    title
  )

  return (
    <section
      className={className ? `${styles.root} ${className}` : styles.root}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <svg className={styles.symbol} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
        <path d="M24 7.5 43 40.5H5z" />
        <path className={styles.accent} d="M24 19v11M24 35v.01" />
      </svg>
      <div role="alert" className={styles.message}>
        {headingElement}
        <p id={descriptionId} className={styles.description}>
          {description}
        </p>
      </div>
      <div className={styles.action}>
        <Button
          variant="primary"
          size="lg"
          loading={retrying}
          onClick={onRetry}
        >
          {retryLabel}
        </Button>
      </div>
    </section>
  )
}
