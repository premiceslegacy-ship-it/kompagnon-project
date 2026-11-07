// @atelier-migrated
// Modèles de devis : lignes, sections, totaux et charge utile (aucun accès réseau, aucun état React).

import type { CatalogLaborRate, CatalogMaterial, PrestationItemType, PrestationTypeItem } from '@/lib/data/queries/catalog'
import { getCatalogSaleUnitPrice, getInternalResourceUnitCost } from '@/lib/catalog-ui'

export type LineType = PrestationItemType

export type LocalItem = {
  tempId: string
  item_type: LineType
  material_id: string | null
  labor_rate_id: string | null
  designation: string
  quantity: string
  unit: string
  unit_price_ht: string
  unit_cost_ht: string
  is_internal: boolean
  save_to_catalog: boolean
}

export type Section = { tempId: string; title: string; items: LocalItem[] }

export type ModeleHeader = { name: string; description: string; is_active: boolean }

export const LINE_TYPES: LineType[] = ['service', 'labor', 'material', 'transport', 'equipment', 'free']

export const LINE_HELP: Record<LineType, string> = {
  service: 'Vendue au client',
  labor: 'Coût interne',
  material: 'Depuis le catalogue',
  transport: 'Carburant, trajet',
  equipment: 'Amorti par usage',
  free: 'Texte libre',
}

export const DEFAULT_INTERNAL: Record<LineType, boolean> = {
  service: false, labor: true, transport: true, material: false, free: false, equipment: true,
}

export const UNITS = ['h', 'j', 'sem', 'u', 'm²', 'ml', 'kg', 'L', 'forfait', 't', 'm³']

let counter = 0
export const uid = () => `t${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`

export const blankHeader = (): ModeleHeader => ({ name: '', description: '', is_active: true })
export const blankSection = (title = ''): Section => ({ tempId: uid(), title, items: [] })

export function defaultUnit(type: LineType): string {
  return type === 'labor' ? 'h' : type === 'transport' ? 'L' : type === 'service' ? 'forfait' : type === 'equipment' ? 'usage' : 'u'
}

export function newLocalItem(type: LineType = 'free'): LocalItem {
  return {
    tempId: uid(), item_type: type, material_id: null, labor_rate_id: null, designation: '', quantity: '1', unit: defaultUnit(type),
    unit_price_ht: '0', unit_cost_ht: '0', is_internal: DEFAULT_INTERNAL[type], save_to_catalog: false,
  }
}

export function toLocalItem(i: PrestationTypeItem): LocalItem {
  return {
    tempId: i.id, item_type: i.item_type, material_id: i.material_id, labor_rate_id: i.labor_rate_id, designation: i.designation,
    quantity: String(i.quantity), unit: i.unit, unit_price_ht: String(i.unit_price_ht), unit_cost_ht: String(i.unit_cost_ht),
    is_internal: i.is_internal, save_to_catalog: false,
  }
}

/** Sections d'un modèle existant : lignes regroupées par titre de section, dans l'ordre des positions. */
export function sectionsFromItems(items: PrestationTypeItem[] | undefined | null): Section[] {
  const sorted = [...(items ?? [])].sort((a, b) => a.position - b.position)
  const map = new Map<string, LocalItem[]>()
  for (const it of sorted) {
    const key = it.section_title || ''
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(toLocalItem(it))
  }
  if (map.size === 0) return [blankSection()]
  return [...map.entries()].map(([title, items]) => ({ tempId: uid(), title, items }))
}

/** Changer le type d'une ligne repart des valeurs par défaut du type (le catalogue lié est oublié). */
export function withLineType(item: LocalItem, type: LineType): LocalItem {
  return { ...item, item_type: type, is_internal: DEFAULT_INTERNAL[type], material_id: null, labor_rate_id: null, unit: defaultUnit(type) }
}

export function pickMaterial(item: LocalItem, mat: CatalogMaterial): LocalItem {
  return { ...item, material_id: mat.id, labor_rate_id: null, designation: mat.name, unit: mat.unit ?? 'u', unit_price_ht: String(getCatalogSaleUnitPrice(mat)), unit_cost_ht: String(mat.purchase_price ?? 0) }
}

