import { describe, expect, it } from 'vitest'
import {
  computeDimensionQuantity,
  computeQuoteTotals,
  findBestClientMatch,
  getInternalCostTotal,
  getInternalSaleTotal,
  getItemDimensionMode,
  getModeUnit,
  getSafeReturnTo,
  inferLaborCategory,
  isLikelyInternalAIItem,
  itemToLocal,
  resolvePersistedSectionId,
  roundCurrency,
  type LocalItem,
  type LocalSection,
} from '@/app/(app)/finances/quote-editor/quoteEditorModel'
import type { Client } from '@/lib/data/queries/clients'
import type { QuoteItem } from '@/lib/data/queries/quotes'

function item(overrides: Partial<LocalItem> = {}): LocalItem {
  return {
    _tempId: 'i', id: null, description: 'Ligne', quantity: 1, unit: 'u', unit_price: 100,
    unit_cost_ht: null, vat_rate: 20, type: 'custom', material_id: null, labor_rate_id: null,
    position: 1, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null,
    dim_quantity: 1, is_estimated: false, is_internal: false, transport_km: null,
    transport_conso: null, transport_prix_l: null, metal_grid_id: null,
    price_pending: false, labor_category: null,
    ...overrides,
  }
}

function section(items: LocalItem[], overrides: Partial<LocalSection> = {}): LocalSection {
  return { _tempId: 's', id: 's1', title: 'Lot', position: 1, items, ...overrides }
}

describe('computeQuoteTotals', () => {
  it('additionne les lignes visibles et calcule la TVA par taux', () => {
    const totals = computeQuoteTotals([
      section([item({ quantity: 2, unit_price: 50 }), item({ quantity: 1, unit_price: 100, vat_rate: 10 })]),
    ])
    expect(totals.totalHt).toBe(200)
    expect(totals.totalTva).toBe(30)
    expect(totals.totalTtc).toBe(230)
  })
  it('arrondit les lignes fractionnaires avant de calculer les bases et les taxes par taux', () => {
    const totals = computeQuoteTotals([
      section([
        item({ quantity: 8, unit_price: 62.8 }),
        item({ quantity: 0.001, unit_price: 625.5 }),
      ]),
    ])
    expect(totals.totalHt).toBe(503.03)
    expect(totals.totalTva).toBe(100.61)
    expect(totals.totalTtc).toBe(603.64)
  })

  it('arrondit distinctement chaque taux de TVA à partir de sa base', () => {
    const totals = computeQuoteTotals([
      section([
        item({ quantity: 8, unit_price: 62.8, vat_rate: 20 }),
        item({ quantity: 0.001, unit_price: 625.5, vat_rate: 10 }),
      ]),
    ])
    expect(totals.totalHt).toBe(503.03)
    expect(totals.totalTva).toBe(100.54)
    expect(totals.totalTtc).toBe(603.57)
  })
  it('calcule les petits montants par bucket plutôt que par TVA de ligne', () => {
    const totals = computeQuoteTotals([
      section(Array.from({ length: 5 }, (_, id) => item({ _tempId: String(id), unit_price: 0.03 }))),
    ])
    expect(totals.totalHt).toBe(0.15)
    expect(totals.totalTva).toBe(0.03)
    expect(totals.totalTtc).toBe(0.18)
  })

  it('calcule les petites lignes par bucket de taux et conserve HT + TVA = TTC', () => {
    const totals = computeQuoteTotals([
      section([
        ...Array.from({ length: 4 }, (_, id) => item({ _tempId: String(id), unit_price: 0.03, vat_rate: 20 })),
        ...Array.from({ length: 4 }, (_, index) => item({ _tempId: `low-${index}`, unit_price: 0.03, vat_rate: 10 })),
      ]),
    ])
    expect(totals.totalHt).toBe(0.24)
    expect(totals.totalTva).toBe(0.03)
    expect(totals.totalTtc).toBe(0.27)
    expect(totals.totalHt + totals.totalTva).toBe(totals.totalTtc)
  })



  it('exclut les lignes internes du total client mais les compte dans le coût', () => {
    const totals = computeQuoteTotals([
      section([
        item({ quantity: 1, unit_price: 1000, unit_cost_ht: 600 }),
        item({ quantity: 10, unit_price: 30, is_internal: true }),
      ]),
    ])
    expect(totals.totalHt).toBe(1000)
    expect(totals.internalOnlyHt).toBe(300)
    expect(totals.totalInternalHt).toBe(900)
    expect(totals.margeHt).toBe(100)
    expect(totals.margePct).toBeCloseTo(10)
    expect(totals.hasInternalItems).toBe(true)
  })

  it('ne divise pas par zéro sans ligne visible', () => {
    const totals = computeQuoteTotals([section([item({ is_internal: true, quantity: 2, unit_price: 40 })])])
    expect(totals.totalHt).toBe(0)
    expect(totals.margePct).toBe(0)
    expect(totals.internalSaleToDistributeHt).toBe(80)
    expect(totals.canDistributeInternalCosts).toBe(false)
  })

  it('autorise la répartition quand il reste une ligne visible chiffrée', () => {
    const totals = computeQuoteTotals([
      section([item(), item({ is_internal: true, quantity: 1, unit_price: 50 })]),
    ])
    expect(totals.canDistributeInternalCosts).toBe(true)
  })

  it('compte les prix fournisseur en attente sur les lignes visibles seulement', () => {
    const totals = computeQuoteTotals([
      section([item({ price_pending: true }), item({ price_pending: true, is_internal: true }), item()]),
    ])
    expect(totals.pendingSupplierPrices).toBe(1)
  })

  it('renvoie des totaux nuls pour un devis vide', () => {
    const totals = computeQuoteTotals([])
    expect(totals.totalTtc).toBe(0)
    expect(totals.hasInternalItems).toBe(false)
  })
})

