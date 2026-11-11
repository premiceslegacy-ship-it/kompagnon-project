'use client'
// @atelier-migrated

import { useState } from 'react'
import { Check } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SearchField } from '@/components/ui/SearchField'
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
import { getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { fmt, getInternalUnitCost, getItemDimensionMode, getModeUnit, isEquipmentLine, isSectionItem, parseEquipmentAmortization } from './invoiceEditorModel'
import type { InvoiceEditor } from './useInvoiceEditor'
import styles from '../quote-editor/QuoteEditor.module.css'

type Q = InvoiceEditor
const tick = <Check size={18} aria-hidden="true" className={styles.accentRow} />

const DIMENSION_MODES = [
  { value: 'none', label: 'Libre' },
  { value: 'linear', label: 'Linéaire' },
  { value: 'area', label: 'Surface' },
  { value: 'volume', label: 'Volume' },
] as const

/** Feuille d'une ligne de facture. */
export function InvoiceLineSheet({ q, itemId, onClose, onSaveToCatalog }: { q: Q; itemId: number; onClose: () => void; onSaveToCatalog: () => void }) {
  const [dimensionsOpen, setDimensionsOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const item = q.items.find(i => i.id === itemId)
  if (!item) return null

  const isEquipment = isEquipmentLine(item)
  const equipmentMeta = isEquipment ? parseEquipmentAmortization(item.desc, item.pu) : null
  const dimensionMode = getItemDimensionMode(item)
  const isDimensioned = dimensionMode !== 'none'
  const canExpand = isDimensioned || !item.material_id
  const dimensionUnit = getModeUnit(dimensionMode, item.unit)
  const sourceMaterial = item.material_id ? q.materials.find(m => m.id === item.material_id) : null
  const lengthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'length', dimensionMode)
  const widthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'width', dimensionMode)
  const heightMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'height', dimensionMode)
  const lineTotal = Number(item.qty) * Number(item.pu)
  const unitCost = getInternalUnitCost(item)
  const hasMargin = item.unit_cost_ht != null && item.pu > 0 && item.qty > 0
  const margin = hasMargin ? lineTotal - Number(item.qty) * (item.unit_cost_ht ?? 0) : 0
  const marginPct = hasMargin ? Math.round((margin / lineTotal) * 100) : 0
  const isFree = !item.material_id && !isEquipment
  const set = (field: Parameters<typeof q.updateItem>[1], value: string | number | boolean | null) => q.updateItem(itemId, field, value)
  const canSaveToCatalog = !item.material_id && !isEquipment && item.transport_prix_l === null

  return (
    <>
      <Sheet open onOpenChange={open => { if (!open) onClose() }} title={isEquipment ? 'Équipement amorti' : 'Prestation'} cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
        <div className={styles.detail}>
          <div className={styles.total}>
            <small>Total HT</small>
            <b>{fmt(lineTotal)}</b>
          </div>

          <div className={styles.areas}>
            {equipmentMeta ? (
              <Field type="textarea" label="Équipement" rows={1} controlClassName={styles.areaCompact}
                value={equipmentMeta.name} placeholder="Nom de l'équipement..."
                onChange={e => q.handleEquipmentAmortizationChange(itemId, 'name', e.target.value)} />
            ) : (
              <Field type="textarea" label="Désignation"
                rows={Math.min(6, Math.max(2, item.desc.split('\n').length))}
                controlClassName={styles.areaCompact}
                value={item.desc}
                placeholder={item.is_internal ? 'Coût interne (non visible client)...' : 'Description...'}
                onChange={e => set('desc', e.target.value)} />
            )}
          </div>

          {!isEquipment && (
            <div className={styles.fields}>
              <Field type="number" label="Quantité" min={0} value={item.qty} disabled={isDimensioned} onChange={v => set('qty', v ?? 0)} />
              <div className={styles.fieldRow}>
                <span>Unité</span>
                <UnitSelect value={item.unit} onChange={v => set('unit', v)} allowedUnits={q.catalogContext.unitSet} compact />
              </div>
              <Field type="number" label="Prix unitaire" min={0} decimals={2} value={item.pu} onChange={v => set('pu', v ?? 0)} />
              {isFree && (
                <Field type="number" label="Coût interne" min={0} decimals={2} placeholder="Coût de revient"
                  value={item.unit_cost_ht ?? undefined} onChange={v => set('unit_cost_ht', v ?? null)} />
              )}
            </div>
          )}

          {hasMargin && !isEquipment && (
            <p className={`${styles.hint} ${margin >= 0 ? styles.up : styles.down}`} style={{ marginTop: -8 }}>
              Marge sur cette ligne : {marginPct}&nbsp;% · {fmt(margin)}
            </p>
          )}
          {!isFree && !isEquipment && unitCost > 0 && <p className={styles.hint} style={{ marginTop: -8 }}>Coût de revient : {fmt(unitCost)}</p>}

          {!isEquipment && (
            <SegmentedControl
              fullWidth
              label="TVA"
              value={String(item.vat)}
              options={LEGAL_VAT_RATES.map(rate => ({ value: String(rate), label: `${String(rate).replace('.', ',')} %` }))}
              onChange={v => set('vat', Number(v))}
            />
          )}

          <ListGroup title="Cette ligne">
            <ListRow
              title="Visible par le client"
              description={isEquipment ? 'Un équipement reste toujours interne' : 'Désactivé, la ligne reste interne et ne figure pas sur la facture'}
              trailing={<Switch label="Visible par le client" checked={!item.is_internal} disabled={isEquipment} onChange={next => { if (!isEquipment) set('is_internal', !next) }} />}
            />
          </ListGroup>

          {item.transport_prix_l !== null && (
            <ListGroup title="Transport interne" description="Coût de revient : il ne figure pas sur la facture du client.">
              <li className={styles.panel}>
                <div className={styles.fields}>
                  <Field type="number" label="Distance A/R (km)" min={1} value={item.transport_km}
                    onChange={v => q.handleTransportMetaChange(itemId, 'transport_km', v)} />
                  <Field type="number" label="Conso (L/100 km)" min={1} decimals={2} value={item.transport_conso ?? DEFAULT_CONSUMPTION_L_PER_100KM}
                    onChange={v => q.handleTransportMetaChange(itemId, 'transport_conso', v ?? DEFAULT_CONSUMPTION_L_PER_100KM)} />
                  <Field type="number" label="Carburant (€/L)" min={0} decimals={3} value={item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L}
                    onChange={v => q.handleTransportMetaChange(itemId, 'transport_prix_l', v ?? DEFAULT_FUEL_PRICE_EUR_PER_L)} />
                </div>
              </li>
              <ListRow title={`${Number(item.qty).toFixed(2)} L de carburant`} trailing={<span className={styles.amount}>{fmt(Number(item.qty) * (item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L))}</span>} />
            </ListGroup>
          )}

          {isEquipment && equipmentMeta && (
            <ListGroup title="Amortissement" description="Prix d'achat ÷ usages sur la vie = coût par usage, multiplié par les usages comptés. Interne, absent de la facture du client.">
              <li className={styles.panel}>
                <div className={styles.fields}>
                  <Field type="number" label="Prix d'achat HT" min={0} decimals={2} placeholder="500" value={equipmentMeta.purchasePrice}
                    onChange={v => q.handleEquipmentAmortizationChange(itemId, 'purchasePrice', v)} />
                  <Field type="number" label="Usages sur la vie" min={1} decimals={0} placeholder="100" value={equipmentMeta.lifetimeUses}
                    onChange={v => q.handleEquipmentAmortizationChange(itemId, 'lifetimeUses', v)} />
                  <Field type="number" label="Usages comptés" min={0} decimals={2} value={item.qty} onChange={v => set('qty', v ?? 0)} />
                </div>
              </li>
              <ListRow title="Coût par usage" trailing={<span className={styles.amount}>{fmt(Number(item.pu))}</span>} />
              <ListRow title="Coût interne total" trailing={<span className={styles.amount}>{fmt(lineTotal)}</span>} />
            </ListGroup>
          )}

          {(canExpand || canSaveToCatalog) && (
            <ListGroup title="Plus d'options">
              {canExpand && (
                <ListRow title="Dimensions" description={isDimensioned ? `${item.qty} ${dimensionUnit} calculés` : 'Quantité libre'} onClick={() => setDimensionsOpen(true)} />
              )}
              {canSaveToCatalog && (
                <ListRow title="Enregistrer dans le catalogue" description="Pour la retrouver plus tard" onClick={() => { onClose(); onSaveToCatalog() }} />
              )}
            </ListGroup>
          )}

          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirmDelete(true)}>Supprimer la prestation</button></li>
          </ListGroup>
        </div>
      </Sheet>

      <Sheet open={dimensionsOpen} onOpenChange={setDimensionsOpen} title="Dimensions" cancelLabel="Retour" onConfirm={() => setDimensionsOpen(false)} confirmLabel="OK">
        <div className={styles.detail}>
          {!item.material_id && (
            <SegmentedControl
              fullWidth
              label="Tarification"
              value={isDimensioned ? dimensionMode : 'none'}
              options={DIMENSION_MODES}
              onChange={mode => {
                const next = mode === item.dimension_pricing_mode ? 'none' : mode
                set('dimension_pricing_mode', next)
                if (next !== 'none') set('unit', getModeUnit(next as 'linear' | 'area' | 'volume', item.unit))
              }}
            />
          )}
          {isDimensioned ? (
            <>
              <div className={styles.fields}>
                <Field type="number" label={lengthMeta.label} min={0} decimals={3} hint={lengthMeta.unit}
                  value={metersToDisplayUnit(item.length_m, lengthMeta.unit)}
                  onChange={v => q.handleDimChange(itemId, 'length_m', v == null ? null : displayUnitToMeters(v, lengthMeta.unit))} />
                {(dimensionMode === 'area' || dimensionMode === 'volume' || widthMeta.enabled) && (
                  <Field type="number" label={widthMeta.label} min={0} decimals={3} hint={widthMeta.unit}
                    value={metersToDisplayUnit(item.width_m, widthMeta.unit)}
                    onChange={v => q.handleDimChange(itemId, 'width_m', v == null ? null : displayUnitToMeters(v, widthMeta.unit))} />
                )}
                {(dimensionMode === 'volume' || heightMeta.enabled) && (
                  <Field type="number" label={heightMeta.label} min={0} decimals={3} hint={heightMeta.unit}
                    value={metersToDisplayUnit(item.height_m, heightMeta.unit)}
                    onChange={v => q.handleDimChange(itemId, 'height_m', v == null ? null : displayUnitToMeters(v, heightMeta.unit))} />
                )}
                <Field type="number" label="Nombre d'unités" min={0.001} decimals={3} value={item.dim_quantity}
                  onChange={v => q.handleDimQuantityChange(itemId, v)} />
              </div>
              <div className={styles.total}>
                <small>Quantité calculée</small>
                <b>{item.qty}&nbsp;{dimensionUnit}</b>
              </div>
            </>
          ) : (
            <p className={styles.hint}>La quantité se calcule d&apos;après le mode choisi. Libre : vous saisissez la quantité vous-même.</p>
          )}
        </div>
      </Sheet>

      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer cette prestation ?"
        description="La ligne sera retirée de la facture."
        confirmLabel="Supprimer"
        onConfirm={() => { setConfirmDelete(false); onClose(); q.removeItem(itemId) }}
      />
    </>
  )
}

