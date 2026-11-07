import { describe, expect, it } from 'vitest'
import {
  ACCEPTED_MIME_TYPES,
  formulaVariablesForItem,
  fmtPrice,
  joinNotes,
  measurementToQuote,
  splitDetails,
} from '@/app/(app)/atelier-ia/atelierIAModel'
import { DEFAULT_MEASUREMENT_SETTINGS, type PlanMeasurementItem, type PlanMeasurementResult } from '@/lib/plan-measurement'

describe('lecture des désignations', () => {
  it('sépare la désignation du détail « Comprend »', () => {
    expect(splitDetails('Pose carrelage\n\nComprend :\nColle\nJoints')).toEqual({ designation: 'Pose carrelage', details: 'Colle\nJoints' })
    expect(splitDetails('Simple')).toEqual({ designation: 'Simple', details: '' })
    expect(splitDetails(null)).toEqual({ designation: '', details: '' })
  })

  it('assemble les notes ou rien', () => {
    expect(joinNotes('Hypothèses', ['a', 'b'])).toBe('Hypothèses : a ; b')
    expect(joinNotes('Hypothèses', [])).toBeNull()
    expect(joinNotes('Hypothèses', undefined)).toBeNull()
  })

  it('affiche un prix ou un tiret', () => {
    expect(fmtPrice(0)).toBe('-')
    expect(fmtPrice(12.5).replace(/[\s  ]/g, '')).toBe('12,50€')
  })

  it('accepte PDF, PNG et JPEG', () => {
    expect([...ACCEPTED_MIME_TYPES].sort()).toEqual(['application/pdf', 'image/jpeg', 'image/jpg', 'image/png'])
  })
})

describe('variables de formule', () => {
  const item = { quantity: 5, length_m: 3, width_m: 2, height_m: null, dim_quantity: 4, formulaVariables: { L: 1, W: 1, H: 1, N: 1, waste: 0, spacing: 0, coats: 1 } } as unknown as PlanMeasurementItem

  it('reprend les cotes de la ligne et les réglages du projet', () => {
    const v = formulaVariablesForItem(item, { ...DEFAULT_MEASUREMENT_SETTINGS, defaultHeightM: 2.6, wastePct: 10, studSpacingM: 0.6, paintCoats: 2 })
    expect(v).toMatchObject({ L: 3, W: 2, H: 2.6, N: 4, waste: 0.1, spacing: 0.6, coats: 2, quantity: 5 })
  })

  it('ne crée pas une variable absente de la formule', () => {
    const v = formulaVariablesForItem({ ...item, formulaVariables: { L: 1 } } as PlanMeasurementItem, DEFAULT_MEASUREMENT_SETTINGS)
    expect(Object.keys(v).sort()).toEqual(['L', 'quantity'])
  })
})

describe('du métré au devis', () => {
  const line = (over: Record<string, unknown>) => ({
    id: 'i', designation: 'Cloison', trade: 'Placo', tradeId: 'placo', roomName: 'Salon', quantity: 12, unit: 'm²', formula: 'L*H', assumptions: ['HSP 2,5'], warnings: [],
    confidence: 0.9, validationStatus: 'validated', sourceKind: 'measured', formulaVariables: {}, evidence: [], rulesVersion: 'v', ...over,
  }) as unknown as PlanMeasurementItem
  const result = {
    title: '', id: 'm1', globalWarnings: ['Plan flou'], needsCalibration: true, settings: DEFAULT_MEASUREMENT_SETTINGS,
    items: [line({}), line({ id: 'x', designation: 'Exclue', validationStatus: 'excluded' }), line({ id: 'y', designation: 'Douteuse', confidence: 0.4, roomName: ' ' })],
  } as unknown as PlanMeasurementResult

  it('regroupe par lot et pièce, sans les lignes exclues', () => {
    const quote = measurementToQuote(result)
    expect(quote.title).toBe('Pré-métré depuis plan')
    expect(quote.sections.map(s => s.title)).toEqual(['Placo (Salon)', 'Placo (Général)'])
    expect(quote.sections.flatMap(s => s.items).map(i => i.designation)).toEqual(['Cloison', 'Douteuse'])
  })

  it('laisse les prix à renseigner et marque les lignes comme estimées', () => {
    const item = measurementToQuote(result).sections[0].items[0]
    expect(item).toMatchObject({ unit_price: 0, is_estimated: true, quantity: 12, vat_rate: 20 })
    expect(item.description).toContain('Prix à renseigner après validation du métré.')
  })

  it('prévient pour la calibration, les alertes du plan et les lignes peu fiables', () => {
    const warnings = measurementToQuote(result).quoteWarnings ?? []
    expect(warnings).toContain('Plan flou')
    expect(warnings).toContain('Échelle ou cotes à confirmer avant devis définitif.')
    expect(warnings.some(w => w.includes('Douteuse') && w.includes('confiance faible'))).toBe(true)
  })
})
