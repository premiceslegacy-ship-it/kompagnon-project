export type MonetaryLine = {
  quantity: number | null | undefined
  unit_price: number | null | undefined
  vat_rate: number | null | undefined
  is_internal?: boolean | null
}

export type MonetaryTotals = {
  totalHt: number
  totalTva: number
  totalTtc: number
  htByVatRate: Record<number, number>
  vatByRate: Record<number, number>
}

export function roundMoney(value: number): number {
  const absoluteCents = Math.abs(value) * 100
  const rounded = Math.round(absoluteCents + Number.EPSILON * Math.max(1, absoluteCents)) / 100
  return value < 0 ? -rounded : rounded
}

/**
 * Calculate client totals from cent-rounded line bases, then calculate tax once
 * per VAT-rate bucket. This keeps displayed line amounts, tax breakdowns, and
 * the invoice/quote totals arithmetically consistent.
 */
export function calculateMonetaryTotals(
  items: readonly MonetaryLine[],
  options: { isVatSubject?: boolean; isReverseCharge?: boolean } = {},
): MonetaryTotals {
  const isVatSubject = options.isVatSubject !== false
  const isReverseCharge = options.isReverseCharge === true
  const htByVatRate: Record<number, number> = {}
  let totalHt = 0

  for (const item of items) {
    if (item.is_internal) continue
    const quantity = Number(item.quantity) || 0
    const unitPrice = Number(item.unit_price) || 0
    const lineHt = roundMoney(quantity * unitPrice)
    const rate = Number(item.vat_rate) || 0
    totalHt = roundMoney(totalHt + lineHt)
    htByVatRate[rate] = roundMoney((htByVatRate[rate] ?? 0) + lineHt)
  }

  const vatByRate: Record<number, number> = {}
  let totalTva = 0
  if (isVatSubject && !isReverseCharge) {
    for (const [rawRate, basis] of Object.entries(htByVatRate)) {
      const rate = Number(rawRate)
      const amount = roundMoney(basis * (rate / 100))
      vatByRate[rate] = amount
      totalTva = roundMoney(totalTva + amount)
    }
  }

  return {
    totalHt,
    totalTva,
    totalTtc: roundMoney(totalHt + totalTva),
    htByVatRate,
    vatByRate,
  }
}
