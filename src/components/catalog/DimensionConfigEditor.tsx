'use client'

import React, { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import type {
  DimensionAxisKey,
  DimensionDisplayUnit,
  DimensionFieldRole,
  DimensionPricingMode,
} from '@/lib/catalog-pricing'
import type { DimensionEditorLabels } from '@/lib/catalog-ui'

export type EditableDimensionSchemaState = Record<DimensionAxisKey, {
  enabled: boolean
  label: string
  unit: DimensionDisplayUnit
  role: DimensionFieldRole
}>

export type EditableVariantState = {
  id: string
  label: string
  reference_suffix: string
  length: string
  width: string
  height: string
  sale_price: string
  purchase_price: string
  is_default: boolean
}

const AXES: DimensionAxisKey[] = ['length', 'width', 'height']

const ROLE_LABELS: Record<DimensionFieldRole, string> = {
  pricing_axis: 'Calcul',
  display_only: 'Affichage',
  variant_key: 'Variante',
}

const AXIS_MODE_REQUIRED: Record<DimensionAxisKey, DimensionPricingMode[]> = {
  length: ['linear', 'area', 'volume'],
  width: ['area', 'volume'],
  height: ['volume'],
}

type Props = {
  mode: DimensionPricingMode
  schema: EditableDimensionSchemaState
  variants: EditableVariantState[]
  labels: DimensionEditorLabels
  onSchemaChange: (schema: EditableDimensionSchemaState) => void
  onVariantsChange: (variants: EditableVariantState[]) => void
}

export default function DimensionConfigEditor({
  mode,
  schema,
  variants,
  labels,
  onSchemaChange,
  onVariantsChange,
}: Props) {
  if (mode === 'none') return null

  const [showVariants, setShowVariants] = useState(false)
  const enabledAxes = AXES.filter((axis) => schema[axis].enabled)
  const visibleAxes = useMemo(() => (
    AXES.filter((axis) => AXIS_MODE_REQUIRED[axis].includes(mode) || schema[axis].enabled)
  ), [mode, schema])

  function patchAxis(axis: DimensionAxisKey, patch: Partial<EditableDimensionSchemaState[DimensionAxisKey]>) {
    onSchemaChange({
      ...schema,
      [axis]: { ...schema[axis], ...patch },
    })
  }

  function patchVariant(id: string, patch: Partial<EditableVariantState>) {
    onVariantsChange(variants.map((variant) => {
      if (variant.id !== id) return variant
      if (patch.is_default) {
        return { ...variant, ...patch, is_default: true }
      }
      return { ...variant, ...patch }
    }).map((variant) => patch.is_default ? { ...variant, is_default: variant.id === id } : variant))
  }

  function addVariant() {
    onVariantsChange([
      ...variants,
      {
        id: Math.random().toString(36).slice(2),
        label: '',
        reference_suffix: '',
        length: '',
        width: '',
        height: '',
        sale_price: '',
        purchase_price: '',
        is_default: variants.length === 0,
      },
    ])
  }

  function removeVariant(id: string) {
    const next = variants.filter((variant) => variant.id !== id)
    if (next.length > 0 && !next.some((variant) => variant.is_default)) {
      next[0] = { ...next[0], is_default: true }
    }
    onVariantsChange(next)
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-secondary">{labels.schemaHelp}</p>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {visibleAxes.map((axis) => {
          const axisState = schema[axis]
          const requiredByMode = AXIS_MODE_REQUIRED[axis].includes(mode)
          return (
            <div key={axis} className="rounded-xl border border-[var(--elevation-border)] bg-base p-3 dark:bg-white/5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <p className="text-sm font-semibold text-primary">{axisState.label || axis}</p>
                  <p className="text-xs text-secondary">{requiredByMode ? 'Utilise dans le calcul.' : 'Optionnel.'}</p>
                </div>
                <label className="flex items-center gap-2 text-xs font-semibold text-secondary">
                  <input
                    type="checkbox"
                    checked={requiredByMode ? true : axisState.enabled}
                    disabled={requiredByMode}
                    onChange={e => patchAxis(axis, { enabled: e.target.checked })}
                    className="accent-[var(--accent)]"
                  />
                  Actif
                </label>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <input
                  type="text"
                  value={axisState.label}
                  onChange={e => patchAxis(axis, { label: e.target.value })}
                  placeholder="Libellé"
                  className="w-full px-3 py-2 rounded-lg bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-primary text-sm outline-none focus:border-accent"
                />
                <select
                  value={axisState.unit}
                  onChange={e => patchAxis(axis, { unit: e.target.value as DimensionDisplayUnit })}
                  className="w-full px-3 py-2 rounded-lg bg-base dark:bg-white/5 dark:[color-scheme:dark] border border-[var(--elevation-border)] text-primary text-sm outline-none focus:border-accent appearance-none"
                >
                  <option value="m">m</option>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </select>
                <select
                  value={axisState.role}
                  onChange={e => patchAxis(axis, { role: e.target.value as DimensionFieldRole })}
                  className="w-full px-3 py-2 rounded-lg bg-base dark:bg-white/5 dark:[color-scheme:dark] border border-[var(--elevation-border)] text-primary text-sm outline-none focus:border-accent appearance-none"
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
            </div>
          )
        })}
      </div>

      <div className="rounded-xl border border-[var(--elevation-border)] bg-base p-4 space-y-3 dark:bg-white/5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-primary">Variantes de prix <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-secondary/10 text-secondary">Avancé</span></p>
            <p className="text-xs text-secondary">{labels.variantExampleHelp}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowVariants((prev) => !prev)}
              className="px-3 py-2 rounded-lg text-xs font-semibold border border-[var(--elevation-border)] text-primary hover:border-accent hover:text-accent transition-colors"
            >
              {showVariants ? 'Masquer' : 'Afficher'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowVariants(true)
                addVariant()
              }}
              className="px-3 py-2 rounded-lg text-xs font-bold bg-accent text-black flex items-center gap-1.5"
            >
              <Plus className="w-3.5 h-3.5" />
              Ajouter
            </button>
          </div>
        </div>

        {!showVariants ? (
          <p className="text-xs text-secondary">{labels.variantMaskedHelp}</p>
        ) : variants.length === 0 ? (
          <p className="text-xs text-secondary">Aucune variante. Le prix de base sera utilise.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-secondary">
                  <th className="py-2 pr-3">Libellé</th>
                  {enabledAxes.map((axis) => (
                    <th key={axis} className="py-2 pr-3">{schema[axis].label} ({schema[axis].unit})</th>
                  ))}
                  <th className="py-2 pr-3">Achat HT</th>
                  <th className="py-2 pr-3">Vente HT</th>
                  <th className="py-2 pr-3">Ref.</th>
                  <th className="py-2 pr-3">Défaut</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {variants.map((variant) => (
                  <tr key={variant.id}>
                    <td className="py-2 pr-3">
                      <input value={variant.label} onChange={e => patchVariant(variant.id, { label: e.target.value })} className="w-full px-2 py-1.5 rounded-lg bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-primary text-sm outline-none focus:border-accent" />
                    </td>
                    {enabledAxes.map((axis) => (
                      <td key={axis} className="py-2 pr-3">
                        <input
                          type="number"
                          step="0.001"
                          value={variant[axis]}
                          onChange={e => patchVariant(variant.id, { [axis]: e.target.value } as Partial<EditableVariantState>)}
                          className="w-24 px-2 py-1.5 rounded-lg bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-primary text-sm outline-none focus:border-accent"
                        />
                      </td>
                    ))}
                    <td className="py-2 pr-3">
                      <input type="number" step="0.01" value={variant.purchase_price} onChange={e => patchVariant(variant.id, { purchase_price: e.target.value })} className="w-24 px-2 py-1.5 rounded-lg bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-primary text-sm outline-none focus:border-accent" />
                    </td>
                    <td className="py-2 pr-3">
                      <input type="number" step="0.01" value={variant.sale_price} onChange={e => patchVariant(variant.id, { sale_price: e.target.value })} className="w-24 px-2 py-1.5 rounded-lg bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-primary text-sm outline-none focus:border-accent" />
                    </td>
                    <td className="py-2 pr-3">
                      <input value={variant.reference_suffix} onChange={e => patchVariant(variant.id, { reference_suffix: e.target.value })} className="w-24 px-2 py-1.5 rounded-lg bg-base dark:bg-white/5 border border-[var(--elevation-border)] text-primary text-sm outline-none focus:border-accent" />
                    </td>
                    <td className="py-2 pr-3 text-center">
                      <input type="radio" checked={variant.is_default} onChange={() => patchVariant(variant.id, { is_default: true })} className="accent-[var(--accent)]" />
                    </td>
                    <td className="py-2 text-right">
                      <button type="button" onClick={() => removeVariant(variant.id)} className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/10">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
