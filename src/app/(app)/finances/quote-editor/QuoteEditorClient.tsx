'use client'

import React, { useState, useRef, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { Client } from '@/lib/data/queries/clients'
import { buildPersonalizedQuoteIntro, getClientDisplayName, isLegacyAutoQuoteIntro } from '@/lib/client'
import {
  buildMaterialSelectionPricing,
  computeLinearQuantity,
  computeSurfaceQuantity,
  computeVolumeQuantity,
  displayUnitToMeters,
  getDimensionFieldDefinition,
  hasDimensionPricing,
  metersToDisplayUnit,
  type DimensionPricingMode,
} from '@/lib/catalog-pricing'
import type { QuoteWithItems, QuoteItem } from '@/lib/data/queries/quotes'
import type { CatalogMaterial, CatalogLaborRate, PrestationType } from '@/lib/data/queries/catalog'
import {
  createQuote, updateQuote,
  upsertQuoteSection, deleteQuoteSection,
  upsertQuoteItem, deleteQuoteItem, pruneQuoteItems,
  sendQuote,
} from '@/lib/data/mutations/quotes'
import SaveToCatalogModal, { type SaveToCatalogSource, type SaveToCatalogResult } from '@/components/catalog/SaveToCatalogModal'
import { createClientInline } from '@/lib/data/mutations/clients'
import { fetchClientContractsForAttachment } from '@/lib/data/mutations/contracts'
import AttachmentPickerModal, { type AttachmentGroup } from '@/components/AttachmentPickerModal'
import { UnitSelect } from '@/components/ui/UnitSelect'
import { NumericInput } from '@/components/ui/NumericInput'
import { ActionButton } from '@/components/ui/ActionButton'
import {
  ArrowLeft, Send, Plus, Trash2, Search, X,
  Loader2, CheckCircle2, Package, Wrench, FileDown, Bot, Ruler, ChevronDown, ChevronUp, Sparkles, Eye, EyeOff, Layers, Truck, MessageSquare, BookmarkPlus, LayoutGrid,
} from 'lucide-react'
import AtelierAIPanel from '@/components/ai/AtelierAIPanel'
import LaborEstimatePanel, { type MOInsertItem } from '@/components/ai/LaborEstimatePanel'
import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { LEGAL_VAT_RATES, type VatConfig } from '@/lib/utils'
import { computeFuel, DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'
import { getCatalogDocumentVatRate, getCatalogSaleUnitPrice, getInternalResourceUnitCost } from '@/lib/catalog-ui'
import { AI_NAME } from '@/lib/brand'
import type { OrganizationModules } from '@/lib/organization-modules'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

function clientDisplayName(c: Client) {
  return getClientDisplayName(c)
}

function getSafeReturnTo(value: string | null, fallback: string) {
  if (!value) return fallback
  if (!value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

function normalizeSearchText(value: string | null | undefined) {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9@.]+/g, ' ')
    .trim()
}

function findBestClientMatch(clients: Client[], rawSearch: string | null | undefined): Client | null {
  const search = normalizeSearchText(rawSearch)
  if (!search) return null

  let best: { client: Client; score: number } | null = null
  for (const client of clients) {
    const fields = [
      client.company_name,
      client.contact_name,
      [client.first_name, client.last_name].filter(Boolean).join(' '),
      client.email,
      client.phone,
    ].filter(Boolean) as string[]

    let score = 0
    for (const field of fields) {
      const normalized = normalizeSearchText(field)
      if (!normalized) continue
      if (normalized === search) score = Math.max(score, 100)
      else if (normalized.includes(search) || search.includes(normalized)) score = Math.max(score, 80)
      else {
        const searchTokens = search.split(' ').filter(token => token.length >= 2)
        const fieldTokens = normalized.split(' ').filter(token => token.length >= 2)
        const matches = searchTokens.filter(token => fieldTokens.some(fieldToken => fieldToken === token || fieldToken.includes(token) || token.includes(fieldToken))).length
        if (matches > 0) score = Math.max(score, Math.round((matches / searchTokens.length) * 70))
      }
    }

    if (!best || score > best.score) best = { client, score }
  }

  return best && best.score >= 45 ? best.client : null
}

function isLikelyInternalAIItem(sectionTitle: string, item: AIQuoteResult['sections'][number]['items'][number]) {
  if (item.is_internal === true) return true
  const haystack = normalizeSearchText(`${sectionTitle} ${item.description}`)
  return [
    'main d oeuvre',
    'main d',
    'mo interne',
    'ressource interne',
    'cout interne',
    'cout de revient',
    'deplacement',
    'transport',
    'carburant',
    'frais de route',
    'coordination interne',
    'preparation interne',
  ].some(token => haystack.includes(token))
}

// ─── Local state types ──────────────────────────────────────────────────────

type LocalItem = {
  _tempId: string
  id: string | null
  description: string
  quantity: number
  unit: string
  unit_price: number
  unit_cost_ht: number | null
  vat_rate: number
  type: 'material' | 'labor' | 'custom'
  material_id: string | null
  labor_rate_id: string | null
  position: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dimension_pricing_mode: 'none' | 'linear' | 'area' | 'volume' | null
  dim_quantity: number
  is_estimated: boolean  // UI uniquement - non persisté en DB
  is_internal: boolean
  // Métadonnées transport - UI uniquement, non persistées en DB
  transport_km: number | null
  transport_conso: number | null
  transport_prix_l: number | null
}

type LocalSection = {
  _tempId: string
  id: string | null
  title: string
  position: number
  items: LocalItem[]
}

function resolvePersistedSectionId(section: LocalSection | undefined): string | null | undefined {
  if (!section) return undefined
  if (section._tempId === '_unsectioned') return null
  return section.id
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

function itemToLocal(i: QuoteItem): LocalItem {
  const dimensionMode = inferDimensionMode(i)
  const isTransportLine = (i.is_internal ?? false) && i.unit === 'L' && (i.description ?? '').toLowerCase().includes('carburant')
  return {
    _tempId: i.id,
    id: i.id,
    description: i.description ?? '',
    quantity: i.quantity,
    unit: i.unit ?? 'u',
    unit_price: i.unit_price,
    unit_cost_ht: i.unit_cost_ht ?? null,
    length_m: i.length_m ?? null,
    width_m: i.width_m ?? null,
    height_m: i.height_m ?? null,
    dimension_pricing_mode: dimensionMode,
    dim_quantity: (i as { dim_quantity?: number }).dim_quantity ?? 1,
    vat_rate: i.vat_rate,
    type: i.type,
    material_id: i.material_id,
    labor_rate_id: i.labor_rate_id,
    position: i.position,
    is_estimated: false,
    is_internal: i.is_internal ?? false,
    transport_km: isTransportLine ? Math.round(i.quantity / DEFAULT_CONSUMPTION_L_PER_100KM * 100) : null,
    transport_conso: isTransportLine ? DEFAULT_CONSUMPTION_L_PER_100KM : null,
    transport_prix_l: isTransportLine ? i.unit_price : null,
  }
}

// ─── Props ──────────────────────────────────────────────────────────────────

type Props = {
  clients: Client[]
  initialQuote: QuoteWithItems | null
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  prestationTypes: PrestationType[]
  initialClientId?: string
  catalogContext: ResolvedCatalogContext
  modules: OrganizationModules
  vatConfig: VatConfig
  returnTo?: string | null
  allQuotes?: import('@/lib/data/queries/quotes').QuoteStub[]
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function QuoteEditorClient({ clients: initialClients, initialQuote, materials, laborRates, prestationTypes, initialClientId, catalogContext, modules, vatConfig, returnTo: rawReturnTo = null, allQuotes = [] }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isSending, setIsSending] = useState(false)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendModalGroups, setSendModalGroups] = useState<AttachmentGroup[]>([])
  const [sendModalLoading, setSendModalLoading] = useState(false)
  const [sendModalError, setSendModalError] = useState<string | null>(null)
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const defaultVatRate = getCatalogDocumentVatRate(vatConfig)
  const returnTo = getSafeReturnTo(rawReturnTo, '/finances?tab=quotes')

  // Client list (mutable - peut être étendue par création inline)
  const [clients, setClients] = useState<Client[]>(initialClients)

  // Modal création client inline
  const [newClientOpen, setNewClientOpen] = useState(false)
  const [newClientType, setNewClientType] = useState<'company' | 'individual'>('company')
  const [newClientForm, setNewClientForm] = useState({ company_name: '', contact_name: '', first_name: '', last_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' })
  const [newClientError, setNewClientError] = useState<string | null>(null)
  const [newClientPending, startNewClientTransition] = useTransition()

  async function handleCreateClientInline() {
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
        siret: null, address_line1: newClientForm.address_line1 || null, postal_code: newClientForm.postal_code || null, city: newClientForm.city || null,
        status: 'active', source: null, total_revenue: 0, payment_terms_days: 30,
        created_at: new Date().toISOString(),
      }])
      setClientId(res.id!)
      scheduleHeaderSave({ client_id: res.id! })
      setNewClientOpen(false)
      setNewClientForm({ company_name: '', contact_name: '', first_name: '', last_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' })
    })
  }

  // Header state
  const [quoteId, setQuoteId] = useState<string | null>(initialQuote?.id ?? null)
  const [clientId, setClientId] = useState<string>(initialQuote?.client?.id ?? initialClientId ?? initialClients[0]?.id ?? '')
  const [title, setTitle] = useState(initialQuote?.title ?? '')
  const [validityDays, setValidityDays] = useState(initialQuote?.validity_days ?? vatConfig.defaultQuoteValidityDays ?? 30)
  const initialClientForIntro = initialClients.find(c => c.id === (initialQuote?.client?.id ?? initialClientId ?? initialClients[0]?.id ?? '')) ?? initialQuote?.client ?? null
  const getIntroForClient = (client: Client | null | undefined) =>
    client
      ? buildPersonalizedQuoteIntro(client)
      : 'Bonjour,\n\nVeuillez trouver ci-joint notre proposition commerciale.'
  const [clientRequestDescription] = useState<string | null>((initialQuote as any)?.client_request_description ?? null)
  const [clientRequestVisibleOnPdf, setClientRequestVisibleOnPdf] = useState<boolean>(
    (initialQuote as any)?.client_request_visible_on_pdf ?? true,
  )
  const [aidLabel, setAidLabel] = useState<string>(initialQuote?.aid_label ?? '')
  const [aidAmount, setAidAmount] = useState<number | null>(initialQuote?.aid_amount ?? null)
  const [showAid, setShowAid] = useState<boolean>(!!(initialQuote?.aid_label || initialQuote?.aid_amount))
  const [parentQuoteId, setParentQuoteId] = useState<string | null>((initialQuote as any)?.parent_quote_id ?? null)
  const [aidMode, setAidMode] = useState<'€' | '%'>('€')
  const [notesClient, setNotesClient] = useState(
    (initialQuote as any)?.notes_client ?? getIntroForClient(initialClientForIntro as Client | null),
  )
  const introTouchedRef = useRef(false)
  const autoIntroMigratedRef = useRef(false)
  const selectedClientForIntro = clients.find(c => c.id === clientId) ?? initialClientForIntro
  const generatedIntro = getIntroForClient(selectedClientForIntro as Client | null)

  useEffect(() => {
    if ((initialQuote as any)?.notes_client) return
    if (introTouchedRef.current) return
    setNotesClient(generatedIntro)
  }, [generatedIntro, initialQuote])

  useEffect(() => {
    if (autoIntroMigratedRef.current) return
    if (introTouchedRef.current) return
    if (!(initialQuote as any)?.notes_client) return
    if (!selectedClientForIntro) return
    if (!isLegacyAutoQuoteIntro(selectedClientForIntro as Client, notesClient)) return

    autoIntroMigratedRef.current = true
    setNotesClient(generatedIntro)
    if (quoteIdRef.current) {
      scheduleHeaderSave({ notes_client: generatedIntro })
    }
  }, [generatedIntro, initialQuote, notesClient, selectedClientForIntro])

  // Sections state
  const [sections, setSections] = useState<LocalSection[]>(() => {
    if (!initialQuote) return []
    const secs: LocalSection[] = initialQuote.sections.map(s => ({
      _tempId: s.id,
      id: s.id,
      title: s.title ?? '',
      position: s.position,
      items: s.items.map(itemToLocal),
    }))
    if (initialQuote.unsectionedItems.length > 0) {
      secs.push({
        _tempId: '_unsectioned',
        id: null,
        title: 'Lignes libres',
        position: 999,
        items: initialQuote.unsectionedItems.map(itemToLocal),
      })
    }
    return secs
  })

  // Expanded detail rows (dimensions)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())
  const toggleItemExpand = (key: string) =>
    setExpandedItems(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })

  // Catalog modal
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [catalogTarget, setCatalogTarget] = useState<string | null>(null)
  const [catalogSearch, setCatalogSearch] = useState('')

  // Prestation picker (quote-level)
  const [prestationOpen, setPrestationOpen] = useState(false)
  const [prestationSearch, setPrestationSearch] = useState('')

  // ATELIER IA panel
  const [aiPanelOpen, setAIPanelOpen] = useState(false)

  // Labour estimate panel
  const [moaPanelOpen, setMoaPanelOpen] = useState(false)

  // Refs for stale closure avoidance in debounces
  const quoteIdRef = useRef(quoteId)
  const sectionsRef = useRef(sections)
  useEffect(() => { quoteIdRef.current = quoteId }, [quoteId])
  useEffect(() => { sectionsRef.current = sections }, [sections])

  const headerDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const itemDebounces = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingItemKeys = useRef<Set<string>>(new Set())
  const deletedSectionTempIds = useRef<Set<string>>(new Set())
  const deletedItemKeys = useRef<Set<string>>(new Set())
  const deletedItemIds = useRef<Set<string>>(new Set())
  const persistedItemIdsByKey = useRef<Map<string, string>>(new Map())
  const pendingCreatedItemSaves = useRef<Set<Promise<void>>>(new Set())
  const pendingDeleteTasks = useRef<Set<Promise<unknown>>>(new Set())

  function setSectionsSynced(updater: React.SetStateAction<LocalSection[]>) {
    setSections(prev => {
      const next = typeof updater === 'function'
        ? (updater as (value: LocalSection[]) => LocalSection[])(prev)
        : updater
      sectionsRef.current = next
      return next
    })
  }

  async function deleteQuoteItemOrReport(itemId: string, qId: string) {
    const task = (async () => {
      const res = await deleteQuoteItem(itemId, qId)
      if (res.error) {
        console.error('[deleteQuoteItem]', res.error)
        setErrorMsg(res.error)
      }
      return res
    })()
    pendingDeleteTasks.current.add(task)
    task.finally(() => pendingDeleteTasks.current.delete(task))
    return task
  }

  async function deleteQuoteSectionOrReport(sectionId: string) {
    const task = (async () => {
      const res = await deleteQuoteSection(sectionId)
      if (res.error) {
        console.error('[deleteQuoteSection]', res.error)
        setErrorMsg(res.error)
      }
      return res
    })()
    pendingDeleteTasks.current.add(task)
    task.finally(() => pendingDeleteTasks.current.delete(task))
    return task
  }

  async function waitForPendingDeletes() {
    while (pendingDeleteTasks.current.size > 0) {
      await Promise.allSettled([...pendingDeleteTasks.current])
    }
  }

  function getCurrentPersistedItemIds() {
    return sectionsRef.current
      .flatMap(section => section.items)
      .map(item => item.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && !deletedItemIds.current.has(id))
  }

  async function pruneRemovedQuoteItems(qId: string) {
    const res = await pruneQuoteItems(qId, getCurrentPersistedItemIds())
    if (res.error) {
      console.error('[pruneQuoteItems]', res.error)
      setErrorMsg(res.error)
    }
    return res
  }

  // ─── Totals ──────────────────────────────────────────────────────────────

  const allItems = sections.flatMap(s => s.items)
  const visibleItems = allItems.filter(i => !i.is_internal)
  const internalItems = allItems.filter(i => i.is_internal)
  // Totaux client = hors lignes internes (celles-ci n'apparaissent pas sur le PDF)
  const totalHt = visibleItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const totalTva = visibleItems.reduce((sum, i) => sum + i.quantity * i.unit_price * (i.vat_rate / 100), 0)
  const totalTtc = totalHt + totalTva
  // Coût interne réel = unit_cost_ht sur toutes les lignes (achat matière + coût horaire MO)
  // Les lignes sans unit_cost_ht (saisie libre) contribuent leur unit_price comme coût proxy
  const totalInternalHt = allItems.reduce((sum, i) => {
    const cost = i.unit_cost_ht != null ? i.unit_cost_ht : (i.is_internal ? i.unit_price : 0)
    return sum + i.quantity * cost
  }, 0)
  const margeHt = totalHt - totalInternalHt
  const margePct = totalHt > 0 ? (margeHt / totalHt) * 100 : 0
  const hasInternalItems = allItems.some(i => i.unit_cost_ht != null || i.is_internal)

  // ─── Équipement amorti ────────────────────────────────────────────────────
  const [showEquipment, setShowEquipment] = useState(false)
  const [equipmentTarget, setEquipmentTarget] = useState<string | null>(null)
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
    if (result.kind === 'labor') {
      setSectionsSynced(prev => prev.map(s => ({ ...s, items: s.items.map(i =>
        i._tempId === item._tempId ? { ...i, type: 'labor' as const, labor_rate_id: result.id, material_id: null } : i
      )})))
    } else {
      setSectionsSynced(prev => prev.map(s => ({ ...s, items: s.items.map(i =>
        i._tempId === item._tempId ? { ...i, type: 'material' as const, material_id: result.id, labor_rate_id: null } : i
      )})))
    }
    setSaveCatalogItem(null)
  }

  function isEquipmentLine(item: Pick<LocalItem, 'is_internal' | 'unit' | 'transport_prix_l'>) {
    return item.is_internal && item.unit === 'usage' && item.transport_prix_l == null
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

  function handleEquipmentAmortizationChange(
    sectionTempId: string,
    itemTempId: string,
    field: 'name' | 'purchasePrice' | 'lifetimeUses',
    value: string | number | null,
  ) {
    setSectionsSynced(prev => prev.map(section => {
      if (section._tempId !== sectionTempId) return section
      return {
        ...section,
        items: section.items.map(item => {
          if (item._tempId !== itemTempId) return item
          const current = parseEquipmentAmortization(item.description, item.unit_price)
          const name = field === 'name' ? String(value ?? '') : current.name
          const purchasePrice = field === 'purchasePrice' ? (typeof value === 'number' ? value : null) : current.purchasePrice
          const lifetimeUses = field === 'lifetimeUses' ? (typeof value === 'number' ? value : null) : current.lifetimeUses
          const unitPrice = computeEquipmentCostPerUse(purchasePrice, lifetimeUses, item.unit_price)

          return {
            ...item,
            description: buildEquipmentDescription(name, purchasePrice, lifetimeUses),
            unit: 'usage',
            unit_price: unitPrice,
            unit_cost_ht: unitPrice,
            is_internal: true,
            is_estimated: false,
            transport_prix_l: null,
          }
        }),
      }
    }))
    scheduleItemSave(sectionTempId, itemTempId)
  }

  async function handleAddEquipment() {
    if (!equipmentTarget || equipmentPurchase <= 0 || equipmentUses <= 0) return
    const qId = await ensureQuote()
    if (!qId) return
    const sec = sectionsRef.current.find(s => s._tempId === equipmentTarget)!
    const pos = sec.items.length + 1
    const tempId = `item_${Date.now()}`
    deletedItemKeys.current.delete(`${equipmentTarget}_${tempId}`)
    const equipmentLabel = equipmentName.trim() || 'Équipement amorti'
    const desc = `${equipmentLabel}\n\nAmortissement : ${equipmentPurchase} € / ${equipmentUses} usages`
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === equipmentTarget
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: desc, quantity: 1, unit: 'usage', unit_price: equipmentCostPerUse, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: true, transport_km: null, transport_conso: null, transport_prix_l: null }] }
        : s
    ))
    setShowEquipment(false)
    const sectionId = await ensureSectionSaved(equipmentTarget, qId)
    if (!sectionId) return
    await createQuoteItemAndFinalize(equipmentTarget, tempId, qId, sectionId, { quote_id: qId, section_id: sectionId, type: 'custom', description: desc, quantity: 1, unit: 'usage', unit_price: equipmentCostPerUse, vat_rate: defaultVatRate, position: pos, is_internal: true })
  }

  // ─── Transport ────────────────────────────────────────────────────────────
  const [showTransport, setShowTransport] = useState(false)
  const [transportTarget, setTransportTarget] = useState<string | null>(null)
  const [transportKm, setTransportKm] = useState(100)
  const [transportConso, setTransportConso] = useState(8)
  const [transportPrixL, setTransportPrixL] = useState(1.85)
  const transportLiters = Math.round(transportKm * transportConso / 100 * 100) / 100
  const transportCost = Math.round(transportLiters * transportPrixL * 100) / 100

  async function handleAddTransport() {
    if (!transportTarget) return
    const qId = await ensureQuote()
    if (!qId) return
    const sec = sectionsRef.current.find(s => s._tempId === transportTarget)!
    const pos = sec.items.length + 1
    const tempId = `item_${Date.now()}`
    deletedItemKeys.current.delete(`${transportTarget}_${tempId}`)
    const desc = `Carburant - trajet ${transportKm} km`
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === transportTarget
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: desc, quantity: transportLiters, unit: 'L', unit_price: transportPrixL, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: true, transport_km: transportKm, transport_conso: transportConso, transport_prix_l: transportPrixL }] }
        : s
    ))
    setShowTransport(false)
    const sectionId = await ensureSectionSaved(transportTarget, qId)
    if (!sectionId) return
    await createQuoteItemAndFinalize(transportTarget, tempId, qId, sectionId, { quote_id: qId, section_id: sectionId, type: 'custom', description: desc, quantity: transportLiters, unit: 'L', unit_price: transportPrixL, vat_rate: defaultVatRate, position: pos, is_internal: true })
  }

  function handleTransportMetaChange(
    secTempId: string,
    itemTempId: string,
    field: 'transport_km' | 'transport_conso' | 'transport_prix_l',
    value: number | null,
  ) {
    setSectionsSynced(prev => prev.map(s => {
      if (s._tempId !== secTempId) return s
      return {
        ...s,
        items: s.items.map(item => {
          if (item._tempId !== itemTempId) return item
          const updated = { ...item, [field]: value }
          const km = updated.transport_km ?? 0
          const conso = updated.transport_conso ?? DEFAULT_CONSUMPTION_L_PER_100KM
          const prixL = updated.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L
          const { liters } = computeFuel({ km, consumption: conso, pricePerLiter: prixL })
          const desc = `Carburant - trajet ${km} km`
          return { ...updated, description: desc, quantity: liters, unit: 'L', unit_price: prixL }
        }),
      }
    }))
    scheduleItemSave(secTempId, itemTempId)
  }

  // ─── Ensure quote exists ──────────────────────────────────────────────────

  async function ensureQuote(clientIdOverride?: string | null): Promise<string | null> {
    if (quoteIdRef.current) return quoteIdRef.current
    const res = await createQuote({ clientId: clientIdOverride !== undefined ? clientIdOverride : clientId, title: title || 'Nouveau devis' })
    if (res.error || !res.quoteId) { setErrorMsg(res.error); return null }
    setQuoteId(res.quoteId)
    quoteIdRef.current = res.quoteId
    // Mettre à jour l'URL sans déclencher un re-render SSC (évite la réinitialisation du state client)
    const nextUrl = new URL('/finances/quote-editor', window.location.origin)
    nextUrl.searchParams.set('id', res.quoteId)
    nextUrl.searchParams.set('returnTo', returnTo)
    window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}`)
    return res.quoteId
  }

  // ─── Header auto-save ─────────────────────────────────────────────────────

  function scheduleHeaderSave(updates: Parameters<typeof updateQuote>[1]) {
    if (!quoteIdRef.current) return
    if (headerDebounce.current) clearTimeout(headerDebounce.current)
    setSaveStatus('saving')
    headerDebounce.current = setTimeout(async () => {
      const res = await updateQuote(quoteIdRef.current!, updates)
      setSaveStatus(res.error ? 'error' : 'saved')
      if (res.error) setErrorMsg(res.error)
      else setTimeout(() => setSaveStatus('idle'), 2000)
    }, 1000)
  }

  async function syncQuoteHeader(quoteId: string) {
    if (headerDebounce.current) {
      clearTimeout(headerDebounce.current)
      headerDebounce.current = null
    }
    setSaveStatus('saving')
    const res = await updateQuote(quoteId, {
      title: title || 'Nouveau devis',
      client_id: clientId || null,
      validity_days: validityDays,
      notes_client: notesClient,
    })
    setSaveStatus(res.error ? 'error' : 'saved')
    if (res.error) {
      setErrorMsg(res.error)
      return res
    }
    setTimeout(() => setSaveStatus('idle'), 2000)
    return res
  }

  // ─── Section mutations ────────────────────────────────────────────────────

  async function handleAddSection() {
    const qId = await ensureQuote()
    if (!qId) return
    const pos = sections.length + 1
    const tempId = `sec_${Date.now()}`
    deletedSectionTempIds.current.delete(tempId)
    setSectionsSynced(prev => [...prev, { _tempId: tempId, id: null, title: `Section ${pos}`, position: pos, items: [] }])
    startTransition(async () => {
      const res = await upsertQuoteSection({ quote_id: qId, title: `Section ${pos}`, position: pos })
      if (res.sectionId) {
        if (deletedSectionTempIds.current.has(tempId)) {
          await deleteQuoteSectionOrReport(res.sectionId)
          return
        }
        setSectionsSynced(prev => prev.map(s => s._tempId === tempId ? { ...s, id: res.sectionId } : s))
      }
    })
  }

  function handleSectionTitleChange(tempId: string, newTitle: string) {
    setSectionsSynced(prev => prev.map(s => s._tempId === tempId ? { ...s, title: newTitle } : s))
    const sec = sectionsRef.current.find(s => s._tempId === tempId)
    if (!sec?.id || !quoteIdRef.current) return
    startTransition(async () => {
      await upsertQuoteSection({ id: sec.id!, quote_id: quoteIdRef.current!, title: newTitle, position: sec.position })
    })
  }

  async function handleRemoveSection(tempId: string) {
    const sec = sections.find(s => s._tempId === tempId)
    deletedSectionTempIds.current.add(tempId)
    // Annuler tous les debounces de sauvegarde des items de cette section
    for (const item of sec?.items ?? []) {
      const key = `${tempId}_${item._tempId}`
      const itemId = item.id ?? persistedItemIdsByKey.current.get(key)
      deletedItemKeys.current.add(key)
      if (itemId) deletedItemIds.current.add(itemId)
      if (itemDebounces.current[key]) {
        clearTimeout(itemDebounces.current[key])
        delete itemDebounces.current[key]
      }
      pendingItemKeys.current.delete(key)
    }
    setSectionsSynced(prev => prev.filter(s => s._tempId !== tempId))
    if (sec?.id) {
      startTransition(async () => { await deleteQuoteSectionOrReport(sec.id!) })
    }
  }

  // ─── Item mutations ───────────────────────────────────────────────────────

  async function ensureSectionSaved(sectionTempId: string, qId: string): Promise<string | null> {
    if (deletedSectionTempIds.current.has(sectionTempId)) return null
    const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)
    if (!sec) return null
    if (sec.id) return sec.id
    const res = await upsertQuoteSection({ quote_id: qId, title: sec.title, position: sec.position })
    if (res.sectionId) {
      // Vérifier que la section n'a pas été supprimée pendant l'upsert
      const stillExists = !deletedSectionTempIds.current.has(sectionTempId) && sectionsRef.current.some(s => s._tempId === sectionTempId)
      if (!stillExists) {
        await deleteQuoteSectionOrReport(res.sectionId)
        return null
      }
      setSectionsSynced(prev => prev.map(s => s._tempId === sectionTempId ? { ...s, id: res.sectionId } : s))
    }
    return res.sectionId
  }

  async function finalizeCreatedItem(
    sectionTempId: string,
    itemTempId: string,
    itemId: string,
    qId: string,
    sectionId: string,
  ) {
    const key = `${sectionTempId}_${itemTempId}`
    persistedItemIdsByKey.current.set(key, itemId)
    const currentItem = sectionsRef.current.find(s => s._tempId === sectionTempId)?.items.find(i => i._tempId === itemTempId)

    // Si la ligne a été supprimée pendant l'upsert initial, supprimer en DB et ignorer
    if (deletedSectionTempIds.current.has(sectionTempId) || deletedItemKeys.current.has(key) || deletedItemIds.current.has(itemId) || !currentItem) {
      await deleteQuoteItemOrReport(itemId, qId)
      return
    }

    setSectionsSynced(prev => prev.map(s =>
      s._tempId === sectionTempId
        ? { ...s, items: s.items.map(i => i._tempId === itemTempId ? { ...i, id: itemId } : i) }
        : s
    ))

    if (!pendingItemKeys.current.has(key) || !currentItem) return

    if (itemDebounces.current[key]) {
      clearTimeout(itemDebounces.current[key])
      delete itemDebounces.current[key]
    }
    pendingItemKeys.current.delete(key)

    await upsertQuoteItem({
      id: itemId,
      quote_id: qId,
      section_id: sectionId,
      type: currentItem.type,
      material_id: currentItem.material_id,
      labor_rate_id: currentItem.labor_rate_id,
      description: currentItem.description,
      quantity: currentItem.quantity,
      unit: currentItem.unit,
      unit_price: currentItem.unit_price,
      vat_rate: currentItem.vat_rate,
      position: currentItem.position,
      length_m: currentItem.length_m,
      width_m: currentItem.width_m,
      height_m: currentItem.height_m,
      is_internal: currentItem.is_internal,
    })
  }

  function trackCreatedItemSave(task: Promise<void>) {
    pendingCreatedItemSaves.current.add(task)
    task.finally(() => pendingCreatedItemSaves.current.delete(task))
    return task
  }

  async function createQuoteItemAndFinalize(
    sectionTempId: string,
    itemTempId: string,
    qId: string,
    sectionId: string,
    item: Parameters<typeof upsertQuoteItem>[0],
  ) {
    const task = (async () => {
      const res = await upsertQuoteItem(item)
      if (res.error) {
        setErrorMsg(res.error)
        return
      }
      if (res.itemId) {
        await finalizeCreatedItem(sectionTempId, itemTempId, res.itemId, qId, sectionId)
      }
    })()
    return trackCreatedItemSave(task)
  }

  async function waitForPendingCreatedItemSaves() {
    while (pendingCreatedItemSaves.current.size > 0) {
      await Promise.allSettled([...pendingCreatedItemSaves.current])
    }
  }

  async function handleAddFreeItem(sectionTempId: string) {
    const qId = await ensureQuote()
    if (!qId) return
    const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)!
    const pos = sec.items.length + 1
    const tempId = `item_${Date.now()}`
    const key = `${sectionTempId}_${tempId}`
    deletedItemKeys.current.delete(key)
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === sectionTempId
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: '', quantity: 1, unit: 'u', unit_price: 0, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: false, transport_km: null, transport_conso: null, transport_prix_l: null }] }
        : s
    ))
    const sectionId = await ensureSectionSaved(sectionTempId, qId)
    if (!sectionId) return
    await createQuoteItemAndFinalize(sectionTempId, tempId, qId, sectionId, { quote_id: qId, section_id: sectionId, type: 'custom', description: '', quantity: 1, unit: 'u', unit_price: 0, vat_rate: defaultVatRate, position: pos })
  }

  function handleItemChange(sectionTempId: string, itemTempId: string, field: keyof LocalItem, value: string | number | boolean | null) {
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === sectionTempId
        ? { ...s, items: s.items.map(i => i._tempId === itemTempId
            ? { ...i, [field]: value, ...(field === 'unit_price' ? { is_estimated: false } : {}) }
            : i) }
        : s
    ))
    const key = `${sectionTempId}_${itemTempId}`
    if (itemDebounces.current[key]) clearTimeout(itemDebounces.current[key])
    pendingItemKeys.current.add(key)
    itemDebounces.current[key] = setTimeout(async () => {
      const qId = quoteIdRef.current
      if (!qId) return
      const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)
      const item = sec?.items.find(i => i._tempId === itemTempId)
      const sectionId = resolvePersistedSectionId(sec)
      if (!item?.id || sectionId === undefined) return
      if (deletedSectionTempIds.current.has(sectionTempId) || deletedItemKeys.current.has(key) || deletedItemIds.current.has(item.id)) return
      await upsertQuoteItem({
        id: item.id,
        quote_id: qId,
        section_id: sectionId,
        type: item.type,
        material_id: item.material_id,
        labor_rate_id: item.labor_rate_id,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price: item.unit_price,
        vat_rate: item.vat_rate,
        position: item.position,
        length_m: item.length_m,
        width_m: item.width_m,
        height_m: item.height_m,
        is_internal: item.is_internal,
      })
      if (deletedItemIds.current.has(item.id)) {
        await deleteQuoteItemOrReport(item.id, qId)
        return
      }
      pendingItemKeys.current.delete(key)
      delete itemDebounces.current[key]
    }, 800)
  }

  async function handleRemoveItem(sectionTempId: string, itemTempId: string) {
    const sec = sections.find(s => s._tempId === sectionTempId)
    const item = sec?.items.find(i => i._tempId === itemTempId)
    // Annuler le debounce de sauvegarde avant de supprimer
    const key = `${sectionTempId}_${itemTempId}`
    const persistedItemId = item?.id ?? persistedItemIdsByKey.current.get(key)
    deletedItemKeys.current.add(key)
    if (persistedItemId) deletedItemIds.current.add(persistedItemId)
    if (itemDebounces.current[key]) {
      clearTimeout(itemDebounces.current[key])
      delete itemDebounces.current[key]
    }
    pendingItemKeys.current.delete(key)
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === sectionTempId ? { ...s, items: s.items.filter(i => i._tempId !== itemTempId) } : s
    ))
    const qId = quoteIdRef.current
    if (persistedItemId && qId) {
      const res = await deleteQuoteItemOrReport(persistedItemId, qId)
      if (res.error) {
        console.error('[deleteQuoteItem]', res.error)
        setErrorMsg(res.error)
      }
    }
    if (qId) {
      await waitForPendingCreatedItemSaves()
      await waitForPendingDeletes()
      await pruneRemovedQuoteItems(qId)
    }
  }

  // ─── Dimensions (linear / area / volume) ──────────────────────────────────

  function scheduleItemSave(sectionTempId: string, itemTempId: string) {
    const key = `${sectionTempId}_${itemTempId}`
    if (itemDebounces.current[key]) clearTimeout(itemDebounces.current[key])
    pendingItemKeys.current.add(key)
    itemDebounces.current[key] = setTimeout(async () => {
      const qId = quoteIdRef.current
      if (!qId) return
      const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)
      const item = sec?.items.find(i => i._tempId === itemTempId)
      const sectionId = resolvePersistedSectionId(sec)
      if (!item?.id || sectionId === undefined) return
      if (deletedSectionTempIds.current.has(sectionTempId) || deletedItemKeys.current.has(key) || deletedItemIds.current.has(item.id)) return
      await upsertQuoteItem({ id: item.id, quote_id: qId, section_id: sectionId, type: item.type, material_id: item.material_id, labor_rate_id: item.labor_rate_id, description: item.description, quantity: item.quantity, unit: item.unit, unit_price: item.unit_price, unit_cost_ht: item.unit_cost_ht, vat_rate: item.vat_rate, position: item.position, length_m: item.length_m, width_m: item.width_m, height_m: item.height_m, dim_quantity: item.dim_quantity, is_internal: item.is_internal })
      if (deletedItemIds.current.has(item.id)) {
        await deleteQuoteItemOrReport(item.id, qId)
        return
      }
      pendingItemKeys.current.delete(key)
      delete itemDebounces.current[key]
    }, 800)
  }

  function handleDimChange(
    sectionTempId: string,
    itemTempId: string,
    field: 'length_m' | 'width_m' | 'height_m',
    value: number | null,
  ) {
    setSectionsSynced(prev => prev.map(s => {
      if (s._tempId !== sectionTempId) return s
      return { ...s, items: s.items.map(i => {
        if (i._tempId !== itemTempId) return i
        const mode = getItemDimensionMode(i)
        const nextLength = field === 'length_m' ? value : i.length_m
        const nextWidth = field === 'width_m' ? value : i.width_m
        const nextHeight = field === 'height_m' ? value : i.height_m
        const sourceMaterial = i.material_id ? materials.find(material => material.id === i.material_id) : null
        const pricing = sourceMaterial
          ? buildMaterialSelectionPricing({
              item: sourceMaterial,
              requestedLengthM: nextLength,
              requestedWidthM: nextWidth,
              requestedHeightM: nextHeight,
            })
          : null
        return {
          ...i,
          [field]: value,
          quantity: pricing?.quantity != null ? pricing.quantity * (i.dim_quantity || 1) : computeDimensionQuantity(mode, nextLength, nextWidth, nextHeight, i.quantity, i.dim_quantity),
          unit: pricing?.unit ?? getModeUnit(mode, i.unit),
          unit_price: pricing?.unitPrice ?? i.unit_price,
        }
      })}
    }))
    scheduleItemSave(sectionTempId, itemTempId)
  }

  function handleDimQuantityChange(sectionTempId: string, itemTempId: string, value: number | null) {
    const qty = value != null && value > 0 ? value : 1
    setSectionsSynced(prev => prev.map(s => {
      if (s._tempId !== sectionTempId) return s
      return { ...s, items: s.items.map(i => {
        if (i._tempId !== itemTempId) return i
        const mode = getItemDimensionMode(i)
        return {
          ...i,
          dim_quantity: qty,
          quantity: computeDimensionQuantity(mode, i.length_m, i.width_m, i.height_m, i.quantity, qty),
        }
      })}
    }))
    scheduleItemSave(sectionTempId, itemTempId)
  }

  // ─── Catalog select ───────────────────────────────────────────────────────

  async function handleCatalogSelect(entry: CatalogMaterial | CatalogLaborRate, type: 'material' | 'labor') {
    if (!catalogTarget) return
    setCatalogOpen(false)
    const qId = await ensureQuote()
    if (!qId) return
    const isMat = type === 'material'
    const m = entry as CatalogMaterial
    const l = entry as CatalogLaborRate
    const pricing = isMat ? buildMaterialSelectionPricing({ item: m }) : null
    const sec = sectionsRef.current.find(s => s._tempId === catalogTarget)!
    const pos = sec.items.length + 1
    const tempId = `item_${Date.now()}`
    deletedItemKeys.current.delete(`${catalogTarget}_${tempId}`)
    const unitCostHt = isMat
      ? (m.purchase_price ?? null)
      : (l.cost_rate ?? null)
    const newItem: LocalItem = {
      _tempId: tempId, id: null,
      description: isMat ? m.name : l.designation,
      quantity: pricing?.quantity ?? 1,
      unit: pricing?.unit ?? entry.unit ?? (isMat ? 'u' : 'h'),
      unit_price: pricing?.unitPrice ?? (isMat ? getCatalogSaleUnitPrice(m) : (l.rate ?? getInternalResourceUnitCost(l))),
      unit_cost_ht: unitCostHt,
      vat_rate: defaultVatRate,
      type,
      material_id: isMat ? m.id : null,
      labor_rate_id: !isMat ? l.id : null,
      position: pos,
      length_m: pricing?.lengthM ?? null,
      width_m: pricing?.widthM ?? null,
      height_m: pricing?.heightM ?? null,
      dimension_pricing_mode: isMat ? (m.dimension_pricing_mode ?? null) : null,
      dim_quantity: 1,
      is_estimated: false,
      is_internal: !isMat,
      transport_km: null, transport_conso: null, transport_prix_l: null,
    }
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === catalogTarget ? { ...s, items: [...s.items, newItem] } : s
    ))
    const sectionId = await ensureSectionSaved(catalogTarget, qId)
    if (!sectionId) return
    await createQuoteItemAndFinalize(catalogTarget, tempId, qId, sectionId, {
      quote_id: qId, section_id: sectionId,
      type: newItem.type,
      material_id: newItem.material_id,
      labor_rate_id: newItem.labor_rate_id,
      description: newItem.description,
      quantity: newItem.quantity, unit: newItem.unit, unit_price: newItem.unit_price,
      unit_cost_ht: newItem.unit_cost_ht ?? undefined,
      vat_rate: newItem.vat_rate, position: pos,
      length_m: newItem.length_m,
      width_m: newItem.width_m,
      height_m: newItem.height_m,
      is_internal: newItem.is_internal,
    })
  }

  // ─── Flush pending item saves ─────────────────────────────────────────────

  async function flushPendingItemSaves(qId: string) {
    if (pendingItemKeys.current.size === 0) return
    const saves: Promise<unknown>[] = []
    for (const sec of sectionsRef.current) {
      const sectionId = resolvePersistedSectionId(sec)
      if (sectionId === undefined) continue
      for (const item of sec.items) {
        const key = `${sec._tempId}_${item._tempId}`
        if (!pendingItemKeys.current.has(key)) continue
        if (itemDebounces.current[key]) {
          clearTimeout(itemDebounces.current[key])
          delete itemDebounces.current[key]
        }
        if (!item.id || deletedItemKeys.current.has(key) || deletedItemIds.current.has(item.id)) continue
        saves.push(upsertQuoteItem({
          id: item.id,
          quote_id: qId,
          section_id: sectionId,
          type: item.type,
          material_id: item.material_id,
          labor_rate_id: item.labor_rate_id,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.unit_price,
          unit_cost_ht: item.unit_cost_ht,
          vat_rate: item.vat_rate,
          position: item.position,
          length_m: item.length_m,
          width_m: item.width_m,
          height_m: item.height_m,
          is_internal: item.is_internal,
        }))
      }
    }
    pendingItemKeys.current.clear()
    await Promise.all(saves)
  }

  // ─── Send ─────────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!clientId) {
      setErrorMsg('Veuillez sélectionner un client avant d\'envoyer le devis.')
      return
    }
    setIsSending(true)
    const qId = await ensureQuote()
    if (!qId) { setIsSending(false); return }
    const headerRes = await syncQuoteHeader(qId)
    if (headerRes.error) { setIsSending(false); return }
    await waitForPendingCreatedItemSaves()
    await waitForPendingDeletes()
    await pruneRemovedQuoteItems(qId)
    await flushPendingItemSaves(qId)

    // Ouvrir la modale d'envoi avec sélection optionnelle de contrats du client
    setPendingQuoteId(qId)
    setSendModalError(null)
    setSendModalLoading(true)
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
  }

  async function confirmQuoteSend(selected: Record<string, string[]>) {
    if (!pendingQuoteId) return
    setIsSending(true)
    setSendModalError(null)
    const res = await sendQuote(pendingQuoteId, { attachContractIds: selected.contracts ?? [] })
    setIsSending(false)
    if (res.error) { setSendModalError(res.error); return }
    setSendModalOpen(false)
    setPendingQuoteId(null)
    router.push(returnTo)
  }

  async function handlePreviewPdf() {
    const qId = await ensureQuote()
    if (!qId) return
    const headerRes = await syncQuoteHeader(qId)
    if (headerRes.error) return
    await waitForPendingCreatedItemSaves()
    await waitForPendingDeletes()
    await pruneRemovedQuoteItems(qId)
    await flushPendingItemSaves(qId)
    router.push(`/api/pdf/quote/${qId}`)
  }

  // ─── AI import ───────────────────────────────────────────────────────────

  async function handleAIImport(aiResult: AIQuoteResult) {
    const matchedClient = findBestClientMatch(clients, aiResult.clientName)
    if (matchedClient && matchedClient.id !== clientId) {
      setClientId(matchedClient.id)
      if (quoteIdRef.current) scheduleHeaderSave({ client_id: matchedClient.id })
    }

    const qId = await ensureQuote(matchedClient?.id ?? undefined)
    if (!qId) return

    // Mettre à jour le titre si c'est encore le titre par défaut
    if (aiResult.title && (!title || title === 'Nouveau devis')) {
      setTitle(aiResult.title)
      scheduleHeaderSave({ title: aiResult.title })
    }

    for (const aiSec of aiResult.sections) {
      const pos = sectionsRef.current.length + 1
      const tempId = `sec_ai_${Date.now()}_${Math.random()}`
      deletedSectionTempIds.current.delete(tempId)
      setSectionsSynced(prev => [...prev, { _tempId: tempId, id: null, title: aiSec.title, position: pos, items: [] }])

      const res = await upsertQuoteSection({ quote_id: qId, title: aiSec.title, position: pos })
      const sectionId = res.sectionId
      if (!sectionId) continue
      if (deletedSectionTempIds.current.has(tempId)) {
        await deleteQuoteSectionOrReport(sectionId)
        continue
      }

      setSectionsSynced(prev => prev.map(s => s._tempId === tempId ? { ...s, id: sectionId } : s))

      for (let idx = 0; idx < aiSec.items.length; idx++) {
        const aiItem = aiSec.items[idx]
        const isInternal = isLikelyInternalAIItem(aiSec.title, aiItem)
        const itemTempId = `item_ai_${Date.now()}_${idx}`
        deletedItemKeys.current.delete(`${tempId}_${itemTempId}`)
        const itemPos = idx + 1
        const newItem: LocalItem = {
          _tempId: itemTempId,
          id: null,
          description: aiItem.description,
          quantity: aiItem.quantity,
          unit: aiItem.unit,
          unit_price: aiItem.unit_price,
          vat_rate: aiItem.vat_rate,
          type: 'custom' as const,
          material_id: null,
          labor_rate_id: null,
          position: itemPos,
          length_m: aiItem.length_m ?? null,
          width_m: aiItem.width_m ?? null,
          height_m: aiItem.height_m ?? null,
          dimension_pricing_mode: aiItem.dimension_pricing_mode ?? null,
          dim_quantity: aiItem.dim_quantity ?? 1,
          unit_cost_ht: aiItem.unit_cost_ht ?? null,
          is_estimated: aiItem.is_estimated ?? false,
          is_internal: isInternal,
          transport_km: null, transport_conso: null, transport_prix_l: null,
        }
        setSectionsSynced(prev => prev.map(s =>
          s._tempId === tempId ? { ...s, items: [...s.items, newItem] } : s
        ))
        await createQuoteItemAndFinalize(tempId, itemTempId, qId, sectionId, {
          quote_id: qId,
          section_id: sectionId,
          type: 'custom',
          description: aiItem.description,
          quantity: aiItem.quantity,
          unit: aiItem.unit,
          unit_price: aiItem.unit_price,
          vat_rate: aiItem.vat_rate,
          position: itemPos,
          length_m: aiItem.length_m ?? null,
          width_m: aiItem.width_m ?? null,
          height_m: aiItem.height_m ?? null,
          dim_quantity: aiItem.dim_quantity ?? 1,
          is_internal: isInternal,
        })
      }
    }
  }

  // ─── MO insert ───────────────────────────────────────────────────────────

  async function handleInsertMOItems(items: MOInsertItem[]) {
    if (items.length === 0) return
    const qId = await ensureQuote()
    if (!qId) return

    // Find or create "Main-d'œuvre" section
    const existing = sectionsRef.current.find(s =>
      s.title.toLowerCase().replace(/['-]/g, ' ').includes("main d") ||
      s.title.toLowerCase().includes("main-d")
    )

    let sectionTempId: string
    let sectionId: string | null = null

    if (existing) {
      sectionTempId = existing._tempId
      sectionId = existing.id ?? await ensureSectionSaved(existing._tempId, qId)
    } else {
      const pos = sectionsRef.current.length + 1
      sectionTempId = `sec_mo_${Date.now()}`
      deletedSectionTempIds.current.delete(sectionTempId)
      setSectionsSynced(prev => [...prev, { _tempId: sectionTempId, id: null, title: "Main-d'œuvre", position: pos, items: [] }])
      const res = await upsertQuoteSection({ quote_id: qId, title: "Main-d'œuvre", position: pos })
      sectionId = res.sectionId ?? null
      if (sectionId) {
        if (deletedSectionTempIds.current.has(sectionTempId)) {
          await deleteQuoteSectionOrReport(sectionId)
          return
        }
        setSectionsSynced(prev => prev.map(s => s._tempId === sectionTempId ? { ...s, id: sectionId } : s))
      }
    }

    if (!sectionId) return

    const currentItems = sectionsRef.current.find(s => s._tempId === sectionTempId)?.items ?? []
    let pos = currentItems.length + 1

    for (const item of items) {
      const tempId = `item_mo_${Date.now()}_${Math.random()}`
      deletedItemKeys.current.delete(`${sectionTempId}_${tempId}`)
      const itemPos = pos++
      const newItem: LocalItem = {
        _tempId: tempId, id: null,
        description: item.designation,
        quantity: item.quantity, unit: item.unit, unit_price: item.unit_price,
        unit_cost_ht: null,
        vat_rate: defaultVatRate, type: 'labor',
        material_id: null, labor_rate_id: item.labor_rate_id,
        position: itemPos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1,
        is_estimated: false, is_internal: true,
        transport_km: null, transport_conso: null, transport_prix_l: null,
      }
      setSectionsSynced(prev => prev.map(s =>
        s._tempId === sectionTempId ? { ...s, items: [...s.items, newItem] } : s
      ))
      await createQuoteItemAndFinalize(sectionTempId, tempId, qId, sectionId, {
        quote_id: qId, section_id: sectionId!,
        type: 'labor', labor_rate_id: item.labor_rate_id,
        description: item.designation,
        quantity: item.quantity, unit: item.unit, unit_price: item.unit_price,
        vat_rate: defaultVatRate, position: itemPos, is_internal: true,
      })
    }

    setMoaPanelOpen(false)
  }

  // ─── Prestation select ───────────────────────────────────────────────────

  async function handlePrestationSelect(prestation: PrestationType) {
    setPrestationOpen(false)
    const qId = await ensureQuote()
    if (!qId) return

    const sorted = [...(prestation.items ?? [])].sort((a, b) => a.position - b.position)

    // Prestation sans composition : une ligne globale dans la dernière section
    if (sorted.length === 0) {
      let targetTempId = sectionsRef.current[sectionsRef.current.length - 1]?._tempId
      if (!targetTempId) {
        await handleAddSection()
        targetTempId = sectionsRef.current[sectionsRef.current.length - 1]?._tempId
      }
      if (!targetTempId) return
      const sectionId = await ensureSectionSaved(targetTempId, qId)
      if (!sectionId) return
      const pos = sectionsRef.current.find(s => s._tempId === targetTempId)!.items.length + 1
      const tempId = `item_${Date.now()}`
      deletedItemKeys.current.delete(`${targetTempId}_${tempId}`)
      const newItem: LocalItem = {
        _tempId: tempId, id: null,
        description: prestation.name,
        quantity: 1, unit: prestation.unit,
        unit_price: prestation.base_price_ht,
        unit_cost_ht: null,
        vat_rate: defaultVatRate,
        type: 'custom', material_id: null, labor_rate_id: null,
        position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1,
        is_estimated: false, is_internal: false,
        transport_km: null, transport_conso: null, transport_prix_l: null,
      }
      setSectionsSynced(prev => prev.map(s => s._tempId === targetTempId ? { ...s, items: [...s.items, newItem] } : s))
      await createQuoteItemAndFinalize(targetTempId, tempId, qId, sectionId, { quote_id: qId, section_id: sectionId, type: 'custom', description: newItem.description, quantity: 1, unit: newItem.unit, unit_price: newItem.unit_price, vat_rate: newItem.vat_rate, position: pos })
      return
    }

    // Grouper les items de la prestation par section_title
    const sectionMap = new Map<string, typeof sorted>()
    for (const it of sorted) {
      const key = it.section_title || ''
      if (!sectionMap.has(key)) sectionMap.set(key, [])
      sectionMap.get(key)!.push(it)
    }

    const sectionEntries = [...sectionMap.entries()]
    const basePos = sectionsRef.current.length
    const now = Date.now()

    // 1. Construire toutes les sections + items localement en une seule mise à jour
    //    pour que l'UI s'affiche instantanément sans attendre les awaits.
    type PendingSection = { secTempId: string; secTitle: string; secPos: number; tempIds: string[]; newItems: LocalItem[] }
    const pending: PendingSection[] = []

    for (let sIdx = 0; sIdx < sectionEntries.length; sIdx++) {
      const [sectionTitle, pItems] = sectionEntries[sIdx]
      const secPos = basePos + sIdx + 1
      const secTempId = `sec_${now}_${sIdx}`
      deletedSectionTempIds.current.delete(secTempId)
      const secTitle = sectionTitle || prestation.name || `Section ${secPos}`
      const tempIds = pItems.map((_, i) => `item_${now}_${sIdx}_${i}`)
      for (const tempId of tempIds) deletedItemKeys.current.delete(`${secTempId}_${tempId}`)

      const newItems: LocalItem[] = pItems.map((pItem, i) => {
        const isTransport = pItem.item_type === 'transport'
        const isEquipment = pItem.item_type === 'equipment'
        const prixL = pItem.unit_price_ht > 0 ? pItem.unit_price_ht : DEFAULT_FUEL_PRICE_EUR_PER_L
        const conso = DEFAULT_CONSUMPTION_L_PER_100KM
        const estimatedKm = isTransport && pItem.quantity > 0
          ? Math.round(pItem.quantity / conso * 100)
          : 100
        const liters = isTransport ? computeFuel({ km: estimatedKm, consumption: conso, pricePerLiter: prixL }).liters : pItem.quantity
        const equipmentCostPerUse = pItem.unit_cost_ht > 0 ? pItem.unit_cost_ht : pItem.unit_price_ht
        return {
          _tempId: tempIds[i], id: null,
          description: isTransport ? `Carburant - trajet ${estimatedKm} km` : pItem.designation,
          quantity: isTransport ? liters : isEquipment ? (pItem.quantity || 1) : pItem.quantity,
          unit: isTransport ? 'L' : isEquipment ? 'usage' : pItem.unit,
          unit_price: isTransport ? prixL : isEquipment ? equipmentCostPerUse : pItem.unit_price_ht,
          vat_rate: defaultVatRate,
          type: pItem.item_type === 'material' || pItem.item_type === 'service' ? 'material' : pItem.item_type === 'labor' ? 'labor' : 'custom' as const,
          material_id: pItem.material_id,
          labor_rate_id: pItem.labor_rate_id,
          position: i + 1,
          length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1,
          unit_cost_ht: isEquipment ? equipmentCostPerUse : pItem.unit_cost_ht ?? null,
          is_estimated: false,
          is_internal: pItem.is_internal || isTransport || isEquipment,
          transport_km: isTransport ? estimatedKm : null,
          transport_conso: isTransport ? conso : null,
          transport_prix_l: isTransport ? prixL : null,
        }
      })
      pending.push({ secTempId, secTitle, secPos, tempIds, newItems })
    }

    // Ajouter toutes les sections + items en une seule mise à jour React
    setSectionsSynced(prev => [
      ...prev,
      ...pending.map(p => ({ _tempId: p.secTempId, id: null, title: p.secTitle, position: p.secPos, items: p.newItems })),
    ])

    // 2. Persister en arrière-plan section par section
    for (const { secTempId, secTitle, secPos, tempIds, newItems } of pending) {
      const res = await upsertQuoteSection({ quote_id: qId, title: secTitle, position: secPos })
      const sectionId = res.sectionId
      if (!sectionId) continue
      if (deletedSectionTempIds.current.has(secTempId)) {
        await deleteQuoteSectionOrReport(sectionId)
        continue
      }
      setSectionsSynced(prev => prev.map(s => s._tempId === secTempId ? { ...s, id: sectionId } : s))

      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i]
        await createQuoteItemAndFinalize(secTempId, tempIds[i], qId, sectionId, {
          quote_id: qId, section_id: sectionId,
          type: item.type, description: item.description,
          quantity: item.quantity, unit: item.unit, unit_price: item.unit_price,
          unit_cost_ht: item.unit_cost_ht ?? undefined,
          vat_rate: item.vat_rate, position: item.position,
          material_id: item.material_id ?? undefined,
          labor_rate_id: item.labor_rate_id ?? undefined,
          is_internal: item.is_internal,
        })
      }
    }
  }

  // ─── Catalog filter ───────────────────────────────────────────────────────

  const catalogFiltered = [
    ...materials
      .filter(m => !catalogSearch || m.name.toLowerCase().includes(catalogSearch.toLowerCase()) || (m.reference ?? '').toLowerCase().includes(catalogSearch.toLowerCase()) || (m.category ?? '').toLowerCase().includes(catalogSearch.toLowerCase()))
      .map(m => ({ ...m, _type: 'material' as const })),
    ...laborRates
      .filter(l => !catalogSearch || l.designation.toLowerCase().includes(catalogSearch.toLowerCase()) || (l.category ?? '').toLowerCase().includes(catalogSearch.toLowerCase()))
      .map(l => ({ ...l, _type: 'labor' as const })),
  ]

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <main className="page-container pb-28 space-y-6 md:space-y-8 relative z-10" style={{ maxWidth: '1600px' }}>

      {/* ATELIER IA Panel */}
      {aiPanelOpen && (
        <AtelierAIPanel
          onImport={handleAIImport}
          onClose={() => setAIPanelOpen(false)}
          voiceInputEnabled={modules.voice_input}
        />
      )}

      {/* Labour Estimate Panel */}
      {moaPanelOpen && (
        <LaborEstimatePanel
          laborRates={laborRates}
          quoteTitle={title}
          onInsert={handleInsertMOItems}
          onClose={() => setMoaPanelOpen(false)}
        />
      )}

      {/* Prestation Picker Modal */}
      {prestationOpen && (
        <div className="modal-overlay">
          <div className="modal-panel flex flex-col">
            <button onClick={() => setPrestationOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary">
              <X className="w-6 h-6" />
            </button>
            <div className="flex items-center gap-3 mb-4">
              <Layers className="w-5 h-5 text-accent" />
              <h2 className="text-2xl font-bold text-primary">{catalogContext.labelSet.bundleTemplate.plural}</h2>
            </div>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
              <input
                type="text"
                autoFocus
                placeholder={`Rechercher ${catalogContext.labelSet.bundleTemplate.singular.toLowerCase()}...`}
                value={prestationSearch}
                onChange={e => setPrestationSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
              {prestationTypes.filter(p =>
                p.is_active && (!prestationSearch ||
                  p.name.toLowerCase().includes(prestationSearch.toLowerCase()) ||
                  (p.category ?? '').toLowerCase().includes(prestationSearch.toLowerCase()))
              ).length === 0 ? (
                <div className="py-16 text-center text-secondary">
                  <p className="font-semibold">Aucune prestation trouvée</p>
                  <p className="text-sm mt-1">Créez des {catalogContext.labelSet.bundleTemplate.plural.toLowerCase()} dans le catalogue.</p>
                </div>
              ) : prestationTypes.filter(p =>
                p.is_active && (!prestationSearch ||
                  p.name.toLowerCase().includes(prestationSearch.toLowerCase()) ||
                  (p.category ?? '').toLowerCase().includes(prestationSearch.toLowerCase()))
              ).map(p => (
                <button
                  key={p.id}
                  onClick={() => handlePrestationSelect(p)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-accent/5 border border-transparent hover:border-accent/20 transition-all text-left"
                >
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-accent/10 text-accent">
                    <Layers className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-primary text-sm truncate">{p.name}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {p.category && <p className="text-xs text-secondary">{p.category}</p>}
                      {p.items && p.items.length > 0 && (
                        <span className="text-xs text-accent/70 bg-accent/10 px-1.5 py-0.5 rounded">
                          {p.items.length} ligne{p.items.length > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-primary tabular-nums">{fmt(p.base_price_ht)}</p>
                    <p className="text-xs text-secondary">/{p.unit}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Catalog Modal */}
      {catalogOpen && (
        <div className="modal-overlay">
          <div className="modal-panel flex flex-col">
            <button onClick={() => setCatalogOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary">
              <X className="w-6 h-6" />
            </button>
            <h2 className="text-2xl font-bold text-primary mb-4">{catalogContext.labelSet.catalogTitle}</h2>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-secondary" />
              <input
                type="text"
                autoFocus
                placeholder={`${catalogContext.bundleTemplateUi.catalogMaterialHint.replace('...', '')} · ${catalogContext.bundleTemplateUi.catalogLaborHint}`}
                value={catalogSearch}
                onChange={e => setCatalogSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              {catalogFiltered.length === 0 ? (
                <div className="py-16 text-center text-secondary">
                  <p className="font-semibold">Aucun résultat</p>
                  <p className="text-sm mt-1">Ajoutez des éléments dans le catalogue pour les retrouver ici.</p>
                </div>
              ) : (
                <>
                  {catalogFiltered.filter(e => e._type === 'material').length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 px-1">{catalogContext.labelSet.material.plural}</p>
                      {catalogFiltered.filter(e => e._type === 'material').map(entry => {
                        const mat = entry as CatalogMaterial
                        const dimensionBadge = hasDimensionPricing(mat)
                        return (
                          <button key={entry.id} onClick={() => handleCatalogSelect(mat, 'material')}
                            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-accent/5 border border-transparent hover:border-accent/20 transition-all text-left">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-blue-500/10 text-blue-500">
                              <Package className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-primary text-sm truncate">{mat.name}</p>
                              <div className="flex items-center gap-2">
                                {mat.category && <p className="text-xs text-secondary">{mat.category}</p>}
                                {dimensionBadge && <span className="text-[10px] font-semibold text-accent bg-accent/10 px-1.5 py-0.5 rounded">dimensionnel</span>}
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-bold text-primary tabular-nums">{fmt(getCatalogSaleUnitPrice(mat))}</p>
                              <p className="text-xs text-secondary">/{mat.unit ?? 'u'}</p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                  {catalogFiltered.filter(e => e._type === 'labor').length > 0 && (
                    <div>
                      <p className="text-xs font-bold text-secondary uppercase tracking-wider mb-2 px-1">{catalogContext.labelSet.laborRate.plural}</p>
                      {catalogFiltered.filter(e => e._type === 'labor').map(entry => {
                        const lr = entry as CatalogLaborRate
                        return (
                          <button key={entry.id} onClick={() => handleCatalogSelect(lr, 'labor')}
                            className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-accent/5 border border-transparent hover:border-accent/20 transition-all text-left">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-orange-500/10 text-orange-500">
                              <Wrench className="w-4 h-4" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-primary text-sm truncate">{lr.designation}</p>
                              {lr.category && <p className="text-xs text-secondary">{lr.category}</p>}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-bold text-primary tabular-nums">{fmt(getInternalResourceUnitCost(lr))}</p>
                              <p className="text-xs text-secondary">/{lr.unit ?? 'h'}</p>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Topbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* Titre + statut sauvegarde */}
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => router.replace(returnTo)} className="w-10 h-10 rounded-full bg-surface border border-[var(--elevation-border)] flex items-center justify-center text-secondary hover:text-primary transition-colors dark:bg-white/5 shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-primary truncate">
              {initialQuote?.number ? `Devis ${initialQuote.number}` : quoteId ? 'Édition du devis' : 'Nouveau devis'}
            </h1>
            {saveStatus === 'saving' && (
              <p className="text-xs text-secondary flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin shrink-0" />Sauvegarde...
              </p>
            )}
            {saveStatus === 'saved' && (
              <p className="text-xs text-accent-green flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3 shrink-0" />Sauvegardé
              </p>
            )}
          </div>
        </div>
        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {isPending && <Loader2 className="w-4 h-4 text-secondary animate-spin" />}
          {modules.quote_ai && (
            <button
              onClick={() => setMoaPanelOpen(true)}
              className="btn-secondary flex items-center gap-2 whitespace-nowrap text-sm px-3 py-2"
            >
              <Wrench className="w-4 h-4" />
              <span className="hidden lg:inline">Estimer les ressources internes</span>
              <span className="lg:hidden">Ressources</span>
            </button>
          )}
          {modules.quote_ai && (
            <button
              onClick={() => setAIPanelOpen(true)}
              className="btn-primary flex items-center gap-2 whitespace-nowrap text-sm px-3 py-2"
            >
              <Bot className="w-4 h-4" />
              {AI_NAME}
            </button>
          )}
          {quoteId ? (
            <button
              onClick={handlePreviewPdf}
              className="px-3 py-2 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center gap-2 hover:bg-base hover:text-accent transition-all whitespace-nowrap text-sm"
            >
              <FileDown className="w-4 h-4" /><span className="hidden sm:inline">Aperçu PDF</span>
            </button>
          ) : (
            <span className="px-3 py-2 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-secondary font-semibold flex items-center gap-2 opacity-40 cursor-not-allowed whitespace-nowrap text-sm" title="Ajoutez une ligne pour générer le PDF">
              <FileDown className="w-4 h-4" /><span className="hidden sm:inline">Aperçu PDF</span>
            </span>
          )}
          <ActionButton
            onClick={handleSend}
            loading={isSending}
            disabled={isPending}
            className="btn-primary flex items-center gap-2 whitespace-nowrap text-sm px-3 py-2"
          >
            <Send className="w-4 h-4" />
            <span className="hidden sm:inline">Envoyer</span>
          </ActionButton>
        </div>
      </div>

      {errorMsg && <p className="text-sm text-red-400 px-2">{errorMsg}</p>}

      {/* Main layout */}
      <div className="grid grid-cols-1 md:grid-cols-5 lg:grid-cols-12 gap-6 lg:gap-8">

        {/* Left panel — order-2 on mobile (Infos + Totaux après les sections) */}
        <div className="md:col-span-2 lg:col-span-4 space-y-6 order-2 md:order-1">
          <div className="rounded-3xl card p-5 sm:p-8 space-y-5">
            <h3 className="text-lg font-bold text-primary border-b border-[var(--elevation-border)] pb-3">Informations</h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-secondary">Client</label>
                  <button
                    type="button"
                    onClick={() => { setNewClientOpen(true); setNewClientError(null); setNewClientForm({ company_name: '', contact_name: '', first_name: '', last_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' }); setNewClientType('company') }}
                    className="flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-semibold transition-colors"
                  >
                    <Plus className="w-3 h-3" />Nouveau client
                  </button>
                </div>
                <select
                  value={clientId}
                  onChange={e => { setClientId(e.target.value); scheduleHeaderSave({ client_id: e.target.value || null }) }}
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none"
                >
                  <option value="">Sans client</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{clientDisplayName(c)}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-secondary">Titre du projet</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => { setTitle(e.target.value); scheduleHeaderSave({ title: e.target.value }) }}
                  placeholder="Ex: Rénovation toiture"
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-secondary">Validité (jours)</label>
                <NumericInput
                  value={validityDays}
                  min={1}
                  decimals={0}
                  onChange={v => { const n = v ?? 1; setValidityDays(n); scheduleHeaderSave({ validity_days: n }) }}
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums"
                />
              </div>
              {allQuotes.filter(q => q.client_id === clientId && q.id !== quoteId).length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-secondary">Devis de référence (avenant)</label>
                  <select
                    value={parentQuoteId ?? ''}
                    onChange={e => {
                      const val = e.target.value || null
                      setParentQuoteId(val)
                      scheduleHeaderSave({ parent_quote_id: val })
                    }}
                    className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 appearance-none"
                  >
                    <option value="">Aucun (devis original)</option>
                    {allQuotes
                      .filter(q => q.client_id === clientId && q.id !== quoteId)
                      .map(q => (
                        <option key={q.id} value={q.id}>
                          {q.number ? `${q.number} — ` : ''}{q.title ?? 'Sans titre'}
                        </option>
                      ))}
                  </select>
                  {parentQuoteId && (
                    <p className="text-xs text-accent">
                      Ce devis est un avenant/modificatif. Les situations de travaux sont calculées sur le total de ce devis.
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-3xl card p-5 sm:p-8 space-y-4 md:sticky top-24">
            <h3 className="text-lg font-bold text-primary mb-2">Récapitulatif</h3>
            <div className="flex justify-between text-secondary">
              <span>Total HT</span><span className="tabular-nums">{fmt(totalHt)}</span>
            </div>
            <div className="flex justify-between text-secondary">
              <span>TVA</span><span className="tabular-nums">{fmt(totalTva)}</span>
            </div>
            <div className="h-px bg-[var(--elevation-border)]" />
            <div className="flex justify-between items-end">
              <span className="font-semibold text-secondary">TOTAL TTC</span>
              <span className="text-3xl font-bold text-primary tabular-nums">{fmt(totalTtc)}</span>
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
                      onClick={() => { setShowAid(false); setAidLabel(''); setAidAmount(null); scheduleHeaderSave({ aid_label: null, aid_amount: null }) }}
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
                      onClick={() => { setAidLabel(preset); scheduleHeaderSave({ aid_label: preset, aid_amount: aidAmount }) }}
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
                  onChange={e => { setAidLabel(e.target.value); scheduleHeaderSave({ aid_label: e.target.value || null, aid_amount: aidAmount }) }}
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
                      if (v == null) { setAidAmount(null); scheduleHeaderSave({ aid_label: aidLabel || null, aid_amount: null }); return }
                      const val = aidMode === '%'
                        ? Math.round(Math.min(100, Math.max(0, v)) * totalTtc) / 100
                        : Math.min(totalTtc, Math.max(0, v))
                      setAidAmount(val)
                      scheduleHeaderSave({ aid_label: aidLabel || null, aid_amount: val })
                    }}
                    className="flex-1 px-3 py-2 text-sm bg-base dark:bg-white/5 border border-[var(--elevation-border)] focus:border-accent rounded-xl text-primary outline-none transition-all tabular-nums text-right"
                  />
                  <span className="text-sm text-secondary w-4">{aidMode === '%' ? '%' : (initialQuote?.currency === 'USD' ? '$' : '€')}</span>
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

            {/* Marge interne - visible uniquement si lignes internes */}
            {hasInternalItems && (
              <div className="pt-2 mt-2 border-t border-[var(--elevation-border)] space-y-2">
                <p className="text-xs font-bold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                  <EyeOff className="w-3 h-3" />Récap marge interne
                </p>
                <div className="flex justify-between text-sm text-secondary">
                  <span>Total client HT</span>
                  <span className="tabular-nums">{fmt(totalHt)}</span>
                </div>
                <div className="flex justify-between text-sm text-secondary">
                  <span>Coût interne</span>
                  <span className="tabular-nums text-red-400">−{fmt(totalInternalHt)}</span>
                </div>
                <div className="h-px bg-[var(--elevation-border)]" />
                <div className="flex justify-between text-sm font-bold">
                  <span className="text-primary">Marge brute</span>
                  <span className={`tabular-nums ${margeHt >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                    {fmt(margeHt)}
                  </span>
                </div>
                <div className="flex justify-between text-xs text-secondary">
                  <span>Taux de marge</span>
                  <span className={`tabular-nums font-semibold ${margePct >= 0 ? 'text-emerald-500' : 'text-red-400'}`}>
                    {margePct.toFixed(1)} %
                  </span>
                </div>
                <p className="text-xs text-amber-500 flex items-center gap-1.5 pt-1">
                  <EyeOff className="w-3 h-3 shrink-0" />
                  Les lignes orange ne figurent pas sur le PDF client.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right: sections — order-1 on mobile (sections en premier) */}
        <div className="md:col-span-3 lg:col-span-8 space-y-6 order-1 md:order-2">

          {/* Demande du client (formulaire public) */}
          {clientRequestDescription && (
            <div className="card rounded-3xl border-accent/30 p-8">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-accent" />
                  <span className="text-sm font-semibold text-primary">Demande du client</span>
                  <span className="text-xs text-secondary bg-accent/10 rounded-full px-2 py-0.5">Formulaire en ligne</span>
                </div>
                <button
                  onClick={() => {
                    const next = !clientRequestVisibleOnPdf
                    setClientRequestVisibleOnPdf(next)
                    if (quoteId) scheduleHeaderSave({ client_request_visible_on_pdf: next })
                  }}
                  className={`flex items-center gap-1.5 text-xs rounded-lg px-3 py-1.5 border transition-colors ${clientRequestVisibleOnPdf ? 'border-accent/40 text-accent bg-accent/5 hover:bg-accent/10' : 'border-[var(--elevation-border)] text-secondary hover:text-primary hover:bg-base/50'}`}
                  title={clientRequestVisibleOnPdf ? 'Affiché sur le PDF client - cliquer pour masquer' : 'Masqué sur le PDF client - cliquer pour afficher'}
                >
                  {clientRequestVisibleOnPdf ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                  {clientRequestVisibleOnPdf ? 'Visible sur le PDF' : 'Masqué sur le PDF'}
                </button>
              </div>
              <p className="text-sm text-primary whitespace-pre-wrap leading-relaxed bg-base/40 rounded-xl px-5 py-4 border border-[var(--elevation-border)]">
                {clientRequestDescription}
              </p>
            </div>
          )}

          {/* Intro text */}
          <div className="rounded-3xl card p-5 sm:p-8">
            <label className="text-sm font-semibold text-secondary block mb-3">Texte d'introduction</label>
            <textarea
              value={notesClient}
              onChange={e => { introTouchedRef.current = true; setNotesClient(e.target.value); scheduleHeaderSave({ notes_client: e.target.value }) }}
              rows={4}
              className="w-full p-4 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 resize-y"
            />
          </div>

          {/* Sections */}
          {sections.length === 0 && (
            <div className="rounded-3xl card p-12 text-center space-y-5">
              <p className="text-secondary text-sm">Commencez par ajouter une section ou choisissez une prestation type.</p>
              <div className="flex items-center justify-center gap-3">
                <button
                  onClick={handleAddSection}
                  disabled={isPending}
                  className="btn-primary flex items-center gap-2 text-sm"
                >
                  <Plus className="w-4 h-4" />Ajouter une section
                </button>
                <button
                  onClick={() => { setPrestationSearch(''); setPrestationOpen(true) }}
                  disabled={isPending}
                  className="btn-secondary flex items-center gap-2 text-sm"
                >
                  <Layers className="w-4 h-4" />Prestation type
                </button>
              </div>
            </div>
          )}
          {sections.map(sec => (
            <div key={sec._tempId} className="rounded-3xl card p-4 sm:p-8 space-y-5">
              <div className="flex items-center justify-between border-b border-[var(--elevation-border)] pb-4">
                <input
                  type="text"
                  value={sec.title}
                  onChange={e => handleSectionTitleChange(sec._tempId, e.target.value)}
                  className="text-xl font-bold text-primary bg-transparent border-none focus:outline-none w-full"
                />
                <button
                  onClick={() => handleRemoveSection(sec._tempId)}
                  className="p-2 text-secondary hover:text-red-500 rounded-full hover:bg-red-500/10 flex-shrink-0 ml-4 transition-colors"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-2">
                {sec.items.length === 0 && (
                  <p className="py-6 text-center text-sm text-secondary opacity-60">
                    Aucune ligne. Ajoutez une saisie libre ou choisissez dans le catalogue.
                  </p>
                )}
                {sec.items.map(item => {
                  const rowKey = `${sec._tempId}_${item._tempId}`
                  const isExpanded = expandedItems.has(rowKey)
                  const dimensionMode = getItemDimensionMode(item)
                  const isDimensioned = dimensionMode !== 'none'
                  const canUseDimensions = isDimensioned || item.type === 'custom'
                  const dimensionUnit = getModeUnit(dimensionMode, item.unit)
                  const sourceMaterial = item.material_id ? materials.find(material => material.id === item.material_id) : null
	                  const lengthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'length', dimensionMode)
	                  const widthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'width', dimensionMode)
	                  const heightMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'height', dimensionMode)
	                  const isEquipment = isEquipmentLine(item)
                    const equipmentMeta = isEquipment ? parseEquipmentAmortization(item.description, item.unit_price) : null
	                  return (
	                    <div key={item._tempId} className={`rounded-xl border transition-all ${isEquipment ? 'border-purple-400/40 bg-purple-500/5' : item.is_internal ? 'border-amber-400/40 bg-amber-500/5' : item.is_estimated ? 'border-amber-400/40 bg-amber-500/5' : 'border-[var(--elevation-border)] bg-base/20 hover:bg-base/40'}`}>

                      {/* ── Désignation + actions ── */}
                      <div className="flex items-start gap-2 px-3 pt-3 pb-2">
                        {(item.is_internal || isEquipment) && (
                          <span className={`mt-1 flex-shrink-0 inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider border rounded px-1.5 py-0.5 leading-none ${isEquipment ? 'text-purple-700 dark:text-purple-300 bg-purple-500/15 border-purple-400/40' : 'text-amber-700 bg-amber-500/15 border-amber-400/40'}`}>
                            {isEquipment && <Package className="w-2.5 h-2.5" />}
                            {isEquipment ? 'Équip.' : 'Coût'}
                          </span>
                        )}
                        <div className="flex-1 flex flex-col gap-1">
                          {isEquipment && equipmentMeta ? (
                            <textarea
                              value={equipmentMeta.name}
                              onChange={e => handleEquipmentAmortizationChange(sec._tempId, item._tempId, 'name', e.target.value)}
                              placeholder="Nom de l'équipement..."
                              rows={Math.min(3, Math.max(1, equipmentMeta.name.split('\n').length))}
                              className="w-full p-2 bg-base/40 border-2 border-purple-300/50 dark:border-purple-500/30 rounded-lg focus:border-purple-400 focus:bg-base/60 outline-none text-primary text-sm font-semibold leading-6 transition-colors resize-none"
                            />
                          ) : (() => {
                            const descParts = item.description.split(/\n\n?Comprend\s*:\s*/i)
                            const titleVal = descParts[0] ?? ''
                            const detailVal = descParts.length > 1 ? descParts.slice(1).join('\nComprend : ') : ''
                            const setTitle = (t: string) => {
                              const next = detailVal ? `${t}\n\nComprend :\n${detailVal}` : t
                              handleItemChange(sec._tempId, item._tempId, 'description', next)
                            }
                            const setDetail = (d: string) => {
                              const next = d.trim() ? `${titleVal}\n\nComprend :\n${d}` : titleVal
                              handleItemChange(sec._tempId, item._tempId, 'description', next)
                            }
                            return (
                              <>
                                <textarea
                                  value={titleVal}
                                  onChange={e => setTitle(e.target.value)}
                                  placeholder="Désignation..."
                                  rows={Math.min(4, Math.max(1, titleVal.split('\n').length))}
                                  className="w-full p-2 bg-base/40 border-2 border-[var(--elevation-border)] rounded-lg focus:border-accent focus:bg-base/60 outline-none text-primary text-sm leading-6 transition-colors resize-none"
                                />
                                <textarea
                                  value={detailVal}
                                  onChange={e => setDetail(e.target.value)}
                                  placeholder="Détail inclus... (optionnel)"
                                  rows={detailVal ? Math.min(6, Math.max(2, detailVal.split('\n').length)) : 1}
                                  className="w-full px-2 py-1.5 bg-base/20 border-2 border-dashed border-[var(--elevation-border)] rounded-lg outline-none text-secondary text-xs leading-5 transition-colors resize-none focus:border-accent focus:bg-base/50 focus:text-primary"
                                />
                              </>
                            )
                          })()}
                        </div>
                        <div className="flex flex-col gap-1 pt-0.5">
                          {item.is_estimated && <span title="Prix estimé par l'IA" className="p-1.5 text-amber-500"><Sparkles className="w-3.5 h-3.5" /></span>}
                          <button onClick={() => { if (!isEquipment) handleItemChange(sec._tempId, item._tempId, 'is_internal', !item.is_internal) }}
                            disabled={isEquipment}
                            title={isEquipment ? 'Équipement toujours interne' : item.is_internal ? 'Ligne interne (cliquer pour rendre visible)' : 'Rendre interne'}
                            className={`p-1.5 rounded-full transition-all ${isEquipment ? 'text-purple-600 bg-purple-500/10 cursor-not-allowed' : item.is_internal ? 'text-amber-500 bg-amber-500/10' : 'text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/15'}`}>
                            {item.is_internal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          {canUseDimensions && (
                            <button onClick={() => toggleItemExpand(rowKey)} title="Mode / Dimensions"
                              className={`p-1.5 rounded-full transition-all ${isExpanded ? 'text-accent bg-accent/10' : 'text-secondary hover:text-accent hover:bg-accent/10'}`}>
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          {item.type === 'custom' && !item.material_id && !item.labor_rate_id && !isEquipment && (
                            <button onClick={() => openSaveCatalog(item)} title="Enregistrer dans le catalogue"
                              className="p-1.5 rounded-full text-secondary hover:text-accent hover:bg-accent/10 transition-all">
                              <BookmarkPlus className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <button onClick={() => handleRemoveItem(sec._tempId, item._tempId)}
                            className="p-1.5 text-secondary hover:text-red-500 rounded-full hover:bg-red-500/10 transition-all">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* ── Champs numériques avec labels ── */}
                      <div className="px-3 pb-3">
                        {/* Desktop : rangée horizontale avec label au-dessus de chaque champ */}
                        <div className="hidden sm:flex items-end gap-3 flex-wrap">
                          <div className="flex flex-col gap-1 w-20">
                            <span className="text-[10px] font-semibold text-secondary uppercase tracking-wider">Qté</span>
                            {isEquipment ? (
                              <div className="h-9 flex items-center px-2 bg-purple-500/8 border border-purple-400/30 rounded-lg">
                                <span className="text-sm font-bold tabular-nums text-purple-700 dark:text-purple-300 w-full text-right">{item.quantity}</span>
                              </div>
                            ) : isDimensioned ? (
                              <div className="h-9 flex items-center px-2 bg-accent/8 border border-accent/30 rounded-lg">
                                <span className="text-sm font-bold tabular-nums text-accent w-full text-right">{item.quantity}</span>
                              </div>
                            ) : (
                              <NumericInput value={item.quantity} min={0}
                                onChange={v => handleItemChange(sec._tempId, item._tempId, 'quantity', v ?? 0)}
                                className="w-full h-9 px-2 bg-base border border-[var(--elevation-border)] rounded-lg focus:border-accent outline-none text-primary tabular-nums text-right text-sm transition-colors" />
                            )}
                          </div>
                          <div className="flex flex-col gap-1 w-24">
                            <span className="text-[10px] font-semibold text-secondary uppercase tracking-wider">Unité</span>
                            {isEquipment ? (
                              <div className="h-9 flex items-center px-2 bg-purple-500/8 border border-purple-400/30 rounded-lg">
                                <span className="text-sm font-semibold text-purple-700 dark:text-purple-300">usage</span>
                              </div>
                            ) : (
                              <UnitSelect value={item.unit} onChange={v => handleItemChange(sec._tempId, item._tempId, 'unit', v)}
                                allowedUnits={catalogContext.unitSet} compact className="w-full h-9" />
                            )}
                          </div>
                          <div className="flex flex-col gap-1 w-28">
                            <span className="text-[10px] font-semibold text-secondary uppercase tracking-wider">Prix unit. HT</span>
                            {isEquipment ? (
                              <div className="h-9 flex items-center px-2 bg-purple-500/8 border border-purple-400/30 rounded-lg">
                                <span className="font-bold text-purple-700 dark:text-purple-300 tabular-nums text-sm w-full text-right">{fmt(item.unit_price)}</span>
                              </div>
                            ) : (
                              <NumericInput value={item.unit_price} min={0} decimals={2}
                                onChange={v => handleItemChange(sec._tempId, item._tempId, 'unit_price', v ?? 0)}
                                className={`w-full h-9 px-2 border rounded-lg outline-none tabular-nums text-right text-sm transition-colors ${item.is_estimated ? 'bg-amber-500/5 border-amber-400/40 text-amber-600 dark:text-amber-400 focus:border-amber-400' : 'bg-base border-[var(--elevation-border)] text-primary focus:border-accent'}`}
                                title={item.is_estimated ? "Prix estimé par l'IA" : undefined} />
                            )}
                            {!item.material_id && !item.labor_rate_id && !isEquipment ? (
                              <NumericInput
                                value={item.unit_cost_ht ?? undefined}
                                min={0} decimals={2}
                                placeholder="coût interne"
                                onChange={v => handleItemChange(sec._tempId, item._tempId, 'unit_cost_ht', v ?? null)}
                                className="w-full h-7 px-2 bg-transparent border border-dashed border-[var(--elevation-border)] rounded-md outline-none tabular-nums text-right text-[11px] text-secondary/80 focus:border-accent focus:text-primary transition-colors"
                              />
                            ) : item.unit_cost_ht != null && item.unit_price > 0 ? (
                              <span className="text-[10px] tabular-nums text-right text-secondary/70">
                                coût {fmt(item.unit_cost_ht)}
                              </span>
                            ) : null}
                          </div>
                          <div className="flex flex-col gap-1 w-20">
                            <span className="text-[10px] font-semibold text-secondary uppercase tracking-wider">TVA</span>
                            {isEquipment ? (
                              <div className="h-9 flex items-center px-2 bg-purple-500/8 border border-purple-400/30 rounded-lg">
                                <span className="text-xs font-semibold text-purple-700 dark:text-purple-300 w-full text-right">Interne</span>
                              </div>
                            ) : (
                              <select value={item.vat_rate} onChange={e => handleItemChange(sec._tempId, item._tempId, 'vat_rate', Number(e.target.value))}
                                className="w-full h-9 px-2 bg-base border border-[var(--elevation-border)] rounded-lg focus:border-accent outline-none text-primary text-sm transition-colors appearance-none">
                                {LEGAL_VAT_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
                              </select>
                            )}
                          </div>
                          <div className="flex flex-col gap-1 flex-1 min-w-24">
                            <span className="text-[10px] font-semibold text-secondary uppercase tracking-wider">Total HT</span>
                            <div className="h-9 flex items-center px-2 bg-base/60 border border-[var(--elevation-border)]/60 rounded-lg">
                              <span className={`font-bold tabular-nums text-sm w-full text-right ${isEquipment ? 'text-purple-700 dark:text-purple-300' : 'text-primary'}`}>{fmt(item.quantity * item.unit_price)}</span>
                            </div>
                            {item.unit_cost_ht != null && item.unit_price > 0 && (() => {
                              const totalCost = item.quantity * item.unit_cost_ht
                              const totalSale = item.quantity * item.unit_price
                              const margin = totalSale - totalCost
                              const marginPct = Math.round((margin / totalSale) * 100)
                              return (
                                <span className={`text-[10px] tabular-nums text-right font-semibold ${margin >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                  {marginPct} % · {fmt(margin)}
                                </span>
                              )
                            })()}
                          </div>
                        </div>

                        {/* Mobile: grille 2×2 + total */}
                        <div className="sm:hidden space-y-2">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="space-y-0.5">
                              <p className="text-[10px] font-semibold text-secondary uppercase tracking-wider">Qté</p>
                              {isEquipment ? (
                                <p className="p-2 text-left text-sm font-bold tabular-nums text-purple-700 dark:text-purple-300 bg-purple-500/8 border border-purple-400/30 rounded-lg">{item.quantity}</p>
                              ) : isDimensioned ? (
                                <p className="p-2 text-left text-sm font-bold tabular-nums text-accent">{item.quantity}</p>
                              ) : (
                                <NumericInput value={item.quantity} min={0}
                                  onChange={v => handleItemChange(sec._tempId, item._tempId, 'quantity', v ?? 0)}
                                  className="w-full p-2 bg-base/50 border border-[var(--elevation-border)] rounded-lg focus:border-accent outline-none text-primary tabular-nums text-sm" />
                              )}
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[10px] font-semibold text-secondary uppercase tracking-wider">Unité</p>
                              {isEquipment ? (
                                <p className="p-2 text-sm font-semibold text-purple-700 dark:text-purple-300 bg-purple-500/8 border border-purple-400/30 rounded-lg">usage</p>
                              ) : (
                                <UnitSelect value={item.unit} onChange={v => handleItemChange(sec._tempId, item._tempId, 'unit', v)}
                                  allowedUnits={catalogContext.unitSet} compact className="w-full" />
                              )}
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[10px] font-semibold text-secondary uppercase tracking-wider">PU HT</p>
                              {isEquipment ? (
                                <p className="p-2 text-sm font-bold tabular-nums text-purple-700 dark:text-purple-300 text-right bg-purple-500/8 border border-purple-400/30 rounded-lg">{fmt(item.unit_price)}</p>
                              ) : (
                                <NumericInput value={item.unit_price} min={0} decimals={2}
                                  onChange={v => handleItemChange(sec._tempId, item._tempId, 'unit_price', v ?? 0)}
                                  className={`w-full p-2 border rounded-lg outline-none tabular-nums text-sm ${item.is_estimated ? 'bg-amber-500/5 border-amber-400/40 text-amber-600 dark:text-amber-400' : 'bg-base/50 border-[var(--elevation-border)] text-primary focus:border-accent'}`} />
                              )}
                              {!item.material_id && !item.labor_rate_id && !isEquipment ? (
                                <NumericInput
                                  value={item.unit_cost_ht ?? undefined}
                                  min={0} decimals={2}
                                  placeholder="coût interne"
                                  onChange={v => handleItemChange(sec._tempId, item._tempId, 'unit_cost_ht', v ?? null)}
                                  className="w-full px-2 py-1 bg-transparent border border-dashed border-[var(--elevation-border)] rounded-md outline-none tabular-nums text-right text-[11px] text-secondary/80 focus:border-accent focus:text-primary transition-colors"
                                />
                              ) : item.unit_cost_ht != null && item.unit_price > 0 ? (
                                <p className="text-[10px] tabular-nums text-right text-secondary/70">
                                  coût {fmt(item.unit_cost_ht)}
                                </p>
                              ) : null}
                            </div>
                            <div className="space-y-0.5">
                              <p className="text-[10px] font-semibold text-secondary uppercase tracking-wider">TVA</p>
                              {isEquipment ? (
                                <p className="p-2 text-sm font-semibold text-purple-700 dark:text-purple-300 text-right bg-purple-500/8 border border-purple-400/30 rounded-lg">Interne</p>
                              ) : (
                                <select value={item.vat_rate} onChange={e => handleItemChange(sec._tempId, item._tempId, 'vat_rate', Number(e.target.value))}
                                  className="w-full p-2 bg-base/50 border border-[var(--elevation-border)] rounded-lg focus:border-accent outline-none text-primary text-sm appearance-none">
                                  {LEGAL_VAT_RATES.map(rate => <option key={rate} value={rate}>{rate}%</option>)}
                                </select>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center justify-between pt-1 border-t border-[var(--elevation-border)]/50">
                            <span className={`font-bold tabular-nums text-sm ${isEquipment ? 'text-purple-700 dark:text-purple-300' : 'text-primary'}`}>{fmt(item.quantity * item.unit_price)}</span>
                            {isEquipment ? (
                              <span className="text-xs font-semibold px-2.5 py-1 rounded-full text-purple-700 dark:text-purple-300 bg-purple-500/10">Interne</span>
                            ) : (
                              <button onClick={() => handleItemChange(sec._tempId, item._tempId, 'is_internal', !item.is_internal)}
                                className={`text-xs font-semibold px-2.5 py-1 rounded-full transition-all ${item.is_internal ? 'text-amber-600 bg-amber-500/10' : 'text-emerald-600 bg-emerald-500/10'}`}>
                                {item.is_internal ? 'Interne' : 'Visible'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* ── Panneaux internes transport / équipement ── */}
	                      {item.transport_prix_l !== null && (
                        <div className="px-3 pb-3 pt-2 border-t border-amber-200/60 dark:border-amber-500/20 space-y-2 bg-amber-500/3 rounded-b-xl">
                          <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                            <Truck className="w-3 h-3" />Transport interne
                          </p>
                          <div className="grid grid-cols-1 sm:flex sm:flex-wrap items-end gap-3">
                            <label className="flex flex-col gap-1 text-xs text-secondary">
                              Distance aller-retour (km)
                              <NumericInput min={1} value={item.transport_km}
                                onChange={v => handleTransportMetaChange(sec._tempId, item._tempId, 'transport_km', v)}
                                className="w-full sm:w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400" />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-secondary">
                              Conso (L/100 km)
                              <NumericInput min={1} decimals={2} value={item.transport_conso ?? DEFAULT_CONSUMPTION_L_PER_100KM}
                                onChange={v => handleTransportMetaChange(sec._tempId, item._tempId, 'transport_conso', v ?? DEFAULT_CONSUMPTION_L_PER_100KM)}
                                className="w-full sm:w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400" />
                            </label>
                            <label className="flex flex-col gap-1 text-xs text-secondary">
                              Prix carburant (€/L)
                              <NumericInput min={0} decimals={3} value={item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L}
                                onChange={v => handleTransportMetaChange(sec._tempId, item._tempId, 'transport_prix_l', v ?? DEFAULT_FUEL_PRICE_EUR_PER_L)}
                                className="w-full sm:w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400" />
                            </label>
                            <span className="font-bold text-amber-600 dark:text-amber-400 text-sm tabular-nums">
                              {item.quantity.toFixed(2)} L &mdash; {fmt(item.quantity * (item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L))}
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
                                    onChange={v => handleEquipmentAmortizationChange(sec._tempId, item._tempId, 'purchasePrice', v)}
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
                                  onChange={v => handleEquipmentAmortizationChange(sec._tempId, item._tempId, 'lifetimeUses', v)}
                                  className="w-full h-9 px-2 bg-base border border-purple-300/50 dark:border-purple-500/30 rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-purple-400"
                                />
                              </label>
                              <div className="flex flex-col gap-1 text-xs text-secondary sm:col-span-1">
                                Coût final / usage
                                <div className="h-9 flex items-center justify-end rounded-lg border border-purple-300/50 dark:border-purple-500/30 bg-purple-500/10 px-2">
                                  <span className="font-bold text-purple-700 dark:text-purple-300 tabular-nums text-sm">{fmt(item.unit_price)}</span>
                                </div>
                              </div>
                              <label className="flex flex-col gap-1 text-xs text-secondary sm:col-span-1">
                                Usages comptés
                                <NumericInput
                                  value={item.quantity}
                                  min={0}
                                  decimals={2}
                                  onChange={v => handleItemChange(sec._tempId, item._tempId, 'quantity', v ?? 0)}
                                  className="w-full h-9 px-2 bg-base border border-purple-300/50 dark:border-purple-500/30 rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-purple-400"
                                />
                              </label>
                              <div className="flex flex-col gap-1 text-xs text-secondary sm:col-span-1">
                                Coût interne total
                                <div className="h-9 flex items-center justify-end rounded-lg border border-purple-300/50 dark:border-purple-500/30 bg-base px-2">
                                  <span className="font-bold text-purple-700 dark:text-purple-300 tabular-nums text-sm">{fmt(item.quantity * item.unit_price)}</span>
                                </div>
                              </div>
                            </div>
                            <p className="text-[11px] text-secondary">
                              Calcul : prix d&apos;achat ÷ usages sur la vie = coût amorti par usage, puis multiplié par les usages comptés sur cette ligne.
                            </p>
                          </div>
                        )}

                      {/* ── Panneau mode dim + dimensions ── */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-2 border-t border-[var(--elevation-border)]/60 space-y-4 bg-base/20 rounded-b-xl">
                          {/* Sélecteur mode — lignes libres seulement */}
                          {item.type === 'custom' && (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                                <LayoutGrid className="w-3 h-3" />Tarification dimensionnelle
                              </p>
                              <div className="flex gap-2 flex-wrap">
                                {(['none', 'linear', 'area', 'volume'] as const).map(mode => (
                                  <button key={mode}
                                    onClick={() => {
                                      const newMode = mode === item.dimension_pricing_mode ? 'none' : mode
                                      handleItemChange(sec._tempId, item._tempId, 'dimension_pricing_mode', newMode)
                                      if (newMode !== 'none') handleItemChange(sec._tempId, item._tempId, 'unit', getModeUnit(newMode, item.unit))
                                    }}
                                    className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-all ${item.dimension_pricing_mode === mode || (mode === 'none' && !item.dimension_pricing_mode) ? 'bg-accent text-black border-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary hover:border-accent/40'}`}>
                                    {mode === 'none' ? 'Libre' : mode === 'linear' ? 'Linéaire (ml)' : mode === 'area' ? 'Surface (m²)' : 'Volume (m³)'}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Champs dimensions */}
                          {isDimensioned && (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-secondary uppercase tracking-wider flex items-center gap-1.5">
                                <Ruler className="w-3 h-3" />Dimensions &rarr; calcul auto de la quantité
                              </p>
                              <div className="grid grid-cols-1 sm:flex sm:flex-wrap sm:items-end gap-3">
                                <label className="flex flex-col gap-1 text-xs text-secondary">
                                  {lengthMeta.label}
                                  <div className="flex items-center gap-1.5">
                                    <NumericInput value={metersToDisplayUnit(item.length_m, lengthMeta.unit)} min={0} decimals={3}
                                      onChange={v => handleDimChange(sec._tempId, item._tempId, 'length_m', v == null ? null : displayUnitToMeters(v, lengthMeta.unit))}
                                      className="w-24 p-2 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent" />
                                    <span className="text-xs text-secondary w-6">{lengthMeta.unit}</span>
                                  </div>
                                </label>
                                {(dimensionMode === 'area' || dimensionMode === 'volume' || widthMeta.enabled) && (
                                  <label className="flex flex-col gap-1 text-xs text-secondary">
                                    {widthMeta.label}
                                    <div className="flex items-center gap-1.5">
                                      <NumericInput value={metersToDisplayUnit(item.width_m, widthMeta.unit)} min={0} decimals={3}
                                        onChange={v => handleDimChange(sec._tempId, item._tempId, 'width_m', v == null ? null : displayUnitToMeters(v, widthMeta.unit))}
                                        className="w-24 p-2 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent" />
                                      <span className="text-xs text-secondary w-6">{widthMeta.unit}</span>
                                    </div>
                                  </label>
                                )}
                                {(dimensionMode === 'volume' || heightMeta.enabled) && (
                                  <label className="flex flex-col gap-1 text-xs text-secondary">
                                    {heightMeta.label}
                                    <div className="flex items-center gap-1.5">
                                      <NumericInput value={metersToDisplayUnit(item.height_m, heightMeta.unit)} min={0} decimals={3}
                                        onChange={v => handleDimChange(sec._tempId, item._tempId, 'height_m', v == null ? null : displayUnitToMeters(v, heightMeta.unit))}
                                        className="w-24 p-2 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent" />
                                      <span className="text-xs text-secondary w-6">{heightMeta.unit}</span>
                                    </div>
                                  </label>
                                )}
                                <label className="flex flex-col gap-1 text-xs text-secondary">
                                  Nb d'unités
                                  <div className="flex items-center gap-1.5">
                                    <NumericInput value={item.dim_quantity} min={0.001} decimals={3}
                                      onChange={v => handleDimQuantityChange(sec._tempId, item._tempId, v)}
                                      className="w-16 p-2 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent" />
                                  </div>
                                </label>
                                <div className="flex flex-col gap-1">
                                  <span className="text-xs text-transparent select-none">.</span>
                                  <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-accent/10 text-accent font-bold text-sm tabular-nums border border-accent/20">
                                    = {item.quantity} {dimensionUnit}
                                  </span>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-3 pt-1 flex-wrap">
                <button
                  onClick={() => handleAddFreeItem(sec._tempId)}
                  className="flex items-center gap-2 text-sm font-semibold text-accent hover:text-accent/80 px-4 py-2 rounded-full border border-accent/20 bg-accent/5 transition-colors"
                >
                  <Plus className="w-4 h-4" />Saisie libre
                </button>
                <button
                  onClick={() => { setCatalogTarget(sec._tempId); setCatalogSearch(''); setCatalogOpen(true) }}
                  className="flex items-center gap-2 text-sm font-semibold text-primary hover:text-accent px-4 py-2 rounded-full border border-[var(--elevation-border)] bg-base/50 transition-colors"
                >
                  <Search className="w-4 h-4" />Catalogue
                </button>
                <button
                  onClick={() => { setTransportTarget(sec._tempId); setShowTransport(true) }}
                  className="flex items-center gap-2 text-sm font-semibold text-amber-600 hover:text-amber-500 px-4 py-2 rounded-full border border-amber-200 dark:border-amber-500/20 bg-amber-500/10 transition-colors"
                >
                  <Truck className="w-4 h-4" />Transport
                </button>
                <button
                  onClick={() => { setEquipmentTarget(sec._tempId); setEquipmentName(''); setEquipmentPurchase(0); setEquipmentUses(100); setShowEquipment(true) }}
                  className="flex items-center gap-2 text-sm font-semibold text-purple-600 hover:text-purple-500 px-4 py-2 rounded-full border border-purple-200 dark:border-purple-500/20 bg-purple-500/10 transition-colors"
                >
                  <Package className="w-4 h-4" />Équipement
                </button>
              </div>
            </div>
          ))}

          {sections.length > 0 && (
            <div className="flex items-center gap-3">
              <button
                onClick={handleAddSection}
                disabled={isPending}
                className="flex-1 py-4 border-2 border-dashed border-[var(--elevation-border)] rounded-2xl text-secondary font-bold hover:border-accent/50 hover:text-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <Plus className="w-5 h-5" />Ajouter une section
              </button>
              <button
                onClick={() => { setPrestationSearch(''); setPrestationOpen(true) }}
                disabled={isPending}
                className="py-4 px-6 border-2 border-dashed border-[var(--elevation-border)] rounded-2xl text-secondary font-bold hover:border-accent/50 hover:text-accent hover:bg-accent/5 transition-all flex items-center justify-center gap-2 disabled:opacity-60 whitespace-nowrap"
              >
                <Layers className="w-5 h-5" />Prestation type
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Modal Transport */}
      {showTransport && (
        <div className="modal-overlay z-[300]">
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
                  className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Consommation (L/100 km)</label>
                  <NumericInput min={1} decimals={2} value={transportConso} onChange={v => setTransportConso(v ?? 1)}
                    className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Prix carburant (€/L)</label>
                  <NumericInput min={0} decimals={3} value={transportPrixL} onChange={v => setTransportPrixL(v ?? 0)}
                    className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
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
                  Ligne interne - coût de revient, non visible sur le PDF client
                </p>
              </div>
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowTransport(false)}
                className="btn-secondary">Annuler</button>
              <button type="button" onClick={handleAddTransport}
                className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />Ajouter la ligne
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Équipement amorti */}
      {showEquipment && (
        <div className="modal-overlay z-[300]">
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
                  className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Prix d&apos;achat (€)</label>
                  <NumericInput min={0} decimals={2} value={equipmentPurchase || null} onChange={v => setEquipmentPurchase(v ?? 0)}
                    className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Usages sur la vie</label>
                  <NumericInput min={1} decimals={0} value={equipmentUses} onChange={v => setEquipmentUses(v ?? 1)}
                    className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 tabular-nums" />
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
                    Ligne interne - coût de revient, non visible sur le PDF client
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3">
              <button type="button" onClick={() => setShowEquipment(false)}
                className="btn-secondary">Annuler</button>
              <button type="button" onClick={handleAddEquipment} disabled={equipmentPurchase <= 0 || equipmentUses <= 0}
                className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />Ajouter la ligne
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nouveau client inline */}
      {newClientOpen && (
        <div className="modal-overlay z-[200]">
          <div className="modal-panel animate-in fade-in duration-200 sm:max-w-md">
            <button onClick={() => setNewClientOpen(false)} className="absolute top-6 right-6 text-secondary hover:text-primary"><X className="w-5 h-5" /></button>
            <h2 className="text-xl font-bold text-primary mb-6">Nouveau client</h2>

            {/* Toggle professionnel / particulier */}
            <div className="flex rounded-xl overflow-hidden border border-[var(--elevation-border)] mb-5">
              {(['company', 'individual'] as const).map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setNewClientType(t)}
                  className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${newClientType === t ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}
                >
                  {t === 'company' ? 'Professionnel' : 'Particulier'}
                </button>
              ))}
            </div>

            <div className="space-y-3">
              {newClientType === 'company' && (
                <input
                  type="text"
                  placeholder="Raison sociale *"
                  value={newClientForm.company_name}
                  onChange={e => setNewClientForm(p => ({ ...p, company_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  autoFocus
                />
              )}
              {newClientType === 'company' && (
                <input
                  type="text"
                  placeholder="Nom du contact référent"
                  value={newClientForm.contact_name}
                  onChange={e => setNewClientForm(p => ({ ...p, contact_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              )}
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder={newClientType === 'individual' ? 'Prénom *' : 'Prénom contact'}
                  value={newClientForm.first_name}
                  onChange={e => setNewClientForm(p => ({ ...p, first_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                  autoFocus={newClientType === 'individual'}
                />
                <input
                  type="text"
                  placeholder={newClientType === 'individual' ? 'Nom *' : 'Nom contact'}
                  value={newClientForm.last_name}
                  onChange={e => setNewClientForm(p => ({ ...p, last_name: e.target.value }))}
                  className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <input
                type="email"
                placeholder="Email"
                value={newClientForm.email}
                onChange={e => setNewClientForm(p => ({ ...p, email: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <input
                type="tel"
                placeholder="Téléphone"
                value={newClientForm.phone}
                onChange={e => setNewClientForm(p => ({ ...p, phone: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <input
                type="text"
                placeholder="Adresse"
                value={newClientForm.address_line1}
                onChange={e => setNewClientForm(p => ({ ...p, address_line1: e.target.value }))}
                className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
              />
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="Code postal"
                  value={newClientForm.postal_code}
                  onChange={e => setNewClientForm(p => ({ ...p, postal_code: e.target.value }))}
                  className="w-32 px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <input
                  type="text"
                  placeholder="Ville"
                  value={newClientForm.city}
                  onChange={e => setNewClientForm(p => ({ ...p, city: e.target.value }))}
                  className="flex-1 px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
            </div>

            {newClientError && (
              <p className="mt-3 text-xs text-red-400">{newClientError}</p>
            )}

            <div className="flex gap-3 mt-6">
              <button type="button" onClick={() => setNewClientOpen(false)} className="btn-secondary flex-1">
                Annuler
              </button>
              <button
                type="button"
                onClick={handleCreateClientInline}
                disabled={newClientPending}
                className="btn-primary flex-1 flex items-center justify-center gap-2"
              >
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
            description: saveCatalogItem.description,
            unit: saveCatalogItem.unit,
            unit_price: saveCatalogItem.unit_price,
            vat_rate: saveCatalogItem.vat_rate,
            length_m: saveCatalogItem.length_m,
            width_m: saveCatalogItem.width_m,
            height_m: saveCatalogItem.height_m,
            dimension_pricing_mode: saveCatalogItem.dimension_pricing_mode,
            hint: saveCatalogItem.type === 'labor' ? 'labor' : undefined,
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
          title="Envoyer le devis"
          description="Sélectionnez les contrats du même client à joindre en pièces jointes."
          recipientEmail={null}
          groups={sendModalGroups}
          loading={sendModalLoading}
          submitting={isSending}
          error={sendModalError}
          onCancel={() => { setSendModalOpen(false); setPendingQuoteId(null); }}
          onConfirm={confirmQuoteSend}
        />
      )}
    </main>
  )
}
