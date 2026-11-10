import { describe, expect, it } from 'vitest'
import { computeManualMetalQuantity, type MetalCode } from '@/lib/metal-prices'

const grid = (unit: string, thickness_mm: number | null = 2) => ({ metal_code: 'STEEL' as MetalCode, unit, thickness_mm })

describe('quantités des grilles matières manuelles', () => {
  it.each([
    ['kg', 188.4],
    ['m²', 12],
    ['ml', 4],
    ['pièce', 2],
  ])('conserve l’unité %s pour deux pièces de 2 × 3 m', (unit, expected) => {
    expect(computeManualMetalQuantity(grid(unit), 2, 3, 2)).toBeCloseTo(expected, 8)
  })

  it('ne requiert pas une épaisseur pour une facturation à la surface ou à la longueur', () => {
    expect(computeManualMetalQuantity(grid('m²', null), 2, 3, 2)).toBe(12)
    expect(computeManualMetalQuantity(grid('ml', null), 2, null, 2)).toBe(4)
    expect(computeManualMetalQuantity(grid('pièce', null), null, null, 2)).toBe(2)
  })

  it.each(['kg', 'tonne'])('ne devine pas le poids en %s sans épaisseur ou dimensions', unit => {
    expect(computeManualMetalQuantity(grid(unit, null), 2, 3)).toBeNull()
    expect(computeManualMetalQuantity(grid(unit), 2, null)).toBeNull()
  })

  it('laisse les tonnes en saisie manuelle pour respecter la précision stockée', () => {
    expect(computeManualMetalQuantity(grid('tonne'), 0.1, 0.1)).toBeNull()
    expect(computeManualMetalQuantity(grid('tonne'), 2, 3, 2)).toBeNull()
  })

  it('arrondit les quantités calculées aux trois décimales du document', () => {
    expect(computeManualMetalQuantity(grid('m²'), 1.234, 2.345)).toBe(2.894)
    expect(computeManualMetalQuantity(grid('kg'), 0.001, 0.001)).toBe(0)
  })

  it.each([0, -1, NaN, Infinity])('refuse un nombre de pièces invalide (%s)', count => {
    expect(computeManualMetalQuantity(grid('kg'), 2, 3, count)).toBeNull()
  })

  it('ne convertit pas une unité inconnue et refuse une quantité non finie', () => {
    expect(computeManualMetalQuantity(grid('m³'), 2, 3)).toBeNull()
    expect(computeManualMetalQuantity(grid('m²'), Infinity, 3)).toBeNull()
  })
})
