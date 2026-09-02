// Atelier by Orsayn - PDF Design System v1.0
// pdfText normalise les séparateurs unicode et retours ligne bruts avant
// dessin avec pdf-lib (polices embarquées, voir engine/fonts.ts).
export function pdfText(value: string | number | null | undefined): string {
  if (value == null) return ''
  return String(value)
    .replace(/[\u202f\u00a0]/g, ' ')
    .replace(/\s*\r?\n\s*/g, ' ')
}

export function splitItemDescription(value: string | null | undefined): { title: string; details: string[] } {
  const raw = String(value ?? '').replace(/\r\n/g, '\n').trim()
  if (!raw) return { title: '', details: [] }

  const parts = raw.split(/(?:\n\s*)?Comprend\s*:\s*/i)
  if (parts.length < 2) return { title: pdfText(raw), details: [] }

  const title = pdfText(parts[0].trim())
  const details = parts.slice(1).join('\n')
    .split('\n')
    .map(line => pdfText(line.replace(/^\s*[-•]\s*/, '').trim()))
    .filter(Boolean)

  return { title, details }
}

type DimItem = {
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dim_quantity?: number | null
  dimension_pricing_mode?: string | null
}

export function formatDimDetail(item: DimItem): string | null {
  const L = item.length_m
  const W = item.width_m
  const H = item.height_m
  const N = (item.dim_quantity ?? 1) > 1 ? item.dim_quantity! : null

  // Infer mode from available dimensions if not provided
  let mode = item.dimension_pricing_mode
  if (!mode || mode === 'none') {
    if (H) mode = 'volume'
    else if (L && W) mode = 'area'
    else if (L) mode = 'linear'
    else return null
  }

  if (!L) return null

  const fmtM = (v: number) => {
    const s = v % 1 === 0 ? String(v) : v.toFixed(3).replace(/\.?0+$/, '')
    return `${s} m`
  }

  let dimStr: string
  if (mode === 'linear') {
    dimStr = fmtM(L)
  } else if (mode === 'area' && W) {
    dimStr = `${fmtM(L)} x ${fmtM(W)}`
  } else if (mode === 'volume' && W && H) {
    dimStr = `${fmtM(L)} x ${fmtM(W)} x ${fmtM(H)}`
  } else {
    return null
  }

  return N ? `(${N} x ${dimStr})` : `(${dimStr})`
}

// Toujours passer par fmtCurrency pour normaliser les séparateurs de milliers.
export function fmtCurrency(amount: number, currency = 'EUR', fractionDigits = 2): string {
  return pdfText(new Intl.NumberFormat('fr-FR', { style: 'currency', currency, maximumFractionDigits: fractionDigits })
    .format(amount))
}

export function fmtCapitalSocial(value: string | number | null | undefined): string | null {
  if (value == null) return null
  let amount: number

  if (typeof value === 'string') {
    const numeric = value.replace(/[^\d,.-]/g, '')
    const decimalAware = numeric.includes(',') && !numeric.includes('.')
      ? numeric.replace(',', '.')
      : numeric
    amount = Number(decimalAware)
  } else {
    amount = value
  }

  if (!Number.isFinite(amount)) return null

  const rounded = Math.round(amount)
  return `${rounded.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} €`
}


// ─── Tokens ───────────────────────────────────────────────────────────────────

export const DS = {
  color: {
    black:   '#000000',
    secondary: '#71717A',
    accent:  '#FF9F1C',
    divider: '#E4E4E7',
    surface: '#F9FAFB',
    white:   '#FFFFFF',
    body:    '#52525B',
    muted:   '#A1A1AA',
  },
  font: {
    heading: 'PlusJakartaSans',
    body:    'Inter',
  },
  size: {
    xxs:  6,
    xs:   7,
    sm:   8,
    base: 9,
    md:   10,
    lg:   12,
    xl:   14,
    xxl:  18,
    xxxl: 24,
  },
  space: {
    xs:  4,
    sm:  8,
    md:  12,
    lg:  16,
    xl:  24,
    xxl: 36,
    page: 45,
  },
}
