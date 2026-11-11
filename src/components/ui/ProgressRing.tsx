import type { ReactNode } from 'react'
import styles from './ProgressRing.module.css'

export type ProgressRingTone = 'accent' | 'success' | 'danger' | 'neutral'

type ProgressRingProps = {
  /** Avancement de 0 à 100 ; les valeurs hors plage sont ramenées dans la plage. */
  value: number
  /** Texte lu par les lecteurs d'écran, par exemple « Avancement : 40 % ». */
  label: string
  /** Contenu au centre : le chiffre, une icône. */
  children?: ReactNode
  size?: number
  stroke?: number
  tone?: ProgressRingTone
  className?: string
}

/** Anneau d'avancement : un seul chiffre, une seule couleur, un tracé qui se pose en 300 ms. */
export function ProgressRing({ value, label, children, size = 44, stroke, tone = 'accent', className }: ProgressRingProps) {
  const pct = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0
  const width = stroke ?? Math.max(3, Math.round(size / 10))
  const radius = (size - width) / 2
  const circumference = 2 * Math.PI * radius
  const classNames = className ? `${styles.ring} ${className}` : styles.ring

  return (
    <div
      className={classNames}
      data-tone={tone}
      role="img"
      aria-label={label}
      style={{ width: size, height: size, ['--ring-c' as string]: circumference, ['--ring-size' as string]: `${size}px` }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className={styles.track} cx={size / 2} cy={size / 2} r={radius} strokeWidth={width} />
        {pct > 0 && (
          <circle
            className={styles.arc}
            cx={size / 2}
            cy={size / 2}
            r={radius}
            strokeWidth={width}
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - pct / 100)}
          />
        )}
      </svg>
      {children !== undefined && <span className={styles.center}>{children}</span>}
    </div>
  )
}
