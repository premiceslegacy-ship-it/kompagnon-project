import { describe, expect, it } from 'vitest'
import { aggregateBillingByMonth, monthDateRange, monthsEndingAt } from '@/lib/data/queries/dashboard'

describe('tendance de facturation du tableau de bord', () => {
  it('délimite les mois par dates civiles, y compris leur dernier jour et le passage d’année', () => {
    const november = monthDateRange('2026-11')
    expect(november).toEqual({ firstDay: '2026-11-01', nextMonthFirstDay: '2026-12-01' })
    expect(monthDateRange('2026-12')).toEqual({ firstDay: '2026-12-01', nextMonthFirstDay: '2027-01-01' })
    expect(monthsEndingAt('2027-01', 2)).toEqual(['2026-12', '2027-01'])
  })

  it('range chaque facture dans son mois avec la même définition que les chiffres du mois', () => {
    const months = monthsEndingAt('2026-02', 4)
    expect(months).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    const result = aggregateBillingByMonth(months, [
      { issue_date: '2026-02-03', total_ttc: 1200, total_paid: 0, status: 'paid' },
      { issue_date: '2026-02-20', total_ttc: 800, total_paid: 300, status: 'partial' },
      { issue_date: '2026-02-28', total_ttc: 500, total_paid: 0, status: 'sent' },
      { issue_date: '2026-01-10', total_ttc: 100, total_paid: 0, status: 'sent' },
      { issue_date: '2025-01-10', total_ttc: 999, total_paid: 0, status: 'paid' },
      { issue_date: null, total_ttc: 50, total_paid: 0, status: 'paid' },
    ])
    expect(result).toEqual([
      { month: '2025-11', caMois: 0, encaisseMois: 0 },
      { month: '2025-12', caMois: 0, encaisseMois: 0 },
      { month: '2026-01', caMois: 100, encaisseMois: 0 },
      { month: '2026-02', caMois: 2500, encaisseMois: 300 },
    ])
  })

  it('impute l’avoir au mois de son émission sans réduire le mois de la facture source ni encaisser un remboursement', () => {
    const result = aggregateBillingByMonth(['2026-01', '2026-02'], [
      { issue_date: '2026-01-15', invoice_type: 'standard', total_ttc: 120, total_paid: 120, status: 'paid' },
      { issue_date: '2026-02-01', invoice_type: 'avoir', total_ttc: 120, total_paid: 120, status: 'paid' },
    ])
    expect(result).toEqual([
      { month: '2026-01', caMois: 120, encaisseMois: 120 },
      { month: '2026-02', caMois: -120, encaisseMois: 0 },
    ])
  })

  it('compte le versement réellement enregistré après déduction d’un avoir, sans assimiler le TTC au reçu', () => {
    expect(aggregateBillingByMonth(['2026-11'], [
      { issue_date: '2026-11-03', invoice_type: 'standard', total_ttc: 1200, total_paid: 1000, status: 'paid' },
      { issue_date: '2026-11-04', invoice_type: 'avoir', total_ttc: 200, total_paid: 0, status: 'sent' },
    ])).toEqual([{ month: '2026-11', caMois: 1000, encaisseMois: 1000 }])
  })

  it('conserve zéro encaissé pour une facture entièrement compensée sans versement', () => {
    expect(aggregateBillingByMonth(['2026-11'], [
      { issue_date: '2026-11-03', invoice_type: 'standard', total_ttc: 1200, total_paid: 0, status: 'paid' },
      { issue_date: '2026-11-04', invoice_type: 'avoir', total_ttc: 1200, total_paid: 0, status: 'sent' },
    ])).toEqual([{ month: '2026-11', caMois: 0, encaisseMois: 0 }])
  })

  it('additionne les documents et versements au centime sans résidu flottant', () => {
    expect(aggregateBillingByMonth(['2026-11'], [
      { issue_date: '2026-11-01', invoice_type: 'acompte', total_ttc: 181.09, total_paid: 181.09, status: 'paid' },
      { issue_date: '2026-11-02', invoice_type: 'solde', total_ttc: 422.55, total_paid: 0, status: 'sent' },
      { issue_date: '2026-11-03', invoice_type: 'avoir', total_ttc: 422.55, total_paid: 0, status: 'sent' },
      { issue_date: '2026-11-04', invoice_type: 'standard', total_ttc: 120, total_paid: 0, status: 'sent' },
    ])).toEqual([{ month: '2026-11', caMois: 301.09, encaisseMois: 181.09 }])
  })
})
