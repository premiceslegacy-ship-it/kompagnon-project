'use client'

import React, { useState, useTransition, useEffect } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { useRouter } from 'next/navigation'
import { formatCurrency, ActionMenu } from '@/components/shared'
import { type CatalogMaterial, type CatalogLaborRate, type PrestationType, type PrestationTypeItem, type PrestationItemType } from '@/lib/data/queries/catalog'
import {
  createMaterial, updateMaterial, deleteMaterial,
  createLaborRate, updateLaborRate, deleteLaborRate,
  importMaterials, importLaborRates,
  createPrestationType, updatePrestationType, deletePrestationType, setPrestationTypeItems,
  type CreateMaterialState, type CreateLaborRateState, type ImportCatalogState,
} from '@/lib/data/mutations/catalog'
import { Search, Plus, Trash2, X, Package, AlertCircle, Loader2, FileUp, Download, CheckCircle2, Layers, Pencil, ToggleLeft, ToggleRight, Eye, EyeOff, Wrench, Truck, Tag, Copy } from 'lucide-react'
import { EditMaterialModal } from './EditMaterialModal'
import { UnitSelect } from '@/components/ui/UnitSelect'
import DimensionConfigEditor, { type EditableDimensionSchemaState, type EditableVariantState } from '@/components/catalog/DimensionConfigEditor'
import { displayUnitToMeters, formatDimensionLabel, getDimensionFieldDefinition, normalizeDimensionSchema, type DimensionPricingMode } from '@/lib/catalog-pricing'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { getCatalogLabelsForProfile, getCatalogSaleUnitPrice, getInternalResourceUnitCost } from '@/lib/catalog-ui'

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  initialMaterials: CatalogMaterial[]
  initialLaborRates: CatalogLaborRate[]
  initialPrestationTypes: PrestationType[]
  catalogContext: ResolvedCatalogContext
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const inputCls = 'w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all'

const CATEGORY_COLORS: Record<string, string> = {
  'Acier': 'bg-slate-500/10 text-slate-500',
  'Acier Galvanisé': 'bg-slate-500/10 text-slate-500',
  'Inox': 'bg-zinc-500/10 text-zinc-500',
  'Aluminium': 'bg-blue-500/10 text-blue-500',
  'Profilé': 'bg-stone-500/10 text-stone-500',
  'Ingénierie': 'bg-accent/10 text-accent',
  'Usinage': 'bg-orange-500/10 text-orange-500',
  'Assemblage': 'bg-red-500/10 text-red-500',
  'Finition': 'bg-teal-500/10 text-teal-500',
}

