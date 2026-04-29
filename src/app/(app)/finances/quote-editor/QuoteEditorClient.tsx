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
  upsertQuoteItem, deleteQuoteItem,
  sendQuote,
} from '@/lib/data/mutations/quotes'
import { createClientInline } from '@/lib/data/mutations/clients'
import { UnitSelect } from '@/components/ui/UnitSelect'
import {
  ArrowLeft, Send, Plus, Trash2, Search, X,
  Loader2, CheckCircle2, Package, Wrench, FileDown, Bot, Ruler, ChevronDown, ChevronUp, Sparkles, Eye, EyeOff, Layers, Truck, MessageSquare,
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
  vat_rate: number
  type: 'material' | 'labor' | 'custom'
  material_id: string | null
  labor_rate_id: string | null
  position: number
  length_m: number | null
  width_m: number | null
  height_m: number | null
  dimension_pricing_mode: 'none' | 'linear' | 'area' | 'volume' | null
  is_estimated: boolean  // UI uniquement — non persisté en DB
  is_internal: boolean
  // Métadonnées transport — UI uniquement, non persistées en DB
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
    length_m: i.length_m ?? null,
    width_m: i.width_m ?? null,
    height_m: i.height_m ?? null,
    dimension_pricing_mode: dimensionMode,
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
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function QuoteEditorClient({ clients: initialClients, initialQuote, materials, laborRates, prestationTypes, initialClientId, catalogContext, modules, vatConfig, returnTo: rawReturnTo = null }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isSending, setIsSending] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const defaultVatRate = getCatalogDocumentVatRate(vatConfig)
  const returnTo = getSafeReturnTo(rawReturnTo, '/finances?tab=quotes')

  // Client list (mutable — peut être étendue par création inline)
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

  // ─── Totals ──────────────────────────────────────────────────────────────

  const allItems = sections.flatMap(s => s.items)
  const visibleItems = allItems.filter(i => !i.is_internal)
  const internalItems = allItems.filter(i => i.is_internal)
  // Totaux client = hors lignes internes (celles-ci n'apparaissent pas sur le PDF)
  const totalHt = visibleItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const totalTva = visibleItems.reduce((sum, i) => sum + i.quantity * i.unit_price * (i.vat_rate / 100), 0)
  const totalTtc = totalHt + totalTva
  const totalInternalHt = internalItems.reduce((sum, i) => sum + i.quantity * i.unit_price, 0)
  const margeHt = totalHt - totalInternalHt
  const margePct = totalHt > 0 ? (margeHt / totalHt) * 100 : 0
  const hasInternalItems = internalItems.length > 0

  // ─── Équipement amorti ────────────────────────────────────────────────────
  const [showEquipment, setShowEquipment] = useState(false)
  const [equipmentTarget, setEquipmentTarget] = useState<string | null>(null)
  const [equipmentName, setEquipmentName] = useState('')
  const [equipmentPurchase, setEquipmentPurchase] = useState(0)
  const [equipmentUses, setEquipmentUses] = useState(100)
  const equipmentCostPerUse = equipmentUses > 0 ? Math.round((equipmentPurchase / equipmentUses) * 100) / 100 : 0

  async function handleAddEquipment() {
    if (!equipmentTarget || equipmentPurchase <= 0 || equipmentUses <= 0) return
    const qId = await ensureQuote()
    if (!qId) return
    const sec = sectionsRef.current.find(s => s._tempId === equipmentTarget)!
    const pos = sec.items.length + 1
    const tempId = `item_${Date.now()}`
    const desc = equipmentName.trim() || `Équipement amorti (${equipmentPurchase} € / ${equipmentUses} usages)`
    setSections(prev => prev.map(s =>
      s._tempId === equipmentTarget
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: desc, quantity: 1, unit: 'usage', unit_price: 0, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, is_estimated: false, is_internal: true, transport_km: null, transport_conso: null, transport_prix_l: null }] }
        : s
    ))
    setShowEquipment(false)
    const sectionId = await ensureSectionSaved(equipmentTarget, qId)
    if (!sectionId) return
    const res = await upsertQuoteItem({ quote_id: qId, section_id: sectionId, type: 'custom', description: desc, quantity: 1, unit: 'usage', unit_price: equipmentCostPerUse, vat_rate: defaultVatRate, position: pos, is_internal: true })
    if (res.itemId) {
      await finalizeCreatedItem(equipmentTarget, tempId, res.itemId, qId, sectionId)
    }
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
    const desc = `Carburant - trajet ${transportKm} km`
    setSections(prev => prev.map(s =>
      s._tempId === transportTarget
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: desc, quantity: transportLiters, unit: 'L', unit_price: transportPrixL, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, is_estimated: false, is_internal: true, transport_km: transportKm, transport_conso: transportConso, transport_prix_l: transportPrixL }] }
        : s
    ))
    setShowTransport(false)
    const sectionId = await ensureSectionSaved(transportTarget, qId)
    if (!sectionId) return
    const res = await upsertQuoteItem({ quote_id: qId, section_id: sectionId, type: 'custom', description: desc, quantity: transportLiters, unit: 'L', unit_price: transportPrixL, vat_rate: defaultVatRate, position: pos, is_internal: true })
    if (res.itemId) {
      await finalizeCreatedItem(transportTarget, tempId, res.itemId, qId, sectionId)
    }
  }

  function handleTransportMetaChange(
    secTempId: string,
    itemTempId: string,
    field: 'transport_km' | 'transport_conso' | 'transport_prix_l',
    value: number | null,
  ) {
    setSections(prev => prev.map(s => {
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
    setSections(prev => [...prev, { _tempId: tempId, id: null, title: `Section ${pos}`, position: pos, items: [] }])
    startTransition(async () => {
      const res = await upsertQuoteSection({ quote_id: qId, title: `Section ${pos}`, position: pos })
      if (res.sectionId) {
        setSections(prev => prev.map(s => s._tempId === tempId ? { ...s, id: res.sectionId } : s))
      }
    })
  }

  function handleSectionTitleChange(tempId: string, newTitle: string) {
    setSections(prev => prev.map(s => s._tempId === tempId ? { ...s, title: newTitle } : s))
    const sec = sectionsRef.current.find(s => s._tempId === tempId)
    if (!sec?.id || !quoteIdRef.current) return
    startTransition(async () => {
      await upsertQuoteSection({ id: sec.id!, quote_id: quoteIdRef.current!, title: newTitle, position: sec.position })
    })
  }

  async function handleRemoveSection(tempId: string) {
    const sec = sections.find(s => s._tempId === tempId)
    setSections(prev => prev.filter(s => s._tempId !== tempId))
    if (sec?.id) {
      startTransition(async () => { await deleteQuoteSection(sec.id!) })
    }
  }

  // ─── Item mutations ───────────────────────────────────────────────────────

  async function ensureSectionSaved(sectionTempId: string, qId: string): Promise<string | null> {
    const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)
    if (!sec) return null
    if (sec.id) return sec.id
    const res = await upsertQuoteSection({ quote_id: qId, title: sec.title, position: sec.position })
    if (res.sectionId) {
      setSections(prev => prev.map(s => s._tempId === sectionTempId ? { ...s, id: res.sectionId } : s))
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
    const currentItem = sectionsRef.current.find(s => s._tempId === sectionTempId)?.items.find(i => i._tempId === itemTempId)

    setSections(prev => prev.map(s =>
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

  async function handleAddFreeItem(sectionTempId: string) {
    const qId = await ensureQuote()
    if (!qId) return
    const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)!
    const pos = sec.items.length + 1
    const tempId = `item_${Date.now()}`
    setSections(prev => prev.map(s =>
      s._tempId === sectionTempId
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: '', quantity: 1, unit: 'u', unit_price: 0, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, is_estimated: false, is_internal: false, transport_km: null, transport_conso: null, transport_prix_l: null }] }
        : s
    ))
    const sectionId = await ensureSectionSaved(sectionTempId, qId)
    if (!sectionId) return
    const res = await upsertQuoteItem({ quote_id: qId, section_id: sectionId, type: 'custom', description: '', quantity: 1, unit: 'u', unit_price: 0, vat_rate: defaultVatRate, position: pos })
    if (res.itemId) {
      await finalizeCreatedItem(sectionTempId, tempId, res.itemId, qId, sectionId)
    }
  }

  function handleItemChange(sectionTempId: string, itemTempId: string, field: keyof LocalItem, value: string | number | boolean) {
    setSections(prev => prev.map(s =>
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
      pendingItemKeys.current.delete(key)
      delete itemDebounces.current[key]
    }, 800)
  }

  async function handleRemoveItem(sectionTempId: string, itemTempId: string) {
    const sec = sections.find(s => s._tempId === sectionTempId)
    const item = sec?.items.find(i => i._tempId === itemTempId)
    setSections(prev => prev.map(s =>
      s._tempId === sectionTempId ? { ...s, items: s.items.filter(i => i._tempId !== itemTempId) } : s
    ))
    if (item?.id && quoteId) {
      startTransition(async () => { await deleteQuoteItem(item.id!, quoteId!) })
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
      await upsertQuoteItem({ id: item.id, quote_id: qId, section_id: sectionId, type: item.type, material_id: item.material_id, labor_rate_id: item.labor_rate_id, description: item.description, quantity: item.quantity, unit: item.unit, unit_price: item.unit_price, vat_rate: item.vat_rate, position: item.position, length_m: item.length_m, width_m: item.width_m, height_m: item.height_m, is_internal: item.is_internal })
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
    setSections(prev => prev.map(s => {
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
          quantity: pricing?.quantity ?? computeDimensionQuantity(mode, nextLength, nextWidth, nextHeight, i.quantity),
          unit: pricing?.unit ?? getModeUnit(mode, i.unit),
          unit_price: pricing?.unitPrice ?? i.unit_price,
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
    const newItem: LocalItem = {
      _tempId: tempId, id: null,
      description: isMat ? m.name : l.designation,
      quantity: pricing?.quantity ?? 1,
      unit: pricing?.unit ?? entry.unit ?? (isMat ? 'u' : 'h'),
      unit_price: pricing?.unitPrice ?? (isMat ? getCatalogSaleUnitPrice(m) : getInternalResourceUnitCost(l)),
      vat_rate: defaultVatRate,
      type,
      material_id: isMat ? m.id : null,
      labor_rate_id: !isMat ? l.id : null,
      position: pos,
      length_m: pricing?.lengthM ?? null,
      width_m: pricing?.widthM ?? null,
      height_m: pricing?.heightM ?? null,
      dimension_pricing_mode: isMat ? (m.dimension_pricing_mode ?? null) : null,
      is_estimated: false,
      is_internal: !isMat,
      transport_km: null, transport_conso: null, transport_prix_l: null,
    }
    setSections(prev => prev.map(s =>
      s._tempId === catalogTarget ? { ...s, items: [...s.items, newItem] } : s
    ))
    const sectionId = await ensureSectionSaved(catalogTarget, qId)
    if (!sectionId) return
    const res = await upsertQuoteItem({
      quote_id: qId, section_id: sectionId,
      type: newItem.type,
      material_id: newItem.material_id,
      labor_rate_id: newItem.labor_rate_id,
      description: newItem.description,
      quantity: newItem.quantity, unit: newItem.unit, unit_price: newItem.unit_price,
      vat_rate: newItem.vat_rate, position: pos,
      length_m: newItem.length_m,
      width_m: newItem.width_m,
      height_m: newItem.height_m,
      is_internal: newItem.is_internal,
    })
    if (res.itemId) {
      await finalizeCreatedItem(catalogTarget, tempId, res.itemId, qId, sectionId)
    }
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
        if (!item.id) continue
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
    // Toujours synchroniser le header avant envoi : client_id peut être null en DB
    // si le devis a été créé depuis /atelier-ia (quote créée avant sélection client)
    const headerRes = await syncQuoteHeader(qId)
    if (headerRes.error) { setIsSending(false); return }
    // Flush any unsaved item changes before sending
    await flushPendingItemSaves(qId)
    const res = await sendQuote(qId)
    setIsSending(false)
    if (res.error) { setErrorMsg(res.error); return }
    router.push(returnTo)
  }

  async function handlePreviewPdf() {
    const qId = await ensureQuote()
    if (!qId) return
    const headerRes = await syncQuoteHeader(qId)
    if (headerRes.error) return
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
      setSections(prev => [...prev, { _tempId: tempId, id: null, title: aiSec.title, position: pos, items: [] }])

      const res = await upsertQuoteSection({ quote_id: qId, title: aiSec.title, position: pos })
      const sectionId = res.sectionId
      if (!sectionId) continue

      setSections(prev => prev.map(s => s._tempId === tempId ? { ...s, id: sectionId } : s))

      for (let idx = 0; idx < aiSec.items.length; idx++) {
        const aiItem = aiSec.items[idx]
        const isInternal = isLikelyInternalAIItem(aiSec.title, aiItem)
        const itemTempId = `item_ai_${Date.now()}_${idx}`
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
          length_m: null,
          width_m: null,
          height_m: null,
          dimension_pricing_mode: null,
          is_estimated: aiItem.is_estimated ?? false,
          is_internal: isInternal,
          transport_km: null, transport_conso: null, transport_prix_l: null,
        }
        setSections(prev => prev.map(s =>
          s._tempId === tempId ? { ...s, items: [...s.items, newItem] } : s
        ))
        const itemRes = await upsertQuoteItem({
          quote_id: qId,
          section_id: sectionId,
          type: 'custom',
          description: aiItem.description,
          quantity: aiItem.quantity,
          unit: aiItem.unit,
          unit_price: aiItem.unit_price,
          vat_rate: aiItem.vat_rate,
          position: itemPos,
          is_internal: isInternal,
        })
        if (itemRes.itemId) {
          await finalizeCreatedItem(tempId, itemTempId, itemRes.itemId, qId, sectionId)
        }
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
      setSections(prev => [...prev, { _tempId: sectionTempId, id: null, title: "Main-d'œuvre", position: pos, items: [] }])
      const res = await upsertQuoteSection({ quote_id: qId, title: "Main-d'œuvre", position: pos })
      sectionId = res.sectionId ?? null
      if (sectionId) {
        setSections(prev => prev.map(s => s._tempId === sectionTempId ? { ...s, id: sectionId } : s))
      }
    }

    if (!sectionId) return

    const currentItems = sectionsRef.current.find(s => s._tempId === sectionTempId)?.items ?? []
    let pos = currentItems.length + 1

    for (const item of items) {
      const tempId = `item_mo_${Date.now()}_${Math.random()}`
      const itemPos = pos++
      const newItem: LocalItem = {
        _tempId: tempId, id: null,
        description: item.designation,
        quantity: item.quantity, unit: item.unit, unit_price: item.unit_price,
        vat_rate: defaultVatRate, type: 'labor',
        material_id: null, labor_rate_id: item.labor_rate_id,
        position: itemPos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null,
        is_estimated: false, is_internal: true,
        transport_km: null, transport_conso: null, transport_prix_l: null,
      }
      setSections(prev => prev.map(s =>
        s._tempId === sectionTempId ? { ...s, items: [...s.items, newItem] } : s
      ))
      const res = await upsertQuoteItem({
        quote_id: qId, section_id: sectionId!,
        type: 'labor', labor_rate_id: item.labor_rate_id,
        description: item.designation,
        quantity: item.quantity, unit: item.unit, unit_price: item.unit_price,
        vat_rate: defaultVatRate, position: itemPos, is_internal: true,
      })
      if (res.itemId) {
        await finalizeCreatedItem(sectionTempId, tempId, res.itemId, qId, sectionId)
      }
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
      const newItem: LocalItem = {
        _tempId: tempId, id: null,
        description: prestation.name,
        quantity: 1, unit: prestation.unit,
        unit_price: prestation.base_price_ht,
        vat_rate: defaultVatRate,
        type: 'custom', material_id: null, labor_rate_id: null,
        position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null,
        is_estimated: false, is_internal: false,
        transport_km: null, transport_conso: null, transport_prix_l: null,
      }
      setSections(prev => prev.map(s => s._tempId === targetTempId ? { ...s, items: [...s.items, newItem] } : s))
      const res = await upsertQuoteItem({ quote_id: qId, section_id: sectionId, type: 'custom', description: newItem.description, quantity: 1, unit: newItem.unit, unit_price: newItem.unit_price, vat_rate: newItem.vat_rate, position: pos })
      if (res.itemId) await finalizeCreatedItem(targetTempId, tempId, res.itemId, qId, sectionId)
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

    for (let sIdx = 0; sIdx < sectionEntries.length; sIdx++) {
      const [sectionTitle, pItems] = sectionEntries[sIdx]
      const secPos = basePos + sIdx + 1
      const secTempId = `sec_${Date.now()}_${sIdx}`
      const secTitle = sectionTitle || prestation.name || `Section ${secPos}`

      // Ajouter la section localement
      setSections(prev => [...prev, { _tempId: secTempId, id: null, title: secTitle, position: secPos, items: [] }])

      const res = await upsertQuoteSection({ quote_id: qId, title: secTitle, position: secPos })
      const sectionId = res.sectionId
      if (!sectionId) continue
      setSections(prev => prev.map(s => s._tempId === secTempId ? { ...s, id: sectionId } : s))

      const tempIds = pItems.map((_, i) => `item_${Date.now()}_${sIdx}_${i}`)
      const newItems: LocalItem[] = pItems.map((pItem, i) => {
        const isTransport = pItem.item_type === 'transport'
        const prixL = pItem.unit_price_ht > 0 ? pItem.unit_price_ht : DEFAULT_FUEL_PRICE_EUR_PER_L
        const conso = DEFAULT_CONSUMPTION_L_PER_100KM
        // Reconstituer km estimé depuis les litres stockés dans quantity
        const estimatedKm = isTransport && pItem.quantity > 0
          ? Math.round(pItem.quantity / conso * 100)
          : 100
        const liters = isTransport ? computeFuel({ km: estimatedKm, consumption: conso, pricePerLiter: prixL }).liters : pItem.quantity
        return {
          _tempId: tempIds[i], id: null,
          description: isTransport ? `Carburant - trajet ${estimatedKm} km` : pItem.designation,
          quantity: isTransport ? liters : pItem.quantity,
          unit: isTransport ? 'L' : pItem.unit,
          unit_price: isTransport ? prixL : pItem.unit_price_ht,
          vat_rate: defaultVatRate,
          type: pItem.item_type === 'material' || pItem.item_type === 'service' ? 'material' : pItem.item_type === 'labor' ? 'labor' : 'custom' as const,
          material_id: pItem.material_id,
          labor_rate_id: pItem.labor_rate_id,
          position: i + 1,
          length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null,
          is_estimated: false,
          is_internal: pItem.is_internal || isTransport,
          transport_km: isTransport ? estimatedKm : null,
          transport_conso: isTransport ? conso : null,
          transport_prix_l: isTransport ? prixL : null,
        }
      })

      setSections(prev => prev.map(s => s._tempId === secTempId ? { ...s, items: newItems } : s))

      for (let i = 0; i < newItems.length; i++) {
        const item = newItems[i]
        const itemRes = await upsertQuoteItem({
          quote_id: qId, section_id: sectionId,
          type: item.type, description: item.description,
          quantity: item.quantity, unit: item.unit, unit_price: item.unit_price,
          vat_rate: item.vat_rate, position: item.position,
          material_id: item.material_id ?? undefined,
          labor_rate_id: item.labor_rate_id ?? undefined,
          is_internal: item.is_internal,
        })
        if (itemRes.itemId) {
          const tid = tempIds[i]
          await finalizeCreatedItem(secTempId, tid, itemRes.itemId, qId, sectionId)
        }
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href={returnTo} className="w-10 h-10 rounded-full bg-surface border border-[var(--elevation-border)] flex items-center justify-center text-secondary hover:text-primary transition-colors dark:bg-white/5 flex-shrink-0">
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-bold text-primary">
              {initialQuote?.number ? `Devis ${initialQuote.number}` : quoteId ? 'Édition du devis' : 'Nouveau devis'}
            </h1>
            {saveStatus === 'saving' && (
              <p className="text-xs text-secondary flex items-center gap-1 mt-0.5">
                <Loader2 className="w-3 h-3 animate-spin" />Sauvegarde...
              </p>
            )}
            {saveStatus === 'saved' && (
              <p className="text-xs text-accent-green flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-3 h-3" />Sauvegardé
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isPending && <Loader2 className="w-4 h-4 text-secondary animate-spin" />}
          {modules.quote_ai && (
            <button
              onClick={() => setMoaPanelOpen(true)}
              className="px-4 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-violet-500/30 text-violet-600 dark:text-violet-400 font-semibold flex items-center gap-2 hover:bg-violet-500/10 transition-all whitespace-nowrap"
            >
              <Wrench className="w-4 h-4" />
              <span className="hidden md:inline">Estimer les ressources internes</span>
              <span className="md:hidden">Ressources</span>
            </button>
          )}
          {modules.quote_ai && (
            <button
              onClick={() => setAIPanelOpen(true)}
              className="px-4 py-2.5 rounded-full bg-gradient-to-r from-violet-500 to-indigo-600 text-white font-semibold flex items-center gap-2 hover:from-violet-600 hover:to-indigo-700 transition-all shadow-lg shadow-violet-500/20 whitespace-nowrap"
            >
              <Bot className="w-4 h-4" />
              {AI_NAME}
            </button>
          )}
          {quoteId ? (
            <button
              onClick={handlePreviewPdf}
              className="px-4 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center gap-2 hover:bg-base transition-all whitespace-nowrap"
            >
              <FileDown className="w-4 h-4" /><span className="hidden sm:inline">Aperçu PDF</span>
            </button>
          ) : (
            <span className="px-4 py-2.5 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-secondary font-semibold flex items-center gap-2 opacity-40 cursor-not-allowed whitespace-nowrap" title="Ajoutez une ligne pour générer le PDF">
              <FileDown className="w-4 h-4" /><span className="hidden sm:inline">Aperçu PDF</span>
            </span>
          )}
          <button
            onClick={handleSend}
            disabled={isSending || isPending}
            className="px-4 sm:px-6 py-2.5 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-60 disabled:hover:scale-100 whitespace-nowrap"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Envoyer
          </button>
        </div>
      </div>

      {errorMsg && <p className="text-sm text-red-400 px-2">{errorMsg}</p>}

      {/* Main layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">

        {/* Left panel */}
        <div className="lg:col-span-4 space-y-6">
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
                <input
                  type="number"
                  value={validityDays}
                  min={1}
                  onChange={e => { setValidityDays(Number(e.target.value)); scheduleHeaderSave({ validity_days: Number(e.target.value) }) }}
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums"
                />
              </div>
            </div>
          </div>

          {/* Totals */}
          <div className="rounded-3xl card p-5 sm:p-8 space-y-4 lg:sticky top-24">
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
                      if (e.target.value === '') { setAidAmount(null); scheduleHeaderSave({ aid_label: aidLabel || null, aid_amount: null }); return }
                      const raw = parseFloat(e.target.value)
                      const v = aidMode === '%'
                        ? Math.round(Math.min(100, Math.max(0, raw)) * totalTtc) / 100
                        : Math.min(totalTtc, Math.max(0, raw))
                      setAidAmount(v)
                      scheduleHeaderSave({ aid_label: aidLabel || null, aid_amount: v })
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

            {/* Marge interne — visible uniquement si lignes internes */}
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

        {/* Right: sections */}
        <div className="lg:col-span-8 space-y-6">

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
                  title={clientRequestVisibleOnPdf ? 'Affiché sur le PDF client — cliquer pour masquer' : 'Masqué sur le PDF client — cliquer pour afficher'}
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
                  className="flex items-center gap-2 text-sm font-bold text-accent hover:text-accent/80 px-5 py-2.5 rounded-full border border-accent/20 bg-accent/5 transition-colors disabled:opacity-60"
                >
                  <Plus className="w-4 h-4" />Ajouter une section
                </button>
                <button
                  onClick={() => { setPrestationSearch(''); setPrestationOpen(true) }}
                  disabled={isPending}
                  className="flex items-center gap-2 text-sm font-bold text-primary hover:text-accent px-5 py-2.5 rounded-full border border-[var(--elevation-border)] bg-base/50 transition-colors disabled:opacity-60"
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

              <div className="space-y-0.5">
                {sec.items.length === 0 && (
                  <p className="py-6 text-center text-sm text-secondary opacity-60">
                    Aucune ligne. Ajoutez une saisie libre ou choisissez dans le catalogue.
                  </p>
                )}
                {/* Header */}
                {sec.items.length > 0 && (
                  <div className="grid grid-cols-[1fr_90px_90px_110px_70px_100px_64px] gap-2 pb-1 border-b border-[var(--elevation-border)]">
                    <span className="text-xs font-bold text-secondary uppercase tracking-wider">Désignation</span>
                    <span className="text-xs font-bold text-secondary uppercase tracking-wider text-right">Qté</span>
                    <span className="text-xs font-bold text-secondary uppercase tracking-wider">Unité</span>
                    <span className="text-xs font-bold text-secondary uppercase tracking-wider text-right">PU HT</span>
                    <span className="text-xs font-bold text-secondary uppercase tracking-wider text-right">TVA%</span>
                    <span className="text-xs font-bold text-secondary uppercase tracking-wider text-right">Total HT</span>
                    <span />
                  </div>
                )}
                {sec.items.map(item => {
                  const rowKey = `${sec._tempId}_${item._tempId}`
                  const isExpanded = expandedItems.has(rowKey)
                  const dimensionMode = getItemDimensionMode(item)
                  const isDimensioned = dimensionMode !== 'none'
                  const canUseDimensions = isDimensioned
                  const dimensionUnit = getModeUnit(dimensionMode, item.unit)
                  const sourceMaterial = item.material_id ? materials.find(material => material.id === item.material_id) : null
                  const lengthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'length', dimensionMode)
                  const widthMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'width', dimensionMode)
                  const heightMeta = getDimensionFieldDefinition(sourceMaterial?.dimension_schema, 'height', dimensionMode)
                  return (
                    <div key={item._tempId} className={`rounded-xl border transition-all ${item.is_internal ? 'border-l-2 border-amber-400/50 bg-amber-500/5 opacity-80 hover:opacity-100' : item.is_estimated ? 'border-l-2 border-amber-400/60 bg-amber-500/5 hover:bg-amber-500/10' : 'border-transparent hover:border-[var(--elevation-border)] hover:bg-base/30'}`}>
                      {/* Main row */}
                      <div className="grid grid-cols-[1fr_90px_90px_110px_70px_100px_64px] gap-2 items-center px-1 py-1">
                        <div className="flex items-center gap-1.5 min-w-0">
                          {item.is_internal && (
                            <span className="flex-shrink-0 text-[9px] font-bold uppercase tracking-wider text-amber-700 bg-amber-500/15 border border-amber-400/40 rounded px-1.5 py-0.5 leading-none">
                              Coût
                            </span>
                          )}
                          <input
                            type="text"
                            value={item.description}
                            onChange={e => handleItemChange(sec._tempId, item._tempId, 'description', e.target.value)}
                            placeholder="Désignation..."
                            className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none text-primary text-sm transition-colors"
                          />
                        </div>
                        {isDimensioned ? (
                          <p className="p-2 text-right text-sm font-bold tabular-nums text-accent">{item.quantity}</p>
                        ) : (
                          <input
                            type="number"
                            value={item.quantity}
                            min={0}
                            onChange={e => handleItemChange(sec._tempId, item._tempId, 'quantity', Number(e.target.value))}
                            className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none text-primary tabular-nums text-right text-sm transition-colors"
                          />
                        )}
                        <UnitSelect
                          value={item.unit}
                          onChange={value => handleItemChange(sec._tempId, item._tempId, 'unit', value)}
                          allowedUnits={catalogContext.unitSet}
                          compact
                          className="w-full"
                        />
                        <input
                          type="number"
                          value={item.unit_price}
                          min={0}
                          step={0.01}
                          onChange={e => handleItemChange(sec._tempId, item._tempId, 'unit_price', Number(e.target.value))}
                          className={`w-full p-2 bg-transparent border rounded-lg outline-none tabular-nums text-right text-sm transition-colors ${item.is_estimated ? 'border-amber-400/40 text-amber-600 dark:text-amber-400 focus:border-amber-400' : 'border-transparent focus:border-accent focus:bg-base/50 text-primary'}`}
                          title={item.is_estimated ? 'Prix estimé par l\'IA, à valider' : undefined}
                        />
                        <select
                          value={item.vat_rate}
                          onChange={e => handleItemChange(sec._tempId, item._tempId, 'vat_rate', Number(e.target.value))}
                          className="w-full p-2 bg-transparent border border-transparent rounded-lg focus:border-accent focus:bg-base/50 outline-none text-primary tabular-nums text-right text-sm transition-colors appearance-none"
                        >
                          {LEGAL_VAT_RATES.map(rate => (
                            <option key={rate} value={rate}>{rate}%</option>
                          ))}
                        </select>
                        <span className="font-bold text-primary tabular-nums text-sm text-right pr-2">{fmt(item.quantity * item.unit_price)}</span>
                        <div className="flex items-center gap-0.5">
                          {item.is_estimated && (
                            <span title="Prix estimé par l'IA, cliquez sur le prix pour le modifier" className="p-1.5 text-amber-500">
                              <Sparkles className="w-3.5 h-3.5" />
                            </span>
                          )}
                          <button
                            onClick={() => handleItemChange(sec._tempId, item._tempId, 'is_internal', !item.is_internal)}
                            title={item.is_internal ? 'Ligne interne — non visible sur le PDF client (cliquer pour rendre visible)' : 'Ligne visible sur le PDF client (cliquer pour rendre interne)'}
                            className={`p-1.5 rounded-full transition-all ${item.is_internal ? 'text-amber-500 bg-amber-500/10' : 'text-emerald-600 bg-emerald-500/10 hover:bg-emerald-500/15'}`}
                          >
                            {item.is_internal ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          {canUseDimensions && (
                            <button
                              onClick={() => toggleItemExpand(rowKey)}
                              title="Dimensions"
                              className={`p-1.5 rounded-full transition-all ${isExpanded ? 'text-accent bg-accent/10' : 'text-secondary hover:text-accent hover:bg-accent/10'}`}
                            >
                              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            </button>
                          )}
                          <button
                            onClick={() => handleRemoveItem(sec._tempId, item._tempId)}
                            className="p-1.5 text-secondary hover:text-red-500 rounded-full hover:bg-red-500/10 transition-all"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      {/* Panneau transport interne */}
                      {item.transport_prix_l !== null && (
                        <div className="px-3 pb-3 pt-2 border-t border-amber-200/60 dark:border-amber-500/20 space-y-2 rounded-b-xl bg-amber-500/3">
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
                                onChange={e => handleTransportMetaChange(sec._tempId, item._tempId, 'transport_km', e.target.value === '' ? null : Number(e.target.value))}
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
                                onChange={e => handleTransportMetaChange(sec._tempId, item._tempId, 'transport_conso', Number(e.target.value))}
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
                                onChange={e => handleTransportMetaChange(sec._tempId, item._tempId, 'transport_prix_l', Number(e.target.value))}
                                className="w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-amber-400"
                              />
                            </label>
                            <span className="text-secondary text-sm pb-1.5">=</span>
                            <span className="font-bold text-amber-600 dark:text-amber-400 text-sm tabular-nums pb-1">
                              {item.quantity.toFixed(2)} L &mdash; {fmt(item.quantity * (item.transport_prix_l ?? DEFAULT_FUEL_PRICE_EUR_PER_L))}
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Detail panel */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 border-t border-[var(--elevation-border)]/50 space-y-3">
                          {/* Dimensions */}
                          <div>
                            <p className="text-xs font-semibold text-secondary uppercase tracking-wider mb-2 flex items-center gap-1.5">
                              <Ruler className="w-3 h-3" />Dimensions (calcul automatique de la quantité)
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                              <label className="flex items-center gap-2 text-sm text-secondary">
                                {lengthMeta.label}
                                <input
                                  type="number"
                                  value={metersToDisplayUnit(item.length_m, lengthMeta.unit) ?? ''}
                                  min={0}
                                  step={0.001}
                                  onChange={e => handleDimChange(sec._tempId, item._tempId, 'length_m', e.target.value === '' ? null : displayUnitToMeters(Number(e.target.value), lengthMeta.unit))}
                                  placeholder=""
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
                                      onChange={e => handleDimChange(sec._tempId, item._tempId, 'width_m', e.target.value === '' ? null : displayUnitToMeters(Number(e.target.value), widthMeta.unit))}
                                      placeholder=""
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
                                      onChange={e => handleDimChange(sec._tempId, item._tempId, 'height_m', e.target.value === '' ? null : displayUnitToMeters(Number(e.target.value), heightMeta.unit))}
                                      placeholder=""
                                      className="w-24 p-1.5 bg-base border border-[var(--elevation-border)] rounded-lg outline-none text-primary tabular-nums text-right text-sm focus:border-accent"
                                    />
                                    <span className="text-xs text-secondary">{heightMeta.unit}</span>
                                  </label>
                                </>
                              )}
                              <span className="text-secondary">=</span>
                              <span className="font-bold text-accent text-sm tabular-nums">{item.quantity} {dimensionUnit}</span>
                            </div>
                          </div>
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
                <input type="number" min={1} value={transportKm} onChange={e => setTransportKm(Number(e.target.value))}
                  className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Consommation (L/100 km)</label>
                  <input type="number" min={1} step={0.1} value={transportConso} onChange={e => setTransportConso(Number(e.target.value))}
                    className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Prix carburant (€/L)</label>
                  <input type="number" min={0} step={0.01} value={transportPrixL} onChange={e => setTransportPrixL(Number(e.target.value))}
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
                  Ligne interne — coût de revient, non visible sur le PDF client
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
                  <input type="number" min={0} step={0.01} value={equipmentPurchase || ''} onChange={e => setEquipmentPurchase(Number(e.target.value))}
                    className="w-full p-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-purple-500/50 tabular-nums" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-secondary">Usages sur la vie</label>
                  <input type="number" min={1} step={1} value={equipmentUses} onChange={e => setEquipmentUses(Number(e.target.value))}
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
                    Ligne interne — coût de revient, non visible sur le PDF client
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
              <button type="button" onClick={() => setNewClientOpen(false)} className="flex-1 py-3 rounded-full text-secondary font-semibold border border-[var(--elevation-border)] hover:text-primary transition-colors">
                Annuler
              </button>
              <button
                type="button"
                onClick={handleCreateClientInline}
                disabled={newClientPending}
                className="flex-1 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-60 disabled:hover:scale-100 flex items-center justify-center gap-2"
              >
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
