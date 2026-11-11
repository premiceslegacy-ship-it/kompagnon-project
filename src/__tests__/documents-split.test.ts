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
      { status: 'paid', total_ttc: 1000, due_date: '2026-10-01' },
      { status: 'partial', total_ttc: 600, total_paid: 200, due_date: '2026-10-01' },
      { status: 'sent', total_ttc: 300, due_date: '2026-12-01' },
      { status: 'draft', total_ttc: 9999, due_date: null },
      { status: 'cancelled', total_ttc: 9999, due_date: null },
    ], '2026-11-09', euros)
    expect(values(result)).toEqual({ paid: 1200, due: 300, late: 400 })
    expect(result[2].display).toBe('400 €')
  })

  it('ne compte jamais plus que le total d’une facture déjà encaissée', () => {
    const result = invoicesSplit([{ status: 'partial', total_ttc: 100, total_paid: 500, due_date: null }], '2026-11-09', euros)
    expect(values(result)).toEqual({ paid: 100, due: 0, late: 0 })
  })
})
