import { describe, expect, it } from 'vitest'
import {
  autoMapColumns, blankLaborForm, blankMaterialForm, dimensionError, equipmentCostPerUse, filterLabor, filterMaterials, filterSuppliers,
  getLaborImportConfig, getMaterialImportConfig, laborFormData, laborMarginPct, laborUpdatePayload, mapImportRows, marginFrom,
  materialAfterUpdate, materialFormData, materialToForm, materialUpdatePayload, mergeCategories, salePriceFrom, visibleSlice,
  withDimensionMode, withEquipmentField, withLaborType, withPricing,
} from '@/app/(app)/catalog/catalogModel'
import { parseCSV } from '@/app/(app)/catalog/catalogImport'
import type { CatalogLaborRate, CatalogMaterial } from '@/lib/data/queries/catalog'
import type { Supplier } from '@/lib/data/queries/suppliers'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'

const material = (over: Partial<CatalogMaterial> = {}) => ({
  id: 'm1', organization_id: 'o1', name: 'Carrelage 60x60', reference: 'FOU-002', item_kind: 'article', unit: 'm²', category: 'Carrelage',
  supplier: 'Point P', supplier_id: 's1', purchase_price: 28, margin_rate: 45, sale_price: 40.6, description: null,
  dimension_pricing_mode: 'none', base_length_m: null, base_width_m: null, base_height_m: null, dimension_schema: null, price_variants: [], ...over,
}) as CatalogMaterial

const ctx = { resourceTypeOptions: [{ value: 'human', label: 'Humain' }, { value: 'equipment', label: 'Équipement' }], unitSetsByKind: { laborRate: ['h', 'jour'] }, businessProfile: 'building' } as unknown as ResolvedCatalogContext

describe('catalogue : prix', () => {
  it('calcule prix de vente, marge et coût par usage', () => {
    expect(salePriceFrom('28', '45')).toBe('40.60')
    expect(salePriceFrom('28', '')).toBe('')
    expect(marginFrom('28', '40.6')).toBe('45')
    expect(marginFrom('', '40')).toBe('')
    expect(equipmentCostPerUse('18000', '900')).toBe('20.00')
    expect(equipmentCostPerUse('18000', '0')).toBe('')
    expect(laborMarginPct(38, 62)).toBe(39)
    expect(laborMarginPct(null, 62)).toBeNull()
  })

  it('recalcule le prix de vente, ou la marge si le prix est saisi', () => {
    let f = blankMaterialForm('article')
    f = withPricing(f, 'purchasePrice', '10')
    expect(f.salePrice).toBe('')
    f = withPricing(f, 'marginRate', '50')
    expect(f.salePrice).toBe('15.00')
    f = withPricing(f, 'salePrice', '20')
    expect(f.marginRate).toBe('100')
    expect(f.salePrice).toBe('20')
  })

  it('règle l’unité selon le mode de dimensions et contrôle les dimensions de référence', () => {
    let f = withDimensionMode(blankMaterialForm('article'), 'area')
    expect(f.unit).toBe('m²')
    expect(dimensionError(f)).toBeNull()
    expect(dimensionError({ ...f, baseWidth: '' })).toMatch(/largeur/)
    f = withDimensionMode(f, 'volume')
    expect(dimensionError(f)).toMatch(/hauteur/)
    expect(dimensionError({ ...f, baseLength: '0' })).toMatch(/longueur/)
    expect(dimensionError(withDimensionMode(f, 'none'))).toBeNull()
  })
})

