import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MEASUREMENT_SETTINGS,
  buildMeasurementItems,
  deriveApproxPerimeter,
  evaluateMeasurementFormula,
  hasBlockingMeasurementIssues,
  type PlanMeasurementResult,
  type PlanMeasurementRoom,
} from '@/lib/plan-measurement'

const room: PlanMeasurementRoom = {
  id: 'room-1',
  name: 'Chambre 1',
  kind: 'interior',
  area_m2: 10.5,
  perimeter_m: 13,
  height_m: 2.5,
  confidence: 0.9,
  evidence: [{ label: 'Cotes 3,50 × 3,00 m', source: 'printed_dimension', value: '3.50x3.00' }],
  assumptions: [],
  warnings: [],
}

describe('evaluateMeasurementFormula', () => {
  it('évalue une formule avec les pertes explicites', () => {
    expect(evaluateMeasurementFormula('A * (1 + waste)', { A: 10.5, waste: 0.08 })).toBe(11.34)
  })

  it('refuse une variable manquante au lieu de la remplacer par zéro', () => {
    expect(() => evaluateMeasurementFormula('P * H - O', { P: 13, H: 2.5 })).toThrow('Variable manquante : O')
  })

  it('refuse les variables hors contrat', () => {
    expect(() => evaluateMeasurementFormula('surface * 2', { surface: 10 })).toThrow('Variable inconnue : surface')
  })
})

describe('buildMeasurementItems', () => {
  it('conserve le référentiel T3 : 64,9 m² habitables et terrasse séparée', () => {
    const rooms: PlanMeasurementRoom[] = [
      ['Pièce de vie', 'interior', 30, 22],
      ['Hall', 'interior', 8.4, 11.6],
      ['SDB + WC', 'interior', 5, 9],
      ['Chambre 1', 'interior', 10.5, 13],
      ['Chambre 2', 'interior', 11, 14],
      ['Terrasse', 'exterior', 9, 15],
    ].map(([name, kind, area, perimeter], index) => ({
      id: `t3-${index}`, name: String(name), kind: kind as 'interior' | 'exterior', area_m2: Number(area), perimeter_m: Number(perimeter),
      height_m: kind === 'interior' ? 2.5 : null, confidence: 1, evidence: [], assumptions: [], warnings: [],
    }))
    expect(rooms.filter(candidate => candidate.kind === 'interior').reduce((sum, candidate) => sum + (candidate.area_m2 ?? 0), 0)).toBe(64.9)
    const items = buildMeasurementItems({ rooms, openings: [], scope: { projectType: 'renovation', selectedTrades: ['sols'], workScopes: { sols: 'replace' } }, settings: DEFAULT_MEASUREMENT_SETTINGS })
    expect(items.some(item => item.roomName === 'Terrasse')).toBe(false)
  })

  it('ne produit que les lots sélectionnés et applique les mêmes pertes que l’interface', () => {
    const items = buildMeasurementItems({
      rooms: [room],
      openings: [],
      scope: { projectType: 'renovation', selectedTrades: ['sols'], workScopes: { sols: 'replace' } },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
    })

    expect(items.every(item => item.tradeId === 'sols')).toBe(true)
    expect(items.find(item => item.id.endsWith(':floor'))?.quantity).toBe(11.34)
    expect(items.find(item => item.id.endsWith(':floor'))?.formulaVariables.waste).toBe(0.08)
  })

  it('déduit les ouvertures cotées des murs', () => {
    const items = buildMeasurementItems({
      rooms: [room],
      openings: [{
        id: 'door-1', roomId: room.id, roomName: room.name, type: 'door', quantity: 1,
        width_m: 0.83, height_m: 2.04, confidence: 0.95, evidence: [], warnings: [],
      }],
      scope: { projectType: 'renovation', selectedTrades: ['peinture'], workScopes: { peinture: 'replace' } },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
    })

    const walls = items.find(item => item.id.endsWith(':walls'))
    expect(walls?.formulaVariables.O).toBeCloseTo(1.6932)
    expect(walls?.quantity).toBeCloseTo(61.61, 1)
  })

  it('ne crée aucune ligne pour un lot à conserver', () => {
    expect(buildMeasurementItems({
      rooms: [room], openings: [],
      scope: { projectType: 'renovation', selectedTrades: ['carrelage'], workScopes: { carrelage: 'preserve' } },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
    })).toEqual([])
  })
})

