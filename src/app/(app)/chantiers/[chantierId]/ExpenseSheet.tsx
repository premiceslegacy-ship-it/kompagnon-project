'use client'
// @atelier-migrated
// Dépense du chantier : matériel, sous-traitance, location, transport, autre.

import { useEffect, useState } from 'react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import type { ChantierExpense } from '@/lib/data/queries/chantier-profitability'
import type { CatalogMaterial } from '@/lib/data/queries/catalog'
import { createChantierExpense, updateChantierExpense } from '@/lib/data/mutations/chantier-expenses'
import { getRentalCatalog, RENTAL_UNIT_LABELS, computeRentalDuration, findRentalItem, type RentalUnit } from '@/lib/sectors/rental-catalog'
import { DateRow } from '../FormRows'
import { EXPENSE_CATEGORIES, buildExpensePayload, computedExpenseAmount, emptyExpenseForm, fmtMoney, type ExpenseFormState } from './rentabiliteModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'

const NB = ' '

export default function ExpenseSheet({ chantierId, expense, override, today, orgSector, materials, canDelete, onDelete, onViewReceipt, onSaved, onClose }: {
  chantierId: string
  expense: ChantierExpense | null
  override: Partial<ExpenseFormState> | null
  today: string
  orgSector: string | null
  materials: CatalogMaterial[]
  canDelete: boolean
  onDelete: (expense: ChantierExpense) => void
  onViewReceipt: (path: string) => void
  onSaved: (expense: ChantierExpense) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<ExpenseFormState>(() => expense
    ? {
        ...emptyExpenseForm(today),
        category: expense.category,
        label: expense.label,
        amountHt: String(expense.amount_ht),
        vatRate: String(expense.vat_rate),
        expenseDate: expense.expense_date,
        supplierName: expense.supplier_name ?? '',
        notes: expense.notes ?? '',
        receiptStoragePath: expense.receipt_storage_path,
      }
    : { ...emptyExpenseForm(today), ...(override ?? {}) })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof ExpenseFormState, v: string | null) => setForm(f => ({ ...f, [k]: v as never }))
  const rentalCatalog = getRentalCatalog(orgSector)
  const computed = computedExpenseAmount(form)

  // Pré-remplit la durée de location quand les dates changent
  useEffect(() => {
    if (form.category !== 'location' || !form.rentalStartDate || !form.rentalEndDate) return
    const dur = computeRentalDuration(form.rentalStartDate, form.rentalEndDate, form.rentalUnit)
    setForm(f => ({ ...f, quantity: String(dur), unit: f.unit || f.rentalUnit }))
  }, [form.rentalStartDate, form.rentalEndDate, form.rentalUnit, form.category])

  // Un équipement du catalogue de location préremplit libellé et unité
  useEffect(() => {
    if (form.category !== 'location' || !form.rentalSubcategory || form.rentalSubcategory === 'autre') return
    const item = findRentalItem(form.rentalSubcategory)
    if (item) setForm(f => ({ ...f, rentalItemLabel: item.label, rentalUnit: item.defaultUnit, label: f.label || item.label, unit: f.unit || item.defaultUnit }))
  }, [form.rentalSubcategory, form.category])

  // Un matériau du catalogue préremplit libellé, unité et prix
  const pickMaterial = (id: string) => {
    if (!id) { set('materialId', null); return }
    const mat = materials.find(m => m.id === id)
    if (!mat) return
    setForm(f => ({
      ...f,
      materialId: id,
      label: f.label || mat.name,
      unit: mat.unit ?? f.unit,
      unitPriceHt: mat.purchase_price != null ? String(mat.purchase_price) : f.unitPriceHt,
    }))
  }

  const submit = async () => {
    const amt = computed ? computed.costHt : parseFloat(form.amountHt.replace(',', '.'))
    if (isNaN(amt) || amt < 0) { setError('Montant invalide.'); return }
    setSaving(true)
    setError(null)
    const payload = buildExpensePayload(chantierId, form, amt)
    const base = {
      chantier_id: chantierId, category: form.category, label: payload.label, amount_ht: amt, vat_rate: payload.vatRate,
      expense_date: form.expenseDate, supplier_name: payload.supplierName, received_invoice_id: null,
      receipt_storage_path: form.receiptStoragePath, notes: payload.notes, created_by: null,
    }
    if (expense) {
      const { error: err } = await updateChantierExpense(expense.id, chantierId, payload)
      setSaving(false)
      if (err) { setError(err); return }
      onSaved({ ...base, id: expense.id, created_at: '' })
    } else {
      const { error: err, id } = await createChantierExpense(payload)
      setSaving(false)
      if (err || !id) { setError(err ?? 'Erreur inconnue.'); return }
      onSaved({ ...base, id, created_at: new Date().toISOString() })
    }
  }

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title={expense ? 'Modifier la dépense' : 'Nouvelle dépense'}
      confirmLabel={expense ? 'Mettre à jour' : 'Ajouter'}
      confirmLoading={saving}
      onConfirm={submit}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="select" label="Catégorie" value={form.category} onChange={e => set('category', e.target.value)}>
            {EXPENSE_CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Field>
          <Field type="text" label="Libellé" placeholder="Carrelage grès cérame" value={form.label} onChange={e => set('label', e.target.value)} />
        </div>

        {form.category === 'location' && (
          <div className={styles.fields}>
            {rentalCatalog.length > 0 ? (
              <>
                <Field type="select" label="Équipement loué" value={form.rentalSubcategory} onChange={e => set('rentalSubcategory', e.target.value)}>
                  <option value="">Sélectionner</option>
                  {rentalCatalog.map(it => <option key={it.slug} value={it.slug}>{it.label}</option>)}
                  <option value="autre">Autre…</option>
                </Field>
                {form.rentalSubcategory === 'autre' && (
                  <Field type="text" label="Précisez" placeholder="Équipement" value={form.rentalItemLabel} onChange={e => set('rentalItemLabel', e.target.value)} />
                )}
              </>
            ) : (
              <Field type="text" label="Équipement loué" value={form.rentalItemLabel} onChange={e => set('rentalItemLabel', e.target.value)} />
            )}
            <DateRow label="Du" value={form.rentalStartDate} onChange={v => set('rentalStartDate', v)} />
            <DateRow label="Au" value={form.rentalEndDate} onChange={v => set('rentalEndDate', v)} />
            <Field type="select" label="Unité" value={form.rentalUnit} onChange={e => set('rentalUnit', e.target.value)}>
              {(['j', 'sem', 'mois'] as RentalUnit[]).map(u => <option key={u} value={u}>{RENTAL_UNIT_LABELS[u]}</option>)}
            </Field>
            <Field type="text" label="Prix unitaire HT (€)" inputMode="decimal" value={form.unitPriceHt} onChange={e => set('unitPriceHt', e.target.value)}
              hint={form.quantity && form.unitPriceHt ? `${form.quantity} × ${form.unitPriceHt} € = ${(parseFloat(form.quantity) * parseFloat(form.unitPriceHt)).toFixed(2)} € HT` : undefined} />
          </div>
        )}

        {form.category === 'transport' && (
          <>
            <SegmentedControl
              fullWidth
              label="Type de frais"
              options={[{ value: 'carburant', label: 'Carburant' }, { value: 'peage', label: 'Péage' }, { value: 'autre', label: 'Autre' }]}
              value={form.transportSubcategory}
              onChange={v => set('transportSubcategory', v)}
            />
            {form.transportSubcategory === 'carburant' && (
              <div className={styles.fields}>
                <Field type="text" label="Distance (km)" inputMode="decimal" placeholder="80" value={form.transportKm} onChange={e => set('transportKm', e.target.value)} />
                <Field type="text" label="Conso (L/100 km)" inputMode="decimal" value={form.transportConsumption} onChange={e => set('transportConsumption', e.target.value)} />
                <Field type="text" label="Prix du carburant (€/L)" inputMode="decimal" value={form.transportFuelPrice} onChange={e => set('transportFuelPrice', e.target.value)}
                  hint={computed && computed.liters > 0 ? `${computed.liters.toFixed(2)} L · ${computed.costHt.toFixed(2)} € HT` : undefined} />
              </div>
            )}
          </>
        )}

        {form.category === 'materiel' && materials.length > 0 && (
          <div className={styles.fields}>
            <Field type="select" label="Lier au catalogue" value={form.materialId ?? ''} onChange={e => pickMaterial(e.target.value)}>
              <option value="">Aucun (facultatif)</option>
              {materials.filter(m => m.is_active).map(m => <option key={m.id} value={m.id}>{m.name}{m.reference ? ` · ${m.reference}` : ''}</option>)}
            </Field>
            <Field type="text" label="Quantité" inputMode="decimal" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
            <Field type="text" label="Unité" placeholder="u, m², kg…" value={form.unit} onChange={e => set('unit', e.target.value)} />
            <Field type="text" label="Prix HT par unité (€)" inputMode="decimal" value={form.unitPriceHt} onChange={e => set('unitPriceHt', e.target.value)} />
          </div>
        )}

        <div className={styles.fields}>
          <Field
            type="text"
            label="Montant HT (€)"
            inputMode="decimal"
            value={computed ? computed.costHt.toFixed(2) : form.amountHt}
            onChange={e => set('amountHt', e.target.value)}
            disabled={!!computed}
            hint={computed ? 'Calculé automatiquement.' : undefined}
          />
          <Field type="select" label="TVA" value={form.vatRate} onChange={e => set('vatRate', e.target.value)}>
            <option value="0">0{NB}%</option>
            <option value="5.5">5,5{NB}%</option>
            <option value="10">10{NB}%</option>
            <option value="20">20{NB}%</option>
          </Field>
          <DateRow label="Date" value={form.expenseDate} onChange={v => set('expenseDate', v)} required />
          <Field type="text" label="Fournisseur" placeholder="Facultatif" value={form.supplierName} onChange={e => set('supplierName', e.target.value)} />
        </div>
        {form.amountHt && !computed && form.vatRate !== '0' && !isNaN(parseFloat(form.amountHt.replace(',', '.'))) && (
          <p className={screen.note}>Soit {fmtMoney(parseFloat(form.amountHt.replace(',', '.')) * (1 + parseFloat(form.vatRate) / 100), 2)}{NB}TTC.</p>
        )}
        {expense && (expense.receipt_storage_path || canDelete) && (
          <ListGroup>
            {expense.receipt_storage_path && <ListRow title="Voir le ticket joint" onClick={() => { onClose(); onViewReceipt(expense.receipt_storage_path!) }} />}
            {canDelete && (
              <li className={styles.destructiveRow}>
                <button type="button" onClick={() => { onClose(); onDelete(expense) }}>Supprimer la dépense</button>
              </li>
            )}
          </ListGroup>
        )}
        {error && <p className={screen.error} role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}
