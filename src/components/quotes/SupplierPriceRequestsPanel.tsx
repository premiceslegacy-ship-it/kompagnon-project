'use client'

import { useState, useTransition } from 'react'
import { Plus, ChevronDown, ChevronUp, Trash2, Loader2, CheckCircle2, Clock, Send, PackageCheck } from 'lucide-react'
import type { SupplierPriceRequest, SPRStatus } from '@/lib/data/mutations/supplier-price-requests'
import { upsertSupplierPriceRequest, updateSPRStatus, deleteSupplierPriceRequest } from '@/lib/data/mutations/supplier-price-requests'
import type { Supplier } from '@/lib/data/queries/suppliers'

const UNITS = ['u', 'h', 'j', 'sem', 'm²', 'ml', 'kg', 'L', 't', 'm³', 'forfait']

const STATUS_CONFIG: Record<SPRStatus, { label: string; color: string; icon: React.ReactNode }> = {
  a_demander: { label: 'A demander', color: 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300', icon: <Clock className="w-3 h-3" /> },
  demande:    { label: 'Demandé',    color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300', icon: <Send className="w-3 h-3" /> },
  recu:       { label: 'Reçu',       color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300', icon: <PackageCheck className="w-3 h-3" /> },
  integre:    { label: 'Intégré',    color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', icon: <CheckCircle2 className="w-3 h-3" /> },
}

const STATUS_ORDER: SPRStatus[] = ['a_demander', 'demande', 'recu', 'integre']

type FormState = {
  supplier_id: string
  designation: string
  description: string
  quantity: string
  unit: string
  unit_price_ht: string
  notes: string
  valid_until: string
}

const emptyForm = (): FormState => ({
  supplier_id: '', designation: '', description: '', quantity: '', unit: '', unit_price_ht: '', notes: '', valid_until: '',
})

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
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const pendingCount = requests.filter(r => r.status !== 'integre').length

  function openNew() {
    setForm(emptyForm())
    setEditingId(null)
    setShowForm(true)
  }

  function openEdit(r: SupplierPriceRequest) {
    setForm({
      supplier_id: r.supplier_id ?? '',
      designation: r.designation,
      description: r.description ?? '',
      quantity: r.quantity != null ? String(r.quantity) : '',
      unit: r.unit ?? '',
      unit_price_ht: r.unit_price_ht != null ? String(r.unit_price_ht) : '',
      notes: r.notes ?? '',
      valid_until: r.valid_until ?? '',
    })
    setEditingId(r.id)
    setShowForm(true)
    setExpandedId(null)
  }

  function cancelForm() {
    setShowForm(false)
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
        description: form.description || null,
        quantity: form.quantity ? parseFloat(form.quantity) : null,
        unit: form.unit || null,
        unit_price_ht: form.unit_price_ht ? parseFloat(form.unit_price_ht) : null,
        notes: form.notes || null,
        valid_until: form.valid_until || null,
      })
      if (res.error || !res.data) { setSaveError(res.error ?? 'Erreur'); return }
      setRequests(prev => {
        const idx = prev.findIndex(r => r.id === res.data!.id)
        if (idx >= 0) { const u = [...prev]; u[idx] = res.data!; return u }
        return [...prev, res.data!]
      })
      cancelForm()
    })
  }

  function handleStatusChange(id: string, next: SPRStatus) {
    setSaveError(null)
    startTransition(async () => {
      const extra: Record<string, string> = {}
      if (next === 'demande') extra.sent_at = new Date().toISOString()
      if (next === 'recu') extra.response_at = new Date().toISOString()
      const result = await updateSPRStatus(id, next, extra as any)
      if (result.error) { setSaveError(result.error); return }
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status: next, ...extra } : r))
    })
  }

  function handleDelete(id: string) {
    setSaveError(null)
    setDeletingId(id)
    startTransition(async () => {
      const result = await deleteSupplierPriceRequest(id)
      if (result.error) {
        setSaveError(result.error)
        setDeletingId(null)
        return
      }
      setRequests(prev => prev.filter(r => r.id !== id))
      setDeletingId(null)
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-primary text-sm">Achats à consulter</h3>
              {pendingCount > 0 && (
                <span className="text-xs font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                  {pendingCount} en attente
                </span>
              )}
            </div>
            <p className="text-xs text-secondary mt-0.5">Matériaux ou fournitures dont le prix fournisseur reste à confirmer avant d&apos;envoyer ce devis.</p>
          </div>
        </div>
        {!showForm && (
          <button onClick={openNew} className="flex items-center gap-1.5 text-xs text-accent hover:text-accent/80 font-medium transition-colors shrink-0">
            <Plus className="w-3.5 h-3.5" />
            Ajouter
          </button>
        )}
      </div>
      {saveError && !showForm && (
        <p className="text-xs text-red-500">{saveError}</p>
      )}

      {/* Formulaire */}
      {showForm && (
        <div className="rounded-2xl border border-accent/30 bg-surface dark:bg-white/5 p-4 space-y-3">
          <p className="text-xs font-semibold text-secondary uppercase tracking-wide">{editingId ? 'Modifier' : 'Nouvel achat à consulter'}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-secondary mb-1 block">Désignation *</label>
              <input
                type="text"
                placeholder="ex : Tôle acier S235 2mm"
                value={form.designation}
                onChange={e => setForm(f => ({ ...f, designation: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div>
              <label className="text-xs text-secondary mb-1 block">Fournisseur</label>
              <select
                value={form.supplier_id}
                onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="">— Fournisseur —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-secondary mb-1 block">Quantité</label>
              <input
                type="number"
                min="0"
                step="any"
                placeholder="0"
                value={form.quantity}
                onChange={e => setForm(f => ({ ...f, quantity: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div>
              <label className="text-xs text-secondary mb-1 block">Unité</label>
              <select
                value={UNITS.includes(form.unit) ? form.unit : form.unit ? '__other__' : ''}
                onChange={e => setForm(f => ({ ...f, unit: e.target.value === '__other__' ? f.unit : e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              >
                <option value="">— Unité —</option>
                {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                {form.unit && !UNITS.includes(form.unit) && <option value="__other__">{form.unit}</option>}
              </select>
            </div>
            <div>
              <label className="text-xs text-secondary mb-1 block">Validité offre jusqu&apos;au</label>
              <input
                type="date"
                value={form.valid_until}
                onChange={e => setForm(f => ({ ...f, valid_until: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div>
              <label className="text-xs text-secondary mb-1 block">Prix unitaire fournisseur HT <span className="font-normal opacity-60">(à remplir quand reçu)</span></label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0,00"
                value={form.unit_price_ht}
                onChange={e => setForm(f => ({ ...f, unit_price_ht: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">Spécifications <span className="font-normal opacity-60">(spec technique, délai, conditions particulières...)</span></label>
            <textarea
              rows={2}
              placeholder="ex : épaisseur 2mm, galvanisé, livraison sous 5 jours..."
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              className="w-full px-3 py-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 resize-none"
            />
          </div>
          {saveError && <p className="text-xs text-red-500">{saveError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={cancelForm} className="btn-secondary text-xs py-2 px-4">Annuler</button>
            <button
              onClick={handleSave}
              disabled={isPending || !form.designation.trim()}
              className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5 disabled:opacity-50"
            >
              {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Enregistrer
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      {requests.length === 0 && !showForm && (
        <p className="text-xs text-secondary text-center py-4 italic">Aucun achat à consulter pour ce devis.</p>
      )}
      {requests.map(req => {
        const cfg = STATUS_CONFIG[req.status]
        const isExpanded = expandedId === req.id
        const nextStatus = STATUS_ORDER[STATUS_ORDER.indexOf(req.status) + 1] as SPRStatus | undefined
        return (
          <div key={req.id} className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                onClick={() => setExpandedId(isExpanded ? null : req.id)}
                className="flex-1 text-left flex items-center gap-2 min-w-0"
              >
                <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${cfg.color}`}>
                  {cfg.icon}{cfg.label}
                </span>
                <span className="text-sm font-medium text-primary truncate">{req.designation}</span>
                {req.supplier && <span className="text-xs text-secondary truncate hidden sm:block">— {req.supplier.name}</span>}
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-secondary shrink-0 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 text-secondary shrink-0 ml-auto" />}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => openEdit(req)} disabled={showForm} className="p-1 rounded-lg hover:bg-base text-secondary hover:text-primary transition-colors text-xs disabled:opacity-40">
                  Modifier
                </button>
                <button
                  onClick={() => handleDelete(req.id)}
                  disabled={deletingId === req.id}
                  className="p-1 rounded-lg hover:bg-red-50 text-secondary hover:text-red-500 transition-colors dark:hover:bg-red-900/20 disabled:opacity-40"
                >
                  {deletingId === req.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            {isExpanded && (
              <div className="px-3 pb-3 border-t border-[var(--elevation-border)] pt-3 space-y-2">
                {req.quantity != null && (
                  <p className="text-xs text-secondary">Quantité : <span className="text-primary font-medium">{req.quantity} {req.unit ?? ''}</span></p>
                )}
                {req.unit_price_ht != null && (
                  <p className="text-xs text-secondary">Prix unitaire reçu : <span className="text-primary font-medium">{req.unit_price_ht.toLocaleString('fr-FR', { style: 'currency', currency: req.currency })}</span></p>
                )}
                {req.valid_until && (
                  <p className="text-xs text-secondary">Validité offre : <span className="text-primary font-medium">{new Date(req.valid_until).toLocaleDateString('fr-FR')}</span></p>
                )}
                {req.notes && <p className="text-xs text-secondary whitespace-pre-wrap">{req.notes}</p>}
                {nextStatus && (
                  <button
                    onClick={() => handleStatusChange(req.id, nextStatus)}
                    disabled={isPending}
                    className="mt-1 text-xs btn-secondary py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : STATUS_CONFIG[nextStatus].icon}
                    {nextStatus === 'demande' && 'Demande envoyée au fournisseur'}
                    {nextStatus === 'recu' && 'Prix reçu'}
                    {nextStatus === 'integre' && 'Intégré dans le devis'}
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