export function pickLaborRate(item: LocalItem, lr: CatalogLaborRate): LocalItem {
  const cost = getInternalResourceUnitCost(lr)
  return { ...item, labor_rate_id: lr.id, material_id: null, designation: lr.designation, unit: lr.unit ?? 'h', unit_price_ht: String(cost), unit_cost_ht: String(cost) }
}

// ─── Équipement amorti ────────────────────────────────────────────────────────

export function parseEquipmentLabel(designation: string) {
  const match = designation.match(/Amortissement\s*:\s*([\d.,]+)\s*€\s*\/\s*([\d.,]+)\s*usages?/i)
  const name = (designation.split(/\n/)[0] ?? '').trim()
  const purchase = match ? Number(match[1].replace(',', '.')) : null
  const uses = match ? Number(match[2].replace(',', '.')) : null
  return {
    name,
    purchasePrice: purchase != null && Number.isFinite(purchase) ? purchase : null,
    lifetimeUses: uses != null && Number.isFinite(uses) ? uses : null,
  }
}

export function buildEquipmentLabel(name: string, purchase: number, uses: number): string {
  const label = name.trim() || 'Équipement amorti'
  return purchase > 0 && uses > 0 ? `${label}\n\nAmortissement : ${purchase} € / ${uses} usages` : label
}

export const costPerUse = (purchase: number, uses: number) => (uses > 0 ? Math.round((purchase / uses) * 100) / 100 : 0)

export function equipmentInitial(item: LocalItem) {
  if (item.item_type !== 'equipment') return { purchase: 0, uses: 100 }
  const meta = parseEquipmentLabel(item.designation)
  return { purchase: meta.purchasePrice ?? (parseFloat(item.unit_cost_ht) || 0) * 100, uses: meta.lifetimeUses ?? 100 }
}

/** Une ligne d'équipement : 1 usage, coût interne = achat ÷ usages, jamais visible du client. */
export function applyEquipment(item: LocalItem, purchase: number, uses: number): LocalItem {
  if (purchase <= 0 || uses <= 0) return item
  const name = parseEquipmentLabel(item.designation).name
  return { ...item, designation: buildEquipmentLabel(name, purchase, uses), quantity: '1', unit_cost_ht: String(costPerUse(purchase, uses)), unit_price_ht: '0', unit: 'usage', is_internal: true }
}

// ─── Transport (carburant) ────────────────────────────────────────────────────

export const fuelLiters = (km: number, consumption: number) => Math.round(((km * consumption) / 100) * 100) / 100

export function transportInitial(item: LocalItem) {
  if (item.item_type !== 'transport') return { km: 0, consumption: 8, pricePerLiter: 1.85 }
  return { km: Math.round(((parseFloat(item.quantity) || 0) * 100) / 8), consumption: 8, pricePerLiter: parseFloat(item.unit_cost_ht) || 1.85 }
}

/** Une ligne de transport : quantité en litres, coût = prix du litre. Le libellé par défaut cite le trajet. */
export function applyTransport(item: LocalItem, km: number, consumption: number, pricePerLiter: number): LocalItem {
  if (km <= 0) return item
  return { ...item, quantity: String(fuelLiters(km, consumption)), unit: 'L', unit_cost_ht: String(pricePerLiter), designation: item.designation || `Carburant - trajet ${km} km` }
}

// ─── Totaux et affichage ──────────────────────────────────────────────────────

const n = (s: string) => parseFloat(s) || 0

export function modeleTotals(sections: Section[]) {
  const items = sections.flatMap(s => s.items)
  const price = items.reduce((sum, i) => (!i.is_internal ? sum + n(i.quantity) * n(i.unit_price_ht) : sum), 0)
  const cost = items.reduce((sum, i) => sum + n(i.quantity) * n(i.unit_cost_ht), 0)
  return { price, cost, marginEur: price - cost, marginPct: price > 0 ? ((price - cost) / price) * 100 : null, count: items.length, hasInternal: items.some(i => i.is_internal) }
}

