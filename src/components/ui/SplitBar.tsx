import type { ReactNode } from 'react'
import styles from './SplitBar.module.css'

export type SplitBarTone = 'accent' | 'success' | 'danger' | 'info' | 'neutral'

export type SplitBarSegment = {
  key: string
  label: string
  value: number
  tone: SplitBarTone
  /** Valeur déjà mise en forme pour la légende (« 1 200 € », « 3 »). */
  display?: ReactNode
}

type SplitBarProps = {
  segments: readonly SplitBarSegment[]
  /** Texte lu par les lecteurs d'écran, par exemple « Répartition des devis ». */
  label: string
  /** Affiche la légende sous la barre (un point, un libellé, une valeur). */
  legend?: boolean
  className?: string
}

/** Répartition d'un total en une barre : au premier regard, qui pèse combien. */
export function SplitBar({ segments, label, legend = true, className }: SplitBarProps) {
  const shown = segments.filter(s => Number.isFinite(s.value) && s.value > 0)
  const total = shown.reduce((sum, s) => sum + s.value, 0)
  const classNames = className ? `${styles.root} ${className}` : styles.root
  const summary = shown.map(s => `${s.label} ${typeof s.display === 'string' ? s.display : s.value}`).join(', ')

  return (
    <div className={classNames}>
      <div className={styles.bar} role="img" aria-label={summary ? `${label} : ${summary}` : `${label} : aucune donnée`}>
        {total === 0 ? <span className={styles.empty} /> : shown.map(s => (
          <span key={s.key} className={styles.segment} data-tone={s.tone} style={{ flexGrow: s.value }} />
        ))}
      </div>
      {legend && shown.length > 0 && (
        <ul className={styles.legend}>
          {shown.map(s => (
            <li key={s.key} data-tone={s.tone}>
              <i aria-hidden="true" />
              <span>{s.label}</span>
              <b>{s.display ?? s.value}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
