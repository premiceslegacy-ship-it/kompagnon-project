'use client'

import React, { useState, useTransition, useRef } from 'react'
import Link from 'next/link'
import {
  Plus, Trash2, Pencil, Check, X, TrendingUp, TrendingDown, Minus,
  AlertTriangle, Package, Hammer, Truck, Building2, HelpCircle, Loader2, Users, Euro, Target,
  ScanLine, Receipt,
} from 'lucide-react'
import type { ChantierProfitability, ChantierExpense, LaborByMemberEntry } from '@/lib/data/queries/chantier-profitability'
import type { TeamMember } from '@/lib/data/queries/team'
import type { CatalogMaterial } from '@/lib/data/queries/catalog'
import {
  createChantierExpense,
  updateChantierExpense,
  deleteChantierExpense,
  uploadExpenseReceipt,
  getReceiptSignedUrl,
} from '@/lib/data/mutations/chantier-expenses'
import type { ScanReceiptResult } from '@/app/api/ai/scan-receipt/route'
import { linkInvoiceToChantier } from '@/lib/data/mutations/invoices'
import type { InvoiceStub } from '@/lib/data/queries/invoices'
import { updateMemberLaborRate } from '@/lib/data/mutations/team'
import { getRentalCatalog, RENTAL_UNIT_LABELS, computeRentalDuration, findRentalItem, type RentalUnit } from '@/lib/sectors/rental-catalog'
import { computeFuel, DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtMoney(n: number, decimals = 0) {
  return n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: decimals })
}

function fmtPct(n: number) {
  return `${(n * 100).toFixed(1)} %`
}

function fmtHours(h: number) {
  const hh = Math.floor(h)
  const mm = Math.round((h - hh) * 60)
  return mm === 0 ? `${hh}h` : `${hh}h${String(mm).padStart(2, '0')}`
}

const CATEGORIES: { value: ChantierExpense['category']; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
  { value: 'materiel',       label: 'Matériel',         Icon: Package },
  { value: 'sous_traitance', label: 'Sous-traitance',   Icon: Building2 },
  { value: 'location',       label: 'Location',         Icon: Truck },
  { value: 'transport',      label: 'Transport',        Icon: Truck },
  { value: 'autre',          label: 'Autre',            Icon: HelpCircle },
]

function catLabel(v: ChantierExpense['category']) {
  return CATEGORIES.find(c => c.value === v)?.label ?? v
}

function catIcon(v: ChantierExpense['category']) {
  const C = CATEGORIES.find(c => c.value === v)?.Icon ?? HelpCircle
  return <C className="w-3.5 h-3.5" />
}

// ─── Recalcul local ───────────────────────────────────────────────────────────

function recalc(prev: ChantierProfitability, newLaborByMember?: LaborByMemberEntry[]): ChantierProfitability {
  const members = newLaborByMember ?? prev.laborByMember
  const { expenses, revenueHt } = prev
  const costMaterial    = expenses.filter(e => e.category === 'materiel').reduce((s, e) => s + e.amount_ht, 0)
  const costSubcontract = expenses.filter(e => e.category === 'sous_traitance').reduce((s, e) => s + e.amount_ht, 0)
  const costOther       = expenses.filter(e => ['location','transport','autre'].includes(e.category)).reduce((s, e) => s + e.amount_ht, 0)
  const costLabor       = members.reduce((s, e) => s + e.cost, 0)
  const hoursLogged     = members.reduce((s, e) => s + e.hours, 0)
  const costTotal       = costMaterial + costLabor + costSubcontract + costOther
  const marginEur       = revenueHt - costTotal
  const marginPct       = revenueHt > 0 ? marginEur / revenueHt : 0
  return { ...prev, laborByMember: members, costMaterial, costSubcontract, costOther, costLabor, hoursLogged, costTotal, marginEur, marginPct }
}

// ─── Barre de progression ─────────────────────────────────────────────────────

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div className="h-1.5 rounded-full bg-secondary/10 overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

// ─── Statut marge ─────────────────────────────────────────────────────────────

function MarginBadge({ pct }: { pct: number }) {
  if (pct >= 0.2) return (
    <span className="flex items-center gap-1 text-green-500 font-bold">
      <TrendingUp className="w-4 h-4" /> {fmtPct(pct)}
    </span>
  )
  if (pct >= 0.05) return (
    <span className="flex items-center gap-1 text-yellow-500 font-bold">
      <Minus className="w-4 h-4" /> {fmtPct(pct)}
    </span>
  )
  return (
    <span className="flex items-center gap-1 text-red-500 font-bold">
      <TrendingDown className="w-4 h-4" /> {fmtPct(pct)}
    </span>
  )
}

// ─── Formulaire d'ajout/édition dépense ──────────────────────────────────────

