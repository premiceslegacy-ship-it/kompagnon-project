'use client'
// @atelier-migrated

import { useState } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import { UnitSelect } from '@/components/ui/UnitSelect'
import { LEGAL_VAT_RATES } from '@/lib/utils'
import { DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'
import {
  displayUnitToMeters,
  getDimensionFieldDefinition,
  metersToDisplayUnit,
} from '@/lib/catalog-pricing'
import { fmt, getItemDimensionMode, getModeUnit } from './quoteEditorModel'
import type { QuoteEditor } from './useQuoteEditor'
import screen from '@/components/layout/Screen.module.css'
import styles from './QuoteEditor.module.css'

type Props = {
  q: QuoteEditor
  sectionId: string
  itemId: string
  onClose: () => void
  onSaveToCatalog: () => void
}

const DIMENSION_MODES = [
  { value: 'none', label: 'Libre' },
  { value: 'linear', label: 'Linéaire' },
  { value: 'area', label: 'Surface' },
  { value: 'volume', label: 'Volume' },
] as const

/** Feuille d'une ligne de devis : les champs principaux, puis « Plus d'options ». */
export function LineSheet({ q, sectionId, itemId, onClose, onSaveToCatalog }: Props) {
  const [dimensionsOpen, setDimensionsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)

  const section = q.sections.find(s => s._tempId === sectionId)
  const item = section?.items.find(i => i._tempId === itemId)
  if (!section || !item) return null

  const change = (field: Parameters<typeof q.handleItemChange>[2], value: string | number | boolean | null) =>
    q.handleItemChange(sectionId, itemId, field, value)

  const isEquipment = q.isEquipmentLine(item)
  const equipmentMeta = isEquipment ? q.parseEquipmentAmortization(item.description, item.unit_price) : null
  const dimensionMode = getItemDimensionMode(item)
  const isDimensioned = dimensionMode !== 'none'
  const canUseDimensions = isDimensioned || item.type === 'custom'
  const sourceMaterial = item.material_id ? q.materials.find(m => m.id === item.material_id) : null
  const lengthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'length', dimensionMode)
  const widthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'width', dimensionMode)
  const heightMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'height', dimensionMode)
  const dimensionUnit = getModeUnit(dimensionMode, item.unit)
  const lineTotal = item.quantity * item.unit_price

  const descParts = item.description.split(/\n\n?Comprend\s*:\s*/i)
  const titleVal = descParts[0] ?? ''
  const detailVal = descParts.length > 1 ? descParts.slice(1).join('\nComprend : ') : ''
  const setTitleValue = (t: string) => change('description', detailVal ? `${t}\n\nComprend :\n${detailVal}` : t)
  const setDetailValue = (d: string) => change('description', d.trim() ? `${titleVal}\n\nComprend :\n${d}` : titleVal)

  const hasMargin = item.unit_cost_ht != null && item.unit_price > 0 && item.quantity > 0
  const margin = hasMargin ? item.quantity * item.unit_price - item.quantity * (item.unit_cost_ht ?? 0) : 0
  const marginPct = hasMargin ? Math.round((margin / (item.quantity * item.unit_price)) * 100) : 0
  const isFreeLine = !item.material_id && !item.labor_rate_id && !isEquipment

  return (
    <>
      <Sheet
        open
        onOpenChange={open => { if (!open) onClose() }}
        title={isEquipment ? 'Équipement amorti' : 'Prestation'}
        cancelLabel="Fermer"
        onConfirm={onClose}
        confirmLabel="OK"
      >
        <div className={styles.detail}>
          <div className={styles.total}>
            <small>Total HT</small>
            <b>{fmt(lineTotal)}</b>
          </div>

          <div className={styles.areas}>
            {isEquipment && equipmentMeta ? (
              <Field
                type="textarea"
                label="Équipement"
                rows={1}
                controlClassName={styles.areaCompact}
                value={equipmentMeta.name}
                placeholder="Nom de l'équipement..."
                onChange={e => q.handleEquipmentAmortizationChange(sectionId, itemId, 'name', e.target.value)}
              />
            ) : (
              <>
                <Field
                  type="textarea"
                  label="Désignation"
                  rows={Math.min(4, Math.max(1, titleVal.split('\n').length))}
                  controlClassName={styles.areaCompact}
                  value={titleVal}
                  placeholder="Désignation..."
                  onChange={e => setTitleValue(e.target.value)}
                />
                <Field
                  type="textarea"
                  label="Détail"
                  rows={detailVal ? Math.min(6, Math.max(2, detailVal.split('\n').length)) : 1}
                  controlClassName={styles.areaCompact}
                  value={detailVal}
                  placeholder="Détail inclus (facultatif)"
                  onChange={e => setDetailValue(e.target.value)}
                />
              </>
            )}
          </div>

          <div className={styles.fields}>
            {!isEquipment && (
              <>
                <Field
                  type="number"
                  label="Quantité"
                  min={0}
                  value={item.quantity}
                  disabled={isDimensioned}
                  onChange={v => change('quantity', v ?? 0)}
                />
                <div className={styles.fieldRow}>
                  <span>Unité</span>
                  <UnitSelect
                    value={item.unit}
                    onChange={v => change('unit', v)}
                    allowedUnits={q.catalogContext.unitSet}
                    compact
                  />
                </div>
                <Field
                  type="number"
                  label="Prix unitaire"
                  min={0}
                  decimals={2}
                  value={item.unit_price}
                  onChange={v => change('unit_price', v ?? 0)}
                  hint={item.price_pending ? 'Prix à valider par le fournisseur' : item.is_estimated ? "Prix estimé par l'IA" : undefined}
                />
                {isFreeLine && (
                  <Field
                    type="number"
                    label="Coût interne"
                    min={0}
                    decimals={2}
                    value={item.unit_cost_ht ?? undefined}
                    placeholder="Coût de revient"
                    onChange={v => change('unit_cost_ht', v ?? null)}
                  />
                )}
              </>
            )}
          </div>

          {hasMargin && !isEquipment && (
            <p className={`${styles.hint} ${margin >= 0 ? styles.up : styles.down}`} style={{ marginTop: -8 }}>
              Marge sur cette ligne : {marginPct}&nbsp;% · {fmt(margin)}
            </p>
          )}
          {!isFreeLine && !isEquipment && item.unit_cost_ht != null && item.unit_price > 0 && (
            <p className={styles.hint} style={{ marginTop: -8 }}>Coût de revient : {fmt(item.unit_cost_ht)}</p>
          )}

          {!isEquipment && (
            <SegmentedControl
              fullWidth
              label="TVA"
              value={String(item.vat_rate)}
              options={LEGAL_VAT_RATES.map(rate => ({ value: String(rate), label: `${String(rate).replace('.', ',')} %` }))}
              onChange={v => change('vat_rate', Number(v))}
            />
          )}

          <ListGroup title="Cette ligne">
            <ListRow
              title="Visible par le client"
              description={isEquipment ? 'Un équipement reste toujours interne' : 'Désactivé, la ligne reste interne et ne figure pas sur le PDF'}
              trailing={
                <Switch
                  label="Visible par le client"
                  checked={!item.is_internal}
                  disabled={isEquipment}
                  onChange={next => { if (!isEquipment) change('is_internal', !next) }}
                />
              }
            />
            {!item.is_internal && (
              <ListRow
                title="Prix à valider par le fournisseur"
                description="Le devis prévient avant l'envoi tant que ce point reste ouvert"
                trailing={
                  <Switch
                    label="Prix à valider par le fournisseur"
                    checked={item.price_pending}
                    onChange={next => {
                      change('price_pending', next)
                      q.scheduleItemSave(sectionId, itemId)
                    }}
                  />
                }
              />
            )}
          </ListGroup>

          {item.is_internal && !isEquipment && (
            <div className={styles.fields}>
              <Field
                type="select"
                label="Catégorie"
                value={item.labor_category ?? ''}
                onChange={e => change('labor_category', e.target.value || null)}
              >
                {q.laborCategoryOptions.map(option => (
                  <option key={option.value || 'main-d-oeuvre'} value={option.value}>{option.label}</option>
                ))}
              </Field>
            </div>
          )}

          {item.transport_prix_l !== null && (
            <div>
              <ListGroup title="Transport interne" description="Coût de revient : il ne figure pas sur le PDF du client.">
                <li className={styles.panel}>
                  <div className={styles.fields}>
                    <Field type="number" label="Distance A/R (km)" min={1} value={item.transport_km}
                      onChange={v => q.handleTransportMetaChange(sectionId, itemId, 'transport_km', v)} />
                    <Field type="number" label="Conso (L/100 km)" min={1} decimals={2}
                      value={item.transport_conso ?? DEFAULT_CONSUMPTION_L_PER_100KM}
                      onChange={v => q.handleTransportMetaChange(sectionId, itemId, 'transport_conso', v ?? DEFAULT_CONSUMPTION_L_PER_100KM)} />
                    <Field type="number" label="Carburant (€/L)" min={0} decimals={3}
                      value={item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L}
                      onChange={v => q.handleTransportMetaChange(sectionId, itemId, 'transport_prix_l', v ?? DEFAULT_FUEL_PRICE_EUR_PER_L)} />
                  </div>
                </li>
                <ListRow
                  title={`${item.quantity.toFixed(2)} L de carburant`}
                  trailing={<span className={styles.amount}>{fmt(item.quantity * (item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L))}</span>}
                />
              </ListGroup>
            </div>
          )}

          {isEquipment && equipmentMeta && (
            <div>
              <ListGroup
                title="Amortissement"
                description="Prix d'achat ÷ usages sur la vie = coût par usage, multiplié par les usages comptés sur cette ligne. Interne, absent du PDF du client."
              >
                <li className={styles.panel}>
                  <div className={styles.fields}>
                    <Field type="number" label="Prix d'achat HT" min={0} decimals={2} placeholder="500"
                      value={equipmentMeta.purchasePrice}
                      onChange={v => q.handleEquipmentAmortizationChange(sectionId, itemId, 'purchasePrice', v)} />
                    <Field type="number" label="Usages sur la vie" min={1} decimals={0} placeholder="100"
                      value={equipmentMeta.lifetimeUses}
                      onChange={v => q.handleEquipmentAmortizationChange(sectionId, itemId, 'lifetimeUses', v)} />
                    <Field type="number" label="Usages comptés" min={0} decimals={2}
                      value={item.quantity}
                      onChange={v => change('quantity', v ?? 0)} />
                  </div>
                </li>
                <ListRow title="Coût par usage" trailing={<span className={styles.amount}>{fmt(item.unit_price)}</span>} />
                <ListRow title="Coût interne total" trailing={<span className={styles.amount}>{fmt(lineTotal)}</span>} />
              </ListGroup>
            </div>
          )}

          {(canUseDimensions || (item.type === 'custom' && !item.material_id && !item.labor_rate_id && !isEquipment)) && (
            <ListGroup title="Plus d'options">
              {canUseDimensions && (
                <ListRow
                  title="Dimensions"
                  description={isDimensioned ? `${item.quantity} ${item.metal_grid_id ? item.unit : dimensionUnit} calculés` : 'Quantité libre'}
                  onClick={() => setDimensionsOpen(true)}
                />
              )}
              {item.type === 'custom' && !item.material_id && !item.labor_rate_id && !isEquipment && (
                <ListRow
                  title="Enregistrer dans le catalogue"
                  description="Pour la retrouver plus tard"
                  onClick={() => { onClose(); onSaveToCatalog() }}
                />
              )}
            </ListGroup>
          )}

          <ListGroup>
            <li className={styles.destructiveRow}>
              <button type="button" onClick={() => setConfirmDelete(true)}>Supprimer la prestation</button>
            </li>
          </ListGroup>
        </div>
      </Sheet>

      <Sheet
        open={dimensionsOpen}
        onOpenChange={setDimensionsOpen}
        title="Dimensions"
        cancelLabel="Retour"
        onConfirm={() => setDimensionsOpen(false)}
        confirmLabel="OK"
      >
        <div className={styles.detail}>
          {item.type === 'custom' && (
            <SegmentedControl
              fullWidth
              label="Tarification"
              value={isDimensioned ? dimensionMode : 'none'}
              options={DIMENSION_MODES}
              onChange={mode => {
                const next = mode === item.dimension_pricing_mode ? 'none' : mode
                change('dimension_pricing_mode', next)
                if (next !== 'none') change('unit', getModeUnit(next as 'linear' | 'area' | 'volume', item.unit))
              }}
            />
          )}
          {isDimensioned ? (
            <>
              <div className={styles.fields}>
                <Field type="number" label={lengthMeta.label} min={0} decimals={3}
                  value={metersToDisplayUnit(item.length_m, lengthMeta.unit)}
                  onChange={v => q.handleDimChange(sectionId, itemId, 'length_m', v == null ? null : displayUnitToMeters(v, lengthMeta.unit))}
                  hint={lengthMeta.unit} />
                {(dimensionMode === 'area' || dimensionMode === 'volume' || widthMeta.enabled) && (
                  <Field type="number" label={widthMeta.label} min={0} decimals={3}
                    value={metersToDisplayUnit(item.width_m, widthMeta.unit)}
                    onChange={v => q.handleDimChange(sectionId, itemId, 'width_m', v == null ? null : displayUnitToMeters(v, widthMeta.unit))}
                    hint={widthMeta.unit} />
                )}
                {(dimensionMode === 'volume' || heightMeta.enabled) && (
                  <Field type="number" label={heightMeta.label} min={0} decimals={3}
                    value={metersToDisplayUnit(item.height_m, heightMeta.unit)}
                    onChange={v => q.handleDimChange(sectionId, itemId, 'height_m', v == null ? null : displayUnitToMeters(v, heightMeta.unit))}
                    hint={heightMeta.unit} />
                )}
                <Field type="number" label="Nombre d'unités" min={0.001} decimals={3}
                  value={item.dim_quantity}
                  onChange={v => q.handleDimQuantityChange(sectionId, itemId, v)} />
              </div>
              <div className={styles.total}>
                <small>Quantité calculée</small>
                <b>{item.quantity}&nbsp;{item.metal_grid_id ? item.unit : dimensionUnit}</b>
              </div>
            </>
          ) : (
            <p className={styles.hint}>
              La quantité se calcule d&apos;après le mode choisi. Libre : vous saisissez la quantité vous-même.
            </p>
          )}
        </div>
      </Sheet>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer cette prestation ?"
        description="La ligne sera retirée du devis."
        confirmLabel="Supprimer"
        onConfirm={() => {
          setConfirmDelete(false)
          onClose()
          void q.handleRemoveItem(sectionId, itemId)
        }}
      />
    </>
  )
}
