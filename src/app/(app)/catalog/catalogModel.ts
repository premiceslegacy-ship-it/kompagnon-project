// @atelier-migrated
// Catalogue : calculs, filtres et formulaires purs (aucun accès réseau, aucun état React).

import type { CatalogLaborRate, CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog'
import type { Supplier } from '@/lib/data/queries/suppliers'
import type { EditableDimensionSchemaState, EditableVariantState } from '@/components/catalog/DimensionConfigEditor'
import {
  displayUnitToMeters, getDimensionFieldDefinition, metersToDisplayUnit, normalizeDimensionSchema, type DimensionPricingMode,
} from '@/lib/catalog-pricing'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'

export type CatalogTab = 'materials' | 'services' | 'labor' | 'prestations' | 'suppliers'

export const PAGE_SIZE = 10

export const fmtMoney = (n: number | null | undefined, decimals = 2) =>
  n == null ? '–' : new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(n)

const r2 = (v: number) => Math.round(v * 100) / 100

/** Catégories proposées : celles du profil d'activité, puis celles déjà utilisées. */
export function mergeCategories(defaults: string[], used: Array<string | null | undefined>): string[] {
  return Array.from(new Set([...defaults, ...(used.filter(Boolean) as string[])]))
}

// ─── Prix ─────────────────────────────────────────────────────────────────────

/** Prix de vente = achat × (1 + marge). Vide tant qu'il manque l'un des deux. */
export function salePriceFrom(purchase: string, margin: string): string {
  const p = parseFloat(purchase), m = parseFloat(margin)
  if (!Number.isFinite(p) || !Number.isFinite(m) || !purchase || !margin) return ''
  return (p * (1 + m / 100)).toFixed(2)
}

/** Marge cible déduite d'un prix de vente saisi à la main. Vide si l'achat est inconnu. */
export function marginFrom(purchase: string, sale: string): string {
  const p = parseFloat(purchase), s = parseFloat(sale)
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(s)) return ''
  return String(r2((s / p - 1) * 100))
}

/** Marge sur prix client d'une ressource : (tarif − coût) / tarif, en pourcentage entier. Null si non calculable. */
export function laborMarginPct(cost: number | null, rate: number | null): number | null {
  if (cost == null || rate == null || rate <= 0 || cost <= 0) return null
  return Math.round(((rate - cost) / rate) * 100)
}

/** Coût par usage d'un équipement amorti : achat ÷ nombre d'usages, au centime. Vide si une valeur manque. */
export function equipmentCostPerUse(purchase: string, uses: string): string {
  const p = parseFloat(purchase), u = parseInt(uses, 10)
  if (!Number.isFinite(p) || p <= 0 || !Number.isFinite(u) || u <= 0) return ''
  return (Math.round((p / u) * 100) / 100).toFixed(2)
}

// ─── Listes ───────────────────────────────────────────────────────────────────

const has = (hay: string | null | undefined, needle: string) => (hay ?? '').toLowerCase().includes(needle)

export function filterMaterials(materials: CatalogMaterial[], tab: 'materials' | 'services', search: string): CatalogMaterial[] {
  const q = search.trim().toLowerCase()
  return materials
    .filter(m => (tab === 'services' ? m.item_kind === 'service' : m.item_kind !== 'service'))
    .filter(m => has(m.name, q) || has(m.reference, q) || has(m.category, q) || has(m.supplier, q))
}

export function filterLabor(rates: CatalogLaborRate[], search: string): CatalogLaborRate[] {
  const q = search.trim().toLowerCase()
  return rates.filter(l => has(l.designation, q) || has(l.reference, q) || has(l.category, q))
}

export function filterPrestations(items: PrestationType[], search: string): PrestationType[] {
  const q = search.trim().toLowerCase()
  return items.filter(p => has(p.name, q) || has(p.category, q))
}

export function filterSuppliers(items: Supplier[], search: string): Supplier[] {
  const q = search.trim().toLowerCase()
  return items.filter(s => has(s.name, q) || has(s.contact_name, q) || has(s.email, q) || has(s.phone, q))
}

/** « Afficher les suivants » : la liste visible grandit par pages de 10. */
export function visibleSlice<T>(list: T[], count: number): { items: T[]; rest: number } {
  const items = list.slice(0, count)
  return { items, rest: list.length - items.length }
}

