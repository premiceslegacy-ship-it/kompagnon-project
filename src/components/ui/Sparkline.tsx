import styles from './Sparkline.module.css'

export type SparklineTone = 'accent' | 'success' | 'danger' | 'neutral'

type SparklineProps = {
  /** Au moins deux valeurs, de la plus ancienne à la plus récente. */
  values: readonly number[]
  /** Texte lu par les lecteurs d'écran, par exemple « Facturé sur six mois : de 1 200 à 2 526 euros ». */
  label: string
  width?: number
  height?: number
  tone?: SparklineTone
  className?: string
}

const PAD = 4

/** Courbe douce passant par les milieux des segments : jamais de dépassement sous le minimum. */
export function buildSparklinePath(values: readonly number[], width: number, height: number): { line: string; last: { x: number; y: number } } | null {
  const clean = values.filter(Number.isFinite)
  if (clean.length < 2) return null
  const min = Math.min(...clean)
  const max = Math.max(...clean)
  const span = max - min
  const innerW = width - PAD * 2
  const innerH = height - PAD * 2
  const points = clean.map((v, i) => ({
    x: PAD + (innerW * i) / (clean.length - 1),
    y: span === 0 ? height / 2 : PAD + innerH * (1 - (v - min) / span),
  }))
  const r = (n: number) => Math.round(n * 100) / 100
  let line = `M${r(points[0].x)} ${r(points[0].y)}`
  for (let i = 1; i < points.length - 1; i++) {
    const mid = { x: (points[i].x + points[i + 1].x) / 2, y: (points[i].y + points[i + 1].y) / 2 }
    line += ` Q${r(points[i].x)} ${r(points[i].y)} ${r(mid.x)} ${r(mid.y)}`
  }
  const end = points[points.length - 1]
  line += ` L${r(end.x)} ${r(end.y)}`
  return { line, last: end }
}

/** Tendance en un trait, sans axe ni chiffre : le chiffre est à côté. */
export function Sparkline({ values, label, width = 112, height = 36, tone = 'accent', className }: SparklineProps) {
  const path = buildSparklinePath(values, width, height)
  if (!path) return null
  const classNames = className ? `${styles.spark} ${className}` : styles.spark

  return (
    <svg className={classNames} data-tone={tone} width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path className={styles.line} d={path.line} pathLength={1} />
      <circle className={styles.dot} cx={path.last.x} cy={path.last.y} r={3} />
    </svg>
  )
}