/** Titre et suppression d'un lot (intitulé de section et ses lignes). */
export function InvoiceSectionSheet({ q, sectionId, onClose }: { q: Q; sectionId: number; onClose: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const idx = q.items.findIndex(i => i.id === sectionId)
  const section = q.items[idx]
  if (!section) return null
  let end = idx + 1
  while (end < q.items.length && !isSectionItem(q.items[end])) end++
  const lines = q.items.slice(idx + 1, end)
  const subtotal = lines.filter(i => !i.is_internal).reduce((s, i) => s + Number(i.qty) * Number(i.pu), 0)
  return (
    <>
      <Sheet open onOpenChange={open => { if (!open) onClose() }} title="Section" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
        <div className={styles.detail}>
          <div className={styles.fields}>
            <Field type="text" label="Titre" placeholder="Nom de la section" value={section.desc} onChange={e => q.updateItem(sectionId, 'desc', e.target.value)} />
          </div>
          <ListGroup>
            <ListRow title="Sous-total HT" trailing={<span className={styles.amount}>{fmt(subtotal)}</span>} />
          </ListGroup>
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirmDelete(true)}>Supprimer la section</button></li>
          </ListGroup>
        </div>
      </Sheet>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer cette section ?"
        description={lines.length > 0 ? `La section et ses ${lines.length} ligne${lines.length > 1 ? 's' : ''} seront retirées de la facture.` : 'La section sera retirée de la facture.'}
        confirmLabel="Supprimer"
        onConfirm={() => { setConfirmDelete(false); onClose(); q.removeSection(sectionId) }}
      />
    </>
  )
}