type ExpenseFormState = {
  category: ChantierExpense['category']
  label: string
  amountHt: string
  vatRate: string
  expenseDate: string
  supplierName: string
  notes: string
  receiptStoragePath: string | null
  // Détails optionnels
  quantity: string
  unit: string
  unitPriceHt: string
  materialId: string | null
  // Location
  rentalSubcategory: string         // slug rental-catalog ou 'autre'
  rentalItemLabel: string           // libellé custom si 'autre'
  rentalUnit: RentalUnit
  rentalStartDate: string
  rentalEndDate: string
  // Transport
  transportSubcategory: string      // 'carburant' | 'peage' | 'autre'
  transportKm: string
  transportConsumption: string
  transportFuelPrice: string
}

function emptyForm(today: string): ExpenseFormState {
  return {
    category: 'materiel', label: '', amountHt: '', vatRate: '20', expenseDate: today,
    supplierName: '', notes: '', receiptStoragePath: null,
    quantity: '', unit: '', unitPriceHt: '', materialId: null,
    rentalSubcategory: '', rentalItemLabel: '', rentalUnit: 'j', rentalStartDate: '', rentalEndDate: '',
    transportSubcategory: 'carburant',
    transportKm: '', transportConsumption: String(DEFAULT_CONSUMPTION_L_PER_100KM), transportFuelPrice: String(DEFAULT_FUEL_PRICE_EUR_PER_L),
  }
}

