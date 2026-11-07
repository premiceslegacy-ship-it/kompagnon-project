import { describe, expect, it } from 'vitest'
import {
  applyEquipment, applyTransport, blankSection, buildEquipmentLabel, costPerUse, equipmentInitial, fuelLiters, headerPayload, itemsPayload,
  lineAmount, lineTitle, modeleTotals, newLocalItem, parseEquipmentLabel, pickLaborRate, pickMaterial, sectionsFromItems, transportInitial,
  upsertItem, withLineType, type LocalItem,
} from '@/app/(app)/catalog/modelesModel'
import type { CatalogLaborRate, CatalogMaterial, PrestationTypeItem } from '@/lib/data/queries/catalog'

const item = (over: Partial<LocalItem>): LocalItem => ({ ...newLocalItem('free'), ...over })

describe('modèles de devis', () => {
  it('regroupe les lignes en sections selon leur titre et leur position', () => {
    const rows = [
      { id: 'b', position: 2, section_title: 'Pose', item_type: 'service', designation: 'Pose', quantity: 1, unit: 'forfait', unit_price_ht: 100, unit_cost_ht: 0, is_internal: false, material_id: null, labor_rate_id: null },
      { id: 'a', position: 0, section_title: 'Dépose', item_type: 'free', designation: 'Gravats', quantity: 1, unit: 'forfait', unit_price_ht: 50, unit_cost_ht: 20, is_internal: false, material_id: null, labor_rate_id: null },
      { id: 'c', position: 1, section_title: 'Dépose', item_type: 'free', designation: 'Évacuation', quantity: 2, unit: 'u', unit_price_ht: 10, unit_cost_ht: 5, is_internal: false, material_id: null, labor_rate_id: null },
    ] as PrestationTypeItem[]
    const s = sectionsFromItems(rows)
    expect(s.map(x => x.title)).toEqual(['Dépose', 'Pose'])
    expect(s[0].items.map(i => i.tempId)).toEqual(['a', 'c'])
    expect(sectionsFromItems([])).toHaveLength(1)
  })

  it('calcule prix client, coût et marge en ignorant le prix des lignes internes', () => {
    const s = [{ tempId: 's', title: '', items: [
      item({ quantity: '12', unit_price_ht: '40.6', unit_cost_ht: '28' }),
      item({ item_type: 'labor', is_internal: true, quantity: '16', unit_price_ht: '38', unit_cost_ht: '38' }),
    ] }]
    const t = modeleTotals(s)
    expect(t.price).toBeCloseTo(487.2)
    expect(t.cost).toBeCloseTo(944)
    expect(t.marginPct).toBeLessThan(0)
    expect(t.hasInternal).toBe(true)
    expect(modeleTotals([blankSection()])).toMatchObject({ price: 0, marginPct: null, count: 0 })
    expect(lineAmount(s[0].items[1])).toBe(608)
    expect(lineAmount(s[0].items[0])).toBeCloseTo(487.2)
  })

  it('amortit un équipement et garde son nom lisible', () => {
    expect(costPerUse(18000, 900)).toBe(20)
    expect(costPerUse(100, 0)).toBe(0)
    const base = item({ item_type: 'equipment', designation: 'Aspirateur' })
    const applied = applyEquipment(base, 600, 150)
    expect(applied).toMatchObject({ quantity: '1', unit: 'usage', unit_cost_ht: '4', unit_price_ht: '0', is_internal: true })
    expect(parseEquipmentLabel(applied.designation)).toEqual({ name: 'Aspirateur', purchasePrice: 600, lifetimeUses: 150 })
    expect(lineTitle(applied)).toBe('Aspirateur')
    expect(equipmentInitial(applied)).toEqual({ purchase: 600, uses: 150 })
    expect(applyEquipment(base, 0, 150)).toBe(base)
    expect(buildEquipmentLabel('', 0, 0)).toBe('Équipement amorti')
  })

  it('calcule le carburant d’un trajet', () => {
    expect(fuelLiters(80, 7)).toBe(5.6)
    const t = applyTransport(item({ item_type: 'transport' }), 80, 7, 1.9)
    expect(t).toMatchObject({ quantity: '5.6', unit: 'L', unit_cost_ht: '1.9', designation: 'Carburant - trajet 80 km' })
    expect(applyTransport(t, 0, 7, 1.9)).toBe(t)
    expect(applyTransport({ ...t, designation: 'Trajet chantier' }, 100, 8, 2).designation).toBe('Trajet chantier')
    expect(transportInitial(t).pricePerLiter).toBe(1.9)
  })

  it('reprend les valeurs du catalogue et réinitialise au changement de type', () => {
    const mat = { id: 'm1', name: 'Carrelage', unit: 'm²', sale_price: 40.6, purchase_price: 28 } as CatalogMaterial
    const lr = { id: 'l1', designation: 'Carreleur', unit: 'h', cost_rate: 38, rate: 60 } as CatalogLaborRate
    const withMat = pickMaterial(newLocalItem('material'), mat)
    expect(withMat).toMatchObject({ material_id: 'm1', unit: 'm²', unit_price_ht: '40.6', unit_cost_ht: '28' })
    expect(pickLaborRate(newLocalItem('labor'), lr)).toMatchObject({ labor_rate_id: 'l1', unit_price_ht: '38', unit_cost_ht: '38' })
    const changed = withLineType(withMat, 'labor')
    expect(changed).toMatchObject({ item_type: 'labor', material_id: null, unit: 'h', is_internal: true })
  })

  it('produit la charge utile avec positions continues et règles d’équipement', () => {
    const eq = applyEquipment(item({ item_type: 'equipment', designation: 'Aspirateur' }), 600, 150)
    const sections = [
      { tempId: 'a', title: ' Dépose ', items: [item({ designation: '  ', quantity: 'abc' })] },
      { tempId: 'b', title: '', items: [eq, item({ designation: 'Pose', quantity: '2', unit_price_ht: '30' })] },
    ]
    const p = itemsPayload(sections)
    expect(p.map(x => x.position)).toEqual([0, 1, 2])
    expect(p[0]).toMatchObject({ section_title: 'Dépose', designation: '-', quantity: 1 })
    expect(p[1]).toMatchObject({ item_type: 'equipment', quantity: 1, unit: 'usage', unit_price_ht: 0, is_internal: true, unit_cost_ht: 4 })
    expect(p[2]).toMatchObject({ quantity: 2, unit_price_ht: 30 })
    expect(headerPayload({ name: ' Salle de bain ', description: '  ', is_active: false })).toMatchObject({ name: 'Salle de bain', description: null, isActive: false, unit: 'forfait' })
  })

  it('remplace une ligne existante ou ajoute une nouvelle en fin de section', () => {
    const a = item({ tempId: 'x', designation: 'A' })
    const sections = [{ tempId: 's', title: '', items: [a] }, { tempId: 't', title: '', items: [] }]
    const replaced = upsertItem(sections, 's', { ...a, designation: 'B' })
    expect(replaced[0].items[0].designation).toBe('B')
    const added = upsertItem(sections, 't', item({ tempId: 'y' }))
    expect(added[1].items.map(i => i.tempId)).toEqual(['y'])
    expect(added[0].items).toHaveLength(1)
  })
})