describe('deriveApproxPerimeter', () => {
  it('applique P ≈ 4·√A · 1,1', () => {
    expect(deriveApproxPerimeter(30)).toBeCloseTo(24.11, 1)
    expect(deriveApproxPerimeter(10.5)).toBeCloseTo(14.26, 1)
  })
})

describe('buildMeasurementItems — périmètre dérivé quand seule la surface est connue', () => {
  const roomWithoutPerimeter: PlanMeasurementRoom = {
    id: 'room-2', name: 'Pièce de vie', kind: 'interior', area_m2: 30, perimeter_m: null, height_m: 2.5,
    confidence: 0.92, evidence: [{ label: '30 m²', source: 'printed_area', value: '30' }], assumptions: [], warnings: [],
  }

  it('génère quand même les lignes murs, avec la valeur dérivée', () => {
    const items = buildMeasurementItems({
      rooms: [roomWithoutPerimeter], openings: [],
      scope: { projectType: 'renovation', selectedTrades: ['peinture'], workScopes: { peinture: 'replace' } },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
    })
    const walls = items.find(item => item.id.endsWith(':walls'))
    expect(walls).toBeDefined()
    expect(walls?.formulaVariables.P).toBeCloseTo(deriveApproxPerimeter(30), 2)
  })

  it('marque la ligne comme hypothèse (allowance), critique, et avec confiance réduite', () => {
    const items = buildMeasurementItems({
      rooms: [roomWithoutPerimeter], openings: [],
      scope: { projectType: 'renovation', selectedTrades: ['peinture'], workScopes: { peinture: 'replace' } },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
    })
    const walls = items.find(item => item.id.endsWith(':walls'))
    expect(walls?.sourceKind).toBe('allowance')
    expect(walls?.critical).toBe(true)
    expect(walls?.confidence).toBeLessThan(roomWithoutPerimeter.confidence!)
    expect(walls?.warnings.some(w => w.includes('estimé depuis la surface'))).toBe(true)
    expect(walls?.evidence.some(e => e.source === 'assumption')).toBe(true)
  })

  it('ne dérive rien pour les lignes basées uniquement sur la surface (plafond, sol)', () => {
    const items = buildMeasurementItems({
      rooms: [roomWithoutPerimeter], openings: [],
      scope: { projectType: 'renovation', selectedTrades: ['sols'], workScopes: { sols: 'replace' } },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
    })
    const floor = items.find(item => item.id.endsWith(':floor'))
    expect(floor?.sourceKind).toBe('derived')
    const skirting = items.find(item => item.id.endsWith(':skirting'))
    expect(skirting?.sourceKind).toBe('allowance')
  })

  it('préfère le périmètre réel dès qu’il est disponible, sans dérivation', () => {
    const items = buildMeasurementItems({
      rooms: [room], openings: [],
      scope: { projectType: 'renovation', selectedTrades: ['peinture'], workScopes: { peinture: 'replace' } },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
    })
    const walls = items.find(item => item.id.endsWith(':walls'))
    expect(walls?.formulaVariables.P).toBe(13)
    expect(walls?.sourceKind).toBe('derived')
  })

  it('sans surface ni périmètre, aucune ligne murale n’est produite', () => {
    const roomWithNothing: PlanMeasurementRoom = {
      id: 'room-3', name: 'Pièce sans cotes', kind: 'interior', area_m2: null, perimeter_m: null, height_m: null,
      confidence: 0.3, evidence: [], assumptions: [], warnings: [],
    }
    const items = buildMeasurementItems({
      rooms: [roomWithNothing], openings: [],
      scope: { projectType: 'renovation', selectedTrades: ['peinture'], workScopes: { peinture: 'replace' } },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
    })
    expect(items.find(item => item.id.endsWith(':walls'))).toBeUndefined()
  })
})

describe('hasBlockingMeasurementIssues', () => {
  it('bloque une calibration critique ou une ligne critique en attente', () => {
    const base = {
      id: 'measurement-1', title: 'Test', sourceName: 'plan.png', rooms: [room], openings: [], observations: [], globalWarnings: [],
      scope: { projectType: 'renovation' as const, selectedTrades: ['sols' as const], workScopes: {} },
      settings: DEFAULT_MEASUREMENT_SETTINGS,
      scale: { detected: true, value: '1:100', confidence: 0.9, needsCalibration: false, evidence: [], assumptions: [] },
      needsCalibration: false, rulesVersion: 'test', items: [],
    } satisfies PlanMeasurementResult

    expect(hasBlockingMeasurementIssues({ ...base, needsCalibration: true })).toBe(true)
    expect(hasBlockingMeasurementIssues(base)).toBe(false)
  })
})
