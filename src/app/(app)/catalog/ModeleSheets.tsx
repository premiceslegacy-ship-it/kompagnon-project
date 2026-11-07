'use client'
// @atelier-migrated
// Feuilles de l'éditeur de modèle : nom, section, type de ligne, ligne.

import { useState } from 'react'
import { Cog, Package, Plus, Tag, Truck, Wrench } from 'lucide-react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { Switch } from '@/components/ui/Switch'
import type { CatalogLaborRate, CatalogMaterial } from '@/lib/data/queries/catalog'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { getCatalogLabelsForProfile } from '@/lib/catalog-ui'
import {
  LINE_HELP, LINE_TYPES, UNITS, applyEquipment, applyTransport, costPerUse, equipmentInitial, fuelLiters, parseEquipmentLabel,
  pickLaborRate, pickMaterial, transportInitial, withLineType, type LineType, type LocalItem, type ModeleHeader,
} from './modelesModel'
import { fmtMoney } from './catalogModel'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Catalog.module.css'

const NB = ' '

export const LINE_ICONS: Record<LineType, typeof Package> = { service: Package, labor: Wrench, material: Tag, transport: Truck, equipment: Cog, free: Plus }

/** Nom, description et disponibilité du modèle. */
export function NameSheet({ header, onChange, onClose }: { header: ModeleHeader; onChange: (patch: Partial<ModeleHeader>) => void; onClose: () => void }) {
  const [name, setName] = useState(header.name)
  const [description, setDescription] = useState(header.description)
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Modèle de devis"
      confirmLabel="OK"
      confirmDisabled={!name.trim()}
      onConfirm={() => { onChange({ name: name.trim(), description: description.trim() }); onClose() }}
    >
      <div className={local.sheetBody}>
        <div className={styles.fields}>
          <Field type="text" label="Nom" placeholder="Pose de bardage acier" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div className={local.sheetSection}>
          <Field type="textarea" label="Description" rows={3} placeholder="Détails optionnels…" value={description} onChange={e => setDescription(e.target.value)} />
        </div>
      </div>
    </Sheet>
  )
}

