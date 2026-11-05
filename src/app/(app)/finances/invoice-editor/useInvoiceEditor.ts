'use client'
// @atelier-migrated
// Logique de l'éditeur : états, calculs et envoi. L'affichage vit dans InvoiceEditorClient.tsx.

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'

import type { Client } from '@/lib/data/queries/clients'
import type { QuoteWithItems } from '@/lib/data/queries/quotes'
import type { InvoiceWithItems } from '@/lib/data/queries/invoices'
import type { CatalogMaterial, CatalogLaborRate, PrestationType } from '@/lib/data/queries/catalog'
import { type VatConfig } from '@/lib/utils'
import { buildMaterialSelectionPricing } from '@/lib/catalog-pricing'
import { createInvoice, saveInvoiceItems, sendInvoice, savePaymentSchedule } from '@/lib/data/mutations/invoices'
import { type SaveToCatalogResult } from '@/components/catalog/SaveToCatalogModal'
import { fetchClientContractsForAttachment } from '@/lib/data/mutations/contracts'
import { type AttachmentGroup } from '@/components/AttachmentPickerModal'

import { createClientInline } from '@/lib/data/mutations/clients'

import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { getCatalogDocumentVatRate } from '@/lib/catalog-ui'
import { todayParis, dateParis } from '@/lib/utils'
import { computeFuel, DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'
import { LocalItem, getSafeReturnTo, inferDimensionMode, getItemDimensionMode, getModeUnit, getInternalCostTotal, parseEquipmentAmortization, buildEquipmentDescription, computeEquipmentCostPerUse, computeDimensionQuantity, INVOICE_SECTION_UNIT, isSectionItem, LinkableChantier, getTransportMeta, ScheduleAmountType, LocalScheduleItem, computeInvoiceTotals, scheduleAmount } from './invoiceEditorModel'

export type InvoiceEditorProps = {
  clients: Client[]
  acceptedQuotes: QuoteWithItems[]
  existingInvoice?: InvoiceWithItems | null
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  prestationTypes: PrestationType[]
  catalogContext: ResolvedCatalogContext
  vatConfig: VatConfig
  linkableChantiers?: LinkableChantier[]
  defaultChantierId?: string | null
  returnTo?: string | null
}

export function useInvoiceEditor({
  clients: initialClients,
  acceptedQuotes,
  existingInvoice,
  materials,
  laborRates,
  prestationTypes,
  catalogContext,
  vatConfig,
  linkableChantiers = [],
  defaultChantierId = null,
  returnTo: rawReturnTo = null,
}: InvoiceEditorProps) {

  const router = useRouter()
  const [, startTransition] = useTransition()
  const defaultVatRate = getCatalogDocumentVatRate(vatConfig)
  const returnTo = getSafeReturnTo(rawReturnTo, '/finances?tab=invoices')

  const today = todayParis()
  const nextMonth = dateParis(Date.now() + 30 * 24 * 60 * 60 * 1000)

  // ── Clients ──────────────────────────────────────────────────────────────────
  const [clients, setClients] = useState<Client[]>(initialClients)
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [newClientType, setNewClientType] = useState<'company' | 'individual'>('company')
  const [newClientForm, setNewClientForm] = useState({
    company_name: '', first_name: '', last_name: '',
    contact_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '',
  })
  const [newClientError, setNewClientError] = useState<string | null>(null)
  const [newClientPending, startNewClientTransition] = useTransition()

  function handleCreateClientInline() {
    setNewClientError(null)
    startNewClientTransition(async () => {
      const res = await createClientInline({ type: newClientType, ...newClientForm })
      if (res.error || !res.id) { setNewClientError(res.error ?? 'Erreur inconnue'); return }
      setClients(prev => [...prev, {
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
      }])
      setClientId(res.id!)
      setNewClientOpen(false)
      setNewClientForm({ company_name: '', first_name: '', last_name: '', contact_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' })
    })
  }

  // ── Facture ───────────────────────────────────────────────────────────────────
  const [invoiceId, setInvoiceId] = useState<string | null>(existingInvoice?.id ?? null)
  const [title, setTitle] = useState(existingInvoice?.title ?? '')
  const [clientId, setClientId] = useState(existingInvoice?.client_id ?? initialClients[0]?.id ?? '')
  const [issueDate, setIssueDate] = useState(existingInvoice?.issue_date ?? today)
  const [dueDate, setDueDate] = useState(existingInvoice?.due_date ?? nextMonth)
  const [importedQuoteId, setImportedQuoteId] = useState<string | null>(existingInvoice?.quote_id ?? null)
  const [chantierId, setChantierId] = useState<string | null>(existingInvoice?.chantier_id ?? defaultChantierId ?? null)
  const [aidLabel, setAidLabel] = useState<string>(existingInvoice?.aid_label ?? '')
  const [aidAmount, setAidAmount] = useState<number | null>(existingInvoice?.aid_amount ?? null)
  const [showAid, setShowAid] = useState<boolean>(!!(existingInvoice?.aid_label || existingInvoice?.aid_amount))
  const [isReverseCharge, setIsReverseCharge] = useState<boolean>(existingInvoice?.is_reverse_charge ?? false)
  const [aidMode, setAidMode] = useState<'€' | '%'>('€')

  // ── Échéancier ────────────────────────────────────────────────────────────────
  const existingSchedule = existingInvoice?.payment_schedule ?? []
  const [schedule, setSchedule] = useState<LocalScheduleItem[]>(
    existingSchedule.length > 0
      ? existingSchedule.map(s => ({
          id: s.id,
          label: s.label,
          due_date: s.due_date,
          amount: s.amount,
          amount_type: s.amount_type ?? 'amount',
          percentage: s.percentage ?? null,
          paid_payment_id: s.paid_payment_id,
        }))
      : [],
  )
  const [showSchedule, setShowSchedule] = useState(existingSchedule.length > 0)
  const [scheduleSaving, setScheduleSaving] = useState(false)
  const [scheduleError, setScheduleError] = useState<string | null>(null)

  function addScheduleLine() {
    const lastDate = schedule.length > 0 ? schedule[schedule.length - 1].due_date : dueDate
    const nextDate = dateParis(new Date(lastDate).getTime() + 30 * 24 * 60 * 60 * 1000)
    setSchedule(prev => [...prev, { id: `new-${Date.now()}`, label: `Échéance ${prev.length + 1}`, due_date: nextDate, amount: 0, amount_type: 'amount', percentage: null, paid_payment_id: null }])
  }

  function removeScheduleLine(id: string) {
    setSchedule(prev => prev.filter(s => s.id !== id))
  }

  function updateScheduleLine(id: string, field: 'label' | 'due_date' | 'amount' | 'percentage', value: string | number | null) {
    setSchedule(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s))
  }

  function scheduleLineAmount(item: LocalScheduleItem) {
    return scheduleAmount(item, totalTtc)
  }

  function setScheduleAmountType(id: string, amountType: ScheduleAmountType) {
    setSchedule(prev => prev.map(s => {
      if (s.id !== id || s.amount_type === amountType) return s
      if (amountType === 'percentage') {
        const pct = totalTtc > 0 ? Math.round(((Number(s.amount) || 0) / totalTtc) * 10000) / 100 : 0
        return { ...s, amount_type: 'percentage', percentage: pct, amount: scheduleLineAmount(s) }
      }
      return { ...s, amount_type: 'amount', amount: scheduleLineAmount(s), percentage: null }
    }))
  }

  async function handleSaveSchedule() {
    if (!invoiceId) { setScheduleError('Enregistrez d\'abord la facture.'); return }
    setScheduleSaving(true)
    setScheduleError(null)
    const res = await savePaymentSchedule(
      invoiceId,
      schedule.map((s, idx) => ({
        id: s.id.startsWith('new-') ? undefined : s.id,
        label: s.label,
        due_date: s.due_date,
        amount: scheduleLineAmount(s),
        amount_type: s.amount_type,
        percentage: s.amount_type === 'percentage' ? Number(s.percentage) : null,
        position: idx,
      })),
    )
    setScheduleSaving(false)
    if (res.error) setScheduleError(res.error)
  }
  const [items, setItems] = useState<LocalItem[]>(
    existingInvoice?.items?.length
      ? existingInvoice.items.map((i, idx) => ({
          id: idx + 1,
          desc: i.description ?? '',
          qty: i.quantity,
          unit: i.unit ?? '',
          pu: i.unit_price,
          unit_cost_ht: i.unit_cost_ht ?? null,
          vat: i.vat_rate,
          length_m: i.length_m ?? null,
          width_m: i.width_m ?? null,
          height_m: i.height_m ?? null,
          dimension_pricing_mode: inferDimensionMode(i),
          dim_quantity: (i as { dim_quantity?: number }).dim_quantity ?? 1,
          is_internal: i.is_internal ?? false,
          material_id: i.material_id ?? null,
          ...getTransportMeta(i),
        }))
      : [],
  )
  const [expandedItems, setExpandedItems] = useState<Set<number>>(new Set())

  // ── Catalogue ─────────────────────────────────────────────────────────────────
  const [isCatalogModalOpen, setIsCatalogModalOpen] = useState(false)
  const [catalogSearch, setCatalogSearch] = useState('')
  const hasCatalog = materials.length > 0 || laborRates.length > 0 || prestationTypes.length > 0

  const filteredMaterials = materials.filter(m =>
    !catalogSearch || m.name.toLowerCase().includes(catalogSearch.toLowerCase()))
  const filteredLabor = laborRates.filter(l =>
    !catalogSearch || l.designation.toLowerCase().includes(catalogSearch.toLowerCase()))
  const filteredPrestations = prestationTypes.filter(p =>
    !catalogSearch || p.name.toLowerCase().includes(catalogSearch.toLowerCase()))

  function replaceOrAppend(prev: LocalItem[], newItems: LocalItem[]): LocalItem[] {
    return [...prev, ...newItems]
  }

  function addFromCatalog(name: string, unit: string | null, price: number, vat: number, isInternal = false, unitCostHt: number | null = null) {
    const newItem = {
      id: Date.now(),
      desc: name,
      qty: 1,
      unit: unit ?? '',
      pu: price,
      unit_cost_ht: unitCostHt,
      vat,
      length_m: null,
      width_m: null,
      height_m: null,
      dimension_pricing_mode: null,
      dim_quantity: 1,
      is_internal: isInternal,
      material_id: null,
      transport_km: null,
      transport_conso: null,
      transport_prix_l: null,
    }
    setItems(prev => replaceOrAppend(prev, [newItem]))
    setIsCatalogModalOpen(false)
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
      unit_cost_ht: material.purchase_price ?? null,
      vat: defaultVatRate,
      length_m: pricing.lengthM,
      width_m: pricing.widthM,
      height_m: pricing.heightM,
      dimension_pricing_mode: material.dimension_pricing_mode ?? null,
      dim_quantity: 1,
      is_internal: false,
      material_id: material.id,
      transport_km: null,
      transport_conso: null,
      transport_prix_l: null,
    }
    setItems(prev => replaceOrAppend(prev, [newItem]))
    setIsCatalogModalOpen(false)
    setCatalogSearch('')
  }

  function addPrestationToItems(p: PrestationType) {
    const newItems = p.items.map(item => {
      const isEquipment = item.item_type === 'equipment'
      const equipmentCostPerUse = item.unit_cost_ht > 0 ? item.unit_cost_ht : item.unit_price_ht

      return {
        id: Date.now() + Math.random(),
        desc: item.designation,
        qty: isEquipment ? (item.quantity || 1) : item.quantity,
        unit: isEquipment ? 'usage' : item.unit,
        pu: isEquipment ? equipmentCostPerUse : item.unit_price_ht,
        unit_cost_ht: isEquipment ? null : item.unit_cost_ht,
        vat: defaultVatRate,
        length_m: null,
        width_m: null,
        height_m: null,
        dimension_pricing_mode: null,
        dim_quantity: 1,
        is_internal: item.is_internal || isEquipment,
        material_id: null,
        ...getTransportMeta({
          description: item.designation,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price_ht,
          is_internal: item.is_internal,
        }),
      }
    })
    setItems(prev => replaceOrAppend(prev, newItems))
    setIsCatalogModalOpen(false)
    setCatalogSearch('')
  }

  // ── Transport ─────────────────────────────────────────────────────────────────
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
      unit_cost_ht: null,
      vat: defaultVatRate,
      length_m: null,
      width_m: null,
      height_m: null,
      dimension_pricing_mode: null,
      dim_quantity: 1,
      is_internal: true,
      material_id: null,
      transport_km: transportKm,
      transport_conso: transportConso,
      transport_prix_l: transportPrixL,
    }
    setItems(prev => replaceOrAppend(prev, [newItem]))
    setShowTransport(false)
  }

  // ── Équipement amorti ────────────────────────────────────────────────────────
  const [showEquipment, setShowEquipment] = useState(false)
  const [equipmentName, setEquipmentName] = useState('')
  const [equipmentPurchase, setEquipmentPurchase] = useState(0)
  const [equipmentUses, setEquipmentUses] = useState(100)
  const equipmentCostPerUse = equipmentUses > 0 ? Math.round((equipmentPurchase / equipmentUses) * 100) / 100 : 0

  // ─── Enregistrer dans le catalogue ────────────────────────────────────────
  const [saveCatalogItem, setSaveCatalogItem] = useState<LocalItem | null>(null)

  function openSaveCatalog(item: LocalItem) {
    setSaveCatalogItem(item)
  }

  function handleSavedToCatalog(item: LocalItem, result: SaveToCatalogResult) {
    if (result.kind === 'material') {
      updateItem(item.id, 'material_id', result.id)
    } else {
      updateItem(item.id, 'material_id', null)
    }
    setSaveCatalogItem(null)
  }

  function handleAddEquipment() {
    if (equipmentPurchase <= 0 || equipmentUses <= 0) return
    const equipmentLabel = equipmentName.trim() || 'Équipement amorti'
    const desc = `${equipmentLabel}\n\nAmortissement : ${equipmentPurchase} € / ${equipmentUses} usages`
    const newItem = {
      id: Date.now(),
      desc,
      qty: 1,
      unit: 'usage',
      pu: equipmentCostPerUse,
      unit_cost_ht: null,
      vat: defaultVatRate,
      length_m: null,
      width_m: null,
      height_m: null,
      dimension_pricing_mode: null,
      dim_quantity: 1,
      is_internal: true,
      material_id: null,
      transport_km: null,
      transport_conso: null,
      transport_prix_l: null,
    }
    setItems(prev => replaceOrAppend(prev, [newItem]))
    setShowEquipment(false)
  }

  // ── Autres modals ─────────────────────────────────────────────────────────────
  const [isQuoteModalOpen, setIsQuoteModalOpen] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendModalGroups, setSendModalGroups] = useState<AttachmentGroup[]>([])
  const [sendModalLoading, setSendModalLoading] = useState(false)
  const [sendModalError, setSendModalError] = useState<string | null>(null)
  const [emailRequiredOpen, setEmailRequiredOpen] = useState(false)
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function makeBlankItem(): LocalItem {
    return { id: Date.now() + Math.random(), desc: '', qty: 1, unit: '', pu: 0, unit_cost_ht: null, vat: defaultVatRate, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_internal: false, material_id: null, transport_km: null, transport_conso: null, transport_prix_l: null }
  }

  function makeSectionItem(title: string): LocalItem {
    return { id: Date.now() + Math.random(), desc: title, qty: 1, unit: INVOICE_SECTION_UNIT, pu: 0, unit_cost_ht: null, vat: defaultVatRate, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_internal: false, material_id: null, transport_km: null, transport_conso: null, transport_prix_l: null }
  }

  function addSection() {
    setItems(prev => [...prev, makeSectionItem(`Section ${prev.filter(isSectionItem).length + 1}`)])
  }

  function removeSection(id: number) {
    setItems(prev => {
      const start = prev.findIndex(i => i.id === id)
      if (start === -1) return prev
      let end = start + 1
      while (end < prev.length && !isSectionItem(prev[end])) end++
      return [...prev.slice(0, start), ...prev.slice(end)]
    })
  }

  function addItemAfter(id: number) {
    setItems(prev => {
      const idx = prev.findIndex(i => i.id === id)
      if (idx === -1) return [...prev, makeBlankItem()]
      return [...prev.slice(0, idx + 1), makeBlankItem(), ...prev.slice(idx + 1)]
    })
  }

  function updateItem(id: number, field: keyof LocalItem, value: string | number | boolean | null) {
    setItems(prev => prev.map(i => i.id === id ? { ...i, [field]: value } : i))
  }

  function handleTransportMetaChange(
    id: number,
    field: 'transport_km' | 'transport_conso' | 'transport_prix_l',
    value: number | null,
  ) {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const updated = { ...item, [field]: value }
      const km = updated.transport_km ?? 0
      const conso = updated.transport_conso ?? DEFAULT_CONSUMPTION_L_PER_100KM
      const prixL = updated.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L
      const { liters } = computeFuel({ km, consumption: conso, pricePerLiter: prixL })
      return {
        ...updated,
        desc: `Carburant - trajet ${km} km`,
        qty: liters,
        unit: 'L',
        pu: prixL,
        unit_cost_ht: null,
        is_internal: true,
      }
    }))
  }

  function handleEquipmentAmortizationChange(
    id: number,
    field: 'name' | 'purchasePrice' | 'lifetimeUses',
    value: string | number | null,
  ) {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const current = parseEquipmentAmortization(item.desc, item.pu)
      const name = field === 'name' ? String(value ?? '') : current.name
      const purchasePrice = field === 'purchasePrice' ? (typeof value === 'number' ? value : null) : current.purchasePrice
      const lifetimeUses = field === 'lifetimeUses' ? (typeof value === 'number' ? value : null) : current.lifetimeUses
      const unitPrice = computeEquipmentCostPerUse(purchasePrice, lifetimeUses, item.pu)

      return {
        ...item,
        desc: buildEquipmentDescription(name, purchasePrice, lifetimeUses),
        unit: 'usage',
        pu: unitPrice,
        unit_cost_ht: null,
        is_internal: true,
        transport_prix_l: null,
      }
    }))
  }

  function toggleItemExpand(id: number) {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handleDimChange(id: number, field: 'length_m' | 'width_m' | 'height_m', value: number | null) {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const mode = getItemDimensionMode(item)
      const nextLength = field === 'length_m' ? value : item.length_m
      const nextWidth = field === 'width_m' ? value : item.width_m
      const nextHeight = field === 'height_m' ? value : item.height_m
      const sourceMaterial = item.material_id ? materials.find(m => m.id === item.material_id) : null
      const pricing = sourceMaterial
        ? buildMaterialSelectionPricing({
            item: sourceMaterial,
            requestedLengthM: nextLength,
            requestedWidthM: nextWidth,
            requestedHeightM: nextHeight,
          })
        : null
      return {
        ...item,
        [field]: value,
        qty: pricing?.quantity != null ? pricing.quantity * (item.dim_quantity || 1) : computeDimensionQuantity(mode, nextLength, nextWidth, nextHeight, item.qty, item.dim_quantity),
        unit: pricing?.unit ?? getModeUnit(mode, item.unit),
        pu: pricing?.unitPrice ?? item.pu,
      }
    }))
  }

  function handleDimQuantityChange(id: number, value: number | null) {
    const qty = value != null && value > 0 ? value : 1
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item
      const mode = getItemDimensionMode(item)
      return {
        ...item,
        dim_quantity: qty,
        qty: computeDimensionQuantity(mode, item.length_m, item.width_m, item.height_m, item.qty, qty),
      }
    }))
  }

  function addItem() {
    setItems(prev => [...prev, makeBlankItem()])
  }

  // Ligne de coût interne : comptée dans la marge, absente du PDF client.
  function addInternalItem() {
    setItems(prev => [...prev, { ...makeBlankItem(), is_internal: true }])
  }

  function removeItem(id: number) {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function handleImportQuote(quote: QuoteWithItems) {
    const newItems: LocalItem[] = [
      ...quote.sections.flatMap(sec =>
        [
          makeSectionItem(sec.title || 'Section'),
          ...sec.items.map(item => ({
            id: Date.now() + Math.random(),
            desc: item.description ?? '',
            qty: item.quantity,
            unit: (item as any).unit ?? '',
            pu: item.unit_price,
            unit_cost_ht: item.unit_cost_ht ?? null,
            vat: item.vat_rate ?? defaultVatRate,
            length_m: item.length_m ?? null,
            width_m: item.width_m ?? null,
            height_m: item.height_m ?? null,
            dimension_pricing_mode: inferDimensionMode(item),
            dim_quantity: (item as any).dim_quantity ?? 1,
            is_internal: (item as any).is_internal ?? false,
            material_id: (item as any).material_id ?? null,
            ...getTransportMeta({
              description: item.description,
              quantity: item.quantity,
              unit: (item as any).unit,
              unit_price: item.unit_price,
              is_internal: (item as any).is_internal,
            }),
          })),
        ],
      ),
      ...quote.unsectionedItems.map(item => ({
        id: Date.now() + Math.random(),
        desc: item.description ?? '',
        qty: item.quantity,
        unit: (item as any).unit ?? '',
        pu: item.unit_price,
        unit_cost_ht: item.unit_cost_ht ?? null,
        vat: item.vat_rate ?? defaultVatRate,
        length_m: item.length_m ?? null,
        width_m: item.width_m ?? null,
        height_m: item.height_m ?? null,
        dimension_pricing_mode: inferDimensionMode(item),
        dim_quantity: (item as any).dim_quantity ?? 1,
        is_internal: (item as any).is_internal ?? false,
        material_id: (item as any).material_id ?? null,
        ...getTransportMeta({
          description: item.description,
          quantity: item.quantity,
          unit: (item as any).unit,
          unit_price: item.unit_price,
          is_internal: (item as any).is_internal,
        }),
      })),
    ]
    if (quote.client?.id) setClientId(quote.client.id)
    if (quote.title) setTitle(quote.title)
    setItems(newItems.length > 0 ? newItems : [makeBlankItem()])
    setImportedQuoteId(quote.id)
    setIsQuoteModalOpen(false)
  }

  function getMeta() {
    return { clientId: clientId || null, issueDate, dueDate, title: title || 'Facture', quoteId: importedQuoteId, chantierId: chantierId || null, aidLabel: aidLabel || null, aidAmount, isReverseCharge }
  }

  // Préremplissage du client depuis le chantier (création uniquement)
  useEffect(() => {
    if (existingInvoice) return
    if (!chantierId) return
    const ch = linkableChantiers.find(c => c.id === chantierId)
    if (!ch) return
    if (!clientId && ch.client_id) {
      setClientId(ch.client_id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chantierId])

  function getItemsPayload() {
    return items.map(i => ({
      description: i.desc,
      quantity: Number(i.qty),
      unit: i.unit,
      unit_price: Number(i.pu),
      unit_cost_ht: i.unit_cost_ht,
      vat_rate: Number(i.vat),
      length_m: i.length_m,
      width_m: i.width_m,
      height_m: i.height_m,
      dim_quantity: i.dim_quantity,
      is_internal: i.is_internal,
      material_id: i.material_id ?? null,
    }))
  }

  async function ensureInvoiceId(): Promise<string | null> {
    if (invoiceId) return invoiceId
    const res = await createInvoice({ clientId: clientId || null, title: title || 'Facture', quoteId: importedQuoteId, chantierId: chantierId || null })
    if (res.error || !res.invoiceId) { setError(res.error ?? 'Erreur création facture'); return null }
    setInvoiceId(res.invoiceId)
    return res.invoiceId
  }

  function handlePreview() {
    setIsSaving(true)
    setError(null)
    startTransition(async () => {
      const id = await ensureInvoiceId()
      if (!id) { setIsSaving(false); return }
      const saveRes = await saveInvoiceItems(id, getItemsPayload(), getMeta())
      setIsSaving(false)
      if (saveRes.error) { setError(saveRes.error); return }
      router.push(`/api/pdf/invoice/${id}`)
    })
  }

  function handleSaveDraft() {
    setIsSaving(true)
    setError(null)
    startTransition(async () => {
      const id = await ensureInvoiceId()
      if (!id) { setIsSaving(false); return }
      const saveRes = await saveInvoiceItems(id, getItemsPayload(), getMeta())
      setIsSaving(false)
      if (saveRes.error) { setError(saveRes.error); return }
    })
  }

  function getSelectedClientForSend() {
    return clients.find(c => c.id === clientId) ?? (existingInvoice?.client?.id === clientId ? existingInvoice.client : null)
  }

  function prepareInvoiceSend(skipEmailCheck = false) {
    if (!clientId) { setError('Sélectionnez un client avant d\'envoyer.'); return }
    const selectedClient = getSelectedClientForSend()
    if (!selectedClient) {
      setError('Client introuvable. Sélectionnez à nouveau le client.')
      return
    }
    if (!skipEmailCheck && !selectedClient.email?.trim()) {
      setError(null)
      setEmailRequiredOpen(true)
      return
    }
    setIsSending(true)
    setError(null)
    startTransition(async () => {
      const id = await ensureInvoiceId()
      if (!id) { setIsSending(false); return }
      const saveRes = await saveInvoiceItems(id, getItemsPayload(), getMeta())
      if (saveRes.error) { setError(saveRes.error); setIsSending(false); return }
      // Ouvrir la modale d'envoi avec sélection optionnelle de contrats du client
      setPendingInvoiceId(id)
      setSendModalLoading(true)
      setSendModalError(null)
      setSendModalOpen(true)
      try {
        const contracts = await fetchClientContractsForAttachment(clientId)
        setSendModalGroups([{ key: 'contracts', label: 'Contrats du client', items: contracts }])
      } catch (err) {
        setSendModalError(err instanceof Error ? err.message : 'Erreur de chargement des contrats.')
      } finally {
        setSendModalLoading(false)
      }
      setIsSending(false)
    })
  }

  function handleSend() {
    prepareInvoiceSend(false)
  }

  async function handleClientEmailSaved(email: string) {
    setClients(prev => prev.map(client => client.id === clientId ? { ...client, email } : client))
    setEmailRequiredOpen(false)
    prepareInvoiceSend(true)
  }

  function confirmInvoiceSend(selected: Record<string, string[]>) {
    if (!pendingInvoiceId) return
    setIsSending(true)
    setSendModalError(null)
    startTransition(async () => {
      const sendRes = await sendInvoice(pendingInvoiceId, { attachContractIds: selected.contracts ?? [] })
      if (sendRes.error) { setSendModalError(sendRes.error); setIsSending(false); return }
      setSendModalOpen(false)
      setPendingInvoiceId(null)
      setIsSending(false)
      router.push(returnTo)
    })
  }

  // ── Totaux ───────────────────────────────────────────────────────────────────
  const { clientItems, totalHt, totalTva, totalTtc, totalInternalHt, margeHt, margePct, hasInternal, vatByRate } = computeInvoiceTotals(items)
  const scheduleTotalAmount = schedule.reduce((sum, s) => sum + scheduleLineAmount(s), 0)
  const scheduleRemaining = totalTtc - scheduleTotalAmount

  const isEditing = !!existingInvoice

  return {
    initialClients,
    acceptedQuotes,
    existingInvoice,
    materials,
    laborRates,
    prestationTypes,
    catalogContext,
    vatConfig,
    linkableChantiers,
    defaultChantierId,
    rawReturnTo,
    router,
    startTransition,
    defaultVatRate,
    returnTo,
    today,
    nextMonth,
    clients,
    setClients,
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
    invoiceId,
    setInvoiceId,
    title,
    setTitle,
    clientId,
    setClientId,
    issueDate,
    setIssueDate,
    dueDate,
    setDueDate,
    importedQuoteId,
    setImportedQuoteId,
    chantierId,
    setChantierId,
    aidLabel,
    setAidLabel,
    aidAmount,
    setAidAmount,
    showAid,
    setShowAid,
    isReverseCharge,
    setIsReverseCharge,
    aidMode,
    setAidMode,
    existingSchedule,
    schedule,
    setSchedule,
    showSchedule,
    setShowSchedule,
    scheduleSaving,
    setScheduleSaving,
    scheduleError,
    setScheduleError,
    addScheduleLine,
    removeScheduleLine,
    updateScheduleLine,
    scheduleLineAmount,
    setScheduleAmountType,
    handleSaveSchedule,
    items,
    setItems,
    expandedItems,
    setExpandedItems,
    isCatalogModalOpen,
    setIsCatalogModalOpen,
    catalogSearch,
    setCatalogSearch,
    hasCatalog,
    filteredMaterials,
    filteredLabor,
    filteredPrestations,
    replaceOrAppend,
    addFromCatalog,
    addMaterialFromCatalog,
    addPrestationToItems,
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
    saveCatalogItem,
    setSaveCatalogItem,
    openSaveCatalog,
    handleSavedToCatalog,
    handleAddEquipment,
    isQuoteModalOpen,
    setIsQuoteModalOpen,
    isSaving,
    setIsSaving,
    isSending,
    setIsSending,
    sendModalOpen,
    setSendModalOpen,
    sendModalGroups,
    setSendModalGroups,
    sendModalLoading,
    setSendModalLoading,
    sendModalError,
    setSendModalError,
    emailRequiredOpen,
    setEmailRequiredOpen,
    pendingInvoiceId,
    setPendingInvoiceId,
    error,
    setError,
    makeBlankItem,
    makeSectionItem,
    addSection,
    removeSection,
    addItemAfter,
    updateItem,
    handleTransportMetaChange,
    handleEquipmentAmortizationChange,
    toggleItemExpand,
    handleDimChange,
    handleDimQuantityChange,
    addItem,
    addInternalItem,
    removeItem,
    handleImportQuote,
    getMeta,
    getItemsPayload,
    ensureInvoiceId,
    handlePreview,
    handleSaveDraft,
    getSelectedClientForSend,
    prepareInvoiceSend,
    handleSend,
    handleClientEmailSaved,
    confirmInvoiceSend,
    clientItems,
    totalHt,
    totalTva,
    totalTtc,
    scheduleTotalAmount,
    scheduleRemaining,
    vatByRate,
    totalInternalHt,
    margeHt,
    margePct,
    hasInternal,
    isEditing,
  }
}

export type InvoiceEditor = ReturnType<typeof useInvoiceEditor>
