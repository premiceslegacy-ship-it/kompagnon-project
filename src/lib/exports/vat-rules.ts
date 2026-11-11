import { calculateMonetaryTotals, roundMoney, type MonetaryLine } from '@/lib/utils/money'

export type VatTiming = 'debits' | 'encaissements'

export function getVatTiming(tvaSurDebits: boolean): VatTiming {
  return tvaSurDebits ? 'debits' : 'encaissements'
}

export type VatBreakdown = {
  rate: number
  baseHt: number
  vatAmount: number
}

export type IssuedVatBucket = { rate: number; taxable_basis: number; tax_amount: number }

export class AccountingExportAuthorityError extends Error {
  constructor(message = 'Le décompte fiscal figé est incomplet ou incohérent. Faites vérifier le document d’origine avant son export.') {
    super(message)
    this.name = 'AccountingExportAuthorityError'
  }
}

export function computeVatBreakdowns(
  items: readonly MonetaryLine[],
  options: {
    isVatSubject: boolean
    isReverseCharge: boolean
    issuedBreakdown: readonly IssuedVatBucket[] | null
    issuedTotalHt: number
    issuedTotalVat: number
  },
): VatBreakdown[] {
  const totals = calculateMonetaryTotals(items, options)
  if (roundMoney(options.issuedTotalHt) !== totals.totalHt) throw new AccountingExportAuthorityError()
  if (!options.isVatSubject || options.isReverseCharge) {
    if (options.issuedTotalVat !== 0) throw new AccountingExportAuthorityError()
    return []
  }

  const breakdowns = options.issuedBreakdown === null
    ? Object.entries(totals.vatByRate).map(([rate, vatAmount]) => ({
      rate: Number(rate),
      baseHt: totals.htByVatRate[Number(rate)],
      vatAmount,
    }))
    : options.issuedBreakdown.map(bucket => ({
      rate: bucket.rate,
      baseHt: bucket.taxable_basis,
      vatAmount: bucket.tax_amount,
    }))
  const rates = new Set<number>()
  for (const bucket of breakdowns) {
    if (rates.has(bucket.rate) || bucket.baseHt !== (totals.htByVatRate[bucket.rate] ?? 0)) {
      throw new AccountingExportAuthorityError()
    }
    rates.add(bucket.rate)
  }
  if (roundMoney(breakdowns.reduce((sum, bucket) => sum + bucket.baseHt, 0)) !== totals.totalHt
      || roundMoney(breakdowns.reduce((sum, bucket) => sum + bucket.vatAmount, 0)) !== roundMoney(options.issuedTotalVat)) {
    throw new AccountingExportAuthorityError()
  }
  return breakdowns.filter(bucket => bucket.baseHt !== 0 || bucket.vatAmount !== 0).sort((a, b) => b.rate - a.rate)
}

export function round2(n: number): number {
  return roundMoney(n)
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
