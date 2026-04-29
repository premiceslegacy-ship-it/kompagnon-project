'use client'

import React, { useState, useTransition, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { submitQuoteRequest } from '@/lib/data/mutations/quote-requests'
import {
  buildMaterialSelectionPricing,
  displayUnitToMeters,
  formatPublicUnit,
  getDimensionFieldDefinition,
  metersToDisplayUnit,
  type DimensionPricingMode,
} from '@/lib/catalog-pricing'
import {
  CheckCircle2, Loader2, ChevronLeft, ChevronRight,
  User, Layers, MapPin, ClipboardList, Package,
  Plus, Minus, X, Paperclip, ChevronDown, ChevronUp,
  Building2, Search, Wrench,
} from 'lucide-react'
import type { PublicLaborRate, PublicMaterial, PublicPrestationType, PublicPrestationLine } from './page'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'

// ─── Types ────────────────────────────────────────────────────────────────────

type Props = {
  orgSlug: string
  orgName: string
  logoUrl: string | null
  welcomeMessage: string | null
  materials: PublicMaterial[]
  laborRates: PublicLaborRate[]
  prestationTypes: PublicPrestationType[]
  customModeEnabled: boolean
  catalogContext: ResolvedCatalogContext
}

type SelectedMaterial = {
  id: string
  name: string
  item_kind: 'article' | 'service'
  unit: string | null
  quantity: number
  base_length_m: number | null
  base_width_m: number | null
  base_height_m: number | null
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dimension_pricing_mode: DimensionPricingMode
  dimension_pricing_enabled?: boolean
  dimension_schema?: PublicMaterial['dimension_schema']
  price_variants?: PublicMaterial['price_variants']
  details?: string
}

type PrestationLine = {
  id: string
  item_type: 'material' | 'service' | 'labor' | 'transport' | 'free'
  material_id: string | null
  labor_rate_id: string | null
  designation: string
  quantity: number
  unit: string
  unit_price_ht: number
  dimension_pricing_mode: DimensionPricingMode
  dimension_pricing_enabled: boolean
  base_length_m: number | null
  base_width_m: number | null
  base_height_m: number | null
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  isCustom: boolean
  dimension_schema?: PublicPrestationLine['dimension_schema']
  price_variants?: PublicPrestationLine['price_variants']
  details?: string
}

type SelectedPrestation = {
  id: string
  name: string
  category: string | null
  lines: PrestationLine[]
}

type SelectedLaborRate = {
  id: string
  designation: string
  unit: string | null
  quantity: number
  details?: string
}

type AttachmentMeta = {
  storage_path: string
  filename: string
  size: number
  content_type: string | null
  public_url: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/

const BLOCKED_EMAIL_DOMAINS = new Set([
  'yopmail.com', 'yopmail.fr', 'cool.fr.nf', 'jetable.fr.nf', 'nospam.ze.tc',
  'mailinator.com', 'guerrillamail.com', 'guerrillamail.info', 'guerrillamail.biz',
  'tempmail.com', 'temp-mail.org', 'trashmail.com', 'trashmail.me',
  'throwaway.email', 'sharklasers.com', 'fakeinbox.com', 'maildrop.cc',
  'getnada.com', 'mailnesia.com', 'dispostable.com', 'filzmail.com',
])

const inputCls = 'w-full px-4 py-3 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-gray-900 placeholder:text-gray-400 text-sm transition-all'

function getDimensionMode(
  mode: DimensionPricingMode | null | undefined,
  enabled?: boolean | null,
): DimensionPricingMode {
  if (mode && mode !== 'none') return mode
  return enabled ? 'area' : 'none'
}

function buildDimensionSelection(params: {
  priceVariants?: PublicMaterial['price_variants'] | PublicPrestationLine['price_variants']
  mode: DimensionPricingMode
  fallbackUnit: string | null
  baseLengthM: number | null
  baseWidthM: number | null
  baseHeightM: number | null
  lengthM?: number | null
  widthM?: number | null
  heightM?: number | null
}) {
  const pricing = buildMaterialSelectionPricing({
    item: {
      sale_price: 0,
      purchase_price: 0,
      unit: params.fallbackUnit,
      dimension_pricing_mode: params.mode,
      base_length_m: params.baseLengthM,
      base_width_m: params.baseWidthM,
      base_height_m: params.baseHeightM,
      price_variants: (params.priceVariants as any) ?? [],
    },
    requestedLengthM: params.lengthM ?? null,
    requestedWidthM: params.widthM ?? null,
    requestedHeightM: params.heightM ?? null,
  })

  return {
    quantity: pricing.quantity,
    unit: pricing.unit,
    length_m: pricing.lengthM,
    width_m: pricing.widthM,
    height_m: pricing.heightM,
  }
}

function formatDimensionSummary(
  mode: DimensionPricingMode,
  lengthM: number | null | undefined,
  widthM: number | null | undefined,
  heightM: number | null | undefined,
): string {
  switch (mode) {
    case 'linear':
      return `${lengthM ?? 0} m`
    case 'area':
      return `${lengthM ?? 0} m × ${widthM ?? 0} m`
    case 'volume':
      return `${lengthM ?? 0} m × ${widthM ?? 0} m × ${heightM ?? 0} m`
    default:
      return ''
  }
}

function getDimensionFieldMeta(
  schema: PublicMaterial['dimension_schema'] | PublicPrestationLine['dimension_schema'] | null | undefined,
  axis: 'length' | 'width' | 'height',
  mode: DimensionPricingMode,
) {
  return getDimensionFieldDefinition(schema, axis, mode)
}

function groupByCategory<T extends { category: string | null }>(items: T[]): Array<{ label: string; items: T[] }> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = item.category?.trim() || 'Autres'
    if (!map.has(key)) map.set(key, [])
    map.get(key)!.push(item)
  }
  return Array.from(map.entries()).map(([label, items]) => ({ label, items }))
}

// ─── Barre de progression ─────────────────────────────────────────────────────

const STEP_ICONS = [User, Layers, MapPin, ClipboardList]
const STEP_LABELS = ['Vous', 'Votre projet', 'Le chantier', 'Récapitulatif']

