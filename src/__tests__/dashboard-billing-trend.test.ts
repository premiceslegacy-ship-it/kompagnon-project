import { describe, expect, it } from 'vitest'
import { aggregateBillingByMonth, monthsEndingAt } from '@/lib/data/queries/dashboard'

describe('tendance de facturation du tableau de bord', () => {
  it('liste six mois se terminant par le mois choisi, en passant l’année', () => {
    expect(monthsEndingAt('2026-02', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthsEndingAt('2026-11', 1)).toEqual(['2026-11'])
  })

  it('range chaque facture dans son mois avec la même définition que les chiffres du mois', () => {
    const months = monthsEndingAt('2026-11', 3)
    const result = aggregateBillingByMonth(months, [
      { issue_date: '2026-11-03', total_ttc: 1200, total_paid: 0, status: 'paid' },
      { issue_date: '2026-11-20', total_ttc: 800, total_paid: 300, status: 'partial' },
      { issue_date: '2026-11-25', total_ttc: 500, total_paid: 0, status: 'sent' },
      { issue_date: '2026-09-10', total_ttc: 100, total_paid: 0, status: 'sent' },
      { issue_date: '2025-01-10', total_ttc: 999, total_paid: 0, status: 'paid' },
      { issue_date: null, total_ttc: 50, total_paid: 0, status: 'paid' },
    ])
    expect(result).toEqual([
      { month: '2026-09', caMois: 100, encaisseMois: 0 },
      { month: '2026-10', caMois: 0, encaisseMois: 0 },
      { month: '2026-11', caMois: 2500, encaisseMois: 1500 },
    ])
  })
})
