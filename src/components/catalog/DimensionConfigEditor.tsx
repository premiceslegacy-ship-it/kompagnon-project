'use client'
// @atelier-migrated

import { useMemo, useState } from 'react'
import type {
  DimensionAxisKey,
  DimensionDisplayUnit,
  DimensionFieldRole,
  DimensionPricingMode,
} from '@/lib/catalog-pricing'
import type { DimensionEditorLabels } from '@/lib/catalog-ui'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { CheckRow, ListGroup } from '@/components/ui/ListGroup'
import styles from '@/app/(app)/finances/quote-editor/QuoteEditor.module.css'

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
  const [showVariants, setShowVariants] = useState(false)
  const enabledAxes = AXES.filter((axis) => schema[axis].enabled)
  const visibleAxes = useMemo(() => (
    AXES.filter((axis) => AXIS_MODE_REQUIRED[axis].includes(mode) || schema[axis].enabled)
  ), [mode, schema])

  if (mode === 'none') return null

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
    <div className={styles.detail}>
      <p className={styles.hint} style={{ marginTop: 0 }}>{labels.schemaHelp}</p>

      {visibleAxes.map((axis) => {
        const axisState = schema[axis]
        const requiredByMode = AXIS_MODE_REQUIRED[axis].includes(mode)
        return (
          <ListGroup
            key={axis}
            title={axisState.label || axis}
            description={requiredByMode ? 'Utilisé dans le calcul.' : 'Facultatif.'}
          >
            <CheckRow
              title="Actif"
              checked={requiredByMode ? true : axisState.enabled}
              disabled={requiredByMode}
              onCheckedChange={enabled => patchAxis(axis, { enabled })}
            />
            <li style={{ listStyle: 'none' }}>
              <div className={styles.fields}>
                <Field type="text" label="Libellé" value={axisState.label} onChange={e => patchAxis(axis, { label: e.target.value })} />
                <Field type="select" label="Unité" value={axisState.unit} onChange={e => patchAxis(axis, { unit: e.target.value as DimensionDisplayUnit })}>
                  <option value="m">m</option>
                  <option value="cm">cm</option>
                  <option value="mm">mm</option>
                </Field>
                <Field type="select" label="Rôle" value={axisState.role} onChange={e => patchAxis(axis, { role: e.target.value as DimensionFieldRole })}>
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </Field>
              </div>
            </li>
          </ListGroup>
        )
      })}

      <div className={styles.detail}>
        <p className={styles.hint} style={{ marginTop: 0 }}>
          <strong>Variantes de prix</strong> (avancé). {labels.variantExampleHelp}
        </p>
        <div className={styles.inline}>
          <Button variant="secondary" size="md" onClick={() => setShowVariants(prev => !prev)}>
            {showVariants ? 'Masquer les variantes' : 'Afficher les variantes'}
          </Button>
          <Button variant="secondary" size="md" onClick={() => { setShowVariants(true); addVariant() }}>
            Ajouter une variante
          </Button>
        </div>

        {!showVariants ? (
          <p className={styles.hint} style={{ marginTop: 0 }}>{labels.variantMaskedHelp}</p>
        ) : variants.length === 0 ? (
          <p className={styles.hint} style={{ marginTop: 0 }}>Aucune variante. Le prix de base sera utilisé.</p>
        ) : (
          variants.map((variant, index) => (
            <div key={variant.id} className={styles.detail}>
              <div className={styles.fields}>
                <Field type="text" label={`Variante ${index + 1}`} placeholder="Libellé" value={variant.label} onChange={e => patchVariant(variant.id, { label: e.target.value })} />
                {enabledAxes.map((axis) => (
                  <Field
                    key={axis}
                    type="text"
                    inputMode="decimal"
                    label={`${schema[axis].label} (${schema[axis].unit})`}
                    value={variant[axis]}
                    onChange={e => patchVariant(variant.id, { [axis]: e.target.value } as Partial<EditableVariantState>)}
                  />
                ))}
                <Field type="text" inputMode="decimal" label="Achat HT" value={variant.purchase_price} onChange={e => patchVariant(variant.id, { purchase_price: e.target.value })} />
                <Field type="text" inputMode="decimal" label="Vente HT" value={variant.sale_price} onChange={e => patchVariant(variant.id, { sale_price: e.target.value })} />
                <Field type="text" label="Référence" value={variant.reference_suffix} onChange={e => patchVariant(variant.id, { reference_suffix: e.target.value })} />
              </div>
              <ListGroup>
                <CheckRow title="Variante par défaut" checked={variant.is_default} onCheckedChange={() => patchVariant(variant.id, { is_default: true })} />
              </ListGroup>
              <div className={styles.inline}>
                <Button variant="destructive" size="md" onClick={() => removeVariant(variant.id)}>Supprimer cette variante</Button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
