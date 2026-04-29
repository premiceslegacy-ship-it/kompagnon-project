'use client'

import React, { useState, useTransition } from 'react'
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
import { createInvoice, saveInvoiceItems, sendInvoice } from '@/lib/data/mutations/invoices'
import { createClientInline } from '@/lib/data/mutations/clients'
import { getClientDisplayName } from '@/lib/client'
import { UnitSelect } from '@/components/ui/UnitSelect'
import {
  ArrowLeft, Eye, Send, Plus, Trash2, FileText, Search, X, Loader2, Save, EyeOff, Truck, ChevronDown, ChevronUp, Ruler, Package,
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
  vat: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dimension_pricing_mode: DimensionPricingMode | null
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

function computeDimensionQuantity(
  mode: DimensionPricingMode,
  lengthM: number | null,
  widthM: number | null,
  heightM: number | null,
  fallbackQuantity: number,
): number {
  switch (mode) {
    case 'linear':
      return computeLinearQuantity(lengthM ?? 0)
    case 'area':
      return computeSurfaceQuantity(lengthM ?? 0, widthM ?? 0)
    case 'volume':
      return computeVolumeQuantity(lengthM ?? 0, widthM ?? 0, heightM ?? 0)
    default:
      return fallbackQuantity
  }
}

function clientDisplayName(c: Client): string {
  return getClientDisplayName(c)
}

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

type LinkableChantier = { id: string; title: string; client_id: string | null }

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
        status: 'active', source: null, total_revenue: 0, payment_terms_days: 30,
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
  const [chantierId, setChantierId] = useState<string | null>((existingInvoice as any)?.chantier_id ?? defaultChantierId ?? null)
  const [aidLabel, setAidLabel] = useState<string>(existingInvoice?.aid_label ?? '')
  const [aidAmount, setAidAmount] = useState<number | null>(existingInvoice?.aid_amount ?? null)
  const [showAid, setShowAid] = useState<boolean>(!!(existingInvoice?.aid_label || existingInvoice?.aid_amount))
  const [aidMode, setAidMode] = useState<'€' | '%'>('€')
  const [items, setItems] = useState<LocalItem[]>(
    existingInvoice?.items?.length
      ? existingInvoice.items.map((i, idx) => ({
          id: idx + 1,
          desc: i.description ?? '',
          qty: i.quantity,
          unit: i.unit ?? '',
          pu: i.unit_price,
          vat: i.vat_rate,
          length_m: i.length_m ?? null,
          width_m: i.width_m ?? null,
          height_m: i.height_m ?? null,
          dimension_pricing_mode: inferDimensionMode(i),
          is_internal: i.is_internal ?? false,
          material_id: i.material_id ?? null,
          ...getTransportMeta(i),
        }))
      : [{ id: 1, desc: '', qty: 1, unit: '', pu: 0, vat: defaultVatRate, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, is_internal: false, material_id: null, transport_km: null, transport_conso: null, transport_prix_l: null }],
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
    const isStarterOnly = prev.length === 1 && prev[0].desc === '' && prev[0].pu === 0
    return isStarterOnly ? newItems : [...prev, ...newItems]
  }

  function addFromCatalog(name: string, unit: string | null, price: number, vat: number, isInternal = false) {
    const newItem = {
      id: Date.now(),
      desc: name,
      qty: 1,
      unit: unit ?? '',
      pu: price,
      vat,
      length_m: null,
      width_m: null,
      height_m: null,
      dimension_pricing_mode: null,
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
      vat: defaultVatRate,
      length_m: pricing.lengthM,
      width_m: pricing.widthM,
      height_m: pricing.heightM,
      dimension_pricing_mode: material.dimension_pricing_mode ?? null,
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
    const newItems = p.items.map(item => ({
      id: Date.now() + Math.random(),
      desc: item.designation,
      qty: item.quantity,
      unit: item.unit,
      pu: item.unit_price_ht,
      vat: defaultVatRate,
      length_m: null,
      width_m: null,
      height_m: null,
      dimension_pricing_mode: null,
      is_internal: item.is_internal,
      material_id: null,
      ...getTransportMeta({
        description: item.designation,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price_ht,
        is_internal: item.is_internal,
      }),
    }))
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
      vat: defaultVatRate,
      length_m: null,
      width_m: null,
      height_m: null,
      dimension_pricing_mode: null,
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

  function handleAddEquipment() {
    if (equipmentPurchase <= 0 || equipmentUses <= 0) return
    const desc = equipmentName.trim() || `Équipement amorti (${equipmentPurchase} € / ${equipmentUses} usages)`
    const newItem = {
      id: Date.now(),
      desc,
      qty: 1,
      unit: 'usage',
      pu: equipmentCostPerUse,
      vat: defaultVatRate,
      length_m: null,
      width_m: null,
      height_m: null,
      dimension_pricing_mode: null,
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
  const [error, setError] = useState<string | null>(null)

  // ── Helpers ──────────────────────────────────────────────────────────────────

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
        is_internal: true,
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
        qty: pricing?.quantity ?? computeDimensionQuantity(mode, nextLength, nextWidth, nextHeight, item.qty),
        unit: pricing?.unit ?? getModeUnit(mode, item.unit),
        pu: pricing?.unitPrice ?? item.pu,
      }
    }))
  }

  function addItem() {
    setItems(prev => [...prev, { id: Date.now(), desc: '', qty: 1, unit: '', pu: 0, vat: defaultVatRate, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, is_internal: false, material_id: null, transport_km: null, transport_conso: null, transport_prix_l: null }])
  }

  function removeItem(id: number) {
    setItems(prev => prev.filter(i => i.id !== id))
  }

  function handleImportQuote(quote: QuoteWithItems) {
    const newItems: LocalItem[] = [
      ...quote.sections.flatMap(sec =>
        sec.items.map(item => ({
          id: Date.now() + Math.random(),
          desc: item.description ?? '',
          qty: item.quantity,
          unit: (item as any).unit ?? '',
          pu: item.unit_price,
          vat: item.vat_rate ?? defaultVatRate,
          length_m: item.length_m ?? null,
          width_m: item.width_m ?? null,
          height_m: item.height_m ?? null,
          dimension_pricing_mode: inferDimensionMode(item),
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
      ),
      ...quote.unsectionedItems.map(item => ({
        id: Date.now() + Math.random(),
        desc: item.description ?? '',
        qty: item.quantity,
        unit: (item as any).unit ?? '',
        pu: item.unit_price,
        vat: item.vat_rate ?? defaultVatRate,
        length_m: item.length_m ?? null,
        width_m: item.width_m ?? null,
        height_m: item.height_m ?? null,
        dimension_pricing_mode: inferDimensionMode(item),
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
    setItems(newItems.length > 0 ? newItems : [{ id: Date.now(), desc: '', qty: 1, unit: '', pu: 0, vat: defaultVatRate, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, is_internal: false, material_id: null, transport_km: null, transport_conso: null, transport_prix_l: null }])
    setImportedQuoteId(quote.id)
    setIsQuoteModalOpen(false)
  }

  function getMeta() {
    return { clientId: clientId || null, issueDate, dueDate, title: title || 'Facture', quoteId: importedQuoteId, chantierId: chantierId || null, aidLabel: aidLabel || null, aidAmount }
  }

  function getItemsPayload() {
    return items.map(i => ({
      description: i.desc,
      quantity: Number(i.qty),
      unit: i.unit,
      unit_price: Number(i.pu),
      vat_rate: Number(i.vat),
      length_m: i.length_m,
      width_m: i.width_m,
      height_m: i.height_m,
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

  function handleSend() {
    if (!clientId) { setError('Sélectionnez un client avant d\'envoyer.'); return }
    setIsSending(true)
    setError(null)
    startTransition(async () => {
      const id = await ensureInvoiceId()
      if (!id) { setIsSending(false); return }
      const saveRes = await saveInvoiceItems(id, getItemsPayload(), getMeta())
      if (saveRes.error) { setError(saveRes.error); setIsSending(false); return }
      const sendRes = await sendInvoice(id)
      if (sendRes.error) { setError(sendRes.error); setIsSending(false); return }
      router.push(returnTo)
    })
  }

  // ── Totaux ───────────────────────────────────────────────────────────────────
  const clientItems = items.filter(i => !i.is_internal)
  const internalItems = items.filter(i => i.is_internal)
  const totalHt = clientItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu), 0)
  const totalTva = clientItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu) * (Number(i.vat) / 100), 0)
  const totalTtc = totalHt + totalTva
  const totalInternalHt = internalItems.reduce((acc, i) => acc + Number(i.qty) * Number(i.pu), 0)
  const margeHt = totalHt - totalInternalHt
  const margePct = totalHt > 0 ? (margeHt / totalHt) * 100 : 0
  const hasInternal = internalItems.length > 0

  const isEditing = !!existingInvoice

  return (
    <main className="page-container space-y-6 md:space-y-8">

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
                  <input type="number" min={0} step={0.01} value={equipmentPurchase || ''} onChange={e => setEquipmentPurchase(Number(e.target.value))}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Usages sur la vie</label>
                  <input type="number" min={1} step={1} value={equipmentUses} onChange={e => setEquipmentUses(Number(e.target.value))}
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
                    Ligne interne — coût de revient, non visible sur la facture client
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowEquipment(false)}
                className="px-5 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold">Annuler</button>
              <button type="button" onClick={handleAddEquipment} disabled={equipmentPurchase <= 0 || equipmentUses <= 0}
                className="px-5 py-2.5 rounded-full bg-purple-500 text-white font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-purple-500/20 disabled:opacity-40 disabled:hover:scale-100">
                <Plus className="w-4 h-4" />Ajouter la ligne
              </button>
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
          <Link href={returnTo} className="w-10 h-10 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] flex items-center justify-center text-secondary hover:text-primary transition-colors flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-primary">{isEditing ? 'Modifier la facture' : 'Nouvelle facture'}</h1>
            {existingInvoice?.number && <p className="text-sm text-secondary">{existingInvoice.number}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={handlePreview} disabled={isSaving || isSending}
            className="px-4 py-2.5 rounded-full text-secondary hover:text-primary hover:bg-base/50 transition-colors font-semibold flex items-center gap-2 disabled:opacity-50 whitespace-nowrap">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
            <span className="hidden sm:inline">Aperçu PDF</span>
          </button>
          <button onClick={handleSaveDraft} disabled={isSaving || isSending}
            className="px-4 py-2.5 rounded-full border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors font-semibold flex items-center gap-2 disabled:opacity-50 whitespace-nowrap">
            <Save className="w-4 h-4" /><span className="hidden sm:inline">Brouillon</span>
          </button>
          <button onClick={handleSend} disabled={isSaving || isSending}
            className="px-4 sm:px-6 py-2.5 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-50 disabled:scale-100 whitespace-nowrap">
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            <span className="hidden sm:inline">Valider &</span> Envoyer
          </button>
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
        <div className="p-4 rounded-xl bg-accent/10 border border-accent/20 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText className="w-5 h-5 text-accent" />
            <div>
              <span className="font-semibold text-primary">Facturer depuis un devis existant ?</span>
              {importedQuoteId && <span className="ml-3 text-xs text-accent font-bold">Devis importé ✓</span>}
            </div>
          </div>
          {acceptedQuotes.length > 0 ? (
            <button onClick={() => setIsQuoteModalOpen(true)}
              className="px-4 py-2 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-sm font-bold text-primary hover:bg-base transition-colors">
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

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8 items-start">
        {/* ── Lignes ── */}
        <div className="rounded-3xl card p-4 sm:p-8 flex-1 w-full overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse" style={{ minWidth: 760 }}>
              <thead>
                <tr className="border-b border-[var(--elevation-border)]">
                  <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[36%] whitespace-nowrap">Désignation</th>
                  <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[7%] text-right whitespace-nowrap">Qté</th>
                  <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[8%] text-center whitespace-nowrap">Unité</th>
                  <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[14%] text-right whitespace-nowrap">PU HT</th>
                  <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[9%] text-right whitespace-nowrap">TVA</th>
                  <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[13%] text-right whitespace-nowrap">Total HT</th>
                  <th className="pb-4 text-xs font-bold text-secondary uppercase tracking-wider w-[7%] text-center" title="Interne (non facturé au client) whitespace-nowrap">Int.</th>
                  <th className="pb-4 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {items.map(item => {
                  const dimensionMode = getItemDimensionMode(item)
                  const isDimensioned = dimensionMode !== 'none'
                  const isExpanded = expandedItems.has(item.id)
                  const dimensionUnit = getModeUnit(dimensionMode, item.unit)
                  const sourceMaterial = item.material_id ? materials.find(m => m.id === item.material_id) : null
                  const lengthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'length', dimensionMode)
                  const widthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'width', dimensionMode)
                  const heightMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'height', dimensionMode)

                  return (
                    <React.Fragment key={item.id}>
                      <tr className={`group ${item.is_internal ? 'opacity-60 bg-amber-500/5' : ''}`}>
                        <td className="py-3 pr-3">
                          <input type="text" value={item.desc} onChange={e => updateItem(item.id, 'desc', e.target.value)}
                            placeholder={item.is_internal ? 'Coût interne (non visible client)...' : 'Description...'}
                            className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary text-sm" />
                        </td>
                        <td className="py-3 pr-2">
                          {isDimensioned ? (
                            <p className="w-full p-2 text-right text-sm font-bold tabular-nums text-accent">{item.qty}</p>
                          ) : (
                            <input type="number" value={item.qty} min={0} onChange={e => updateItem(item.id, 'qty', Number(e.target.value))}
                              className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary text-sm tabular-nums text-right" />
                          )}
                        </td>
                        <td className="py-3 pr-2">
                          <UnitSelect
                            value={item.unit}
                            onChange={value => updateItem(item.id, 'unit', value)}
                            allowedUnits={catalogContext.unitSet}
                            compact
                            className="w-full"
                          />
                        </td>
                        <td className="py-3 pr-2">
                          <div className="relative">
                            <input type="number" value={item.pu} min={0} onChange={e => updateItem(item.id, 'pu', Number(e.target.value))}
                              className="w-full p-2 pr-5 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary text-sm tabular-nums text-right" />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-secondary pointer-events-none text-xs">€</span>
                          </div>
                        </td>
                        <td className="py-3 pr-2">
                          <select value={item.vat} onChange={e => updateItem(item.id, 'vat', Number(e.target.value))}
                            className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none transition-all text-primary text-sm text-right appearance-none">
                            {LEGAL_VAT_RATES.map(r => <option key={r} value={r}>{r}%</option>)}
                          </select>
                        </td>
                        <td className="py-3 text-right pr-1">
                          <span className={`font-semibold tabular-nums text-sm ${item.is_internal ? 'text-amber-500' : 'text-primary'}`}>
                            {fmt(Number(item.qty) * Number(item.pu))}
                          </span>
                        </td>
                        <td className="py-3 text-center">
                          <button
                            onClick={() => updateItem(item.id, 'is_internal', !item.is_internal)}
                            title={item.is_internal ? 'Ligne interne (cliquer pour rendre visible)' : 'Rendre interne (coût non facturé au client)'}
                            className={`p-1.5 rounded-lg transition-all ${item.is_internal ? 'text-amber-500 bg-amber-500/10' : 'text-secondary/30 hover:text-secondary'}`}>
                            {item.is_internal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                        </td>
                        <td className="py-3 text-right">
                          <div className="flex justify-end items-center gap-0.5">
                            {isDimensioned && (
                              <button
                                onClick={() => toggleItemExpand(item.id)}
                                className={`p-1.5 rounded-full transition-all ${isExpanded ? 'text-accent bg-accent/10' : 'text-secondary hover:text-accent hover:bg-accent/10'}`}
                                title="Dimensions"
                              >
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            )}
                            <button onClick={() => removeItem(item.id)}
                              className="p-1.5 text-secondary hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all rounded-full hover:bg-red-500/10">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {item.transport_prix_l !== null && (
                        <tr>
                          <td colSpan={8} className="pb-4 pt-0">
                            <div className="mx-2 rounded-xl border border-amber-200/60 dark:border-amber-500/20 bg-amber-500/5 px-4 py-3 space-y-2">
                              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Truck className="w-3 h-3" />Détail transport (coût interne — non visible client)
                              </p>
                              <div className="flex flex-wrap items-end gap-3">
                                <label className="flex flex-col gap-1 text-xs text-secondary">
                                  Distance aller-retour (km)
                                  <input
                                    type="number"
                                    min={1}
                                    value={item.transport_km ?? ''}
                                    onChange={e => handleTransportMetaChange(item.id, 'transport_km', e.target.value === '' ? null : Number(e.target.value))}
                                    className="w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400"
                                  />
                                </label>
                                <span className="text-secondary text-sm pb-1.5">×</span>
                                <label className="flex flex-col gap-1 text-xs text-secondary">
                                  Conso (L/100 km)
                                  <input
                                    type="number"
                                    min={1}
                                    step={0.1}
                                    value={item.transport_conso ?? DEFAULT_CONSUMPTION_L_PER_100KM}
                                    onChange={e => handleTransportMetaChange(item.id, 'transport_conso', Number(e.target.value))}
                                    className="w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400"
                                  />
                                </label>
                                <span className="text-secondary text-sm pb-1.5">×</span>
                                <label className="flex flex-col gap-1 text-xs text-secondary">
                                  Prix carburant (€/L)
                                  <input
                                    type="number"
                                    min={0}
                                    step={0.01}
                                    value={item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L}
                                    onChange={e => handleTransportMetaChange(item.id, 'transport_prix_l', Number(e.target.value))}
                                    className="w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400"
                                  />
                                </label>
                                <span className="text-secondary text-sm pb-1.5">=</span>
                                <span className="font-bold text-amber-600 dark:text-amber-400 text-sm tabular-nums pb-1">
                                  {Number(item.qty).toFixed(2)} L · {fmt(Number(item.qty) * (item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L))}
                                </span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                      {isExpanded && isDimensioned && (
                        <tr>
                          <td colSpan={8} className="pb-4 pt-0">
                            <div className="mx-2 rounded-xl border border-[var(--elevation-border)]/50 bg-base/30 px-4 py-3">
                              <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-3 flex items-center gap-1.5">
                                <Ruler className="w-3 h-3" />Dimensions
                              </p>
                              <div className="flex flex-wrap items-center gap-3">
                                <label className="flex items-center gap-2 text-sm text-secondary">
                                  {lengthMeta.label}
                                  <input
                                    type="number"
                                    value={metersToDisplayUnit(item.length_m, lengthMeta.unit) ?? ''}
                                    min={0}
                                    step={0.001}
                                    onChange={e => handleDimChange(item.id, 'length_m', e.target.value === '' ? null : displayUnitToMeters(Number(e.target.value), lengthMeta.unit))}
                                    className="w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent"
                                  />
                                  <span className="text-xs text-secondary">{lengthMeta.unit}</span>
                                </label>
                                {(dimensionMode === 'area' || dimensionMode === 'volume' || widthMeta.enabled) && (
                                  <>
                                    <span className="text-secondary font-bold">×</span>
                                    <label className="flex items-center gap-2 text-sm text-secondary">
                                      {widthMeta.label}
                                      <input
                                        type="number"
                                        value={metersToDisplayUnit(item.width_m, widthMeta.unit) ?? ''}
                                        min={0}
                                        step={0.001}
                                        onChange={e => handleDimChange(item.id, 'width_m', e.target.value === '' ? null : displayUnitToMeters(Number(e.target.value), widthMeta.unit))}
                                        className="w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent"
                                      />
                                      <span className="text-xs text-secondary">{widthMeta.unit}</span>
                                    </label>
                                  </>
                                )}
                                {(dimensionMode === 'volume' || heightMeta.enabled) && (
                                  <>
                                    <span className="text-secondary font-bold">×</span>
                                    <label className="flex items-center gap-2 text-sm text-secondary">
                                      {heightMeta.label}
                                      <input
                                        type="number"
                                        value={metersToDisplayUnit(item.height_m, heightMeta.unit) ?? ''}
                                        min={0}
                                        step={0.001}
                                        onChange={e => handleDimChange(item.id, 'height_m', e.target.value === '' ? null : displayUnitToMeters(Number(e.target.value), heightMeta.unit))}
                                        className="w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent"
                                      />
                                      <span className="text-xs text-secondary">{heightMeta.unit}</span>
                                    </label>
                                  </>
                                )}
                                <span className="text-secondary">=</span>
                                <span className="font-bold text-accent text-sm tabular-nums">{item.qty} {dimensionUnit}</span>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex gap-3 flex-wrap">
            <button onClick={addItem}
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
        <div className="rounded-3xl card p-5 sm:p-8 w-full lg:w-[320px] shrink-0 lg:sticky top-24 space-y-4">
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
                <input
                  type="number"
                  min={0}
                  max={aidMode === '%' ? 100 : totalTtc}
                  step={aidMode === '%' ? 1 : 0.01}
                  placeholder="0"
                  value={aidMode === '%'
                    ? (aidAmount != null && totalTtc > 0 ? Math.round((aidAmount / totalTtc) * 10000) / 100 : '')
                    : (aidAmount ?? '')}
                  onChange={e => {
                    if (e.target.value === '') { setAidAmount(null); return }
                    const raw = parseFloat(e.target.value)
                    const v = aidMode === '%'
                      ? Math.round(Math.min(100, Math.max(0, raw)) * totalTtc) / 100
                      : Math.min(totalTtc, Math.max(0, raw))
                    setAidAmount(v)
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
              {/* Adresse — affichée pour particuliers, optionnelle pour pro */}
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
    </main>
  )
}
