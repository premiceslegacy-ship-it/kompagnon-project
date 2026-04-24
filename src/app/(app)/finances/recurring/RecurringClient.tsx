'use client'

import React, { useState, useTransition, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Plus, Repeat, Pause, Play, Trash2, ChevronRight,
  Clock, AlertCircle, Check, Loader2, X, Search, EyeOff, Truck,
} from 'lucide-react'
import type { Client } from '@/lib/data/queries/clients'
import type { CatalogMaterial, CatalogLaborRate, PrestationType } from '@/lib/data/queries/catalog'
import type { RecurringInvoice, PendingSchedule, RecurringFrequency } from '@/lib/data/recurring-utils'
import { buildMaterialSelectionPricing } from '@/lib/catalog-pricing'
import { frequencyLabel } from '@/lib/data/recurring-utils'
import {
  createRecurringInvoice, toggleRecurringActive,
  cancelRecurringInvoice, skipSchedule,
} from '@/lib/data/mutations/recurring'
import { createClientInline } from '@/lib/data/mutations/clients'
import { getClientDisplayName } from '@/lib/client'
import { LEGAL_VAT_RATES, type VatConfig } from '@/lib/utils'
import { getCatalogDocumentVatRate, getInternalResourceUnitCost } from '@/lib/catalog-ui'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })

function clientDisplayName(c: Client): string {
  return getClientDisplayName(c)
}