// ─── Fourniture / service ─────────────────────────────────────────────────────

export type MaterialKind = 'article' | 'service'

export type MaterialForm = {
  name: string
  reference: string
  unit: string
  category: string
  newCategory: string
  supplierId: string
  description: string
  purchasePrice: string
  marginRate: string
  salePrice: string
  dimMode: DimensionPricingMode
  baseLength: string
  baseWidth: string
  baseHeight: string
  schema: EditableDimensionSchemaState
  variants: EditableVariantState[]
}

export const NEW_CATEGORY = '__new__'

export function schemaFor(raw: CatalogMaterial['dimension_schema'] | null | undefined, mode: DimensionPricingMode): EditableDimensionSchemaState {
  return {
    length: getDimensionFieldDefinition(raw, 'length', mode),
    width: getDimensionFieldDefinition(raw, 'width', mode),
    height: getDimensionFieldDefinition(raw, 'height', mode),
  }
}

export function blankMaterialForm(kind: MaterialKind): MaterialForm {
  return {
    name: '', reference: '', unit: kind === 'service' ? 'forfait' : 'u', category: '', newCategory: '', supplierId: '', description: '',
    purchasePrice: '', marginRate: '', salePrice: '', dimMode: 'none', baseLength: '1', baseWidth: '1', baseHeight: '',
    schema: schemaFor(null, 'none'), variants: [],
  }
}

export function materialToForm(m: CatalogMaterial): MaterialForm {
  const mode = m.dimension_pricing_mode ?? 'none'
  const schema = schemaFor(m.dimension_schema, mode)
  return {
    name: m.name,
    reference: m.reference ?? '',
    unit: m.unit ?? 'u',
    category: m.category ?? '',
    newCategory: '',
    supplierId: m.supplier_id ?? '',
    description: m.description ?? '',
    purchasePrice: String(m.purchase_price ?? ''),
    marginRate: String(m.margin_rate ?? ''),
    salePrice: String(m.sale_price ?? ''),
    dimMode: mode,
    baseLength: String(metersToDisplayUnit(m.base_length_m, schema.length.unit) ?? ''),
    baseWidth: String(metersToDisplayUnit(m.base_width_m, schema.width.unit) ?? ''),
    baseHeight: String(metersToDisplayUnit(m.base_height_m, schema.height.unit) ?? ''),
    schema,
    variants: (m.price_variants ?? []).map(variant => ({
      id: variant.id,
      label: variant.label ?? '',
      reference_suffix: variant.reference_suffix ?? '',
      length: variant.dimension_values?.length_m != null ? String(metersToDisplayUnit(Number(variant.dimension_values.length_m), schema.length.unit) ?? '') : '',
      width: variant.dimension_values?.width_m != null ? String(metersToDisplayUnit(Number(variant.dimension_values.width_m), schema.width.unit) ?? '') : '',
      height: variant.dimension_values?.height_m != null ? String(metersToDisplayUnit(Number(variant.dimension_values.height_m), schema.height.unit) ?? '') : '',
      sale_price: String(variant.sale_price ?? ''),
      purchase_price: String(variant.purchase_price ?? ''),
      is_default: variant.is_default,
    })),
  }
}

/** Changer un prix d'achat ou une marge recalcule le prix de vente ; saisir le prix de vente recalcule la marge. */
export function withPricing(form: MaterialForm, field: 'purchasePrice' | 'marginRate' | 'salePrice', value: string): MaterialForm {
  const next = { ...form, [field]: value }
  if (field === 'salePrice') {
    const margin = marginFrom(next.purchasePrice, value)
    return margin ? { ...next, marginRate: margin } : next
  }
  const sale = salePriceFrom(next.purchasePrice, next.marginRate)
  return sale ? { ...next, salePrice: sale } : next
}

/** Choisir un mode de dimensions règle l'unité de vente et repart d'un schéma propre. */
export function withDimensionMode(form: MaterialForm, mode: DimensionPricingMode): MaterialForm {
  const unit = mode === 'linear' ? 'ml' : mode === 'area' ? 'm²' : mode === 'volume' ? 'm³' : form.unit
  return { ...form, dimMode: mode, schema: schemaFor(null, mode), unit }
}