/** Titre d'une section ; suppression possible quand il en reste d'autres. */
export function SectionSheet({ title, canDelete, onSave, onDelete, onClose }: { title: string; canDelete: boolean; onSave: (t: string) => void; onDelete: () => void; onClose: () => void }) {
  const [value, setValue] = useState(title)
  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title={title ? 'Section' : 'Nouvelle section'} confirmLabel="OK" onConfirm={() => { onSave(value.trim()); onClose() }}>
      <div className={local.sheetBody}>
        <div className={styles.fields}>
          <Field type="text" label="Titre" placeholder="Dépose et préparation" value={value} onChange={e => setValue(e.target.value)} />
        </div>
        {canDelete && (
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => { onDelete(); onClose() }}>Supprimer la section</button></li>
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

/** Choix du type de la prochaine ligne. */
export function TypeSheet({ ctx, onPick, onClose }: { ctx: ResolvedCatalogContext; onPick: (t: LineType) => void; onClose: () => void }) {
  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title="Ajouter une ligne">
      <ListGroup>
        {LINE_TYPES.map(t => {
          const Icon = LINE_ICONS[t]
          return <ListRow key={t} leading={<Icon size={18} aria-hidden="true" />} title={ctx.bundleTemplateUi.lineTypeLabels[t]} description={LINE_HELP[t]} onClick={() => onPick(t)} />
        })}
      </ListGroup>
    </Sheet>
  )
}

/** Une ligne du modèle : champs selon le type, calculateurs de trajet et d'amortissement. */
export function LineSheet({ initial, isNew, ctx, materials, laborRates, onSave, onDelete, onClose }: {
  initial: LocalItem
  isNew: boolean
  ctx: ResolvedCatalogContext
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  onSave: (item: LocalItem) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [d, setD] = useState<LocalItem>(initial)
  const [trip, setTrip] = useState(() => transportInitial(initial))
  const [equip, setEquip] = useState(() => equipmentInitial(initial))
  const [equipName, setEquipName] = useState(() => parseEquipmentLabel(initial.designation).name)
  const labels = getCatalogLabelsForProfile(ctx)
  const t = d.item_type
  const set = (patch: Partial<LocalItem>) => setD(prev => ({ ...prev, ...patch }))
  const liters = fuelLiters(trip.km, trip.consumption)
  const perUse = costPerUse(equip.purchase, equip.uses)
  const catalogMaterials = materials.filter(m => (t === 'service' ? m.item_kind === 'service' : m.item_kind !== 'service'))
  const valid = t === 'equipment' ? !!equipName.trim() : t === 'transport' ? !!(d.designation.trim() || trip.km > 0) : !!d.designation.trim()

  function commit() {
    const base = t === 'equipment' ? { ...d, designation: equipName } : d
    const next = t === 'transport' ? applyTransport(base, trip.km, trip.consumption, trip.pricePerLiter)
      : t === 'equipment' ? applyEquipment(base, equip.purchase, equip.uses)
        : base
    onSave(next)
    onClose()
  }

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title={isNew ? 'Nouvelle ligne' : 'Ligne'}
      confirmLabel={isNew ? 'Ajouter' : 'OK'}
      confirmDisabled={!valid}
      onConfirm={commit}
    >
      <div className={local.sheetBody}>
        <div className={styles.fields}>
          <Field type="select" label="Type" value={t} onChange={e => setD(prev => withLineType(prev, e.target.value as LineType))}>
            {LINE_TYPES.map(k => <option key={k} value={k}>{ctx.bundleTemplateUi.lineTypeLabels[k]}</option>)}
          </Field>
          {t === 'labor' && laborRates.length > 0 && (
            <Field type="select" label="Du catalogue" value={d.labor_rate_id ?? ''} onChange={e => { const lr = laborRates.find(l => l.id === e.target.value); if (lr) setD(prev => pickLaborRate(prev, lr)) }}>
              <option value="">Choisir…</option>
              {laborRates.map(l => <option key={l.id} value={l.id}>{l.designation}</option>)}
            </Field>
          )}
          {(t === 'material' || t === 'service') && catalogMaterials.length > 0 && (
            <Field type="select" label="Du catalogue" value={d.material_id ?? ''} onChange={e => { const m = materials.find(x => x.id === e.target.value); if (m) setD(prev => pickMaterial(prev, m)) }}>
              <option value="">Choisir…</option>
              {catalogMaterials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Field>
          )}
          {t === 'equipment'
            ? <Field type="text" label="Désignation" placeholder="Aspirateur industriel" value={equipName} onChange={e => setEquipName(e.target.value)} />
            : <Field type="text" label="Désignation" placeholder={t === 'labor' ? 'Poseur' : t === 'service' ? labels.serviceItemPlaceholder : t === 'material' ? labels.materialItemPlaceholder : t === 'transport' ? 'Carburant - trajet' : 'Désignation'} value={d.designation} onChange={e => set({ designation: e.target.value, ...(t === 'material' || t === 'service' ? { material_id: null } : {}) })} />}
        </div>

        {(t === 'material' || t === 'service') && !d.material_id && d.designation.trim() && (
          <ListGroup description="Réutilisable ensuite dans vos devis et vos autres modèles.">
            <ListRow title="Enregistrer dans le catalogue" trailing={<Switch label="Enregistrer dans le catalogue" checked={d.save_to_catalog} onChange={v => set({ save_to_catalog: v })} />} />
          </ListGroup>
        )}

        {t === 'transport' && (
          <div className={local.sheetSection}>
            <h3 className={local.sheetHeading}>Trajet</h3>
            <div className={styles.fields}>
              <Field type="text" label="Km aller-retour" inputMode="decimal" value={trip.km ? String(trip.km) : ''} onChange={e => setTrip(p => ({ ...p, km: Number(e.target.value.replace(',', '.')) || 0 }))} />
              <Field type="text" label="L / 100 km" inputMode="decimal" value={String(trip.consumption)} onChange={e => setTrip(p => ({ ...p, consumption: Number(e.target.value.replace(',', '.')) || 0 }))} />
              <Field type="text" label="Prix du litre (€)" inputMode="decimal" hint={trip.km > 0 ? `${liters.toFixed(2)}${NB}L de carburant` : undefined} value={String(trip.pricePerLiter)} onChange={e => setTrip(p => ({ ...p, pricePerLiter: Number(e.target.value.replace(',', '.')) || 0 }))} />
            </div>
          </div>
        )}

        {t === 'equipment' && (
          <div className={local.sheetSection}>
            <h3 className={local.sheetHeading}>Amortissement</h3>
            <div className={styles.fields}>
              <Field type="text" label="Achat HT (€)" inputMode="decimal" value={equip.purchase ? String(equip.purchase) : ''} onChange={e => setEquip(p => ({ ...p, purchase: Number(e.target.value.replace(',', '.')) || 0 }))} />
              <Field type="text" label="Usages" inputMode="numeric" hint={equip.purchase > 0 ? `Coût par usage : ${fmtMoney(perUse)}` : 'Le coût par usage devient le coût interne.'} value={String(equip.uses)} onChange={e => setEquip(p => ({ ...p, uses: Number(e.target.value) || 0 }))} />
            </div>
          </div>
        )}

        {t !== 'transport' && t !== 'equipment' && (
          <div className={local.sheetSection}>
            <h3 className={local.sheetHeading}>Quantité et prix</h3>
            <div className={styles.fields}>
              <Field type="text" label="Quantité" inputMode="decimal" value={d.quantity} onChange={e => set({ quantity: e.target.value })} />
              <Field type="select" label="Unité" value={d.unit} onChange={e => set({ unit: e.target.value })}>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                {!UNITS.includes(d.unit) && <option value={d.unit}>{d.unit}</option>}
              </Field>
              {!d.is_internal && <Field type="text" label="Client HT (€)" inputMode="decimal" placeholder="0,00" value={d.unit_price_ht} onChange={e => set({ unit_price_ht: e.target.value })} />}
              <Field type="text" label="Coût HT (€)" inputMode="decimal" placeholder="0,00" value={d.unit_cost_ht} onChange={e => set({ unit_cost_ht: e.target.value })} />
            </div>
          </div>
        )}

        {t !== 'equipment' && (
          <ListGroup description={ctx.bundleTemplateUi.internalLineHelp}>
            <ListRow title="Interne" description="Caché du devis client, compte dans le coût de revient." trailing={<Switch label="Ligne interne" checked={d.is_internal} onChange={v => set({ is_internal: v })} />} />
          </ListGroup>
        )}

        {!isNew && (
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => { onDelete(); onClose() }}>Supprimer la ligne</button></li>
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

