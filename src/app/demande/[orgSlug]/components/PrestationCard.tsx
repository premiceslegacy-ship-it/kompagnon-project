'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { DimensionInput } from './DimensionInput'
import { getDimensionFieldMeta } from './helpers'
import type { PrestationLine, PublicPrestationType, SelectedPrestation } from './types'

const AREA_UNITS = { linear: 'm', area: 'm²', volume: 'm³' } as const

/** Réglages d'un ensemble choisi : éléments inclus, quantités, cotes, précisions, lignes ajoutées. */
export function PrestationCard({
  pt, data, onLineSetQty, onLineSetDimensionCount, onLineSetDetails, onLineSetLength, onLineSetWidth, onLineSetHeight, onLineRemove, onLineAdd,
}: {
  pt: PublicPrestationType
  data: SelectedPrestation
  onLineSetQty: (lineId: string, q: number) => void
  onLineSetDimensionCount: (lineId: string, q: number) => void
  onLineSetDetails: (lineId: string, d: string) => void
  onLineSetLength: (lineId: string, length_m: number | null) => void
  onLineSetWidth: (lineId: string, width_m: number | null) => void
  onLineSetHeight: (lineId: string, height_m: number | null) => void
  onLineRemove: (lineId: string) => void
  onLineAdd: (line: PrestationLine) => void
}) {
  const [newDesig, setNewDesig] = useState('')
  const [newQty, setNewQty] = useState<number | null>(1)
  const [newUnit, setNewUnit] = useState('u')

  function addLine() {
    if (!newDesig.trim()) return
    onLineAdd({
      id: `custom-${Date.now()}`,
      item_type: 'free',
      material_id: null,
      labor_rate_id: null,
      designation: newDesig.trim(),
      quantity: Math.max(1, Math.round(newQty ?? 1)),
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
    setNewQty(1)
    setNewUnit('u')
  }

  return (
    <>
      {data.lines.map((line, index) => {
        const mode = line.dimension_pricing_mode
        const lengthMeta = getDimensionFieldMeta(line.dimension_schema, 'length', mode)
        const widthMeta = getDimensionFieldMeta(line.dimension_schema, 'width', mode)
        const heightMeta = getDimensionFieldMeta(line.dimension_schema, 'height', mode)
        return (
          <ListGroup
            key={line.id}
            headingLevel={3}
            title={index === 0 ? `${pt.name} · ${line.designation}` : line.designation}
            description={mode !== 'none' ? `Quantité calculée : ${line.quantity.toFixed(2)} ${AREA_UNITS[mode]}` : undefined}
            action={line.isCustom ? <Button variant="text" size="sm" onClick={() => onLineRemove(line.id)}>Retirer</Button> : undefined}
          >
            {mode !== 'none' ? (
              <>
                <li className="border-b border-trait">
                  <DimensionInput label={lengthMeta.label} valueM={line.length_m} fallbackM={line.base_length_m} unit={lengthMeta.unit} onValueM={v => onLineSetLength(line.id, v)} />
                </li>
                {(mode === 'area' || mode === 'volume' || widthMeta.enabled) && (
                  <li className="border-b border-trait">
                    <DimensionInput label={widthMeta.label} valueM={line.width_m} fallbackM={line.base_width_m} unit={widthMeta.unit} onValueM={v => onLineSetWidth(line.id, v)} />
                  </li>
                )}
                {(mode === 'volume' || heightMeta.enabled) && (
                  <li className="border-b border-trait">
                    <DimensionInput label={heightMeta.label} valueM={line.height_m} fallbackM={line.base_height_m} unit={heightMeta.unit} onValueM={v => onLineSetHeight(line.id, v)} />
                  </li>
                )}
                <li className="border-b border-trait">
                  <Field type="number" label="Nombre" value={line.dimension_count ?? 1} min={1} decimals={0} onChange={v => onLineSetDimensionCount(line.id, Math.max(1, v ?? 1))} />
                </li>
              </>
            ) : (
              <li className="border-b border-trait">
                <Field type="number" label={`Quantité (${line.unit})`} value={line.quantity || 1} min={1} decimals={0} onChange={v => onLineSetQty(line.id, Math.max(1, v ?? 1))} />
              </li>
            )}
            <li>
              <Field type="text" label="Précisions" value={line.details || ''} placeholder="Dimensions, finitions… (facultatif)" onChange={e => onLineSetDetails(line.id, e.currentTarget.value)} />
            </li>
          </ListGroup>
        )
      })}
      {data.lines.length === 0 && (
        <ListGroup headingLevel={3} title={pt.name}>
          <ListRow title="Aucun élément inclus" description={pt.description ?? undefined} />
        </ListGroup>
      )}
      <ListGroup headingLevel={3} title={`Ajouter un élément à ${pt.name}`}>
        <li className="border-b border-trait">
          <Field type="text" label="Désignation" value={newDesig} placeholder="Par exemple : dépose du meuble" onChange={e => setNewDesig(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addLine() } }} />
        </li>
        <li className="border-b border-trait">
          <Field type="number" label="Quantité" value={newQty} min={1} decimals={0} allowEmpty onChange={setNewQty} />
        </li>
        <li className="border-b border-trait">
          <Field type="text" label="Unité" value={newUnit} placeholder="u" onChange={e => setNewUnit(e.currentTarget.value)} />
        </li>
        <ListRow title="Ajouter l’élément" onClick={addLine} disabled={!newDesig.trim()} />
      </ListGroup>
    </>
  )
}
