'use client'

import { createElement, useId } from 'react'
import { Button } from './Button'
import { HEADING_TAGS, type HeadingLevel } from './heading-level'
import styles from './EmptyState.module.css'

type EmptyStateAction =
  | { actionLabel: string; onAction: () => void; actionLoading?: boolean }
  | { actionLabel?: never; onAction?: never; actionLoading?: never }

export type EmptyStateProps = {
  title: string
  description: string
  headingLevel?: HeadingLevel
  className?: string
} & EmptyStateAction

/** État vide de la maquette, avec une action réelle lorsqu’un callback est fourni. */
export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  actionLoading = false,
  className,
  headingLevel = 2,
}: EmptyStateProps) {
  const titleId = useId()
  const descriptionId = useId()
  const heading = createElement(HEADING_TAGS[headingLevel], { id: titleId, className: styles.title }, title)

  return (
    <section
      className={className ? `${styles.root} ${className}` : styles.root}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      {heading}
      <p id={descriptionId} className={styles.description}>
        {description}
      </p>
      {onAction ? (
        <Button
          variant="primary"
          size="md"
          loading={actionLoading}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </section>
  )
}