function ProgressBar({ step }: { step: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-8">
      {STEP_LABELS.map((label, i) => {
        const Icon = STEP_ICONS[i]
        const idx = i + 1
        const done = step > idx
        const active = step === idx
        return (
          <React.Fragment key={i}>
            <div className="flex flex-col items-center gap-1.5">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${
                done ? 'bg-green-500 text-white' :
                active ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' :
                'bg-gray-100 text-gray-400'
              }`}>
                {done
                  ? <CheckCircle2 className="w-5 h-5" />
                  : <Icon className="w-5 h-5" />
                }
              </div>
              <span className={`text-xs font-semibold hidden sm:block ${
                active ? 'text-blue-600' : done ? 'text-green-600' : 'text-gray-400'
              }`}>{label}</span>
            </div>
            {i < STEP_LABELS.length - 1 && (
              <div className={`h-0.5 w-8 sm:w-16 mx-1 transition-all ${done ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </React.Fragment>
        )
      })}
    </div>
  )
}

// ─── Carte matériau ───────────────────────────────────────────────────────────

function MaterialCard({
  material, selected, quantity, details, lengthM, widthM, heightM, itemKindLabel, onToggle, onQty, onSetQty, onSetDetails, onSetLength, onSetWidth, onSetHeight
}: {
  material: PublicMaterial
  selected: boolean
  quantity: number
  details: string
  lengthM: number | null
  widthM: number | null
  heightM: number | null
  itemKindLabel: string
  onToggle: () => void
  onQty: (d: number) => void
  onSetQty: (q: number) => void
  onSetDetails: (v: string) => void
  onSetLength: (v: number | null) => void
  onSetWidth: (v: number | null) => void
  onSetHeight: (v: number | null) => void
}) {
  const dimensionMode = getDimensionMode(material.dimension_pricing_mode, material.dimension_pricing_enabled)
  const lengthMeta = getDimensionFieldMeta(material.dimension_schema, 'length', dimensionMode)
  const widthMeta = getDimensionFieldMeta(material.dimension_schema, 'width', dimensionMode)
  const heightMeta = getDimensionFieldMeta(material.dimension_schema, 'height', dimensionMode)

  return (
    <div
      onClick={onToggle}
      className={`flex flex-col gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all select-none ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
          selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'
        }`}>
          <Package className="w-3.5 h-3.5" />
        </div>
        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
          selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
        }`}>
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${selected ? 'text-blue-800' : 'text-gray-800'}`}>{material.name}</p>
          <div className="flex items-center gap-2">
            {material.unit && <p className="text-xs text-gray-400">{formatPublicUnit(material.unit)}</p>}
            <p className="text-[11px] text-gray-400">{itemKindLabel}</p>
          </div>
        </div>
      </div>

      {selected && (
        <div className="mt-1 pt-3 border-t border-blue-100 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
          {dimensionMode !== 'none' ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="text-xs text-gray-600">
                {lengthMeta.label} ({lengthMeta.unit})
                <input type="number" min="0" step="0.01" value={metersToDisplayUnit(lengthM ?? material.base_length_m ?? null, lengthMeta.unit) ?? ''} onChange={e => onSetLength(e.target.value ? displayUnitToMeters(Number(e.target.value), lengthMeta.unit) : null)} className="mt-1 w-full text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 focus:outline-none focus:border-blue-400" />
              </label>
              {(dimensionMode === 'area' || dimensionMode === 'volume' || widthMeta.enabled) && (
                <label className="text-xs text-gray-600">
                  {widthMeta.label} ({widthMeta.unit})
                  <input type="number" min="0" step="0.01" value={metersToDisplayUnit(widthM ?? material.base_width_m ?? null, widthMeta.unit) ?? ''} onChange={e => onSetWidth(e.target.value ? displayUnitToMeters(Number(e.target.value), widthMeta.unit) : null)} className="mt-1 w-full text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 focus:outline-none focus:border-blue-400" />
                </label>
              )}
              {(dimensionMode === 'volume' || heightMeta.enabled) && (
                <label className="text-xs text-gray-600">
                  {heightMeta.label} ({heightMeta.unit})
                  <input type="number" min="0" step="0.01" value={metersToDisplayUnit(heightM ?? material.base_height_m ?? null, heightMeta.unit) ?? ''} onChange={e => onSetHeight(e.target.value ? displayUnitToMeters(Number(e.target.value), heightMeta.unit) : null)} className="mt-1 w-full text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 focus:outline-none focus:border-blue-400" />
                </label>
              )}
              <div className="flex items-end">
                <div className="w-full text-xs text-blue-700 bg-blue-100 rounded-lg px-3 py-2 font-semibold">
                  Quantité calculée : {quantity.toFixed(2)} {dimensionMode === 'linear' ? 'm' : dimensionMode === 'area' ? 'm²' : 'm³'}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 self-end sm:self-auto">
              <button type="button" onClick={() => onQty(-1)}
                className="w-8 h-8 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center hover:bg-gray-300 text-gray-800 shadow-sm transition-all focus:outline-none">
                <Minus className="w-4 h-4" />
              </button>
              <input
                type="number"
                min="1"
                value={quantity || 1}
                onChange={e => {
                  const val = parseInt(e.target.value)
                  if (!isNaN(val)) onSetQty(Math.max(1, val))
                }}
                className="w-16 h-8 font-bold text-center tabular-nums text-gray-900 border border-gray-300 bg-white rounded-lg px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
              />
              <button type="button" onClick={() => onQty(+1)}
                className="w-8 h-8 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center hover:bg-gray-300 text-gray-800 shadow-sm transition-all focus:outline-none">
                <Plus className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="flex-1">
            <input type="text" value={details} onChange={e => onSetDetails(e.target.value)} placeholder="Précisions utiles pour le devis..." className="w-full text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-400" />
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Carte opération ──────────────────────────────────────────────────────────

function LaborCard({
  labor, selected, quantity, details, onToggle, onQty, onSetQty, onSetDetails,
}: {
  labor: PublicLaborRate
  selected: boolean
  quantity: number
  details: string
  onToggle: () => void
  onQty: (d: number) => void
  onSetQty: (q: number) => void
  onSetDetails: (v: string) => void
}) {
  return (
    <div
      onClick={onToggle}
      className={`flex flex-col gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all select-none ${
        selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300 bg-white'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${
          selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'
        }`}>
          <Wrench className="w-3.5 h-3.5" />
        </div>
        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
          selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
        }`}>
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-semibold truncate ${selected ? 'text-blue-800' : 'text-gray-800'}`}>{labor.designation}</p>
          <div className="flex items-center gap-2">
            {labor.unit && <p className="text-xs text-gray-400">{formatPublicUnit(labor.unit)}</p>}
            {labor.category && <p className="text-[11px] text-gray-400">{labor.category}</p>}
          </div>
        </div>
      </div>

      {selected && (
        <div className="mt-1 pt-3 border-t border-blue-100 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
          <div className="flex items-center gap-1.5 self-end sm:self-auto">
            <button type="button" onClick={() => onQty(-1)} className="w-8 h-8 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center hover:bg-gray-300 text-gray-800 shadow-sm transition-all focus:outline-none">
              <Minus className="w-4 h-4" />
            </button>
            <input
              type="number"
              min="1"
              value={quantity || 1}
              onChange={e => {
                const val = parseInt(e.target.value)
                if (!isNaN(val)) onSetQty(Math.max(1, val))
              }}
              className="w-16 h-8 font-bold text-center tabular-nums text-gray-900 border border-gray-300 bg-white rounded-lg px-1 py-1 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
            <button type="button" onClick={() => onQty(+1)} className="w-8 h-8 rounded-full bg-gray-200 border border-gray-300 flex items-center justify-center hover:bg-gray-300 text-gray-800 shadow-sm transition-all focus:outline-none">
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <input type="text" value={details} onChange={e => onSetDetails(e.target.value)} placeholder="Précisions utiles pour le devis..." className="w-full text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-blue-400" />
        </div>
      )}
    </div>
  )
}

// ─── Carte prestation type ────────────────────────────────────────────────────

function PrestationCard({
  pt, selected, data, onToggle, onLineQty, onLineSetQty, onLineSetDetails, onLineSetLength, onLineSetWidth, onLineSetHeight, onLineRemove, onLineAdd,
}: {
  pt: PublicPrestationType
  selected: boolean
  data: SelectedPrestation | undefined
  onToggle: () => void
  onLineQty: (lineId: string, d: number) => void
  onLineSetQty: (lineId: string, q: number) => void
  onLineSetDetails: (lineId: string, d: string) => void
  onLineSetLength: (lineId: string, length_m: number | null) => void
  onLineSetWidth: (lineId: string, width_m: number | null) => void
  onLineSetHeight: (lineId: string, height_m: number | null) => void
  onLineRemove: (lineId: string) => void
  onLineAdd: (line: PrestationLine) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [newDesig, setNewDesig] = useState('')
  const [newQty, setNewQty] = useState('1')
  const [newUnit, setNewUnit] = useState('u')

  function handleToggle() {
    onToggle()
    if (!selected) setExpanded(true)
  }

  function addLine() {
    if (!newDesig.trim()) return
    onLineAdd({
      id: `custom-${Date.now()}`,
      item_type: 'free',
      material_id: null,
      labor_rate_id: null,
      designation: newDesig.trim(),
      quantity: Math.max(1, parseInt(newQty) || 1),
      unit: newUnit.trim() || 'u',
      unit_price_ht: 0,
      dimension_pricing_mode: 'none',
      dimension_pricing_enabled: false,
      base_length_m: null,
      base_width_m: null,
      base_height_m: null,
      isCustom: true,
    })
    setNewDesig('')
    setNewQty('1')
    setNewUnit('u')
  }

  const lines = data?.lines ?? []

  return (
    <div className={`rounded-2xl border-2 transition-all ${
      selected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'
    }`}>
      {/* Header */}
      <div
        className="flex items-center gap-3 p-4 cursor-pointer select-none"
        onClick={handleToggle}
      >
        <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${
          selected ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-400'
        }`}>
          <Layers className="w-4 h-4" />
        </div>
        <div className={`w-4 h-4 rounded border-2 flex items-center justify-center flex-shrink-0 ${
          selected ? 'bg-blue-500 border-blue-500' : 'border-gray-300'
        }`}>
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <p className={`text-sm font-bold ${selected ? 'text-blue-800' : 'text-gray-800'}`}>{pt.name}</p>
          {pt.category && <p className="text-xs text-gray-400 mt-0.5">{pt.category}</p>}
        </div>
        {selected && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
            className="flex items-center gap-1 text-xs text-blue-600 font-semibold px-2 py-1 rounded-lg hover:bg-blue-100 transition-colors"
          >
            {expanded ? 'Réduire' : 'Modifier'}
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        )}
      </div>

      {/* Description et lignes (quand sélectionné + expandé) */}
      {selected && expanded && (
        <div className="px-4 pb-4 space-y-3" onClick={e => e.stopPropagation()}>
          {pt.description && (
            <p className="text-sm text-gray-600 italic border-l-2 border-blue-300 pl-3">{pt.description}</p>
          )}

          {lines.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Éléments inclus</p>
              {lines.map(line => {
                const lengthMeta = getDimensionFieldMeta(line.dimension_schema, 'length', line.dimension_pricing_mode)
                const widthMeta = getDimensionFieldMeta(line.dimension_schema, 'width', line.dimension_pricing_mode)
                const heightMeta = getDimensionFieldMeta(line.dimension_schema, 'height', line.dimension_pricing_mode)
                return (
                <div key={line.id} className="flex flex-col gap-2 bg-white rounded-lg p-2.5 border border-blue-200">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm font-medium text-gray-700">{line.designation}</span>
                    {line.dimension_pricing_mode !== 'none' ? (
                      <span className="text-xs font-semibold text-blue-700 bg-blue-100 px-2 py-1 rounded-lg">
                        {line.quantity.toFixed(2)} {line.dimension_pricing_mode === 'linear' ? 'm' : line.dimension_pricing_mode === 'area' ? 'm²' : 'm³'}
                      </span>
                    ) : (
                      <div className="flex items-center gap-1.5">
                        <button type="button" onClick={() => onLineQty(line.id, -1)}
                          className="w-7 h-7 rounded-full bg-gray-200 border border-gray-300 hover:bg-gray-300 flex items-center justify-center text-gray-800 transition-colors">
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="number" min="1" value={line.quantity || 1}
                          onChange={e => {
                            const val = parseInt(e.target.value)
                            if (!isNaN(val)) onLineSetQty(line.id, Math.max(1, val))
                          }}
                          className="w-14 px-1 py-1 text-sm font-bold text-center tabular-nums text-gray-900 bg-white border border-gray-300 rounded focus:outline-none focus:border-blue-400"
                        />
                        <span className="text-xs font-semibold text-gray-500 w-6">{line.unit}</span>
                        <button type="button" onClick={() => onLineQty(line.id, +1)}
                          className="w-7 h-7 rounded-full bg-gray-200 border border-gray-300 hover:bg-gray-300 flex items-center justify-center text-gray-800 transition-colors">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                    {line.isCustom && (
                      <button type="button" onClick={() => onLineRemove(line.id)}
                        className="w-6 h-6 rounded-full bg-red-50 hover:bg-red-100 flex items-center justify-center text-red-500 transition-colors ml-1">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                  {line.dimension_pricing_mode !== 'none' && (
                    <div className={`grid grid-cols-1 gap-2 ${line.dimension_pricing_mode === 'linear' ? 'sm:grid-cols-1' : line.dimension_pricing_mode === 'area' ? 'sm:grid-cols-2' : 'sm:grid-cols-3'}`}>
                      <input type="number" min="0" step="0.01" value={metersToDisplayUnit(line.length_m ?? line.base_length_m ?? null, lengthMeta.unit) ?? ''} onChange={e => onLineSetLength(line.id, e.target.value ? displayUnitToMeters(Number(e.target.value), lengthMeta.unit) : null)} placeholder={`${lengthMeta.label} (${lengthMeta.unit})`} className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-100 text-gray-900 bg-gray-50 focus:bg-white focus:outline-none focus:border-blue-300 transition-colors" />
                      {(line.dimension_pricing_mode === 'area' || line.dimension_pricing_mode === 'volume' || widthMeta.enabled) && (
                        <input type="number" min="0" step="0.01" value={metersToDisplayUnit(line.width_m ?? line.base_width_m ?? null, widthMeta.unit) ?? ''} onChange={e => onLineSetWidth(line.id, e.target.value ? displayUnitToMeters(Number(e.target.value), widthMeta.unit) : null)} placeholder={`${widthMeta.label} (${widthMeta.unit})`} className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-100 text-gray-900 bg-gray-50 focus:bg-white focus:outline-none focus:border-blue-300 transition-colors" />
                      )}
                      {(line.dimension_pricing_mode === 'volume' || heightMeta.enabled) && (
                        <input type="number" min="0" step="0.01" value={metersToDisplayUnit(line.height_m ?? line.base_height_m ?? null, heightMeta.unit) ?? ''} onChange={e => onLineSetHeight(line.id, e.target.value ? displayUnitToMeters(Number(e.target.value), heightMeta.unit) : null)} placeholder={`${heightMeta.label} (${heightMeta.unit})`} className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-100 text-gray-900 bg-gray-50 focus:bg-white focus:outline-none focus:border-blue-300 transition-colors" />
                      )}
                    </div>
                  )}
                  <input type="text" value={line.details || ''} onChange={e => onLineSetDetails(line.id, e.target.value)} placeholder="Précisions (dimensions...)" className="w-full text-xs px-2.5 py-1.5 rounded border border-gray-100 text-gray-900 bg-gray-50 placeholder:text-gray-400 focus:bg-white focus:outline-none focus:border-blue-300 transition-colors" />
                </div>
              )})}
            </div>
          )}

          {/* Ajouter une ligne */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">Ajouter un élément</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={newDesig}
                onChange={e => setNewDesig(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLine())}
                placeholder="Désignation..."
                className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-900 placeholder:text-gray-400"
              />
              <input
                type="number"
                value={newQty}
                onChange={e => setNewQty(e.target.value)}
                min={1}
                className="w-16 px-2 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-900 text-center"
              />
              <input
                type="text"
                value={newUnit}
                onChange={e => setNewUnit(e.target.value)}
                placeholder="u"
                className="w-14 px-2 py-2 text-sm rounded-lg border border-gray-200 focus:outline-none focus:border-blue-400 bg-white text-gray-900 text-center"
              />
              <button
                type="button"
                onClick={addLine}
                disabled={!newDesig.trim()}
                className="px-3 py-2 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Description courte quand non expandé */}
      {pt.description && !expanded && (
        <p className="px-4 pb-3 text-xs text-gray-500 -mt-1">{pt.description}</p>
      )}
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function PublicFormClient({
  orgSlug, orgName, logoUrl, welcomeMessage,
  materials, laborRates, prestationTypes, customModeEnabled, catalogContext,
}: Props) {
  const [step, setStep] = useState(1)
  const [isPending, startTransition] = useTransition()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  // Honeypot anti-bot : ce champ doit rester vide
  const [honeypot, setHoneypot] = useState('')

  // Étape 1 — Identité
  const [clientType, setClientType] = useState<'particulier' | 'pro'>('particulier')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [siret, setSiret] = useState('')
  const [step1Error, setStep1Error] = useState<string | null>(null)

  // Étape 2 — Projet
  const [selectedMaterials, setSelectedMaterials] = useState<Record<string, SelectedMaterial>>({})
  const [selectedLaborRates, setSelectedLaborRates] = useState<Record<string, SelectedLaborRate>>({})
  const [selectedPrestations, setSelectedPrestations] = useState<Record<string, SelectedPrestation>>({})
  const [freeDescription, setFreeDescription] = useState('')
  const [step2Error, setStep2Error] = useState<string | null>(null)
  const [step2Search, setStep2Search] = useState('')
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set())

  // Étape 3 — Chantier
  const [chantierAddress, setChantierAddress] = useState('')
  const [chantierPostalCode, setChantierPostalCode] = useState('')
  const [chantierCity, setChantierCity] = useState('')
  const [extraNotes, setExtraNotes] = useState('')
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null)
  const [attachmentUrl, setAttachmentUrl] = useState<string | null>(null)
  const [attachmentMeta, setAttachmentMeta] = useState<AttachmentMeta | null>(null)
  const [isUploading, setIsUploading] = useState(false)

  // ── Helpers matériaux ───────────────────────────────────────────────────────

  function toggleMaterial(m: PublicMaterial) {
    setSelectedMaterials(prev => {
      if (prev[m.id]) {
        const next = { ...prev }
        delete next[m.id]
        return next
      }
      const dimensionMode = getDimensionMode(m.dimension_pricing_mode, m.dimension_pricing_enabled)
      const selection = buildDimensionSelection({
        priceVariants: m.price_variants,
        mode: dimensionMode,
        fallbackUnit: m.unit,
        baseLengthM: m.base_length_m ?? null,
        baseWidthM: m.base_width_m ?? null,
        baseHeightM: m.base_height_m ?? null,
      })
      return {
        ...prev,
        [m.id]: {
          id: m.id,
          name: m.name,
          item_kind: m.item_kind,
          unit: selection.unit,
          quantity: dimensionMode === 'none' ? 1 : selection.quantity,
          base_length_m: m.base_length_m ?? null,
          base_width_m: m.base_width_m ?? null,
          base_height_m: m.base_height_m ?? null,
          dimension_pricing_mode: dimensionMode,
          dimension_pricing_enabled: m.dimension_pricing_enabled,
          dimension_schema: m.dimension_schema,
          price_variants: m.price_variants,
          length_m: selection.length_m,
          width_m: selection.width_m,
          height_m: selection.height_m,
        },
      }
    })
  }

  function setMaterialQty(id: string, delta: number) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], quantity: Math.max(1, prev[id].quantity + delta) } }
    })
  }

  function setMaterialExactQty(id: string, quantity: number) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], quantity } }
    })
  }

  function setMaterialDetails(id: string, details: string) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], details } }
    })
  }

  function toggleLaborRate(labor: PublicLaborRate) {
    setSelectedLaborRates(prev => {
      if (prev[labor.id]) {
        const next = { ...prev }
        delete next[labor.id]
        return next
      }
      return {
        ...prev,
        [labor.id]: {
          id: labor.id,
          designation: labor.designation,
          unit: labor.unit,
          quantity: 1,
        },
      }
    })
  }

  function setLaborQty(id: string, delta: number) {
    setSelectedLaborRates(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], quantity: Math.max(1, prev[id].quantity + delta) } }
    })
  }

  function setLaborExactQty(id: string, quantity: number) {
    setSelectedLaborRates(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], quantity } }
    })
  }

  function setLaborDetails(id: string, details: string) {
    setSelectedLaborRates(prev => {
      if (!prev[id]) return prev
      return { ...prev, [id]: { ...prev[id], details } }
    })
  }

  function setMaterialLength(id: string, length_m: number | null) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      const current = prev[id]
      const selection = buildDimensionSelection({
        priceVariants: current.price_variants,
        mode: current.dimension_pricing_mode,
        fallbackUnit: current.unit,
        baseLengthM: current.base_length_m,
        baseWidthM: current.base_width_m,
        baseHeightM: current.base_height_m,
        lengthM: length_m,
        widthM: current.width_m,
        heightM: current.height_m,
      })
      return { ...prev, [id]: { ...current, ...selection } }
    })
  }

  function setMaterialWidth(id: string, width_m: number | null) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      const current = prev[id]
      const selection = buildDimensionSelection({
        priceVariants: current.price_variants,
        mode: current.dimension_pricing_mode,
        fallbackUnit: current.unit,
        baseLengthM: current.base_length_m,
        baseWidthM: current.base_width_m,
        baseHeightM: current.base_height_m,
        lengthM: current.length_m,
        widthM: width_m,
        heightM: current.height_m,
      })
      return { ...prev, [id]: { ...current, ...selection } }
    })
  }

  function setMaterialHeight(id: string, height_m: number | null) {
    setSelectedMaterials(prev => {
      if (!prev[id]) return prev
      const current = prev[id]
      const selection = buildDimensionSelection({
        priceVariants: current.price_variants,
        mode: current.dimension_pricing_mode,
        fallbackUnit: current.unit,
        baseLengthM: current.base_length_m,
        baseWidthM: current.base_width_m,
        baseHeightM: current.base_height_m,
        lengthM: current.length_m,
        widthM: current.width_m,
        heightM: height_m,
      })
      return { ...prev, [id]: { ...current, ...selection } }
    })
  }

  // ── Helpers prestations ─────────────────────────────────────────────────────

  function togglePrestation(pt: PublicPrestationType) {
    setSelectedPrestations(prev => {
      if (prev[pt.id]) {
        const next = { ...prev }
        delete next[pt.id]
        return next
      }
      return {
        ...prev,
        [pt.id]: {
          id: pt.id,
          name: pt.name,
          category: pt.category,
          lines: pt.lines.map(l => {
            const dimensionMode = getDimensionMode(l.dimension_pricing_mode, l.dimension_pricing_enabled)
            const selection = buildDimensionSelection({
              priceVariants: l.price_variants,
              mode: dimensionMode,
              fallbackUnit: l.unit,
              baseLengthM: l.base_length_m,
              baseWidthM: l.base_width_m,
              baseHeightM: l.base_height_m,
            })
            return {
              ...l,
              isCustom: false,
              dimension_pricing_mode: dimensionMode,
              quantity: dimensionMode === 'none' ? l.quantity : selection.quantity,
              unit: selection.unit,
              dimension_schema: l.dimension_schema,
              price_variants: l.price_variants,
              length_m: selection.length_m,
              width_m: selection.width_m,
              height_m: selection.height_m,
            }
          }),
        },
      }
    })
  }

  function setPrestationLineQty(prestId: string, lineId: string, delta: number) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l
          ),
        },
      }
    })
  }

  function setPrestationLineExactQty(prestId: string, lineId: string, quantity: number) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId ? { ...l, quantity } : l
          ),
        },
      }
    })
  }

  function setPrestationLineDetails(prestId: string, lineId: string, details: string) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId ? { ...l, details } : l
          ),
        },
      }
    })
  }

  function setPrestationLineLength(prestId: string, lineId: string, length_m: number | null) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId
              ? {
                  ...l,
                  ...buildDimensionSelection({
                    priceVariants: l.price_variants,
                    mode: l.dimension_pricing_mode,
                    fallbackUnit: l.unit,
                    baseLengthM: l.base_length_m,
                    baseWidthM: l.base_width_m,
                    baseHeightM: l.base_height_m,
                    lengthM: length_m,
                    widthM: l.width_m,
                    heightM: l.height_m,
                  }),
                }
              : l
          ),
        },
      }
    })
  }

  function setPrestationLineWidth(prestId: string, lineId: string, width_m: number | null) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId
              ? {
                  ...l,
                  ...buildDimensionSelection({
                    priceVariants: l.price_variants,
                    mode: l.dimension_pricing_mode,
                    fallbackUnit: l.unit,
                    baseLengthM: l.base_length_m,
                    baseWidthM: l.base_width_m,
                    baseHeightM: l.base_height_m,
                    lengthM: l.length_m,
                    widthM: width_m,
                    heightM: l.height_m,
                  }),
                }
              : l
          ),
        },
      }
    })
  }

  function setPrestationLineHeight(prestId: string, lineId: string, height_m: number | null) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.map(l =>
            l.id === lineId
              ? {
                  ...l,
                  ...buildDimensionSelection({
                    priceVariants: l.price_variants,
                    mode: l.dimension_pricing_mode,
                    fallbackUnit: l.unit,
                    baseLengthM: l.base_length_m,
                    baseWidthM: l.base_width_m,
                    baseHeightM: l.base_height_m,
                    lengthM: l.length_m,
                    widthM: l.width_m,
                    heightM: height_m,
                  }),
                }
              : l
          ),
        },
      }
    })
  }

  function removePrestationLine(prestId: string, lineId: string) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: {
          ...prev[prestId],
          lines: prev[prestId].lines.filter(l => l.id !== lineId),
        },
      }
    })
  }

  function addPrestationLine(prestId: string, line: PrestationLine) {
    setSelectedPrestations(prev => {
      if (!prev[prestId]) return prev
      return {
        ...prev,
        [prestId]: { ...prev[prestId], lines: [...prev[prestId].lines, line] },
      }
    })
  }

  // ── Accordéons catégories step 2 ───────────────────────────────────────────

  function toggleCategory(key: string) {
    setExpandedCategories(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // ── Upload fichier ──────────────────────────────────────────────────────────

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 10 * 1024 * 1024) {
      alert('Le fichier ne doit pas dépasser 10 Mo.')
      return
    }
    setAttachmentFile(file)
    setIsUploading(true)
    try {
      const supabase = createClient()
      const ext = file.name.split('.').pop()
      const path = `quote-requests/${orgSlug}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`
      const { data, error } = await supabase.storage.from('quote-attachments').upload(path, file, { upsert: false })
      if (error) throw error
      const { data: urlData } = supabase.storage.from('quote-attachments').getPublicUrl(data.path)
      setAttachmentUrl(urlData.publicUrl)
      setAttachmentMeta({
        storage_path: data.path,
        filename: file.name,
        size: file.size,
        content_type: file.type || null,
        public_url: urlData.publicUrl,
      })
    } catch {
      alert('Erreur lors de l\'upload. Vous pouvez continuer sans fichier joint.')
      setAttachmentFile(null)
      setAttachmentUrl(null)
      setAttachmentMeta(null)
    } finally {
      setIsUploading(false)
    }
  }

  // ── Validation par étape ────────────────────────────────────────────────────

  function validateStep1(): boolean {
    if (!name.trim()) { setStep1Error('Veuillez renseigner votre nom.'); return false }
    const trimmedEmail = email.trim()
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) {
      setStep1Error('Veuillez renseigner un email valide.')
      return false
    }
    const domain = trimmedEmail.split('@')[1]?.toLowerCase()
    if (domain && BLOCKED_EMAIL_DOMAINS.has(domain)) {
      setStep1Error('Les adresses email temporaires (yopmail, mailinator...) ne sont pas acceptées.')
      return false
    }
    if (clientType === 'pro' && !companyName.trim()) { setStep1Error('Veuillez renseigner le nom de votre entreprise.'); return false }
    setStep1Error(null)
    return true
  }

  function validateStep2(): boolean {
    const hasMat = Object.keys(selectedMaterials).length > 0
    const hasLabor = Object.keys(selectedLaborRates).length > 0
    const hasPresta = Object.keys(selectedPrestations).length > 0
    const hasDesc = freeDescription.trim().length > 0
    if (!hasMat && !hasLabor && !hasPresta && !hasDesc) {
      setStep2Error('Veuillez sélectionner au moins une prestation ou décrire votre projet.')
      return false
    }
    setStep2Error(null)
    return true
  }

  function goNext() {
    if (step === 1 && !validateStep1()) return
    if (step === 2 && !validateStep2()) return
    setStep(s => s + 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function goBack() {
    setStep(s => s - 1)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ── Soumission ──────────────────────────────────────────────────────────────

  function handleSubmit() {
    setSubmitError(null)
    if (isUploading) {
      setSubmitError('Le fichier est encore en cours d\'upload. Patientez quelques secondes avant d\'envoyer.')
      return
    }
    const fd = new FormData()
    fd.set('org_slug', orgSlug)
    fd.set('_hp_website', honeypot) // honeypot : doit rester vide
    fd.set('name', name.trim())
    fd.set('email', email.trim())
    if (phone.trim()) fd.set('phone', phone.trim())

    // Infos pro
    const fullCompanyName = clientType === 'pro' && companyName.trim() ? companyName.trim() : ''
    if (fullCompanyName) fd.set('company_name', fullCompanyName)

    // Chantier
    if (chantierAddress.trim()) fd.set('chantier_address_line1', chantierAddress.trim())
    if (chantierPostalCode.trim()) fd.set('chantier_postal_code', chantierPostalCode.trim())
    if (chantierCity.trim()) fd.set('chantier_city', chantierCity.trim())

    // Fichier
    if (attachmentUrl) fd.set('attachment_url', attachmentUrl)
    if (attachmentMeta) fd.set('attachments', JSON.stringify([attachmentMeta]))

    // Construction du catalogue et de la description
    const catalogItems: Array<{
      id: string; item_type: string; description: string; unit: string | null
      quantity: number
      length_m?: number | null
      width_m?: number | null
      height_m?: number | null
      dimension_pricing_mode?: DimensionPricingMode | null
      dimension_pricing_enabled?: boolean
      base_length_m?: number | null
      base_width_m?: number | null
      base_height_m?: number | null
      lines?: Array<{
        id: string
        item_type: 'material' | 'labor' | 'transport' | 'free'
        material_id: string | null
        labor_rate_id: string | null
        designation: string
        quantity: number
        unit: string
        unit_price_ht: number
        isCustom: boolean
        details?: string
        length_m?: number | null
        width_m?: number | null
        height_m?: number | null
        dimension_pricing_mode?: DimensionPricingMode | null
        dimension_pricing_enabled: boolean
        base_length_m: number | null
        base_width_m: number | null
        base_height_m: number | null
      }>
    }> = []

    const descParts: string[] = []

    // Matériaux
    const mats = Object.values(selectedMaterials)
    if (mats.length > 0) {
      for (const m of mats) {
        catalogItems.push({
          id: m.id,
          item_type: 'material',
          description: m.name,
          unit: m.unit,
          quantity: m.quantity,
          height_m: m.height_m ?? null,
          dimension_pricing_mode: m.dimension_pricing_mode,
          length_m: m.length_m ?? null,
          width_m: m.width_m ?? null,
          dimension_pricing_enabled: m.dimension_pricing_enabled ?? false,
          base_length_m: m.base_length_m,
          base_width_m: m.base_width_m,
          base_height_m: m.base_height_m,
        })
      }
      descParts.push('Catalogue : ' + mats.map(m =>
        m.dimension_pricing_mode !== 'none'
          ? `${m.name} (${formatDimensionSummary(m.dimension_pricing_mode, m.length_m, m.width_m, m.height_m)})${m.details ? ` [${m.details}]` : ''}`
          : `${m.name} x ${m.quantity}${m.unit ? ' ' + m.unit : ''}${m.details ? ` [${m.details}]` : ''}`,
      ).join(', '))
    }

    // Opérations
    const labor = Object.values(selectedLaborRates)
    if (labor.length > 0) {
      for (const l of labor) {
        catalogItems.push({
          id: l.id,
          item_type: 'labor',
          description: l.designation,
          unit: l.unit,
          quantity: l.quantity,
        })
      }
      descParts.push('Opérations : ' + labor.map(l =>
        `${l.designation} x ${l.quantity}${l.unit ? ' ' + l.unit : ''}${l.details ? ` [${l.details}]` : ''}`,
      ).join(', '))
    }

    // Prestations
    const prestas = Object.values(selectedPrestations)
    if (prestas.length > 0) {
      for (const p of prestas) {
        catalogItems.push({ id: p.id, item_type: 'prestation', description: p.name, unit: null, quantity: 1, lines: p.lines as any })
      }
      descParts.push('Prestations : ' + prestas.map(p => {
        const linesSummary = p.lines.map(l =>
          l.dimension_pricing_mode !== 'none'
            ? `${l.designation} (${formatDimensionSummary(l.dimension_pricing_mode, l.length_m, l.width_m, l.height_m)})${l.details ? ` [${l.details}]` : ''}`
            : `${l.designation} x ${l.quantity} ${l.unit}${l.details ? ` [${l.details}]` : ''}`,
        ).join(', ')
        return linesSummary ? `${p.name} (${linesSummary})` : p.name
      }).join(' | '))
    }

    // SIRET dans la description si pro
    if (clientType === 'pro' && siret.trim()) {
      descParts.unshift(`[Professionnel] SIRET : ${siret.trim()}`)
    }

    // Notes complémentaires
    if (extraNotes.trim()) descParts.push('Notes : ' + extraNotes.trim())

    // Description libre
    if (freeDescription.trim()) descParts.push(freeDescription.trim())

    const description = descParts.join('\n\n')
    fd.set('description', description || 'Demande de devis')

    if (catalogItems.length > 0) {
      fd.set('type', 'catalog')
      fd.set('catalog_items', JSON.stringify(catalogItems))
    } else {
      fd.set('type', 'custom')
    }

    startTransition(async () => {
      const res = await submitQuoteRequest({ error: null, success: false }, fd)
      if (res.error) setSubmitError(res.error)
      else setSuccess(true)
    })
  }

  // ── Écran de succès ─────────────────────────────────────────────────────────

  if (success) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-8">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-lg p-10 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-green-600" />
          </div>
          <h2 className="text-2xl font-bold text-gray-900">Demande envoyée !</h2>
          <p className="text-gray-500">
            Merci pour votre demande. <strong>{orgName}</strong> vous contactera dans les meilleurs délais.
          </p>
        </div>
      </div>
    )
  }

  // ── Groupement matériaux par catégorie ──────────────────────────────────────

  const step2Q = step2Search.toLowerCase().trim()
  const articleMaterialGroups = groupByCategory(
    materials.filter(m => m.item_kind === 'article' && (!step2Q || m.name.toLowerCase().includes(step2Q))),
  )
  const serviceMaterialGroups = groupByCategory(
    materials.filter(m => m.item_kind === 'service' && (!step2Q || m.name.toLowerCase().includes(step2Q))),
  )
  const laborRateGroups = groupByCategory(
    laborRates.filter(l => !step2Q || l.designation.toLowerCase().includes(step2Q)),
  )
  const filteredPrestationGroups = groupByCategory(
    prestationTypes.filter(pt => !step2Q || pt.name.toLowerCase().includes(step2Q)),
  )
  const hasCatalog = materials.length > 0 || laborRates.length > 0 || prestationTypes.length > 0

  // ── Récap ───────────────────────────────────────────────────────────────────

  const recapItems: Array<{ label: string; value: string }> = [
    { label: 'Nom', value: name },
    { label: 'Email', value: email },
    ...(phone ? [{ label: 'Téléphone', value: phone }] : []),
    ...(clientType === 'pro' && companyName ? [{ label: 'Entreprise', value: companyName }] : []),
    ...(clientType === 'pro' && siret ? [{ label: 'SIRET', value: siret }] : []),
    ...(Object.values(selectedMaterials).length > 0 ? [{
      label: 'Catalogue',
      value: Object.values(selectedMaterials).map(m =>
        m.dimension_pricing_mode !== 'none'
          ? `${m.name} (${formatDimensionSummary(m.dimension_pricing_mode, m.length_m, m.width_m, m.height_m)})${m.details ? ` [${m.details}]` : ''}`
          : `${m.name} × ${m.quantity}${m.details ? ` [${m.details}]` : ''}`,
      ).join(', '),
    }] : []),
    ...(Object.values(selectedLaborRates).length > 0 ? [{
      label: catalogContext.labelSet.service.plural,
      value: Object.values(selectedLaborRates).map(l =>
        `${l.designation} x ${l.quantity}${l.unit ? ' ' + l.unit : ''}${l.details ? ` [${l.details}]` : ''}`,
      ).join(', '),
    }] : []),
    ...(Object.values(selectedPrestations).length > 0 ? [{
      label: catalogContext.labelSet.bundleTemplate.plural,
      value: Object.values(selectedPrestations).map(p => {
        const hasDetails = p.lines.some(l => l.details);
        return p.name + (hasDetails ? ' (Avec précisions)' : '');
      }).join(', '),
    }] : []),
    ...(freeDescription ? [{ label: 'Description', value: freeDescription }] : []),
    ...([chantierAddress, chantierPostalCode, chantierCity].some(Boolean) ? [{
      label: 'Chantier',
      value: [chantierAddress, chantierPostalCode, chantierCity].filter(Boolean).join(', '),
    }] : []),
    ...(extraNotes ? [{ label: 'Notes', value: extraNotes }] : []),
    ...(attachmentFile ? [{ label: 'Fichier joint', value: attachmentFile.name }] : []),
  ]

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Header */}
        <div className="text-center space-y-3">
          {logoUrl && <img src={logoUrl} alt={orgName} className="h-16 mx-auto object-contain" />}
          <h1 className="text-2xl font-bold text-gray-900">Demande de devis</h1>
          <p className="text-base font-semibold text-gray-500">{orgName}</p>
          {welcomeMessage && (
            <p className="text-sm text-gray-600 max-w-prose mx-auto">{welcomeMessage}</p>
          )}
        </div>

        {/* Barre de progression */}
        <ProgressBar step={step} />

        {/* Card principale */}
        <div className="bg-white rounded-3xl shadow-lg p-6 sm:p-8 space-y-6">

          {/* ── ÉTAPE 1 : Qui êtes-vous ? ── */}
          {step === 1 && (
            <>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Qui êtes-vous ?</h2>
                <p className="text-sm text-gray-400 mt-1">Ces informations permettront à l&apos;équipe de vous recontacter.</p>
              </div>

              {/* Toggle particulier / pro */}
              <div className="flex rounded-xl border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setClientType('particulier')}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                    clientType === 'particulier' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <User className="w-4 h-4" /> Particulier
                </button>
                <button
                  type="button"
                  onClick={() => setClientType('pro')}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-all flex items-center justify-center gap-2 ${
                    clientType === 'pro' ? 'bg-blue-600 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'
                  }`}
                >
                  <Building2 className="w-4 h-4" /> Professionnel
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-700">Nom complet *</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} className={inputCls} placeholder="Jean Dupont" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-700">Email *</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCls} placeholder="jean@exemple.fr" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-700">Téléphone</label>
                  <input type="tel" value={phone} onChange={e => setPhone(e.target.value)} className={inputCls} placeholder="06 12 34 56 78" />
                </div>
                {clientType === 'pro' && (
                  <>
                    <div className="space-y-1">
                      <label className="text-sm font-semibold text-gray-700">Nom de l&apos;entreprise *</label>
                      <input type="text" value={companyName} onChange={e => setCompanyName(e.target.value)} className={inputCls} placeholder="Weber Tôlerie" />
                    </div>
                    <div className="space-y-1 sm:col-span-2">
                      <label className="text-sm font-semibold text-gray-700">SIRET</label>
                      <input type="text" value={siret} onChange={e => setSiret(e.target.value)} className={inputCls} placeholder="123 456 789 00012" maxLength={17} />
                    </div>
                  </>
                )}
              </div>

              {step1Error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{step1Error}</p>
              )}
            </>
          )}

          {/* ── ÉTAPE 2 : Votre projet ── */}
          {step === 2 && (
            <>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Votre projet</h2>
                <p className="text-sm text-gray-400 mt-1">Sélectionnez ce dont vous avez besoin.</p>
              </div>

              {/* Barre de recherche */}
              {hasCatalog && (
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                  <input
                    type="search"
                    value={step2Search}
                    onChange={e => setStep2Search(e.target.value)}
                    placeholder="Rechercher dans le catalogue..."
                    className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 placeholder:text-gray-400 transition-all"
                  />
                  {step2Search && (
                    <button
                      type="button"
                      onClick={() => setStep2Search('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )}

              {/* Aucun résultat pour la recherche */}
              {hasCatalog && step2Q && articleMaterialGroups.length === 0 && serviceMaterialGroups.length === 0 && laborRateGroups.length === 0 && filteredPrestationGroups.length === 0 && (
                <div className="text-center py-6 text-sm text-gray-400">
                  Aucun résultat pour &laquo;&nbsp;{step2Search}&nbsp;&raquo;
                </div>
              )}

              {/* ── Articles par catégorie ── */}
              {articleMaterialGroups.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1">
                    {catalogContext.labelSet.material.plural}
                  </p>
                  {articleMaterialGroups.map(group => {
                    const key = `articles-${group.label}`
                    const selCount = group.items.filter(m => !!selectedMaterials[m.id]).length
                    const isOpen = !!step2Q || selCount > 0 || expandedCategories.has(key)
                    return (
                      <div key={group.label} className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                        <button
                          type="button"
                          onClick={() => toggleCategory(key)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm font-semibold text-gray-700 truncate">{group.label}</span>
                            {selCount > 0 && (
                              <span className="flex-shrink-0 text-[11px] font-bold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                                {selCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 text-gray-400">
                            <span className="text-xs hidden sm:block">{group.items.length}&nbsp;{group.items.length > 1 ? 'articles' : 'article'}</span>
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-100">
                            {group.items.map(m => (
                              <MaterialCard
                                key={m.id}
                                material={m}
                                itemKindLabel={catalogContext.labelSet.material.singular}
                                selected={!!selectedMaterials[m.id]}
                                quantity={selectedMaterials[m.id]?.quantity ?? 1}
                                details={selectedMaterials[m.id]?.details ?? ''}
                                lengthM={selectedMaterials[m.id]?.length_m ?? null}
                                widthM={selectedMaterials[m.id]?.width_m ?? null}
                                heightM={selectedMaterials[m.id]?.height_m ?? null}
                                onToggle={() => toggleMaterial(m)}
                                onQty={d => setMaterialQty(m.id, d)}
                                onSetQty={q => setMaterialExactQty(m.id, q)}
                                onSetDetails={d => setMaterialDetails(m.id, d)}
                                onSetLength={v => setMaterialLength(m.id, v)}
                                onSetWidth={v => setMaterialWidth(m.id, v)}
                                onSetHeight={v => setMaterialHeight(m.id, v)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── Services par catégorie ── */}
              {serviceMaterialGroups.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1">
                    {catalogContext.labelSet.service.plural}
                  </p>
                  {serviceMaterialGroups.map(group => {
                    const key = `services-${group.label}`
                    const selCount = group.items.filter(m => !!selectedMaterials[m.id]).length
                    const isOpen = !!step2Q || selCount > 0 || expandedCategories.has(key)
                    return (
                      <div key={group.label} className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                        <button
                          type="button"
                          onClick={() => toggleCategory(key)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm font-semibold text-gray-700 truncate">{group.label}</span>
                            {selCount > 0 && (
                              <span className="flex-shrink-0 text-[11px] font-bold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                                {selCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 text-gray-400">
                            <span className="text-xs hidden sm:block">{group.items.length}&nbsp;{group.items.length > 1 ? 'services' : 'service'}</span>
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-100">
                            {group.items.map(m => (
                              <MaterialCard
                                key={m.id}
                                material={m}
                                itemKindLabel={catalogContext.labelSet.service.singular}
                                selected={!!selectedMaterials[m.id]}
                                quantity={selectedMaterials[m.id]?.quantity ?? 1}
                                details={selectedMaterials[m.id]?.details ?? ''}
                                lengthM={selectedMaterials[m.id]?.length_m ?? null}
                                widthM={selectedMaterials[m.id]?.width_m ?? null}
                                heightM={selectedMaterials[m.id]?.height_m ?? null}
                                onToggle={() => toggleMaterial(m)}
                                onQty={d => setMaterialQty(m.id, d)}
                                onSetQty={q => setMaterialExactQty(m.id, q)}
                                onSetDetails={d => setMaterialDetails(m.id, d)}
                                onSetLength={v => setMaterialLength(m.id, v)}
                                onSetWidth={v => setMaterialWidth(m.id, v)}
                                onSetHeight={v => setMaterialHeight(m.id, v)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* ── Opérations par catégorie ── */}
              {laborRateGroups.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1">
                    {catalogContext.labelSet.service.plural}
                  </p>
                  {laborRateGroups.map(group => {
                    const key = `labor-${group.label}`
                    const selCount = group.items.filter(l => !!selectedLaborRates[l.id]).length
                    const isOpen = !!step2Q || selCount > 0 || expandedCategories.has(key)
                    return (
                      <div key={group.label} className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                        <button
                          type="button"
                          onClick={() => toggleCategory(key)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm font-semibold text-gray-700 truncate">{group.label}</span>
                            {selCount > 0 && (
                              <span className="flex-shrink-0 text-[11px] font-bold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                                {selCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 text-gray-400">
                            <span className="text-xs hidden sm:block">{group.items.length}&nbsp;{group.items.length > 1 ? 'opérations' : 'opération'}</span>
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="px-3 pb-3 pt-1 space-y-2 border-t border-gray-100">
                            {group.items.map(l => (
                              <LaborCard
                                key={l.id}
                                labor={l}
                                selected={!!selectedLaborRates[l.id]}
                                quantity={selectedLaborRates[l.id]?.quantity ?? 1}
                                details={selectedLaborRates[l.id]?.details ?? ''}
                                onToggle={() => toggleLaborRate(l)}
                                onQty={d => setLaborQty(l.id, d)}
                                onSetQty={q => setLaborExactQty(l.id, q)}
                                onSetDetails={d => setLaborDetails(l.id, d)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Séparateur matériaux / prestations */}
              {(articleMaterialGroups.length > 0 || serviceMaterialGroups.length > 0 || laborRateGroups.length > 0) && filteredPrestationGroups.length > 0 && (
                <div className="h-px bg-gray-100" />
              )}

              {/* ── Prestations par catégorie ── */}
              {filteredPrestationGroups.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider px-1">
                    {catalogContext.labelSet.bundleTemplate.plural}
                  </p>
                  {filteredPrestationGroups.map(group => {
                    const key = `prestations-${group.label}`
                    const selCount = group.items.filter(pt => !!selectedPrestations[pt.id]).length
                    const isOpen = !!step2Q || selCount > 0 || expandedCategories.has(key)
                    return (
                      <div key={group.label} className="rounded-xl border border-gray-200 overflow-hidden bg-white">
                        <button
                          type="button"
                          onClick={() => toggleCategory(key)}
                          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <span className="text-sm font-semibold text-gray-700 truncate">{group.label}</span>
                            {selCount > 0 && (
                              <span className="flex-shrink-0 text-[11px] font-bold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
                                {selCount}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0 text-gray-400">
                            <span className="text-xs hidden sm:block">{group.items.length}&nbsp;{group.items.length > 1 ? 'prestations' : 'prestation'}</span>
                            {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </button>
                        {isOpen && (
                          <div className="px-3 pb-3 pt-1 space-y-3 border-t border-gray-100">
                            {group.items.map(pt => (
                              <PrestationCard
                                key={pt.id}
                                pt={pt}
                                selected={!!selectedPrestations[pt.id]}
                                data={selectedPrestations[pt.id]}
                                onToggle={() => togglePrestation(pt)}
                                onLineQty={(lineId, d) => setPrestationLineQty(pt.id, lineId, d)}
                                onLineSetQty={(lineId, q) => setPrestationLineExactQty(pt.id, lineId, q)}
                                onLineSetDetails={(lineId, d) => setPrestationLineDetails(pt.id, lineId, d)}
                                onLineSetLength={(lineId, v) => setPrestationLineLength(pt.id, lineId, v)}
                                onLineSetWidth={(lineId, v) => setPrestationLineWidth(pt.id, lineId, v)}
                                onLineSetHeight={(lineId, v) => setPrestationLineHeight(pt.id, lineId, v)}
                                onLineRemove={lineId => removePrestationLine(pt.id, lineId)}
                                onLineAdd={line => addPrestationLine(pt.id, line)}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Message si rien n'est configuré ET mode sur-mesure désactivé */}
              {!hasCatalog && !customModeEnabled && (
                <div className="text-center py-6 space-y-2">
                  <p className="text-sm text-gray-500">{catalogContext.labelSet.bundleTemplate.emptyLabel}.</p>
                  <p className="text-xs text-gray-400">L&apos;entreprise configurera bientôt les {catalogContext.labelSet.bundleTemplate.plural.toLowerCase()} disponibles.</p>
                </div>
              )}

              {/* Description libre */}
              {(customModeEnabled || !hasCatalog) && (
                <div className="space-y-2">
                  {hasCatalog && <div className="h-px bg-gray-100" />}
                  <label className="text-xs font-bold text-gray-400 uppercase tracking-wider block">
                    {hasCatalog ? 'Autre besoin' : 'Description du projet'}
                  </label>
                  <textarea
                    rows={4}
                    value={freeDescription}
                    onChange={e => setFreeDescription(e.target.value)}
                    className={`${inputCls} resize-none`}
                    placeholder="Décrivez votre besoin : type de travaux, dimensions, contraintes, délais souhaités..."
                  />
                </div>
              )}

              {step2Error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{step2Error}</p>
              )}
            </>
          )}

          {/* ── ÉTAPE 3 : Le chantier ── */}
          {step === 3 && (
            <>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Le chantier</h2>
                <p className="text-sm text-gray-400 mt-1">Tout est optionnel — renseignez ce qui est pertinent.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-sm font-semibold text-gray-700">Adresse du chantier</label>
                  <input type="text" value={chantierAddress} onChange={e => setChantierAddress(e.target.value)} className={inputCls} placeholder="12 rue des Artisans" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-sm font-semibold text-gray-700">Code postal</label>
                    <input type="text" value={chantierPostalCode} onChange={e => setChantierPostalCode(e.target.value)} className={inputCls} placeholder="75001" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-semibold text-gray-700">Ville</label>
                    <input type="text" value={chantierCity} onChange={e => setChantierCity(e.target.value)} className={inputCls} placeholder="Paris" />
                  </div>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Informations complémentaires</label>
                <textarea
                  rows={3}
                  value={extraNotes}
                  onChange={e => setExtraNotes(e.target.value)}
                  className={`${inputCls} resize-none`}
                  placeholder="Contraintes d'accès, délais souhaités, précisions techniques..."
                />
              </div>

              {/* Fichier joint */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">Fichier joint (optionnel)</label>
                <p className="text-xs text-gray-400">Photo, plan, PDF — 10 Mo max</p>
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className={`flex items-center gap-3 p-4 rounded-xl border-2 border-dashed cursor-pointer transition-all ${
                    attachmentFile
                      ? 'border-green-400 bg-green-50'
                      : 'border-gray-200 hover:border-blue-300 hover:bg-blue-50/50'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.webp,.dwg,.dxf"
                    onChange={handleFileChange}
                  />
                  {isUploading ? (
                    <><Loader2 className="w-5 h-5 text-blue-500 animate-spin" /><span className="text-sm text-blue-600">Upload en cours...</span></>
                  ) : attachmentFile ? (
                    <>
                      <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                      <span className="text-sm text-green-700 font-medium flex-1 truncate">{attachmentFile.name}</span>
                      <button type="button" onClick={e => { e.stopPropagation(); setAttachmentFile(null); setAttachmentUrl(null); setAttachmentMeta(null) }}
                        className="text-gray-400 hover:text-red-500 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </>
                  ) : (
                    <><Paperclip className="w-5 h-5 text-gray-400" /><span className="text-sm text-gray-400">Cliquez pour joindre un fichier</span></>
                  )}
                </div>
              </div>
            </>
          )}

          {/* ── ÉTAPE 4 : Récapitulatif ── */}
          {step === 4 && (
            <>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Récapitulatif</h2>
                <p className="text-sm text-gray-400 mt-1">Vérifiez vos informations avant d&apos;envoyer.</p>
              </div>

              <div className="rounded-2xl border border-gray-200 divide-y divide-gray-100 overflow-hidden">
                {recapItems.map(item => (
                  <div key={item.label} className="flex gap-4 px-4 py-3">
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-wider w-28 flex-shrink-0 pt-0.5">{item.label}</span>
                    <span className="text-sm text-gray-800 break-words">{item.value}</span>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-400 text-center">
                Vos données sont transmises uniquement à <strong>{orgName}</strong> et ne sont pas partagées avec des tiers.
              </p>

              {submitError && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{submitError}</p>
              )}
            </>
          )}

          {/* Champ honeypot anti-bot — invisible aux humains, ne pas toucher */}
          <div aria-hidden="true" style={{ position: 'absolute', left: '-9999px', opacity: 0, pointerEvents: 'none', tabIndex: -1 } as React.CSSProperties}>
            <label htmlFor="_hp_website">Ne pas remplir ce champ</label>
            <input
              id="_hp_website"
              type="text"
              value={honeypot}
              onChange={e => setHoneypot(e.target.value)}
              autoComplete="off"
              tabIndex={-1}
            />
          </div>

          {/* ── Navigation ── */}
          <div className={`flex gap-3 pt-2 ${step === 1 ? 'justify-end' : 'justify-between'}`}>
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                disabled={isPending}
                className="flex items-center gap-2 px-5 py-3 rounded-xl border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50 transition-all disabled:opacity-50"
              >
                <ChevronLeft className="w-4 h-4" /> Précédent
              </button>
            )}

            {step < 4 ? (
              <button
                type="button"
                onClick={goNext}
                className="flex items-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-all shadow-md shadow-blue-600/20"
              >
                Suivant <ChevronRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending || isUploading}
                className="flex items-center gap-2 px-8 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold transition-all shadow-md shadow-blue-600/20 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Envoi...</> : 'Envoyer ma demande'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