describe('catalogue : listes et formulaires', () => {
  it('filtre par onglet et recherche, et affiche par pages de 10', () => {
    const list = [material(), material({ id: 'm2', name: 'Pose carrelage', item_kind: 'service', reference: 'MO-001' })]
    expect(filterMaterials(list, 'materials', '').map(m => m.id)).toEqual(['m1'])
    expect(filterMaterials(list, 'services', 'mo-0').map(m => m.id)).toEqual(['m2'])
    expect(filterMaterials(list, 'materials', 'point p').map(m => m.id)).toEqual(['m1'])
    const many = Array.from({ length: 23 }, (_, i) => i)
    expect(visibleSlice(many, 10)).toMatchObject({ rest: 13 })
    expect(visibleSlice(many, 30)).toMatchObject({ rest: 0 })
    expect(mergeCategories(['Carrelage', 'Plomberie'], ['Plomberie', null, 'Isolation'])).toEqual(['Carrelage', 'Plomberie', 'Isolation'])
    expect(filterLabor([{ designation: 'Carreleur', reference: 'RES-2', category: 'Taux' } as CatalogLaborRate], 'res-2')).toHaveLength(1)
    expect(filterSuppliers([{ name: 'Cedeo', contact_name: 'Sonia', email: null, phone: '04' } as Supplier], 'sonia')).toHaveLength(1)
  })

  it('ressort du formulaire la charge utile attendue, avec la catégorie créée à la volée', () => {
    const form = { ...materialToForm(material()), category: '__new__', newCategory: ' Faïence ' }
    const payload = materialUpdatePayload(form, 'article', [{ id: 's1', name: ' Point P ' } as Supplier])
    expect(payload.category).toBe('Faïence')
    expect(payload.supplier).toBe('Point P')
    expect(payload.sale_price).toBe(40.6)
    expect(payload.dimension_pricing_enabled).toBe(false)
    expect(payload.base_width_m).toBeNull()
    const after = materialAfterUpdate(material(), payload, '2026-11-06T00:00:00Z')
    expect(after.category).toBe('Faïence')
    expect(after.id).toBe('m1')
  })

  it('garde variantes et dimensions dans un aller-retour', () => {
    const m = material({
      dimension_pricing_mode: 'area', base_length_m: 2, base_width_m: 1,
      price_variants: [{ id: 'v1', material_id: 'm1', organization_id: 'o1', position: 0, label: '2 × 1 m', reference_suffix: 'T2', dimension_values: { length_m: 2, width_m: 1 }, purchase_price: 17, sale_price: 22.1, is_default: true }] as unknown as CatalogMaterial['price_variants'],
    })
    const form = materialToForm(m)
    expect(form.variants[0]).toMatchObject({ label: '2 × 1 m', sale_price: '22.1', is_default: true })
    const payload = materialUpdatePayload(form, 'article', [])
    expect(payload.price_variants[0]).toMatchObject({ label: '2 × 1 m', sale_price: 22.1, purchase_price: 17, position: 0 })
    expect(payload.base_length_m).toBe(2)
    expect(payload.base_width_m).toBe(1)
    const fd = materialFormData({ ...form, name: 'Tôle' }, 'article')
    expect(fd.get('name')).toBe('Tôle')
    expect(fd.get('dimension_pricing_mode')).toBe('area')
    expect(fd.get('supplier_id')).toBe('s1')
    expect(materialFormData(form, 'service').get('supplier_id')).toBeNull()
  })

  it('amortit un équipement et envoie les bons champs de ressource', () => {
    let f = { ...blankLaborForm(ctx), designation: 'Mini-pelle', rate: '' }
    f = withLaborType(f, 'equipment')
    expect(f.unit).toBe('usage')
    f = withEquipmentField(f, 'purchasePrice', '18000')
    f = withEquipmentField(f, 'uses', '900')
    expect(f.costRate).toBe('20.00')
    const fd = laborFormData(f)
    expect(fd.get('purchase_price')).toBe('18000')
    expect(fd.get('lifetime_uses')).toBe('900')
    expect(laborUpdatePayload(f)).toMatchObject({ lifetime_uses: 900, purchase_price: 18000, cost_rate: 20 })
    const human = laborFormData({ ...f, type: 'human' })
    expect(human.get('purchase_price')).toBeNull()
    expect(laborUpdatePayload({ ...f, type: 'human' }).lifetime_uses).toBeNull()
  })
})

describe('catalogue : import', () => {
  it('lit un CSV avec séparateur point-virgule et guillemets', () => {
    expect(parseCSV('Nom;Prix\n"Colle; C2";14\n\n')).toEqual([['Nom', 'Prix'], ['Colle; C2', '14']])
    expect(parseCSV('a,b\r\n1,2')).toEqual([['a', 'b'], ['1', '2']])
  })

  it('associe les colonnes et convertit les lignes', () => {
    const { fields } = getLaborImportConfig(ctx)
    const map = autoMapColumns(fields, ['Désignation', 'Référence', 'Coût interne', 'Autre'])
    expect(map.designation).toBe('0')
    expect(map.reference).toBe('1')
    expect(map.cost_rate).toBe('2')
    const rows = mapImportRows(fields, [['Plombier', 'RES-3', '42', 'x']], { ...map, unit: '' })
    expect(rows[0]).toMatchObject({ designation: 'Plombier', reference: 'RES-3', cost_rate: '42', unit: '' })
    expect(getMaterialImportConfig(ctx).fields[0].required).toBe(true)
    expect(getMaterialImportConfig({ ...ctx, businessProfile: 'cleaning' } as ResolvedCatalogContext).exampleRow[10]).toBe('none')
  })
})