describe('coûts internes', () => {
  it('prend le coût saisi, sinon le prix pour une ligne interne, sinon zéro', () => {
    expect(getInternalCostTotal(item({ quantity: 3, unit_cost_ht: 10 }))).toBe(30)
    expect(getInternalCostTotal(item({ quantity: 3, unit_price: 20, is_internal: true }))).toBe(60)
    expect(getInternalCostTotal(item({ quantity: 3 }))).toBe(0)
  })

  it('ne vend que les lignes internes', () => {
    expect(getInternalSaleTotal(item({ quantity: 2, unit_price: 25, is_internal: true }))).toBe(50)
    expect(getInternalSaleTotal(item({ quantity: 2, unit_price: 25 }))).toBe(0)
  })

  it('arrondit au centime', () => {
    expect(roundCurrency(1.005)).toBe(1.01)
    expect(roundCurrency(2.344)).toBe(2.34)
  })
})

describe('dimensions', () => {
  it('déduit le mode des dimensions et de l’unité', () => {
    expect(getItemDimensionMode(item({ length_m: 2, width_m: 3 }))).toBe('area')
    expect(getItemDimensionMode(item({ length_m: 2, unit: 'ml' }))).toBe('linear')
    expect(getItemDimensionMode(item({ unit: 'm³' }))).toBe('volume')
    expect(getItemDimensionMode(item())).toBe('none')
    expect(getItemDimensionMode(item({ dimension_pricing_mode: 'area' }))).toBe('area')
  })

  it('calcule la quantité selon le mode et le multiplicateur', () => {
    expect(computeDimensionQuantity('linear', 4, null, null, 1, 2)).toBe(8)
    expect(computeDimensionQuantity('area', 2, 3, null, 1, 1)).toBe(6)
    expect(computeDimensionQuantity('volume', 2, 3, 0.5, 1, 2)).toBe(6)
    expect(computeDimensionQuantity('none', 2, 3, 4, 7)).toBe(7)
  })

  it('traite un multiplicateur nul comme 1', () => {
    expect(computeDimensionQuantity('linear', 5, null, null, 1, 0)).toBe(5)
  })

  it('donne l’unité du mode', () => {
    expect(getModeUnit('linear', 'u')).toBe('ml')
    expect(getModeUnit('area', 'u')).toBe('m²')
    expect(getModeUnit('volume', 'u')).toBe('m³')
    expect(getModeUnit('none', 'kg')).toBe('kg')
  })
})

