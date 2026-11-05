'use client'
// @atelier-migrated
// Feuilles communes aux éditeurs de devis et de facture.

import { Check } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import type { Client } from '@/lib/data/queries/clients'
import { getClientDisplayName } from '@/lib/client'
import { useState } from 'react'
import styles from './quote-editor/QuoteEditor.module.css'

const NB = '\u00a0'
const fmt = (n: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)
const clientDisplayName = (c: Client) => getClientDisplayName(c)
const tick = <Check size={18} aria-hidden="true" className={styles.accentRow} />

export type NewClientForm = { company_name: string; contact_name: string; first_name: string; last_name: string; email: string; phone: string; address_line1: string; postal_code: string; city: string }
export type NewClientState = {
  newClientForm: NewClientForm
  setNewClientForm: Dispatch<SetStateAction<NewClientForm>>
  newClientType: 'company' | 'individual'
  setNewClientType: (type: 'company' | 'individual') => void
  newClientError: string | null
  newClientPending: boolean
  handleCreateClientInline: () => void
}
export type TransportState = {
  showTransport: boolean
  setShowTransport: (open: boolean) => void
  transportCost: number
  transportLiters: number
  transportKm: number
  setTransportKm: (value: number) => void
  transportConso: number
  setTransportConso: (value: number) => void
  transportPrixL: number
  setTransportPrixL: (value: number) => void
  handleAddTransport: () => void | Promise<void>
}
export type EquipmentState = {
  showEquipment: boolean
  setShowEquipment: (open: boolean) => void
  equipmentName: string
  setEquipmentName: (value: string) => void
  equipmentPurchase: number
  setEquipmentPurchase: (value: number) => void
  equipmentUses: number
  setEquipmentUses: (value: number) => void
  equipmentCostPerUse: number
  handleAddEquipment: () => void | Promise<void>
}

/** Choix du client, avec création à la volée. */
export function ClientSheet({ clients: allClients, clientId, onSelect, open, onClose, onNewClient }: { clients: Client[]; clientId: string; onSelect: (id: string) => void; open: boolean; onClose: () => void; onNewClient: () => void }) {
  const [search, setSearch] = useState('')
  const needle = search.trim().toLowerCase()
  const clients = allClients.filter(c => !needle || clientDisplayName(c).toLowerCase().includes(needle) || (c.email ?? '').toLowerCase().includes(needle))
  const select = (id: string) => {
    onSelect(id)
    onClose()
  }
  return (
    <Sheet open={open} onOpenChange={next => { if (!next) onClose() }} title="Client" cancelLabel="Fermer">
      <div className={styles.pickList}>
        <SearchField value={search} onChange={setSearch} label="Rechercher un client" placeholder="Rechercher" />
        <ListGroup>
          <ListRow title="Nouveau client" description="Créer et sélectionner" className={styles.accentRow} onClick={onNewClient} />
        </ListGroup>
        <ListGroup>
          <ListRow title="Sans client" trailing={clientId === '' ? tick : undefined} onClick={() => select('')} />
          {clients.map(c => (
            <ListRow
              key={c.id}
              title={clientDisplayName(c)}
              description={c.email ?? undefined}
              trailing={clientId === c.id ? tick : undefined}
              onClick={() => select(c.id)}
            />
          ))}
        </ListGroup>
      </div>
    </Sheet>
  )
}