/** Message d'erreur si les dimensions de référence sont incomplètes pour le mode choisi. */
export function dimensionError(form: MaterialForm): string | null {
  if (form.dimMode === 'none') return null
  if (!form.baseLength || parseFloat(form.baseLength) <= 0) return 'Renseignez la longueur de référence pour activer la tarification dimensionnelle.'
  if ((form.dimMode === 'area' || form.dimMode === 'volume') && (!form.baseWidth || parseFloat(form.baseWidth) <= 0)) return 'Renseignez la largeur de référence pour le mode Surface.'
  if (form.dimMode === 'volume' && (!form.baseHeight || parseFloat(form.baseHeight) <= 0)) return 'Renseignez la hauteur de référence pour le mode Volume.'
  return null
}

export function variantsPayload(form: MaterialForm) {
  return form.variants.map((variant, index) => ({
    label: variant.label.trim() || null,
    reference_suffix: variant.reference_suffix.trim() || null,
    dimension_values: {
      ...(variant.length ? { length_m: displayUnitToMeters(parseFloat(variant.length), form.schema.length.unit) } : {}),
      ...(variant.width ? { width_m: displayUnitToMeters(parseFloat(variant.width), form.schema.width.unit) } : {}),
      ...(variant.height ? { height_m: displayUnitToMeters(parseFloat(variant.height), form.schema.height.unit) } : {}),
    } as Record<string, number | null>,
    purchase_price: parseFloat(variant.purchase_price) || null,
    sale_price: parseFloat(variant.sale_price) || null,
    is_default: variant.is_default,
    position: index,
  }))
}

export function effectiveCategory(form: MaterialForm): string {
  return form.category === NEW_CATEGORY ? form.newCategory.trim() : form.category
}

/** Charge utile de updateMaterial pour une fourniture ou un service existant. */
export function materialUpdatePayload(form: MaterialForm, kind: MaterialKind, suppliers: Supplier[]) {
  const supplierName = suppliers.find(s => s.id === form.supplierId)?.name?.trim() || null
  const mode = form.dimMode
  return {
    name: form.name.trim(),
    reference: form.reference.trim() || null,
    item_kind: kind,
    unit: form.unit || null,
    category: effectiveCategory(form) || null,
    supplier_id: form.supplierId || null,
    supplier: supplierName,
    description: form.description.trim() || null,
    purchase_price: parseFloat(form.purchasePrice) || null,
    margin_rate: parseFloat(form.marginRate) || null,
    sale_price: parseFloat(form.salePrice) || null,
    dimension_pricing_mode: mode,
    dimension_pricing_enabled: mode !== 'none',
    base_length_m: displayUnitToMeters(parseFloat(form.baseLength), form.schema.length.unit),
    base_width_m: mode === 'area' || mode === 'volume' ? displayUnitToMeters(parseFloat(form.baseWidth), form.schema.width.unit) : null,
    base_height_m: mode === 'volume' ? displayUnitToMeters(parseFloat(form.baseHeight), form.schema.height.unit) : null,
    dimension_schema: normalizeDimensionSchema(form.schema, mode),
    price_variants: variantsPayload(form),
  }
}

/** Ligne locale après enregistrement, sans attendre le rechargement. */
export function materialAfterUpdate(material: CatalogMaterial, payload: ReturnType<typeof materialUpdatePayload>, now: string = new Date().toISOString()): CatalogMaterial {
  const { price_variants, ...rest } = payload
  return {
    ...material,
    ...rest,
    dimension_schema: rest.dimension_schema as CatalogMaterial['dimension_schema'],
    price_variants: price_variants.map((variant, index) => ({
      id: `${material.id}_variant_${index}`,
      material_id: material.id,
      organization_id: material.organization_id,
      position: index,
      label: variant.label,
      reference_suffix: variant.reference_suffix,
      dimension_values: variant.dimension_values,
      purchase_price: variant.purchase_price,
      sale_price: variant.sale_price,
      is_default: variant.is_default,
      created_at: now,
    })),
  } as CatalogMaterial
}