describe('itemToLocal', () => {
  const base = {
    id: 'q1', description: 'Carburant - trajet 100 km', quantity: 8, unit: 'L', unit_price: 1.85,
    vat_rate: 20, type: 'custom', material_id: null, labor_rate_id: null, position: 2,
    is_internal: true,
  } as unknown as QuoteItem

  it('reconnaît une ligne de carburant et retrouve le kilométrage', () => {
    const local = itemToLocal(base)
    expect(local.transport_km).toBe(100)
    expect(local.transport_prix_l).toBe(1.85)
    expect(local._tempId).toBe('q1')
  })

  it('laisse les lignes ordinaires sans métadonnées de transport', () => {
    const local = itemToLocal({ ...base, description: 'Peinture', unit: 'm²', is_internal: false } as unknown as QuoteItem)
    expect(local.transport_km).toBeNull()
    expect(local.is_internal).toBe(false)
  })
})

describe('sections', () => {
  it('ne persiste pas la section fictive des lignes sans lot', () => {
    expect(resolvePersistedSectionId(section([], { _tempId: '_unsectioned', id: null }))).toBeNull()
    expect(resolvePersistedSectionId(section([], { id: 'abc' }))).toBe('abc')
    expect(resolvePersistedSectionId(undefined)).toBeUndefined()
  })
})

describe('getSafeReturnTo', () => {
  it('refuse les adresses externes ou protocolaires', () => {
    expect(getSafeReturnTo('//evil.test', '/finances')).toBe('/finances')
    expect(getSafeReturnTo('https://evil.test', '/finances')).toBe('/finances')
    expect(getSafeReturnTo(null, '/finances')).toBe('/finances')
  })

  it('garde un chemin interne', () => {
    expect(getSafeReturnTo('/clients/12?tab=a', '/finances')).toBe('/clients/12?tab=a')
  })
})

describe('findBestClientMatch', () => {
  const clients = [
    { id: '1', company_name: 'Martin & Fils', contact_name: null, first_name: null, last_name: null, email: 'contact@martin.test', phone: null },
    { id: '2', company_name: null, contact_name: null, first_name: 'Élodie', last_name: 'Durand', email: null, phone: null },
  ] as unknown as Client[]

  it('trouve un nom sans tenir compte des accents ni de la casse', () => {
    expect(findBestClientMatch(clients, 'elodie durand')?.id).toBe('2')
    expect(findBestClientMatch(clients, 'MARTIN')?.id).toBe('1')
  })

  it('ne devine rien quand rien ne ressemble', () => {
    expect(findBestClientMatch(clients, 'Zorglub')).toBeNull()
    expect(findBestClientMatch(clients, '')).toBeNull()
  })
})

describe('classement des lignes issues de l’IA', () => {
  it('range la soudure en atelier et la pose en pose', () => {
    expect(inferLaborCategory('Fabrication', 'Soudure du portail')).toBe('atelier')
    expect(inferLaborCategory('Chantier', 'Scellement des poteaux')).toBe('pose')
    expect(inferLaborCategory(null, 'Thermolaquage')).toBe('finition')
    expect(inferLaborCategory('Divers', 'Café')).toBeNull()
  })

  it('repère le transport et la main-d’œuvre comme interne', () => {
    const base = { description: 'Frais de déplacement' } as Parameters<typeof isLikelyInternalAIItem>[1]
    expect(isLikelyInternalAIItem('Lot 1', base)).toBe(true)
    expect(isLikelyInternalAIItem('Lot 1', { description: 'Portail alu' } as typeof base)).toBe(false)
    expect(isLikelyInternalAIItem('Lot 1', { description: 'Portail', is_internal: true } as typeof base)).toBe(true)
  })
})
