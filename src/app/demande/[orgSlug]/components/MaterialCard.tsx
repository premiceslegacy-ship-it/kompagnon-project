'use client'

import { formatPublicUnit } from '@/lib/catalog-pricing'
import { Field } from '@/components/ui/Field'
import { ListGroup } from '@/components/ui/ListGroup'
import { DimensionInput } from './DimensionInput'
import { getDimensionFieldMeta, getDimensionMode } from './helpers'
import type { SelectedMaterial } from './types'

const AREA_UNITS = { linear: 'm', area: 'm²', volume: 'm³' } as const

/** Réglages d'un élément du catalogue choisi : quantité ou cotes, nombre et précisions. */
export function MaterialCard({
  material, kindLabel, onSetQty, onSetDimensionCount, onSetDetails, onSetLength, onSetWidth, onSetHeight,
}: {
  material: SelectedMaterial
  kindLabel: string
  onSetQty: (q: number) => void
  onSetDimensionCount: (q: number) => void
  onSetDetails: (v: string) => void
  onSetLength: (v: number | null) => void
  onSetWidth: (v: number | null) => void
  onSetHeight: (v: number | null) => void
}) {
  const dimensionMode = getDimensionMode(material.dimension_pricing_mode, material.dimension_pricing_enabled)
  const lengthMeta = getDimensionFieldMeta(material.dimension_schema, 'length', dimensionMode)
  const widthMeta = getDimensionFieldMeta(material.dimension_schema, 'width', dimensionMode)
  const heightMeta = getDimensionFieldMeta(material.dimension_schema, 'height', dimensionMode)
  const unit = material.unit ? formatPublicUnit(material.unit) : null
  const computed = dimensionMode !== 'none'
    ? `Quantité calculée : ${material.quantity.toFixed(2)} ${AREA_UNITS[dimensionMode]}`
    : undefined

  return (
    <ListGroup title={`${material.name} · ${kindLabel}`} headingLevel={3} description={computed}>
      {dimensionMode !== 'none' ? (
        <>
          <li className="border-b border-trait">
            <DimensionInput label={lengthMeta.label} valueM={material.length_m} fallbackM={material.base_length_m} unit={lengthMeta.unit} onValueM={onSetLength} />
          </li>
          {(dimensionMode === 'area' || dimensionMode === 'volume' || widthMeta.enabled) && (
            <li className="border-b border-trait">
              <DimensionInput label={widthMeta.label} valueM={material.width_m} fallbackM={material.base_width_m} unit={widthMeta.unit} onValueM={onSetWidth} />
            </li>
          )}
          {(dimensionMode === 'volume' || heightMeta.enabled) && (
            <li className="border-b border-trait">
              <DimensionInput label={heightMeta.label} valueM={material.height_m} fallbackM={material.base_height_m} unit={heightMeta.unit} onValueM={onSetHeight} />
            </li>
          )}
          <li className="border-b border-trait">
            <Field type="number" label="Nombre" value={material.dimension_count || 1} min={1} decimals={0} onChange={v => onSetDimensionCount(Math.max(1, v ?? 1))} />
          </li>
        </>
      ) : (
        <li className="border-b border-trait">
          <Field type="number" label={unit ? `Quantité (${unit})` : 'Quantité'} value={material.quantity || 1} min={1} decimals={0} onChange={v => onSetQty(Math.max(1, v ?? 1))} />
        </li>
      )}
      <li>
        <Field type="text" label="Précisions" value={material.details ?? ''} placeholder="Utiles pour le devis (facultatif)" onChange={e => onSetDetails(e.currentTarget.value)} />
      </li>
    </ListGroup>
  )
}
