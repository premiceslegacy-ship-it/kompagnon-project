'use client'

import React, { useState, useRef } from 'react'
import {
  Plus, Trash2, Pencil, Check, X,
  Package, Building2, Truck, HelpCircle, Loader2,
  ScanLine, AlertTriangle, Receipt,
} from 'lucide-react'
import type { ChantierExpense } from '@/lib/data/queries/chantier-profitability'
import type { CatalogMaterial } from '@/lib/data/queries/catalog'
import {
  createChantierExpense,
  updateChantierExpense,
  deleteChantierExpense,
  uploadExpenseReceipt,
  getReceiptSignedUrl,
} from '@/lib/data/mutations/chantier-expenses'
import type { ScanReceiptResult } from '@/app/api/ai/scan-receipt/route'
import { getRentalCatalog, RENTAL_UNIT_LABELS, computeRentalDuration, findRentalItem, type RentalUnit } from '@/lib/sectors/rental-catalog'
import { computeFuel, DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 0) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: decimals })
}

const CATEGORIES: { value: ChantierExpense['category']; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'materiel',       label: 'Matériel',       Icon: Package },
  { value: 'sous_traitance', label: 'Sous-traitance', Icon: Building2 },
  { value: 'location',       label: 'Location',       Icon: Truck },
  { value: 'transport',      label: 'Transport',      Icon: Truck },
  { value: 'autre',          label: 'Autre',          Icon: HelpCircle },
]

function catLabel(v: ChantierExpense['category']) {
  return CATEGORIES.find(c => c.value === v)?.label ?? v
}

function catIcon(v: ChantierExpense['category']) {
  const C = CATEGORIES.find(c => c.value === v)?.Icon ?? HelpCircle
  return <C className="w-3.5 h-3.5" />
}

// ─── Form state ───────────────────────────────────────────────────────────────

type ExpenseFormState = {
  category: ChantierExpense['category']
  label: string
  amountHt: string
  vatRate: string
  expenseDate: string
  supplierName: string
  quantity: string
  unit: string
  unitPriceHt: string
  materialId: string | null
  rentalSubcategory: string
  rentalItemLabel: string
  rentalUnit: RentalUnit
  rentalStartDate: string
  rentalEndDate: string
  transportSubcategory: string
  transportKm: string
  transportConsumption: string
  transportFuelPrice: string
  receiptStoragePath: string | null
}

function emptyForm(today: string): ExpenseFormState {
  return {
    category: 'materiel', label: '', amountHt: '', vatRate: '20', expenseDate: today,
    supplierName: '', quantity: '', unit: '', unitPriceHt: '', materialId: null,
    rentalSubcategory: '', rentalItemLabel: '', rentalUnit: 'j', rentalStartDate: '', rentalEndDate: '',
    transportSubcategory: 'carburant',
    transportKm: '', transportConsumption: String(DEFAULT_CONSUMPTION_L_PER_100KM), transportFuelPrice: String(DEFAULT_FUEL_PRICE_EUR_PER_L),
    receiptStoragePath: null,
  }
}

// ─── Formulaire ───────────────────────────────────────────────────────────────