const cardCls = 'rounded-3xl card'
const FREQ_OPTIONS: { value: RecurringFrequency; label: string }[] = [
  { value: 'monthly', label: 'Mensuelle' },
  { value: 'quarterly', label: 'Trimestrielle' },
  { value: 'weekly', label: 'Hebdomadaire' },
  { value: 'custom', label: 'Personnalisée (X jours)' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

type FormItem = { id: number; desc: string; qty: number; unit: string; pu: number; vat: number; is_internal: boolean }

type FromInvoice = {
  title: string
  clientId: string
  items: FormItem[]
} | null

type Props = {
  clients: Client[]
  recurringInvoices: RecurringInvoice[]
  pendingSchedules: PendingSchedule[]
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  prestationTypes: PrestationType[]
  fromInvoice: FromInvoice
  vatConfig: VatConfig
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function RecurringClient({
  clients: initialClients,
  recurringInvoices: initial,
  pendingSchedules: initialSchedules,
  materials,
  laborRates,
  prestationTypes,
  fromInvoice,
  vatConfig,
}: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const defaultVatRate = getCatalogDocumentVatRate(vatConfig)

  const [clients, setClients] = useState<Client[]>(initialClients)
  const [invoices, setInvoices] = useState(initial)
  const [schedules, setSchedules] = useState(initialSchedules)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [showCatalog, setShowCatalog] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  // ── Inline client creation ─────────────────────────────────────────────────
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [newClientType, setNewClientType] = useState<'company' | 'individual'>('company')
  const [newClientForm, setNewClientForm] = useState({
    company_name: '', contact_name: '', first_name: '', last_name: '',
    email: '', phone: '', address_line1: '', postal_code: '', city: '',
  })
  const [newClientError, setNewClientError] = useState<string | null>(null)
  const [newClientPending, startNewClientTransition] = useTransition()

  function handleCreateClientInline() {
    setNewClientError(null)
    startNewClientTransition(async () => {
      const res = await createClientInline({ type: newClientType, ...newClientForm })
      if (res.error || !res.id) { setNewClientError(res.error ?? 'Erreur inconnue'); return }
      const newC: Client = {
        id: res.id!, organization_id: '', type: newClientType,
        company_name: newClientType === 'company' ? newClientForm.company_name || null : null,
        contact_name: newClientType === 'company' ? newClientForm.contact_name || null : null,
        first_name: newClientForm.first_name || null,
        last_name: newClientForm.last_name || null,
        email: newClientForm.email || null,
        phone: newClientForm.phone || null,
        siret: null,
        address_line1: newClientForm.address_line1 || null,
        postal_code: newClientForm.postal_code || null,
        city: newClientForm.city || null,
        status: 'active', source: null, total_revenue: 0, payment_terms_days: 30,
        created_at: new Date().toISOString(),
      }
      setClients(prev => [...prev, newC])
      setFormClientId(res.id!)
      setNewClientOpen(false)
      setNewClientForm({ company_name: '', contact_name: '', first_name: '', last_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' })
    })
  }

  // ── Form state ─────────────────────────────────────────────────────────────
  const [formClientId, setFormClientId] = useState(initialClients[0]?.id ?? '')
  const [formTitle, setFormTitle] = useState('')
  const [formFreq, setFormFreq] = useState<RecurringFrequency>('monthly')
  const [formSendDay, setFormSendDay] = useState(1)
  const [formCustomDays, setFormCustomDays] = useState(30)
  const [formFirstDate, setFormFirstDate] = useState(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  )
  const [formConfirmDelay, setFormConfirmDelay] = useState(3)
  const [formAutoSendDelay, setFormAutoSendDelay] = useState<number | null>(null)
  const [formItems, setFormItems] = useState<FormItem[]>([
    { id: 1, desc: '', qty: 1, unit: '', pu: 0, vat: defaultVatRate, is_internal: false },
  ])

  // Pré-remplir depuis une facture existante
  useEffect(() => {
    if (fromInvoice) {
      setFormTitle(fromInvoice.title)
      setFormClientId(fromInvoice.clientId || initialClients[0]?.id || '')
      setFormItems(fromInvoice.items.length > 0
        ? fromInvoice.items
        : [{ id: 1, desc: '', qty: 1, unit: '', pu: 0, vat: defaultVatRate, is_internal: false }])
      setShowForm(true)
    }
  }, [defaultVatRate, fromInvoice, initialClients]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Form helpers ────────────────────────────────────────────────────────────

  function updateFormItem(id: number, field: keyof FormItem, value: string | number | boolean) {
    setFormItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  function resetForm() {
    setFormTitle('')
    setFormClientId(initialClients[0]?.id ?? '')
    setFormFreq('monthly')
    setFormSendDay(1)
    setFormCustomDays(30)
    setFormFirstDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
    setFormConfirmDelay(3)
    setFormAutoSendDelay(null)
    setFormItems([{ id: 1, desc: '', qty: 1, unit: '', pu: 0, vat: defaultVatRate, is_internal: false }])
    setFormError(null)
  }

  // ── Catalog helpers ─────────────────────────────────────────────────────────

  const filteredMaterials = materials.filter(m =>
    !catalogSearch || m.name.toLowerCase().includes(catalogSearch.toLowerCase()),
  )
  const filteredLabor = laborRates.filter(l =>
    !catalogSearch || l.designation.toLowerCase().includes(catalogSearch.toLowerCase()),
  )
  const filteredPrestations = prestationTypes.filter(p =>
    !catalogSearch || p.name.toLowerCase().includes(catalogSearch.toLowerCase()),
  )

  function replaceOrAppend(prev: FormItem[], newItems: FormItem[]): FormItem[] {
    const isStarterOnly = prev.length === 1 && prev[0].desc === '' && prev[0].pu === 0
    return isStarterOnly ? newItems : [...prev, ...newItems]
  }

  function addFromCatalog(name: string, unit: string | null, price: number, vat: number, isInternal = false) {
    const newItem = { id: Date.now(), desc: name, qty: 1, unit: unit ?? '', pu: price, vat, is_internal: isInternal }
    setFormItems(prev => replaceOrAppend(prev, [newItem]))
    setShowCatalog(false)
    setCatalogSearch('')
  }

  function addMaterialFromCatalog(material: CatalogMaterial) {
    const pricing = buildMaterialSelectionPricing({ item: material })
    const newItem = {
      id: Date.now(),
      desc: material.name,
      qty: pricing.quantity,
      unit: pricing.unit,
      pu: pricing.unitPrice,
      vat: defaultVatRate,
      is_internal: false,
    }
    setFormItems(prev => replaceOrAppend(prev, [newItem]))
    setShowCatalog(false)
    setCatalogSearch('')
  }

  function addPrestationToItems(p: PrestationType) {
    const newItems = p.items.map(item => ({
      id: Date.now() + Math.random(),
      desc: item.designation,
      qty: item.quantity,
      unit: item.unit,
      pu: item.unit_price_ht,
      vat: defaultVatRate,
      is_internal: item.is_internal,
    }))
    setFormItems(prev => replaceOrAppend(prev, newItems))
    setShowCatalog(false)
    setCatalogSearch('')
  }

  const hasCatalog = materials.length > 0 || laborRates.length > 0 || prestationTypes.length > 0

  // ── Transport ──────────────────────────────────────────────────────────────
  const [showTransport, setShowTransport] = useState(false)
  const [transportKm, setTransportKm] = useState(100)
  const [transportConso, setTransportConso] = useState(8)
  const [transportPrixL, setTransportPrixL] = useState(1.85)
  const transportLiters = Math.round(transportKm * transportConso / 100 * 100) / 100
  const transportCost = Math.round(transportLiters * transportPrixL * 100) / 100

  function handleAddTransport() {
    const newItem = {
      id: Date.now(),
      desc: `Carburant - trajet ${transportKm} km`,
      qty: transportLiters,
      unit: 'L',
      pu: transportPrixL,
      vat: defaultVatRate,
      is_internal: true,
    }
    setFormItems(prev => replaceOrAppend(prev, [newItem]))
    setShowTransport(false)
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  function handleCreateSubmit(e: React.SyntheticEvent) {
    e.preventDefault()
    if (!formClientId) { setFormError('Sélectionnez un client.'); return }
    if (!formTitle.trim()) { setFormError('Entrez un intitulé.'); return }
    if (formItems.every(i => !i.desc.trim())) { setFormError('Ajoutez au moins une ligne.'); return }

    setIsSaving(true)
    setFormError(null)
    startTransition(async () => {
      const res = await createRecurringInvoice({
        clientId: formClientId,
        title: formTitle.trim(),
        frequency: formFreq,
        sendDay: ['monthly', 'quarterly'].includes(formFreq) ? formSendDay : null,
        customIntervalDays: formFreq === 'custom' ? formCustomDays : null,
        firstSendDate: formFirstDate,
        requiresConfirmation: true,
        confirmationDelayDays: formConfirmDelay,
        autoSendDelayDays: formAutoSendDelay,
        items: formItems
          .filter(i => i.desc.trim())
          .map((i, idx) => ({
            description: i.desc,
            quantity: Number(i.qty),
            unit: i.unit,
            unit_price: Number(i.pu),
            vat_rate: Number(i.vat),
            position: idx,
            is_internal: i.is_internal,
          })),
      })
      setIsSaving(false)
      if (res.error) { setFormError(res.error); return }
      setShowForm(false)
      resetForm()
      router.refresh()
    })
  }

  // ── Actions ─────────────────────────────────────────────────────────────────

  function handleToggle(inv: RecurringInvoice) {
    setLoadingId(`toggle-${inv.id}`)
    startTransition(async () => {
      await toggleRecurringActive(inv.id, !inv.is_active)
      setInvoices(prev => prev.map(i => i.id === inv.id ? { ...i, is_active: !i.is_active } : i))
      setLoadingId(null)
    })
  }

  function handleCancel(id: string) {
    if (!confirm('Arrêter définitivement ce modèle de facturation ?')) return
    setLoadingId(`cancel-${id}`)
    startTransition(async () => {
      await cancelRecurringInvoice(id)
      setInvoices(prev => prev.filter(i => i.id !== id))
      setLoadingId(null)
    })
  }

  function handleSkip(scheduleId: string) {
    setLoadingId(`skip-${scheduleId}`)
    startTransition(async () => {
      await skipSchedule(scheduleId)
      setSchedules(prev => prev.filter(s => s.id !== scheduleId))
      setLoadingId(null)
    })
  }

  // ── Totaux ──────────────────────────────────────────────────────────────────
  const clientItems = formItems.filter(i => !i.is_internal)
  const internalItems = formItems.filter(i => i.is_internal)
  const totalHt = clientItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu), 0)
  const totalInternalHt = internalItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu), 0)
  const margeHt = totalHt - totalInternalHt
  const margePct = totalHt > 0 ? (margeHt / totalHt) * 100 : 0
  const hasInternal = internalItems.length > 0

  return (
    <main className="flex-1 p-8 max-w-[1200px] mx-auto w-full space-y-8">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/finances" className="w-10 h-10 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] flex items-center justify-center text-secondary hover:text-primary transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-primary">Factures récurrentes</h1>
            <p className="text-sm text-secondary">Modèles d'abonnement et contrats mensuels</p>
          </div>
        </div>
        <button
          onClick={() => { resetForm(); setShowForm(true) }}
          className="px-6 py-2.5 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20"
        >
          <Plus className="w-4 h-4" />
          Nouveau modèle
        </button>
      </div>

      {/* ── À confirmer ── */}
      {schedules.length > 0 && (
        <div className={`${cardCls} p-8`}>
          <div className="flex items-center gap-3 mb-6">
            <AlertCircle className="w-5 h-5 text-amber-500" />
            <h2 className="text-lg font-bold text-primary">
              À confirmer avant envoi
              <span className="ml-2 text-sm font-bold text-amber-500 bg-amber-500/10 px-2.5 py-0.5 rounded-full">
                {schedules.length}
              </span>
            </h2>
          </div>
          <div className="flex flex-col gap-3">
            {schedules.map(s => (
              <div key={s.id} className="flex items-center justify-between p-4 rounded-2xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20">
                <div className="min-w-0">
                  <p className="font-semibold text-primary truncate">{s.recurring_invoice?.title ?? '-'}</p>
                  <p className="text-sm text-secondary mt-0.5">
                    {s.recurring_invoice?.client?.company_name
                      || [s.recurring_invoice?.client?.first_name, s.recurring_invoice?.client?.last_name].filter(Boolean).join(' ')
                      || '-'}
                    {s.scheduled_date ? ` · Envoi prévu le ${fmtDate(s.scheduled_date)}` : ''}
                    {s.amount_ht != null ? ` · ${fmt(s.amount_ht)} HT` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  {s.invoice_id && (
                    <Link
                      href={`/finances/invoice-editor?id=${s.invoice_id}`}
                      className="px-4 py-2 rounded-full bg-accent text-black font-bold text-sm flex items-center gap-1.5 hover:scale-105 transition-all"
                    >
                      Vérifier & Envoyer
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  )}
                  <button
                    onClick={() => handleSkip(s.id)}
                    disabled={!!loadingId}
                    title="Ignorer cette occurrence"
                    className="p-2 text-secondary hover:text-red-500 transition-colors disabled:opacity-50 rounded-lg hover:bg-red-500/5"
                  >
                    {loadingId === `skip-${s.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Liste des modèles ── */}
      <div className={`${cardCls} p-8`}>
        <h2 className="text-lg font-bold text-primary mb-6">Modèles actifs</h2>
        {invoices.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-secondary">
            <Repeat className="w-10 h-10 opacity-20" />
            <p className="font-semibold">Aucun modèle récurrent</p>
            <p className="text-sm">Créez un modèle pour automatiser vos factures mensuelles.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {invoices.map(inv => {
              const totalHtInv = (inv.items ?? []).reduce((s, i) => s + i.quantity * i.unit_price, 0)
              return (
                <div
                  key={inv.id}
                  className={`flex items-center justify-between p-4 rounded-2xl border transition-all ${
                    inv.is_active ? 'bg-surface border-[var(--elevation-border)]' : 'bg-base/30 border-[var(--elevation-border)] opacity-60'
                  }`}
                >
                  <div className="flex items-center gap-4 min-w-0">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${inv.is_active ? 'bg-accent-green' : 'bg-secondary/30'}`} />
                    <div className="min-w-0">
                      <p className="font-semibold text-primary truncate">{inv.title}</p>
                      <p className="text-sm text-secondary mt-0.5">
                        {inv.client?.company_name || [inv.client?.first_name, inv.client?.last_name].filter(Boolean).join(' ') || '-'}
                        {' · '}{frequencyLabel(inv.frequency)}
                        {inv.frequency === 'monthly' && inv.send_day ? ` (le ${inv.send_day})` : ''}
                        {inv.frequency === 'custom' && inv.custom_interval_days ? ` (${inv.custom_interval_days}j)` : ''}
                        {totalHtInv > 0 ? ` · ${fmt(totalHtInv)} HT` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 ml-4 shrink-0">
                    {inv.is_active && (
                      <div className="flex items-center gap-1.5 text-xs text-secondary">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{fmtDate(inv.next_send_date)}</span>
                      </div>
                    )}
                    <button onClick={() => handleToggle(inv)} disabled={!!loadingId} title={inv.is_active ? 'Mettre en pause' : 'Reprendre'} className="p-1.5 text-secondary hover:text-primary transition-colors disabled:opacity-50 rounded-lg hover:bg-black/5 dark:hover:bg-white/5">
                      {loadingId === `toggle-${inv.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : inv.is_active ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                    </button>
                    <button onClick={() => handleCancel(inv.id)} disabled={!!loadingId} title="Arrêter définitivement" className="p-1.5 text-secondary hover:text-red-500 transition-colors disabled:opacity-50 rounded-lg hover:bg-red-500/5">
                      {loadingId === `cancel-${inv.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── Modal Transport ── */}
      {showTransport && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="rounded-3xl bg-surface dark:bg-[#111] border border-[var(--elevation-border)] w-full max-w-sm shadow-2xl p-8 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/10 flex items-center justify-center">
                  <Truck className="w-5 h-5 text-amber-500" />
                </div>
                <h3 className="text-lg font-bold text-primary">Calculer le transport</h3>
              </div>
              <button onClick={() => setShowTransport(false)} className="text-secondary hover:text-primary transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-secondary">Distance aller-retour (km)</label>
                <input type="number" min={1} value={transportKm} onChange={e => setTransportKm(Number(e.target.value))}
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Consommation (L/100 km)</label>
                  <input type="number" min={1} step={0.1} value={transportConso} onChange={e => setTransportConso(Number(e.target.value))}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Prix carburant (€/L)</label>
                  <input type="number" min={0} step={0.01} value={transportPrixL} onChange={e => setTransportPrixL(Number(e.target.value))}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                </div>
              </div>
              <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Volume carburant</span>
                  <span className="font-semibold text-primary tabular-nums">{transportLiters.toFixed(2)} L</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-secondary">Coût total</span>
                  <span className="font-bold text-amber-600 tabular-nums">{fmt(transportCost)}</span>
                </div>
                <p className="text-xs text-amber-600 flex items-center gap-1 pt-1 border-t border-amber-200 dark:border-amber-500/20 mt-2">
                  <EyeOff className="w-3 h-3 shrink-0" />
                  Ligne interne — coût de revient, non visible sur la facture client
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowTransport(false)}
                className="px-5 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold">Annuler</button>
              <button type="button" onClick={handleAddTransport}
                className="px-5 py-2.5 rounded-full bg-amber-500 text-white font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-amber-500/20">
                <Plus className="w-4 h-4" />Ajouter la ligne
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal catalogue ── */}
      {showCatalog && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="rounded-3xl bg-surface dark:bg-[#111] border border-[var(--elevation-border)] w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-6 pb-4 border-b border-[var(--elevation-border)]">
              <h3 className="text-lg font-bold text-primary">Ajouter depuis le catalogue</h3>
              <button onClick={() => { setShowCatalog(false); setCatalogSearch('') }} className="text-secondary hover:text-primary transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 border-b border-[var(--elevation-border)]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  placeholder="Rechercher matériau, MO, prestation..."
                  autoFocus
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {filteredMaterials.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 px-1">Matériaux</p>
                  <div className="space-y-1">
                    {filteredMaterials.map(m => (
                      <button
                        key={m.id}
                        onClick={() => addMaterialFromCatalog(m)}
                        className="w-full text-left p-3 rounded-xl hover:bg-accent/5 hover:border-accent border border-transparent transition-all flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium text-primary text-sm">{m.name}</p>
                          {m.category && <p className="text-xs text-secondary">{m.category}{m.unit ? ` · ${m.unit}` : ''}</p>}
                        </div>
                        <span className="text-sm font-bold text-primary tabular-nums ml-4 shrink-0">
                          {m.sale_price != null ? fmt(m.sale_price) : '-'}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {filteredLabor.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 px-1">Ressources internes</p>
                  <div className="space-y-1">
                    {filteredLabor.map(l => (
                      <button
                        key={l.id}
                        onClick={() => addFromCatalog(l.designation, l.unit, getInternalResourceUnitCost(l), defaultVatRate)}
                        className="w-full text-left p-3 rounded-xl hover:bg-accent/5 hover:border-accent border border-transparent transition-all flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium text-primary text-sm">{l.designation}</p>
                          {l.category && <p className="text-xs text-secondary">{l.category}{l.unit ? ` · ${l.unit}` : ''}</p>}
                          <p className="text-xs text-secondary">Ressource interne</p>
                        </div>
                        <div className="text-right ml-4 shrink-0">
                          <span className="text-sm font-bold text-primary tabular-nums">{fmt(getInternalResourceUnitCost(l))}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {filteredPrestations.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 px-1">Prestations</p>
                  <div className="space-y-1">
                    {filteredPrestations.map(p => (
                      <button
                        key={p.id}
                        onClick={() => addPrestationToItems(p)}
                        className="w-full text-left p-3 rounded-xl hover:bg-accent/5 hover:border-accent border border-transparent transition-all flex items-center justify-between"
                      >
                        <div>
                          <p className="font-medium text-primary text-sm">{p.name}</p>
                          <p className="text-xs text-secondary">{p.items.length} ligne{p.items.length > 1 ? 's' : ''}{p.category ? ` · ${p.category}` : ''}</p>
                        </div>
                        <span className="text-sm font-bold text-primary tabular-nums ml-4 shrink-0">{fmt(p.base_price_ht)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {filteredMaterials.length === 0 && filteredLabor.length === 0 && filteredPrestations.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-secondary gap-2">
                  <Search className="w-8 h-8 opacity-20" />
                  <p className="text-sm">{catalogSearch ? 'Aucun résultat' : 'Catalogue vide'}</p>
                  {!catalogSearch && <p className="text-xs">Ajoutez des éléments dans le catalogue pour les utiliser ici.</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal nouveau client inline ── */}
      {newClientOpen && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="rounded-3xl bg-surface dark:bg-[#111] border border-[var(--elevation-border)] w-full max-w-lg shadow-2xl p-8 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-primary">Nouveau client</h3>
              <button onClick={() => setNewClientOpen(false)} className="text-secondary hover:text-primary transition-colors"><X className="w-5 h-5" /></button>
            </div>
            {newClientError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 text-sm">{newClientError}</div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNewClientType('company')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border ${newClientType === 'company' ? 'bg-accent/10 border-accent text-accent' : 'border-[var(--elevation-border)] text-secondary'}`}
              >Professionnel</button>
              <button
                type="button"
                onClick={() => setNewClientType('individual')}
                className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all border ${newClientType === 'individual' ? 'bg-accent/10 border-accent text-accent' : 'border-[var(--elevation-border)] text-secondary'}`}
              >Particulier</button>
            </div>
            <div className="space-y-3">
              {newClientType === 'company' ? (
                <>
                  <input type="text" placeholder="Raison sociale *" value={newClientForm.company_name}
                    onChange={e => setNewClientForm(f => ({ ...f, company_name: e.target.value }))}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
                  <input type="text" placeholder="Nom du contact référent" value={newClientForm.contact_name}
                    onChange={e => setNewClientForm(f => ({ ...f, contact_name: e.target.value }))}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <input type="text" placeholder="Prénom" value={newClientForm.first_name}
                    onChange={e => setNewClientForm(f => ({ ...f, first_name: e.target.value }))}
                    className="p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
                  <input type="text" placeholder="Nom *" value={newClientForm.last_name}
                    onChange={e => setNewClientForm(f => ({ ...f, last_name: e.target.value }))}
                    className="p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <input type="email" placeholder="Email" value={newClientForm.email}
                  onChange={e => setNewClientForm(f => ({ ...f, email: e.target.value }))}
                  className="p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
                <input type="tel" placeholder="Téléphone" value={newClientForm.phone}
                  onChange={e => setNewClientForm(f => ({ ...f, phone: e.target.value }))}
                  className="p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
              <input type="text" placeholder="Adresse" value={newClientForm.address_line1}
                onChange={e => setNewClientForm(f => ({ ...f, address_line1: e.target.value }))}
                className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
              <div className="grid grid-cols-2 gap-3">
                <input type="text" placeholder="Code postal" value={newClientForm.postal_code}
                  onChange={e => setNewClientForm(f => ({ ...f, postal_code: e.target.value }))}
                  className="p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
                <input type="text" placeholder="Ville" value={newClientForm.city}
                  onChange={e => setNewClientForm(f => ({ ...f, city: e.target.value }))}
                  className="p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" onClick={() => setNewClientOpen(false)} className="px-5 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold">Annuler</button>
              <button type="button" onClick={handleCreateClientInline} disabled={newClientPending}
                className="px-5 py-2.5 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all disabled:opacity-50 disabled:scale-100">
                {newClientPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Créer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal création modèle ── */}
      {showForm && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="rounded-3xl bg-surface dark:bg-[#111] border border-[var(--elevation-border)] w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between p-8 pb-6 border-b border-[var(--elevation-border)]">
              <h2 className="text-xl font-bold text-primary">
                {fromInvoice ? 'Convertir en modèle récurrent' : 'Nouveau modèle récurrent'}
              </h2>
              <button onClick={() => setShowForm(false)} className="text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
            </div>

            <form onSubmit={handleCreateSubmit} className="flex-1 overflow-y-auto p-8 space-y-6">
              {formError && (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 text-sm">{formError}</div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2 md:col-span-2">
                  <label className="text-sm font-semibold text-secondary">Intitulé</label>
                  <input type="text" value={formTitle} onChange={e => setFormTitle(e.target.value)} placeholder="Ex : Maintenance mensuelle" className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" required />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-sm font-semibold text-secondary">Client</label>
                    <button type="button"
                      onClick={() => { setNewClientOpen(true); setNewClientError(null); setNewClientForm({ company_name: '', contact_name: '', first_name: '', last_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' }); setNewClientType('company') }}
                      className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-semibold transition-colors">
                      <Plus className="w-3 h-3" />Nouveau client
                    </button>
                  </div>
                  <select value={formClientId} onChange={e => setFormClientId(e.target.value)} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none" required>
                    <option value="">Sélectionner...</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{clientDisplayName(c)}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Fréquence</label>
                  <select value={formFreq} onChange={e => setFormFreq(e.target.value as RecurringFrequency)} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none">
                    {FREQ_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                {['monthly', 'quarterly'].includes(formFreq) && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-secondary">Jour d'envoi (1–28)</label>
                    <input type="number" min={1} max={28} value={formSendDay} onChange={e => setFormSendDay(Number(e.target.value))} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
                  </div>
                )}
                {formFreq === 'custom' && (
                  <div className="space-y-2">
                    <label className="text-sm font-semibold text-secondary">Intervalle (jours)</label>
                    <input type="number" min={1} value={formCustomDays} onChange={e => setFormCustomDays(Number(e.target.value))} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Premier envoi</label>
                  <input type="date" value={formFirstDate} onChange={e => setFormFirstDate(e.target.value)} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" required />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Préparer le brouillon (jours avant)</label>
                  <input type="number" min={0} max={14} value={formConfirmDelay} onChange={e => setFormConfirmDelay(Number(e.target.value))} className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
                  <p className="text-xs text-secondary">Le brouillon apparaît {formConfirmDelay}j avant l'envoi pour vérification.</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Envoi automatique si non validé</label>
                  <div className="flex items-center gap-2">
                    <select
                      value={formAutoSendDelay === null ? '' : String(formAutoSendDelay)}
                      onChange={e => setFormAutoSendDelay(e.target.value === '' ? null : Number(e.target.value))}
                      className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                    >
                      <option value="">Désactivé — validation manuelle requise</option>
                      <option value="1">1 jour après création du brouillon</option>
                      <option value="2">2 jours après création du brouillon</option>
                      <option value="3">3 jours après création du brouillon</option>
                      <option value="5">5 jours après création du brouillon</option>
                      <option value="7">7 jours après création du brouillon</option>
                    </select>
                  </div>
                  <p className="text-xs text-secondary">
                    {formAutoSendDelay === null
                      ? 'La facture attend votre validation manuelle avant d\'être envoyée.'
                      : `Si le brouillon n'est pas validé après ${formAutoSendDelay}j, la facture est envoyée automatiquement avec PDF.`}
                  </p>
                </div>
              </div>

              {/* Lignes */}
              <div>
                <p className="text-sm font-semibold text-secondary mb-3">Lignes de facturation</p>
                <div className="space-y-2">
                  {formItems.map(item => (
                    <div
                      key={item.id}
                      className={`flex items-center gap-2 p-2 rounded-xl transition-colors ${item.is_internal ? 'bg-amber-50 dark:bg-amber-500/5' : ''}`}
                    >
                      <input type="text" value={item.desc} onChange={e => updateFormItem(item.id, 'desc', e.target.value)} placeholder="Description" className="flex-1 p-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50" />
                      <input type="number" min={0} value={item.qty} onChange={e => updateFormItem(item.id, 'qty', e.target.value)} className="w-14 p-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm text-right focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                      <input type="text" value={item.unit} onChange={e => updateFormItem(item.id, 'unit', e.target.value)} placeholder="u" className="w-12 p-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent/50" />
                      <div className="relative">
                        <input type="number" min={0} value={item.pu} onChange={e => updateFormItem(item.id, 'pu', e.target.value)} className="w-24 p-2.5 pr-5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm text-right focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary text-xs pointer-events-none">€</span>
                      </div>
                      <select value={item.vat} onChange={e => updateFormItem(item.id, 'vat', Number(e.target.value))} className="w-16 p-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none">
                        {LEGAL_VAT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                      </select>
                      <button
                        type="button"
                        onClick={() => updateFormItem(item.id, 'is_internal', !item.is_internal)}
                        title={item.is_internal ? 'Ligne interne — coût de revient, non visible sur la facture client (cliquer pour rendre visible)' : 'Rendre interne (coût non facturé au client, visible seulement dans votre marge)'}
                        className={`p-1.5 rounded-lg transition-colors ${item.is_internal ? 'text-amber-500 bg-amber-500/10' : 'text-secondary/30 hover:text-secondary'}`}
                      >
                        <EyeOff className="w-4 h-4" />
                      </button>
                      {formItems.length > 1 && (
                        <button type="button" onClick={() => setFormItems(prev => prev.filter(i => i.id !== item.id))} className="p-1.5 text-secondary hover:text-red-500 transition-colors"><X className="w-4 h-4" /></button>
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2 flex-wrap">
                  <button type="button" onClick={() => setFormItems(prev => [...prev, { id: Date.now(), desc: '', qty: 1, unit: '', pu: 0, vat: defaultVatRate, is_internal: false }])} className="flex items-center gap-2 text-sm font-semibold text-secondary hover:text-primary transition-colors px-3 py-1.5 rounded-lg bg-base/50">
                    <Plus className="w-4 h-4" />Ligne libre
                  </button>
                  {hasCatalog && (
                    <button type="button" onClick={() => setShowCatalog(true)} className="flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors px-3 py-1.5 rounded-lg bg-accent/10">
                      <Search className="w-4 h-4" />Depuis le catalogue
                    </button>
                  )}
                  <button type="button" onClick={() => setShowTransport(true)} className="flex items-center gap-2 text-sm font-semibold text-amber-600 hover:text-amber-500 transition-colors px-3 py-1.5 rounded-lg bg-amber-500/10">
                    <Truck className="w-4 h-4" />Transport
                  </button>
                </div>
                {formItems.some(i => i.is_internal) && (
                  <p className="mt-2 text-xs text-amber-500 flex items-center gap-1.5">
                    <EyeOff className="w-3 h-3 shrink-0" />
                    Les lignes en orange sont internes : coût de revient uniquement, elles n'apparaissent pas sur la facture client.
                  </p>
                )}
              </div>

              {/* Résumé */}
              {totalHt > 0 && (
                <div className="space-y-2">
                  <div className="p-4 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-between">
                    <span className="text-sm font-semibold text-primary">Montant HT / occurrence</span>
                    <span className="font-bold text-primary tabular-nums text-lg">{fmt(totalHt)}</span>
                  </div>
                  {hasInternal && (
                    <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-500/5 border border-amber-200 dark:border-amber-500/20 space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-secondary">Coût interne</span>
                        <span className="font-semibold text-amber-600 tabular-nums">{fmt(totalInternalHt)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-secondary">Marge brute</span>
                        <span className={`font-bold tabular-nums ${margeHt >= 0 ? 'text-green-600' : 'text-red-500'}`}>{fmt(margeHt)}</span>
                      </div>
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-secondary">Taux de marge</span>
                        <span className={`font-bold tabular-nums ${margePct >= 0 ? 'text-green-600' : 'text-red-500'}`}>{margePct.toFixed(1)}%</span>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </form>

            <div className="p-8 flex justify-end gap-3 border-t border-[var(--elevation-border)]">
              <button type="button" onClick={() => setShowForm(false)} className="px-6 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold">Annuler</button>
              <button onClick={handleCreateSubmit} disabled={isSaving} className="px-6 py-2.5 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all disabled:opacity-50 disabled:scale-100">
                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                {fromInvoice ? 'Créer le modèle récurrent' : 'Créer le modèle'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
