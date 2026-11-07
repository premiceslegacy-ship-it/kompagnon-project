import type { HTMLAttributes } from 'react'
import styles from './Skeleton.module.css'

export type SkeletonProps = Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'role' | 'aria-busy' | 'aria-label'> & {
  label?: string
}

/** Placeholder de chargement inspiré des trois lignes d’état de la maquette. */
export function Skeleton({ label = 'Chargement en cours', className, ...props }: SkeletonProps) {
  return (
    <div
      {...props}
      className={className ? `${styles.root} ${className}` : styles.root}
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <div className={styles.row} aria-hidden="true">
        <span className={styles.avatar} />
        <span className={styles.lines}>
          <span className={styles.line} />
          <span className={styles.secondaryLine} />
        </span>
      </div>
      <div className={styles.row} aria-hidden="true">
        <span className={styles.avatar} />
        <span className={styles.lines}>
          <span className={styles.line} />
          <span className={styles.secondaryLine} />
        </span>
      </div>
      <div className={styles.row} aria-hidden="true">
        <span className={styles.avatar} />
        <span className={styles.lines}>
          <span className={styles.line} />
          <span className={styles.secondaryLine} />
        </span>
      </div>
    </div>
  )
}
