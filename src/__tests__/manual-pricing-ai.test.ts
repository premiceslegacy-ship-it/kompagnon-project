import { describe, expect, it } from 'vitest'
import {
  applyManualPriceKnowledge,
  findCatalogMatch,
  selectManualPriceGridsForAI,
  type ManualPriceGridRow,
  type PriceKnowledgeItem,
  type PriceKnowledgeQuote,
  type PriceKnowledgeSources,
} from '@/lib/ai/manual-pricing'

const organizationId = 'org-current'

function gridRow(overrides: Partial<ManualPriceGridRow> = {}): ManualPriceGridRow {
  return {
    id: 'grid-current',
    organization_id: organizationId,
    label: 'Tôle aluminium 5754',
    metal_code: 'ALU',
    source_type: 'manual',
    manual_price_eur_kg: 1.25,
    unit: 'kg',
    catalog_item_id: null,
    supplier_id: 'supplier-current',
    grade: '5754',
    thickness_mm: 2,
    format_label: '1000×2000',
    is_active: true,
    ...overrides,
  }
}

function quoteItem(overrides: Partial<PriceKnowledgeQuote['sections'][number]['items'][number]> = {}) {
  return {
    designation: 'Tôle aluminium',
    details: '5754, 2 mm, 1000×2000, fournisseur AluPro',
    description: 'Tôle aluminium 5754, 2 mm, 1000×2000, fournisseur AluPro',
    unit: 'kg',
    unit_price: 99,
    unit_cost_ht: null,
    ai_source: 'ai_estimate' as const,
    ai_warnings: [],
    is_estimated: true,
    ...overrides,
  }
}

function sources(overrides: Partial<PriceKnowledgeSources> = {}): PriceKnowledgeSources {
  return {
    hasMetalPricing: true,
    catalogPrices: [],
    recentPrices: [],
    manualGrids: selectManualPriceGridsForAI(
      [gridRow()],
      organizationId,
      true,
      [],
      [{ id: 'supplier-current', name: 'AluPro' }],
    ),
    ...overrides,
  }
}

function quote(item: PriceKnowledgeItem): PriceKnowledgeQuote[] {
  return [{ sections: [{ items: [item] }] }]
}

