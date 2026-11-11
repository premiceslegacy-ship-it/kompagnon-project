import { describe, expect, it } from 'vitest'
import {
  buildEquipmentDescription,
  computeEquipmentCostPerUse,
  computeInvoiceTotals,
  getInternalCostTotal,
  getItemDimensionMode,
  getSafeReturnTo,
  getTransportMeta,
  isEquipmentLine,
  isSectionItem,
  INVOICE_SECTION_UNIT,
  parseEquipmentAmortization,
  scheduleAmount,
  type LocalItem,
} from '@/app/(app)/finances/invoice-editor/invoiceEditorModel'

function item(overrides: Partial<LocalItem> = {}): LocalItem {
  return {
    id: 1, desc: 'Ligne', qty: 1, unit: 'u', pu: 100, unit_cost_ht: null, vat: 20,
    length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1,
    is_internal: false, material_id: null, transport_km: null, transport_conso: null, transport_prix_l: null,
    ...overrides,
  }
}

const standardContext = { isVatSubject: true, isReverseCharge: false, derivedTotals: null }

describe('computeInvoiceTotals', () => {
  it('additionne les lignes visibles et ventile la TVA par taux', () => {
    const t = computeInvoiceTotals([
      item({ qty: 2, pu: 50 }),
      item({ id: 2, qty: 1, pu: 200, vat: 10 }),
      item({ id: 3, qty: 1, pu: 100 }),
    ], standardContext)
    expect(t.totalHt).toBe(400)
    expect(t.totalTva).toBeCloseTo(40 + 20)
    expect(t.totalTtc).toBeCloseTo(460)
    expect(t.vatByRate[20]).toBeCloseTo(40)
    expect(t.vatByRate[10]).toBeCloseTo(20)
  })
  it('arrondit les bases et la TVA par taux au centime', () => {
    const t = computeInvoiceTotals([
      item({ qty: 8, pu: 62.8 }),
      item({ id: 2, qty: 0.001, pu: 625.5 }),
      item({ id: 3, qty: 1, pu: 100, vat: 10 }),
    ], standardContext)
    expect(t.totalHt).toBe(603.03)
    expect(t.totalTva).toBe(110.61)
    expect(t.totalTtc).toBe(713.64)
    expect(t.vatByRate[20]).toBe(100.61)
    expect(t.vatByRate[10]).toBe(10)
  })

  it('calcule la TVA par bucket plutôt qu’en arrondissant chaque ligne isolément', () => {
    const t = computeInvoiceTotals(Array.from({ length: 5 }, (_, id) => item({ id, pu: 0.03 })), standardContext)
    expect(t.totalHt).toBe(0.15)
    expect(t.vatByRate[20]).toBe(0.03)
    expect(t.totalTva).toBe(0.03)
    expect(t.totalTtc).toBe(0.18)
  })

  it('calcule les petites lignes par bucket de taux et conserve HT + TVA = TTC', () => {
    const t = computeInvoiceTotals([
      ...Array.from({ length: 4 }, (_, id) => item({ id, pu: 0.03, vat: 20 })),
      ...Array.from({ length: 4 }, (_, index) => item({ id: index + 10, pu: 0.03, vat: 10 })),
    ], standardContext)
    expect(t.totalHt).toBe(0.24)
    expect(t.vatByRate).toEqual({ 20: 0.02, 10: 0.01 })
    expect(t.totalTva).toBe(0.03)
    expect(t.totalTtc).toBe(0.27)
    expect(t.totalHt + t.totalTva).toBe(t.totalTtc)
  })

  it('met la TVA à zéro et garde le TTC égal au HT en autoliquidation', () => {
    const t = computeInvoiceTotals([
      item({ qty: 8, pu: 62.8 }),
      item({ id: 2, qty: 0.001, pu: 625.5 }),
    ], { ...standardContext, isReverseCharge: true })
    expect(t.totalHt).toBe(503.03)
    expect(t.totalTva).toBe(0)
    expect(t.totalTtc).toBe(503.03)
    expect(t.vatByRate).toEqual({})
  })


  it('garde les lignes internes hors total mais dans le coût et la marge', () => {
    const t = computeInvoiceTotals([
      item({ pu: 1000, unit_cost_ht: 600 }),
      item({ id: 2, qty: 10, pu: 30, is_internal: true }),
    ], standardContext)
    expect(t.totalHt).toBe(1000)
    expect(t.totalInternalHt).toBe(900)
    expect(t.margeHt).toBe(100)
    expect(t.margePct).toBeCloseTo(10)
    expect(t.hasInternal).toBe(true)
  })

  it('ne divise pas par zéro sur une facture vide', () => {
    const t = computeInvoiceTotals([], standardContext)
    expect(t.totalTtc).toBe(0)
    expect(t.margePct).toBe(0)
    expect(t.hasInternal).toBe(false)
  })

  it('traite les intitulés de section comme des lignes à zéro euro', () => {
    const section = item({ unit: INVOICE_SECTION_UNIT, pu: 0, qty: 1 })
    expect(isSectionItem(section)).toBe(true)
    expect(computeInvoiceTotals([section, item({ id: 2, pu: 80 })], standardContext).totalHt).toBe(80)
  })

  it('applique la franchise de TVA même si une ancienne ligne conserve son taux nominal', () => {
    const totals = computeInvoiceTotals([item({ pu: 100, vat: 20 })], { ...standardContext, isVatSubject: false })
    expect(totals.totalTva).toBe(0)
    expect(totals.totalTtc).toBe(100)
  })

  it('conserve la TVA cumulative du décompte et sa marge sans recalculer un autre TTC', () => {
    const totals = computeInvoiceTotals([
      item({ pu: 352.12, vat: 20 }), item({ id: 2, pu: 100, is_internal: true }),
    ], {
      ...standardContext,
      derivedTotals: { totalHt: 352.12, totalTva: 70.43, totalTtc: 422.55, vatByRate: { 20: 70.43 } },
    })
    expect(totals.totalTtc).toBe(422.55)
    expect(totals.totalTva).toBe(70.43)
    expect(totals.margeHt).toBe(252.12)
  })

  it('ne remplace pas une TVA cumulative nulle par la TVA canonique positive', () => {
    const totals = computeInvoiceTotals([item({ pu: 0.03, vat: 20 })], {
      ...standardContext,
      derivedTotals: { totalHt: 0.03, totalTva: 0, totalTtc: 0.03, vatByRate: { 20: 0 } },
    })
    expect(totals.totalHt).toBe(0.03)
    expect(totals.totalTva).toBe(0)
    expect(totals.totalTtc).toBe(0.03)
  })
})