/** Ajout d'une ligne : à la fin, ou à la suite d'une ligne donnée (fin d'une section). */
export function InvoiceAddSheet({ q, afterId, onClose, onAdding }: { q: Q; afterId: number | null; onClose: () => void; onAdding: () => void }) {
  const addBlank = (internal: boolean) => {
    onAdding()
    onClose()
    if (internal) q.addInternalItem()
    else if (afterId != null) q.addItemAfter(afterId)
    else q.addItem()
  }
  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }} title="Ajouter une ligne" cancelLabel="Fermer">
      <div className={styles.pickList}>
        <ListGroup>
          <ListRow title="Ligne libre" description="Une prestation à décrire" onClick={() => addBlank(false)} />
          <ListRow
            title="Depuis le catalogue"
            description={q.hasCatalog ? 'Matériaux, ressources, prestations' : 'Catalogue vide'}
            onClick={() => { onClose(); q.setIsCatalogModalOpen(true) }}
          />
        </ListGroup>
        <ListGroup title="Coûts internes" description="Ces lignes comptent dans votre marge mais n'apparaissent pas sur la facture du client.">
          <ListRow title="Transport" description="Distance et carburant" onClick={() => { onClose(); q.setShowTransport(true) }} />
          <ListRow title="Équipement amorti" description="Coût par usage d'un outil"
            onClick={() => { onClose(); q.setEquipmentName(''); q.setEquipmentPurchase(0); q.setEquipmentUses(100); q.setShowEquipment(true) }} />
          <ListRow title="Coût interne" description="Une ligne de coût libre" onClick={() => addBlank(true)} />
        </ListGroup>
      </div>
    </Sheet>
  )
}

