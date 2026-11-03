import { useId, type ReactNode } from 'react'
import styles from './StatTile.module.css'

type StatTileProps = {
  label: ReactNode
  value: ReactNode
  detail?: ReactNode
  className?: string
}

/** A compact metric surface with a tabular, Geist value. */
export function StatTile({ label, value, detail, className }: StatTileProps) {
  const labelId = useId()
  const classNames = className ? `${styles.tile} ${className}` : styles.tile

  return (
    <article className={classNames} aria-labelledby={labelId}>
      <div id={labelId} className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
      {detail !== undefined && <div className={styles.detail}>{detail}</div>}
    </article>
  )
}
