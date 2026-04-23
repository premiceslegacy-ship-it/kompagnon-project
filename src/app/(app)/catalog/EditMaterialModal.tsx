'use client'

import React, { useState, useTransition } from 'react'
import { X, AlertCircle, Loader2 } from 'lucide-react'
import { type CatalogMaterial } from '@/lib/data/queries/catalog'
import { updateMaterial } from '@/lib/data/mutations/catalog'
import { UnitSelect } from '@/components/ui/UnitSelect'
import DimensionConfigEditor, { type EditableDimensionSchemaState, type EditableVariantState } from '@/components/catalog/DimensionConfigEditor'
import {
  buildCatalogPricingPreview,
  displayUnitToMeters,
  getDimensionFieldDefinition,
  metersToDisplayUnit,
  normalizeDimensionSchema,
  type DimensionPricingMode,
} from '@/lib/catalog-pricing'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { getCatalogLabelsForProfile } from '@/lib/catalog-ui'

const inputCls = 'w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all'

type Props = {
  material: CatalogMaterial
  categories: string[]
  catalogContext: ResolvedCatalogContext
  onClose: () => void
  onSaved: (updated: CatalogMaterial) => void
}

function buildSchemaState(material: CatalogMaterial, mode: DimensionPricingMode): EditableDimensionSchemaState {
  return {
    length: getDimensionFieldDefinition(material.dimension_schema, 'length', mode),
    width: getDimensionFieldDefinition(material.dimension_schema, 'width', mode),
    height: getDimensionFieldDefinition(material.dimension_schema, 'height', mode),
  }
}

function buildVariantState(material: CatalogMaterial, schema: EditableDimensionSchemaState): EditableVariantState[] {
  return (material.price_variants ?? []).map((variant) => ({
    id: variant.id,
    label: variant.label ?? '',
    reference_suffix: variant.reference_suffix ?? '',
    length: variant.dimension_values?.length_m != null ? String(metersToDisplayUnit(Number(variant.dimension_values.length_m), schema.length.unit) ?? '') : '',
    width: variant.dimension_values?.width_m != null ? String(metersToDisplayUnit(Number(variant.dimension_values.width_m), schema.width.unit) ?? '') : '',
    height: variant.dimension_values?.height_m != null ? String(metersToDisplayUnit(Number(variant.dimension_values.height_m), schema.height.unit) ?? '') : '',
    sale_price: String(variant.sale_price ?? ''),
    purchase_price: String(variant.purchase_price ?? ''),
    is_default: variant.is_default,
  }))
}