describe('échéancier', () => {
  it('calcule un pourcentage du TTC, arrondi au centime', () => {
    expect(scheduleAmount({ amount_type: 'percentage', percentage: 30, amount: 0 }, 1234.56)).toBe(370.37)
  })

  it('garde un montant fixe tel quel', () => {
    expect(scheduleAmount({ amount_type: 'amount', percentage: null, amount: 250 }, 1000)).toBe(250)
    expect(scheduleAmount({ amount_type: 'amount', percentage: null, amount: Number.NaN }, 1000)).toBe(0)
  })
})

describe('équipement amorti', () => {
  it('relit le nom, le prix d’achat et les usages dans la description', () => {
    const description = buildEquipmentDescription('Aspirateur', 400, 100)
    const meta = parseEquipmentAmortization(description, 4)
    expect(meta).toMatchObject({ name: 'Aspirateur', purchasePrice: 400, lifetimeUses: 100, costPerUse: 4 })
  })

  it('accepte la virgule décimale et un nom vide', () => {
    expect(parseEquipmentAmortization('Scie\n\nAmortissement : 12,5 € / 50 usages', 0.25).purchasePrice).toBe(12.5)
    expect(buildEquipmentDescription('  ', null, null)).toBe('Équipement amorti')
  })

  it('divise le prix par les usages, sinon garde la valeur de repli', () => {
    expect(computeEquipmentCostPerUse(500, 100, 9)).toBe(5)
    expect(computeEquipmentCostPerUse(500, 0, 9)).toBe(9)
    expect(computeEquipmentCostPerUse(null, 100, 9)).toBe(9)
  })

  it('reconnaît une ligne d’équipement : interne, en usages, sans transport', () => {
    expect(isEquipmentLine({ is_internal: true, unit: 'usage', transport_prix_l: null })).toBe(true)
    expect(isEquipmentLine({ is_internal: false, unit: 'usage', transport_prix_l: null })).toBe(false)
    expect(isEquipmentLine({ is_internal: true, unit: 'usage', transport_prix_l: 1.85 })).toBe(false)
  })
})

describe('transport', () => {
  it('relit la distance dans le libellé d’une ligne de carburant', () => {
    const meta = getTransportMeta({ description: 'Carburant - trajet 120 km', quantity: 9.6, unit: 'L', unit_price: 1.9, is_internal: true })
    expect(meta.transport_km).toBe(120)
    expect(meta.transport_prix_l).toBe(1.9)
  })

  it('ne marque pas une ligne visible ou sans carburant', () => {
    expect(getTransportMeta({ description: 'Carburant', unit: 'L', is_internal: false }).transport_km).toBeNull()
    expect(getTransportMeta({ description: 'Peinture', unit: 'L', is_internal: true }).transport_km).toBeNull()
  })
})

describe('coûts et dimensions', () => {
  it('prend le coût saisi, sinon le prix d’une ligne interne', () => {
    expect(getInternalCostTotal({ unit_cost_ht: 10, is_internal: false, pu: 99, qty: 3 })).toBe(30)
    expect(getInternalCostTotal({ unit_cost_ht: null, is_internal: true, pu: 20, qty: 3 })).toBe(60)
    expect(getInternalCostTotal({ unit_cost_ht: null, is_internal: false, pu: 20, qty: 3 })).toBe(0)
  })

  it('déduit le mode de dimension', () => {
    expect(getItemDimensionMode(item({ length_m: 2, width_m: 3, unit: 'm²' }))).toBe('area')
    expect(getItemDimensionMode(item())).toBe('none')
  })

  it('refuse un retour externe', () => {
    expect(getSafeReturnTo('//evil.test', '/finances')).toBe('/finances')
    expect(getSafeReturnTo('/finances?tab=invoices', '/x')).toBe('/finances?tab=invoices')
  })
})