export function NewClientSheet({ q, open, onClose }: { q: NewClientState; open: boolean; onClose: () => void }) {
  const form = q.newClientForm
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    q.setNewClientForm(p => ({ ...p, [key]: e.target.value }))
  const individual = q.newClientType === 'individual'
  return (
    <Sheet
      open={open}
      onOpenChange={next => { if (!next) onClose() }}
      title="Nouveau client"
      onConfirm={q.handleCreateClientInline}
      confirmLabel="Créer"
      confirmLoading={q.newClientPending}
    >
      <div className={styles.detail}>
        <SegmentedControl
          fullWidth
          label="Type de client"
          value={q.newClientType}
          options={[{ value: 'company', label: 'Professionnel' }, { value: 'individual', label: 'Particulier' }]}
          onChange={v => q.setNewClientType(v as 'company' | 'individual')}
        />
        <div className={styles.fields}>
          {!individual && <Field type="text" label="Raison sociale" placeholder="Obligatoire" value={form.company_name} onChange={set('company_name')} />}
          {!individual && <Field type="text" label="Contact" placeholder="Nom du référent" value={form.contact_name} onChange={set('contact_name')} />}
          <Field type="text" label="Prénom" placeholder={individual ? 'Obligatoire' : 'Facultatif'} value={form.first_name} onChange={set('first_name')} />
          <Field type="text" label="Nom" placeholder={individual ? 'Obligatoire' : 'Facultatif'} value={form.last_name} onChange={set('last_name')} />
          <Field type="text" label="Email" placeholder="nom@exemple.fr" inputMode="email" value={form.email} onChange={set('email')} />
          <Field type="text" label="Téléphone" inputMode="tel" value={form.phone} onChange={set('phone')} />
          <Field type="text" label="Adresse" value={form.address_line1} onChange={set('address_line1')} />
          <Field type="text" label="Code postal" inputMode="numeric" value={form.postal_code} onChange={set('postal_code')} />
          <Field type="text" label="Ville" value={form.city} onChange={set('city')} />
        </div>
        {q.newClientError && <p className={`${styles.hint} ${styles.warn}`} role="alert">{q.newClientError}</p>}
      </div>
    </Sheet>
  )
}

export function TransportSheet({ q }: { q: TransportState }) {
  return (
    <Sheet
      open={q.showTransport}
      onOpenChange={q.setShowTransport}
      title="Transport"
      onConfirm={() => void q.handleAddTransport()}
      confirmLabel="Ajouter"
    >
      <div className={styles.detail}>
        <div className={styles.total}>
          <small>Coût du carburant</small>
          <b>{fmt(q.transportCost)}</b>
        </div>
        <div className={styles.fields}>
          <Field type="number" label="Distance A/R (km)" min={1} value={q.transportKm} onChange={v => q.setTransportKm(v ?? 1)} />
          <Field type="number" label="Conso (L/100 km)" min={1} decimals={2} value={q.transportConso} onChange={v => q.setTransportConso(v ?? 1)} />
          <Field type="number" label="Carburant (€/L)" min={0} decimals={3} value={q.transportPrixL} onChange={v => q.setTransportPrixL(v ?? 0)} />
        </div>
        <p className={styles.hint}>Volume de carburant : {q.transportLiters.toFixed(2).replace('.', ',')}&nbsp;L. Ligne interne, absente du PDF du client.</p>
      </div>
    </Sheet>
  )
}

export function EquipmentSheet({ q }: { q: EquipmentState }) {
  return (
    <Sheet
      open={q.showEquipment}
      onOpenChange={q.setShowEquipment}
      title="Équipement amorti"
      onConfirm={() => void q.handleAddEquipment()}
      confirmLabel="Ajouter"
      confirmDisabled={q.equipmentPurchase <= 0 || q.equipmentUses <= 0}
    >
      <div className={styles.detail}>
        <div className={styles.total}>
          <small>Coût par usage</small>
          <b>{fmt(q.equipmentPurchase > 0 ? q.equipmentCostPerUse : 0)}</b>
        </div>
        <div className={styles.fields}>
          <Field type="text" label="Équipement" placeholder="Aspirateur industriel" value={q.equipmentName} onChange={e => q.setEquipmentName(e.target.value)} />
          <Field type="number" label="Prix d'achat (€)" min={0} decimals={2} value={q.equipmentPurchase || null} onChange={v => q.setEquipmentPurchase(v ?? 0)} />
          <Field type="number" label="Usages sur la vie" min={1} decimals={0} value={q.equipmentUses} onChange={v => q.setEquipmentUses(v ?? 1)} />
        </div>
        <p className={styles.hint}>Le coût par usage est ajouté à votre coût interne, sans modifier les prix visibles.</p>
      </div>
    </Sheet>
  )
}