export function QuoteImportSheet({ q }: { q: Q }) {
  return (
    <Sheet open={q.isQuoteModalOpen} onOpenChange={q.setIsQuoteModalOpen} title="Importer un devis accepté" cancelLabel="Fermer">
      {q.acceptedQuotes.length === 0 ? (
        <p className={styles.notice}>Aucun devis accepté disponible.</p>
      ) : (
        <ListGroup>
          {q.acceptedQuotes.map(quote => {
            const clientName = quote.client?.company_name ?? quote.client?.email ?? '/'
            const count = quote.sections.reduce((a, s) => a + s.items.length, 0) + quote.unsectionedItems.length
            return (
              <ListRow
                key={quote.id}
                title={quote.title ?? 'Sans titre'}
                description={`${clientName} · ${quote.number ?? '/'} · ${count} ligne${count !== 1 ? 's' : ''}`}
                trailing={<span className={styles.amount}>{quote.total_ht != null ? fmt(quote.total_ht) : '/'} HT</span>}
                onClick={() => q.handleImportQuote(quote)}
              />
            )
          })}
        </ListGroup>
      )}
    </Sheet>
  )
}

export function InvoiceCatalogSheet({ q }: { q: Q }) {
  const close = () => { q.setIsCatalogModalOpen(false); q.setCatalogSearch('') }
  const labels = q.catalogContext.labelSet
  const empty = q.filteredMaterials.length === 0 && q.filteredLabor.length === 0 && q.filteredPrestations.length === 0
  return (
    <Sheet open={q.isCatalogModalOpen} onOpenChange={open => { if (!open) close() }} title="Ajouter depuis le catalogue" cancelLabel="Fermer">
      <div className={styles.pickList}>
        <SearchField
          value={q.catalogSearch}
          onChange={q.setCatalogSearch}
          label="Rechercher dans le catalogue"
          placeholder={`Rechercher ${labels.material.singular.toLowerCase()}, ${labels.laborRate.singular.toLowerCase()}, ${labels.bundleTemplate.singular.toLowerCase()}…`}
        />
        {empty && <p className={styles.hint}>{q.catalogSearch ? 'Aucun résultat.' : 'Catalogue vide. Ajoutez des éléments dans le catalogue pour les utiliser ici.'}</p>}
        {q.filteredMaterials.length > 0 && (
          <ListGroup title={labels.material.plural}>
            {q.filteredMaterials.map(m => (
              <ListRow key={m.id} title={m.name}
                description={m.category ? `${m.category}${m.unit ? ` · ${m.unit}` : ''}` : (m.unit ?? undefined)}
                trailing={<span className={styles.amount}>{m.sale_price != null ? fmt(m.sale_price) : '-'}</span>}
                onClick={() => q.addMaterialFromCatalog(m)} />
            ))}
          </ListGroup>
        )}
        {q.filteredLabor.length > 0 && (
          <ListGroup title={labels.laborRate.plural}>
            {q.filteredLabor.map(l => (
              <ListRow key={l.id} title={l.designation}
                description={`${l.category ? `${l.category} · ` : ''}${l.unit ? `${l.unit} · ` : ''}Ressource interne`}
                trailing={<span className={styles.amount}>{fmt(getInternalResourceUnitCost(l))}</span>}
                onClick={() => q.addFromCatalog(l.designation, l.unit, getInternalResourceUnitCost(l), q.defaultVatRate)} />
            ))}
          </ListGroup>
        )}
        {q.filteredPrestations.length > 0 && (
          <ListGroup title={labels.bundleTemplate.plural}>
            {q.filteredPrestations.map(p => (
              <ListRow key={p.id} title={p.name}
                description={`${p.items.length} ligne${p.items.length > 1 ? 's' : ''}${p.category ? ` · ${p.category}` : ''}`}
                trailing={<span className={styles.amount}>{fmt(p.base_price_ht)}</span>}
                onClick={() => q.addPrestationToItems(p)} />
            ))}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

const AID_PRESETS = ['MaPrimeRénov\'', 'CEE', 'Éco-PTZ', 'Anah']

export function InvoiceAidSheet({ q, open, onClose }: { q: Q; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Aide ou subvention" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
      <div className={styles.detail}>
        <ListGroup title="Type d'aide">
          {AID_PRESETS.map(preset => (
            <ListRow key={preset} title={preset} trailing={q.aidLabel === preset ? tick : undefined}
              onClick={() => { q.setShowAid(true); q.setAidLabel(preset) }} />
          ))}
        </ListGroup>
        <SegmentedControl fullWidth label="Unité du montant" value={q.aidMode}
          options={[{ value: '€', label: '€' }, { value: '%', label: '%' }]} onChange={v => q.setAidMode(v as '€' | '%')} />
        <div className={styles.fields}>
          <Field type="text" label="Libellé" placeholder="Autre aide" value={q.aidLabel}
            onChange={e => { q.setShowAid(true); q.setAidLabel(e.target.value) }} />
          <Field type="number" label="Montant déduit" min={0} max={q.aidMode === '%' ? 100 : q.totalTtc} placeholder="0"
            value={q.aidMode === '%'
              ? (q.aidAmount != null && q.totalTtc > 0 ? Math.round((q.aidAmount / q.totalTtc) * 10000) / 100 : null)
              : q.aidAmount}
            onChange={v => {
              q.setShowAid(true)
              if (v == null) { q.setAidAmount(null); return }
              q.setAidAmount(q.aidMode === '%'
                ? Math.round(Math.min(100, Math.max(0, v)) * q.totalTtc) / 100
                : Math.min(q.totalTtc, Math.max(0, v)))
            }} />
        </div>
        {q.aidAmount != null && q.aidAmount > 0 && (
          <ListGroup>
            <ListRow title="Total TTC" trailing={<span className={styles.amount}>{fmt(q.totalTtc)}</span>} />
            <ListRow title={q.aidLabel || 'Aide'} trailing={<span className={styles.amount}>−{fmt(q.aidAmount)}</span>} />
            <ListRow title="Reste à charge" trailing={<span className={styles.recapTotal}>{fmt(Math.max(0, q.totalTtc - q.aidAmount))}</span>} />
          </ListGroup>
        )}
        {q.showAid && (
          <ListGroup>
            <li className={styles.destructiveRow}>
              <button type="button" onClick={() => { q.setShowAid(false); q.setAidLabel(''); q.setAidAmount(null); onClose() }}>Retirer l&apos;aide</button>
            </li>
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

/** Marge interne de la facture : lecture seule. */
export function InvoiceMarginSheet({ q, open, onClose }: { q: Q; open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Marge interne" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
      <div className={styles.detail}>
        <div className={styles.total}>
          <small>Marge brute</small>
          <b className={q.margeHt >= 0 ? styles.up : styles.down}>{fmt(q.margeHt)}</b>
          <small>{q.margePct.toFixed(1).replace('.', ',')}&nbsp;% du total HT</small>
        </div>
        <ListGroup description="Les lignes internes ne figurent pas sur la facture du client.">
          <ListRow title="Total client HT" trailing={<span className={styles.amount}>{fmt(q.totalHt)}</span>} />
          <ListRow title="Coût interne" trailing={<span className={styles.amount}>−{fmt(q.totalInternalHt)}</span>} />
        </ListGroup>
      </div>
    </Sheet>
  )
}

export function ChantierSheet({ q, open, onClose }: { q: Q; open: boolean; onClose: () => void }) {
  const select = (id: string | null) => { q.setChantierId(id); onClose() }
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Chantier rattaché" cancelLabel="Fermer">
      <ListGroup description="Cette facture apparaîtra dans la rentabilité du chantier sélectionné.">
        <ListRow title="Aucun chantier" trailing={!q.chantierId ? tick : undefined} onClick={() => select(null)} />
        {q.linkableChantiers.map(c => (
          <ListRow key={c.id} title={c.title} trailing={q.chantierId === c.id ? tick : undefined} onClick={() => select(c.id)} />
        ))}
      </ListGroup>
    </Sheet>
  )
}

/** Échéancier de paiement : plusieurs échéances, en montant ou en pourcentage du TTC. */
export function ScheduleSheet({ q, open, onClose }: { q: Q; open: boolean; onClose: () => void }) {
  const [confirmRemove, setConfirmRemove] = useState(false)
  const diff = Math.round(q.scheduleRemaining * 100) / 100
  return (
    <>
      <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Échéancier" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
        <div className={styles.detail}>
          <div className={styles.total}>
            <small>Reste à ventiler</small>
            <b className={diff === 0 ? undefined : styles.down}>{fmt(diff)}</b>
          </div>
          {q.schedule.map((s, idx) => {
            const paid = s.is_paid ?? (s.paid_payment_id !== null)
            const partiallyPaid = (s.paid_amount ?? 0) > 0 && !paid
            const locked = paid || partiallyPaid
            const scheduledAmount = q.scheduleLineAmount(s)
            const remainingAmount = s.remaining_amount ?? Math.max(0, scheduledAmount - (s.paid_amount ?? 0))
            const suffix = paid ? ' · payée' : partiallyPaid ? ' · partiellement payée' : ''
            return (
              <ListGroup key={s.id} title={`Échéance ${idx + 1}${suffix}`}
                action={!locked ? <Button variant="text" size="sm" onClick={() => q.removeScheduleLine(s.id)}>Retirer</Button> : undefined}>
                <li className={styles.panel}>
                  <div className={styles.fields}>
                    <Field type="text" label="Libellé" placeholder="Acompte, solde…" value={s.label} disabled={locked}
                      onChange={e => q.updateScheduleLine(s.id, 'label', e.target.value)} />
                    <div className={styles.fieldRow}>
                      <label htmlFor={`due-${s.id}`}>Date</label>
                      <input id={`due-${s.id}`} type="date" className={styles.dateInput} value={s.due_date} disabled={locked}
                        onChange={e => q.updateScheduleLine(s.id, 'due_date', e.target.value)} />
                    </div>
                    <div className={styles.fieldRow}>
                      <span>Unité</span>
                      <SegmentedControl label="Type de montant" value={s.amount_type}
                        options={[{ value: 'amount', label: '€', disabled: locked }, { value: 'percentage', label: '%', disabled: locked }]}
                        onChange={v => q.setScheduleAmountType(s.id, v as 'amount' | 'percentage')} />
                    </div>
                    <Field type="number" label="Montant" min={0} max={s.amount_type === 'percentage' ? 100 : undefined} placeholder="0" disabled={locked}
                      value={s.amount_type === 'percentage' ? (s.percentage ?? null) : (s.amount || null)}
                      onChange={v => q.updateScheduleLine(s.id, s.amount_type === 'percentage' ? 'percentage' : 'amount', v ?? 0)} />
                  </div>
                </li>
                {s.amount_type === 'percentage' && <ListRow title="Soit" trailing={<span className={styles.amount}>{fmt(scheduledAmount)}</span>} />}
                {partiallyPaid && <ListRow title={`Reçu ${fmt(s.paid_amount ?? 0)}`} trailing={<span className={styles.amount}>Reste {fmt(remainingAmount)}</span>} />}
              </ListGroup>
            )
          })}
          <ListGroup>
            <ListRow title="Ajouter une échéance" className={styles.accentRow} onClick={q.addScheduleLine} />
          </ListGroup>
          {q.scheduleError && <p className={`${styles.hint} ${styles.warn}`} role="alert">{q.scheduleError}</p>}
          <Button variant="secondary" size="lg" loading={q.scheduleSaving} disabled={!q.invoiceId} onClick={() => void q.handleSaveSchedule()}>
            Enregistrer l&apos;échéancier
          </Button>
          {!q.invoiceId && <p className={styles.hint}>Enregistrez d&apos;abord la facture (menu ⋯, « Enregistrer le brouillon ») pour sauvegarder l&apos;échéancier.</p>}
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirmRemove(true)}>Retirer l&apos;échéancier</button></li>
          </ListGroup>
        </div>
      </Sheet>
      <AlertDialog
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title="Retirer l'échéancier ?"
        description="Les échéances saisies seront effacées de cet écran."
        confirmLabel="Retirer"
        onConfirm={() => { setConfirmRemove(false); q.setShowSchedule(false); q.setSchedule([]); onClose() }}
      />
    </>
  )
}