function ExpenseForm({
  chantierId,
  initial,
  editingId,
  orgSector,
  materials,
  onSaved,
  onCancel,
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

  // Calcul automatique du montant en fonction des sections
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

  // Pré-remplit la durée location quand les dates changent
  React.useEffect(() => {
    if (form.category !== 'location') return
    if (!form.rentalStartDate || !form.rentalEndDate) return
    const dur = computeRentalDuration(form.rentalStartDate, form.rentalEndDate, form.rentalUnit)
    setForm(f => ({ ...f, quantity: String(dur), unit: f.unit || f.rentalUnit }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.rentalStartDate, form.rentalEndDate, form.rentalUnit, form.category])

  // Quand on choisit un item du catalogue location, prérempli libellé + unité
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

  // Quand on choisit un matériau du catalogue, prérempli libellé / unité / prix
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
      notes: form.notes.trim() || null,
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
        notes: payload.notes, created_by: null, created_at: '',
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
        notes: payload.notes, created_by: null, created_at: new Date().toISOString(),
      })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card p-4 space-y-3 border border-accent/30">
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

      {/* ── Bloc spécifique LOCATION ── */}
      {form.category === 'location' && (
        <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3 space-y-2">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide">Type d&apos;équipement loué</p>
          {rentalCatalog.length > 0 ? (
            <div className="flex gap-2 flex-wrap">
              <select
                className="input input-sm flex-1 min-w-[180px]"
                value={form.rentalSubcategory}
                onChange={e => set('rentalSubcategory', e.target.value)}
              >
                <option value="">— Sélectionner —</option>
                {rentalCatalog.map(it => (
                  <option key={it.slug} value={it.slug}>{it.label}</option>
                ))}
                <option value="autre">Autre…</option>
              </select>
              {form.rentalSubcategory === 'autre' && (
                <input
                  className="input input-sm flex-1 min-w-[180px]"
                  placeholder="Précisez l'équipement"
                  value={form.rentalItemLabel}
                  onChange={e => set('rentalItemLabel', e.target.value)}
                />
              )}
            </div>
          ) : (
            <input
              className="input input-sm w-full"
              placeholder="Équipement loué"
              value={form.rentalItemLabel}
              onChange={e => set('rentalItemLabel', e.target.value)}
            />
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <input
              type="date"
              className="input input-sm"
              value={form.rentalStartDate}
              onChange={e => set('rentalStartDate', e.target.value)}
              placeholder="Du"
            />
            <input
              type="date"
              className="input input-sm"
              value={form.rentalEndDate}
              onChange={e => set('rentalEndDate', e.target.value)}
              placeholder="Au"
            />
            <select
              className="input input-sm"
              value={form.rentalUnit}
              onChange={e => set('rentalUnit', e.target.value)}
            >
              {(['j','sem','mois'] as RentalUnit[]).map(u => (
                <option key={u} value={u}>{RENTAL_UNIT_LABELS[u]}</option>
              ))}
            </select>
            <input
              type="text"
              inputMode="decimal"
              className="input input-sm tabular-nums"
              placeholder="Prix unitaire HT"
              value={form.unitPriceHt}
              onChange={e => set('unitPriceHt', e.target.value)}
            />
          </div>
          {form.quantity && form.unitPriceHt && (
            <p className="text-xs text-secondary">
              {form.quantity} × {form.unitPriceHt}€ = <strong className="text-primary">{(parseFloat(form.quantity) * parseFloat(form.unitPriceHt)).toFixed(2)}€ HT</strong>
            </p>
          )}
        </div>
      )}

      {/* ── Bloc spécifique TRANSPORT ── */}
      {form.category === 'transport' && (
        <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3 space-y-2">
          <div className="flex gap-1 p-1 rounded-lg bg-[var(--elevation-0)] w-fit">
            {(['carburant', 'peage', 'autre'] as const).map(sub => (
              <button
                key={sub}
                type="button"
                onClick={() => set('transportSubcategory', sub)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors ${
                  form.transportSubcategory === sub ? 'bg-accent text-white' : 'text-secondary hover:text-primary'
                }`}
              >
                {sub === 'carburant' ? 'Carburant' : sub === 'peage' ? 'Péage' : 'Autre'}
              </button>
            ))}
          </div>
          {form.transportSubcategory === 'carburant' && (
            <>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-[10px] text-secondary uppercase font-semibold">Distance (km)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input input-sm w-full"
                    value={form.transportKm}
                    onChange={e => set('transportKm', e.target.value)}
                    placeholder="ex : 80"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-secondary uppercase font-semibold">Conso (L/100 km)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input input-sm w-full"
                    value={form.transportConsumption}
                    onChange={e => set('transportConsumption', e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-secondary uppercase font-semibold">Prix carburant (€/L)</label>
                  <input
                    type="text"
                    inputMode="decimal"
                    className="input input-sm w-full"
                    value={form.transportFuelPrice}
                    onChange={e => set('transportFuelPrice', e.target.value)}
                  />
                </div>
              </div>
              {computedAmount && computedAmount.liters > 0 && (
                <p className="text-xs text-secondary">
                  → {computedAmount.liters.toFixed(2)} L · <strong className="text-primary">{computedAmount.costHt.toFixed(2)}€ HT</strong>
                </p>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Bloc MATÉRIEL avec lien catalogue ── */}
      {form.category === 'materiel' && materials.length > 0 && (
        <div className="rounded-xl bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-3 space-y-2">
          <div className="flex gap-2 items-center">
            <select
              className="input input-sm flex-1"
              value={form.materialId ?? ''}
              onChange={e => handlePickMaterial(e.target.value)}
            >
              <option value="">↑ Lier au catalogue (facultatif)</option>
              {materials.filter(m => m.is_active).map(m => (
                <option key={m.id} value={m.id}>{m.name}{m.reference ? ` · ${m.reference}` : ''}</option>
              ))}
            </select>
            {form.materialId && (
              <button type="button" onClick={() => set('materialId', null)} className="text-secondary hover:text-primary p-1" title="Retirer le lien">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              inputMode="decimal"
              className="input input-sm"
              placeholder="Quantité"
              value={form.quantity}
              onChange={e => set('quantity', e.target.value)}
            />
            <input
              type="text"
              className="input input-sm"
              placeholder="Unité (u, m², kg…)"
              value={form.unit}
              onChange={e => set('unit', e.target.value)}
            />
            <input
              type="text"
              inputMode="decimal"
              className="input input-sm"
              placeholder="Prix HT/unité"
              value={form.unitPriceHt}
              onChange={e => set('unitPriceHt', e.target.value)}
            />
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
        <select
          className="input input-sm w-24"
          value={form.vatRate}
          onChange={e => set('vatRate', e.target.value)}
        >
          <option value="0">TVA 0%</option>
          <option value="5.5">TVA 5,5%</option>
          <option value="10">TVA 10%</option>
          <option value="20">TVA 20%</option>
        </select>
        <input
          className="input input-sm flex-1 min-w-[120px]"
          type="date"
          value={form.expenseDate}
          onChange={e => set('expenseDate', e.target.value)}
          required
        />
      </div>
      <input
        className="input input-sm w-full"
        placeholder="Fournisseur (facultatif)"
        value={form.supplierName}
        onChange={e => set('supplierName', e.target.value)}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
          <X className="w-3.5 h-3.5" /> Annuler
        </button>
        <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" /> {saving ? 'Enregistrement…' : editingId ? 'Mettre à jour' : 'Ajouter'}
        </button>
      </div>
    </form>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function RentabiliteTab({
  chantierId,
  initialProfitability,
  orgMembers: _orgMembers,
  orgSector = null,
  materials = [],
  invoiceStubs = [],
  targetMarginPct: initialTargetMarginPct = 30,
}: {
  chantierId: string
  initialProfitability: ChantierProfitability
  orgMembers: TeamMember[]
  orgSector?: string | null
  materials?: CatalogMaterial[]
  invoiceStubs?: InvoiceStub[]
  targetMarginPct?: number
}) {
  const today = new Date().toISOString().slice(0, 10)

  const [profitability, setProfitability] = useState(initialProfitability)
  const [laborByMember, setLaborByMember] = useState<LaborByMemberEntry[]>(initialProfitability.laborByMember)

  // Marge cible — éditable inline
  const [targetMarginPct, setTargetMarginPct] = useState(initialTargetMarginPct)
  const [editingMargin, setEditingMargin] = useState(false)
  const [marginInput, setMarginInput] = useState(String(initialTargetMarginPct))
  const [marginSaving, setMarginSaving] = useState(false)

  // Expense state
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState<ChantierExpense | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expenseFilter, setExpenseFilter] = useState<ChantierExpense['category'] | 'all'>('all')
  const [, startTransition] = useTransition()

  // Scanner state
  const scanInputRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scannedFormOverride, setScannedFormOverride] = useState<Partial<ExpenseFormState> | null>(null)
  const [viewingReceiptPath, setViewingReceiptPath] = useState<string | null>(null)
  const [receiptUrls, setReceiptUrls] = useState<Record<string, string>>({})

  const handleScan = async (file: File) => {
    setScanning(true)
    setScanError(null)
    const uploadFormData = new FormData()
    uploadFormData.append('file', file)
    // Upload en parallèle pendant l'OCR
    const [ocrRes, uploadRes] = await Promise.all([
      (async () => {
        const fd = new FormData()
        fd.append('file', file)
        const res = await fetch('/api/ai/scan-receipt', { method: 'POST', body: fd })
        if (!res.ok) {
          const { error } = await res.json().catch(() => ({ error: 'Erreur réseau' }))
          return { error: error ?? 'Erreur lors de l\'analyse.' }
        }
        return res.json() as Promise<ScanReceiptResult>
      })(),
      uploadExpenseReceipt(chantierId, uploadFormData),
    ])
    setScanning(false)

    if ('error' in ocrRes) {
      setScanError(ocrRes.error)
      return
    }

    const scanWarnings: string[] = []
    if (uploadRes.error) {
      scanWarnings.push(uploadRes.error)
    }
    if (ocrRes.amountSource === 'ttc_converted' && ocrRes.amountTtc != null && ocrRes.vatRate != null) {
      scanWarnings.push(`Montant TTC lu (${fmtMoney(ocrRes.amountTtc, 2)}) converti en HT avec TVA ${ocrRes.vatRate} %.`)
    }
    if (ocrRes.amountSource === 'unknown') {
      scanWarnings.push('Montant non détecté — renseignez le montant manuellement.')
    }

    const override: Partial<ExpenseFormState> = {
      label: ocrRes.label || '',
      amountHt: ocrRes.amountHt != null ? String(ocrRes.amountHt) : '',
      vatRate: ocrRes.vatRate != null ? String(ocrRes.vatRate) : '20',
      expenseDate: ocrRes.expenseDate ?? today,
      supplierName: ocrRes.supplierName ?? '',
      category: ocrRes.category,
      receiptStoragePath: uploadRes.storagePath,
    }
    if (ocrRes.category === 'transport') {
      override.transportSubcategory = ocrRes.subcategory === 'peage' ? 'peage'
        : ocrRes.subcategory === 'carburant' ? 'carburant'
        : 'autre'
    }

    setScannedFormOverride(override)
    setEditingExpense(null)
    setShowAddForm(true)
    if (ocrRes.confidence === 'low') {
      scanWarnings.push('Ticket peu lisible — vérifiez les valeurs avant d\'enregistrer.')
    }
    if (scanWarnings.length) {
      setScanError(scanWarnings.join(' '))
    }
  }

  const handleViewReceipt = async (path: string) => {
    if (receiptUrls[path]) {
      setViewingReceiptPath(path)
      return
    }
    const { url } = await getReceiptSignedUrl(path)
    if (url) {
      setReceiptUrls(prev => ({ ...prev, [path]: url }))
      setViewingReceiptPath(path)
    }
  }

  // Factures rattachées — géré localement pour éviter un reload
  const [linkedInvoices, setLinkedInvoices] = useState<InvoiceStub[]>(
    () => invoiceStubs.filter(inv => inv.chantier_id === chantierId)
  )
  const [showLinkInvoice, setShowLinkInvoice] = useState(false)
  const [linkingInvoiceId, setLinkingInvoiceId] = useState('')
  const [linkingInvoice, setLinkingInvoice] = useState(false)
  const [linkInvoiceError, setLinkInvoiceError] = useState<string | null>(null)
  const [unlinkingId, setUnlinkingId] = useState<string | null>(null)

  const availableToLink = invoiceStubs.filter(
    inv => !inv.chantier_id || inv.chantier_id === chantierId
  ).filter(
    inv => !linkedInvoices.some(li => li.id === inv.id)
  )

  const handleLinkInvoice = async () => {
    if (!linkingInvoiceId) return
    setLinkingInvoice(true)
    setLinkInvoiceError(null)
    const { error } = await linkInvoiceToChantier(linkingInvoiceId, chantierId)
    setLinkingInvoice(false)
    if (error) { setLinkInvoiceError(error); return }
    const inv = invoiceStubs.find(i => i.id === linkingInvoiceId)
    if (inv) {
      setLinkedInvoices(prev => [...prev, { ...inv, chantier_id: chantierId }])
      setProfitability(prev => recalc({ ...prev, revenueHt: prev.revenueHt + (inv.total_ht ?? 0) }))
    }
    setShowLinkInvoice(false)
    setLinkingInvoiceId('')
  }

  const handleUnlinkInvoice = async (invoiceId: string) => {
    setUnlinkingId(invoiceId)
    const { error } = await linkInvoiceToChantier(invoiceId, null)
    setUnlinkingId(null)
    if (error) { alert(error); return }
    const inv = linkedInvoices.find(i => i.id === invoiceId)
    setLinkedInvoices(prev => prev.filter(i => i.id !== invoiceId))
    setProfitability(prev => recalc({ ...prev, revenueHt: prev.revenueHt - (inv?.total_ht ?? 0) }))
  }

  // Labor rate inline edit state
  const [editingRateMemberId, setEditingRateMemberId] = useState<string | null>(null)
  const [rateInputValue, setRateInputValue] = useState('')
  const [rateSaving, setRateSaving] = useState(false)
  const [rateError, setRateError] = useState<string | null>(null)

  const {
    budgetHt, revenueHt, costMaterial, costLabor, costSubcontract, costOther,
    costTotal, marginEur, marginPct, hoursLogged,
  } = profitability

  const expenses = profitability.expenses

  // Budget coûts max = prix devis × (1 - marge cible)
  const costBudget    = budgetHt > 0 ? budgetHt * (1 - targetMarginPct / 100) : 0
  const budgetUsedPct = costBudget > 0 ? costTotal / costBudget : 0
  const budgetAlert   = budgetUsedPct > 0.9

  const filteredExpenses = expenseFilter === 'all'
    ? expenses
    : expenses.filter(e => e.category === expenseFilter)

  // ── Handlers dépenses ──

  const handleExpenseSaved = (saved: ChantierExpense) => {
    setShowAddForm(false)
    setEditingExpense(null)
    setProfitability(prev => {
      const existing = prev.expenses.find(e => e.id === saved.id)
      const newExpenses = existing
        ? prev.expenses.map(e => e.id === saved.id ? saved : e)
        : [saved, ...prev.expenses]
      return recalc({ ...prev, expenses: newExpenses })
    })
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const { error } = await deleteChantierExpense(id, chantierId)
    setDeletingId(null)
    if (error) { alert(error); return }
    setProfitability(prev => recalc({ ...prev, expenses: prev.expenses.filter(e => e.id !== id) }))
  }

  // ── Handler taux main-d'œuvre ──

  const handleEditRate = (entry: LaborByMemberEntry) => {
    setEditingRateMemberId(entry.membership_id)
    setRateInputValue(entry.ratePerHour != null ? String(entry.ratePerHour) : '')
    setRateError(null)
  }

  const handleSaveRate = async (membershipId: string) => {
    const parsed = parseFloat(rateInputValue.replace(',', '.'))
    if (isNaN(parsed) || parsed < 0) { setRateError('Taux invalide.'); return }
    setRateSaving(true)
    setRateError(null)
    const { error } = await updateMemberLaborRate(membershipId, parsed)
    setRateSaving(false)
    if (error) { setRateError(error); return }
    const newMembers = laborByMember.map(e =>
      e.membership_id === membershipId ? { ...e, ratePerHour: parsed, cost: e.hours * parsed } : e
    )
    setLaborByMember(newMembers)
    setProfitability(prev => recalc(prev, newMembers))
    setEditingRateMemberId(null)
  }

  const handleCancelRate = () => {
    setEditingRateMemberId(null)
    setRateError(null)
  }

  const handleSaveMargin = async () => {
    const parsed = parseFloat(marginInput.replace(',', '.'))
    if (isNaN(parsed) || parsed < 0 || parsed >= 100) return
    setMarginSaving(true)
    const { updateChantier } = await import('@/lib/data/mutations/chantiers')
    await updateChantier(chantierId, { targetMarginPct: parsed })
    setTargetMarginPct(parsed)
    setMarginSaving(false)
    setEditingMargin(false)
  }

  return (
    <div className="space-y-6">

      {/* ── 1. Bandeau KPI ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* Budget devis + marge cible éditable */}
        <div className="card p-4 space-y-1">
          <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Budget devis HT</p>
          <p className="text-xl font-bold text-primary">{fmtMoney(budgetHt)}</p>
          {/* Marge cible */}
          <div className="flex items-center gap-1 pt-0.5">
            <Target className="w-3 h-3 text-secondary flex-shrink-0" />
            {editingMargin ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={99}
                  step={1}
                  className="input text-xs py-0.5 px-1 w-14"
                  value={marginInput}
                  onChange={e => setMarginInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleSaveMargin(); if (e.key === 'Escape') setEditingMargin(false) }}
                  autoFocus
                />
                <span className="text-xs text-secondary">%</span>
                <button onClick={handleSaveMargin} disabled={marginSaving} className="text-green-500 hover:text-green-600 disabled:opacity-40">
                  {marginSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                </button>
                <button onClick={() => setEditingMargin(false)} className="text-secondary hover:text-primary">
                  <X className="w-3 h-3" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => { setMarginInput(String(targetMarginPct)); setEditingMargin(true) }}
                className="text-xs text-secondary hover:text-primary flex items-center gap-1 group"
                title="Modifier la marge cible"
              >
                Marge cible : <span className="font-semibold text-primary">{targetMarginPct} %</span>
                <Pencil className="w-2.5 h-2.5 opacity-0 group-hover:opacity-60 transition-opacity" />
              </button>
            )}
          </div>
          {costBudget > 0 && (
            <p className="text-xs text-secondary">
              Budget coûts max : <span className={`font-semibold ${budgetAlert ? 'text-red-500' : 'text-primary'}`}>{fmtMoney(costBudget)}</span>
            </p>
          )}
        </div>
        <div className="card p-4 space-y-1.5 col-span-2 md:col-span-1">
          <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Facturé HT</p>
          <p className="text-xl font-bold text-primary">{fmtMoney(revenueHt)}</p>

          {/* Liste des factures rattachées */}
          {linkedInvoices.length > 0 && (
            <div className="space-y-1 pt-0.5">
              {linkedInvoices.map(inv => (
                <div key={inv.id} className="flex items-center gap-1.5 text-xs">
                  <span className="flex-1 truncate text-secondary">
                    {[inv.number, inv.title].filter(Boolean).join(' — ') || '(sans titre)'}
                    {inv.total_ht != null && <span className="ml-1 font-semibold text-primary">{fmtMoney(inv.total_ht)}</span>}
                  </span>
                  <button
                    onClick={() => handleUnlinkInvoice(inv.id)}
                    disabled={unlinkingId === inv.id}
                    className="text-secondary hover:text-red-500 transition-colors p-0.5 flex-shrink-0 disabled:opacity-40"
                    title="Détacher cette facture"
                  >
                    {unlinkingId === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <X className="w-3 h-3" />}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-2 flex-wrap pt-0.5">
            <Link
              href={`/finances/invoice-editor?chantier=${chantierId}&returnTo=${encodeURIComponent(`/chantiers/${chantierId}`)}`}
              className="text-xs text-accent hover:text-accent/80 flex items-center gap-1"
            >
              <Euro className="w-3 h-3" /> Créer
            </Link>
            {availableToLink.length > 0 && (
              <button
                onClick={() => { setShowLinkInvoice(v => !v); setLinkInvoiceError(null) }}
                className="text-xs text-accent hover:text-accent/80 flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Rattacher
              </button>
            )}
          </div>

          {showLinkInvoice && (
            <div className="pt-1 space-y-1.5">
              <select
                className="input w-full text-xs py-1"
                value={linkingInvoiceId}
                onChange={e => setLinkingInvoiceId(e.target.value)}
              >
                <option value="">— Choisir une facture —</option>
                {availableToLink.map(inv => {
                  const label = [inv.number, inv.title].filter(Boolean).join(' — ') || inv.id
                  const amount = inv.total_ht != null ? ` · ${fmtMoney(inv.total_ht)}` : ''
                  return <option key={inv.id} value={inv.id}>{label}{amount}</option>
                })}
              </select>
              {linkInvoiceError && <p className="text-xs text-red-500">{linkInvoiceError}</p>}
              <div className="flex gap-2">
                <button
                  onClick={handleLinkInvoice}
                  disabled={!linkingInvoiceId || linkingInvoice}
                  className="btn-primary text-xs py-1 px-2.5 flex items-center gap-1 disabled:opacity-50"
                >
                  {linkingInvoice ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                  Rattacher
                </button>
                <button onClick={() => { setShowLinkInvoice(false); setLinkingInvoiceId('') }} className="btn-secondary text-xs py-1 px-2.5">Annuler</button>
              </div>
            </div>
          )}
        </div>
        <KpiCard label="Coût total HT" value={fmtMoney(costTotal)} sub={hoursLogged > 0 ? `${fmtHours(hoursLogged)} main-d'œuvre` : undefined} />
        <div className="card p-4">
          <p className="text-xs text-secondary font-semibold uppercase tracking-wider mb-1">Marge brute</p>
          <p className="text-xl font-bold">
            {revenueHt > 0 ? <MarginBadge pct={marginPct} /> : <span className="text-secondary">–</span>}
          </p>
          {revenueHt > 0 && <p className="text-xs text-secondary mt-0.5">{fmtMoney(marginEur)}</p>}
        </div>
      </div>

      {/* ── 2. Main-d'œuvre par membre ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-secondary" />
          <h3 className="text-sm font-semibold text-primary">Main-d&apos;œuvre</h3>
          <span className="text-xs text-secondary">— le taux s&apos;applique à tous les chantiers du membre</span>
        </div>

        {laborByMember.length === 0 ? (
          <div className="card p-5 text-center text-secondary text-sm">
            <Hammer className="w-7 h-7 mx-auto mb-2 opacity-25" />
            Aucun pointage enregistré sur ce chantier.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-secondary uppercase tracking-wider whitespace-nowrap">Membre</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-secondary uppercase tracking-wider whitespace-nowrap">Heures</th>
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-secondary uppercase tracking-wider whitespace-nowrap">Taux (€/h)</th>
                  <th className="text-right px-4 py-2.5 text-xs font-semibold text-secondary uppercase tracking-wider whitespace-nowrap">Coût HT</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {laborByMember.map(entry => (
                  <tr key={entry.user_id}>
                    <td className="px-4 py-3 font-medium text-primary">{entry.full_name ?? 'Inconnu'}</td>
                    <td className="px-4 py-3 text-secondary tabular-nums">{fmtHours(entry.hours)}</td>
                    <td className="px-4 py-3">
                      {editingRateMemberId === entry.membership_id ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            inputMode="decimal"
                            className="input input-sm w-20 tabular-nums"
                            value={rateInputValue}
                            onChange={e => setRateInputValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleSaveRate(entry.membership_id); if (e.key === 'Escape') handleCancelRate() }}
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveRate(entry.membership_id)}
                            disabled={rateSaving}
                            className="p-1 text-accent hover:text-accent/80 transition-colors rounded disabled:opacity-50"
                            title="Enregistrer"
                          >
                            {rateSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={handleCancelRate}
                            className="p-1 text-secondary hover:text-primary transition-colors rounded"
                            title="Annuler"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className="flex items-center gap-1.5 group">
                          {entry.ratePerHour != null ? (
                            <span className="tabular-nums text-secondary">{fmtMoney(entry.ratePerHour, 2)}/h</span>
                          ) : (
                            <span className="text-xs text-yellow-500 font-semibold">Taux non défini</span>
                          )}
                          {entry.membership_id && (
                            <button
                              onClick={() => handleEditRate(entry)}
                              className="p-1 text-secondary hover:text-primary transition-colors rounded opacity-0 group-hover:opacity-100"
                              title="Modifier le taux — s'applique à tous les chantiers de ce membre"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                          )}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-primary tabular-nums">{fmtMoney(entry.cost)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                  <td className="px-4 py-2.5 text-xs font-bold text-secondary uppercase">Total</td>
                  <td className="px-4 py-2.5 text-xs font-semibold text-secondary tabular-nums">{fmtHours(hoursLogged)}</td>
                  <td className="px-4 py-2.5"></td>
                  <td className="px-4 py-2.5 text-right text-sm font-bold text-primary tabular-nums">{fmtMoney(costLabor)}</td>
                </tr>
              </tfoot>
            </table>
            {rateError && (
              <p className="px-4 pb-3 text-xs text-red-500">{rateError}</p>
            )}
          </div>
        )}
      </div>

      {/* ── 3. Dépenses ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold text-primary">Dépenses enregistrées</h3>
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
                className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
                title="Photographier ou importer un ticket pour pré-remplir la dépense"
              >
                {scanning
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Analyse...</>
                  : <><ScanLine className="w-3.5 h-3.5" /> Scanner un ticket</>}
              </button>
              <button
                onClick={() => { setScanError(null); setScannedFormOverride(null); setShowAddForm(true) }}
                className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" /> Ajouter
              </button>
            </div>
          )}
        </div>
        {scanError && (
          <p className="text-xs text-yellow-500 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /> {scanError}
          </p>
        )}
        {/* Lightbox reçu */}
        {viewingReceiptPath && receiptUrls[viewingReceiptPath] && (
          <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={() => setViewingReceiptPath(null)}
          >
            <div className="relative max-w-2xl w-full" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setViewingReceiptPath(null)}
                className="absolute -top-8 right-0 text-white/70 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
              <img
                src={receiptUrls[viewingReceiptPath]}
                alt="Ticket de dépense"
                className="w-full rounded-xl object-contain max-h-[80vh]"
              />
            </div>
          </div>
        )}

        {/* Filtre par catégorie */}
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
              {cat === 'all' ? 'Tout' : catLabel(cat)}
            </button>
          ))}
        </div>

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

        {filteredExpenses.length === 0 && !showAddForm ? (
          <div className="card p-6 text-center text-secondary text-sm">
            <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
            {expenseFilter === 'all'
              ? 'Aucune dépense enregistrée. Ajoutez matériaux, sous-traitance ou autres frais.'
              : `Aucune dépense en catégorie « ${catLabel(expenseFilter)} ».`}
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
                      notes: exp.notes ?? '',
                    }}
                    editingId={exp.id}
                    orgSector={orgSector}
                    materials={materials}
                    onSaved={handleExpenseSaved}
                    onCancel={() => setEditingExpense(null)}
                  />
                ) : (
                  <div className="card p-3 flex items-center gap-3 border border-[var(--elevation-border)]">
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
                    <span className="text-sm font-bold text-primary flex-shrink-0">{fmtMoney(exp.amount_ht)}</span>
                    <div className="flex gap-1 flex-shrink-0">
                      {exp.receipt_storage_path && (
                        <button
                          onClick={() => handleViewReceipt(exp.receipt_storage_path!)}
                          className="p-1.5 text-secondary hover:text-accent transition-colors rounded-lg hover:bg-accent/10"
                          title="Voir le ticket joint"
                        >
                          <Receipt className="w-3.5 h-3.5" />
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingExpense(exp); setShowAddForm(false) }}
                        className="p-1.5 text-secondary hover:text-primary transition-colors rounded-lg hover:bg-secondary/10"
                        title="Modifier"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(exp.id)}
                        disabled={deletingId === exp.id}
                        className="p-1.5 text-secondary hover:text-red-500 transition-colors rounded-lg hover:bg-red-500/10 disabled:opacity-40"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── 4. Répartition des coûts ── */}
      <div className="card p-4 space-y-4">
        <h3 className="text-sm font-semibold text-primary">Répartition des coûts</h3>
        <CostRow label="Matériel" value={costMaterial} total={costTotal} color="bg-blue-500" icon={<Package className="w-3.5 h-3.5" />} />
        <CostRow
          label="Main-d'œuvre"
          value={costLabor}
          total={costTotal}
          color="bg-purple-500"
          icon={<Hammer className="w-3.5 h-3.5" />}
          sub={hoursLogged > 0 ? `${fmtHours(hoursLogged)} · ${laborByMember.length} membre${laborByMember.length > 1 ? 's' : ''}` : undefined}
        />
        <CostRow label="Sous-traitance" value={costSubcontract} total={costTotal} color="bg-orange-500" icon={<Building2 className="w-3.5 h-3.5" />} />
        <CostRow label="Autres (location, transport…)" value={costOther} total={costTotal} color="bg-gray-400" icon={<Truck className="w-3.5 h-3.5" />} />

        {costBudget > 0 && (
          <div className="pt-3 border-t border-[var(--elevation-border)]">
            <div className="flex justify-between text-xs text-secondary mb-1">
              <span>Coûts / budget max ({targetMarginPct} % marge)</span>
              <span className={budgetAlert ? 'text-red-500 font-semibold' : ''}>{fmtMoney(costTotal)} / {fmtMoney(costBudget)}</span>
            </div>
            <ProgressBar value={costTotal} max={costBudget} color={budgetAlert ? 'bg-red-500' : 'bg-accent'} />
          </div>
        )}
      </div>

      {/* ── 5. Alerte budget ── */}
      {budgetAlert && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-600 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Les coûts dépassent 90 % du budget max ({fmtMoney(costBudget)} HT pour {targetMarginPct} % de marge). Risque de travailler sans marge.
        </div>
      )}

    </div>
  )
}

// ─── Sous-composants ──────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, subColor }: { label: string; value: string; sub?: string; subColor?: string }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-secondary font-semibold uppercase tracking-wider">{label}</p>
      <p className="text-xl font-bold text-primary mt-0.5">{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${subColor ?? 'text-secondary'}`}>{sub}</p>}
    </div>
  )
}

function CostRow({ label, value, total, color, icon, sub }: {
  label: string; value: number; total: number; color: string; icon: React.ReactNode; sub?: string
}) {
  const pct = total > 0 ? (value / total) * 100 : 0
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-xs">
        <span className="text-secondary flex-shrink-0">{icon}</span>
        <span className="text-secondary flex-1">{label}{sub ? <span className="ml-1 opacity-60">{sub}</span> : ''}</span>
        <span className="font-semibold text-primary">{fmtMoney(value)}</span>
        <span className="text-secondary w-10 text-right">{total > 0 ? `${pct.toFixed(0)} %` : '–'}</span>
      </div>
      <ProgressBar value={value} max={total} color={color} />
    </div>
  )
}
