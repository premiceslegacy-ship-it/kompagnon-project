'use client'

import { createElement, useId, type ButtonHTMLAttributes, type MouseEventHandler, type ReactNode } from 'react'
import { HEADING_TAGS, type HeadingLevel } from './heading-level'
import styles from './ListGroup.module.css'

type ListGroupProps = {
  title?: string
  headingLevel?: HeadingLevel
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}

/** A titled list surface. Interactive actions belong in the separate header slot. */
export function ListGroup({ title, headingLevel = 2, description, action, children, className }: ListGroupProps) {
  const id = useId()
  const headingId = title ? `${id}-heading` : undefined
  const descriptionId = description ? `${id}-description` : undefined
  const rootClassName = className ? `${styles.group} ${className}` : styles.group

  return (
    <section
      className={rootClassName}
      aria-labelledby={headingId}
      aria-describedby={descriptionId}
    >
      {(title || action) && (
        <div className={styles.header}>
          {title && createElement(HEADING_TAGS[headingLevel], { id: headingId, className: styles.heading }, title)}
          {action && <div className={styles.headerAction}>{action}</div>}
        </div>
      )}
      <ul className={styles.list}>{children}</ul>
      {description && <p id={descriptionId} className={styles.description}>{description}</p>}
    </section>
  )
}

type ListRowBaseProps = {
  /** Ancre de la ligne (défilement vers une ligne précise). */
  id?: string
  title: string
  description?: string
  leading?: ReactNode
  trailing?: ReactNode
  className?: string
}

type ListRowLinkProps = ListRowBaseProps & {
  href: string
  target?: string
  rel?: string
  onClick?: never
  disabled?: never
  type?: never
}

type ListRowButtonProps = ListRowBaseProps & {
  href?: never
  target?: never
  rel?: never
  onClick: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  type?: ButtonHTMLAttributes<HTMLButtonElement>['type']
}

type ListRowStaticProps = ListRowBaseProps & {
  href?: never
  target?: never
  rel?: never
  onClick?: never
  disabled?: never
  type?: never
}

export type ListRowProps = ListRowLinkProps | ListRowButtonProps | ListRowStaticProps

/** A row whose primary action is a native link or button; side content stays a sibling. */
export function ListRow(props: ListRowProps) {
  const { id, title, description, leading, trailing, className } = props
  const itemClassName = className ? `${styles.item} ${className}` : styles.item
  const copy = (
    <span className={styles.copy}>
      <span className={styles.title}>{title}</span>
      {description && <span className={styles.rowDescription}>{description}</span>}
    </span>
  )

  let action: ReactNode
  if ('href' in props && props.href !== undefined) {
    action = (
      <a className={styles.rowAction} href={props.href} target={props.target} rel={props.rel}>
        {copy}
      </a>
    )
  } else if ('onClick' in props && props.onClick) {
    action = (
      <button
        className={styles.rowAction}
        type={props.type ?? 'button'}
        onClick={props.onClick}
        disabled={props.disabled}
      >
        {copy}
      </button>
    )
  } else {
    action = <div className={styles.rowAction}>{copy}</div>
  }

  return (
    <li id={id} className={itemClassName}>
      {leading !== undefined && <div className={styles.leading}>{leading}</div>}
      {action}
      {trailing !== undefined && <div className={styles.trailing}>{trailing}</div>}
    </li>
  )
}

type CheckRowProps = {
  title: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  className?: string
}

/** A task row with a native checkbox and a 44px control target. */
export function CheckRow({ title, description, checked, onCheckedChange, disabled = false, className }: CheckRowProps) {
  const id = useId()
  const descriptionId = description ? `${id}-description` : undefined
  const itemClassName = `${styles.item} ${styles.checkItem}${disabled ? ` ${styles.disabled}` : ''}${
    className ? ` ${className}` : ''
  }`

  return (
    <li className={itemClassName}>
      <label className={styles.checkRow}>
        <input
          className={styles.checkInput}
          type="checkbox"
          checked={checked}
          onChange={(event) => onCheckedChange(event.currentTarget.checked)}
          disabled={disabled}
          aria-describedby={descriptionId}
        />
        <span className={styles.checkIndicator} aria-hidden="true">
          <svg className={styles.checkIcon} viewBox="0 0 16 16" focusable="false">
            <path d="m3.2 8.3 3.1 3.1 6.5-6.8" pathLength={20} />
          </svg>
        </span>
        <span className={styles.copy}>
          <span className={styles.title}>{title}</span>
          {description && <span id={descriptionId} className={styles.rowDescription}>{description}</span>}
        </span>
      </label>
    </li>
  )
}
