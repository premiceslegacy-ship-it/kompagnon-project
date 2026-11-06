import { describe, expect, it } from 'vitest'
import {
  buildExpensePayload, catLabel, computedExpenseAmount, emptyExpenseForm, invoiceCollectedHt, marginTone, profitabilityAlerts, recalc,
} from '@/app/(app)/chantiers/[chantierId]/rentabiliteModel'
import type { ChantierProfitability } from '@/lib/data/queries/chantier-profitability'

const base = {
  budgetHt: 10000, revenueHt: 4000, expenses: [], laborByMember: [], costMaterial: 0, costSubcontract: 0, costOther: 0, costLabor: 0, costTotal: 0,
  marginEur: 0, marginPct: 0, hoursLogged: 0,
} as unknown as ChantierProfitability

const exp = (category: string, amount_ht: number) => ({ id: category, category, amount_ht }) as unknown as ChantierProfitability['expenses'][number]

describe('rentabilité du chantier', () => {
  it('recalcule coûts et marge depuis les dépenses et la main-d’œuvre', () => {
    const next = recalc({
      ...base,
      expenses: [exp('materiel', 600), exp('sous_traitance', 400), exp('location', 100), exp('transport', 50)],
    }, [{ user_id: 'u', member_id: null, membership_id: 'm', full_name: 'A', hours: 10, ratePerHour: 30, cost: 300 }])
    expect(next.costMaterial).toBe(600)
    expect(next.costSubcontract).toBe(400)
    expect(next.costOther).toBe(150)
    expect(next.costLabor).toBe(300)
    expect(next.hoursLogged).toBe(10)
    expect(next.costTotal).toBe(1450)
    expect(next.marginEur).toBe(2550)
    expect(next.marginPct).toBeCloseTo(0.6375)
  })

  it('n’a pas de marge sans rien facturer', () => {
    expect(recalc({ ...base, revenueHt: 0, expenses: [exp('materiel', 100)] }).marginPct).toBe(0)
  })

  it('ne compte que la part encaissée d’une facture', () => {
    expect(invoiceCollectedHt({ status: 'paid', total_ht: 1000, total_ttc: 1200, total_paid: 1200 })).toBe(1000)
    expect(invoiceCollectedHt({ status: 'partial', total_ht: 1000, total_ttc: 1200, total_paid: 600 })).toBe(500)
    expect(invoiceCollectedHt({ status: 'sent', total_ht: 1000, total_ttc: 1200, total_paid: 0 })).toBe(0)
  })

  it('qualifie la marge', () => {
    expect(marginTone(0.3)).toBe('success')
    expect(marginTone(0.1)).toBe('wait')
    expect(marginTone(0.01)).toBe('danger')
  })

  it('déclenche les trois alertes aux bons seuils', () => {
    const calm = profitabilityAlerts({ budgetHt: 10000, costTotal: 3000, costSubcontract: 1000, revenueHt: 4000, marginPct: 0.5 }, 30)
    expect(calm).toMatchObject({ costBudget: 7000, budgetAlert: false, subcontractAlert: false, marginAlert: false })
    const tense = profitabilityAlerts({ budgetHt: 10000, costTotal: 6500, costSubcontract: 4500, revenueHt: 4000, marginPct: 0.1 }, 30)
    expect(tense).toMatchObject({ budgetAlert: true, subcontractAlert: true, marginAlert: true })
    expect(profitabilityAlerts({ budgetHt: 0, costTotal: 100, costSubcontract: 0, revenueHt: 0, marginPct: 0 }, 30).costBudget).toBe(0)
  })

  it('calcule le carburant, ou quantité × prix, et laisse libre le montant sinon', () => {
    const f = emptyExpenseForm('2026-11-06')
    expect(computedExpenseAmount(f)).toBeNull()
    expect(computedExpenseAmount({ ...f, quantity: '12', unitPriceHt: '54' })).toEqual({ liters: 0, costHt: 648 })
    const fuel = computedExpenseAmount({ ...f, category: 'transport', transportSubcategory: 'carburant', transportKm: '100', transportConsumption: '8', transportFuelPrice: '2' })
    expect(fuel?.liters).toBeCloseTo(8)
    expect(fuel?.costHt).toBeCloseTo(16)
    expect(computedExpenseAmount({ ...f, category: 'transport', transportSubcategory: 'peage' })).toBeNull()
  })

  it('construit l’envoi : libellé par défaut, TVA, sous-catégorie, champs carburant seulement pour le carburant', () => {
    const f = emptyExpenseForm('2026-11-06')
    const material = buildExpensePayload('c1', { ...f, label: '  Colle ', amountHt: '112' }, 112)
    expect(material).toMatchObject({ chantierId: 'c1', label: 'Colle', amountHt: 112, vatRate: 20, subcategory: null, transportKm: null, rentalStartDate: null })
    expect(buildExpensePayload('c1', f, 10).label).toBe('(sans libellé)')
    const fuel = buildExpensePayload('c1', { ...f, category: 'transport', transportKm: '80' }, 12)
    expect(fuel).toMatchObject({ subcategory: 'carburant', transportKm: 80 })
    const toll = buildExpensePayload('c1', { ...f, category: 'transport', transportSubcategory: 'peage', transportKm: '80' }, 12)
    expect(toll).toMatchObject({ subcategory: 'peage', transportKm: null })
    const rent = buildExpensePayload('c1', { ...f, category: 'location', rentalItemLabel: 'Bétonnière', rentalStartDate: '2026-10-26' }, 86)
    expect(rent).toMatchObject({ rentalItemLabel: 'Bétonnière', label: 'Bétonnière', rentalStartDate: '2026-10-26', rentalEndDate: null })
  })

  it('nomme les catégories', () => {
    expect(catLabel('sous_traitance')).toBe('Sous-traitance')
  })
})