/** Champs de createMaterial (action serveur à FormData). */
export function materialFormData(form: MaterialForm, kind: MaterialKind): FormData {
  const fd = new FormData()
  fd.set('item_kind', kind)
  fd.set('dimension_schema', JSON.stringify(normalizeDimensionSchema(form.schema, form.dimMode)))
  fd.set('price_variants', JSON.stringify(variantsPayload(form)))
  fd.set('name', form.name)
  fd.set('reference', form.reference)
  fd.set('category', effectiveCategory(form))
  fd.set('unit', form.unit)
  fd.set('purchase_price', form.purchasePrice)
  fd.set('margin_rate', form.marginRate)
  fd.set('sale_price', form.salePrice)
  if (kind !== 'service' && form.supplierId) fd.set('supplier_id', form.supplierId)
  fd.set('dimension_pricing_mode', form.dimMode)
  fd.set('base_length_m', String(displayUnitToMeters(parseFloat(form.baseLength), form.schema.length.unit) ?? ''))
  fd.set('base_width_m', String(displayUnitToMeters(parseFloat(form.baseWidth), form.schema.width.unit) ?? ''))
  fd.set('base_height_m', String(displayUnitToMeters(parseFloat(form.baseHeight), form.schema.height.unit) ?? ''))
  return fd
}

/** Copie d'une fourniture (même champs que l'ancienne action « Dupliquer »). */
export function duplicateMaterialFormData(item: CatalogMaterial): FormData {
  const fd = new FormData()
  fd.set('name', `${item.name} (copie)`)
  fd.set('item_kind', item.item_kind)
  fd.set('unit', item.unit ?? 'u')
  fd.set('category', item.category ?? '')
  fd.set('supplier', item.supplier ?? '')
  fd.set('purchase_price', String(item.purchase_price ?? ''))
  fd.set('margin_rate', String(item.margin_rate ?? ''))
  fd.set('sale_price', String(item.sale_price ?? ''))
  fd.set('dimension_pricing_mode', item.dimension_pricing_mode ?? 'none')
  fd.set('base_length_m', String(item.base_length_m ?? ''))
  fd.set('base_width_m', String(item.base_width_m ?? ''))
  fd.set('base_height_m', String(item.base_height_m ?? ''))
  return fd
}

// ─── Main-d'œuvre et ressources ───────────────────────────────────────────────

export type LaborForm = {
  designation: string
  reference: string
  type: string
  unit: string
  category: string
  newCategory: string
  description: string
  costRate: string
  rate: string
  purchasePrice: string
  uses: string
}

export function blankLaborForm(ctx: ResolvedCatalogContext): LaborForm {
  return {
    designation: '', reference: '', type: ctx.resourceTypeOptions[0]?.value ?? 'human', unit: ctx.unitSetsByKind.laborRate[0] ?? 'h',
    category: '', newCategory: '', description: '', costRate: '', rate: '', purchasePrice: '', uses: '100',
  }
}

export function laborToForm(l: CatalogLaborRate): LaborForm {
  return {
    designation: l.designation,
    reference: l.reference ?? '',
    type: l.type ?? 'human',
    unit: l.unit ?? 'h',
    category: l.category ?? '',
    newCategory: '',
    description: l.description ?? '',
    costRate: l.cost_rate != null ? String(l.cost_rate) : '',
    rate: l.rate != null ? String(l.rate) : '',
    purchasePrice: l.purchase_price != null ? String(l.purchase_price) : '',
    uses: l.lifetime_uses != null ? String(l.lifetime_uses) : '100',
  }
}

/** Un équipement amorti : l'unité est « usage » et le coût interne vient de l'achat ÷ usages. */
export function withLaborType(form: LaborForm, type: string): LaborForm {
  const next = { ...form, type }
  if (type !== 'equipment') return next
  return { ...next, unit: 'usage', costRate: equipmentCostPerUse(next.purchasePrice, next.uses) || next.costRate }
}

export function withEquipmentField(form: LaborForm, field: 'purchasePrice' | 'uses', value: string): LaborForm {
  const next = { ...form, [field]: value }
  const cost = equipmentCostPerUse(next.purchasePrice, next.uses)
  return { ...next, unit: 'usage', costRate: cost }
}

export function laborCategory(form: LaborForm): string {
  return form.category === NEW_CATEGORY ? form.newCategory.trim() : form.category
}

export function laborFormData(form: LaborForm): FormData {
  const fd = new FormData()
  fd.set('unit', form.unit)
  if (form.type === 'equipment') {
    fd.set('purchase_price', form.purchasePrice)
    fd.set('lifetime_uses', form.uses)
  }
  fd.set('type', form.type)
  fd.set('designation', form.designation)
  fd.set('category', laborCategory(form))
  fd.set('reference', form.reference)
  fd.set('cost_rate', form.costRate)
  fd.set('rate', form.rate)
  return fd
}

