'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Layers, Minus, Plus, X } from 'lucide-react'
import styles from '../demande.module.css'
import { DimensionInput } from './DimensionInput'
import { getDimensionFieldMeta } from './helpers'
import type { PrestationLine, PublicPrestationType, SelectedPrestation } from './types'

export function PrestationCard({
  pt, selected, data, onToggle, onLineQty, onLineSetQty, onLineSetDimensionCount, onLineSetDetails, onLineSetLength, onLineSetWidth, onLineSetHeight, onLineRemove, onLineAdd,
}: {
  pt: PublicPrestationType
  selected: boolean
  data: SelectedPrestation | undefined
  onToggle: () => void
  onLineQty: (lineId: string, d: number) => void
  onLineSetQty: (lineId: string, q: number) => void
  onLineSetDimensionCount: (lineId: string, q: number) => void
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
    <div className={`${styles.prestationCard} ${selected ? styles.prestationCardSelected : ''}`}>
      {/* Header */}
      <div className={styles.prestationHead} onClick={handleToggle}>
        <div className={`${styles.prestationIcon} ${selected ? styles.prestationIconSelected : ''}`}>
          <Layers />
        </div>
        <div className={`${styles.itemCheck} ${selected ? styles.itemCheckSelected : ''}`}>
          {selected && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className={styles.itemBody}>
          <p className={styles.prestationName}>{pt.name}</p>
          {pt.category && <p className={styles.prestationCategory}>{pt.category}</p>}
        </div>
        {selected && (
          <button
            type="button"
            onClick={e => { e.stopPropagation(); setExpanded(v => !v) }}
            className={styles.prestationExpandBtn}
          >
            {expanded ? 'Réduire' : 'Modifier'}
            {expanded ? <ChevronUp /> : <ChevronDown />}
          </button>
        )}
      </div>

      {/* Description et lignes (quand sélectionné + expandé) */}
      {selected && expanded && (
        <div className={styles.prestationBody} onClick={e => e.stopPropagation()}>
          {pt.description && (
            <p className={styles.prestationDescription}>{pt.description}</p>
          )}

          {lines.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <p className={styles.prestationSectionLabel}>Éléments inclus</p>
              {lines.map(line => {
                const lengthMeta = getDimensionFieldMeta(line.dimension_schema, 'length', line.dimension_pricing_mode)
                const widthMeta = getDimensionFieldMeta(line.dimension_schema, 'width', line.dimension_pricing_mode)
                const heightMeta = getDimensionFieldMeta(line.dimension_schema, 'height', line.dimension_pricing_mode)
                const lineDimensionCount = line.dimension_count ?? 1
                return (
                  <div key={line.id} className={styles.prestationLine}>
                    <div className={styles.prestationLineHead}>
                      <span className={styles.prestationLineName}>{line.designation}</span>
                      {line.dimension_pricing_mode !== 'none' ? (
                        <span className={styles.prestationLineQty}>
                          {line.quantity.toFixed(2)} {line.dimension_pricing_mode === 'linear' ? 'm' : line.dimension_pricing_mode === 'area' ? 'm²' : 'm³'}
                        </span>
                      ) : (
                        <div className={styles.counter}>
                          <button type="button" onClick={() => onLineQty(line.id, -1)} className={styles.counterBtn}>
                            <Minus />
                          </button>
                          <input
                            type="number" min="1" value={line.quantity || 1}
                            onChange={e => {
                              const val = parseInt(e.target.value)
                              if (!isNaN(val)) onLineSetQty(line.id, Math.max(1, val))
                            }}
                            className={styles.counterInput}
                          />
                          <span className={styles.counterUnit}>{line.unit}</span>
                          <button type="button" onClick={() => onLineQty(line.id, +1)} className={styles.counterBtn}>
                            <Plus />
                          </button>
                        </div>
                      )}
                      {line.isCustom && (
                        <button type="button" onClick={() => onLineRemove(line.id)} className={styles.prestationRemove}>
                          <X />
                        </button>
                      )}
                    </div>
                    {line.dimension_pricing_mode !== 'none' && (
                      <div className={styles.dimensionGrid}>
                        <DimensionInput valueM={line.length_m} fallbackM={line.base_length_m} unit={lengthMeta.unit} onValueM={value => onLineSetLength(line.id, value)} placeholder={`${lengthMeta.label} (${lengthMeta.unit})`} className={styles.dimensionInput} />
                        {(line.dimension_pricing_mode === 'area' || line.dimension_pricing_mode === 'volume' || widthMeta.enabled) && (
                          <DimensionInput valueM={line.width_m} fallbackM={line.base_width_m} unit={widthMeta.unit} onValueM={value => onLineSetWidth(line.id, value)} placeholder={`${widthMeta.label} (${widthMeta.unit})`} className={styles.dimensionInput} />
                        )}
                        {(line.dimension_pricing_mode === 'volume' || heightMeta.enabled) && (
                          <DimensionInput valueM={line.height_m} fallbackM={line.base_height_m} unit={heightMeta.unit} onValueM={value => onLineSetHeight(line.id, value)} placeholder={`${heightMeta.label} (${heightMeta.unit})`} className={styles.dimensionInput} />
                        )}
                      </div>
                    )}
                    {line.dimension_pricing_mode !== 'none' && (
                      <div className={styles.counterRow}>
                        <span className={styles.counterLabel}>Nombre</span>
                        <div className={styles.counter}>
                          <button type="button" onClick={() => onLineSetDimensionCount(line.id, Math.max(1, lineDimensionCount - 1))} className={styles.counterBtn}>
                            <Minus />
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={lineDimensionCount}
                            onChange={e => {
                              const val = parseInt(e.target.value)
                              if (!isNaN(val)) onLineSetDimensionCount(line.id, Math.max(1, val))
                            }}
                            className={styles.counterInput}
                          />
                          <button type="button" onClick={() => onLineSetDimensionCount(line.id, lineDimensionCount + 1)} className={styles.counterBtn}>
                            <Plus />
                          </button>
                        </div>
                      </div>
                    )}
                    <input type="text" value={line.details || ''} onChange={e => onLineSetDetails(line.id, e.target.value)} placeholder="Précisions (dimensions...)" className={`${styles.input} ${styles.detailInput}`} />
                  </div>
                )
              })}
            </div>
          )}

          {/* Ajouter une ligne */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p className={styles.addLineLabel}>Ajouter un élément</p>
            <div className={styles.addLineRow}>
              <input
                type="text"
                value={newDesig}
                onChange={e => setNewDesig(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLine())}
                placeholder="Désignation..."
                className={styles.addLineInput}
                style={{ flex: 1 }}
              />
              <input
                type="number"
                value={newQty}
                onChange={e => setNewQty(e.target.value)}
                min={1}
                className={styles.addLineInput}
                style={{ width: 64, textAlign: 'center' }}
              />
              <input
                type="text"
                value={newUnit}
                onChange={e => setNewUnit(e.target.value)}
                placeholder="u"
                className={styles.addLineInput}
                style={{ width: 56, textAlign: 'center' }}
              />
              <button
                type="button"
                onClick={addLine}
                disabled={!newDesig.trim()}
                className={styles.addLineBtn}
              >
                <Plus />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Description courte quand non expandé */}
      {pt.description && !expanded && (
        <p className={styles.prestationDescription} style={{ padding: '0 14px 14px', borderLeft: 'none', fontStyle: 'normal', marginTop: -6 }}>{pt.description}</p>
      )}
    </div>
  )
}
