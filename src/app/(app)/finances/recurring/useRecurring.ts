'use client'
// @atelier-migrated
// Logique de l'éditeur : états, calculs et envoi. L'affichage vit dans RecurringClient.tsx.

import React, { useState, useTransition, useEffect } from 'react'

import { useRouter, useSearchParams } from 'next/navigation'

import type { Client } from '@/lib/data/queries/clients'
import type { CatalogMaterial, CatalogLaborRate, PrestationType } from '@/lib/data/queries/catalog'
import type { RecurringInvoice, PendingSchedule, RecurringFrequency } from '@/lib/data/recurring-utils'
import { buildMaterialSelectionPricing } from '@/lib/catalog-pricing'

import { createRecurringInvoice, toggleRecurringActive, cancelRecurringInvoice, skipSchedule, prepareNextRecurringDraft } from '@/lib/data/mutations/recurring'
import { createClientInline } from '@/lib/data/mutations/clients'

import { type VatConfig, dateParis } from '@/lib/utils'
import { getCatalogDocumentVatRate } from '@/lib/catalog-ui'
import { FormItem, FromInvoice } from './recurringModel'

export type RecurringProps = {
  clients: Client[]
  recurringInvoices: RecurringInvoice[]
  pendingSchedules: PendingSchedule[]
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  prestationTypes: PrestationType[]
  fromInvoice: FromInvoice
  vatConfig: VatConfig
}

export function useRecurring({
  clients: initialClients,
  recurringInvoices: initial,
  pendingSchedules: initialSchedules,
  materials,
  laborRates,
  prestationTypes,
  fromInvoice,
  vatConfig,
}: RecurringProps) {

  const router = useRouter()
  const searchParams = useSearchParams()
  const highlightId = searchParams.get('highlight')
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
  const [pageError, setPageError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    setInvoices(initial)
    setSchedules(initialSchedules)
    setIsRefreshing(false)
  }, [initial, initialSchedules])

  useEffect(() => {
    if (highlightId) {
      document.getElementById(`recurring-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId, invoices.length])

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
        status: 'active', source: null, total_revenue: 0, payment_terms_days: 30, internal_notes: null,
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
    dateParis(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
    setFormFirstDate(dateParis(Date.now() + 30 * 24 * 60 * 60 * 1000))
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

  // ── Équipement amorti ────────────────────────────────────────────────────────
  const [showEquipment, setShowEquipment] = useState(false)
  const [equipmentName, setEquipmentName] = useState('')
  const [equipmentPurchase, setEquipmentPurchase] = useState(0)
  const [equipmentUses, setEquipmentUses] = useState(100)
  const equipmentCostPerUse = equipmentUses > 0 ? Math.round((equipmentPurchase / equipmentUses) * 100) / 100 : 0

  function handleAddEquipment() {
    if (equipmentPurchase <= 0 || equipmentUses <= 0) return
    const equipmentLabel = equipmentName.trim() || 'Équipement amorti'
    const newItem = {
      id: Date.now(),
      desc: `${equipmentLabel}\n\nAmortissement : ${equipmentPurchase} € / ${equipmentUses} usages`,
      qty: 1,
      unit: 'usage',
      pu: equipmentCostPerUse,
      vat: defaultVatRate,
      is_internal: true,
    }
    setFormItems(prev => replaceOrAppend(prev, [newItem]))
    setShowEquipment(false)
  }

  // ── Create ──────────────────────────────────────────────────────────────────

  function handleCreateSubmit(e?: React.SyntheticEvent) {
    e?.preventDefault()
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
      setIsRefreshing(true)
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
    setLoadingId(`cancel-${id}`)
    startTransition(async () => {
      await cancelRecurringInvoice(id)
      setInvoices(prev => prev.filter(i => i.id !== id))
      setLoadingId(null)
    })
  }

  function handlePrepareDraft(inv: RecurringInvoice) {
    setLoadingId(`prepare-${inv.id}`)
    setPageError(null)
    startTransition(async () => {
      const res = await prepareNextRecurringDraft(inv.id)
      setLoadingId(null)
      if (res.error) { setPageError(res.error); return }
      if (res.invoiceId) {
        router.push(`/finances/invoice-editor?id=${res.invoiceId}&returnTo=${encodeURIComponent('/finances/recurring')}`)
        return
      }
      router.refresh()
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

  return {
    initialClients,
    initial,
    initialSchedules,
    materials,
    laborRates,
    prestationTypes,
    fromInvoice,
    vatConfig,
    router,
    searchParams,
    highlightId,
    startTransition,
    defaultVatRate,
    clients,
    setClients,
    invoices,
    setInvoices,
    schedules,
    setSchedules,
    loadingId,
    setLoadingId,
    showForm,
    setShowForm,
    showCatalog,
    setShowCatalog,
    catalogSearch,
    setCatalogSearch,
    formError,
    setFormError,
    pageError,
    setPageError,
    isSaving,
    setIsSaving,
    isRefreshing,
    setIsRefreshing,
    newClientOpen,
    setNewClientOpen,
    newClientType,
    setNewClientType,
    newClientForm,
    setNewClientForm,
    newClientError,
    setNewClientError,
    newClientPending,
    startNewClientTransition,
    handleCreateClientInline,
    formClientId,
    setFormClientId,
    formTitle,
    setFormTitle,
    formFreq,
    setFormFreq,
    formSendDay,
    setFormSendDay,
    formCustomDays,
    setFormCustomDays,
    formFirstDate,
    setFormFirstDate,
    formConfirmDelay,
    setFormConfirmDelay,
    formAutoSendDelay,
    setFormAutoSendDelay,
    formItems,
    setFormItems,
    updateFormItem,
    resetForm,
    filteredMaterials,
    filteredLabor,
    filteredPrestations,
    replaceOrAppend,
    addFromCatalog,
    addMaterialFromCatalog,
    addPrestationToItems,
    hasCatalog,
    showTransport,
    setShowTransport,
    transportKm,
    setTransportKm,
    transportConso,
    setTransportConso,
    transportPrixL,
    setTransportPrixL,
    transportLiters,
    transportCost,
    handleAddTransport,
    showEquipment,
    setShowEquipment,
    equipmentName,
    setEquipmentName,
    equipmentPurchase,
    setEquipmentPurchase,
    equipmentUses,
    setEquipmentUses,
    equipmentCostPerUse,
    handleAddEquipment,
    handleCreateSubmit,
    handleToggle,
    handleCancel,
    handlePrepareDraft,
    handleSkip,
    clientItems,
    internalItems,
    totalHt,
    totalInternalHt,
    margeHt,
    margePct,
    hasInternal,
  }
}

export type Recurring = ReturnType<typeof useRecurring>
