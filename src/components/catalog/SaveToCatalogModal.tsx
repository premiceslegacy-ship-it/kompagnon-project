'use client'

import React, { useState } from 'react'
import { BookmarkPlus, Loader2, X, Package, Wrench, Users, ChevronLeft } from 'lucide-react'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { createMaterialQuick, createLaborRateQuick } from '@/lib/data/mutations/catalog'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

// ─── Types ────────────────────────────────────────────────────────────────────

export type SaveToCatalogSource = {
  description: string
  unit: string
  unit_price: number
  vat_rate: number
  // dimensions optionnelles
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dimension_pricing_mode?: 'none' | 'linear' | 'area' | 'volume' | null
  // hints pour pré-sélectionner le type
  hint?: 'material' | 'service' | 'labor' | 'equipment'
}

export type SaveToCatalogResult =
  | { kind: 'material'; id: string }
  | { kind: 'labor'; id: string }

type CatalogEntryKind = 'material' | 'service' | 'labor' | 'equipment'

type LaborSubtype = 'human' | 'machine' | 'equipment' | 'subcontractor' | 'other'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveDimMode(src: SaveToCatalogSource): 'none' | 'linear' | 'area' | 'volume' {
  const m = src.dimension_pricing_mode
  if (m === 'linear' || m === 'area' || m === 'volume') return m
  return 'none'
}

// ─── Étape 1 — Sélection du type d'entrée catalogue ──────────────────────────

type KindOption = {
  value: CatalogEntryKind
  icon: React.ReactNode
  label: string
  sublabel: string
}