export function EditMaterialModal({ material, categories, catalogContext, onClose, onSaved }: Props) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [newCatMode, setNewCatMode] = useState(false)
  const initialMode = material.dimension_pricing_mode ?? 'none'
  const initialSchema = buildSchemaState(material, initialMode)
  const profileLabels = getCatalogLabelsForProfile(catalogContext)

  // Form state
  const [name, setName] = useState(material.name)
  const [reference, setReference] = useState(material.reference ?? '')
  const [unit, setUnit] = useState(material.unit ?? 'u')
  const [category, setCategory] = useState(material.category ?? '')
  const [newCategory, setNewCategory] = useState('')
  const [supplier, setSupplier] = useState(material.supplier ?? '')
  const [description, setDescription] = useState(material.description ?? '')
  const [purchasePrice, setPurchasePrice] = useState(String(material.purchase_price ?? ''))
  const [marginRate, setMarginRate] = useState(String(material.margin_rate ?? ''))
  const [salePrice, setSalePrice] = useState(String(material.sale_price ?? ''))
  const [dimMode, setDimMode] = useState<DimensionPricingMode>(initialMode)
  const [baseLength, setBaseLength] = useState(String(metersToDisplayUnit(material.base_length_m, initialSchema.length.unit) ?? ''))
  const [baseWidth, setBaseWidth] = useState(String(metersToDisplayUnit(material.base_width_m, initialSchema.width.unit) ?? ''))
  const [baseHeight, setBaseHeight] = useState(String(metersToDisplayUnit(material.base_height_m, initialSchema.height.unit) ?? ''))
  const [dimensionSchemaState, setDimensionSchemaState] = useState<EditableDimensionSchemaState>(initialSchema)
  const [variants, setVariants] = useState<EditableVariantState[]>(() => buildVariantState(material, initialSchema))
  const [showAdvancedDimensions, setShowAdvancedDimensions] = useState((material.price_variants?.length ?? 0) > 0)
  const kindLabels = material.item_kind === 'service' ? catalogContext.labelSet.service : catalogContext.labelSet.material

  // Auto-compute sale price from purchase + margin
  const computedSalePrice = purchasePrice && marginRate && !salePrice
    ? (parseFloat(purchasePrice) * (1 + parseFloat(marginRate) / 100)).toFixed(2)
    : salePrice

  // Preview pricing
  const previewItem = {
    sale_price: parseFloat(computedSalePrice) || null,
    purchase_price: parseFloat(purchasePrice) || null,
    unit,
    dimension_pricing_mode: dimMode,
    base_length_m: displayUnitToMeters(parseFloat(baseLength), dimensionSchemaState.length.unit),
    base_width_m: displayUnitToMeters(parseFloat(baseWidth), dimensionSchemaState.width.unit),
    base_height_m: displayUnitToMeters(parseFloat(baseHeight), dimensionSchemaState.height.unit),
  }
  const preview = dimMode !== 'none' ? buildCatalogPricingPreview(previewItem) : null

  function handlePurchaseChange(val: string) {
    setPurchasePrice(val)
    if (val && marginRate) {
      setSalePrice((parseFloat(val) * (1 + parseFloat(marginRate) / 100)).toFixed(2))
    }
  }

  function handleMarginChange(val: string) {
    setMarginRate(val)
    if (purchasePrice && val) {
      setSalePrice((parseFloat(purchasePrice) * (1 + parseFloat(val) / 100)).toFixed(2))
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) { setError('La désignation est requise.'); return }
    if (dimMode !== 'none') {
      if (!baseLength || parseFloat(baseLength) <= 0) {
        setError('Renseignez la longueur de référence pour activer la tarification dimensionnelle.')
        return
      }
      if ((dimMode === 'area' || dimMode === 'volume') && (!baseWidth || parseFloat(baseWidth) <= 0)) {
        setError('Renseignez la largeur de référence pour le mode Surface.')
        return
      }
      if (dimMode === 'volume' && (!baseHeight || parseFloat(baseHeight) <= 0)) {
        setError('Renseignez la hauteur de référence pour le mode Volume.')
        return
      }
    }
    setError(null)

    const effectiveCategory = newCatMode ? newCategory.trim() : category
    const effectiveSalePrice = parseFloat(computedSalePrice) || null
    const dimensionSchema = normalizeDimensionSchema(dimensionSchemaState, dimMode)
    const priceVariants = variants.map((variant, index) => ({
      label: variant.label.trim() || null,
      reference_suffix: variant.reference_suffix.trim() || null,
      dimension_values: {
        ...(variant.length ? { length_m: displayUnitToMeters(parseFloat(variant.length), dimensionSchemaState.length.unit) } : {}),
        ...(variant.width ? { width_m: displayUnitToMeters(parseFloat(variant.width), dimensionSchemaState.width.unit) } : {}),
        ...(variant.height ? { height_m: displayUnitToMeters(parseFloat(variant.height), dimensionSchemaState.height.unit) } : {}),
      } as Record<string, number | null>,
      purchase_price: parseFloat(variant.purchase_price) || null,
      sale_price: parseFloat(variant.sale_price) || null,
      is_default: variant.is_default,
      position: index,
    }))

    startTransition(async () => {
      const result = await updateMaterial(material.id, {
        name: name.trim(),
        reference: reference.trim() || null,
        item_kind: material.item_kind,
        unit: unit || null,
        category: effectiveCategory || null,
        supplier: supplier.trim() || null,
        description: description.trim() || null,
        purchase_price: parseFloat(purchasePrice) || null,
        margin_rate: parseFloat(marginRate) || null,
        sale_price: effectiveSalePrice,
        dimension_pricing_mode: dimMode,
        dimension_pricing_enabled: dimMode !== 'none',
        base_length_m: displayUnitToMeters(parseFloat(baseLength), dimensionSchemaState.length.unit),
        base_width_m: dimMode === 'area' || dimMode === 'volume' ? displayUnitToMeters(parseFloat(baseWidth), dimensionSchemaState.width.unit) : null,
        base_height_m: dimMode === 'volume' ? displayUnitToMeters(parseFloat(baseHeight), dimensionSchemaState.height.unit) : null,
        dimension_schema: dimensionSchema,
        price_variants: priceVariants,
      })

      if (result.error) {
        setError(result.error)
      } else {
        onSaved({
          ...material,
          name: name.trim(),
          reference: reference.trim() || null,
          item_kind: material.item_kind,
          unit: unit || null,
          category: effectiveCategory || null,
          supplier: supplier.trim() || null,
          description: description.trim() || null,
          purchase_price: parseFloat(purchasePrice) || null,
          margin_rate: parseFloat(marginRate) || null,
          sale_price: effectiveSalePrice,
          dimension_pricing_mode: dimMode,
          dimension_pricing_enabled: dimMode !== 'none',
          base_length_m: displayUnitToMeters(parseFloat(baseLength), dimensionSchemaState.length.unit),
          base_width_m: dimMode === 'area' || dimMode === 'volume' ? displayUnitToMeters(parseFloat(baseWidth), dimensionSchemaState.width.unit) : null,
          base_height_m: dimMode === 'volume' ? displayUnitToMeters(parseFloat(baseHeight), dimensionSchemaState.height.unit) : null,
          dimension_schema: dimensionSchema,
          price_variants: priceVariants.map((variant, index) => ({
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
            created_at: new Date().toISOString(),
          })),
        })
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] w-full max-w-2xl max-h-[92vh] flex flex-col relative animate-in fade-in zoom-in duration-300">
        <div className="px-8 pt-8 pb-4 shrink-0 flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-primary">Modifier {kindLabels.singular.toLowerCase()}</h2>
            <p className="text-sm text-secondary mt-0.5">{material.reference ?? material.name}</p>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors mt-1"><X className="w-6 h-6" /></button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="overflow-y-auto flex-1 px-8 pb-6 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Désignation */}
            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-semibold text-secondary">Désignation *</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} required className={inputCls} />
            </div>

            {/* Référence */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Référence interne</label>
              <input type="text" value={reference} onChange={e => setReference(e.target.value)} className={inputCls} />
            </div>

            {/* Unité */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Unité</label>
              <UnitSelect
                value={unit}
                onChange={setUnit}
                allowedUnits={material.item_kind === 'service' ? catalogContext.unitSetsByKind.service : catalogContext.unitSetsByKind.material}
                className="w-full px-4 py-3 rounded-xl"
              />
            </div>

            {/* Catégorie */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Catégorie</label>
              {newCatMode ? (
                <div className="flex gap-2">
                  <input type="text" value={newCategory} onChange={e => setNewCategory(e.target.value)} placeholder="Nom de la catégorie" autoFocus
                    className="flex-1 px-4 py-3 bg-base dark:bg-white/5 border border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none" />
                  <button type="button" onClick={() => setNewCatMode(false)} className="px-3 rounded-xl text-secondary hover:text-primary">✕</button>
                </div>
              ) : (
                <select value={category} onChange={e => { if (e.target.value === '__new__') { setNewCatMode(true) } else setCategory(e.target.value) }}
                  className={`${inputCls} appearance-none`}>
                  <option value="">Sélectionner...</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="__new__">＋ Créer une catégorie</option>
                </select>
              )}
            </div>

            {/* Fournisseur */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Fournisseur</label>
              <input type="text" value={supplier} onChange={e => setSupplier(e.target.value)} className={inputCls} />
            </div>

            {/* Description */}
            <div className="md:col-span-2 space-y-2">
              <label className="text-sm font-semibold text-secondary">Description interne</label>
              <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
                className={`${inputCls} resize-none`} placeholder="Notes internes, caractéristiques techniques..." />
            </div>

            {/* Prix */}
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">{material.item_kind === 'service' ? 'Coût de revient (HT)' : "Coût d'achat (HT)"}</label>
              <div className="relative">
                <input type="number" step="0.01" value={purchasePrice} onChange={e => handlePurchaseChange(e.target.value)} className={`${inputCls} pr-8`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">€</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Marge cible (%)</label>
              <div className="relative">
                <input type="number" value={marginRate} onChange={e => handleMarginChange(e.target.value)} className={`${inputCls} pr-8`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">%</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Prix de vente HT</label>
              <div className="relative">
                <input type="number" step="0.01" value={computedSalePrice} onChange={e => setSalePrice(e.target.value)} className={`${inputCls} pr-8`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">€</span>
              </div>
            </div>
            {/* Tarification dimensionnelle */}
            <div className="md:col-span-2 card p-4 space-y-4 dark:bg-white/4">
              <p className="text-sm font-semibold text-primary">Tarification selon dimensions</p>
              <p className="text-sm text-secondary">
                Permet de calculer le prix automatiquement depuis les dimensions saisies dans le devis. Choisissez le mode qui correspond à ce {kindLabels.singular.toLowerCase()}, puis renseignez le prix de référence et les dimensions associées.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {profileLabels.dimensionModes.map(({ value, label, help }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setDimMode(value)
                      if (value === 'none') setShowAdvancedDimensions(false)
                    }}
                    className={`rounded-xl border px-3 py-3 text-left transition-all ${dimMode === value ? 'bg-accent text-black border-accent shadow-sm' : 'bg-base border-[var(--elevation-border)] hover:border-accent hover:bg-black/5 dark:hover:bg-white/8'}`}>
                    <span className={`block ${dimMode === value ? 'text-black' : 'text-primary'}`}>{label}</span>
                    <span className={`mt-1 block text-[10px] font-medium leading-tight ${dimMode === value ? 'text-black/75' : 'text-secondary'}`}>{help}</span>
                  </button>
                ))}
              </div>

              {dimMode !== 'none' && (
                <>
                  <div className="rounded-xl border border-[var(--elevation-border)] bg-base p-4 space-y-3 dark:bg-white/5">
                    <div>
                      <p className="text-sm font-semibold text-primary">Dimensions de référence</p>
                      <p className="text-sm text-secondary">Saisissez uniquement les dimensions utilisées pour calculer le prix de base.</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-secondary uppercase tracking-wider">{dimensionSchemaState.length.label} ({dimensionSchemaState.length.unit})</label>
                        <input type="number" min="0" step="0.001" value={baseLength} onChange={e => setBaseLength(e.target.value)} placeholder="1.000" className={`${inputCls} ${(!baseLength || parseFloat(baseLength) <= 0) ? 'border-amber-400/60' : ''}`} />
                      </div>
                      {(dimMode === 'area' || dimMode === 'volume') && (
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-secondary uppercase tracking-wider">{dimensionSchemaState.width.label} ({dimensionSchemaState.width.unit})</label>
                          <input type="number" min="0" step="0.001" value={baseWidth} onChange={e => setBaseWidth(e.target.value)} placeholder="1.000" className={`${inputCls} ${(!baseWidth || parseFloat(baseWidth) <= 0) ? 'border-amber-400/60' : ''}`} />
                        </div>
                      )}
                      {dimMode === 'volume' && (
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-secondary uppercase tracking-wider">{dimensionSchemaState.height.label} ({dimensionSchemaState.height.unit})</label>
                          <input type="number" min="0" step="0.001" value={baseHeight} onChange={e => setBaseHeight(e.target.value)} placeholder="0.100" className={`${inputCls} ${(!baseHeight || parseFloat(baseHeight) <= 0) ? 'border-amber-400/60' : ''}`} />
                        </div>
                      )}
                    </div>
                    {((!baseLength || parseFloat(baseLength) <= 0) ||
                      ((dimMode === 'area' || dimMode === 'volume') && (!baseWidth || parseFloat(baseWidth) <= 0)) ||
                      (dimMode === 'volume' && (!baseHeight || parseFloat(baseHeight) <= 0))) && (
                      <p className="flex items-center gap-1.5 text-xs text-amber-500">
                        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                        Sans ces dimensions, le prix sera appliqué tel quel (quantité 1) dans les devis -- le calcul automatique ne fonctionnera pas.
                      </p>
                    )}
                  </div>
                  <div className="flex justify-start">
                    <button
                      type="button"
                      onClick={() => setShowAdvancedDimensions(prev => !prev)}
                      className="rounded-full border border-[var(--elevation-border)] bg-base px-4 py-2 text-xs font-semibold text-secondary transition-colors hover:border-accent hover:text-accent dark:bg-white/5"
                    >
                      {showAdvancedDimensions ? 'Masquer les réglages avancés' : 'Réglages avancés (libellés, unités, variantes de prix)'}
                    </button>
                  </div>
                  {showAdvancedDimensions && (
                    <div className="rounded-xl border border-[var(--elevation-border)] bg-base p-4 dark:bg-white/5">
                      <DimensionConfigEditor
                        mode={dimMode}
                        schema={dimensionSchemaState}
                        variants={variants}
                        labels={profileLabels.dimensionEditorLabels}
                        onSchemaChange={setDimensionSchemaState}
                        onVariantsChange={setVariants}
                      />
                    </div>
                  )}
                </>
              )}

              {preview && preview.unitPrice > 0 && (
                <p className="text-xs text-secondary">
                  Prix unitaire calculé : <span className="font-bold text-accent">{preview.unitPrice.toFixed(2)} € / {preview.unit}</span>
                  {' '}· Base de référence : {preview.quantity} {preview.unit}
                </p>
              )}
            </div>
          </div>

          {unit === 'forfait' && (
            <p className="text-xs text-secondary rounded-xl border border-[var(--elevation-border)] bg-base/30 px-4 py-3">
              {profileLabels.forfaitHelp}
            </p>
          )}
          </div>
          <div className="px-8 py-5 border-t border-[var(--elevation-border)] shrink-0 flex justify-end gap-4">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
            <button type="submit" disabled={isPending}
              className="px-8 py-3 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-60 disabled:scale-100">
              {isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Enregistrer
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