export function laborUpdatePayload(form: LaborForm) {
  const equipment = form.type === 'equipment'
  return {
    designation: form.designation.trim(),
    reference: form.reference.trim() || null,
    type: form.type,
    unit: form.unit || null,
    category: laborCategory(form) || null,
    description: form.description.trim() || null,
    cost_rate: parseFloat(form.costRate) || null,
    rate: parseFloat(form.rate) || null,
    purchase_price: equipment ? parseFloat(form.purchasePrice) || null : null,
    lifetime_uses: equipment ? parseInt(form.uses, 10) || null : null,
  }
}

// ─── Fournisseur ──────────────────────────────────────────────────────────────

export type SupplierForm = {
  name: string
  contact: string
  email: string
  phone: string
  address: string
  siret: string
  terms: string
  notes: string
}

export const blankSupplierForm = (): SupplierForm => ({ name: '', contact: '', email: '', phone: '', address: '', siret: '', terms: '', notes: '' })

export const supplierToForm = (s: Supplier): SupplierForm => ({
  name: s.name, contact: s.contact_name ?? '', email: s.email ?? '', phone: s.phone ?? '', address: s.address ?? '',
  siret: s.siret ?? '', terms: s.payment_terms ?? '', notes: s.notes ?? '',
})

export function supplierPayload(f: SupplierForm) {
  return {
    name: f.name.trim(),
    contact_name: f.contact.trim() || null,
    email: f.email.trim() || null,
    phone: f.phone.trim() || null,
    address: f.address.trim() || null,
    siret: f.siret.trim() || null,
    payment_terms: f.terms.trim() || null,
    notes: f.notes.trim() || null,
  }
}

// ─── Import ───────────────────────────────────────────────────────────────────

export type ImportField = { key: string; label: string; required?: boolean }
export type ImportConfig = { fields: ImportField[]; exampleRow: string[]; filename: string }

/** Associe automatiquement chaque champ à la colonne dont l'en-tête lui ressemble. */
export function autoMapColumns(fields: ImportField[], headers: string[]): Record<string, string> {
  const map: Record<string, string> = {}
  fields.forEach(({ key, label }) => {
    const idx = headers.findIndex(h => {
      const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '')
      return norm.includes(key.replace(/_/g, '')) || norm.includes(label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6))
    })
    if (idx !== -1) map[key] = String(idx)
  })
  return map
}

/** Lignes du fichier converties en objets selon l'association colonnes ↔ champs. */
export function mapImportRows(fields: ImportField[], rows: string[][], mapping: Record<string, string>): Array<Record<string, string>> {
  return rows.map(row => {
    const obj: Record<string, string> = {}
    fields.forEach(({ key }) => {
      const col = mapping[key] !== undefined && mapping[key] !== '' ? parseInt(mapping[key], 10) : -1
      obj[key] = col >= 0 ? (row[col] ?? '') : ''
    })
    return obj
  })
}