function StepKind({
  options,
  selected,
  onSelect,
}: {
  options: KindOption[]
  selected: CatalogEntryKind | null
  onSelect: (k: CatalogEntryKind) => void
}) {
  return (
    <div className="space-y-2">
      {options.map(opt => (
        <button
          key={opt.value}
          onClick={() => onSelect(opt.value)}
          className={`w-full flex items-center gap-4 p-3.5 rounded-xl border transition-all text-left ${
            selected === opt.value
              ? 'border-accent bg-accent/5 ring-1 ring-accent/30'
              : 'border-[var(--elevation-border)] hover:border-accent/40 hover:bg-base/60'
          }`}
        >
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${selected === opt.value ? 'bg-accent/15 text-accent' : 'bg-base/70 text-secondary'}`}>
            {opt.icon}
          </div>
          <div>
            <p className="text-sm font-semibold text-primary">{opt.label}</p>
            <p className="text-xs text-secondary mt-0.5">{opt.sublabel}</p>
          </div>
        </button>
      ))}
    </div>
  )
}

// ─── Étape 2 — Formulaire selon le type ──────────────────────────────────────

function CategoryInput({
  value,
  onChange,
  suggestions,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
  placeholder: string
}) {
  const [open, setOpen] = useState(false)
  const filtered = suggestions.filter(s => s.toLowerCase().includes(value.toLowerCase()) && s !== value)

  return (
    <div className="relative">
      <input
        type="text"
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder={placeholder}
        className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
      />
      {open && filtered.length > 0 && (
        <div className="absolute z-50 left-0 right-0 mt-1 rounded-xl border border-[var(--elevation-border)] bg-surface dark:bg-[#1a1a1a] shadow-xl overflow-y-auto max-h-48">
          {filtered.map(s => (
            <button
              key={s}
              onMouseDown={() => { onChange(s); setOpen(false) }}
              className="w-full text-left px-3 py-2.5 text-sm text-primary hover:bg-accent/10 transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function SaveToCatalogModal({
  source,
  catalogContext,
  existingCategories,
  onClose,
  onSaved,
}: {
  source: SaveToCatalogSource
  catalogContext: ResolvedCatalogContext
  existingCategories?: { material: string[]; service: string[]; labor: string[] }
  onClose: () => void
  onSaved: (result: SaveToCatalogResult) => void
}) {
  const labels = catalogContext.labelSet
  const dc = catalogContext.defaultCategories

  // ── Options de type selon profil ──────────────────────────────────────────
  const kindOptions: KindOption[] = [
    {
      value: 'material',
      icon: <Package className="w-4 h-4" />,
      label: labels.material.singular,
      sublabel: `Produit ou fourniture avec prix de vente et coût d'achat`,
    },
    {
      value: 'service',
      icon: <Wrench className="w-4 h-4" />,
      label: labels.service.singular,
      sublabel: `Prestation ou opération facturée à l'unité ou au forfait`,
    },
    {
      value: 'labor',
      icon: <Users className="w-4 h-4" />,
      label: labels.laborRate.singular,
      sublabel: `Ressource interne : main-d'oeuvre, machine ou équipement amorti`,
    },
  ]

  // ── State ─────────────────────────────────────────────────────────────────
  const initialKind: CatalogEntryKind | null =
    source.hint === 'material' ? 'material'
    : source.hint === 'service' ? 'service'
    : source.hint === 'labor' ? 'labor'
    : source.hint === 'equipment' ? 'equipment'
    : null

  const [step, setStep] = useState<1 | 2>(initialKind ? 2 : 1)
  const [kind, setKind] = useState<CatalogEntryKind | null>(initialKind)

  // Champs communs
  const [name, setName] = useState(source.description.split('\n')[0].trim())
  const [category, setCategory] = useState('')

  // Champs matière / service
  const [salePrice, setSalePrice] = useState(source.unit_price)
  const [purchasePrice, setPurchasePrice] = useState<string>('')
  const [vatRate, setVatRate] = useState(source.vat_rate ?? 20)

  // Champs ressource interne
  const [laborSubtype, setLaborSubtype] = useState<LaborSubtype>('human')
  const [laborRate, setLaborRate] = useState(source.unit_price)
  const [laborCost, setLaborCost] = useState<string>('')
  const [equipPurchase, setEquipPurchase] = useState<string>('')
  const [equipUses, setEquipUses] = useState<string>('100')

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dimMode = deriveDimMode(source)
  const isEquipment = laborSubtype === 'equipment'

  // Suggestions de catégories selon le type
  const categorySuggestions: string[] = Array.from(new Set([
    ...(kind === 'material' ? dc.material : kind === 'service' ? dc.service : dc.laborRate),
    ...(kind === 'material' ? (existingCategories?.material ?? [])
      : kind === 'service' ? (existingCategories?.service ?? [])
      : (existingCategories?.labor ?? [])),
  ]))

  // Labels ressource interne
  const rui = catalogContext.laborRateUi

  function selectKind(k: CatalogEntryKind) {
    setKind(k)
    if (k === 'equipment') setLaborSubtype('equipment')
    setStep(2)
  }

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!kind || !name.trim()) return
    setPending(true)
    setError(null)
    try {
      if (kind === 'material' || kind === 'service') {
        const res = await createMaterialQuick({
          name: name.trim(),
          item_kind: kind === 'service' ? 'service' : 'article',
          unit: source.unit || null,
          sale_price: salePrice,
          purchase_price: purchasePrice !== '' ? parseFloat(purchasePrice) : null,
          vat_rate: vatRate,
          dimension_pricing_mode: dimMode,
          base_length_m: source.length_m ?? null,
          base_width_m: source.width_m ?? null,
          base_height_m: source.height_m ?? null,
          category: category.trim() || null,
        })
        if (res.error || !res.material) { setError(res.error ?? 'Erreur'); return }
        onSaved({ kind: 'material', id: res.material.id })
      } else {
        // labor ou equipment
        const rateVal = laborRate
        const costVal = laborCost !== '' ? parseFloat(laborCost) : rateVal
        const purchaseVal = equipPurchase !== '' ? parseFloat(equipPurchase) : null
        const usesVal = equipUses !== '' ? parseInt(equipUses, 10) : null
        const res = await createLaborRateQuick({
          designation: name.trim(),
          rate: rateVal,
          cost_rate: costVal,
          unit: source.unit || 'h',
          type: laborSubtype,
          category: category.trim() || null,
          purchase_price: isEquipment ? purchaseVal : null,
          lifetime_uses: isEquipment ? usesVal : null,
        })
        if (res.error || !res.laborRate) { setError(res.error ?? 'Erreur'); return }
        onSaved({ kind: 'labor', id: res.laborRate.id })
      }
    } finally {
      setPending(false)
    }
  }

  const canSave = !!kind && name.trim().length > 0

  return (
    <div className="modal-overlay z-[300]">
      <div className="modal-panel space-y-5 sm:max-w-md">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {step === 2 && !initialKind && (
              <button onClick={() => setStep(1)} className="text-secondary hover:text-primary transition-colors mr-1">
                <ChevronLeft className="w-5 h-5" />
              </button>
            )}
            <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
              <BookmarkPlus className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-primary leading-tight">Enregistrer dans le catalogue</h3>
              {step === 2 && kind && (
                <p className="text-xs text-secondary mt-0.5">
                  {kind === 'material' ? labels.material.singular
                   : kind === 'service' ? labels.service.singular
                   : labels.laborRate.singular}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Étape 1 — Choix du type */}
        {step === 1 && (
          <div className="space-y-3">
            <p className="text-sm text-secondary">Quel type d&apos;élément voulez-vous créer dans le catalogue ?</p>
            <StepKind options={kindOptions} selected={kind} onSelect={selectKind} />
          </div>
        )}

        {/* Étape 2 — Formulaire */}
        {step === 2 && kind && (
          <div className="space-y-4">

            {/* Résumé ligne source */}
            <div className="p-3 rounded-xl bg-base/40 border border-[var(--elevation-border)] space-y-1 text-sm">
              <div className="flex justify-between text-secondary">
                <span>Prix unitaire ligne</span>
                <span className="font-semibold text-primary tabular-nums">{fmt(source.unit_price)} / {source.unit || 'u'}</span>
              </div>
              {dimMode !== 'none' && (
                <div className="flex justify-between text-secondary">
                  <span>Mode tarifaire</span>
                  <span className="font-semibold text-accent capitalize">{dimMode}</span>
                </div>
              )}
            </div>

            {/* Désignation */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Désignation catalogue</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Nom dans le catalogue..."
                className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>

            {/* Catégorie avec suggestions */}
            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Catégorie <span className="font-normal text-secondary/70">(optionnel)</span></label>
              <CategoryInput
                value={category}
                onChange={setCategory}
                suggestions={categorySuggestions}
                placeholder={`ex: ${categorySuggestions[0] ?? 'Catégorie...'}`}
              />
            </div>

            {/* Champs matière / service */}
            {(kind === 'material' || kind === 'service') && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-secondary">Prix vente HT</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={salePrice}
                      onChange={e => setSalePrice(parseFloat(e.target.value) || 0)}
                      className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  {kind === 'material' && (
                    <div className="space-y-1.5">
                      <label className="text-sm font-semibold text-secondary">Prix achat HT <span className="font-normal text-secondary/70">(optionnel)</span></label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={purchasePrice}
                        onChange={e => setPurchasePrice(e.target.value)}
                        placeholder="0.00"
                        className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                      />
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">TVA (%)</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={vatRate}
                    onChange={e => setVatRate(parseFloat(e.target.value) || 0)}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                  />
                </div>
              </>
            )}

            {/* Champs ressource interne */}
            {(kind === 'labor' || kind === 'equipment') && (
              <>
                {/* Type de ressource */}
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Type de ressource</label>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: 'human', label: rui.typeHumanLabel },
                      { value: 'machine', label: rui.typeMachineLabel },
                      { value: 'equipment', label: rui.typeEquipmentLabel },
                      { value: 'subcontractor', label: rui.typeSubcontractorLabel },
                      { value: 'other', label: rui.typeOtherLabel },
                    ] as { value: LaborSubtype; label: string }[]).map(opt => (
                      <button
                        key={opt.value}
                        onClick={() => setLaborSubtype(opt.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                          laborSubtype === opt.value
                            ? 'bg-accent text-black border-accent'
                            : 'border-[var(--elevation-border)] text-secondary hover:text-primary'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Taux / coût */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-secondary">{rui.rateLabel}</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={laborRate}
                      onChange={e => setLaborRate(parseFloat(e.target.value) || 0)}
                      className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-semibold text-secondary">{rui.costLabel} <span className="font-normal text-secondary/70">(optionnel)</span></label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={laborCost}
                      onChange={e => setLaborCost(e.target.value)}
                      placeholder={String(laborRate)}
                      className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                    />
                  </div>
                </div>

                {/* Amortissement équipement */}
                {isEquipment && (
                  <div className="space-y-2 p-3 rounded-xl bg-base/40 border border-[var(--elevation-border)]">
                    <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Amortissement</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs text-secondary">Prix d&apos;achat (€)</label>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={equipPurchase}
                          onChange={e => setEquipPurchase(e.target.value)}
                          placeholder="ex: 1500"
                          className="w-full p-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs text-secondary">Nb. d&apos;usages</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={equipUses}
                          onChange={e => setEquipUses(e.target.value)}
                          placeholder="ex: 100"
                          className="w-full p-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                        />
                      </div>
                    </div>
                    {equipPurchase && equipUses && parseFloat(equipPurchase) > 0 && parseInt(equipUses) > 0 && (
                      <p className="text-xs text-accent font-semibold">
                        Coût / usage : {fmt(parseFloat(equipPurchase) / parseInt(equipUses))}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {error && <p className="text-xs text-red-500">{error}</p>}

            {/* Actions */}
            <div className="flex gap-3 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={pending || !canSave}
                className="flex-1 py-2.5 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-40 disabled:hover:scale-100 flex items-center justify-center gap-2"
              >
                {pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <BookmarkPlus className="w-4 h-4" />}
                Enregistrer
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