function getCategoryBadge(category: string | null) {
  const cat = category || '-'
  return (
    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${CATEGORY_COLORS[cat] || 'bg-secondary/10 text-secondary'}`}>
      {cat}
    </span>
  )
}

function buildEditableSchemaState(raw: CatalogMaterial['dimension_schema'] | null | undefined, mode: DimensionPricingMode): EditableDimensionSchemaState {
  return {
    length: getDimensionFieldDefinition(raw, 'length', mode),
    width: getDimensionFieldDefinition(raw, 'width', mode),
    height: getDimensionFieldDefinition(raw, 'height', mode),
  }
}

// ─── SubmitButton ─────────────────────────────────────────────────────────────

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
    >
      {pending ? <><Loader2 className="w-4 h-4 animate-spin" />{label}...</> : label}
    </button>
  )
}

// ─── NewMaterialModal ─────────────────────────────────────────────────────────

const initMaterialState: CreateMaterialState = { error: null, success: false }

function NewMaterialModal({
  isOpen,
  onClose,
  categories,
  defaultKind,
  catalogContext,
}: {
  isOpen: boolean
  onClose: () => void
  categories: string[]
  defaultKind: 'article' | 'service'
  catalogContext: ResolvedCatalogContext
}) {
  const [state, formAction] = useFormState(createMaterial, initMaterialState)
  const [purchasePrice, setPurchasePrice] = useState('')
  const [margin, setMargin] = useState('')
  const [newCatMode, setNewCatMode] = useState(false)
  const [dimMode, setDimMode] = useState<'none' | 'linear' | 'area' | 'volume'>('none')
  const [baseLength, setBaseLength] = useState('1')
  const [baseWidth, setBaseWidth] = useState('1')
  const [baseHeight, setBaseHeight] = useState('')
  const [dimError, setDimError] = useState<string | null>(null)
  const [dimensionSchemaState, setDimensionSchemaState] = useState<EditableDimensionSchemaState>(() => buildEditableSchemaState(null, 'none'))
  const [variants, setVariants] = useState<EditableVariantState[]>([])
  const [showAdvancedDimensions, setShowAdvancedDimensions] = useState(false)
  const [unit, setUnit] = useState(defaultKind === 'service' ? 'forfait' : 'u')
  const kindLabels = defaultKind === 'service' ? catalogContext.labelSet.service : catalogContext.labelSet.material
  const profileLabels = getCatalogLabelsForProfile(catalogContext)

  const computedSalePrice = purchasePrice && margin
    ? (parseFloat(purchasePrice) * (1 + parseFloat(margin) / 100)).toFixed(2)
    : ''

  React.useEffect(() => { if (state.success) onClose() }, [state.success, onClose])
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] w-full max-w-2xl max-h-[92vh] flex flex-col relative animate-in fade-in zoom-in duration-300">
        <div className="px-8 pt-8 pb-4 shrink-0 flex items-start justify-between">
          <h2 className="text-2xl font-bold text-primary">{kindLabels.createLabel}</h2>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors mt-1"><X className="w-6 h-6" /></button>
        </div>

        <form
          action={formAction}
          className="flex flex-col flex-1 min-h-0 overflow-hidden"
          onSubmit={(e) => {
            if (dimMode !== 'none') {
              if (!baseLength || parseFloat(baseLength) <= 0) {
                e.preventDefault()
                setDimError('Renseignez la longueur de référence pour activer la tarification dimensionnelle.')
                return
              }
              if ((dimMode === 'area' || dimMode === 'volume') && (!baseWidth || parseFloat(baseWidth) <= 0)) {
                e.preventDefault()
                setDimError('Renseignez la largeur de référence pour le mode Surface.')
                return
              }
              if (dimMode === 'volume' && (!baseHeight || parseFloat(baseHeight) <= 0)) {
                e.preventDefault()
                setDimError('Renseignez la hauteur de référence pour le mode Volume.')
                return
              }
            }
            setDimError(null)
          }}
        >
          <div className="overflow-y-auto flex-1 px-8 pb-6 space-y-6">
          {(state.error || dimError) && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">{dimError ?? state.error}</p>
            </div>
          )}
          <input type="hidden" name="item_kind" value={defaultKind} />
          <input type="hidden" name="dimension_schema" value={JSON.stringify(normalizeDimensionSchema(dimensionSchemaState, dimMode))} />
          <input
            type="hidden"
            name="price_variants"
            value={JSON.stringify(variants.map((variant, index) => ({
              label: variant.label.trim() || null,
              reference_suffix: variant.reference_suffix.trim() || null,
              dimension_values: {
                ...(variant.length ? { length_m: displayUnitToMeters(parseFloat(variant.length), dimensionSchemaState.length.unit) } : {}),
                ...(variant.width ? { width_m: displayUnitToMeters(parseFloat(variant.width), dimensionSchemaState.width.unit) } : {}),
                ...(variant.height ? { height_m: displayUnitToMeters(parseFloat(variant.height), dimensionSchemaState.height.unit) } : {}),
              },
              purchase_price: parseFloat(variant.purchase_price) || null,
              sale_price: parseFloat(variant.sale_price) || null,
              is_default: variant.is_default,
              position: index,
            })))}
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Désignation *</label>
              <input name="name" type="text" required placeholder={defaultKind === 'service' ? `ex: ${catalogContext.labelSet.service.singular}` : `ex: ${catalogContext.labelSet.material.singular}`} className={inputCls} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Référence interne</label>
              <input name="reference" type="text" placeholder="ex: AC-S235-2MM" className={inputCls} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Catégorie</label>
              {newCatMode ? (
                <div className="flex gap-2">
                  <input name="category" type="text" placeholder="Nom de la catégorie" className="flex-1 px-4 py-3 bg-base dark:bg-white/5 border border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none" autoFocus />
                  <button type="button" onClick={() => setNewCatMode(false)} className="px-3 rounded-xl text-secondary hover:text-primary">✕</button>
                </div>
              ) : (
                <select name="category" className={`${inputCls} appearance-none`} onChange={e => { if (e.target.value === '__new__') setNewCatMode(true) }}>
                  <option value="">Sélectionner...</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="__new__">＋ Créer une catégorie</option>
                </select>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Unité</label>
              <input type="hidden" name="unit" value={unit} />
              <UnitSelect value={unit} onChange={setUnit} allowedUnits={defaultKind === 'service' ? catalogContext.unitSetsByKind.service : catalogContext.unitSetsByKind.material} className="w-full px-4 py-3 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">{defaultKind === 'service' ? "Coût de revient (HT)" : "Coût d'achat (HT)"}</label>
              <div className="relative">
                <input name="purchase_price" type="number" step="0.01" placeholder="0.00" value={purchasePrice}
                  onChange={e => { setPurchasePrice(e.target.value) }} className={`${inputCls} pr-8`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">€</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Marge cible (%)</label>
              <div className="relative">
                <input name="margin_rate" type="number" placeholder="30" value={margin}
                  onChange={e => { setMargin(e.target.value) }} className={`${inputCls} pr-8`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">%</span>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Prix de vente HT</label>
              <div className="relative">
                <input name="sale_price" type="number" step="0.01" placeholder="Calculé auto"
                  value={computedSalePrice} onChange={() => {}} className={`${inputCls} pr-8`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary">€</span>
              </div>
            </div>
            <div className="md:col-span-2 card p-4 space-y-4 dark:bg-white/4">
              <p className="text-sm font-semibold text-primary">Tarification selon dimensions</p>
              <p className="text-sm text-secondary">
                Choisissez seulement la logique utile a ce {kindLabels.singular.toLowerCase()}, puis renseignez la base de calcul.
              </p>
              <input type="hidden" name="dimension_pricing_mode" value={dimMode} />
              <input type="hidden" name="base_length_m" value={String(displayUnitToMeters(parseFloat(baseLength), dimensionSchemaState.length.unit) ?? '')} />
              <input type="hidden" name="base_width_m" value={String(displayUnitToMeters(parseFloat(baseWidth), dimensionSchemaState.width.unit) ?? '')} />
              <input type="hidden" name="base_height_m" value={String(displayUnitToMeters(parseFloat(baseHeight), dimensionSchemaState.height.unit) ?? '')} />
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {profileLabels.dimensionModes.map(({ value, label, help }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      setDimMode(value)
                      setDimensionSchemaState(buildEditableSchemaState(null, value))
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
                        <input type="number" min="0" step="0.001" placeholder="1.000" value={baseLength} onChange={e => setBaseLength(e.target.value)} className={`${inputCls} ${(!baseLength || parseFloat(baseLength) <= 0) ? 'border-amber-400/60' : ''}`} />
                      </div>
                      {(dimMode === 'area' || dimMode === 'volume') && (
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-secondary uppercase tracking-wider">{dimensionSchemaState.width.label} ({dimensionSchemaState.width.unit})</label>
                          <input type="number" min="0" step="0.001" placeholder="1.000" value={baseWidth} onChange={e => setBaseWidth(e.target.value)} className={`${inputCls} ${(!baseWidth || parseFloat(baseWidth) <= 0) ? 'border-amber-400/60' : ''}`} />
                        </div>
                      )}
                      {dimMode === 'volume' && (
                        <div className="space-y-2">
                          <label className="text-xs font-semibold text-secondary uppercase tracking-wider">{dimensionSchemaState.height.label} ({dimensionSchemaState.height.unit})</label>
                          <input type="number" min="0" step="0.001" placeholder="0.100" value={baseHeight} onChange={e => setBaseHeight(e.target.value)} className={`${inputCls} ${(!baseHeight || parseFloat(baseHeight) <= 0) ? 'border-amber-400/60' : ''}`} />
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
                      className="rounded-full border border-[var(--elevation-border)] bg-base px-4 py-2 text-xs font-semibold text-primary transition-colors hover:border-accent hover:text-accent dark:bg-white/5"
                    >
                      {showAdvancedDimensions ? 'Masquer les options avancées' : 'Afficher les options avancées'}
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
            <SubmitButton label={kindLabels.createLabel} />
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── NewLaborRateModal ────────────────────────────────────────────────────────

const initLaborState: CreateLaborRateState = { error: null, success: false }

function NewLaborRateModal({ isOpen, onClose, categories, catalogContext }: { isOpen: boolean; onClose: () => void; categories: string[]; catalogContext: ResolvedCatalogContext }) {
  const [state, formAction] = useFormState(createLaborRate, initLaborState)
  const [costRate, setCostRate] = useState('')
  const [newCatMode, setNewCatMode] = useState(false)
  const [unit, setUnit] = useState(catalogContext.unitSetsByKind.laborRate[0] ?? 'h')

  React.useEffect(() => { if (state.success) onClose() }, [state.success, onClose])
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] w-full max-w-2xl p-8 relative animate-in fade-in zoom-in duration-300">
        <button onClick={onClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        <h2 className="text-2xl font-bold text-primary mb-6">{catalogContext.laborRateUi.modalTitle}</h2>

        {state.error && (
          <div className="mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
            <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
            <p className="text-xs text-red-400">{state.error}</p>
          </div>
        )}

        <form action={formAction} className="space-y-6">
          <input type="hidden" name="unit" value={unit} />
          <input type="hidden" name="rate" value={costRate} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">{catalogContext.laborRateUi.tableColumnType}</label>
              <select name="type" className={`${inputCls} appearance-none`}>
                {catalogContext.resourceTypeOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">{catalogContext.laborRateUi.designationLabel} *</label>
              <input name="designation" type="text" required placeholder="ex: Pliage CN" className={inputCls} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Catégorie</label>
              {newCatMode ? (
                <div className="flex gap-2">
                  <input name="category" type="text" placeholder="Nom de la catégorie" className="flex-1 px-4 py-3 bg-base dark:bg-white/5 border border-accent rounded-xl text-primary outline-none" autoFocus />
                  <button type="button" onClick={() => setNewCatMode(false)} className="px-3 rounded-xl text-secondary hover:text-primary">✕</button>
                </div>
              ) : (
                <select name="category" className={`${inputCls} appearance-none`} onChange={e => { if (e.target.value === '__new__') setNewCatMode(true) }}>
                  <option value="">Sélectionner...</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                  <option value="__new__">＋ Créer une catégorie</option>
                </select>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Référence interne</label>
              <input name="reference" type="text" placeholder={catalogContext.laborRateUi.referencePlaceholder} className={inputCls} />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">Unité</label>
              <UnitSelect value={unit} onChange={setUnit} allowedUnits={catalogContext.unitSetsByKind.laborRate} className="w-full px-4 py-3 rounded-xl" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-semibold text-secondary">{catalogContext.laborRateUi.costLabel}</label>
              <div className="relative">
                <input name="cost_rate" type="number" step="0.01" placeholder="0.00" value={costRate}
                  onChange={e => setCostRate(e.target.value)} className={`${inputCls} pr-14`} />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-secondary text-sm">€/u</span>
              </div>
            </div>
            <div className="md:col-span-2 rounded-2xl border border-[var(--elevation-border)] bg-base/30 p-4">
              <p className="text-xs text-secondary">
                Cette ressource sert a calculer vos couts internes et vos marges. La TVA et la revente se reglent ensuite dans le devis ou la facture.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-4 pt-2">
            <button type="button" onClick={onClose} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
            <SubmitButton label={catalogContext.labelSet.laborRate.createLabel} />
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── NewPrestationModal ───────────────────────────────────────────────────────

type PrestationHeaderForm = {
  name: string
  description: string
  is_active: boolean
}

type LocalItem = {
  tempId: string
  item_type: PrestationItemType
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

type ModalSection = {
  tempId: string
  title: string
  items: LocalItem[]
}

const ITEM_TYPE_CONFIG: Record<PrestationItemType, { color: string; defaultInternal: boolean }> = {
  service:   { color: 'bg-cyan-500/15 text-cyan-500 border-cyan-500/30',      defaultInternal: false },
  labor:     { color: 'bg-blue-500/15 text-blue-500 border-blue-500/30',       defaultInternal: true  },
  transport: { color: 'bg-orange-500/15 text-orange-500 border-orange-500/30', defaultInternal: true  },
  material:  { color: 'bg-teal-500/15 text-teal-500 border-teal-500/30',       defaultInternal: false },
  free:      { color: 'bg-secondary/15 text-secondary border-secondary/30',    defaultInternal: false },
}

const emptyPrestationHeader = (): PrestationHeaderForm => ({
  name: '', description: '', is_active: true,
})

const newLocalItem = (type: PrestationItemType = 'free'): LocalItem => ({
  tempId: Math.random().toString(36).slice(2),
  item_type: type,
  material_id: null,
  labor_rate_id: null,
  designation: '',
  quantity: '1',
  unit: type === 'labor' ? 'h' : type === 'transport' ? 'L' : type === 'service' ? 'forfait' : 'u',
  unit_price_ht: '0',
  unit_cost_ht: '0',
  is_internal: ITEM_TYPE_CONFIG[type].defaultInternal,
  save_to_catalog: false,
})

function toLocalItem(i: PrestationTypeItem): LocalItem {
  return {
    tempId: i.id,
    item_type: i.item_type,
    material_id: i.material_id,
    labor_rate_id: i.labor_rate_id,
    designation: i.designation,
    quantity: String(i.quantity),
    unit: i.unit,
    unit_price_ht: String(i.unit_price_ht),
    unit_cost_ht: String(i.unit_cost_ht),
    is_internal: i.is_internal,
    save_to_catalog: false,
  }
}

function ItemRow({
  item, sectionTempId, materials, laborRates, lineTypeLabels,
  serviceItemPlaceholder, materialItemPlaceholder,
  onPatch, onRemove,
}: {
  item: LocalItem
  sectionTempId: string
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  lineTypeLabels: ResolvedCatalogContext['bundleTemplateUi']['lineTypeLabels']
  serviceItemPlaceholder: string
  materialItemPlaceholder: string
  onPatch: (sectionId: string, itemId: string, patch: Partial<LocalItem>) => void
  onRemove: (sectionId: string, itemId: string) => void
}) {
  const cfg = ITEM_TYPE_CONFIG[item.item_type]
  const UNITS = ['h', 'j', 'sem', 'u', 'm²', 'ml', 'kg', 'L', 'forfait', 't', 'm³']
  const patch = (p: Partial<LocalItem>) => onPatch(sectionTempId, item.tempId, p)

  // ── Calculateur carburant (transport uniquement) ──────────────────────────
  const [transKm, setTransKm] = React.useState(() => item.item_type === 'transport' ? Math.round((parseFloat(item.quantity) || 0) * 100 / (8)) : 0)
  const [transConso, setTransConso] = React.useState(8)
  const [transPrixL, setTransPrixL] = React.useState(() => item.item_type === 'transport' ? parseFloat(item.unit_cost_ht) || 1.85 : 1.85)
  const transLiters = Math.round(transKm * transConso / 100 * 100) / 100

  React.useEffect(() => {
    if (item.item_type !== 'transport' || transKm <= 0) return
    patch({
      quantity: String(transLiters),
      unit: 'L',
      unit_cost_ht: String(transPrixL),
      designation: item.designation || `Carburant - trajet ${transKm} km`,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [transKm, transConso, transPrixL])

  function pickMaterial(materialId: string) {
    const mat = materials.find(m => m.id === materialId)
    if (!mat) return
    patch({ material_id: mat.id, labor_rate_id: null, designation: mat.name, unit: mat.unit ?? 'u', unit_price_ht: String(getCatalogSaleUnitPrice(mat)), unit_cost_ht: String(mat.purchase_price ?? 0) })
  }

  function pickLaborRate(laborId: string) {
    const lr = laborRates.find(l => l.id === laborId)
    if (!lr) return
    const internalCost = getInternalResourceUnitCost(lr)
    patch({ labor_rate_id: lr.id, material_id: null, designation: lr.designation, unit: lr.unit ?? 'h', unit_price_ht: String(internalCost), unit_cost_ht: String(internalCost) })
  }

  return (
    <tr className="hover:bg-accent/5 transition-colors">
      {/* Type */}
      <td className="px-3 py-2">
        <select
          value={item.item_type}
          onChange={e => {
            const t = e.target.value as PrestationItemType
            patch({ item_type: t, is_internal: ITEM_TYPE_CONFIG[t].defaultInternal, material_id: null, labor_rate_id: null, unit: t === 'labor' ? 'h' : t === 'transport' ? 'L' : t === 'service' ? 'forfait' : item.unit })
          }}
          className={`px-2 py-1 rounded-lg text-xs font-bold border appearance-none cursor-pointer ${cfg.color} bg-transparent`}
        >
          {(Object.keys(ITEM_TYPE_CONFIG) as PrestationItemType[]).map(k => (
            <option key={k} value={k}>{lineTypeLabels[k]}</option>
          ))}
        </select>
      </td>

      {/* Désignation */}
      <td className="px-3 py-2 min-w-[160px]">
        {item.item_type === 'labor' ? (
          <div className="flex gap-1.5">
            <input type="text" value={item.designation} onChange={e => patch({ designation: e.target.value })} placeholder="ex: Poseur" className="flex-1 px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none" />
            {laborRates.length > 0 && (
              <select value={item.labor_rate_id ?? ''} onChange={e => { if (e.target.value) pickLaborRate(e.target.value) }} className="px-1 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-secondary text-xs outline-none appearance-none cursor-pointer" title="Choisir depuis le catalogue">
                <option value="">↑ Catalogue</option>
                {laborRates.map(lr => <option key={lr.id} value={lr.id}>{lr.designation}</option>)}
              </select>
            )}
          </div>
        ) : item.item_type === 'material' || item.item_type === 'service' ? (
          <div className="space-y-1">
            <div className="flex gap-1.5">
              <input type="text" value={item.designation} onChange={e => patch({ designation: e.target.value, material_id: null })} placeholder={item.item_type === 'service' ? serviceItemPlaceholder : materialItemPlaceholder} className="flex-1 px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none" />
              {materials.length > 0 && (
                <select value={item.material_id ?? ''} onChange={e => { if (e.target.value) pickMaterial(e.target.value) }} className="px-1 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-secondary text-xs outline-none appearance-none cursor-pointer" title="Choisir depuis le catalogue">
                  <option value="">↑ Catalogue</option>
                  {materials
                    .filter(m => item.item_type === 'service' ? m.item_kind === 'service' : m.item_kind !== 'service')
                    .map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              )}
            </div>
            {!item.material_id && item.designation.trim() && (
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input type="checkbox" checked={item.save_to_catalog} onChange={e => patch({ save_to_catalog: e.target.checked })} className="w-3 h-3 accent-[var(--accent)]" />
                <span className="text-[10px] text-secondary">Enregistrer dans le catalogue</span>
              </label>
            )}
          </div>
        ) : item.item_type === 'transport' ? (
          <div className="space-y-1.5">
            <input type="text" value={item.designation} onChange={e => patch({ designation: e.target.value })} placeholder="ex: Carburant - trajet" className="w-full px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none" />
            <div className="flex items-center gap-1.5 flex-wrap">
              <label className="flex items-center gap-1 text-xs text-secondary whitespace-nowrap">
                km A/R
                <input type="number" min={0} value={transKm || ''} onChange={e => setTransKm(Number(e.target.value))}
                  className="w-14 px-1.5 py-0.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded text-primary tabular-nums text-right text-xs outline-none" />
              </label>
              <label className="flex items-center gap-1 text-xs text-secondary whitespace-nowrap">
                L/100
                <input type="number" min={1} step={0.1} value={transConso} onChange={e => setTransConso(Number(e.target.value))}
                  className="w-12 px-1.5 py-0.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded text-primary tabular-nums text-right text-xs outline-none" />
              </label>
              <label className="flex items-center gap-1 text-xs text-secondary whitespace-nowrap">
                €/L
                <input type="number" min={0} step={0.01} value={transPrixL} onChange={e => setTransPrixL(Number(e.target.value))}
                  className="w-14 px-1.5 py-0.5 bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded text-primary tabular-nums text-right text-xs outline-none" />
              </label>
              {transKm > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-md bg-amber-500/15 text-amber-600 font-semibold border border-amber-500/30 whitespace-nowrap">
                  = {transLiters.toFixed(2)} L
                </span>
              )}
            </div>
          </div>
        ) : (
          <input type="text" value={item.designation} onChange={e => patch({ designation: e.target.value })} placeholder="Désignation..." className="w-full px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none" />
        )}
      </td>

      {/* Quantité */}
      <td className="px-3 py-2">
        {item.item_type === 'transport' ? (
          <span className="block w-14 px-2 py-1 text-primary text-sm text-right tabular-nums opacity-60">{transLiters > 0 ? transLiters.toFixed(2) : '—'}</span>
        ) : (
          <input type="number" step="0.01" value={item.quantity} onChange={e => patch({ quantity: e.target.value })} className="w-14 px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm text-right tabular-nums outline-none" />
        )}
      </td>

      {/* Unité */}
      <td className="px-3 py-2">
        {item.item_type === 'transport' ? (
          <span className="block px-2 py-1 text-primary text-sm opacity-60">L</span>
        ) : (
          <select value={item.unit} onChange={e => patch({ unit: e.target.value })} className="px-2 py-1 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm outline-none appearance-none">
            {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            {!UNITS.includes(item.unit) && <option value={item.unit}>{item.unit}</option>}
          </select>
        )}
      </td>

      {/* PU HT */}
      <td className="px-3 py-2">
        {item.item_type === 'transport' ? (
          <span className="block w-20 px-2 py-1 text-right tabular-nums text-sm opacity-60">{transPrixL.toFixed(2)} €</span>
        ) : (
          <div className="relative">
            <input type="number" step="0.01" value={item.unit_price_ht} onChange={e => patch({ unit_price_ht: e.target.value })} disabled={item.is_internal} className="w-20 px-2 py-1 pr-5 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm text-right tabular-nums outline-none disabled:opacity-40" />
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-secondary text-xs">€</span>
          </div>
        )}
      </td>

      {/* CR HT */}
      <td className="px-3 py-2">
        <div className="relative">
          <input type="number" step="0.01" value={item.unit_cost_ht} onChange={e => patch({ unit_cost_ht: e.target.value })} className="w-20 px-2 py-1 pr-5 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-lg text-primary text-sm text-right tabular-nums outline-none" />
          <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-secondary text-xs">€</span>
        </div>
      </td>

      {/* Interne toggle */}
      <td className="px-3 py-2 text-center">
        <button type="button" onClick={() => patch({ is_internal: !item.is_internal })} title={item.is_internal ? 'Interne (caché du devis client)' : 'Visible dans le devis client'} className={`transition-colors ${item.is_internal ? 'text-accent' : 'text-secondary/30 hover:text-secondary'}`}>
          {item.is_internal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </td>

      {/* Supprimer */}
      <td className="px-2 py-2">
        <button type="button" onClick={() => onRemove(sectionTempId, item.tempId)} className="p-1.5 rounded-lg text-red-400/60 hover:text-red-500 hover:bg-red-500/10 transition-colors">
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  )
}

function NewPrestationModal({
  isOpen, onClose, editing, onSaved, materials, laborRates, catalogContext,
}: {
  isOpen: boolean
  onClose: () => void
  editing: PrestationType | null
  onSaved: () => void
  categories?: string[]
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  catalogContext: ResolvedCatalogContext
}) {
  const [form, setForm] = useState<PrestationHeaderForm>(emptyPrestationHeader())
  const [sections, setSections] = useState<ModalSection[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = React.useTransition()
  const { serviceItemPlaceholder, materialItemPlaceholder } = getCatalogLabelsForProfile(catalogContext)

  React.useEffect(() => {
    if (!isOpen) return
    if (editing) {
      setForm({ name: editing.name, description: editing.description ?? '', is_active: editing.is_active })
      const sorted = [...(editing.items ?? [])].sort((a, b) => a.position - b.position)
      // Regroup by section_title
      const map = new Map<string, LocalItem[]>()
      for (const it of sorted) {
        const key = it.section_title || ''
        if (!map.has(key)) map.set(key, [])
        map.get(key)!.push(toLocalItem(it))
      }
      if (map.size === 0) {
        setSections([{ tempId: Math.random().toString(36).slice(2), title: '', items: [] }])
      } else {
        setSections([...map.entries()].map(([title, items]) => ({ tempId: Math.random().toString(36).slice(2), title, items })))
      }
    } else {
      setForm(emptyPrestationHeader())
      setSections([{ tempId: Math.random().toString(36).slice(2), title: '', items: [] }])
    }
    setError(null)
  }, [isOpen, editing])

  const allItems = sections.flatMap(s => s.items)
  const totalPriceHt = allItems.reduce((s, i) => !i.is_internal ? s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_price_ht) || 0) : s, 0)
  const totalCostHt  = allItems.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * (parseFloat(i.unit_cost_ht) || 0), 0)
  const computedMargin = totalPriceHt > 0 ? ((totalPriceHt - totalCostHt) / totalPriceHt * 100).toFixed(1) : null

  function addSection() {
    setSections(prev => [...prev, { tempId: Math.random().toString(36).slice(2), title: '', items: [] }])
  }

  function removeSection(sectionId: string) {
    setSections(prev => prev.filter(s => s.tempId !== sectionId))
  }

  function patchSectionTitle(sectionId: string, title: string) {
    setSections(prev => prev.map(s => s.tempId === sectionId ? { ...s, title } : s))
  }

  function addItemToSection(sectionId: string, type: PrestationItemType) {
    setSections(prev => prev.map(s => s.tempId === sectionId ? { ...s, items: [...s.items, newLocalItem(type)] } : s))
  }

  function patchItemInSection(sectionId: string, itemId: string, patch: Partial<LocalItem>) {
    setSections(prev => prev.map(s => s.tempId === sectionId ? { ...s, items: s.items.map(i => i.tempId === itemId ? { ...i, ...patch } : i) } : s))
  }

  function removeItemFromSection(sectionId: string, itemId: string) {
    setSections(prev => prev.map(s => s.tempId === sectionId ? { ...s, items: s.items.filter(i => i.tempId !== itemId) } : s))
  }

  function handleSubmit() {
    if (!form.name.trim()) { setError('Le nom est requis.'); return }
    setError(null)
    startTransition(async () => {
      const headerPayload = {
        name: form.name.trim(),
        description: form.description.trim() || null,
        unit: 'forfait',
        category: null,
        basePriceHt: 0,
        baseCostHt: 0,
        isActive: form.is_active,
      }

      let prestationId: string
      if (editing) {
        const res = await updatePrestationType(editing.id, headerPayload)
        if (res.error) { setError(res.error); return }
        prestationId = editing.id
      } else {
        const res = await createPrestationType(headerPayload)
        if (res.error || !res.id) { setError(res.error ?? 'Erreur inconnue'); return }
        prestationId = res.id
      }

      let position = 0
      const itemsPayload = sections.flatMap(section =>
        section.items.map(item => ({
          position: position++,
          section_title: section.title.trim(),
          item_type: item.item_type,
          material_id: item.material_id,
          labor_rate_id: item.labor_rate_id,
          designation: item.designation.trim() || '-',
          quantity: parseFloat(item.quantity) || 1,
          unit: item.unit || 'u',
          unit_price_ht: parseFloat(item.unit_price_ht) || 0,
          unit_cost_ht: parseFloat(item.unit_cost_ht) || 0,
          is_internal: item.is_internal,
          save_to_catalog: item.save_to_catalog,
        }))
      )

      const res = await setPrestationTypeItems(prestationId, itemsPayload)
      if (res.error) { setError(res.error); return }

      onSaved()
      onClose()
    })
  }

  if (!isOpen) return null

  const setF = (k: keyof PrestationHeaderForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] w-full max-w-5xl max-h-[92vh] flex flex-col relative animate-in fade-in zoom-in duration-300">
        {/* Header */}
        <div className="flex items-center justify-between px-8 pt-8 pb-4 shrink-0">
          <h2 className="text-2xl font-bold text-primary">
            {editing ? `Modifier ${catalogContext.labelSet.bundleTemplate.singular.toLowerCase()}` : catalogContext.labelSet.bundleTemplate.createLabel}
          </h2>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-8 pb-4 space-y-6">
          {error && (
            <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-xs text-red-400">{error}</p>
            </div>
          )}

          {/* Infos générales */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2 space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Nom *</label>
              <input type="text" value={form.name} onChange={setF('name')} placeholder="ex: Pose bardage acier" className={inputCls} />
            </div>
            <div className="md:col-span-3 space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Description</label>
              <textarea value={form.description} onChange={setF('description')} rows={2} placeholder="Détails optionnels..." className={`${inputCls} resize-none`} />
            </div>
            <div className="md:col-span-3 rounded-2xl border border-[var(--elevation-border)] bg-base/30 px-4 py-3">
              <p className="text-xs text-secondary">{getCatalogLabelsForProfile(catalogContext).forfaitHelp}</p>
            </div>
          </div>

          {/* Sections */}
          <div className="space-y-4">
            <h3 className="text-sm font-bold text-secondary uppercase tracking-wider">Composition</h3>

            {sections.map((section, sIdx) => (
              <div key={section.tempId} className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
                {/* Section header */}
                <div className="flex items-center gap-3 px-4 py-3 bg-base/30 border-b border-[var(--elevation-border)]">
                  <input
                    type="text"
                    value={section.title}
                    onChange={e => patchSectionTitle(section.tempId, e.target.value)}
                    placeholder={sections.length === 1 ? 'Titre de section (optionnel)' : `Section ${sIdx + 1}`}
                    className="flex-1 px-3 py-1.5 bg-transparent border border-transparent focus:border-accent rounded-lg text-sm font-semibold text-primary outline-none placeholder:font-normal placeholder:text-secondary/50"
                  />
                  {/* Add item buttons */}
                  <div className="flex items-center gap-1.5">
                    {(['service', 'labor', 'material', 'transport', 'free'] as PrestationItemType[]).map(type => {
                      const cfg = ITEM_TYPE_CONFIG[type]
                      const Icon = type === 'service' ? Package : type === 'labor' ? Wrench : type === 'material' ? Tag : type === 'transport' ? Truck : Plus
                      return (
                        <button key={type} type="button" onClick={() => addItemToSection(section.tempId, type)} className={`px-2.5 py-1 rounded-lg text-xs font-bold border flex items-center gap-1 hover:scale-105 transition-all ${cfg.color}`}>
                          <Icon className="w-3 h-3" />{catalogContext.bundleTemplateUi.lineTypeLabels[type]}
                        </button>
                      )
                    })}
                  </div>
                  {sections.length > 1 && (
                    <button type="button" onClick={() => removeSection(section.tempId)} title="Supprimer la section" className="ml-1 text-secondary hover:text-red-400 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>

                {section.items.length === 0 ? (
                  <div className="py-8 flex flex-col items-center gap-2 text-secondary">
                    <Layers className="w-6 h-6 opacity-30" />
                    <p className="text-xs">Ajoutez des lignes via les boutons ci-dessus.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-base/20">
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-left w-20">Type</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-left">Désignation</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-right w-16">Qté</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider w-20">Unité</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-right w-24">PU HT</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-right w-24">CR HT</th>
                          <th className="px-3 py-2 text-xs font-bold text-secondary uppercase tracking-wider text-center w-12" title="Interne (caché du devis client)">Int.</th>
                          <th className="w-10 px-2" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--elevation-border)]">
                        {section.items.map(item => (
                          <ItemRow
                            key={item.tempId}
                            item={item}
                            sectionTempId={section.tempId}
                            materials={materials}
                            laborRates={laborRates}
                            lineTypeLabels={catalogContext.bundleTemplateUi.lineTypeLabels}
                            serviceItemPlaceholder={serviceItemPlaceholder}
                            materialItemPlaceholder={materialItemPlaceholder}
                            onPatch={patchItemInSection}
                            onRemove={removeItemFromSection}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ))}

            {/* Add section button */}
            <button
              type="button"
              onClick={addSection}
              className="flex items-center gap-2 text-sm text-secondary hover:text-accent transition-colors font-semibold"
            >
              <Plus className="w-4 h-4" />
              Ajouter une section
            </button>

            {/* Légende interne */}
            {allItems.some(i => i.is_internal) && (
              <p className="text-xs text-secondary flex items-center gap-1.5">
                <EyeOff className="w-3 h-3" />
                {catalogContext.bundleTemplateUi.internalLineHelp}
              </p>
            )}
          </div>
        </div>

        {/* Footer sticky */}
        <div className="shrink-0 px-8 py-5 border-t border-[var(--elevation-border)] flex items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <p className="text-xs text-secondary">Prix client HT</p>
              <p className="text-sm font-bold text-primary tabular-nums">{formatCurrency(totalPriceHt)}</p>
            </div>
            <div className="text-center">
              <p className="text-xs text-secondary">Coût de revient</p>
              <p className="text-sm font-bold text-secondary tabular-nums">{formatCurrency(totalCostHt)}</p>
            </div>
            {computedMargin !== null && (
              <div className="px-3 py-1 rounded-lg bg-accent/10 border border-accent/20">
                <p className="text-xs text-accent font-bold">Marge {computedMargin} %</p>
              </div>
            )}
            {editing && (
              <label className="flex items-center gap-2 cursor-pointer ml-2">
                <button type="button" onClick={() => setForm(p => ({ ...p, is_active: !p.is_active }))} className="text-secondary hover:text-primary transition-colors">
                  {form.is_active ? <ToggleRight className="w-7 h-7 text-accent" /> : <ToggleLeft className="w-7 h-7" />}
                </button>
                <span className="text-xs font-semibold text-secondary">{form.is_active ? 'Active' : 'Inactive'}</span>
              </label>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="px-6 py-2.5 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending}
              className="px-8 py-2.5 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
            >
              {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Enregistrement...</> : (editing ? 'Mettre à jour' : catalogContext.labelSet.bundleTemplate.createLabel)}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Import helpers ───────────────────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const sep = lines[0]?.includes(';') ? ';' : ','
  return lines.map(line => {
    const row: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === sep && !inQ) { row.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    row.push(cur.trim())
    return row
  }).filter(r => r.some(c => c))
}

async function parseFileToRows(file: File): Promise<{ headers: string[]; dataRows: string[][] }> {
  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
  if (isExcel) {
    const XLSX = await import('xlsx')
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
    if (rows.length < 2) return { headers: [], dataRows: [] }
    return { headers: rows[0].map(String), dataRows: rows.slice(1).map(r => r.map(String)) }
  }
  const text = await file.text()
  const rows = parseCSV(text)
  if (rows.length < 2) return { headers: [], dataRows: [] }
  return { headers: rows[0], dataRows: rows.slice(1) }
}

function downloadCSVTemplate(fields: Array<{ key: string; label: string }>, filename: string, exampleRow: string[]) {
  const headers = fields.map(f => f.label).join(';')
  const example = exampleRow.map(v => (v.includes(';') ? `"${v}"` : v)).join(';')
  const blob = new Blob(['\uFEFF' + headers + '\n' + example + '\n'], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// ─── ImportModal ──────────────────────────────────────────────────────────────

type ImportField = { key: string; label: string; required?: boolean }
type ImportConfig = { fields: ImportField[]; exampleRow: string[]; filename: string }

function getMaterialImportConfig(catalogContext: ResolvedCatalogContext): ImportConfig {
  const p = catalogContext.businessProfile
  const unitLabel = p === 'industry' ? 'Unité (kg, m, m2, pièce…)' : p === 'cleaning' ? 'Unité (L, kg, u, flacon…)' : 'Unité (m2, ml, m3, u…)'
  const catLabel = p === 'industry' ? 'Catégorie (ex : Métaux, Consommables)' : p === 'cleaning' ? 'Catégorie (ex : Produits, Matériel)' : 'Catégorie (ex : Gros œuvre, Finitions)'
  const supLabel = p === 'industry' ? 'Fournisseur / sous-traitant' : 'Fournisseur'
  const dimMode = p === 'cleaning' ? 'none' : p === 'industry' ? 'area' : 'area'
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
      { key: 'reference', label: 'Référence (optionnel — générée si vide)' },
      { key: 'item_kind', label: 'Type (article ou service)' },
      { key: 'unit', label: unitLabel },
      { key: 'category', label: catLabel },
      { key: 'supplier', label: supLabel },
      { key: 'purchase_price', label: "Prix d'achat HT (€)" },
      { key: 'margin_rate', label: 'Marge (%)' },
      { key: 'sale_price', label: 'Prix de vente HT (€)' },
      { key: 'vat_rate', label: 'TVA (%) — ex : 20, 10, 5.5' },
      { key: 'dimension_pricing_mode', label: 'Tarification dimensionnelle (none, linear, area)' },
      { key: 'dimension_pricing_enabled', label: 'Activer tarif par dimension (oui / non)' },
      { key: 'base_length_m', label: 'Longueur de base (m)' },
      { key: 'base_width_m', label: 'Largeur de base (m)' },
      { key: 'base_height_m', label: 'Épaisseur / hauteur de base (m)' },
    ],
    exampleRow: [exName, exRef, 'article', exUnit, exCat, exSup, exPurchase, exMargin, exSale, '20', dimMode, dimEnabled, exL, exW, exH],
  }
}

function getLaborImportConfig(catalogContext: ResolvedCatalogContext): ImportConfig {
  const p = catalogContext.businessProfile
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
      { key: 'reference', label: 'Référence (optionnel — générée si vide)' },
      { key: 'type', label: 'Type (humain, machine, équipement, sous-traitant)' },
      { key: 'unit', label: unitLabel },
      { key: 'category', label: catLabel },
      { key: 'cost_rate', label: 'Coût interne (€/unité)' },
      { key: 'vat_rate', label: 'TVA (%) — ex : 20, 10, 5.5' },
    ],
    exampleRow: [exName, exRef, exType, exUnit, exCat, exCost, '20'],
  }
}

const initImportState: ImportCatalogState = { error: null, imported: 0, skipped: 0, skipped_reasons: [] }

type ImportModalProps = {
  isOpen: boolean
  onClose: () => void
  title: string
  fields: Array<{ key: string; label: string; required?: boolean }>
  templateFilename: string
  exampleRow: string[]
  serverAction: (prev: ImportCatalogState, fd: FormData) => Promise<ImportCatalogState>
  onSuccess: () => void
}

function ImportModal({ isOpen, onClose, title, fields, templateFilename, serverAction, onSuccess, exampleRow }: ImportModalProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [step, setStep] = React.useState<1 | 2 | 3>(1)
  const [headers, setHeaders] = React.useState<string[]>([])
  const [dataRows, setDataRows] = React.useState<string[][]>([])
  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [isPending, startTransition] = React.useTransition()
  const [result, setResult] = React.useState<ImportCatalogState | null>(null)
  const [parseError, setParseError] = React.useState<string | null>(null)

  function handleClose() {
    setStep(1); setHeaders([]); setDataRows([]); setMapping({}); setResult(null); setParseError(null)
    onClose()
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)
    try {
      const { headers: hdrs, dataRows: rows } = await parseFileToRows(file)
      if (hdrs.length === 0) { setParseError('Fichier vide ou format non reconnu.'); return }
      const autoMap: Record<string, string> = {}
      fields.forEach(({ key, label }) => {
        const idx = hdrs.findIndex(h => {
          const norm = h.toLowerCase().replace(/[^a-z0-9]/g, '')
          return norm.includes(key.replace(/_/g, '')) || norm.includes(label.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 6))
        })
        if (idx !== -1) autoMap[key] = String(idx)
      })
      setHeaders(hdrs); setDataRows(rows); setMapping(autoMap); setStep(2)
    } catch {
      setParseError('Impossible de lire le fichier.')
    }
    e.target.value = ''
  }

  function handleImport() {
    const mapped = dataRows.map(row => {
      const obj: Record<string, string> = {}
      fields.forEach(({ key }) => {
        const colIdx = mapping[key] !== undefined ? parseInt(mapping[key]) : -1
        obj[key] = colIdx >= 0 ? (row[colIdx] ?? '') : ''
      })
      return obj
    })
    const fd = new FormData()
    fd.set('items_json', JSON.stringify(mapped))
    startTransition(async () => {
      const res = await serverAction(initImportState, fd)
      setResult(res)
      if (!res.error) { setStep(3); onSuccess(); setTimeout(handleClose, 2500) }
    })
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] w-full max-w-2xl p-8 relative animate-in fade-in zoom-in duration-300">
        <button onClick={handleClose} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
        <h2 className="text-2xl font-bold text-primary mb-2">{title}</h2>

        {/* Stepper */}
        <div className="flex items-center gap-2 mb-8">
          {[{ n: 1, label: 'Fichier' }, { n: 2, label: 'Mapping' }, { n: 3, label: 'Import' }].map(({ n, label }, i) => (
            <React.Fragment key={n}>
              {i > 0 && <div className={`h-px flex-1 ${step > i ? 'bg-accent' : 'bg-[var(--elevation-border)]'}`} />}
              <div className={`flex items-center gap-1.5 ${step >= n ? 'text-accent' : 'text-secondary'}`}>
                <div className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center border-2 ${step > n ? 'bg-accent border-accent text-black' : step === n ? 'border-accent text-accent' : 'border-[var(--elevation-border)] text-secondary'}`}>
                  {step > n ? '✓' : n}
                </div>
                <span className="text-xs font-semibold hidden sm:inline">{label}</span>
              </div>
            </React.Fragment>
          ))}
        </div>

        {/* Step 1 — Upload */}
        {step === 1 && (
          <div className="space-y-6">
            <p className="text-secondary text-sm">Formats acceptés : <strong>CSV</strong> (séparateurs , ou ;) et <strong>Excel (.xlsx)</strong>.</p>
            {parseError && <p className="text-sm text-red-400">{parseError}</p>}
            <input ref={fileInputRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleFileChange} />
            <button
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-accent', 'bg-accent/5') }}
              onDragLeave={e => { e.currentTarget.classList.remove('border-accent', 'bg-accent/5') }}
              onDrop={e => {
                e.preventDefault()
                e.currentTarget.classList.remove('border-accent', 'bg-accent/5')
                const file = e.dataTransfer.files?.[0]
                if (!file || !fileInputRef.current) return
                const dt = new DataTransfer()
                dt.items.add(file)
                fileInputRef.current.files = dt.files
                fileInputRef.current.dispatchEvent(new Event('change', { bubbles: true }))
              }}
              className="w-full h-40 rounded-2xl border-2 border-dashed border-[var(--elevation-border)] flex flex-col items-center justify-center gap-3 hover:border-accent hover:bg-accent/5 transition-all group"
            >
              <FileUp className="w-10 h-10 text-secondary group-hover:text-accent transition-colors" />
              <span className="font-semibold text-secondary group-hover:text-primary transition-colors">Cliquer ou glisser un fichier ici</span>
            </button>
            <div className="flex items-center justify-between">
              <p className="text-xs text-secondary">Pas encore de modèle ?</p>
              <button
                onClick={() => downloadCSVTemplate(fields, templateFilename, exampleRow)}
                className="flex items-center gap-2 text-sm text-accent font-semibold hover:underline"
              >
                <Download className="w-4 h-4" />
                Télécharger le template CSV
              </button>
            </div>
          </div>
        )}

        {/* Step 2 — Mapping */}
        {step === 2 && (
          <div className="space-y-5">
            <p className="text-secondary text-sm">
              Associez chaque colonne de votre fichier aux champs de l'application.
              <span className="text-accent font-bold"> {dataRows.length} ligne(s) détectée(s)</span>.
            </p>

            {result?.error && (
              <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-xl bg-red-500/10 border border-red-500/25">
                <AlertCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" />
                <p className="text-xs text-red-400">{result.error}</p>
              </div>
            )}

            <div className="max-h-72 overflow-y-auto space-y-3 pr-1">
              {fields.map(({ key, label, required }) => (
                <div key={key} className="flex items-center gap-4">
                  <div className="w-44 flex-shrink-0">
                    <span className="text-sm font-semibold text-primary">{label}</span>
                    {required && <span className="text-accent ml-1 text-xs">*</span>}
                  </div>
                  <select
                    value={mapping[key] ?? ''}
                    onChange={e => setMapping(prev => ({ ...prev, [key]: e.target.value }))}
                    className="flex-1 px-3 py-2 bg-base dark:bg-white/5 border border-transparent focus:border-accent rounded-xl text-primary text-sm outline-none"
                  >
                    <option value="">Ignorer</option>
                    {headers.map((h, i) => (
                      <option key={i} value={String(i)}>Colonne {i + 1} : {h} {dataRows[0]?.[i] ? `(ex: ${dataRows[0][i]})` : ''}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            {/* Aperçu ligne 1 */}
            {dataRows.length > 0 && (
              <div className="p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)]">
                <p className="text-xs text-secondary font-semibold mb-2">Aperçu · 1ère ligne</p>
                <div className="flex flex-wrap gap-2">
                  {fields.filter(f => mapping[f.key] !== undefined && mapping[f.key] !== '').map(({ key, label }) => {
                    const val = dataRows[0]?.[parseInt(mapping[key])] ?? ''
                    return val ? (
                      <span key={key} className="text-xs bg-accent/10 text-accent px-2 py-1 rounded-lg">
                        <span className="opacity-60">{label}:</span> {val}
                      </span>
                    ) : null
                  })}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-4 pt-2">
              <button onClick={() => setStep(1)} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Retour</button>
              <button
                onClick={handleImport}
                disabled={isPending}
                className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 flex items-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
              >
                {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Import...</> : <>Importer {dataRows.length} ligne(s)</>}
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Success */}
        {step === 3 && result && (
          <div className="flex flex-col items-center gap-6 py-6 text-center">
            <CheckCircle2 className="w-16 h-16 text-accent-green" />
            <div>
              <h3 className="text-xl font-bold text-primary mb-1">Import réussi !</h3>
              <p className="text-secondary">
                <span className="font-bold text-primary">{result.imported}</span> élément(s) importé(s)
                {result.skipped > 0 && <>, <span className="font-bold text-secondary">{result.skipped}</span> ignoré(s)</>}.
              </p>
              {result.skipped_reasons && result.skipped_reasons.length > 0 && (
                <ul className="mt-3 text-left space-y-1 max-h-32 overflow-y-auto">
                  {result.skipped_reasons.map((r, i) => (
                    <li key={i} className="text-xs text-amber-500 flex items-start gap-1.5">
                      <span className="shrink-0 mt-0.5">⚠</span>{r}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CatalogClient({ initialMaterials, initialLaborRates, initialPrestationTypes, catalogContext }: Props) {
  const router = useRouter()
  const profileLabels = getCatalogLabelsForProfile(catalogContext)
  const [activeTab, setActiveTab] = useState<'materials' | 'services' | 'labor' | 'prestations'>('materials')
  const [searchTerm, setSearchTerm] = useState('')
  const [isNewMaterialOpen, setIsNewMaterialOpen] = useState(false)
  const [isNewLaborOpen, setIsNewLaborOpen] = useState(false)
  const [isImportMaterialsOpen, setIsImportMaterialsOpen] = useState(false)
  const [isImportLaborOpen, setIsImportLaborOpen] = useState(false)
  const [isNewPrestationOpen, setIsNewPrestationOpen] = useState(false)
  const [editingPrestation, setEditingPrestation] = useState<PrestationType | null>(null)
  const [editingMaterial, setEditingMaterial] = useState<CatalogMaterial | null>(null)

  // Données locales
  const [materials, setMaterials] = useState<CatalogMaterial[]>(initialMaterials)
  const [laborRates, setLaborRates] = useState<CatalogLaborRate[]>(initialLaborRates)
  const [prestationTypes, setPrestationTypes] = useState<PrestationType[]>(initialPrestationTypes)

  // Sync state quand le server component repasse de nouvelles props
  useEffect(() => { setMaterials(initialMaterials) }, [initialMaterials])
  useEffect(() => { setLaborRates(initialLaborRates) }, [initialLaborRates])
  useEffect(() => { setPrestationTypes(initialPrestationTypes) }, [initialPrestationTypes])

  const [isPending, startTransition] = useTransition()

  // Inline edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingField, setEditingField] = useState<string>('')
  const [editingValue, setEditingValue] = useState<string>('')
  const resourceTypeMap = new Map(catalogContext.resourceTypeOptions.map(option => [option.value, option.label]))

  // Confirmation prix de vente
  const [priceConfirm, setPriceConfirm] = useState<{
    isOpen: boolean; id: string; oldPrice: number; newPrice: number; name: string; tab: 'materials'
  }>({ isOpen: false, id: '', oldPrice: 0, newPrice: 0, name: '', tab: 'materials' })

  // ── Catégories ──────────────────────────────────────────────────────────────

  const materialCategories = Array.from(new Set([
    ...catalogContext.defaultCategories.material,
    ...(materials.map(m => m.category).filter(Boolean) as string[]),
  ]))
  const serviceCategories = Array.from(new Set([
    ...catalogContext.defaultCategories.service,
    ...(materials.filter(m => m.item_kind === 'service').map(m => m.category).filter(Boolean) as string[]),
  ]))
  const laborCategories = Array.from(new Set([
    ...catalogContext.defaultCategories.laborRate,
    ...(laborRates.map(l => l.category).filter(Boolean) as string[]),
  ]))

  // ── Filtrage ─────────────────────────────────────────────────────────────────

  const currentData = activeTab === 'materials'
    ? materials.filter(item => item.item_kind !== 'service')
    : activeTab === 'services'
      ? materials.filter(item => item.item_kind === 'service')
      : laborRates
  const filteredData = currentData.filter(item => {
    const name = activeTab === 'materials' || activeTab === 'services'
      ? (item as CatalogMaterial).name
      : (item as CatalogLaborRate).designation
    const ref = activeTab === 'materials' || activeTab === 'services'
      ? (item as CatalogMaterial).reference
      : (item as CatalogLaborRate).reference
    return (
      name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (ref ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    )
  })

  const filteredPrestations = prestationTypes.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.category ?? '').toLowerCase().includes(searchTerm.toLowerCase())
  )

  const prestationCategories = Array.from(new Set([
    ...catalogContext.defaultCategories.bundleTemplate,
    ...(prestationTypes.map(p => p.category).filter(Boolean) as string[]),
  ]))

  // ── Inline edit helpers ───────────────────────────────────────────────────────

  function startEdit(id: string, field: string, value: string) {
    setEditingId(id)
    setEditingField(field)
    setEditingValue(value)
  }

  function cancelEdit() {
    setEditingId(null)
    setEditingField('')
  }

  // Sauvegarde un champ texte ou numérique d'un matériau
  function saveMaterialField(item: CatalogMaterial, field: string, rawValue: string) {
    cancelEdit()
    const trimmed = rawValue.trim()
    if (!trimmed) return

    if (field === 'sale_price') {
      const newPrice = parseFloat(trimmed)
      if (isNaN(newPrice) || newPrice === (item.sale_price ?? 0)) return
      setPriceConfirm({ isOpen: true, id: item.id, oldPrice: item.sale_price ?? 0, newPrice, name: item.name, tab: 'materials' })
      return
    }

    const updates: Record<string, string | number | null> = {}
    if (field === 'name' || field === 'reference' || field === 'category' || field === 'unit' || field === 'supplier') {
      updates[field] = trimmed
    } else {
      const num = parseFloat(trimmed)
      if (isNaN(num)) return
      updates[field] = num
      // recalcul sale_price si purchase_price ou margin_rate change
      if (field === 'purchase_price') {
        updates.sale_price = num * (1 + (item.margin_rate ?? 0) / 100)
      }
      if (field === 'margin_rate') {
        updates.sale_price = (item.purchase_price ?? 0) * (1 + num / 100)
      }
    }

    setMaterials(prev => prev.map(m => m.id === item.id ? { ...m, ...updates } : m))
    startTransition(async () => { await updateMaterial(item.id, updates as Parameters<typeof updateMaterial>[1]) })
  }

  // Sauvegarde un champ d'une ressource interne
  function saveLaborField(item: CatalogLaborRate, field: string, rawValue: string) {
    cancelEdit()
    const trimmed = rawValue.trim()
    if (!trimmed) return

    const updates: Record<string, string | number | null> = {}
    if (field === 'designation' || field === 'reference' || field === 'category' || field === 'unit' || field === 'type') {
      updates[field] = trimmed
    } else {
      const num = parseFloat(trimmed)
      if (isNaN(num)) return
      updates[field] = num
      if (field === 'cost_rate') {
        updates.rate = num
      }
    }

    setLaborRates(prev => prev.map(l => l.id === item.id ? { ...l, ...updates } : l))
    startTransition(async () => { await updateLaborRate(item.id, updates as Parameters<typeof updateLaborRate>[1]) })
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  function handleDeleteMaterial(id: string) {
    if (!confirm(`Archiver cette ${catalogContext.labelSet.material.singular.toLowerCase()} du catalogue ?`)) return
    setMaterials(prev => prev.filter(m => m.id !== id))
    startTransition(async () => { await deleteMaterial(id) })
  }

  function handleMaterialSaved(updated: CatalogMaterial) {
    setMaterials(prev => prev.map(m => m.id === updated.id ? updated : m))
  }

  function handleDuplicateMaterial(item: CatalogMaterial) {
    const formData = new FormData()
    formData.set('name', `${item.name} (copie)`)
    formData.set('item_kind', item.item_kind)
    formData.set('unit', item.unit ?? 'u')
    formData.set('category', item.category ?? '')
    formData.set('supplier', item.supplier ?? '')
    formData.set('purchase_price', String(item.purchase_price ?? ''))
    formData.set('margin_rate', String(item.margin_rate ?? ''))
    formData.set('sale_price', String(item.sale_price ?? ''))
    formData.set('dimension_pricing_mode', item.dimension_pricing_mode ?? 'none')
    formData.set('base_length_m', String(item.base_length_m ?? ''))
    formData.set('base_width_m', String(item.base_width_m ?? ''))
    formData.set('base_height_m', String(item.base_height_m ?? ''))
    startTransition(async () => { await createMaterial({ error: null, success: false }, formData) })
  }

  function handleDeleteLabor(id: string) {
    if (!confirm(`Archiver ce ${catalogContext.labelSet.laborRate.singular.toLowerCase()} du catalogue ?`)) return
    setLaborRates(prev => prev.filter(l => l.id !== id))
    startTransition(async () => { await deleteLaborRate(id) })
  }

  function handleDeletePrestation(id: string) {
    if (!confirm(`Archiver ce ${catalogContext.labelSet.bundleTemplate.singular.toLowerCase()} du catalogue ?`)) return
    setPrestationTypes(prev => prev.filter(p => p.id !== id))
    startTransition(async () => { await deletePrestationType(id) })
  }

  function handleTogglePrestationActive(item: PrestationType) {
    setPrestationTypes(prev => prev.map(p => p.id === item.id ? { ...p, is_active: !p.is_active } : p))
    startTransition(async () => { await updatePrestationType(item.id, { isActive: !item.is_active }) })
  }

  // ── Confirm price update ──────────────────────────────────────────────────────

  function confirmPriceUpdate() {
    const { id, newPrice } = priceConfirm
    setMaterials(prev => prev.map(m => m.id === id ? { ...m, sale_price: newPrice } : m))
    startTransition(async () => { await updateMaterial(id, { sale_price: newPrice }) })
    setPriceConfirm(prev => ({ ...prev, isOpen: false }))
  }

  // ── Render inline edit cell ───────────────────────────────────────────────────

  function InlineText({ id, field, value, onSave, className = '' }: {
    id: string; field: string; value: string | null; onSave: (v: string) => void; className?: string
  }) {
    if (editingId === id && editingField === field) {
      return (
        <input
          type="text"
          value={editingValue}
          autoFocus
          onChange={e => setEditingValue(e.target.value)}
          onBlur={() => onSave(editingValue)}
          onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') cancelEdit() }}
          className={`w-full p-1 bg-base border border-accent rounded-md text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 ${className}`}
        />
      )
    }
    return (
      <p
        onClick={() => startEdit(id, field, value ?? '')}
        className="cursor-pointer hover:text-accent transition-colors px-2 py-1 -ml-2 rounded-md hover:bg-accent/10 inline-block w-full truncate"
      >
        {value || <span className="text-secondary/40 italic">...</span>}
      </p>
    )
  }

  function InlineNumber({ id, field, value, onSave, bold = false }: {
    id: string; field: string; value: number | null; onSave: (v: string) => void; bold?: boolean
  }) {
    if (editingId === id && editingField === field) {
      return (
        <div className="flex justify-end">
          <input
            type="number"
            step="0.01"
            value={editingValue}
            autoFocus
            onChange={e => setEditingValue(e.target.value)}
            onBlur={() => onSave(editingValue)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') cancelEdit() }}
            className="w-24 p-1 text-right bg-base border border-accent rounded-md text-primary font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-accent/50"
          />
        </div>
      )
    }
    return (
      <p
        onClick={() => startEdit(id, field, String(value ?? 0))}
        className={`text-sm tabular-nums cursor-pointer hover:text-accent transition-colors px-2 py-1 -mr-2 rounded-md hover:bg-accent/10 inline-block text-right ${bold ? 'font-bold text-primary' : 'text-secondary'}`}
      >
        {value !== null && value !== undefined ? formatCurrency(value) : '-'}
      </p>
    )
  }

  function InlinePercent({ id, field, value, onSave }: {
    id: string; field: string; value: number | null; onSave: (v: string) => void
  }) {
    if (editingId === id && editingField === field) {
      return (
        <div className="flex justify-end">
          <input
            type="number"
            value={editingValue}
            autoFocus
            onChange={e => setEditingValue(e.target.value)}
            onBlur={() => onSave(editingValue)}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') cancelEdit() }}
            className="w-16 p-1 text-right bg-base border border-accent rounded-md text-primary font-bold tabular-nums focus:outline-none"
          />
        </div>
      )
    }
    return (
      <span
        onClick={() => startEdit(id, field, String(value ?? 0))}
        className="px-2 py-1 rounded-md bg-base/50 text-xs font-bold text-secondary tabular-nums border border-[var(--elevation-border)] cursor-pointer hover:border-accent hover:text-accent transition-colors inline-block"
      >
        {value ?? 0}%
      </span>
    )
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">

      {/* Modales création */}
      <NewMaterialModal isOpen={isNewMaterialOpen} onClose={() => setIsNewMaterialOpen(false)} categories={activeTab === 'services' ? serviceCategories : materialCategories} defaultKind={activeTab === 'services' ? 'service' : 'article'} catalogContext={catalogContext} />
      <NewLaborRateModal isOpen={isNewLaborOpen} onClose={() => setIsNewLaborOpen(false)} categories={laborCategories} catalogContext={catalogContext} />

      {/* Modal édition matériau */}
      {editingMaterial && (
        <EditMaterialModal
          material={editingMaterial}
          categories={editingMaterial.item_kind === 'service' ? serviceCategories : materialCategories}
          catalogContext={catalogContext}
          onClose={() => setEditingMaterial(null)}
          onSaved={handleMaterialSaved}
        />
      )}
      <NewPrestationModal
        isOpen={isNewPrestationOpen || editingPrestation !== null}
        onClose={() => { setIsNewPrestationOpen(false); setEditingPrestation(null) }}
        editing={editingPrestation}
        categories={prestationCategories}
        materials={materials}
        laborRates={laborRates}
        catalogContext={catalogContext}
        onSaved={() => router.refresh()}
      />

      {/* Modales import */}
      <ImportModal
        isOpen={isImportMaterialsOpen}
        onClose={() => setIsImportMaterialsOpen(false)}
        title={activeTab === 'services' ? `Importer ${catalogContext.labelSet.service.plural.toLowerCase()}` : `Importer ${catalogContext.labelSet.material.plural.toLowerCase()}`}
        fields={getMaterialImportConfig(catalogContext).fields}
        exampleRow={getMaterialImportConfig(catalogContext).exampleRow}
        templateFilename={getMaterialImportConfig(catalogContext).filename}
        serverAction={importMaterials}
        onSuccess={() => router.refresh()}
      />
      <ImportModal
        isOpen={isImportLaborOpen}
        onClose={() => setIsImportLaborOpen(false)}
        title={`Importer ${catalogContext.labelSet.laborRate.plural.toLowerCase()}`}
        fields={getLaborImportConfig(catalogContext).fields}
        exampleRow={getLaborImportConfig(catalogContext).exampleRow}
        templateFilename={getLaborImportConfig(catalogContext).filename}
        serverAction={importLaborRates}
        onSuccess={() => router.refresh()}
      />

      {/* Confirmation mise à jour prix de vente */}
      {priceConfirm.isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] w-full max-w-md p-8 relative animate-in fade-in zoom-in duration-300">
            <AlertCircle className="w-6 h-6 text-accent mb-6" />
            <h2 className="text-2xl font-bold text-primary mb-2">Mise à jour du prix</h2>
            <p className="text-secondary mb-6">
              Vous modifiez le prix de vente de{' '}
              <span className="font-bold text-primary">{priceConfirm.name}</span> :{' '}
              <span className="font-bold text-primary tabular-nums">{formatCurrency(priceConfirm.oldPrice)}</span> →{' '}
              <span className="font-bold text-accent tabular-nums">{formatCurrency(priceConfirm.newPrice)}</span>.
            </p>
            <div className="bg-base/50 border border-[var(--elevation-border)] rounded-xl p-4 mb-6">
              <label className="flex items-start gap-3 cursor-pointer">
                <input type="checkbox" defaultChecked className="mt-1 w-4 h-4 rounded border-gray-300 text-accent focus:ring-accent" />
                <span className="text-sm text-primary font-medium">
                  Mettre à jour automatiquement les devis et factures <strong>en brouillon</strong> contenant cet article.
                </span>
              </label>
            </div>
            <div className="flex justify-end gap-4">
              <button onClick={() => setPriceConfirm(prev => ({ ...prev, isOpen: false }))} className="px-6 py-3 rounded-full text-secondary hover:text-primary font-semibold transition-colors">Annuler</button>
              <button onClick={confirmPriceUpdate} className="px-8 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold text-primary">{catalogContext.labelSet.catalogTitle}</h1>
          <p className="text-secondary text-lg">{catalogContext.labelSet.catalogSubtitle} Cliquez sur une cellule pour modifier.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Search className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-secondary" />
            <input
              type="text"
              placeholder="Rechercher..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full md:w-72 pl-12 pr-4 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all"
            />
          </div>
          {activeTab !== 'prestations' && (
            <button
              onClick={() => activeTab === 'labor' ? setIsImportLaborOpen(true) : setIsImportMaterialsOpen(true)}
              className="px-6 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-bold flex items-center gap-2 hover:scale-105 transition-all whitespace-nowrap"
            >
              <FileUp className="w-4 h-4" />
              Importer
            </button>
          )}
          <button
            onClick={() => {
              if (activeTab === 'materials' || activeTab === 'services') setIsNewMaterialOpen(true)
              else if (activeTab === 'labor') setIsNewLaborOpen(true)
              else setIsNewPrestationOpen(true)
            }}
            className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            {activeTab === 'materials'
              ? catalogContext.labelSet.material.createLabel
              : activeTab === 'services'
                ? catalogContext.labelSet.service.createLabel
                : activeTab === 'labor'
                  ? catalogContext.labelSet.laborRate.createLabel
                  : catalogContext.labelSet.bundleTemplate.createLabel}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-base/50 rounded-full w-fit border border-[var(--elevation-border)]">
        <button onClick={() => setActiveTab('materials')} className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'materials' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
          {catalogContext.labelSet.material.plural}
        </button>
        <button onClick={() => setActiveTab('services')} className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'services' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
          {catalogContext.labelSet.service.plural}
        </button>
        <button onClick={() => setActiveTab('labor')} className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'labor' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
          {catalogContext.labelSet.laborRate.plural}
        </button>
        <button onClick={() => setActiveTab('prestations')} className={`px-8 py-2 rounded-full text-sm font-bold transition-all flex items-center gap-2 ${activeTab === 'prestations' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>
          <Layers className="w-3.5 h-3.5" />
          {catalogContext.labelSet.bundleTemplate.plural}
        </button>
      </div>

      {/* Table — Articles / Main d'oeuvre */}
      {activeTab !== 'prestations' && (
        <div className={`rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] overflow-hidden transition-opacity ${isPending ? 'opacity-80' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-base/30 border-b border-[var(--elevation-border)]">
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Référence</th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">
                    {activeTab === 'materials' ? catalogContext.labelSet.material.singular : activeTab === 'services' ? catalogContext.labelSet.service.singular : catalogContext.labelSet.laborRate.singular}
                  </th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Catégorie</th>
                  {activeTab === 'labor' && (
                    <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Type</th>
                  )}
                  {activeTab === 'labor' && (
                    <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Unité</th>
                  )}
                  {(activeTab === 'materials' || activeTab === 'services') && (
                    <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Tarif dim.</th>
                  )}
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">
                    {activeTab === 'materials' || activeTab === 'services' ? "Coût HT" : profileLabels.resourceCostLabel}
                  </th>
                  {(activeTab === 'materials' || activeTab === 'services') && (
                    <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">Marge (%)</th>
                  )}
                  {(activeTab === 'materials' || activeTab === 'services') && (
                    <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">Prix de vente HT</th>
                  )}
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {filteredData.length > 0 ? (
                  activeTab === 'materials' || activeTab === 'services'
                    ? (filteredData as CatalogMaterial[]).map(item => (
                      <tr key={item.id} className="hover:bg-accent/5 transition-colors group">
                        <td className="px-6 py-4 min-w-[120px]">
                          <InlineText id={item.id} field="reference" value={item.reference} onSave={v => saveMaterialField(item, 'reference', v)} className="text-sm font-bold text-primary tabular-nums" />
                        </td>
                        <td className="px-6 py-4 min-w-[250px]">
                          <InlineText id={item.id} field="name" value={item.name} onSave={v => saveMaterialField(item, 'name', v)} />
                        </td>
                        <td className="px-6 py-4">
                          <div onClick={() => startEdit(item.id, 'category', item.category ?? '')} className="cursor-pointer hover:opacity-80 transition-opacity w-fit">
                            {editingId === item.id && editingField === 'category' ? (
                              <input
                                type="text"
                                value={editingValue}
                                autoFocus
                                onChange={e => setEditingValue(e.target.value)}
                                onBlur={() => saveMaterialField(item, 'category', editingValue)}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') cancelEdit() }}
                                className="w-28 p-1 bg-base border border-accent rounded-md text-primary text-xs uppercase tracking-wider focus:outline-none"
                              />
                            ) : getCategoryBadge(item.category)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          {item.dimension_pricing_mode && item.dimension_pricing_mode !== 'none'
                            ? <span className="px-2 py-1 rounded-lg bg-accent/10 text-accent text-xs font-bold">{formatDimensionLabel(item)}</span>
                            : <span className="text-xs text-secondary">Standard</span>}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <InlineNumber id={item.id} field="purchase_price" value={item.purchase_price} onSave={v => saveMaterialField(item, 'purchase_price', v)} />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <InlinePercent id={item.id} field="margin_rate" value={item.margin_rate} onSave={v => saveMaterialField(item, 'margin_rate', v)} />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <InlineNumber id={item.id} field="sale_price" value={item.sale_price} onSave={v => saveMaterialField(item, 'sale_price', v)} bold />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ActionMenu actions={[
                              { label: 'Modifier', icon: <Pencil className="w-4 h-4" />, onClick: () => setEditingMaterial(item) },
                              { label: 'Dupliquer', icon: <Copy className="w-4 h-4" />, onClick: () => handleDuplicateMaterial(item) },
                              { label: 'Archiver', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDeleteMaterial(item.id) },
                            ]} />
                          </div>
                        </td>
                      </tr>
                    ))
                    : (filteredData as CatalogLaborRate[]).map(item => (
                      <tr key={item.id} className="hover:bg-accent/5 transition-colors group">
                        <td className="px-6 py-4 min-w-[120px]">
                          <InlineText id={item.id} field="reference" value={item.reference} onSave={v => saveLaborField(item, 'reference', v)} className="text-sm font-bold text-primary tabular-nums" />
                        </td>
                        <td className="px-6 py-4 min-w-[250px]">
                          <div className="flex flex-col gap-0.5">
                            <InlineText id={item.id} field="designation" value={item.designation} onSave={v => saveLaborField(item, 'designation', v)} />
                            {item.category && <span className="text-xs text-secondary/60 px-2">{item.category}</span>}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <div onClick={() => startEdit(item.id, 'category', item.category ?? '')} className="cursor-pointer hover:opacity-80 transition-opacity w-fit">
                            {editingId === item.id && editingField === 'category' ? (
                              <input
                                type="text"
                                value={editingValue}
                                autoFocus
                                onChange={e => setEditingValue(e.target.value)}
                                onBlur={() => saveLaborField(item, 'category', editingValue)}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') cancelEdit() }}
                                className="w-28 p-1 bg-base border border-accent rounded-md text-primary text-xs uppercase tracking-wider focus:outline-none"
                              />
                            ) : getCategoryBadge(item.category)}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 rounded-lg bg-base/50 text-xs font-bold text-secondary border border-[var(--elevation-border)]">
                            {resourceTypeMap.get(item.type ?? 'human') ?? catalogContext.laborRateUi.typeHumanLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <UnitSelect
                            value={item.unit ?? 'h'}
                            onChange={v => saveLaborField(item, 'unit', v)}
                            allowedUnits={catalogContext.unitSet}
                            compact
                          />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <InlineNumber id={item.id} field="cost_rate" value={item.cost_rate} onSave={v => saveLaborField(item, 'cost_rate', v)} />
                        </td>
                        <td className="px-6 py-4 text-right">
                          <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                            <ActionMenu actions={[
                              { label: 'Supprimer', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDeleteLabor(item.id) },
                            ]} />
                          </div>
                        </td>
                      </tr>
                    ))
                ) : (
                  <tr>
                    <td colSpan={activeTab === 'labor' ? 7 : 8} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <Package className="w-10 h-10 text-secondary opacity-20" />
                        <div>
                          <p className="text-xl font-bold text-primary">
                            {searchTerm ? 'Aucun élément trouvé' : activeTab === 'materials' ? catalogContext.labelSet.material.emptyLabel : activeTab === 'services' ? catalogContext.labelSet.service.emptyLabel : catalogContext.labelSet.laborRate.emptyLabel}
                          </p>
                          <p className="text-secondary mt-1">
                            {searchTerm ? 'Essayez de modifier vos critères.' : activeTab === 'materials' ? catalogContext.labelSet.material.emptyHelp : activeTab === 'services' ? catalogContext.labelSet.service.emptyHelp : catalogContext.labelSet.laborRate.emptyHelp}
                          </p>
                        </div>
                        {!searchTerm && (
                          <button onClick={() => activeTab === 'labor' ? setIsNewLaborOpen(true) : setIsNewMaterialOpen(true)} className="mt-2 px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20">
                            <Plus className="w-4 h-4" />{activeTab === 'materials' ? catalogContext.labelSet.material.createLabel : activeTab === 'services' ? catalogContext.labelSet.service.createLabel : catalogContext.labelSet.laborRate.createLabel}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Table — Prestations types */}
      {activeTab === 'prestations' && (
        <div className={`rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] overflow-hidden transition-opacity ${isPending ? 'opacity-80' : ''}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-base/30 border-b border-[var(--elevation-border)]">
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Nom</th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">{profileLabels.templateColumns.usage}</th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">{profileLabels.templateColumns.composition}</th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">{profileLabels.templateColumns.clientPrice}</th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">{profileLabels.templateColumns.internalCost}</th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">{profileLabels.templateColumns.margin}</th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">{profileLabels.templateColumns.active}</th>
                  <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {filteredPrestations.length > 0 ? filteredPrestations.map(item => (
                  <tr key={item.id} className="hover:bg-accent/5 transition-colors group">
                    <td className="px-6 py-4 min-w-[200px]">
                      <p className="font-semibold text-primary">{item.name}</p>
                      {item.description && <p className="text-xs text-secondary mt-0.5 truncate max-w-[280px]">{item.description}</p>}
                    </td>
                    <td className="px-6 py-4">{getCategoryBadge(item.category)}</td>
                    <td className="px-6 py-4">
                      <span className="text-sm text-secondary">
                        {item.items?.length ?? 0} ligne{(item.items?.length ?? 0) > 1 ? 's' : ''}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm font-bold text-primary tabular-nums">{formatCurrency(item.base_price_ht)}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="text-sm text-secondary tabular-nums">{formatCurrency(item.base_cost_ht)}</span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="px-2 py-1 rounded-md bg-base/50 text-xs font-bold text-secondary tabular-nums border border-[var(--elevation-border)]">
                        {item.base_margin_pct ?? 0} %
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => handleTogglePrestationActive(item)} className="transition-colors">
                        {item.is_active
                          ? <ToggleRight className="w-6 h-6 text-accent" />
                          : <ToggleLeft className="w-6 h-6 text-secondary" />}
                      </button>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                        <ActionMenu actions={[
                          { label: 'Modifier', icon: <Pencil className="w-4 h-4" />, onClick: () => setEditingPrestation(item) },
                          { label: 'Supprimer', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDeletePrestation(item.id) },
                        ]} />
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={8} className="px-6 py-20 text-center">
                      <div className="flex flex-col items-center gap-4">
                        <Layers className="w-10 h-10 text-secondary opacity-20" />
                        <div>
                          <p className="text-xl font-bold text-primary">
                            {searchTerm ? `Aucun ${catalogContext.labelSet.bundleTemplate.singular.toLowerCase()} trouvé` : catalogContext.labelSet.bundleTemplate.emptyLabel}
                          </p>
                          <p className="text-secondary mt-1">
                            {searchTerm ? 'Essayez de modifier vos critères.' : catalogContext.labelSet.bundleTemplate.emptyHelp}
                          </p>
                        </div>
                        {!searchTerm && (
                          <button onClick={() => setIsNewPrestationOpen(true)} className="mt-2 px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20">
                            <Plus className="w-4 h-4" />{catalogContext.labelSet.bundleTemplate.createLabel}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </main>
  )
}
