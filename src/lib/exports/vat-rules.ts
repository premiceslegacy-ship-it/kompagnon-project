export type VatTiming = 'debits' | 'encaissements'

export function getVatTiming(tvaSurDebits: boolean): VatTiming {
  return tvaSurDebits ? 'debits' : 'encaissements'
}

export type VatBreakdown = {
  rate: number
  baseHt: number
  vatAmount: number
}

export function computeVatBreakdowns(
  items: Array<{ unit_price: number; quantity: number; vat_rate: number }>,
): VatBreakdown[] {
  const map = new Map<number, { baseHt: number; vatAmount: number }>()

  for (const item of items) {
    const ht = item.unit_price * item.quantity
    const existing = map.get(item.vat_rate) ?? { baseHt: 0, vatAmount: 0 }
    map.set(item.vat_rate, {
      baseHt: existing.baseHt + ht,
      vatAmount: existing.vatAmount + ht * (item.vat_rate / 100),
    })
  }

  return Array.from(map.entries())
    .filter(([, v]) => v.vatAmount > 0)
    .map(([rate, v]) => ({
      rate,
      baseHt: round2(v.baseHt),
      vatAmount: round2(v.vatAmount),
    }))
    .sort((a, b) => b.rate - a.rate)
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function fmtAmount(n: number): string {
  return n.toFixed(2).replace('.', ',')
}

export function fmtDate(dateStr: string | null | undefined): string {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}${m}${day}`
}
