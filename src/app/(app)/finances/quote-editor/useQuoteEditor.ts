'use client'
// @atelier-migrated
// Logique de l'éditeur de devis : états, sauvegardes différées, ajouts et envoi.
// L'affichage vit dans QuoteEditorClient.tsx ; rien ici ne dépend de la présentation.

import React, { useState, useRef, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import type { Client } from '@/lib/data/queries/clients'
import { buildPersonalizedQuoteIntro, isLegacyAutoQuoteIntro } from '@/lib/client'
import { buildMaterialSelectionPricing } from '@/lib/catalog-pricing'
import { computeMetalWeightKg, type MetalCode } from '@/lib/metal-prices'
import type { QuoteWithItems } from '@/lib/data/queries/quotes'
import type { CatalogMaterial, CatalogLaborRate, PrestationType } from '@/lib/data/queries/catalog'
import { createQuote, updateQuote, upsertQuoteSection, deleteQuoteSection, upsertQuoteItem, deleteQuoteItem, pruneQuoteItems, sendQuote } from '@/lib/data/mutations/quotes'
import { type SaveToCatalogResult } from '@/components/catalog/SaveToCatalogModal'
import { createClientInline } from '@/lib/data/mutations/clients'
import { fetchClientContractsForAttachment } from '@/lib/data/mutations/contracts'
import { type AttachmentGroup } from '@/components/AttachmentPickerModal'

import { Send } from 'lucide-react'

import { type MOInsertItem } from '@/components/ai/LaborEstimatePanel'
import type { AIQuoteResult } from '@/app/api/ai/analyze-quote/route'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { type VatConfig } from '@/lib/utils'
import { computeFuel, DEFAULT_CONSUMPTION_L_PER_100KM, DEFAULT_FUEL_PRICE_EUR_PER_L } from '@/lib/utils/fuel'
import { getCatalogDocumentVatRate, getCatalogSaleUnitPrice, getInternalResourceUnitCost } from '@/lib/catalog-ui'

import type { OrganizationModules } from '@/lib/organization-modules'
import MetalPriceBanner from '@/components/quotes/MetalPriceBanner'

import type { SupplierPriceRequest } from '@/lib/data/mutations/supplier-price-requests'

import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import { saveMetalPriceSnapshots } from '@/lib/data/mutations/metal-price-snapshots'
import type { MetalPriceSnapshotRow } from '@/lib/data/queries/metal-price-snapshots'

import { fmt, getSafeReturnTo, findBestClientMatch, getAIClientSearch, getAIClientDraftInput, isLikelyInternalAIItem, inferLaborCategory, LocalItem, getLaborCategoryOptions, LocalSection, roundCurrency, getInternalSaleTotal, resolvePersistedSectionId, getItemDimensionMode, getModeUnit, computeDimensionQuantity, itemToLocal, computeQuoteTotals, formatGridLabel } from './quoteEditorModel'

export type QuoteEditorProps = {
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
  hasMetalPricing?: boolean
  metalPriceGrids?: MetalPriceGrid[]
  initialMetalSnapshots?: MetalPriceSnapshotRow[]
  clauseTemplates?: import('@/lib/data/queries/clause-templates').QuoteClauseTemplate[]
  initialVariants?: import('@/lib/data/queries/quotes').QuoteVariantStub[]
  initialPriceRequests?: SupplierPriceRequest[]
  allSuppliers?: import('@/lib/data/queries/suppliers').Supplier[]
  orgForMentions?: import('@/lib/btp-legal-mentions').OrgForCheck | null
}

export function useQuoteEditor({ clients: initialClients, initialQuote, materials, laborRates, prestationTypes, initialClientId, catalogContext, modules, vatConfig, returnTo: rawReturnTo = null, allQuotes = [], hasMetalPricing = false, metalPriceGrids = [], initialMetalSnapshots = [], clauseTemplates = [], initialVariants = [], initialPriceRequests = [], allSuppliers = [], orgForMentions = null }: QuoteEditorProps) {

  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [isSending, setIsSending] = useState(false)
  const [isAddingSection, setIsAddingSection] = useState(false)
  const [sendModalOpen, setSendModalOpen] = useState(false)
  const [sendModalGroups, setSendModalGroups] = useState<AttachmentGroup[]>([])
  const [sendModalLoading, setSendModalLoading] = useState(false)
  const [sendModalError, setSendModalError] = useState<string | null>(null)
  const [emailRequiredOpen, setEmailRequiredOpen] = useState(false)
  const [pendingQuoteId, setPendingQuoteId] = useState<string | null>(null)
  const [checkModalOpen, setCheckModalOpen] = useState(false)
  const [checkWarnings, setCheckWarnings] = useState<string[]>([])
  const [clauseModalOpen, setClauseModalOpen] = useState(false)
  const [clauseTarget, setClauseTarget] = useState<'notes' | 'conditions'>('notes')
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const defaultVatRate = getCatalogDocumentVatRate(vatConfig)
  const returnTo = getSafeReturnTo(rawReturnTo, '/finances?tab=quotes')
  const laborCategoryOptions = getLaborCategoryOptions(catalogContext.businessProfile)

  // Client list (mutable - peut être étendue par création inline)
  const [clients, setClients] = useState<Client[]>(initialClients)

  // Brief Sarah -> Chloé : pré-remplissage au chargement (sessionStorage d'abord, puis ai_briefs en DB)
  useEffect(() => {
    if (initialQuote) return // ne pas écraser un devis existant

    type ChloeBrief = {
      client_name?: string
      client_id?: string
      description?: string
      items?: unknown
      conditions?: unknown
    }

    // Compose le texte envoyé à Chloé pour l'analyse : description + détail
    // des postes et conditions transmis par Sarah, pour des lignes plus riches.
    function buildAnalyzeText(brief: ChloeBrief): string {
      const parts = [brief.description?.trim()].filter(Boolean) as string[]
      if (Array.isArray(brief.items) && brief.items.length > 0) {
        const lines = brief.items
          .map(it => {
            if (typeof it === 'string') return `- ${it}`
            if (it && typeof it === 'object') {
              const o = it as Record<string, unknown>
              const label = [o.name, o.description].find(v => typeof v === 'string' && v.trim()) as string | undefined
              const qty = typeof o.quantity === 'number' || typeof o.quantity === 'string' ? ` (${o.quantity}${o.unit ? ` ${o.unit}` : ''})` : ''
              return label ? `- ${label}${qty}` : null
            }
            return null
          })
          .filter(Boolean)
        if (lines.length > 0) parts.push(`Postes à prévoir :\n${lines.join('\n')}`)
      }
      if (typeof brief.conditions === 'string' && brief.conditions.trim()) {
        parts.push(`Conditions : ${brief.conditions.trim()}`)
      }
      return parts.join('\n\n')
    }

    function applyBrief(brief: ChloeBrief, bannerText: string) {
      if (brief.client_id) {
        setClientId(brief.client_id)
      } else if (brief.client_name) {
        const match = findBestClientMatch(clients, brief.client_name)
        if (match) setClientId(match.id)
      }
      if (brief.description?.trim()) {
        setTitle(brief.description.trim().slice(0, 120))
        setChloeBriefBanner(bannerText)
        setChloeAutoAnalyze(buildAnalyzeText(brief))
        setStartChoice('done')
        setAIPanelOpen(true)
      }
    }

    // 1. SessionStorage (compat)
    try {
      const raw = sessionStorage.getItem('sarah_brief_chloe')
      if (raw) {
        sessionStorage.removeItem('sarah_brief_chloe')
        const brief = JSON.parse(raw) as ChloeBrief
        applyBrief(brief, `Brief transmis par Sarah${brief.client_name ? ` pour ${brief.client_name}` : ''}.`)
        setStartChoice(prev => prev === 'checking' ? 'pending' : prev)
        return
      }
    } catch { /* sessionStorage inaccessible */ }

    // 2. ai_briefs en base (cross-device / cross-session)
    fetch('/api/sarah/briefs?target=chloe')
      .then(r => r.json())
      .then(({ brief }: { brief: { id: string; payload: ChloeBrief } | null }) => {
        if (!brief?.payload?.description?.trim()) {
          setStartChoice(prev => prev === 'checking' ? 'pending' : prev)
          return
        }
        applyBrief(brief.payload, `Brief transmis par Sarah${brief.payload.client_name ? ` pour ${brief.payload.client_name}` : ''}.`)
        fetch('/api/sarah/briefs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ briefId: brief.id }) }).catch(() => {})
      })
      .catch(() => setStartChoice(prev => prev === 'checking' ? 'pending' : prev))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
        status: 'active', source: null, total_revenue: 0, payment_terms_days: 30, internal_notes: null,
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
  const initialSelectedClientId = initialQuote?.client?.id ?? initialClientId ?? ''
  const [clientId, setClientId] = useState<string>(initialSelectedClientId)
  const [title, setTitle] = useState(initialQuote?.title ?? '')
  const [validityDays, setValidityDays] = useState(initialQuote?.validity_days ?? vatConfig.defaultQuoteValidityDays ?? 30)
  const initialClientForIntro = initialClients.find(c => c.id === initialSelectedClientId) ?? initialQuote?.client ?? null
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
  const [showSectionSubtotals, setShowSectionSubtotals] = useState<boolean>(
    (initialQuote as any)?.show_section_subtotals ?? vatConfig.defaultShowSectionSubtotals ?? false,
  )
  const [variantGroupId] = useState<string | null>((initialQuote as any)?.variant_group_id ?? null)
  const [variantLabel, setVariantLabel] = useState<string>((initialQuote as any)?.variant_label ?? '')
  const [variants, setVariants] = useState<import('@/lib/data/queries/quotes').QuoteVariantStub[]>(initialVariants)
  const [variantCreating, setVariantCreating] = useState(false)
  const [variantNewLabel, setVariantNewLabel] = useState('')
  const [variantModalOpen, setVariantModalOpen] = useState(false)
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
  const [chloeBriefBanner, setChloeBriefBanner] = useState<string | null>(null)
  const [chloeAutoAnalyze, setChloeAutoAnalyze] = useState<string | null>(null)

  // Écran de choix "moi-même" / "assisté par Chloé" à la création d'un devis
  // vide. 'checking' le temps de savoir si un brief Sarah pré-sélectionne
  // Chloé (évite l'affichage puis la fermeture immédiate du choix).
  const [startChoice, setStartChoice] = useState<'checking' | 'pending' | 'done'>(
    !initialQuote && modules.quote_ai ? 'checking' : 'done'
  )

  // Labour estimate panel
  const [moaPanelOpen, setMoaPanelOpen] = useState(false)

  // Refs for stale closure avoidance in debounces
  const quoteIdRef = useRef(quoteId)
  const sectionsRef = useRef(sections)
  useEffect(() => { quoteIdRef.current = quoteId }, [quoteId])
  useEffect(() => { sectionsRef.current = sections }, [sections])

  const headerDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addingSectionRef = useRef(false)
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

  async function handleCreateVariant() {
    if (!quoteId || !variantNewLabel.trim()) return
    setVariantCreating(true)
    const { createQuoteVariant } = await import('@/lib/data/mutations/quotes')
    const res = await createQuoteVariant(quoteId, variantNewLabel.trim())
    setVariantCreating(false)
    if (res.error) { setErrorMsg(res.error); return }
    setVariantModalOpen(false)
    setVariantNewLabel('')
    if (res.quoteId) {
      router.push(`/finances/quote-editor?id=${res.quoteId}`)
    }
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

  const { allItems, visibleItems, internalItems, totalHt, totalTva, totalTtc, totalInternalHt, internalOnlyHt, internalSaleToDistributeHt, margeHt, margePct, hasInternalItems, pendingSupplierPrices, canDistributeInternalCosts } = computeQuoteTotals(sections)

  // ─── Répartition manuelle de la marge interne ─────────────────────────────
  // Par défaut la répartition reste automatique (au prorata du HT visible).
  // En mode manuel, l'artisan choisit le poids (%) de chaque ligne visible ;
  // la somme doit faire 100 % avant de pouvoir répartir.
  const [manualDistributionMode, setManualDistributionMode] = useState(false)
  const [distributionWeights, setDistributionWeights] = useState<Map<string, number>>(new Map())

  function distributionKey(sectionTempId: string, itemTempId: string) {
    return `${sectionTempId}_${itemTempId}`
  }

  function openManualDistribution() {
    const currentSections = sectionsRef.current
    const eligible = currentSections.flatMap(section =>
      section.items
        .filter(item => !item.is_internal && !item.price_pending && item.quantity > 0)
        .map(item => ({ sectionTempId: section._tempId, itemTempId: item._tempId, item })),
    )
    const visibleTotal = eligible.reduce((sum, entry) => sum + entry.item.quantity * entry.item.unit_price, 0)
    const initial = new Map<string, number>()
    eligible.forEach(entry => {
      const lineTotal = entry.item.quantity * entry.item.unit_price
      const pct = visibleTotal > 0 ? (lineTotal / visibleTotal) * 100 : 100 / eligible.length
      initial.set(distributionKey(entry.sectionTempId, entry.itemTempId), Math.round(pct * 10) / 10)
    })
    setDistributionWeights(initial)
    setManualDistributionMode(true)
  }

  function closeManualDistribution() {
    setManualDistributionMode(false)
    setDistributionWeights(new Map())
  }

  function setDistributionWeight(sectionTempId: string, itemTempId: string, pct: number | null) {
    setDistributionWeights(prev => {
      const next = new Map(prev)
      next.set(distributionKey(sectionTempId, itemTempId), pct ?? 0)
      return next
    })
  }

  const distributionWeightSum = [...distributionWeights.values()].reduce((sum, w) => sum + w, 0)
  const distributionWeightValid = Math.abs(distributionWeightSum - 100) < 0.1

  function scrollToQuoteArea(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY - 96
    window.scrollTo({ top, behavior: 'smooth' })
  }

  function handleDistributeInternalCostsIntoVisiblePrices() {
    const currentSections = sectionsRef.current
    const internalTotal = roundCurrency(
      currentSections.flatMap(section => section.items).filter(item => item.is_internal).reduce((sum, item) => sum + getInternalSaleTotal(item), 0),
    )
    if (internalTotal <= 0) {
      setErrorMsg('Aucun montant interne à vendre à répartir.')
      return
    }

    const visibleEntries = currentSections.flatMap(section =>
      section.items
        .filter(item => !item.is_internal && !item.price_pending && item.quantity > 0)
        .map(item => ({ sectionTempId: section._tempId, itemTempId: item._tempId, item })),
    )
    const internalEntries = currentSections.flatMap(section =>
      section.items
        .filter(item => item.is_internal)
        .map(item => ({ sectionTempId: section._tempId, itemTempId: item._tempId, item })),
    )
    if (visibleEntries.length === 0) {
      setErrorMsg('Ajoutez au moins une ligne visible avec quantité pour répartir les coûts internes.')
      return
    }

    const useManualWeights = manualDistributionMode && distributionWeightValid
    if (manualDistributionMode && !distributionWeightValid) {
      setErrorMsg(`La somme des poids doit faire 100 % (actuellement ${distributionWeightSum.toFixed(1)} %).`)
      return
    }

    const confirmed = window.confirm(
      useManualWeights
        ? `Répartir ${fmt(internalTotal)} HT de montant interne selon les poids choisis ? Les lignes internes resteront masquées et leur coût de revient restera utilisé pour la marge.`
        : `Répartir ${fmt(internalTotal)} HT de montant interne vendu dans les prix des lignes visibles ? Les lignes internes resteront masquées et leur coût de revient restera utilisé pour la marge.`,
    )
    if (!confirmed) return

    const visibleTotal = visibleEntries.reduce((sum, entry) => sum + entry.item.quantity * entry.item.unit_price, 0)
    let remaining = internalTotal
    const updates = new Map<string, Partial<LocalItem>>()

    visibleEntries.forEach((entry, index) => {
      const isLast = index === visibleEntries.length - 1
      const currentLineTotal = entry.item.quantity * entry.item.unit_price
      const weight = useManualWeights
        ? (distributionWeights.get(distributionKey(entry.sectionTempId, entry.itemTempId)) ?? 0) / 100
        : visibleTotal > 0 ? currentLineTotal / visibleTotal : 1 / visibleEntries.length
      const allocated = isLast ? remaining : roundCurrency(internalTotal * weight)
      remaining = roundCurrency(remaining - allocated)
      updates.set(`${entry.sectionTempId}_${entry.itemTempId}`, {
        unit_price: roundCurrency(entry.item.unit_price + allocated / entry.item.quantity),
        is_estimated: false,
      })
    })

    internalEntries.forEach(entry => {
      updates.set(`${entry.sectionTempId}_${entry.itemTempId}`, {
        unit_price: 0,
        unit_cost_ht: entry.item.unit_cost_ht ?? entry.item.unit_price,
      })
    })

    setErrorMsg(null)
    setSaveStatus('saving')
    setSectionsSynced(prev => prev.map(section => ({
      ...section,
      items: section.items.map(item => {
        const patch = updates.get(`${section._tempId}_${item._tempId}`)
        return patch == null ? item : { ...item, ...patch }
      }),
    })))

    for (const entry of [...visibleEntries, ...internalEntries]) {
      scheduleItemSave(entry.sectionTempId, entry.itemTempId)
    }
    closeManualDistribution()
  }

  function handleMarkInternalSalesAlreadyDistributed() {
    const currentSections = sectionsRef.current
    const internalEntries = currentSections.flatMap(section =>
      section.items
        .filter(item => item.is_internal && getInternalSaleTotal(item) > 0)
        .map(item => ({ sectionTempId: section._tempId, itemTempId: item._tempId, item })),
    )
    const internalTotal = roundCurrency(internalEntries.reduce((sum, entry) => sum + getInternalSaleTotal(entry.item), 0))
    if (internalEntries.length === 0 || internalTotal <= 0) {
      setErrorMsg('Aucun montant interne à marquer comme déjà réparti.')
      return
    }

    const confirmed = window.confirm(
      `Marquer ${fmt(internalTotal)} HT comme déjà répartis ? Les prix visibles ne seront pas modifiés. Les lignes internes garderont leur coût de revient pour la marge.`,
    )
    if (!confirmed) return

    const updates = new Map<string, Partial<LocalItem>>()
    internalEntries.forEach(entry => {
      updates.set(`${entry.sectionTempId}_${entry.itemTempId}`, {
        unit_price: 0,
        unit_cost_ht: entry.item.unit_cost_ht ?? entry.item.unit_price,
      })
    })

    setErrorMsg(null)
    setSaveStatus('saving')
    setSectionsSynced(prev => prev.map(section => ({
      ...section,
      items: section.items.map(item => {
        const patch = updates.get(`${section._tempId}_${item._tempId}`)
        return patch == null ? item : { ...item, ...patch }
      }),
    })))

    for (const entry of internalEntries) {
      scheduleItemSave(entry.sectionTempId, entry.itemTempId)
    }
  }

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
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: desc, quantity: 1, unit: 'usage', unit_price: equipmentCostPerUse, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: true, transport_km: null, transport_conso: null, transport_prix_l: null, metal_grid_id: null, metal_lme_price_eur_kg: null, price_pending: false, labor_category: null }] }
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
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: desc, quantity: transportLiters, unit: 'L', unit_price: transportPrixL, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: true, transport_km: transportKm, transport_conso: transportConso, transport_prix_l: transportPrixL, metal_grid_id: null, metal_lme_price_eur_kg: null, price_pending: false, labor_category: null }] }
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
    const resolvedClientId = clientIdOverride !== undefined ? clientIdOverride : clientId
    const res = await createQuote({ clientId: resolvedClientId || null, title: title || 'Nouveau devis' })
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
      show_section_subtotals: showSectionSubtotals,
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
    if (addingSectionRef.current) return
    addingSectionRef.current = true
    setIsAddingSection(true)
    try {
      const qId = await ensureQuote()
      if (!qId) return
      const pos = sectionsRef.current.length + 1
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
    } finally {
      addingSectionRef.current = false
      setIsAddingSection(false)
    }
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
      unit_cost_ht: currentItem.unit_cost_ht,
      vat_rate: currentItem.vat_rate,
      position: currentItem.position,
      length_m: currentItem.length_m,
      width_m: currentItem.width_m,
      height_m: currentItem.height_m,
      dim_quantity: currentItem.dim_quantity,
      is_internal: currentItem.is_internal,
      metal_grid_id: currentItem.metal_grid_id,
      price_pending: currentItem.price_pending,
      labor_category: currentItem.labor_category,
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

  // internal = true : ligne de coût interne (comptée dans la marge, absente du
  // PDF client). Exposé par le bouton "Coût interne" pour que l'artisan n'ait
  // pas à connaître le bouton œil de chaque ligne.
  async function handleAddFreeItem(sectionTempId: string, internal = false) {
    const qId = await ensureQuote()
    if (!qId) return
    const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)!
    const pos = sec.items.length + 1
    const tempId = `item_${Date.now()}`
    const key = `${sectionTempId}_${tempId}`
    deletedItemKeys.current.delete(key)
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === sectionTempId
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: '', quantity: 1, unit: 'u', unit_price: 0, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: internal, transport_km: null, transport_conso: null, transport_prix_l: null, metal_grid_id: null, metal_lme_price_eur_kg: null, price_pending: false, labor_category: null }] }
        : s
    ))
    const sectionId = await ensureSectionSaved(sectionTempId, qId)
    if (!sectionId) return
    await createQuoteItemAndFinalize(sectionTempId, tempId, qId, sectionId, { quote_id: qId, section_id: sectionId, type: 'custom', description: '', quantity: 1, unit: 'u', unit_price: 0, vat_rate: defaultVatRate, position: pos, is_internal: internal })
  }

  function buildMetalGridLineLabel(grid: MetalPriceGrid) {
    const details = [
      grid.grade,
      grid.thickness_mm ? `${grid.thickness_mm} mm` : null,
      grid.format_label,
    ].filter((detail): detail is string => Boolean(detail))
    return formatGridLabel(grid.label, details)
  }

  // F3 — Pré-remplissage depuis une grille matière (MetalPriceBanner)
  async function handleMetalGridSelect(grid: MetalPriceGrid, lmePriceEurKg: number) {
    const qId = await ensureQuote()
    if (!qId) return
    // Cible : première section disponible, ou on en crée une
    let targetTempId = sectionsRef.current[0]?._tempId
    if (!targetTempId) {
      await handleAddSection()
      targetTempId = sectionsRef.current[0]?._tempId
    }
    if (!targetTempId) return
    const sec = sectionsRef.current.find(s => s._tempId === targetTempId)!
    const pos = sec.items.length + 1
    const tempId = `item_${Date.now()}`
    const proposedPrice = Math.round(lmePriceEurKg * grid.coefficient * 100) / 100
    const lineLabel = buildMetalGridLineLabel(grid)
    // Grille avec épaisseur connue = calcul possible par surface (L × l × épaisseur × densité)
    // dès que l'artisan renseigne les dimensions ; sinon le prix reste le multiplicateur simple.
    const canPriceBySurface = grid.thickness_mm != null && grid.thickness_mm > 0
    deletedItemKeys.current.delete(`${targetTempId}_${tempId}`)
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === targetTempId
        ? { ...s, items: [...s.items, {
            _tempId: tempId, id: null,
            description: lineLabel,
            quantity: 1,
            unit: grid.unit,
            unit_price: proposedPrice,
            unit_cost_ht: null,
            vat_rate: defaultVatRate,
            type: 'material' as const,
            material_id: grid.catalog_item_id ?? null,
            labor_rate_id: null,
            position: pos,
            length_m: null, width_m: null, height_m: null,
            dimension_pricing_mode: canPriceBySurface ? 'area' : null,
            dim_quantity: 1,
            is_estimated: true,
            is_internal: false,
            transport_km: null, transport_conso: null, transport_prix_l: null,
            metal_grid_id: grid.id,
            metal_lme_price_eur_kg: lmePriceEurKg,
            price_pending: false,
            labor_category: null,
          }] }
        : s
    ))
    const sectionId = await ensureSectionSaved(targetTempId, qId)
    if (!sectionId) return
    await createQuoteItemAndFinalize(targetTempId, tempId, qId, sectionId, {
      quote_id: qId, section_id: sectionId,
      type: 'material',
      material_id: grid.catalog_item_id ?? undefined,
      description: lineLabel,
      quantity: 1,
      unit: grid.unit,
      unit_price: proposedPrice,
      vat_rate: defaultVatRate,
      position: pos,
      metal_grid_id: grid.id,
    })
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
      const res = await upsertQuoteItem({
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
        dim_quantity: item.dim_quantity,
        is_internal: item.is_internal,
        metal_grid_id: item.metal_grid_id ?? null,
        price_pending: item.price_pending,
        labor_category: item.labor_category ?? null,
      })
      setSaveStatus(res.error ? 'error' : 'saved')
      if (res.error) setErrorMsg(res.error)
      else setTimeout(() => setSaveStatus('idle'), 2000)
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
    setSaveStatus('saving')
    itemDebounces.current[key] = setTimeout(async () => {
      const qId = quoteIdRef.current
      if (!qId) return
      const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)
      const item = sec?.items.find(i => i._tempId === itemTempId)
      const sectionId = resolvePersistedSectionId(sec)
      if (!item?.id || sectionId === undefined) return
      if (deletedSectionTempIds.current.has(sectionTempId) || deletedItemKeys.current.has(key) || deletedItemIds.current.has(item.id)) return
      const res = await upsertQuoteItem({ id: item.id, quote_id: qId, section_id: sectionId, type: item.type, material_id: item.material_id, labor_rate_id: item.labor_rate_id, description: item.description, quantity: item.quantity, unit: item.unit, unit_price: item.unit_price, unit_cost_ht: item.unit_cost_ht, vat_rate: item.vat_rate, position: item.position, length_m: item.length_m, width_m: item.width_m, height_m: item.height_m, dim_quantity: item.dim_quantity, is_internal: item.is_internal, metal_grid_id: item.metal_grid_id ?? null, price_pending: item.price_pending, labor_category: item.labor_category ?? null })
      setSaveStatus(res.error ? 'error' : 'saved')
      if (res.error) setErrorMsg(res.error)
      else setTimeout(() => setSaveStatus('idle'), 2000)
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

        // Ligne issue d'une grille métal : calcul du poids réel (L × l × épaisseur × densité)
        // plutôt que le multiplicateur "1 pièce" par défaut, quand les données sont disponibles.
        // Source LME (cours du jour) ou manuelle (acier) : même calcul de poids, prix au kg différent.
        const grid = i.metal_grid_id ? metalPriceGrids.find(g => g.id === i.metal_grid_id) : null
        const priceEurKg = grid?.source_type === 'manual' ? grid.manual_price_eur_kg : i.metal_lme_price_eur_kg
        const weightKg = grid && priceEurKg != null
          ? computeMetalWeightKg(grid.metal_code as MetalCode, grid.thickness_mm, nextLength, nextWidth)
          : null
        if (weightKg != null && grid && priceEurKg != null) {
          return {
            ...i,
            [field]: value,
            quantity: weightKg,
            unit: 'kg',
            unit_price: Math.round(priceEurKg * grid.coefficient * 100) / 100,
          }
        }

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
      metal_grid_id: null,
      metal_lme_price_eur_kg: null,
      price_pending: false,
      labor_category: null,
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
          metal_grid_id: item.metal_grid_id ?? null,
          price_pending: item.price_pending,
          labor_category: item.labor_category ?? null,
        }))
      }
    }
    pendingItemKeys.current.clear()
    await Promise.all(saves)
  }

  // ─── Send ─────────────────────────────────────────────────────────────────

  async function saveCurrentMetalSnapshots(qId: string): Promise<string | null> {
    if (!hasMetalPricing || metalPriceGrids.length === 0) return null

    const gridMap = Object.fromEntries(metalPriceGrids.map(g => [g.id, g]))
    const snapshotInputs = sectionsRef.current.flatMap(sec =>
      sec.items
        .filter(item => item.metal_grid_id && item.id)
        .map(item => {
          const grid = gridMap[item.metal_grid_id!]
          if (!grid) return null
          return {
            quote_item_id: item.id!,
            quote_id: qId,
            grid_id: grid.id,
            metal_code: grid.metal_code as import('@/lib/metal-prices').MetalCode,
            coefficient: grid.coefficient,
            validated_price: item.unit_price,
            show_on_pdf: false,
          }
        })
        .filter(Boolean) as import('@/lib/data/mutations/metal-price-snapshots').SnapshotInput[]
    )

    if (snapshotInputs.length === 0) return null
    const result = await saveMetalPriceSnapshots(qId, snapshotInputs)
    return result.error
  }

  function getSelectedClientForSend() {
    return clients.find(c => c.id === clientId) ?? (initialQuote?.client?.id === clientId ? initialQuote.client : null)
  }

  async function prepareQuoteSend(skipEmailCheck = false, skipCheck = false) {
    if (!clientId) {
      setErrorMsg('Veuillez sélectionner un client avant d\'envoyer le devis.')
      return
    }
    const selectedClient = getSelectedClientForSend()
    if (!selectedClient) {
      setErrorMsg('Client introuvable. Sélectionnez à nouveau le client.')
      return
    }
    if (!skipEmailCheck && !selectedClient.email?.trim()) {
      setErrorMsg(null)
      setEmailRequiredOpen(true)
      return
    }
    if (!skipCheck) {
      const warnings: string[] = []
      const allVisible = sections.flatMap(s => s.items.filter(i => !i.is_internal))
      if (allVisible.length === 0) warnings.push('Le devis ne contient aucune ligne visible.')
      const pendingCount = allVisible.filter(i => i.price_pending).length
      if (pendingCount > 0) warnings.push(`${pendingCount} ligne${pendingCount > 1 ? 's' : ''} avec prix à confirmer fournisseur.`)
      if (warnings.length > 0) {
        setCheckWarnings(warnings)
        setCheckModalOpen(true)
        return
      }
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

  async function handleSend() {
    await prepareQuoteSend(false)
  }

  async function handleClientEmailSaved(email: string) {
    setClients(prev => prev.map(client => client.id === clientId ? { ...client, email } : client))
    setEmailRequiredOpen(false)
    await prepareQuoteSend(true)
  }

  async function confirmQuoteSend(selected: Record<string, string[]>) {
    if (!pendingQuoteId) return
    setIsSending(true)
    setSendModalError(null)
    const snapshotError = await saveCurrentMetalSnapshots(pendingQuoteId)
    if (snapshotError) {
      setIsSending(false)
      setSendModalError(snapshotError)
      return
    }
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
    let resolvedClientId: string | null = null
    const matchedClient = findBestClientMatch(clients, getAIClientSearch(aiResult))
    if (matchedClient) {
      resolvedClientId = matchedClient.id
    } else {
      const draftInput = getAIClientDraftInput(aiResult)
      if (draftInput) {
        const res = await createClientInline(draftInput)
        if (res.id) {
          const createdClient: Client = {
            id: res.id,
            organization_id: '',
            type: draftInput.type,
            company_name: draftInput.type === 'company' ? draftInput.company_name || null : null,
            contact_name: draftInput.type === 'company' ? draftInput.contact_name || null : null,
            first_name: draftInput.first_name || null,
            last_name: draftInput.last_name || null,
            email: draftInput.email || null,
            phone: draftInput.phone || null,
            siret: draftInput.type === 'company' ? draftInput.siret || null : null,
            address_line1: draftInput.address_line1 || null,
            postal_code: draftInput.postal_code || null,
            city: draftInput.city || null,
            status: 'prospect',
            source: 'ai_quote',
            total_revenue: 0,
            payment_terms_days: 30,
            internal_notes: null,
            created_at: new Date().toISOString(),
          }
          setClients(prev => [...prev, createdClient])
          resolvedClientId = res.id
        } else if (res.error) {
          setErrorMsg(res.error)
        }
      }
    }

    if (resolvedClientId && resolvedClientId !== clientId) {
      setClientId(resolvedClientId)
      if (quoteIdRef.current) scheduleHeaderSave({ client_id: resolvedClientId })
    }

    const qId = await ensureQuote(resolvedClientId ?? null)
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
          metal_grid_id: null,
          metal_lme_price_eur_kg: null,
          price_pending: false,
          labor_category: null,
        }
        setSectionsSynced(prev => prev.map(s =>
          s._tempId === tempId ? { ...s, items: [...s.items, newItem] } : s
        ))
        await createQuoteItemAndFinalize(tempId, itemTempId, qId, sectionId, {
          quote_id: qId,
          section_id: sectionId,
          type: 'custom',
          designation: aiItem.designation ?? null,
          details: aiItem.details ?? null,
          description: aiItem.description,
          quantity: aiItem.quantity,
          unit: aiItem.unit,
          unit_price: aiItem.unit_price,
          unit_cost_ht: aiItem.unit_cost_ht ?? null,
          vat_rate: aiItem.vat_rate,
          position: itemPos,
          ai_confidence: aiItem.ai_confidence ?? null,
          ai_source: aiItem.ai_source ?? (aiItem.is_estimated ? 'ai_estimate' : null),
          ai_warnings: aiItem.ai_warnings ?? [],
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

    // Find or create "Main d'oeuvre" section
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
      setSectionsSynced(prev => [...prev, { _tempId: sectionTempId, id: null, title: "Main d'oeuvre", position: pos, items: [] }])
      const res = await upsertQuoteSection({ quote_id: qId, title: "Main d'oeuvre", position: pos })
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
        metal_grid_id: null,
        metal_lme_price_eur_kg: null,
        price_pending: false,
        labor_category: 'atelier' as const,
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
        labor_category: 'atelier',
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
        metal_grid_id: null,
        metal_lme_price_eur_kg: null,
        price_pending: false,
        labor_category: null,
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
        const isInternal = pItem.is_internal || isTransport || isEquipment
        const laborCategory = isInternal || pItem.item_type === 'labor'
          ? inferLaborCategory(sectionTitle, pItem.designation)
          : null
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
          is_internal: isInternal,
          transport_km: isTransport ? estimatedKm : null,
          transport_conso: isTransport ? conso : null,
          transport_prix_l: isTransport ? prixL : null,
          metal_grid_id: null,
          metal_lme_price_eur_kg: null,
          price_pending: false,
          labor_category: laborCategory,
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
          labor_category: item.labor_category,
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

  return {
    initialClients,
    initialQuote,
    materials,
    laborRates,
    prestationTypes,
    initialClientId,
    catalogContext,
    modules,
    vatConfig,
    rawReturnTo,
    allQuotes,
    hasMetalPricing,
    metalPriceGrids,
    initialMetalSnapshots,
    clauseTemplates,
    initialVariants,
    initialPriceRequests,
    allSuppliers,
    orgForMentions,
    router,
    isPending,
    startTransition,
    isSending,
    setIsSending,
    isAddingSection,
    setIsAddingSection,
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
    pendingQuoteId,
    setPendingQuoteId,
    checkModalOpen,
    setCheckModalOpen,
    checkWarnings,
    setCheckWarnings,
    clauseModalOpen,
    setClauseModalOpen,
    clauseTarget,
    setClauseTarget,
    saveStatus,
    setSaveStatus,
    errorMsg,
    setErrorMsg,
    defaultVatRate,
    returnTo,
    laborCategoryOptions,
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
    quoteId,
    setQuoteId,
    initialSelectedClientId,
    clientId,
    setClientId,
    title,
    setTitle,
    validityDays,
    setValidityDays,
    initialClientForIntro,
    getIntroForClient,
    clientRequestDescription,
    clientRequestVisibleOnPdf,
    setClientRequestVisibleOnPdf,
    aidLabel,
    setAidLabel,
    aidAmount,
    setAidAmount,
    showAid,
    setShowAid,
    parentQuoteId,
    setParentQuoteId,
    showSectionSubtotals,
    setShowSectionSubtotals,
    variantGroupId,
    variantLabel,
    setVariantLabel,
    variants,
    setVariants,
    variantCreating,
    setVariantCreating,
    variantNewLabel,
    setVariantNewLabel,
    variantModalOpen,
    setVariantModalOpen,
    aidMode,
    setAidMode,
    notesClient,
    setNotesClient,
    introTouchedRef,
    autoIntroMigratedRef,
    selectedClientForIntro,
    generatedIntro,
    sections,
    setSections,
    expandedItems,
    setExpandedItems,
    toggleItemExpand,
    catalogOpen,
    setCatalogOpen,
    catalogTarget,
    setCatalogTarget,
    catalogSearch,
    setCatalogSearch,
    prestationOpen,
    setPrestationOpen,
    prestationSearch,
    setPrestationSearch,
    aiPanelOpen,
    setAIPanelOpen,
    chloeBriefBanner,
    setChloeBriefBanner,
    chloeAutoAnalyze,
    setChloeAutoAnalyze,
    startChoice,
    setStartChoice,
    moaPanelOpen,
    setMoaPanelOpen,
    quoteIdRef,
    sectionsRef,
    headerDebounce,
    addingSectionRef,
    itemDebounces,
    pendingItemKeys,
    deletedSectionTempIds,
    deletedItemKeys,
    deletedItemIds,
    persistedItemIdsByKey,
    pendingCreatedItemSaves,
    pendingDeleteTasks,
    setSectionsSynced,
    handleCreateVariant,
    deleteQuoteItemOrReport,
    deleteQuoteSectionOrReport,
    waitForPendingDeletes,
    getCurrentPersistedItemIds,
    pruneRemovedQuoteItems,
    allItems,
    visibleItems,
    internalItems,
    totalHt,
    totalTva,
    totalTtc,
    totalInternalHt,
    internalOnlyHt,
    internalSaleToDistributeHt,
    margeHt,
    margePct,
    hasInternalItems,
    pendingSupplierPrices,
    canDistributeInternalCosts,
    manualDistributionMode,
    setManualDistributionMode,
    distributionWeights,
    setDistributionWeights,
    distributionKey,
    openManualDistribution,
    closeManualDistribution,
    setDistributionWeight,
    distributionWeightSum,
    distributionWeightValid,
    scrollToQuoteArea,
    handleDistributeInternalCostsIntoVisiblePrices,
    handleMarkInternalSalesAlreadyDistributed,
    showEquipment,
    setShowEquipment,
    equipmentTarget,
    setEquipmentTarget,
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
    isEquipmentLine,
    parseEquipmentAmortization,
    buildEquipmentDescription,
    computeEquipmentCostPerUse,
    handleEquipmentAmortizationChange,
    handleAddEquipment,
    showTransport,
    setShowTransport,
    transportTarget,
    setTransportTarget,
    transportKm,
    setTransportKm,
    transportConso,
    setTransportConso,
    transportPrixL,
    setTransportPrixL,
    transportLiters,
    transportCost,
    handleAddTransport,
    handleTransportMetaChange,
    ensureQuote,
    scheduleHeaderSave,
    syncQuoteHeader,
    handleAddSection,
    handleSectionTitleChange,
    handleRemoveSection,
    ensureSectionSaved,
    finalizeCreatedItem,
    trackCreatedItemSave,
    createQuoteItemAndFinalize,
    waitForPendingCreatedItemSaves,
    handleAddFreeItem,
    buildMetalGridLineLabel,
    handleMetalGridSelect,
    handleItemChange,
    handleRemoveItem,
    scheduleItemSave,
    handleDimChange,
    handleDimQuantityChange,
    handleCatalogSelect,
    flushPendingItemSaves,
    saveCurrentMetalSnapshots,
    getSelectedClientForSend,
    prepareQuoteSend,
    handleSend,
    handleClientEmailSaved,
    confirmQuoteSend,
    handlePreviewPdf,
    handleAIImport,
    handleInsertMOItems,
    handlePrestationSelect,
    catalogFiltered,
  }
}
