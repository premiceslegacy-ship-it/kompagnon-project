'use client'

import { Minus, Package, Plus } from 'lucide-react'
import { formatPublicUnit } from '@/lib/catalog-pricing'
import styles from '../demande.module.css'
import { DimensionInput } from './DimensionInput'
import { getDimensionFieldMeta, getDimensionMode } from './helpers'
import type { PublicMaterial } from './types'

export function MaterialCard({
  material, selected, quantity, dimensionCount, details, lengthM, widthM, heightM, itemKindLabel, onToggle, onQty, onSetQty, onSetDimensionCount, onSetDetails, onSetLength, onSetWidth, onSetHeight,
}: {
  material: PublicMaterial
  selected: boolean
  quantity: number
  dimensionCount: number
  details: string
  lengthM: number | null
  widthM: number | null
  heightM: number | null
  itemKindLabel: string
  onToggle: () => void
  onQty: (d: number) => void
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

  return (
    <div
      onClick={onToggle}
      className={`${styles.itemCard} ${selected ? styles.itemCardSelected : ''}`}
    >
      <div className={styles.itemHead}>
        <div className={`${styles.itemIcon} ${selected ? styles.itemIconSelected : ''}`}>
          <Package />
        </div>
        <div className={`${styles.itemCheck} ${selected ? styles.itemCheckSelected : ''}`}>
          {selected && (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
        <div className={styles.itemBody}>
          <p className={styles.itemName}>{material.name}</p>
          <div className={styles.itemMeta}>
            {material.unit && <span className={styles.itemMetaText}>{formatPublicUnit(material.unit)}</span>}
            <span className={styles.itemMetaText}>{itemKindLabel}</span>
          </div>
        </div>
      </div>
      {material.description && (
        <p className={styles.itemDescription}>{material.description}</p>
      )}

      {selected && (
        <div className={styles.itemDetail} onClick={e => e.stopPropagation()}>
          {dimensionMode !== 'none' ? (
            <div className={styles.dimensionGrid}>
              <label className={styles.dimensionField}>
                {lengthMeta.label} ({lengthMeta.unit})
                <DimensionInput valueM={lengthM} fallbackM={material.base_length_m} unit={lengthMeta.unit} onValueM={onSetLength} className={styles.dimensionInput} />
              </label>
              {(dimensionMode === 'area' || dimensionMode === 'volume' || widthMeta.enabled) && (
                <label className={styles.dimensionField}>
                  {widthMeta.label} ({widthMeta.unit})
                  <DimensionInput valueM={widthM} fallbackM={material.base_width_m} unit={widthMeta.unit} onValueM={onSetWidth} className={styles.dimensionInput} />
                </label>
              )}
              {(dimensionMode === 'volume' || heightMeta.enabled) && (
                <label className={styles.dimensionField}>
                  {heightMeta.label} ({heightMeta.unit})
                  <DimensionInput valueM={heightM} fallbackM={material.base_height_m} unit={heightMeta.unit} onValueM={onSetHeight} className={styles.dimensionInput} />
                </label>
              )}
              <div className={styles.computedQty}>
                Quantité calculée : {quantity.toFixed(2)} {dimensionMode === 'linear' ? 'm' : dimensionMode === 'area' ? 'm²' : 'm³'}
              </div>
              <div className={styles.counterRow}>
                <span className={styles.counterLabel}>Nombre</span>
                <div className={styles.counter}>
                  <button type="button" onClick={() => onSetDimensionCount(Math.max(1, dimensionCount - 1))} className={styles.counterBtn}>
                    <Minus />
                  </button>
                  <input
                    type="number"
                    min="1"
                    value={dimensionCount || 1}
                    onChange={e => {
                      const val = parseInt(e.target.value)
                      if (!isNaN(val)) onSetDimensionCount(Math.max(1, val))
                    }}
                    className={styles.counterInput}
                  />
                  <button type="button" onClick={() => onSetDimensionCount(dimensionCount + 1)} className={styles.counterBtn}>
                    <Plus />
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.counter} style={{ alignSelf: 'flex-end' }}>
              <button type="button" onClick={() => onQty(-1)} className={styles.counterBtn}>
                <Minus />
              </button>
              <input
                type="number"
                min="1"
                value={quantity || 1}
                onChange={e => {
                  const val = parseInt(e.target.value)
                  if (!isNaN(val)) onSetQty(Math.max(1, val))
                }}
                className={styles.counterInput}
              />
              <button type="button" onClick={() => onQty(+1)} className={styles.counterBtn}>
                <Plus />
              </button>
            </div>
          )}
          <input type="text" value={details} onChange={e => onSetDetails(e.target.value)} placeholder="Précisions utiles pour le devis..." className={`${styles.input} ${styles.detailInput}`} />
        </div>
      )}
    </div>
  )
}