export function getMaterialImportConfig(ctx: ResolvedCatalogContext): ImportConfig {
  const p = ctx.businessProfile
  const unitLabel = p === 'industry' ? 'Unité (kg, m, m2, pièce…)' : p === 'cleaning' ? 'Unité (L, kg, u, flacon…)' : 'Unité (m2, ml, m3, u…)'
  const catLabel = p === 'industry' ? 'Catégorie (ex : Métaux, Consommables)' : p === 'cleaning' ? 'Catégorie (ex : Produits, Matériel)' : 'Catégorie (ex : Gros œuvre, Finitions)'
  const supLabel = p === 'industry' ? 'Fournisseur / sous-traitant' : 'Fournisseur'
  const dimMode = p === 'cleaning' ? 'none' : 'area'
  const dimEnabled = p === 'cleaning' ? 'non' : 'oui'
  const [exName, exRef, exUnit, exCat, exSup, exPurchase, exMargin, exSale, exL, exW, exH] =
    p === 'industry'
      ? ['Tôle S235 2mm', 'REF-001', 'm2', 'Métaux', 'ArcelorMittal', '8.50', '30', '11.05', '1', '1', '0.002']
      : p === 'cleaning'
        ? ['Produit détergent multi-usage', 'REF-001', 'L', 'Produits d\'entretien', 'Ecolab', '4.50', '50', '6.75', '', '', '']
        : ['Parquet stratifié chêne', 'REF-001', 'm2', 'Revêtements sols', 'Brico Dépôt', '25.00', '40', '35.00', '1', '1', '0.012']
  return {
    filename: p === 'industry' ? 'template_matieres_fournitures.csv' : p === 'cleaning' ? 'template_produits_materiel.csv' : 'template_materiaux.csv',
    fields: [
      { key: 'name', label: 'Désignation', required: true },
      { key: 'reference', label: 'Référence (optionnel - générée si vide)' },
      { key: 'item_kind', label: 'Type (article ou service)' },
      { key: 'unit', label: unitLabel },
      { key: 'category', label: catLabel },
      { key: 'supplier', label: supLabel },
      { key: 'purchase_price', label: "Prix d'achat HT (€)" },
      { key: 'margin_rate', label: 'Marge (%)' },
      { key: 'sale_price', label: 'Prix de vente HT (€)' },
      { key: 'vat_rate', label: 'TVA (%) - ex : 20, 10, 5.5' },
      { key: 'dimension_pricing_mode', label: 'Tarification dimensionnelle (none, linear, area)' },
      { key: 'dimension_pricing_enabled', label: 'Activer tarif par dimension (oui / non)' },
      { key: 'base_length_m', label: 'Longueur de base (m)' },
      { key: 'base_width_m', label: 'Largeur de base (m)' },
      { key: 'base_height_m', label: 'Épaisseur / hauteur de base (m)' },
    ],
    exampleRow: [exName, exRef, 'article', exUnit, exCat, exSup, exPurchase, exMargin, exSale, '20', dimMode, dimEnabled, exL, exW, exH],
  }
}

export function getLaborImportConfig(ctx: ResolvedCatalogContext): ImportConfig {
  const p = ctx.businessProfile
  const unitLabel = p === 'industry' ? 'Unité (h, j, op…)' : 'Unité (h, j, sem…)'
  const catLabel = p === 'industry' ? 'Catégorie (ex : Usinage, Soudure)' : p === 'cleaning' ? 'Catégorie (ex : Nettoyage, Vitres)' : 'Catégorie (ex : Maçonnerie, Plomberie)'
  const [exName, exRef, exUnit, exCat, exCost, exType] =
    p === 'industry'
      ? ['Opérateur commande numérique', 'REF-MO-001', 'h', 'Usinage', '45.00', 'humain']
      : p === 'cleaning'
        ? ['Agent de nettoyage', 'REF-MO-001', 'h', 'Nettoyage', '28.00', 'humain']
        : ['Chef de chantier', 'REF-MO-001', 'h', 'Encadrement', '55.00', 'humain']
  return {
    filename: p === 'industry' ? 'template_operations_ressources.csv' : p === 'cleaning' ? 'template_intervenants.csv' : 'template_main_oeuvre.csv',
    fields: [
      { key: 'designation', label: 'Désignation', required: true },
      { key: 'reference', label: 'Référence (optionnel - générée si vide)' },
      { key: 'type', label: 'Type (humain, machine, équipement, sous-traitant)' },
      { key: 'unit', label: unitLabel },
      { key: 'category', label: catLabel },
      { key: 'cost_rate', label: 'Coût interne (€/unité)' },
      { key: 'vat_rate', label: 'TVA (%) - ex : 20, 10, 5.5' },
    ],
    exampleRow: [exName, exRef, exType, exUnit, exCat, exCost, '20'],
  }
}

export function getSupplierImportConfig(): ImportConfig {
  return {
    filename: 'template_fournisseurs.csv',
    fields: [
      { key: 'name', label: 'Nom du fournisseur', required: true },
      { key: 'contact_name', label: 'Nom du contact' },
      { key: 'email', label: 'Email' },
      { key: 'phone', label: 'Téléphone' },
      { key: 'address', label: 'Adresse' },
      { key: 'siret', label: 'SIRET' },
      { key: 'payment_terms', label: 'Conditions de paiement' },
      { key: 'notes', label: 'Notes' },
    ],
    exampleRow: ['Leroy Merlin Pro', 'Jean Dupont', 'contact@leroymerlin.fr', '0600000000', '10 rue de la Paix, Paris', '12345678901234', '30 jours net', 'Compte pro ouvert'],
  }
}