describe('manual material price knowledge', () => {
  it('does not bind an unknown material to a catalogue item through an empty reference or category', () => {
    const material = { id: 'steel', name: 'Acier S235 2 mm', reference: null, category: '' }
    expect(findCatalogMatch([material], { description: 'Tôle nickel Inconel 718 épaisseur 8 mm' }, ['name', 'reference', 'category'])).toBeNull()
    expect(findCatalogMatch([material], { description: 'Acier S235 2 mm' }, ['name', 'reference', 'category'])?.id).toBe('steel')
  })

  it('rounds document quantities without changing the configured unit or manual rate', () => {
    const result = applyManualPriceKnowledge(quote(quoteItem({ quantity: 1.234567 })), sources())
    expect(result.clarification).toBeNull()
    expect(result.quotes[0].sections[0].items[0]).toMatchObject({ quantity: 1.235, unit: 'kg', unit_price: 1.25 })
  })

  it('requires a different quantity or unit when a positive quantity would persist as zero', () => {
    const result = applyManualPriceKnowledge(quote(quoteItem({ quantity: 0.000157 })), sources())
    expect(result.clarification).not.toBeNull()
    expect(result.quotes[0].sections[0].items[0].quantity).toBe(0.000157)
  })

  it('excludes foreign-organization and market-coefficient grids from AI context', () => {
    const grids = selectManualPriceGridsForAI([
      gridRow(),
      gridRow({ id: 'foreign', organization_id: 'org-other' }),
      gridRow({ id: 'legacy-market', source_type: 'lme', manual_price_eur_kg: 99 }),
    ], organizationId, true)

    expect(grids.map(grid => grid.id)).toEqual(['grid-current'])
    expect(selectManualPriceGridsForAI([gridRow()], organizationId, false)).toEqual([])
  })
  it('keeps the configured price unit, manual provenance, and linked material metadata', () => {
    const [grid] = selectManualPriceGridsForAI(
      [gridRow({ catalog_item_id: 'material-current' })],
      organizationId,
      true,
      [{ id: 'material-current', name: 'Tôle aluminium 5754' }],
      [{ id: 'supplier-current', name: 'AluPro' }],
    )

    expect(grid).toMatchObject({
      manualPricePerUnit: 1.25,
      unit: 'kg',
      sourceType: 'manual',
      metalLabel: 'Aluminium',
      catalogItemName: 'Tôle aluminium 5754',
      supplierName: 'AluPro',
      grade: '5754',
      thicknessMm: 2,
      formatLabel: '1000×2000',
    })
  })

  it('uses the exact manual price, unit, and provenance instead of the model number', () => {
    const result = applyManualPriceKnowledge(quote(quoteItem()), sources())
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toBeNull()
    expect(item).toMatchObject({ unit_price: 1.25, unit: 'kg', ai_source: 'client_input', is_estimated: false })
    expect(item.ai_warnings?.[0]).toContain('grille « Tôle aluminium 5754 »')
  })

  it('asks for clarification rather than converting a manual price into another unit', () => {
    const result = applyManualPriceKnowledge(quote(quoteItem({ unit: 'tonne' })), sources())

    expect(result.clarification).toContain('différente de l’unité demandée')
    expect(result.clarification).toContain('aucune conversion')
    expect(result.quotes[0].sections[0].items[0]).toMatchObject({ unit: 'tonne', unit_price: 99 })
  })

  it('returns a clarification when a supplier-specific manual grid is not an exact match', () => {
    const item = quoteItem({ details: '5754, 2 mm, 1000×2000', description: 'Tôle aluminium 5754, 2 mm, 1000×2000' })
    const result = applyManualPriceKnowledge(quote(item), sources())

    expect(result.clarification).toContain('Prix matière à préciser')
    expect(result.clarification).toContain('fournisseur')
    expect(result.quotes[0].sections[0].items[0].unit_price).toBe(99)
  })

  it('does not return an invented estimate when no catalogue, manual, or recent metal price exists', () => {
    const result = applyManualPriceKnowledge(quote(quoteItem()), sources({ manualGrids: [] }))

    expect(result.clarification).toContain('Aucun prix catalogue, manuel ou de devis récent')
    expect(result.clarification).toContain('prix estimé')
  })

  it('keeps exact catalogue prices ahead of the manual grid', () => {
    const result = applyManualPriceKnowledge(quote(quoteItem()), sources({
      catalogPrices: [{ name: 'Tôle aluminium', unit: 'kg', salePrice: 4.2 }],
    }))
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toBeNull()
    expect(item).toMatchObject({ unit_price: 4.2, unit: 'kg', ai_source: 'catalog', is_estimated: false })
  })

  it('preserves a user-provided unit price with client-input provenance', () => {
    const result = applyManualPriceKnowledge(
      quote(quoteItem()),
      sources({ manualGrids: [] }),
      'Fournir une tôle aluminium à 2,75 €/kg.',
    )
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toBeNull()
    expect(item).toMatchObject({ unit_price: 2.75, unit: 'kg', ai_source: 'client_input', is_estimated: false })
  })

  it('does not associate explicit prices with another steel grade sharing its thickness', () => {
    const quotes: PriceKnowledgeQuote[] = [{
      sections: [{
        items: [
          quoteItem({ designation: 'Acier S235 2 mm', details: null, description: 'Acier S235 2 mm' }),
          quoteItem({ designation: 'Acier S355 2 mm', details: null, description: 'Acier S355 2 mm' }),
        ],
      }],
    }]
    const result = applyManualPriceKnowledge(
      quotes,
      sources({ manualGrids: [] }),
      'Acier S2352mm à 2 €/kg ; acier S3552mm à 3 €/kg',
    )

    expect(result.clarification).toBeNull()
    expect(result.quotes[0].sections[0].items.map(item => item.unit_price)).toEqual([2, 3])
  })

  it('keeps explicit material and labour prices on their own units', () => {
    const quotes: PriceKnowledgeQuote[] = [{
      sections: [{
        items: [
          quoteItem({ designation: 'Tôle acier S235', details: null, description: 'Tôle acier S235' }),
          quoteItem({ designation: 'MO acier', details: null, description: 'MO acier', unit: 'h' }),
        ],
      }],
    }]
    const result = applyManualPriceKnowledge(
      quotes,
      sources({ manualGrids: [] }),
      'Tôle acier S235 à 2 €/kg ; MO acier à 45 €/h',
    )

    expect(result.clarification).toBeNull()
    expect(result.quotes[0].sections[0].items.map(item => [item.unit_price, item.unit])).toEqual([[2, 'kg'], [45, 'h']])
  })

  it('asks for a metal price even when the manual-grid feature is disabled', () => {
    const result = applyManualPriceKnowledge(
      quote(quoteItem({ designation: 'Acier S355', details: null, description: 'Acier S355' })),
      sources({ hasMetalPricing: false, manualGrids: [] }),
    )

    expect(result.clarification).toContain('Prix matière à préciser')
    expect(result.clarification).toContain('prix estimé')
  })

  it('asks for material identification when a sheet is named without its metal', () => {
    const result = applyManualPriceKnowledge(
      quote(quoteItem({ designation: 'Tôle 3 mm', details: null, description: 'Tôle 3 mm' })),
      sources({ hasMetalPricing: false, manualGrids: [] }),
    )

    expect(result.clarification).toContain('matière métallique ou sa nuance')
  })

  it('does not treat hourly steel installation as a material sale', () => {
    const result = applyManualPriceKnowledge(
      quote(quoteItem({ designation: 'Pose acier', details: null, description: 'Pose acier', unit: 'h' })),
      sources({ hasMetalPricing: false, manualGrids: [] }),
    )

    expect(result.clarification).toBeNull()
  })
  it('does not treat model-emitted text as authenticated explicit price evidence', () => {
    const result = applyManualPriceKnowledge(
      quote(quoteItem({
        designation: 'Acier S355',
        details: null,
        description: 'Acier S355 à 2 €/kg',
        unit_price: 2,
      })),
      sources({ manualGrids: [] }),
    )
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toContain('Prix matière à préciser')
    expect(item).toMatchObject({ unit_price: 2, ai_source: 'ai_estimate', is_estimated: true })
  })

  it('does not substitute the only catalogue grade when the request names another grade', () => {
    const result = applyManualPriceKnowledge(
      quote(quoteItem({
        designation: 'Tôle aluminium',
        details: '6082, 2 mm, 1000×2000',
        description: 'Tôle aluminium 6082, 2 mm, 1000×2000',
      })),
      sources({
        manualGrids: [],
        catalogPrices: [{
          name: 'Tôle aluminium',
          unit: 'kg',
          salePrice: null,
          variants: [{ label: '5754', unit: 'kg', unitPrice: 1.6 }],
        }],
      }),
    )
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toContain('variante')
    expect(item.unit_price).toBe(99)
  })

  it('matches decimal thickness before text normalization can turn it into another size', () => {
    const manualGrids = selectManualPriceGridsForAI([
      gridRow({ id: 'grid-5mm', thickness_mm: 5, manual_price_eur_kg: 99 }),
      gridRow({ id: 'grid-25mm', thickness_mm: 2.5, manual_price_eur_kg: 1.234 }),
    ], organizationId, true, [], [{ id: 'supplier-current', name: 'AluPro' }])
    const result = applyManualPriceKnowledge(
      quote(quoteItem({
        details: '5754, 2,5 mm, 1000×2000, fournisseur AluPro',
        description: 'Tôle aluminium 5754, 2,5 mm, 1000×2000, fournisseur AluPro',
      })),
      sources({ manualGrids }),
    )
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toBeNull()
    expect(item.unit_price).toBe(1.23)
    expect(item.ai_warnings?.some(warning => warning.includes('arrondi au centime'))).toBe(true)
  })

  it('clarifies rather than persisting a price that rounds to zero', () => {
    const manualGrids = selectManualPriceGridsForAI([
      gridRow({ manual_price_eur_kg: 0.004 }),
    ], organizationId, true, [], [{ id: 'supplier-current', name: 'AluPro' }])
    const result = applyManualPriceKnowledge(quote(quoteItem()), sources({ manualGrids }))
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toContain('s’arrondit à 0,00 €')
    expect(item.unit_price).toBe(99)
  })

  it('rounds explicit user prices to cents while retaining client-input provenance', () => {
    const result = applyManualPriceKnowledge(
      quote(quoteItem()),
      sources({ manualGrids: [] }),
      'Tôle aluminium 5754, 2 mm, 1000×2000, fournisseur AluPro à 1.234 €/kg',
    )
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toBeNull()
    expect(item).toMatchObject({ unit_price: 1.23, unit: 'kg', ai_source: 'client_input', is_estimated: false })
    expect(item.ai_warnings?.some(warning => warning.includes('arrondi au centime'))).toBe(true)
  })

  it('preserves prices attributed to a document with an unverified-extraction warning', () => {
    const result = applyManualPriceKnowledge(quote(quoteItem({
      ai_source: 'document',
      is_estimated: false,
      unit_price: 3.1,
    })), sources({ manualGrids: [] }), '', true)
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toBeNull()
    expect(item).toMatchObject({ unit_price: 3.1, ai_source: 'document', is_estimated: false })
    expect(item.ai_warnings?.[0]).toContain('sans vérification indépendante')
  })

  it('does not block unrelated labour estimates and rounds the returned amount to cents', () => {
    const labor = quoteItem({
      designation: 'Pose d’isolation',
      details: null,
      description: 'Pose d’isolation',
      unit: 'h',
      unit_price: 50.123,
    })
    const result = applyManualPriceKnowledge(quote(labor), sources())
    const item = result.quotes[0].sections[0].items[0]

    expect(result.clarification).toBeNull()
    expect(item).toMatchObject({ unit_price: 50.12, ai_source: 'ai_estimate', is_estimated: true })
  })
})
