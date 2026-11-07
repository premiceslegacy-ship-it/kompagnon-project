'use client'
// @atelier-migrated

import { useState, useTransition } from 'react'
import type { SupplierPriceRequest, SPRStatus } from '@/lib/data/mutations/supplier-price-requests'
import { upsertSupplierPriceRequest, updateSPRStatus, deleteSupplierPriceRequest } from '@/lib/data/mutations/supplier-price-requests'
import type { Supplier } from '@/lib/data/queries/suppliers'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import styles from './Panels.module.css'

const UNITS = ['u', 'h', 'j', 'sem', 'm²', 'ml', 'kg', 'L', 't', 'm³', 'forfait']

const STATUS_CONFIG: Record<SPRStatus, { label: string; pill: StatusPillStatus; action: string | null }> = {
  a_demander: { label: 'À demander', pill: 'neutral', action: 'Demande envoyée au fournisseur' },
  demande: { label: 'Demandé', pill: 'wait', action: 'Prix reçu' },
  recu: { label: 'Reçu', pill: 'wait', action: 'Intégré dans le devis' },
  integre: { label: 'Intégré', pill: 'success', action: null },
}

const STATUS_ORDER: SPRStatus[] = ['a_demander', 'demande', 'recu', 'integre']

type FormState = {
  supplier_id: string
  designation: string
  quantity: number | null
  unit: string
  unit_price_ht: number | null
  notes: string
  valid_until: string
}

const emptyForm = (): FormState => ({
  supplier_id: '', designation: '', quantity: null, unit: '', unit_price_ht: null, notes: '', valid_until: '',
})

