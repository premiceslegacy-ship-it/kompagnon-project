'use client'
// @atelier-migrated

import { useState } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import { LEGAL_VAT_RATES } from '@/lib/utils'
import { getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { clientDisplayName, fmt, isEquipmentLine } from './recurringModel'
import type { Recurring } from './useRecurring'
import styles from '../quote-editor/QuoteEditor.module.css'

type Q = Recurring
const NB = ' '

const AUTO_DELAYS = [1, 2, 3, 5, 7]

/** Création d'un modèle récurrent (ou conversion d'une facture en modèle). */
export function RecurringFormSheet({ q, fromInvoice, onPickLine }: { q: Q; fromInvoice: boolean; onPickLine: (id: number) => void }) {
  const freq = q.formFreq
  const totalLine = (i: { qty: number; pu: number }) => Number(i.qty) * Number(i.pu)
  return (
    <Sheet
      open={q.showForm}
      onOpenChange={q.setShowForm}
      title={fromInvoice ? 'Convertir en modèle' : 'Nouveau modèle'}
      description={fromInvoice ? 'Les lignes de la facture sont reprises dans le modèle.' : undefined}
      onConfirm={() => q.handleCreateSubmit()}
      confirmLabel="Créer"
      confirmLoading={q.isSaving}
    >
      <div className={styles.detail}>
        {q.formError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{q.formError}</p>}

        <div className={styles.fields}>
          <Field type="text" label="Intitulé" placeholder="Ex : Maintenance mensuelle" value={q.formTitle} onChange={e => q.setFormTitle(e.target.value)} />
          <Field type="select" label="Client" value={q.formClientId} onChange={e => q.setFormClientId(e.target.value)}>
            <option value="">Sélectionner…</option>
            {q.clients.map(c => <option key={c.id} value={c.id}>{clientDisplayName(c)}</option>)}
          </Field>
        </div>
        <ListGroup>
          <ListRow
            title="Nouveau client"
            description="Créer et sélectionner"
            className={styles.accentRow}
            onClick={() => {
              q.setNewClientError(null)
              q.setNewClientForm({ company_name: '', contact_name: '', first_name: '', last_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' })
              q.setNewClientOpen(true)
            }}
          />
        </ListGroup>

        <SegmentedControl
          fullWidth
          label="Fréquence"
          value={freq}
          options={[
            { value: 'monthly', label: 'Mensuelle' },
            { value: 'quarterly', label: 'Trimestrielle' },
            { value: 'weekly', label: 'Hebdo.' },
            { value: 'custom', label: 'Autre' },
          ]}
          onChange={v => q.setFormFreq(v as typeof freq)}
        />

        <div className={styles.fields}>
          {(freq === 'monthly' || freq === 'quarterly') && (
            <Field type="number" label="Jour d'envoi" min={1} max={28} decimals={0} value={q.formSendDay} onChange={v => q.setFormSendDay(v ?? 1)} hint="Entre le 1 et le 28" />
          )}
          {freq === 'custom' && (
            <Field type="number" label="Intervalle" min={1} decimals={0} value={q.formCustomDays} onChange={v => q.setFormCustomDays(v ?? 1)} hint="En jours" />
          )}
          <div className={styles.fieldRow}>
            <label htmlFor="recurring-first-date">Premier envoi</label>
            <input id="recurring-first-date" type="date" className={styles.dateInput} value={q.formFirstDate} onChange={e => q.setFormFirstDate(e.target.value)} />
          </div>
          <Field type="number" label="Brouillon prêt" min={0} max={14} decimals={0} value={q.formConfirmDelay} onChange={v => q.setFormConfirmDelay(v ?? 0)}
            hint={`Le brouillon apparaît ${q.formConfirmDelay} jour${q.formConfirmDelay > 1 ? 's' : ''} avant l'envoi, pour vérification.`} />
        </div>

        <ListGroup description={q.formAutoSendDelay === null
          ? 'La facture attend votre validation manuelle avant d\'être envoyée.'
          : `Si le brouillon n'est pas validé après ${q.formAutoSendDelay} jour${q.formAutoSendDelay > 1 ? 's' : ''}, la facture est envoyée automatiquement avec son PDF.`}>
          <ListRow
            title="Envoi automatique si non validé"
            description={q.formAutoSendDelay === null ? 'Désactivé, validation manuelle requise' : `${q.formAutoSendDelay} jour${q.formAutoSendDelay > 1 ? 's' : ''} après la création du brouillon`}
            trailing={<Switch label="Envoi automatique si non validé" checked={q.formAutoSendDelay !== null} onChange={next => q.setFormAutoSendDelay(next ? 3 : null)} />}
          />
        </ListGroup>
        {q.formAutoSendDelay !== null && (
          <SegmentedControl
            fullWidth
            label="Délai avant l'envoi automatique"
            value={String(q.formAutoSendDelay)}
            options={AUTO_DELAYS.map(d => ({ value: String(d), label: `${d} j` }))}
            onChange={v => q.setFormAutoSendDelay(Number(v))}
          />
        )}

        <ListGroup title="Lignes de facturation" description="Un coût interne sert à calculer votre marge, sans figurer sur la facture du client.">
          {q.formItems.map(item => {
            const equipment = isEquipmentLine(item)
            return (
              <ListRow
                key={item.id}
                title={item.desc.split('\n')[0] || 'Ligne sans description'}
                description={`${item.qty}${item.unit ? `${NB}${item.unit}` : ''} × ${fmt(Number(item.pu))}`}
                trailing={item.is_internal || equipment
                  ? <StatusPill status="neutral">{equipment ? 'Équipement' : 'Interne'}</StatusPill>
                  : <span className={styles.amount}>{fmt(totalLine(item))}</span>}
                onClick={() => onPickLine(item.id)}
              />
            )
          })}
          <ListRow title="Ligne libre" className={styles.accentRow}
            onClick={() => q.setFormItems(prev => [...prev, { id: Date.now(), desc: '', qty: 1, unit: '', pu: 0, vat: q.defaultVatRate, is_internal: false }])} />
          {q.hasCatalog && <ListRow title="Depuis le catalogue" onClick={() => q.setShowCatalog(true)} />}
          <ListRow title="Transport" description="Coût interne" onClick={() => q.setShowTransport(true)} />
          <ListRow title="Équipement amorti" description="Coût interne"
            onClick={() => { q.setEquipmentName(''); q.setEquipmentPurchase(0); q.setEquipmentUses(100); q.setShowEquipment(true) }} />
        </ListGroup>

        <ListGroup>
          <ListRow title="Total HT par envoi" trailing={<span className={styles.recapTotal}>{fmt(q.totalHt)}</span>} />
          {q.hasInternal && (
            <ListRow
              title="Marge brute"
              description={`${q.margePct.toFixed(0)}${NB}% du total HT`}
              trailing={<span className={`${styles.amount} ${q.margeHt >= 0 ? styles.up : styles.down}`}>{fmt(q.margeHt)}</span>}
            />
          )}
        </ListGroup>
      </div>
    </Sheet>
  )
}

/** Une ligne du modèle : champs principaux. */
export function RecurringLineSheet({ q, itemId, onClose }: { q: Q; itemId: number; onClose: () => void }) {
  const item = q.formItems.find(i => i.id === itemId)
  if (!item) return null
  const equipment = isEquipmentLine(item)
  const remove = () => { q.setFormItems(prev => prev.filter(i => i.id !== itemId)); onClose() }
  return (
    <Sheet open onOpenChange={open => { if (!open) onClose() }} title="Ligne" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
      <div className={styles.detail}>
        <div className={styles.total}>
          <small>Total HT</small>
          <b>{fmt(Number(item.qty) * Number(item.pu))}</b>
        </div>
        <div className={styles.areas}>
          <Field type="textarea" label="Description" rows={Math.min(6, Math.max(2, item.desc.split('\n').length))} controlClassName={styles.areaCompact}
            value={item.desc} placeholder="Description" onChange={e => q.updateFormItem(itemId, 'desc', e.target.value)} />
        </div>
        <div className={styles.fields}>
          <Field type="number" label="Quantité" min={0} value={item.qty} onChange={v => q.updateFormItem(itemId, 'qty', v ?? 0)} />
          <Field type="text" label="Unité" placeholder="u" value={item.unit} onChange={e => q.updateFormItem(itemId, 'unit', e.target.value)} />
          <Field type="number" label="Prix unitaire" min={0} decimals={2} value={item.pu} onChange={v => q.updateFormItem(itemId, 'pu', v ?? 0)} />
        </div>
        <SegmentedControl
          fullWidth
          label="TVA"
          value={String(item.vat)}
          options={LEGAL_VAT_RATES.map(rate => ({ value: String(rate), label: `${String(rate).replace('.', ',')}${NB}%` }))}
          onChange={v => q.updateFormItem(itemId, 'vat', Number(v))}
        />
        <ListGroup>
          <ListRow
            title="Visible par le client"
            description={equipment ? 'Un équipement reste toujours interne' : 'Désactivé, la ligne reste interne et ne figure pas sur la facture'}
            trailing={<Switch label="Visible par le client" checked={!item.is_internal} disabled={equipment} onChange={next => q.updateFormItem(itemId, 'is_internal', !next)} />}
          />
        </ListGroup>
        {q.formItems.length > 1 && (
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={remove}>Supprimer la ligne</button></li>
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

export function RecurringCatalogSheet({ q }: { q: Q }) {
  const close = () => { q.setShowCatalog(false); q.setCatalogSearch('') }
  const empty = q.filteredMaterials.length === 0 && q.filteredLabor.length === 0 && q.filteredPrestations.length === 0
  return (
    <Sheet open={q.showCatalog} onOpenChange={open => { if (!open) close() }} title="Ajouter depuis le catalogue" cancelLabel="Fermer">
      <div className={styles.pickList}>
        <SearchField value={q.catalogSearch} onChange={q.setCatalogSearch} label="Rechercher dans le catalogue" placeholder="Rechercher matériau, main-d'œuvre, prestation…" />
        {empty && <p className={styles.hint}>{q.catalogSearch ? 'Aucun résultat.' : 'Catalogue vide. Ajoutez des éléments dans le catalogue pour les utiliser ici.'}</p>}
        {q.filteredMaterials.length > 0 && (
          <ListGroup title="Matériaux">
            {q.filteredMaterials.map(m => (
              <ListRow key={m.id} title={m.name} description={m.category ? `${m.category}${m.unit ? ` · ${m.unit}` : ''}` : (m.unit ?? undefined)}
                trailing={<span className={styles.amount}>{m.sale_price != null ? fmt(m.sale_price) : '-'}</span>} onClick={() => q.addMaterialFromCatalog(m)} />
            ))}
          </ListGroup>
        )}
        {q.filteredLabor.length > 0 && (
          <ListGroup title="Ressources internes">
            {q.filteredLabor.map(l => (
              <ListRow key={l.id} title={l.designation} description={`${l.category ? `${l.category} · ` : ''}${l.unit ? `${l.unit} · ` : ''}Ressource interne`}
                trailing={<span className={styles.amount}>{fmt(getInternalResourceUnitCost(l))}</span>}
                onClick={() => q.addFromCatalog(l.designation, l.unit, getInternalResourceUnitCost(l), q.defaultVatRate)} />
            ))}
          </ListGroup>
        )}
        {q.filteredPrestations.length > 0 && (
          <ListGroup title="Prestations">
            {q.filteredPrestations.map(p => (
              <ListRow key={p.id} title={p.name} description={`${p.items.length} ligne${p.items.length > 1 ? 's' : ''}${p.category ? ` · ${p.category}` : ''}`}
                trailing={<span className={styles.amount}>{fmt(p.base_price_ht)}</span>} onClick={() => q.addPrestationToItems(p)} />
            ))}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}

/** Actions d'un modèle : préparer la facture, pause ou reprise, arrêt définitif. */
export function RecurringActionsSheet({ q, id, onClose, ready }: { q: Q; id: string; onClose: () => void; ready: boolean }) {
  const [confirmStop, setConfirmStop] = useState(false)
  const inv = q.invoices.find(i => i.id === id)
  if (!inv) return null
  const busy = !!q.loadingId
  return (
    <>
      <Sheet open onOpenChange={open => { if (!open) onClose() }} title={inv.title} cancelLabel="Fermer">
        <div className={styles.pickList}>
          <ListGroup>
            {ready && <ListRow title="Préparer la facture" description="Crée le brouillon et l'ouvre pour vérification" disabled={busy} onClick={() => { onClose(); q.handlePrepareDraft(inv) }} />}
            <ListRow title={inv.is_active ? 'Mettre en pause' : 'Reprendre'} disabled={busy} onClick={() => { onClose(); q.handleToggle(inv) }} />
          </ListGroup>
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" disabled={busy} onClick={() => setConfirmStop(true)}>Arrêter définitivement</button></li>
          </ListGroup>
        </div>
      </Sheet>
      <AlertDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Arrêter ce modèle ?"
        description="Ce modèle de facturation sera arrêté définitivement. Les factures déjà créées ne sont pas touchées."
        confirmLabel="Arrêter"
        onConfirm={() => { setConfirmStop(false); onClose(); q.handleCancel(inv.id) }}
      />
    </>
  )
}
