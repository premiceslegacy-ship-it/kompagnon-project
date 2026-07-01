'use client'

import React, { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Client } from '@/lib/data/queries/clients'
import type { QuoteWithItems } from '@/lib/data/queries/quotes'
import type { InvoiceWithItems } from '@/lib/data/queries/invoices'
import type { CatalogMaterial, CatalogLaborRate, PrestationType } from '@/lib/data/queries/catalog'
import { LEGAL_VAT_RATES, type VatConfig } from '@/lib/utils'
import {
  buildMaterialSelectionPricing,
  computeLinearQuantity,
  computeSurfaceQuantity,
  computeVolumeQuantity,
  displayUnitToMeters,
  getDimensionFieldDefinition,
  metersToDisplayUnit,
  type DimensionPricingMode,
} from '@/lib/catalog-pricing'
import { createInvoice, saveInvoiceItems, sendInvoice, savePaymentSchedule } from '@/lib/data/mutations/invoices'
import SaveToCatalogModal, { type SaveToCatalogSource, type SaveToCatalogResult } from '@/components/catalog/SaveToCatalogModal'
import { fetchClientContractsForAttachment } from '@/lib/data/mutations/contracts'
import AttachmentPickerModal, { type AttachmentGroup } from '@/components/AttachmentPickerModal'
import ClientEmailRequiredModal from '@/components/ClientEmailRequiredModal'
import { createClientInline } from '@/lib/data/mutations/clients'
import { getClientDisplayName } from '@/lib/client'
import { UnitSelect } from '@/components/ui/UnitSelect'
import { NumericInput } from '@/components/ui/NumericInput'
import { ActionButton } from '@/components/ui/ActionButton'
import {
  ArrowLeft, Eye, Send, Plus, Trash2, FileText, Search, X, Loader2, Save, EyeOff, Truck, ChevronDown, ChevronUp, Ruler, Package, CalendarClock, BookmarkPlus, LayoutGrid,
} from 'lucide-react'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { getCatalogDocumentVatRate, getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { todayParis, dateParis } from '@/lib/utils'
import { computeFuel, DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'

type LocalItem = {
  id: number
  desc: string
  qty: number
  unit: string
  pu: number
  unit_cost_ht: number | null
  vat: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dimension_pricing_mode: DimensionPricingMode | null
  dim_quantity: number
  is_internal: boolean
  material_id: string | null
  transport_km: number | null
  transport_conso: number | null
  transport_prix_l: number | null
}

function getSafeReturnTo(value: string | null, fallback: string) {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

function inferDimensionMode(item: {
  unit?: string | null
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
}): DimensionPricingMode | null {
  if (item.height_m != null || item.unit === 'm³') return 'volume'
  if (item.width_m != null && item.length_m != null) return 'area'
  if (item.length_m != null && item.unit === 'ml') return 'linear'
  return null
}

function getItemDimensionMode(item: Pick<LocalItem, 'dimension_pricing_mode' | 'length_m' | 'width_m' | 'height_m' | 'unit'>): DimensionPricingMode {
  if (item.dimension_pricing_mode && item.dimension_pricing_mode !== 'none') {
    return item.dimension_pricing_mode
  }
  return inferDimensionMode(item) ?? 'none'
}

function getModeUnit(mode: DimensionPricingMode, fallbackUnit: string): string {
  switch (mode) {
    case 'linear':
      return 'ml'
    case 'area':
      return 'm²'
    case 'volume':
      return 'm³'
    default:
      return fallbackUnit
  }
}

function getTransportMeta(item: {
  description?: string | null
  quantity?: number | null
  unit?: string | null
  unit_price?: number | null
  is_internal?: boolean | null
}) {
  const label = (item.description ?? '').toLowerCase()
  const isTransportLine = item.is_internal === true && item.unit === 'L' && (label.includes('carburant') || label.includes('transport') || label.includes('trajet'))
  if (!isTransportLine) return { transport_km: null, transport_conso: null, transport_prix_l: null }
  const kmMatch = label.match(/(\d+(?:[,.]\d+)?)\s*km/)
  const kmFromLabel = kmMatch ? Number(kmMatch[1].replace(',', '.')) : null
  return {
    transport_km: kmFromLabel ?? Math.round(((item.quantity ?? 0) / DEFAULT_CONSUMPTION_L_PER_100KM) * 100),
    transport_conso: DEFAULT_CONSUMPTION_L_PER_100KM,
    transport_prix_l: item.unit_price ?? DEFAULT_FUEL_PRICE_EUR_PER_L,
  }
}

function isEquipmentLine(item: Pick<LocalItem, 'is_internal' | 'unit' | 'transport_prix_l'>) {
  return item.is_internal && item.unit === 'usage' && item.transport_prix_l == null
}

function getInternalUnitCost(item: Pick<LocalItem, 'unit_cost_ht' | 'is_internal' | 'pu'>) {
  if (item.unit_cost_ht != null) return Number(item.unit_cost_ht) || 0
  return item.is_internal ? (Number(item.pu) || 0) : 0
}

function getInternalCostTotal(item: Pick<LocalItem, 'unit_cost_ht' | 'is_internal' | 'pu' | 'qty'>) {
  return (Number(item.qty) || 0) * getInternalUnitCost(item)
}

function parseEquipmentAmortization(description: string, unitPrice: number) {
  const match = description.match(/Amortissement\s*:\s*([\d.,]*)\s*€\s*\/\s*([\d.,]*)\s*usages?/i)
  const name = (description.split(/\n/)[0] ?? '').trim() || 'Équipement amorti'
  const rawPurchasePrice = match?.[1]?.trim() ?? ''
  const rawLifetimeUses = match?.[2]?.trim() ?? ''
  const purchasePrice = rawPurchasePrice ? Number(rawPurchasePrice.replace(',', '.')) : null
  const lifetimeUses = rawLifetimeUses ? Number(rawLifetimeUses.replace(',', '.')) : null

  return {
    name,
    purchasePrice: purchasePrice != null && Number.isFinite(purchasePrice) ? purchasePrice : null,
    lifetimeUses: lifetimeUses != null && Number.isFinite(lifetimeUses) ? lifetimeUses : null,
    costPerUse: unitPrice,
  }
}

function buildEquipmentDescription(name: string, purchasePrice: number | null, lifetimeUses: number | null) {
  const label = name.trim() || 'Équipement amorti'
  if (purchasePrice != null || lifetimeUses != null) {
    return `${label}\n\nAmortissement : ${purchasePrice ?? ''} € / ${lifetimeUses ?? ''} usages`
  }
  return label
}

function computeEquipmentCostPerUse(purchasePrice: number | null, lifetimeUses: number | null, fallback: number) {
  if (purchasePrice != null && purchasePrice > 0 && lifetimeUses != null && lifetimeUses > 0) {
    return Math.round((purchasePrice / lifetimeUses) * 100) / 100
  }
  return fallback
}

function computeDimensionQuantity(
  mode: DimensionPricingMode,
  lengthM: number | null,
  widthM: number | null,
  heightM: number | null,
  fallbackQuantity: number,
  dimQuantity = 1,
): number {
  const mult = dimQuantity > 0 ? dimQuantity : 1
  switch (mode) {
    case 'linear':
      return parseFloat((computeLinearQuantity(lengthM ?? 0) * mult).toFixed(3))
    case 'area':
      return parseFloat((computeSurfaceQuantity(lengthM ?? 0, widthM ?? 0) * mult).toFixed(3))
    case 'volume':
      return parseFloat((computeVolumeQuantity(lengthM ?? 0, widthM ?? 0, heightM ?? 0) * mult).toFixed(3))
    default:
      return fallbackQuantity
  }
}

function clientDisplayName(c: Client): string {
  return getClientDisplayName(c)
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

const INVOICE_SECTION_UNIT = '__section__'

function isSectionItem(item: Pick<LocalItem, 'unit'>) {
  return item.unit === INVOICE_SECTION_UNIT
}

type LinkableChantier = { id: string; title: string; client_id: string | null; quote_id: string | null }

type Props = {
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

export default function InvoiceEditorClient({
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
}: Props) {
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
  type ScheduleAmountType = 'amount' | 'percentage'
  type LocalScheduleItem = {
    id: string
    label: string
    due_date: string
    amount: number
    amount_type: ScheduleAmountType
    percentage: number | null
    paid_payment_id: string | null
  }
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
    if (item.amount_type === 'percentage') {
      return Math.round(totalTtc * ((Number(item.percentage) || 0) / 100) * 100) / 100
    }
    return Number(item.amount) || 0
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
  const clientItems = items.filter(i => !i.is_internal)
  const totalHt = clientItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu), 0)
  const totalTva = clientItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu) * (Number(i.vat) / 100), 0)
  const totalTtc = totalHt + totalTva
  const scheduleTotalAmount = schedule.reduce((sum, s) => sum + scheduleLineAmount(s), 0)
  const scheduleRemaining = totalTtc - scheduleTotalAmount
  const totalInternalHt = items.reduce((acc, i) => acc + getInternalCostTotal(i), 0)
  const margeHt = totalHt - totalInternalHt
  const margePct = totalHt > 0 ? (margeHt / totalHt) * 100 : 0
  const hasInternal = items.some(i => i.unit_cost_ht != null || i.is_internal)

  const isEditing = !!existingInvoice

  return (
    <main className="page-container pb-28 space-y-6 md:space-y-8">

      {/* ── Modal Catalogue ── */}
      {isCatalogModalOpen && (
        <div className="modal-overlay">
          <div className="modal-panel flex flex-col">
            <div className="flex items-center justify-between p-6 pb-4 border-b border-[var(--elevation-border)]">
              <h3 className="text-lg font-bold text-primary">Ajouter depuis le catalogue</h3>
              <button onClick={() => { setIsCatalogModalOpen(false); setCatalogSearch('') }} className="text-secondary hover:text-primary transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-4 border-b border-[var(--elevation-border)]">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary pointer-events-none" />
                <input
                  type="text"
                  value={catalogSearch}
                  onChange={e => setCatalogSearch(e.target.value)}
                  placeholder={`Rechercher ${catalogContext.labelSet.material.singular.toLowerCase()}, ${catalogContext.labelSet.laborRate.singular.toLowerCase()}, ${catalogContext.labelSet.bundleTemplate.singular.toLowerCase()}...`}
                  autoFocus
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {filteredMaterials.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 px-1">{catalogContext.labelSet.material.plural}</p>
                  <div className="space-y-1">
                    {filteredMaterials.map(m => (
                      <button key={m.id} onClick={() => addMaterialFromCatalog(m)}
                        className="w-full text-left p-3 rounded-xl hover:bg-accent/5 hover:border-accent border border-transparent transition-all flex items-center justify-between">
                        <div>
                          <p className="font-medium text-primary text-sm">{m.name}</p>
                          {m.category && <p className="text-xs text-secondary">{m.category}{m.unit ? ` · ${m.unit}` : ''}</p>}
                        </div>
                        <span className="text-sm font-bold text-primary tabular-nums ml-4 shrink-0">{m.sale_price != null ? fmt(m.sale_price) : '-'}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {filteredLabor.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 px-1">{catalogContext.labelSet.laborRate.plural}</p>
                  <div className="space-y-1">
                    {filteredLabor.map(l => (
                      <button key={l.id} onClick={() => addFromCatalog(l.designation, l.unit, getInternalResourceUnitCost(l), defaultVatRate)}
                        className="w-full text-left p-3 rounded-xl hover:bg-accent/5 hover:border-accent border border-transparent transition-all flex items-center justify-between">
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
                  <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 px-1">{catalogContext.labelSet.bundleTemplate.plural}</p>
                  <div className="space-y-1">
                    {filteredPrestations.map(p => (
                      <button key={p.id} onClick={() => addPrestationToItems(p)}
                        className="w-full text-left p-3 rounded-xl hover:bg-accent/5 hover:border-accent border border-transparent transition-all flex items-center justify-between">
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

      {/* ── Modal Transport ── */}
      {showTransport && (
        <div className="modal-overlay z-[150]">
          <div className="modal-panel space-y-5 sm:max-w-sm">
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
                <NumericInput min={1} value={transportKm} onChange={v => setTransportKm(v ?? 1)}
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Consommation (L/100 km)</label>
                  <NumericInput min={1} decimals={2} value={transportConso} onChange={v => setTransportConso(v ?? 1)}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Prix carburant (€/L)</label>
                  <NumericInput min={0} decimals={3} value={transportPrixL} onChange={v => setTransportPrixL(v ?? 0)}
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
                  Ligne interne - coût de revient, non visible sur la facture client
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowTransport(false)}
                className="px-5 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold">Annuler</button>
              <ActionButton type="button" onClick={handleAddTransport}
                className="px-5 py-2.5 rounded-full bg-amber-500 text-white font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-amber-500/20">
                <Plus className="w-4 h-4" />Ajouter la ligne
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Équipement amorti ── */}
      {showEquipment && (
        <div className="modal-overlay z-[150]">
          <div className="modal-panel space-y-5 sm:max-w-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-purple-500/10 flex items-center justify-center">
                  <Package className="w-5 h-5 text-purple-500" />
                </div>
                <h3 className="text-lg font-bold text-primary">Équipement amorti</h3>
              </div>
              <button onClick={() => setShowEquipment(false)} className="text-secondary hover:text-primary transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-secondary">Nom de l&apos;équipement</label>
                <input type="text" value={equipmentName} onChange={e => setEquipmentName(e.target.value)} placeholder="ex: Aspirateur industriel"
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Prix d&apos;achat (€)</label>
                  <NumericInput min={0} decimals={2} value={equipmentPurchase || null} onChange={v => setEquipmentPurchase(v ?? 0)}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Usages sur la vie</label>
                  <NumericInput min={1} decimals={0} value={equipmentUses} onChange={v => setEquipmentUses(v ?? 1)}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 tabular-nums" />
                </div>
              </div>
              {equipmentPurchase > 0 && (
                <div className="p-4 rounded-xl bg-purple-50 dark:bg-purple-500/5 border border-purple-200 dark:border-purple-500/20 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-secondary">Coût par usage</span>
                    <span className="font-bold text-purple-600 tabular-nums">{equipmentCostPerUse.toFixed(2)} €</span>
                  </div>
                  <p className="text-xs text-purple-600 flex items-center gap-1 pt-1 border-t border-purple-200 dark:border-purple-500/20 mt-2">
                    <EyeOff className="w-3 h-3 shrink-0" />
                    Ligne interne - coût de revient, non visible sur la facture client
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowEquipment(false)}
                className="px-5 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold">Annuler</button>
              <ActionButton type="button" onClick={handleAddEquipment} disabled={equipmentPurchase <= 0 || equipmentUses <= 0}
                className="px-5 py-2.5 rounded-full bg-purple-500 text-white font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-purple-500/20 disabled:opacity-40 disabled:hover:scale-100">
                <Plus className="w-4 h-4" />Ajouter la ligne
              </ActionButton>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal Devis ── */}
      {isQuoteModalOpen && (
        <div className="modal-overlay">
          <div className="modal-panel flex flex-col">
            <button onClick={() => setIsQuoteModalOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary transition-colors"><X className="w-6 h-6" /></button>
            <h2 className="text-2xl font-bold text-primary mb-6">Importer un devis accepté</h2>
            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {acceptedQuotes.length === 0 ? (
                <p className="text-secondary text-sm text-center py-8">Aucun devis accepté disponible.</p>
              ) : acceptedQuotes.map(q => {
                const cn = q.client?.company_name ?? q.client?.email ?? '/'
                const itemCount = q.sections.reduce((a, s) => a + s.items.length, 0) + q.unsectionedItems.length
                return (
                  <button key={q.id} onClick={() => handleImportQuote(q)}
                    className="w-full text-left p-4 rounded-xl border border-[var(--elevation-border)] hover:border-accent hover:bg-accent/5 transition-all flex items-center justify-between gap-4">
                    <div>
                      <p className="font-bold text-primary">{q.title ?? 'Sans titre'}</p>
                      <p className="text-sm text-secondary">{cn} · {q.number ?? '/'}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold text-primary tabular-nums">{q.total_ht != null ? fmt(q.total_ht) : '/'} HT</p>
                      <p className="text-xs text-secondary">{itemCount} ligne{itemCount !== 1 ? 's' : ''}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Topbar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.replace(returnTo)} className="w-10 h-10 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] flex items-center justify-center text-secondary hover:text-primary transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-primary">{isEditing ? 'Modifier la facture' : 'Nouvelle facture'}</h1>
            {existingInvoice?.number && <p className="text-sm text-secondary">{existingInvoice.number}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ActionButton onClick={handlePreview} loading={isSaving} disabled={isSending}
            className="px-4 py-2.5 rounded-full text-secondary hover:text-primary hover:bg-base/50 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50 whitespace-nowrap">
            <Eye className="w-4 h-4" />
            <span className="hidden sm:inline">Aperçu PDF</span>
          </ActionButton>
          <ActionButton onClick={handleSaveDraft} disabled={isSaving || isSending}
            className="px-4 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold flex items-center gap-2 disabled:opacity-50 whitespace-nowrap">
            <Save className="w-4 h-4" /><span className="hidden sm:inline">Brouillon</span>
          </ActionButton>
          <ActionButton onClick={handleSend} loading={isSending} disabled={isSaving}
            className="px-4 sm:px-6 py-2.5 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-50 disabled:scale-100 whitespace-nowrap">
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Valider &</span> Envoyer
          </ActionButton>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-600 text-sm font-medium">{error}</div>
      )}

      {/* ── Paramètres ── */}
      <div className="rounded-3xl card p-5 sm:p-8 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
          <div className="space-y-2 lg:col-span-2">
            <label className="text-sm font-semibold text-secondary">Intitulé de la facture</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Ex : Travaux de toiture - Bâtiment A"
              className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-secondary">Client</label>
              <button type="button"
                      onClick={() => { setNewClientOpen(true); setNewClientError(null); setNewClientForm({ company_name: '', first_name: '', last_name: '', contact_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' }); setNewClientType('company') }}
                className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-semibold transition-colors">
                <Plus className="w-3 h-3" />Nouveau client
              </button>
            </div>
            <select value={clientId} onChange={e => setClientId(e.target.value)}
              className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none">
              <option value="">Sans client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{clientDisplayName(c)}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Date de facturation</label>
            <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
              className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Échéance</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)}
              className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
          </div>
        </div>

        {/* Import depuis devis */}
        <div className="p-4 rounded-xl bg-accent/10 border border-accent/20 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-accent shrink-0" />
            <div>
              <span className="font-semibold text-primary">Facturer depuis un devis existant ?</span>
              {importedQuoteId && <span className="ml-3 text-xs text-accent font-bold">Devis importé ✓</span>}
            </div>
          </div>
          {acceptedQuotes.length > 0 ? (
            <button onClick={() => setIsQuoteModalOpen(true)}
              className="px-4 py-2 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-sm font-bold text-primary hover:bg-base transition-colors whitespace-nowrap">
              Sélectionner un devis
            </button>
          ) : (
            <span className="text-sm text-secondary">Aucun devis accepté</span>
          )}
        </div>

        {/* Lien chantier (optionnel) */}
        {linkableChantiers.length > 0 && (
          <div className="space-y-2">
            <label className="text-sm font-semibold text-secondary">Chantier rattaché (optionnel)</label>
            <select
              value={chantierId ?? ''}
              onChange={e => setChantierId(e.target.value || null)}
              className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none"
            >
              <option value="">Aucun chantier</option>
              {linkableChantiers
                .map(c => (
                  <option key={c.id} value={c.id}>{c.title}</option>
                ))}
            </select>
            <p className="text-xs text-secondary">Cette facture apparaîtra dans la rentabilité du chantier sélectionné.</p>
          </div>
        )}
      </div>

      <div className="flex flex-col md:flex-row gap-6 md:gap-8 items-start">
        {/* ── Lignes ── */}
        <div className="rounded-3xl card p-4 sm:p-8 flex-1 w-full">
          <div className="overflow-x-auto">
          <div className="space-y-1">
            {/* Header desktop */}
            {items.length > 0 && (
              <div className="hidden sm:grid sm:grid-cols-[minmax(220px,1fr)_72px_80px_100px_60px_88px_112px] gap-x-2 pb-1 px-3 border-b border-[var(--elevation-border)]">
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Désignation</span>
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider text-right">Qté</span>
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider text-center">Unité</span>
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider text-right">PU HT</span>
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider text-right">TVA</span>
                <span className="text-xs font-semibold text-secondary uppercase tracking-wider text-right">Total HT</span>
                <span />
              </div>
            )}
            {items.map(item => {
              if (isSectionItem(item)) {
                return (
                  <React.Fragment key={item.id}>
	                    <div className="mt-4 first:mt-0 rounded-xl border border-[var(--elevation-border)] bg-base/40 px-3 py-3 flex items-center gap-3">
                      <input
                        type="text"
                        value={item.desc}
                        onChange={e => updateItem(item.id, 'desc', e.target.value)}
                        className="flex-1 bg-transparent border-none focus:outline-none text-primary font-bold text-sm uppercase tracking-wide"
                      />
	                      <button type="button" onClick={() => addItemAfter(item.id)}
	                        className="p-1.5 rounded-full text-secondary hover:text-accent hover:bg-accent/10 transition-all shrink-0 relative z-10"
                        title="Ajouter une ligne dans cette section">
                        <Plus className="w-4 h-4" />
                      </button>
	                      <button type="button" onClick={() => removeSection(item.id)}
	                        className="p-1.5 text-secondary hover:text-red-500 rounded-full hover:bg-red-500/10 transition-all shrink-0 relative z-10"
                        title="Supprimer cette section et ses lignes">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </React.Fragment>
                )
              }
              const dimensionMode = getItemDimensionMode(item)
              const isDimensioned = dimensionMode !== 'none'
              const isExpanded = expandedItems.has(item.id)
              const canExpand = isDimensioned || !item.material_id
              const dimensionUnit = getModeUnit(dimensionMode, item.unit)
              const sourceMaterial = item.material_id ? materials.find(m => m.id === item.material_id) : null
	              const lengthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'length', dimensionMode)
	              const widthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'width', dimensionMode)
	              const heightMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'height', dimensionMode)
	              const isEquipment = isEquipmentLine(item)
              const equipmentMeta = isEquipment ? parseEquipmentAmortization(item.desc, item.pu) : null
              const internalUnitCost = getInternalUnitCost(item)
              return (
                <React.Fragment key={item.id}>
	                  <div className={`rounded-xl border transition-all ${isEquipment ? 'border-l-2 border-purple-400/60 bg-purple-500/5' : item.is_internal ? 'border-l-2 border-amber-400/50 bg-amber-500/5' : 'border-[var(--elevation-border)] bg-base/20 hover:bg-base/40'}`}>

                    {/* ── Badge + désignation ── */}
                    <div className="flex items-start gap-2 px-3 pt-3 pb-1">
                      {(item.is_internal || isEquipment) && (
                        <span className={`mt-1 flex-shrink-0 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 leading-none ${isEquipment ? 'text-purple-700 dark:text-purple-300 bg-purple-500/15 border-purple-400/40' : 'text-amber-700 bg-amber-500/15 border-amber-400/40'}`}>
                          {isEquipment && <Package className="w-2.5 h-2.5" />}
                          {isEquipment ? 'Équip.' : 'Coût'}
                        </span>
                      )}
                      <textarea
                        value={equipmentMeta ? equipmentMeta.name : item.desc}
                        onChange={e => equipmentMeta ? handleEquipmentAmortizationChange(item.id, 'name', e.target.value) : updateItem(item.id, 'desc', e.target.value)}
                        placeholder={item.is_internal ? "Coût interne (non visible client)..." : 'Description...'}
                        rows={equipmentMeta ? Math.min(3, Math.max(1, equipmentMeta.name.split('\n').length)) : Math.min(6, Math.max(2, item.desc.split('\n').length))}
                        className={`flex-1 min-h-16 p-2 border rounded-lg outline-none text-primary text-sm leading-6 transition-colors resize-none ${equipmentMeta ? 'bg-base/40 border-purple-300/50 dark:border-purple-500/30 focus:border-purple-400 focus:bg-base/60 font-semibold' : 'bg-base/40 border-[var(--elevation-border)] focus:border-accent focus:bg-base/60'}`}
                      />
                      {/* Actions mobile */}
                      <div className="flex flex-col gap-1 sm:hidden pt-0.5">
	                        <button type="button" onClick={() => { if (!isEquipment) updateItem(item.id, 'is_internal', !item.is_internal) }}
                          disabled={isEquipment}
                          title={isEquipment ? 'Équipement toujours interne' : undefined}
                          className={`p-1.5 rounded-full transition-all ${isEquipment ? 'text-purple-600 bg-purple-500/10 cursor-not-allowed' : item.is_internal ? 'text-amber-500 bg-amber-500/10' : 'text-emerald-600 bg-emerald-500/10'}`}>
                          {item.is_internal ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                        {!item.material_id && !isEquipment && item.transport_prix_l === null && (
	                          <button type="button" onClick={() => openSaveCatalog(item)} title="Enregistrer dans le catalogue"
                            className="p-1.5 rounded-full text-secondary hover:text-accent hover:bg-accent/10 transition-all">
                            <BookmarkPlus className="w-4 h-4" />
                          </button>
                        )}
                        {canExpand && (
	                          <button type="button" onClick={() => toggleItemExpand(item.id)}
                            className={`p-1.5 rounded-full transition-all ${isExpanded ? 'text-accent bg-accent/10' : 'text-secondary hover:text-accent hover:bg-accent/10'}`}>
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </button>
                        )}
	                        <button type="button" onClick={() => removeItem(item.id)}
                          className="p-1.5 text-secondary hover:text-red-500 rounded-full hover:bg-red-500/10 transition-all">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* ── Chiffres ── */}
                    <div className="px-3 pb-2">
                      {/* Desktop */}
	                      <div className="hidden sm:grid sm:grid-cols-[minmax(220px,1fr)_72px_80px_100px_60px_88px_112px] gap-x-2 items-center">
                        <div />
                        {isEquipment ? (
                          <p className="p-2 text-right text-sm font-bold tabular-nums text-purple-700 dark:text-purple-300 bg-purple-500/8 border border-purple-400/30 rounded-lg">{item.qty}</p>
                        ) : isDimensioned ? (
                          <p className="p-2 text-right text-sm font-bold tabular-nums text-accent">{item.qty}</p>
                        ) : (
                          <NumericInput value={item.qty} min={0} onChange={v => updateItem(item.id, 'qty', v ?? 0)}
                            className="w-full p-2 bg-base/40 border border-[var(--elevation-border)] rounded-lg focus:border-accent focus:bg-base/60 outline-none text-primary tabular-nums text-right text-sm transition-colors" />
                        )}
                        {isEquipment ? (
                          <div className="h-9 flex items-center px-2 bg-purple-500/8 border border-purple-400/30 rounded-lg">
                            <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">usage</span>
                          </div>
                        ) : (
                          <UnitSelect value={item.unit} onChange={v => updateItem(item.id, 'unit', v)}
                            allowedUnits={catalogContext.unitSet} compact className="w-full" />
                        )}
                        <div className="relative">
                          {isEquipment ? (
                            <div className="h-9 flex items-center px-2 bg-purple-500/8 border border-purple-400/30 rounded-lg">
                              <span className="font-bold text-purple-700 dark:text-purple-300 tabular-nums text-sm w-full text-right">{fmt(Number(item.pu))}</span>
                            </div>
                          ) : (
                            <>
                              <NumericInput value={item.pu} min={0} decimals={2} onChange={v => updateItem(item.id, 'pu', v ?? 0)}
                                className="w-full p-2 pr-5 bg-base/40 border border-[var(--elevation-border)] rounded-lg outline-none text-sm tabular-nums text-right transition-colors text-primary focus:border-accent focus:bg-base/60" />
                              <span className="absolute right-1.5 top-1/2 -translate-y-1/2 text-secondary pointer-events-none text-xs">€</span>
                            </>
                          )}
                        </div>
                        {isEquipment ? (
                          <div className="h-9 flex items-center px-2 bg-purple-500/8 border border-purple-400/30 rounded-lg">
                            <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 w-full text-right">Interne</span>
                          </div>
                        ) : (
                          <select value={item.vat} onChange={e => updateItem(item.id, 'vat', Number(e.target.value))}
                            className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none text-primary text-sm text-right appearance-none">
                            {LEGAL_VAT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        )}
                        <div className="flex flex-col items-end gap-0.5 pr-1">
                          <span className={`font-semibold tabular-nums text-sm text-right ${isEquipment ? 'text-purple-700 dark:text-purple-300' : item.is_internal ? 'text-amber-500' : 'text-primary'}`}>
                            {fmt(Number(item.qty) * Number(item.pu))}
                          </span>
                          {internalUnitCost > 0 && !isEquipment && (
                            <span className="text-[10px] tabular-nums text-secondary/70">
                              coût {fmt(internalUnitCost)}
                            </span>
                          )}
                          {item.is_internal && !isEquipment && (
                            <span className="text-[10px] font-semibold text-amber-600">
                              Interne
                            </span>
                          )}
                        </div>
	                        <div className="flex items-center gap-1 justify-end shrink-0 relative z-10">
	                          <button type="button" onClick={() => { if (!isEquipment) updateItem(item.id, 'is_internal', !item.is_internal) }}
                            disabled={isEquipment}
                            title={isEquipment ? 'Équipement toujours interne' : item.is_internal ? 'Ligne interne (cliquer pour rendre visible)' : 'Rendre interne'}
                            className={`p-1.5 rounded-full transition-all ${isEquipment ? 'text-purple-600 bg-purple-500/10' : item.is_internal ? 'text-amber-500 bg-amber-500/10' : 'text-secondary/40 hover:text-secondary'}`}>
                            {item.is_internal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          {canExpand && (
	                            <button type="button" onClick={() => toggleItemExpand(item.id)} title="Mode / Dimensions"
                              className={`p-1.5 rounded-full transition-all ${isExpanded ? 'text-accent bg-accent/10' : 'text-secondary hover:text-accent hover:bg-accent/10'}`}>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          {!item.material_id && !isEquipment && item.transport_prix_l === null && (
	                            <button type="button" onClick={() => openSaveCatalog(item)} title="Enregistrer dans le catalogue"
                              className="p-1.5 rounded-full text-secondary hover:text-accent hover:bg-accent/10 transition-all">
                              <BookmarkPlus className="w-3.5 h-3.5" />
                            </button>
                          )}
	                          <button type="button" onClick={() => removeItem(item.id)}
                            className="p-1.5 text-secondary hover:text-red-500 transition-all rounded-full hover:bg-red-500/10">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Mobile */}
                      <div className="sm:hidden space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-semibold text-secondary uppercase tracking-wider">Qté</p>
                            {isEquipment ? (
                              <p className="p-2 text-sm font-bold tabular-nums text-purple-700 dark:text-purple-300 bg-purple-500/8 border border-purple-400/30 rounded-lg">{item.qty}</p>
                            ) : isDimensioned ? (
                              <p className="p-2 text-sm font-bold tabular-nums text-accent">{item.qty}</p>
                            ) : (
                              <NumericInput value={item.qty} min={0} onChange={v => updateItem(item.id, 'qty', v ?? 0)}
                                className="w-full p-2 bg-base/50 border border-[var(--elevation-border)] rounded-lg focus:border-accent outline-none text-primary tabular-nums text-sm" />
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-semibold text-secondary uppercase tracking-wider">Unité</p>
                            {isEquipment ? (
                              <p className="p-2 text-sm font-semibold text-purple-700 dark:text-purple-300 bg-purple-500/8 border border-purple-400/30 rounded-lg">usage</p>
                            ) : (
                              <UnitSelect value={item.unit} onChange={v => updateItem(item.id, 'unit', v)}
                                allowedUnits={catalogContext.unitSet} compact className="w-full" />
                            )}
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-semibold text-secondary uppercase tracking-wider">PU HT</p>
                            <div className="relative">
                              {isEquipment ? (
                              <p className="p-2 text-sm font-bold tabular-nums text-purple-700 dark:text-purple-300 text-right bg-purple-500/8 border border-purple-400/30 rounded-lg">{fmt(Number(item.pu))}</p>
                              ) : (
                                <>
                                  <NumericInput value={item.pu} min={0} decimals={2} onChange={v => updateItem(item.id, 'pu', v ?? 0)}
                                    className="w-full p-2 pr-6 border rounded-lg outline-none tabular-nums text-sm bg-base/40 border-[var(--elevation-border)] text-primary focus:border-accent focus:bg-base/60" />
                                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none text-xs">€</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="space-y-0.5">
                            <p className="text-[10px] font-semibold text-secondary uppercase tracking-wider">TVA</p>
                            {isEquipment ? (
                              <p className="p-2 text-sm font-semibold text-purple-700 dark:text-purple-300 text-right bg-purple-500/8 border border-purple-400/30 rounded-lg">Interne</p>
                            ) : (
                              <select value={item.vat} onChange={e => updateItem(item.id, 'vat', Number(e.target.value))}
                                className="w-full p-2 bg-base/50 border border-[var(--elevation-border)] rounded-lg focus:border-accent outline-none text-primary text-sm appearance-none">
                                {LEGAL_VAT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                              </select>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center justify-between pt-1 border-t border-[var(--elevation-border)]/50">
                        <div className="flex flex-col items-end gap-0.5">
                          <span className={`font-bold tabular-nums text-sm ${isEquipment ? 'text-purple-700 dark:text-purple-300' : item.is_internal ? 'text-amber-500' : 'text-primary'}`}>
                            {fmt(Number(item.qty) * Number(item.pu))}
                          </span>
                          {internalUnitCost > 0 && !isEquipment && (
                            <span className="text-[10px] tabular-nums text-secondary/70">
                              coût {fmt(internalUnitCost)}
                            </span>
                          )}
                          {item.is_internal && !isEquipment && (
                            <span className="text-[10px] font-semibold text-amber-600">
                              Interne
                            </span>
                          )}
                        </div>
                        </div>
                      </div>
                    </div>

                    {/* ── Transport / équipement ── */}
	                    {item.transport_prix_l !== null && (
                      <div className="px-3 pb-3 pt-2 border-t border-amber-200/60 dark:border-amber-500/20 space-y-2 bg-amber-500/3 rounded-b-xl">
                        <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                          <Truck className="w-3 h-3" />Transport interne
                        </p>
                        <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-end gap-3">
                          <label className="flex flex-col gap-1 text-xs text-secondary">
                            Distance aller-retour (km)
                            <NumericInput min={1} value={item.transport_km}
                              onChange={v => handleTransportMetaChange(item.id, 'transport_km', v)}
                              className="w-full sm:w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400" />
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-secondary">
                            Conso (L/100 km)
                            <NumericInput min={1} decimals={2} value={item.transport_conso ?? DEFAULT_CONSUMPTION_L_PER_100KM}
                              onChange={v => handleTransportMetaChange(item.id, 'transport_conso', v ?? DEFAULT_CONSUMPTION_L_PER_100KM)}
                              className="w-full sm:w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400" />
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-secondary">
                            Prix carburant (€/L)
                            <NumericInput min={0} decimals={3} value={item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L}
                              onChange={v => handleTransportMetaChange(item.id, 'transport_prix_l', v ?? DEFAULT_FUEL_PRICE_EUR_PER_L)}
                              className="w-full sm:w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400" />
                          </label>
                          <span className="font-bold text-amber-600 dark:text-amber-400 text-sm tabular-nums">
                            {Number(item.qty).toFixed(2)} L &middot; {fmt(Number(item.qty) * (item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L))}
                          </span>
                        </div>
                      </div>
	                    )}
	                    {isEquipment && equipmentMeta && (
                      <div className="px-3 pb-3 pt-3 border-t border-purple-200/60 dark:border-purple-500/20 rounded-b-xl bg-purple-500/3 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-xs font-semibold text-purple-700 dark:text-purple-300 uppercase tracking-wider flex items-center gap-1.5">
                            <Package className="w-3 h-3" />Amortissement équipement
                          </p>
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/10 px-2 py-1 text-[11px] font-semibold text-purple-700 dark:text-purple-300">
                            <EyeOff className="w-3 h-3 shrink-0" />Interne, absent du PDF client
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                          <label className="flex flex-col gap-1 text-xs text-secondary sm:col-span-1">
                            Prix d&apos;achat HT
                            <div className="relative">
                              <NumericInput
                                value={equipmentMeta.purchasePrice}
                                min={0}
                                decimals={2}
                                placeholder="500"
                                onChange={v => handleEquipmentAmortizationChange(item.id, 'purchasePrice', v)}
                                className="w-full h-9 px-2 pr-6 bg-base border border-purple-300/50 dark:border-purple-500/30 rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-purple-400"
                              />
                              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none text-xs">€</span>
                            </div>
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-secondary sm:col-span-1">
                            Usages sur la vie
                            <NumericInput
                              value={equipmentMeta.lifetimeUses}
                              min={1}
                              decimals={0}
                              placeholder="100"
                              onChange={v => handleEquipmentAmortizationChange(item.id, 'lifetimeUses', v)}
                              className="w-full h-9 px-2 bg-base border border-purple-300/50 dark:border-purple-500/30 rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-purple-400"
                            />
                          </label>
                          <div className="flex flex-col gap-1 text-xs text-secondary sm:col-span-1">
                            Coût final / usage
                            <div className="h-9 flex items-center justify-end rounded-lg border border-purple-300/50 dark:border-purple-500/30 bg-purple-500/10 px-2">
                              <span className="font-bold text-purple-700 dark:text-purple-300 tabular-nums text-sm">{fmt(Number(item.pu))}</span>
                            </div>
                          </div>
                          <label className="flex flex-col gap-1 text-xs text-secondary sm:col-span-1">
                            Usages comptés
                            <NumericInput
                              value={item.qty}
                              min={0}
                              decimals={2}
                              onChange={v => updateItem(item.id, 'qty', v ?? 0)}
                              className="w-full h-9 px-2 bg-base border border-purple-300/50 dark:border-purple-500/30 rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-purple-400"
                            />
                          </label>
                          <div className="flex flex-col gap-1 text-xs text-secondary sm:col-span-1">
                            Coût interne total
                            <div className="h-9 flex items-center justify-end rounded-lg border border-purple-300/50 dark:border-purple-500/30 bg-base px-2">
                              <span className="font-bold text-purple-700 dark:text-purple-300 tabular-nums text-sm">{fmt(Number(item.qty) * Number(item.pu))}</span>
                            </div>
                          </div>
                        </div>
                        <p className="text-[11px] text-secondary">
                          Calcul : prix d&apos;achat ÷ usages sur la vie = coût amorti par usage, puis multiplié par les usages comptés sur cette ligne.
                        </p>
                      </div>
                    )}

                    {/* ── Mode dim + dimensions ── */}
                    {isExpanded && canExpand && (
                      <div className="px-3 pb-3 pt-2 border-t border-[var(--elevation-border)]/60 space-y-4 bg-base/20 rounded-b-xl">
                        {!item.material_id && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                              <LayoutGrid className="w-3 h-3" />Tarification dimensionnelle
                            </p>
                            <div className="flex gap-2 flex-wrap">
                              {(['none', 'linear', 'area', 'volume'] as const).map(mode => (
                                <button key={mode}
                                  onClick={() => {
                                    const newMode = mode === item.dimension_pricing_mode ? 'none' : mode
                                    updateItem(item.id, 'dimension_pricing_mode', newMode)
                                    if (newMode !== 'none') updateItem(item.id, 'unit', getModeUnit(newMode, item.unit))
                                  }}
                                  className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${item.dimension_pricing_mode === mode || (mode === 'none' && !item.dimension_pricing_mode) ? 'bg-accent text-black border-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary hover:border-accent/40'}`}>
                                  {mode === 'none' ? 'Libre' : mode === 'linear' ? 'Linéaire (ml)' : mode === 'area' ? 'Surface (m²)' : 'Volume (m³)'}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                        {isDimensioned && (
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                              <Ruler className="w-3 h-3" />Dimensions &rarr; calcul auto de la quantité
                            </p>
                            <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-center gap-3">
                              <label className="flex items-center justify-between sm:justify-start gap-2 text-sm text-secondary">
                                <span className="w-20 sm:w-auto">{lengthMeta.label}</span>
                                <div className="flex items-center gap-1.5">
                                  <NumericInput value={metersToDisplayUnit(item.length_m, lengthMeta.unit)} min={0} decimals={3}
                                    onChange={v => handleDimChange(item.id, 'length_m', v == null ? null : displayUnitToMeters(v, lengthMeta.unit))}
                                    className="w-24 p-2 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent" />
                                  <span className="text-xs text-secondary w-6">{lengthMeta.unit}</span>
                                </div>
                              </label>
                              {(dimensionMode === 'area' || dimensionMode === 'volume' || widthMeta.enabled) && (
                                <label className="flex items-center justify-between sm:justify-start gap-2 text-sm text-secondary">
                                  <span className="w-20 sm:w-auto">{widthMeta.label}</span>
                                  <div className="flex items-center gap-1.5">
                                    <NumericInput value={metersToDisplayUnit(item.width_m, widthMeta.unit)} min={0} decimals={3}
                                      onChange={v => handleDimChange(item.id, 'width_m', v == null ? null : displayUnitToMeters(v, widthMeta.unit))}
                                      className="w-24 p-2 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent" />
                                    <span className="text-xs text-secondary w-6">{widthMeta.unit}</span>
                                  </div>
                                </label>
                              )}
                              {(dimensionMode === 'volume' || heightMeta.enabled) && (
                                <label className="flex items-center justify-between sm:justify-start gap-2 text-sm text-secondary">
                                  <span className="w-20 sm:w-auto">{heightMeta.label}</span>
                                  <div className="flex items-center gap-1.5">
                                    <NumericInput value={metersToDisplayUnit(item.height_m, heightMeta.unit)} min={0} decimals={3}
                                      onChange={v => handleDimChange(item.id, 'height_m', v == null ? null : displayUnitToMeters(v, heightMeta.unit))}
                                      className="w-24 p-2 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent" />
                                    <span className="text-xs text-secondary w-6">{heightMeta.unit}</span>
                                  </div>
                                </label>
                              )}
                              <label className="flex items-center gap-1.5 text-sm text-secondary">
                                <span className="text-xs">×</span>
                                <NumericInput value={item.dim_quantity} min={0.001} decimals={3}
                                  onChange={v => handleDimQuantityChange(item.id, v)}
                                  className="w-16 p-2 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent" />
                                <span className="text-xs text-secondary">unités</span>
                              </label>
                              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 text-accent font-bold text-sm tabular-nums">
                                = {item.qty} {dimensionUnit}
                              </span>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </React.Fragment>
              )
            })}
          </div>
          </div>
          <div className="mt-4 flex gap-3 flex-wrap">
            <button type="button" onClick={addSection}
              className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-accent transition-colors px-4 py-2 rounded-lg bg-base/50 border border-[var(--elevation-border)]">
              <Plus className="w-4 h-4" />Section
            </button>
            <button type="button" onClick={addItem}
              className="flex items-center gap-2 text-sm font-semibold text-secondary hover:text-primary transition-colors px-4 py-2 rounded-lg bg-base/50">
              <Plus className="w-4 h-4" />Ligne libre
            </button>
            <button onClick={() => setIsCatalogModalOpen(true)}
              className="flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 transition-colors px-4 py-2 rounded-lg bg-accent/10">
              <Search className="w-4 h-4" />Depuis le catalogue {!hasCatalog && <span className="text-xs opacity-60">(vide)</span>}
            </button>
            <button onClick={() => setShowTransport(true)}
              className="flex items-center gap-2 text-sm font-semibold text-amber-600 hover:text-amber-500 transition-colors px-4 py-2 rounded-lg bg-amber-500/10">
              <Truck className="w-4 h-4" />Transport
            </button>
            <button onClick={() => { setEquipmentName(''); setEquipmentPurchase(0); setEquipmentUses(100); setShowEquipment(true) }}
              className="flex items-center gap-2 text-sm font-semibold text-purple-600 hover:text-purple-500 transition-colors px-4 py-2 rounded-lg bg-purple-500/10">
              <Package className="w-4 h-4" />Équipement
            </button>
          </div>
          {hasInternal && (
            <p className="mt-3 text-xs text-amber-500 flex items-center gap-1.5">
              <EyeOff className="w-3 h-3" />
              Les lignes en orange sont internes : coût de revient uniquement, elles n'apparaissent pas sur la facture client.
            </p>
          )}
        </div>

        {/* ── Récapitulatif ── */}
        <div className="rounded-3xl card p-5 sm:p-8 w-full md:w-[280px] lg:w-[320px] shrink-0 md:sticky top-24 space-y-4">
          <h3 className="text-lg font-bold text-primary">Récapitulatif</h3>
          <div className="space-y-3 text-sm">
            <div className="flex justify-between text-secondary">
              <span>Total HT</span>
              <span className="tabular-nums font-medium text-primary">{fmt(totalHt)}</span>
            </div>
            {Object.entries(
              clientItems.reduce<Record<number, number>>((acc, i) => {
                const vatAmt = Number(i.qty) * Number(i.pu) * (Number(i.vat) / 100)
                acc[Number(i.vat)] = (acc[Number(i.vat)] ?? 0) + vatAmt
                return acc
              }, {}),
            ).map(([rate, amount]) => (
              <div key={rate} className="flex justify-between text-secondary">
                <span>TVA {rate}%</span>
                <span className="tabular-nums">{fmt(amount)}</span>
              </div>
            ))}
          </div>
          <div className="h-px w-full bg-[var(--elevation-border)]" />
          <div className="flex justify-between items-end">
            <span className="text-secondary font-semibold text-sm">TOTAL TTC</span>
            <span className="text-3xl font-bold text-primary tabular-nums tracking-tight">{fmt(totalTtc)}</span>
          </div>

          {/* Autoliquidation TVA sous-traitant BTP */}
          <div className="flex items-center justify-between pt-1">
            <div>
              <p className="text-xs font-medium text-primary">Autoliquidation TVA</p>
              <p className="text-xs text-secondary">Sous-traitance BTP — art. 283-2 nonies CGI</p>
            </div>
            <button
              type="button"
              onClick={() => setIsReverseCharge(v => !v)}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${isReverseCharge ? 'bg-accent' : 'bg-[var(--elevation-border)]'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${isReverseCharge ? 'translate-x-4' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {isReverseCharge && (
            <p className="text-xs text-amber-500 bg-amber-500/10 rounded px-2 py-1.5">
              La mention "Autoliquidation TVA — art. 283-2 nonies CGI" sera imprimee sur la facture. TVA portee par le donneur d'ordre.
            </p>
          )}

          {/* Aide déductible (MaPrimeRénov, CEE…) */}
          {!showAid ? (
            <button
              onClick={() => setShowAid(true)}
              className="w-full text-xs text-secondary hover:text-accent transition-colors flex items-center gap-1.5 pt-1"
            >
              <Plus className="w-3 h-3" />Ajouter une aide / subvention
            </button>
          ) : (
            <div className="pt-3 mt-1 border-t border-[var(--elevation-border)] space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-secondary uppercase tracking-wider">Aide / Subvention</p>
                <div className="flex items-center gap-2">
                  <div className="flex rounded-lg border border-[var(--elevation-border)] overflow-hidden text-xs">
                    {(['€', '%'] as const).map(m => (
                      <button key={m} type="button" onClick={() => setAidMode(m)}
                        className={`px-2.5 py-1 transition-colors ${aidMode === m ? 'bg-accent text-white' : 'text-secondary hover:text-primary'}`}>
                        {m}
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => { setShowAid(false); setAidLabel(''); setAidAmount(null) }}
                    className="text-secondary hover:text-red-500 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {['MaPrimeRénov\'', 'CEE', 'Éco-PTZ', 'Anah'].map(preset => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAidLabel(preset)}
                    className={`px-2.5 py-1 rounded-full text-xs border transition-colors ${aidLabel === preset ? 'bg-accent text-white border-accent' : 'border-[var(--elevation-border)] text-secondary hover:border-accent hover:text-accent'}`}
                  >
                    {preset}
                  </button>
                ))}
              </div>
              <input
                type="text"
                placeholder="Ou saisir un autre libellé…"
                value={aidLabel}
                onChange={e => setAidLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded-xl text-primary outline-none transition-all"
              />
              <div className="flex items-center gap-2">
                <span className="text-sm text-secondary">−</span>
                <NumericInput
                  min={0}
                  max={aidMode === '%' ? 100 : totalTtc}
                  placeholder="0"
                  value={aidMode === '%'
                    ? (aidAmount != null && totalTtc > 0 ? Math.round((aidAmount / totalTtc) * 10000) / 100 : null)
                    : aidAmount}
                  onChange={v => {
                    if (v == null) { setAidAmount(null); return }
                    const val = aidMode === '%'
                      ? Math.round(Math.min(100, Math.max(0, v)) * totalTtc) / 100
                      : Math.min(totalTtc, Math.max(0, v))
                    setAidAmount(val)
                  }}
                  className="flex-1 px-3 py-2 text-sm bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded-xl text-primary outline-none transition-all tabular-nums text-right"
                />
                <span className="text-sm text-secondary w-4">{aidMode === '%' ? '%' : '€'}</span>
              </div>
              {aidAmount != null && aidAmount > 0 && (
                <div className="pt-2 border-t border-[var(--elevation-border)]">
                  <div className="flex justify-between text-sm text-secondary">
                    <span>Total TTC</span><span className="tabular-nums">{fmt(totalTtc)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-green-600 dark:text-green-400">
                    <span>{aidLabel || 'Aide'}</span><span className="tabular-nums">−{fmt(aidAmount)}</span>
                  </div>
                  <div className="h-px bg-[var(--elevation-border)] my-1" />
                  <div className="flex justify-between font-bold text-primary">
                    <span>Reste à charge</span>
                    <span className="tabular-nums text-lg">{fmt(Math.max(0, totalTtc - aidAmount))}</span>
                  </div>
                </div>
              )}
            </div>
          )}

          {hasInternal && (
            <>
              <div className="h-px w-full bg-[var(--elevation-border)]" />
              <div className="space-y-2 text-sm">
                <p className="text-xs font-bold text-secondary uppercase tracking-wider">Marge interne</p>
                <div className="flex justify-between text-secondary">
                  <span>Coût interne</span>
                  <span className="tabular-nums text-amber-500">{fmt(totalInternalHt)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span className="text-primary">Marge brute</span>
                  <span className={`tabular-nums ${margeHt >= 0 ? 'text-green-500' : 'text-red-500'}`}>{fmt(margeHt)}</span>
                </div>
                <div className="flex justify-between text-secondary">
                  <span>Taux de marge</span>
                  <span className={`tabular-nums font-bold ${margePct >= 0 ? 'text-green-500' : 'text-red-500'}`}>{margePct.toFixed(1)}%</span>
                </div>
              </div>
            </>
          )}

          {/* ── Échéancier ── */}
          <div className="h-px w-full bg-[var(--elevation-border)]" />
          {!showSchedule ? (
            <button
              onClick={() => { setShowSchedule(true); if (schedule.length === 0) addScheduleLine() }}
              className="w-full text-xs text-secondary hover:text-blue-500 transition-colors flex items-center gap-1.5"
            >
              <CalendarClock className="w-3 h-3" />Paiement en plusieurs fois
            </button>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarClock className="w-3 h-3" />Échéancier
                </p>
                <button onClick={() => { setShowSchedule(false); setSchedule([]) }} className="text-secondary hover:text-red-500 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="space-y-2">
                {schedule.map((s, idx) => {
                  const isPaid = !!s.paid_payment_id
                  const computedAmount = scheduleLineAmount(s)
                  return (
                    <div key={s.id} className={`rounded-xl border p-3 space-y-2 ${isPaid ? 'border-green-200 dark:border-green-500/20 bg-green-50 dark:bg-green-500/5' : 'border-[var(--elevation-border)] bg-base/30'}`}>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={s.label}
                          onChange={e => updateScheduleLine(s.id, 'label', e.target.value)}
                          disabled={!!isPaid}
                          placeholder="Label"
                          className="flex-1 text-xs font-semibold bg-transparent border-b border-[var(--elevation-border)] focus:border-blue-400 outline-none text-primary pb-0.5 disabled:opacity-60"
                        />
                        {!isPaid && (
                          <button onClick={() => removeScheduleLine(s.id)} className="text-secondary hover:text-red-500 transition-colors shrink-0">
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        {isPaid && <span className="text-xs text-green-600 font-semibold shrink-0">Payé</span>}
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="date"
                          value={s.due_date}
                          onChange={e => updateScheduleLine(s.id, 'due_date', e.target.value)}
                          disabled={!!isPaid}
                          className="flex-1 text-xs bg-transparent border border-[var(--elevation-border)] rounded-lg px-2 py-1.5 text-primary focus:border-blue-400 outline-none disabled:opacity-60 tabular-nums"
                        />
                        <select
                          value={s.amount_type}
                          onChange={e => setScheduleAmountType(s.id, e.target.value as ScheduleAmountType)}
                          disabled={!!isPaid}
                          className="w-14 text-xs bg-transparent border border-[var(--elevation-border)] rounded-lg px-2 py-1.5 text-primary focus:border-blue-400 outline-none disabled:opacity-60 appearance-none"
                        >
                          <option value="amount">€</option>
                          <option value="percentage">%</option>
                        </select>
                        <div className="relative w-24">
                          <NumericInput
                            min={0}
                            max={s.amount_type === 'percentage' ? 100 : undefined}
                            value={s.amount_type === 'percentage' ? (s.percentage ?? null) : (s.amount || null)}
                            onChange={v => {
                              const value = v ?? 0
                              if (s.amount_type === 'percentage') updateScheduleLine(s.id, 'percentage', value)
                              else updateScheduleLine(s.id, 'amount', value)
                            }}
                            disabled={!!isPaid}
                            placeholder="0"
                            className="w-full text-xs bg-transparent border border-[var(--elevation-border)] rounded-lg px-2 py-1.5 pr-5 text-primary focus:border-blue-400 outline-none text-right tabular-nums disabled:opacity-60"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none text-xs">{s.amount_type === 'percentage' ? '%' : '€'}</span>
                        </div>
                      </div>
                      {s.amount_type === 'percentage' && (
                        <p className="text-[11px] text-secondary text-right tabular-nums">
                          {fmt(computedAmount)}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>

              <button
                onClick={addScheduleLine}
                className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-500 transition-colors py-1.5 rounded-lg border border-dashed border-blue-300 dark:border-blue-500/30 hover:bg-blue-50 dark:hover:bg-blue-500/5"
              >
                <Plus className="w-3 h-3" />Ajouter une échéance
              </button>

              {/* Contrôle de la somme */}
              <div className={`text-xs flex justify-between px-1 ${Math.abs(scheduleRemaining) < 0.01 ? 'text-green-600' : 'text-amber-600'}`}>
                <span>Reste à ventiler</span>
                <span className="tabular-nums font-bold">{fmt(scheduleRemaining)}</span>
              </div>

              {scheduleError && <p className="text-xs text-red-500">{scheduleError}</p>}

              <button
                onClick={handleSaveSchedule}
                disabled={scheduleSaving || !invoiceId}
                className="w-full py-2 rounded-xl bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {scheduleSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                Enregistrer l&apos;échéancier
              </button>
              {!invoiceId && (
                <p className="text-xs text-secondary text-center">Sauvegardez d&apos;abord la facture.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Modal nouveau client inline */}
      {newClientOpen && (
        <div className="modal-overlay z-[200]">
          <div className="modal-panel animate-in fade-in duration-200 sm:max-w-md">
            <button onClick={() => setNewClientOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary"><X className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold text-primary mb-6">Nouveau client</h2>

            <div className="flex rounded-xl overflow-hidden border border-[var(--elevation-border)] mb-5">
              {(['company', 'individual'] as const).map(t => (
                <button key={t} type="button" onClick={() => setNewClientType(t)}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${newClientType === t ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}>
                  {t === 'company' ? 'Professionnel' : 'Particulier'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {newClientType === 'company' && (
                <input type="text" placeholder="Raison sociale *" value={newClientForm.company_name}
                  onChange={e => setNewClientForm(p => ({ ...p, company_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" autoFocus />
              )}
              {newClientType === 'company' && (
                <input type="text" placeholder="Nom du contact référent" value={newClientForm.contact_name}
                  onChange={e => setNewClientForm(p => ({ ...p, contact_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
              )}
              <div className="grid grid-cols-2 gap-3">
                <input type="text" placeholder={newClientType === 'individual' ? 'Prénom *' : 'Prénom contact'}
                  value={newClientForm.first_name} onChange={e => setNewClientForm(p => ({ ...p, first_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  autoFocus={newClientType === 'individual'} />
                <input type="text" placeholder={newClientType === 'individual' ? 'Nom *' : 'Nom contact'}
                  value={newClientForm.last_name} onChange={e => setNewClientForm(p => ({ ...p, last_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
              <input type="email" placeholder="Email" value={newClientForm.email}
                onChange={e => setNewClientForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
              <input type="tel" placeholder="Téléphone" value={newClientForm.phone}
                onChange={e => setNewClientForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
              {/* Adresse - affichée pour particuliers, optionnelle pour pro */}
              <input type="text" placeholder={newClientType === 'individual' ? 'Adresse' : 'Adresse (optionnel)'}
                value={newClientForm.address_line1} onChange={e => setNewClientForm(p => ({ ...p, address_line1: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
              <div className="grid grid-cols-2 gap-3">
                <input type="text" placeholder="Code postal" value={newClientForm.postal_code}
                  onChange={e => setNewClientForm(p => ({ ...p, postal_code: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
                <input type="text" placeholder="Ville" value={newClientForm.city}
                  onChange={e => setNewClientForm(p => ({ ...p, city: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50" />
              </div>
            </div>

            {newClientError && <p className="mt-3 text-xs text-red-400">{newClientError}</p>}

            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setNewClientOpen(false)} className="flex-1 py-3 rounded-full text-secondary font-semibold border border-[var(--elevation-border)] hover:text-primary transition-colors">Annuler</button>
              <button type="button" onClick={handleCreateClientInline} disabled={newClientPending}
                className="flex-1 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-60 disabled:hover:scale-100 flex items-center justify-center gap-2">
                {newClientPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Créer et sélectionner
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Enregistrer dans le catalogue */}
      {saveCatalogItem && (
        <SaveToCatalogModal
          source={{
            description: saveCatalogItem.desc,
            unit: saveCatalogItem.unit,
            unit_price: saveCatalogItem.pu,
            vat_rate: saveCatalogItem.vat,
            length_m: saveCatalogItem.length_m,
            width_m: saveCatalogItem.width_m,
            height_m: saveCatalogItem.height_m,
            dimension_pricing_mode: saveCatalogItem.dimension_pricing_mode,
          } satisfies SaveToCatalogSource}
          catalogContext={catalogContext}
          existingCategories={{
            material: Array.from(new Set(materials.filter(m => m.item_kind !== 'service' && m.category).map(m => m.category as string))),
            service: Array.from(new Set(materials.filter(m => m.item_kind === 'service' && m.category).map(m => m.category as string))),
            labor: Array.from(new Set(laborRates.filter(l => l.category).map(l => l.category as string))),
          }}
          onClose={() => setSaveCatalogItem(null)}
          onSaved={(result: SaveToCatalogResult) => handleSavedToCatalog(saveCatalogItem, result)}
        />
      )}

      {sendModalOpen && (
        <AttachmentPickerModal
          title="Envoyer la facture"
          description="Sélectionnez les contrats du même client à joindre en pièces jointes."
          recipientEmail={null}
          groups={sendModalGroups}
          loading={sendModalLoading}
          submitting={isSending}
          error={sendModalError}
          onCancel={() => { setSendModalOpen(false); setPendingInvoiceId(null); }}
          onConfirm={confirmInvoiceSend}
        />
      )}
      <ClientEmailRequiredModal
        open={emailRequiredOpen}
        client={getSelectedClientForSend()}
        documentLabel="la facture"
        onCancel={() => setEmailRequiredOpen(false)}
        onSaved={handleClientEmailSaved}
      />
    </main>
  )
}