/** Montant affiché d'une ligne : le coût pour une ligne interne, le prix client sinon. */
export const lineAmount = (i: LocalItem) => n(i.quantity) * (i.is_internal ? n(i.unit_cost_ht) : n(i.unit_price_ht))
export const lineUnitAmount = (i: LocalItem) => (i.is_internal ? n(i.unit_cost_ht) : n(i.unit_price_ht))

/** Libellé court d'une ligne : l'amortissement d'un équipement garde seulement son nom. */
export function lineTitle(i: LocalItem): string {
  if (i.item_type === 'equipment') return parseEquipmentLabel(i.designation).name || 'Équipement amorti'
  return i.designation.trim() || 'Ligne sans désignation'
}

/** Charge utile de setPrestationTypeItems : positions continues d'une section à l'autre. */
export function itemsPayload(sections: Section[]) {
  let position = 0
  return sections.flatMap(section =>
    section.items.map(item => {
      const isEquipment = item.item_type === 'equipment'
      const meta = isEquipment ? parseEquipmentLabel(item.designation) : null
      const designation = isEquipment && meta?.purchasePrice && meta.lifetimeUses
        ? buildEquipmentLabel(meta.name, meta.purchasePrice, meta.lifetimeUses)
        : item.designation.trim() || '-'
      return {
        position: position++,
        section_title: section.title.trim(),
        item_type: item.item_type,
        material_id: item.material_id,
        labor_rate_id: item.labor_rate_id,
        designation,
        quantity: isEquipment ? 1 : parseFloat(item.quantity) || 1,
        unit: isEquipment ? 'usage' : item.unit || 'u',
        unit_price_ht: isEquipment ? 0 : parseFloat(item.unit_price_ht) || 0,
        unit_cost_ht: parseFloat(item.unit_cost_ht) || 0,
        is_internal: isEquipment ? true : item.is_internal,
        save_to_catalog: item.save_to_catalog,
      }
    }),
  )
}

export function headerPayload(h: ModeleHeader) {
  return { name: h.name.trim(), description: h.description.trim() || null, unit: 'forfait', category: null, basePriceHt: 0, baseCostHt: 0, isActive: h.is_active }
}

/** Remplace une ligne par son brouillon, ou l'ajoute à la fin de la section si elle est nouvelle. */
export function upsertItem(sections: Section[], sectionId: string, item: LocalItem): Section[] {
  return sections.map(s => {
    if (s.tempId !== sectionId) return s
    return s.items.some(i => i.tempId === item.tempId) ? { ...s, items: s.items.map(i => i.tempId === item.tempId ? item : i) } : { ...s, items: [...s.items, item] }
  })
}

// ─── Import des modèles (deux fichiers liés par template_ref) ────────────────

export const PRESTATION_HEADERS_FIELDS = [
  { key: 'template_ref', label: 'Référence (template_ref)', required: true },
  { key: 'name', label: 'Nom du modèle', required: true },
  { key: 'description', label: 'Description' },
  { key: 'unit', label: 'Unité (forfait, m², h…)' },
  { key: 'category', label: 'Catégorie' },
  { key: 'base_price_ht', label: 'Prix de vente HT (€)' },
  { key: 'base_cost_ht', label: 'Coût de revient HT (€)' },
  { key: 'vat_rate', label: 'TVA (%) - ex : 20, 10' },
]

export const PRESTATION_LINES_FIELDS = [
  { key: 'template_ref', label: 'Référence modèle (template_ref)', required: true },
  { key: 'position', label: 'Position (ordre)' },
  { key: 'item_type', label: 'Type (service, material, labor, transport, free)' },
  { key: 'designation', label: 'Désignation', required: true },
  { key: 'quantity', label: 'Quantité' },
  { key: 'unit', label: 'Unité' },
  { key: 'unit_price_ht', label: 'Prix unitaire HT (€)' },
  { key: 'unit_cost_ht', label: 'Coût unitaire HT (€)' },
]

export const PRESTATION_HEADERS_EXAMPLE = ['POSE-CARRELAGE', 'Pose carrelage sol', 'Fourniture et pose carrelage avec joint', 'm²', 'Carrelage sol', '85', '55', '10']
export const PRESTATION_LINES_EXAMPLE = ['POSE-CARRELAGE', '1', 'material', 'Carrelage grès cérame 60x60', '1', 'm²', '25', '18']
