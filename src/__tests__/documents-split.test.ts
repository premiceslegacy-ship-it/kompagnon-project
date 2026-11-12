import { describe, expect, it } from 'vitest'
import { invoicesSplit, quotesSplit } from '@/app/(app)/finances/documentsSplit'

const euros = (n: number) => `${n} €`
const values = (segments: ReturnType<typeof quotesSplit>) => Object.fromEntries(segments.map(s => [s.key, s.value]))

describe('répartition des documents', () => {
  it('range les devis par étape', () => {
    const result = quotesSplit([
      { status: 'draft' }, { status: 'draft' }, { status: 'sent' }, { status: 'viewed' },
      { status: 'accepted' }, { status: 'converted' }, { status: 'refused' }, { status: 'expired' },
    ])
    expect(values(result)).toEqual({ won: 2, waiting: 2, draft: 2, lost: 2 })
  })

  it('sépare encaissé, à encaisser et en retard sur les factures', () => {
    const result = invoicesSplit([
      { status: 'paid', invoice_type: 'standard', total_ttc: 1000, due_date: '2026-10-01' },
      { status: 'partial', invoice_type: 'standard', total_ttc: 600, total_paid: 200, due_date: '2026-10-01' },
      { status: 'sent', invoice_type: 'standard', total_ttc: 300, due_date: '2026-12-01' },
      { status: 'draft', invoice_type: 'standard', total_ttc: 9999, due_date: null },
      { status: 'cancelled', invoice_type: 'standard', total_ttc: 9999, due_date: null },
    ], '2026-11-09', euros)
    expect(values(result)).toEqual({ paid: 1200, due: 300, late: 400 })
  })

  it('ne compte jamais plus que le total d’une facture déjà encaissée', () => {
    const result = invoicesSplit([{ status: 'partial', invoice_type: 'standard', total_ttc: 100, total_paid: 500, due_date: null }], '2026-11-09', euros)
    expect(values(result)).toEqual({ paid: 100, due: 0, late: 0 })
  })

  it('compense le solde crédité sans transformer l’avoir en créance', () => {
    const result = invoicesSplit([
      { status: 'sent', invoice_type: 'acompte', total_ttc: 181.09, due_date: '2026-12-01' },
      { status: 'sent', invoice_type: 'solde', total_ttc: 422.55, credited_ttc: 422.55, due_date: '2026-12-01' },
      { status: 'sent', invoice_type: 'avoir', total_ttc: 422.55, due_date: '2026-12-01' },
    ], '2026-11-10', euros)
    expect(values(result)).toEqual({ paid: 0, due: 181.09, late: 0 })
  })

  it('conserve les versements reçus et réduit le retard des avoirs partiels', () => {
    const result = invoicesSplit([
      { status: 'viewed', invoice_type: 'standard', total_ttc: 123.45, due_date: '2026-12-01' },
      { status: 'overdue', invoice_type: 'standard', total_ttc: 20.04, total_paid: 1.01, credited_ttc: 5.02, due_date: '2026-11-01' },
    ], '2026-11-10', euros)
    expect(values(result)).toEqual({ paid: 1.01, due: 123.45, late: 14.01 })
  })

  it('ne fabrique pas de remboursement après compensation complète', () => {
    const result = invoicesSplit([
      { status: 'partial', invoice_type: 'standard', total_ttc: 120, total_paid: 40, credited_ttc: 120, due_date: '2026-11-01' },
      { status: 'paid', invoice_type: 'avoir', total_ttc: 120, due_date: null },
    ], '2026-11-10', euros)
    expect(values(result)).toEqual({ paid: 40, due: 0, late: 0 })
  })
})