function ExpenseForm({
  chantierId, initial, editingId, orgSector, materials, onSaved, onCancel,
}: {
  chantierId: string
  initial: ExpenseFormState
  editingId: string | null
  orgSector: string | null
  materials: CatalogMaterial[]
  onSaved: (expense: ChantierExpense) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<ExpenseFormState>(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = (k: keyof ExpenseFormState, v: string | null) => setForm(f => ({ ...f, [k]: v as never }))
  const rentalCatalog = getRentalCatalog(orgSector)

  const computedAmount = (() => {
    if (form.category === 'transport' && form.transportSubcategory === 'carburant') {
      const km = parseFloat(form.transportKm) || 0
      const conso = parseFloat(form.transportConsumption) || 0
      const prix = parseFloat(form.transportFuelPrice) || 0
      return computeFuel({ km, consumption: conso, pricePerLiter: prix })
    }
    const qty = parseFloat(form.quantity) || 0
    const pu = parseFloat(form.unitPriceHt) || 0
    if (qty > 0 && pu > 0) return { liters: 0, costHt: Math.round(qty * pu * 100) / 100 }
    return null
  })()

  React.useEffect(() => {
    if (form.category !== 'location') return
    if (!form.rentalStartDate || !form.rentalEndDate) return
    const dur = computeRentalDuration(form.rentalStartDate, form.rentalEndDate, form.rentalUnit)
    setForm(f => ({ ...f, quantity: String(dur), unit: f.unit || f.rentalUnit }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.rentalStartDate, form.rentalEndDate, form.rentalUnit, form.category])

  React.useEffect(() => {
    if (form.category !== 'location' || !form.rentalSubcategory || form.rentalSubcategory === 'autre') return
    const item = findRentalItem(form.rentalSubcategory)
    if (item) {
      setForm(f => ({
        ...f,
        rentalItemLabel: item.label,
        rentalUnit: item.defaultUnit,
        label: f.label || item.label,
        unit: f.unit || item.defaultUnit,
      }))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.rentalSubcategory])

  const handlePickMaterial = (id: string) => {
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    let amt: number
    if (computedAmount) amt = computedAmount.costHt
    else amt = parseFloat(form.amountHt.replace(',', '.'))
    if (isNaN(amt) || amt < 0) { setError('Montant invalide.'); return }

    setSaving(true)
    setError(null)

    const subcategory =
      form.category === 'location' ? (form.rentalSubcategory || null) :
      form.category === 'transport' ? (form.transportSubcategory || null) :
      null

    const rentalLabel = form.category === 'location'
      ? (form.rentalItemLabel || (form.rentalSubcategory ? findRentalItem(form.rentalSubcategory)?.label : null) || null)
      : null

    const payload = {
      chantierId,
      category: form.category,
      label: form.label.trim() || rentalLabel || '(sans libellé)',
      amountHt: amt,
      vatRate: parseFloat(form.vatRate) || 20,
      expenseDate: form.expenseDate,
      supplierName: form.supplierName.trim() || null,
      receiptStoragePath: form.receiptStoragePath,
      quantity: form.quantity ? parseFloat(form.quantity) : null,
      unit: form.unit || null,
      unitPriceHt: form.unitPriceHt ? parseFloat(form.unitPriceHt) : null,
      materialId: form.materialId,
      subcategory,
      transportKm: form.category === 'transport' && form.transportSubcategory === 'carburant' ? parseFloat(form.transportKm) || null : null,
      transportConsumption: form.category === 'transport' && form.transportSubcategory === 'carburant' ? parseFloat(form.transportConsumption) || null : null,
      transportFuelPrice: form.category === 'transport' && form.transportSubcategory === 'carburant' ? parseFloat(form.transportFuelPrice) || null : null,
      rentalItemLabel: rentalLabel,
      rentalStartDate: form.category === 'location' && form.rentalStartDate ? form.rentalStartDate : null,
      rentalEndDate:   form.category === 'location' && form.rentalEndDate   ? form.rentalEndDate   : null,
    }

    if (editingId) {
      const { error: err } = await updateChantierExpense(editingId, chantierId, payload)
      setSaving(false)
      if (err) { setError(err); return }
      onSaved({
        id: editingId, chantier_id: chantierId, category: form.category,
        label: payload.label, amount_ht: amt, vat_rate: payload.vatRate,
        expense_date: form.expenseDate, supplier_name: payload.supplierName,
        received_invoice_id: null, receipt_storage_path: form.receiptStoragePath,
        notes: null, created_by: null, created_at: '',
      })
    } else {
      const { error: err, id } = await createChantierExpense(payload)
      setSaving(false)
      if (err || !id) { setError(err ?? 'Erreur inconnue.'); return }
      onSaved({
        id, chantier_id: chantierId, category: form.category,
        label: payload.label, amount_ht: amt, vat_rate: payload.vatRate,
        expense_date: form.expenseDate, supplier_name: payload.supplierName,
        received_invoice_id: null, receipt_storage_path: form.receiptStoragePath,
        notes: null, created_by: null, created_at: new Date().toISOString(),
      })
    }
  }

  const inputCls = 'input w-full text-sm'

  return (
    <form onSubmit={handleSubmit} className="rounded-xl border border-accent/30 bg-surface dark:bg-[#121212] p-4 space-y-3">
      <div className="flex gap-2 flex-wrap">
        <select
          className="input input-sm flex-1 min-w-[130px]"
          value={form.category}
          onChange={e => set('category', e.target.value)}
          required
        >
          {CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <input
          className="input input-sm flex-[2] min-w-[160px]"
          placeholder="Libellé *"
          value={form.label}
          onChange={e => set('label', e.target.value)}
        />
      </div>

      {/* Location */}
      {form.category === 'location' && (
        <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3 space-y-2">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Type d&apos;équipement loué</p>
          {rentalCatalog.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              <select className="input input-sm flex-1 min-w-[180px]" value={form.rentalSubcategory} onChange={e => set('rentalSubcategory', e.target.value)}>
                <option value="">— Sélectionner —</option>
                {rentalCatalog.map(it => <option key={it.slug} value={it.slug}>{it.label}</option>)}
                <option value="autre">Autre…</option>
              </select>
              {form.rentalSubcategory === 'autre' && (
                <input className="input input-sm flex-1 min-w-[180px]" placeholder="Précisez l'équipement" value={form.rentalItemLabel} onChange={e => set('rentalItemLabel', e.target.value)} />
              )}
            </div>
          ) : (
            <input className={inputCls} placeholder="Équipement loué" value={form.rentalItemLabel} onChange={e => set('rentalItemLabel', e.target.value)} />
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input type="date" className="input input-sm" value={form.rentalStartDate} onChange={e => set('rentalStartDate', e.target.value)} />
            <input type="date" className="input input-sm" value={form.rentalEndDate} onChange={e => set('rentalEndDate', e.target.value)} />
            <select className="input input-sm" value={form.rentalUnit} onChange={e => set('rentalUnit', e.target.value)}>
              {(['j','sem','mois'] as RentalUnit[]).map(u => <option key={u} value={u}>{RENTAL_UNIT_LABELS[u]}</option>)}
            </select>
            <input type="text" inputMode="decimal" className="input input-sm tabular-nums" placeholder="Prix unitaire HT" value={form.unitPriceHt} onChange={e => set('unitPriceHt', e.target.value)} />
          </div>
          {form.quantity && form.unitPriceHt && (
            <p className="text-xs text-secondary">
              {form.quantity} × {form.unitPriceHt}€ = <strong className="text-primary">{(parseFloat(form.quantity) * parseFloat(form.unitPriceHt)).toFixed(2)}€ HT</strong>
            </p>
          )}
        </div>
      )}

      {/* Transport */}
      {form.category === 'transport' && (
        <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3 space-y-2">
          <div className="flex gap-1 p-1 rounded-lg bg-[var(--elevation-0)] w-fit">
            {(['carburant', 'peage', 'autre'] as const).map(sub => (
              <button key={sub} type="button" onClick={() => set('transportSubcategory', sub)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${form.transportSubcategory === sub ? 'bg-accent text-white' : 'text-secondary hover:text-primary'}`}>
                {sub === 'carburant' ? 'Carburant' : sub === 'peage' ? 'Péage' : 'Autre'}
              </button>
            ))}
          </div>
          {form.transportSubcategory === 'carburant' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-secondary uppercase font-semibold">Distance (km)</label>
                  <input type="text" inputMode="decimal" className="input input-sm w-full" value={form.transportKm} onChange={e => set('transportKm', e.target.value)} placeholder="ex : 80" />
                </div>
                <div>
                  <label className="text-[10px] text-secondary uppercase font-semibold">Conso (L/100 km)</label>
                  <input type="text" inputMode="decimal" className="input input-sm w-full" value={form.transportConsumption} onChange={e => set('transportConsumption', e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] text-secondary uppercase font-semibold">Prix carburant (€/L)</label>
                  <input type="text" inputMode="decimal" className="input input-sm w-full" value={form.transportFuelPrice} onChange={e => set('transportFuelPrice', e.target.value)} />
                </div>
              </div>
              {computedAmount && computedAmount.liters > 0 && (
                <p className="text-xs text-secondary">
                  {computedAmount.liters.toFixed(2)} L · <strong className="text-primary">{computedAmount.costHt.toFixed(2)}€ HT</strong>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* Matériel catalogue */}
      {form.category === 'materiel' && materials.length > 0 && (
        <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3 space-y-2">
          <div className="flex gap-2 items-center">
            <select className="input input-sm flex-1" value={form.materialId ?? ''} onChange={e => handlePickMaterial(e.target.value)}>
              <option value="">Lier au catalogue (facultatif)</option>
              {materials.filter(m => m.is_active).map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.reference ? ` · ${m.reference}` : ''}</option>
              ))}
            </select>
            {form.materialId && (
              <button type="button" onClick={() => set('materialId', null)} className="text-secondary hover:text-primary p-1"><X className="w-3.5 h-3.5" /></button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input type="text" inputMode="decimal" className="input input-sm" placeholder="Quantité" value={form.quantity} onChange={e => set('quantity', e.target.value)} />
            <input type="text" className="input input-sm" placeholder="Unité (u, m², kg…)" value={form.unit} onChange={e => set('unit', e.target.value)} />
            <input type="text" inputMode="decimal" className="input input-sm" placeholder="Prix HT/unité" value={form.unitPriceHt} onChange={e => set('unitPriceHt', e.target.value)} />
          </div>
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        <input
          className="input input-sm w-32"
          type="text"
          inputMode="decimal"
          placeholder={computedAmount ? 'Auto-calculé' : 'Montant HT *'}
          value={computedAmount ? computedAmount.costHt.toFixed(2) : form.amountHt}
          onChange={e => set('amountHt', e.target.value)}
          disabled={!!computedAmount}
          required={!computedAmount}
        />
        <select className="input input-sm w-24" value={form.vatRate} onChange={e => set('vatRate', e.target.value)}>
          <option value="0">TVA 0%</option>
          <option value="5.5">TVA 5,5%</option>
          <option value="10">TVA 10%</option>
          <option value="20">TVA 20%</option>
        </select>
        <input className="input input-sm flex-1 min-w-[120px]" type="date" value={form.expenseDate} onChange={e => set('expenseDate', e.target.value)} required />
      </div>
      <input className="input input-sm w-full" placeholder="Fournisseur (facultatif)" value={form.supplierName} onChange={e => set('supplierName', e.target.value)} />

      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="px-4 py-2 rounded-full border border-[var(--elevation-border)] text-xs font-semibold flex items-center gap-1.5">
          <X className="w-3.5 h-3.5" /> Annuler
        </button>
        <button type="submit" disabled={saving} className="px-4 py-2 rounded-full bg-accent text-black text-xs font-bold disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          {editingId ? 'Mettre à jour' : 'Ajouter'}
        </button>
      </div>
    </form>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function MaintenanceDepensesSection({
  chantierId,
  initialExpenses,
  orgSector,
  materials,
}: {
  chantierId: string
  initialExpenses: ChantierExpense[]
  orgSector: string | null
  materials: CatalogMaterial[]
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [expenses, setExpenses] = useState<ChantierExpense[]>(initialExpenses)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState<ChantierExpense | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expenseFilter, setExpenseFilter] = useState<ChantierExpense['category'] | 'all'>('all')

  const scanInputRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scannedFormOverride, setScannedFormOverride] = useState<Partial<ExpenseFormState> | null>(null)
  const [viewingReceiptPath, setViewingReceiptPath] = useState<string | null>(null)
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({})

  const filteredExpenses = expenseFilter === 'all' ? expenses : expenses.filter(e => e.category === expenseFilter)

  const totalHt = expenses.reduce((s, e) => s + e.amount_ht, 0)
  const byCategory = Object.fromEntries(
    CATEGORIES.map(c => [c.value, expenses.filter(e => e.category === c.value).reduce((s, e) => s + e.amount_ht, 0)])
  ) as Record<ChantierExpense['category'], number>

  const handleScan = async (file: File) => {
    setScanning(true)
    setScanError(null)
    const uploadFormData = new FormData()
    uploadFormData.append('file', file)
    const [ocrRes, uploadRes] = await Promise.all([
      (async () => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/ai/scan-receipt', { method: 'POST', body: fd })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: 'Erreur réseau' }))
          return { error: error ?? "Erreur lors de l'analyse." }
        }
        return res.json() as Promise<ScanReceiptResult>
      })(),
      uploadExpenseReceipt(chantierId, uploadFormData),
    ])
    setScanning(false)

    if ('error' in ocrRes) { setScanError(ocrRes.error); return }

    const warnings: string[] = []
    if (uploadRes.error) warnings.push(uploadRes.error)
    if (ocrRes.amountSource === 'unknown') warnings.push('Montant non détecté - renseignez le montant manuellement.')
    if (ocrRes.confidence === 'low') warnings.push('Ticket peu lisible - vérifiez les valeurs avant d\'enregistrer.')
    if (warnings.length) setScanError(warnings.join(' '))

    setScannedFormOverride({
      label: ocrRes.label || '',
      amountHt: ocrRes.amountHt != null ? String(ocrRes.amountHt) : '',
      vatRate: ocrRes.vatRate != null ? String(ocrRes.vatRate) : '20',
      expenseDate: ocrRes.expenseDate ?? today,
      supplierName: ocrRes.supplierName ?? '',
      category: ocrRes.category,
      receiptStoragePath: uploadRes.storagePath,
      ...(ocrRes.category === 'transport' ? {
        transportSubcategory: ocrRes.subcategory === 'peage' ? 'peage' : ocrRes.subcategory === 'carburant' ? 'carburant' : 'autre',
      } : {}),
    })
    setEditingExpense(null)
    setShowAddForm(true)
  }

  const handleViewReceipt = async (path: string) => {
    if (receiptUrls[path]) { setViewingReceiptPath(path); return }
    const { url } = await getReceiptSignedUrl(path)
    if (url) { setReceiptUrls(prev => ({ ...prev, [path]: url })); setViewingReceiptPath(path) }
  }

  const handleExpenseSaved = (saved: ChantierExpense) => {
    setExpenses(prev => {
      const existing = prev.find(e => e.id === saved.id)
      return existing ? prev.map(e => e.id === saved.id ? saved : e) : [saved, ...prev]
    })
    setShowAddForm(false)
    setEditingExpense(null)
    setScannedFormOverride(null)
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const { error } = await deleteChantierExpense(id, chantierId)
    setDeletingId(null)
    if (error) { alert(error); return }
    setExpenses(prev => prev.filter(e => e.id !== id))
  }

  return (
    <div className="space-y-3">
      {/* En-tête + actions */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <p className="text-xs font-bold text-secondary uppercase tracking-wider">Dépenses</p>
          {totalHt > 0 && <p className="text-xs text-secondary mt-0.5">Total : <span className="font-semibold text-primary">{fmt(totalHt)} HT</span></p>}
        </div>
        {!showAddForm && !editingExpense && (
          <div className="flex items-center gap-2">
            <input
              ref={scanInputRef}
              type="file"
              accept="image/*,application/pdf"
              capture="environment"
              className="hidden"
              onChange={e => {
                const file = e.target.files?.[0]
                if (file) handleScan(file)
                e.target.value = ''
              }}
            />
            <button
              onClick={() => scanInputRef.current?.click()}
              disabled={scanning}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[var(--elevation-border)] text-xs font-semibold text-secondary hover:text-primary disabled:opacity-50"
            >
              {scanning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ScanLine className="w-3.5 h-3.5" />}
              Scanner
            </button>
            <button
              onClick={() => { setScanError(null); setScannedFormOverride(null); setShowAddForm(true) }}
              className="flex items-center gap-1 text-xs font-semibold text-accent hover:opacity-80"
            >
              <Plus size={12} /> Ajouter
            </button>
          </div>
        )}
      </div>

      {scanError && (
        <p className="text-xs text-yellow-500 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {scanError}
        </p>
      )}

      {/* Lightbox ticket */}
      {viewingReceiptPath && receiptUrls[viewingReceiptPath] && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setViewingReceiptPath(null)}>
          <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
            <button onClick={() => setViewingReceiptPath(null)} className="absolute -top-8 right-0 text-white/70 hover:text-white">
              <X className="w-5 h-5" />
            </button>
            <img src={receiptUrls[viewingReceiptPath]} alt="Ticket" className="w-full rounded-xl object-contain max-h-[80vh]" />
          </div>
        </div>
      )}

      {/* Formulaire ajout */}
      {showAddForm && (
        <ExpenseForm
          chantierId={chantierId}
          initial={{ ...emptyForm(today), ...(scannedFormOverride ?? {}) }}
          editingId={null}
          orgSector={orgSector}
          materials={materials}
          onSaved={expense => { setScannedFormOverride(null); handleExpenseSaved(expense) }}
          onCancel={() => { setShowAddForm(false); setScannedFormOverride(null) }}
        />
      )}

      {/* Filtres catégorie */}
      {expenses.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {(['all', 'materiel', 'sous_traitance', 'location', 'transport', 'autre'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setExpenseFilter(cat)}
              className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                expenseFilter === cat
                  ? 'bg-accent text-black border-accent font-semibold'
                  : 'border-[var(--elevation-border)] text-secondary hover:text-primary'
              }`}
            >
              {cat === 'all' ? `Tout (${expenses.length})` : `${catLabel(cat)}${byCategory[cat] > 0 ? ` · ${fmt(byCategory[cat])}` : ''}`}
            </button>
          ))}
        </div>
      )}

      {/* Liste dépenses */}
      {filteredExpenses.length === 0 && !showAddForm ? (
        <div className="text-center py-6 text-secondary">
          <Package className="w-7 h-7 mx-auto mb-2 opacity-25" />
          <p className="text-xs">{expenseFilter === 'all' ? 'Aucune dépense enregistrée.' : `Aucune dépense en catégorie « ${catLabel(expenseFilter)} ».`}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredExpenses.map(exp => (
            <div key={exp.id}>
              {editingExpense?.id === exp.id ? (
                <ExpenseForm
                  chantierId={chantierId}
                  initial={{
                    ...emptyForm(today),
                    category: exp.category,
                    label: exp.label,
                    amountHt: String(exp.amount_ht),
                    vatRate: String(exp.vat_rate),
                    expenseDate: exp.expense_date,
                    supplierName: exp.supplier_name ?? '',
                  }}
                  editingId={exp.id}
                  orgSector={orgSector}
                  materials={materials}
                  onSaved={handleExpenseSaved}
                  onCancel={() => setEditingExpense(null)}
                />
              ) : (
                <div className="rounded-xl border border-[var(--elevation-border)] bg-surface dark:bg-[#121212] p-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[var(--elevation-1)] flex items-center justify-center text-secondary flex-shrink-0">
                    {catIcon(exp.category)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">{exp.label}</p>
                    <p className="text-xs text-secondary">
                      {catLabel(exp.category)}
                      {exp.supplier_name ? ` · ${exp.supplier_name}` : ''}
                      {' · '}{new Date(exp.expense_date).toLocaleDateString('fr-FR')}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-primary">{fmt(exp.amount_ht)} HT</p>
                    {exp.vat_rate > 0 && (
                      <p className="text-xs text-secondary">{fmt(exp.amount_ht * (1 + exp.vat_rate / 100))} TTC</p>
                    )}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    {exp.receipt_storage_path && (
                      <button onClick={() => handleViewReceipt(exp.receipt_storage_path!)} className="p-1.5 text-secondary hover:text-accent transition-colors rounded-lg hover:bg-accent/10" title="Voir le ticket">
                        <Receipt className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button onClick={() => { setEditingExpense(exp); setShowAddForm(false) }} className="p-1.5 text-secondary hover:text-primary transition-colors rounded-lg hover:bg-secondary/10">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(exp.id)}
                      disabled={deletingId === exp.id}
                      className="p-1.5 text-secondary hover:text-red-500 transition-colors rounded-lg hover:bg-red-500/10 disabled:opacity-40"
                    >
                      {deletingId === exp.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Répartition */}
      {totalHt > 0 && (
        <div className="rounded-xl border border-[var(--elevation-border)] bg-base p-3 space-y-2">
          <p className="text-xs font-bold text-secondary uppercase tracking-wider">Répartition</p>
          {CATEGORIES.filter(c => byCategory[c.value] > 0).map(c => {
            const pct = totalHt > 0 ? (byCategory[c.value] / totalHt) * 100 : 0
            return (
              <div key={c.value} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <c.Icon className="w-3.5 h-3.5 text-secondary flex-shrink-0" />
                  <span className="text-secondary flex-1">{c.label}</span>
                  <span className="font-semibold text-primary">{fmt(byCategory[c.value])}</span>
                  <span className="text-secondary w-10 text-right">{pct.toFixed(0)} %</span>
                </div>
                <div className="h-1.5 rounded-full bg-secondary/10 overflow-hidden">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