/** Prix fournisseur à confirmer avant d'envoyer un devis : ce qu'on demande, ce qu'on a reçu. */
export default function SupplierPriceRequestsPanel({
  quoteId,
  initialRequests,
  suppliers,
}: {
  quoteId: string
  initialRequests: SupplierPriceRequest[]
  suppliers: Supplier[]
}) {
  const [requests, setRequests] = useState<SupplierPriceRequest[]>(initialRequests)
  const [formOpen, setFormOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [isPending, startTransition] = useTransition()
  const [saveError, setSaveError] = useState<string | null>(null)

  const pendingCount = requests.filter(r => r.status !== 'integre').length

  function openNew() {
    setForm(emptyForm())
    setEditingId(null)
    setSaveError(null)
    setFormOpen(true)
  }

  function openEdit(r: SupplierPriceRequest) {
    setForm({
      supplier_id: r.supplier_id ?? '',
      designation: r.designation,
      quantity: r.quantity ?? null,
      unit: r.unit ?? '',
      unit_price_ht: r.unit_price_ht ?? null,
      notes: r.notes ?? '',
      valid_until: r.valid_until ?? '',
    })
    setEditingId(r.id)
    setSaveError(null)
    setFormOpen(true)
  }

  function closeForm() {
    setFormOpen(false)
    setEditingId(null)
    setForm(emptyForm())
    setSaveError(null)
  }

  function handleSave() {
    if (!form.designation.trim()) { setSaveError('La désignation est requise.'); return }
    setSaveError(null)
    startTransition(async () => {
      const res = await upsertSupplierPriceRequest({
        ...(editingId ? { id: editingId } : {}),
        quote_id: quoteId,
        supplier_id: form.supplier_id || null,
        designation: form.designation,
        description: null,
        quantity: form.quantity,
        unit: form.unit || null,
        unit_price_ht: form.unit_price_ht,
        notes: form.notes || null,
        valid_until: form.valid_until || null,
      })
      if (res.error || !res.data) { setSaveError(res.error ?? 'Erreur'); return }
      setRequests(prev => {
        const idx = prev.findIndex(r => r.id === res.data!.id)
        if (idx >= 0) { const u = [...prev]; u[idx] = res.data!; return u }
        return [...prev, res.data!]
      })
      closeForm()
    })
  }

  function handleStatusChange(id: string, next: SPRStatus) {
    setSaveError(null)
    startTransition(async () => {
      const extra: Record<string, string> = {}
      if (next === 'demande') extra.sent_at = new Date().toISOString()
      if (next === 'recu') extra.response_at = new Date().toISOString()
      const result = await updateSPRStatus(id, next, extra as never)
      if (result.error) { setSaveError(result.error); return }
      setRequests(prev => prev.map(r => (r.id === id ? { ...r, status: next, ...extra } : r)))
    })
  }

  function handleDelete(id: string) {
    setSaveError(null)
    startTransition(async () => {
      const result = await deleteSupplierPriceRequest(id)
      if (result.error) { setSaveError(result.error); return }
      setRequests(prev => prev.filter(r => r.id !== id))
      closeForm()
    })
  }

  function detail(req: SupplierPriceRequest): string {
    const parts: string[] = []
    if (req.supplier) parts.push(req.supplier.name)
    if (req.quantity != null) parts.push(`${req.quantity} ${req.unit ?? ''}`.trim())
    if (req.unit_price_ht != null) parts.push(`reçu ${req.unit_price_ht.toLocaleString('fr-FR', { style: 'currency', currency: req.currency })}`)
    if (req.valid_until) parts.push(`valable jusqu’au ${new Date(req.valid_until).toLocaleDateString('fr-FR')}`)
    return parts.join(' · ')
  }

  const unitOptions = form.unit && !UNITS.includes(form.unit) ? [...UNITS, form.unit] : UNITS

  return (
    <div className={styles.stack}>
      <p className={styles.note}>
        Matériaux ou fournitures dont le prix fournisseur reste à confirmer avant d’envoyer ce devis.
        {pendingCount > 0 && ` ${pendingCount} en attente.`}
      </p>
      {saveError && !formOpen && <p className={`${styles.note} ${styles.noteWarn}`} role="alert">{saveError}</p>}

      {requests.length === 0 ? (
        <p className={styles.note}>Aucun achat à consulter pour ce devis.</p>
      ) : (
        <ListGroup>
          {requests.map(req => (
            <ListRow
              key={req.id}
              title={req.designation}
              description={detail(req) || undefined}
              onClick={() => openEdit(req)}
              trailing={<StatusPill status={STATUS_CONFIG[req.status].pill}>{STATUS_CONFIG[req.status].label}</StatusPill>}
            />
          ))}
        </ListGroup>
      )}

      <div className={styles.actions}>
        <Button variant="secondary" size="md" onClick={openNew}>Ajouter un achat</Button>
      </div>

      <Sheet
        open={formOpen}
        onOpenChange={open => { if (!open) closeForm() }}
        title={editingId ? 'Modifier l’achat' : 'Nouvel achat à consulter'}
        onConfirm={handleSave}
        confirmLabel="Enregistrer"
        confirmLoading={isPending}
        confirmDisabled={!form.designation.trim()}
      >
        <div className={styles.stack}>
          {saveError && <p className={`${styles.note} ${styles.noteWarn}`} role="alert">{saveError}</p>}
          <div className={styles.fieldGroup}>
            <Field type="text" label="Désignation" placeholder="Tôle acier S235 2 mm" value={form.designation} onChange={e => setForm(f => ({ ...f, designation: e.target.value }))} />
            <Field type="select" label="Fournisseur" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
              <option value="">Aucun</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Field>
            <Field type="number" label="Quantité" min={0} decimals={2} allowEmpty value={form.quantity} onChange={value => setForm(f => ({ ...f, quantity: value }))} />
            <Field type="select" label="Unité" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}>
              <option value="">Aucune</option>
              {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
            </Field>
            <Field type="date" label="Offre valable jusqu’au" value={form.valid_until} onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))} />
            <Field type="number" label="Prix unitaire HT reçu" hint="À remplir quand le fournisseur répond." min={0} decimals={2} allowEmpty value={form.unit_price_ht} onChange={value => setForm(f => ({ ...f, unit_price_ht: value }))} />
            <Field type="textarea" label="Spécifications" rows={3} placeholder="Épaisseur, finition, délai de livraison…" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </div>

          {editingId && (() => {
            const req = requests.find(r => r.id === editingId)
            const next = req ? STATUS_ORDER[STATUS_ORDER.indexOf(req.status) + 1] as SPRStatus | undefined : undefined
            return (
              <div className={styles.actions}>
                {req && next && STATUS_CONFIG[req.status].action && (
                  <Button variant="secondary" size="md" onClick={() => handleStatusChange(req.id, next)} disabled={isPending}>
                    {STATUS_CONFIG[req.status].action}
                  </Button>
                )}
                <Button variant="destructive" size="md" onClick={() => handleDelete(editingId)} disabled={isPending}>Supprimer cet achat</Button>
              </div>
            )
          })()}
        </div>
      </Sheet>
    </div>
  )
}
