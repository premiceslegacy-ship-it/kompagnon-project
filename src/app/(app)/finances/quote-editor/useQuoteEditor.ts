'use client'
// @atelier-migrated
// Logique de l'éditeur de devis : états, sauvegardes différées, ajouts et envoi.
// L'affichage vit dans QuoteEditorClient.tsx ; rien ici ne dépend de la présentation.

import React, { useState, useRef, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'

import type { Client } from '@/lib/data/queries/clients'
import { buildPersonalizedQuoteIntro, isLegacyAutoQuoteIntro } from '@/lib/client'
import { buildMaterialSelectionPricing } from '@/lib/catalog-pricing'
import { computeManualMetalQuantity } from '@/lib/metal-prices'
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

import type { SupplierPriceRequest } from '@/lib/data/mutations/supplier-price-requests'

import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import { saveMetalPriceSnapshots } from '@/lib/data/mutations/metal-price-snapshots'
import type { MetalPriceSnapshotRow } from '@/lib/data/queries/metal-price-snapshots'

import {
  clearQuoteEditorRecoveryDraft,
  readQuoteEditorRecoveryDraft,
  writeQuoteEditorRecoveryDraft,
  type QuoteEditorRecoveryDraft,
  type QuoteEditorRecoveryDraftInput,
  type QuoteEditorRecoveryScope,
} from './quoteEditorRecovery'
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
  recoveryIdentity?: { userId: string | null; organizationId: string | null }
  canUseQuoteAi?: boolean
  canUseQuoteVoice?: boolean
}

export function useQuoteEditor({ clients: initialClients, initialQuote, materials, laborRates, prestationTypes, initialClientId, catalogContext, modules, vatConfig, returnTo: rawReturnTo = null, allQuotes = [], hasMetalPricing = false, metalPriceGrids = [], initialMetalSnapshots = [], clauseTemplates = [], initialVariants = [], initialPriceRequests = [], allSuppliers = [], orgForMentions = null, recoveryIdentity = { userId: null, organizationId: null }, canUseQuoteAi = false, canUseQuoteVoice = false }: QuoteEditorProps) {

  const router = useRouter()
  const canUseQuoteAssistant = modules.quote_ai && canUseQuoteAi
  const canUseQuoteVoiceInput = modules.voice_input && canUseQuoteVoice

  const initialRecoveryScope: QuoteEditorRecoveryScope = {
    ...recoveryIdentity,
    quoteId: initialQuote?.id ?? null,
  }
  const recoveryInitRef = useRef<{ loaded: boolean; scope: QuoteEditorRecoveryScope; draft: QuoteEditorRecoveryDraft | null }>({
    loaded: false,
    scope: initialRecoveryScope,
    draft: null,
  })
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
  const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null)
  const [recoveryRevision, setRecoveryRevision] = useState(0)
  const defaultVatRate = getCatalogDocumentVatRate(vatConfig)
  const returnTo = getSafeReturnTo(rawReturnTo, '/finances?tab=quotes')
  const laborCategoryOptions = getLaborCategoryOptions(catalogContext.businessProfile)

  // Client list (mutable - peut être étendue par création inline)
  const [clients, setClients] = useState<Client[]>(initialClients)

  // Brief Sarah -> Chloé : pré-remplissage au chargement (sessionStorage d'abord, puis ai_briefs en DB)
  useEffect(() => {
    if (initialQuote) return // ne pas écraser un devis existant
    if (!canUseQuoteAssistant) {
      setStartChoice('done')
      return
    }

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

  useEffect(() => {
    if (recoveryInitRef.current.loaded) return
    recoveryInitRef.current.loaded = true
    const draft = initialQuote && initialQuote.status !== 'draft'
      ? null
      : readQuoteEditorRecoveryDraft(browserSessionStorage(), initialRecoveryScope)
    recoveryInitRef.current.draft = draft
    if (!draft) return

    const header = draft.header
    const headerUpdates: Parameters<typeof updateQuote>[1] = {
      title: header.title || 'Nouveau devis',
      client_id: header.clientId || null,
      validity_days: header.validityDays,
      notes_client: header.notesClient,
      client_request_visible_on_pdf: header.clientRequestVisibleOnPdf,
      aid_label: header.aidLabel || null,
      aid_amount: header.aidAmount,
      parent_quote_id: header.parentQuoteId,
      show_section_subtotals: header.showSectionSubtotals,
      variant_label: header.variantLabel || null,
    }
    pendingHeaderUpdatesRef.current = headerUpdates
    draftRevisionRef.current = 1
    for (const field of Object.keys(headerUpdates)) dirtyWritesRef.current.set(`header:${field}`, 1)
    for (const section of draft.sections) {
      if (section._tempId !== '_unsectioned') dirtyWritesRef.current.set(`section:${section._tempId}`, 1)
      for (const item of section.items) dirtyWritesRef.current.set(`item:${section._tempId}_${item._tempId}`, 1)
    }

    const currentSectionIds = new Set(draft.sections.flatMap(section => section.id ? [section.id] : []))
    const currentItemIds = new Set(draft.sections.flatMap(section => section.items.flatMap(item => item.id ? [item.id] : [])))
    for (const sectionId of draft.deletedSectionIds) pendingSectionDeletes.current.add(sectionId)
    for (const itemId of draft.deletedItemIds) {
      deletedItemIds.current.add(itemId)
      pendingItemDeletes.current.add(itemId)
    }
    for (const section of initialQuote?.sections ?? []) {
      if (!currentSectionIds.has(section.id)) {
        pendingSectionDeletes.current.add(section.id)
        dirtyWritesRef.current.set(`delete-section:${section.id}`, 1)
        continue
      }
      for (const item of section.items) {
        if (!currentItemIds.has(item.id)) {
          deletedItemIds.current.add(item.id)
          pendingItemDeletes.current.add(item.id)
          dirtyWritesRef.current.set(`delete-item:${item.id}`, 1)
        }
      }
    }
    for (const item of initialQuote?.unsectionedItems ?? []) {
      if (!currentItemIds.has(item.id)) {
        deletedItemIds.current.add(item.id)
        pendingItemDeletes.current.add(item.id)
        dirtyWritesRef.current.set(`delete-item:${item.id}`, 1)
      }
    }
    for (const sectionId of pendingSectionDeletes.current) dirtyWritesRef.current.set(`delete-section:${sectionId}`, 1)
    for (const itemId of pendingItemDeletes.current) dirtyWritesRef.current.set(`delete-item:${itemId}`, 1)
    requiresExplicitSaveRef.current = true
    setTitle(header.title)
    setClientId(header.clientId)
    setValidityDays(header.validityDays)
    setNotesClient(header.notesClient)
    setClientRequestVisibleOnPdf(header.clientRequestVisibleOnPdf)
    setAidLabel(header.aidLabel)
    setAidAmount(header.aidAmount)
    setShowAid(header.showAid)
    setAidMode(header.aidMode)
    setParentQuoteId(header.parentQuoteId)
    setShowSectionSubtotals(header.showSectionSubtotals)
    setVariantLabel(header.variantLabel)
    setSectionsSynced(draft.sections)
    setSaveStatus('error')
    setErrorMsg('Un brouillon local a été récupéré. Enregistrez-le pour le synchroniser.')
    setRecoveryRevision(1)
  }, [])

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
    !initialQuote && canUseQuoteAssistant ? 'checking' : 'done'
  )

  // Labour estimate panel
  const [moaPanelOpen, setMoaPanelOpen] = useState(false)

  // Refs for stale closure avoidance in debounces
  const quoteIdRef = useRef(quoteId)
  const sectionsRef = useRef(sections)
  useEffect(() => { quoteIdRef.current = quoteId }, [quoteId])
  useEffect(() => { sectionsRef.current = sections }, [sections])

  const pendingHeaderUpdatesRef = useRef<Parameters<typeof updateQuote>[1]>({})
  const pendingHeaderWriteRef = useRef<Promise<unknown> | null>(null)
  const headerDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const addingSectionRef = useRef(false)
  const itemDebounces = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const pendingItemKeys = useRef<Set<string>>(new Set())
  const pendingItemWrites = useRef(new Set<Promise<string | null>>())
  const pendingItemWritesByKey = useRef(new Map<string, Promise<string | null>>())
  const deletedSectionTempIds = useRef<Set<string>>(new Set())
  const deletedItemKeys = useRef<Set<string>>(new Set())
  const deletedItemIds = useRef<Set<string>>(new Set())
  const persistedItemIdsByKey = useRef<Map<string, string>>(new Map())
  const pendingCreatedItemSaves = useRef<Set<Promise<void>>>(new Set())
  const pendingDeleteTasks = useRef<Set<Promise<unknown>>>(new Set())
  const draftRevisionRef = useRef(0)
  const dirtyWritesRef = useRef(new Map<string, number>())
  const writeFailuresRef = useRef(new Map<string, string>())
  const requiresExplicitSaveRef = useRef(false)
  const pendingSectionWrites = useRef(new Set<Promise<void>>())
  const pendingSectionDeletes = useRef(new Set<string>())
  const pendingItemDeletes = useRef(new Set<string>())
  const recoveryUnavailableRef = useRef(false)
  const recoveryLastSignatureRef = useRef('')
  const recoveryActiveScopeRef = useRef(initialRecoveryScope)

  function browserSessionStorage(): Storage | null {
    try { return typeof window === 'undefined' ? null : window.sessionStorage } catch { return null }
  }

  function currentRecoveryScope(id = quoteIdRef.current): QuoteEditorRecoveryScope {
    return { ...recoveryIdentity, quoteId: id }
  }
  function currentRecoveryDraft(): QuoteEditorRecoveryDraftInput {
    const currentSections = sectionsRef.current
    const currentSectionIds = new Set(currentSections.flatMap(section => section.id ? [section.id] : []))
    const currentItemIds = new Set(currentSections.flatMap(section => section.items.flatMap(item => item.id ? [item.id] : [])))
    const deletedSectionIds = new Set(pendingSectionDeletes.current)
    const deletedItemIdsForRecovery = new Set([...deletedItemIds.current, ...pendingItemDeletes.current])
    for (const section of initialQuote?.sections ?? []) {
      if (!currentSectionIds.has(section.id)) {
        deletedSectionIds.add(section.id)
        continue
      }
      for (const item of section.items) {
        if (!currentItemIds.has(item.id)) deletedItemIdsForRecovery.add(item.id)
      }
    }
    for (const item of initialQuote?.unsectionedItems ?? []) {
      if (!currentItemIds.has(item.id)) deletedItemIdsForRecovery.add(item.id)
    }
    return {
      header: {
        title,
        clientId,
        validityDays,
        notesClient,
        clientRequestVisibleOnPdf,
        aidLabel,
        aidAmount,
        showAid,
        aidMode,
        parentQuoteId,
        showSectionSubtotals,
        variantLabel,
      },
      sections: currentSections,
      deletedSectionIds: [...deletedSectionIds],
      deletedItemIds: [...deletedItemIdsForRecovery],
    }
  }

  function confirmUnsavedNavigation(): boolean {
    if (!recoveryUnavailableRef.current) return true
    return typeof window !== 'undefined' && window.confirm(
      'Le navigateur n’a pas pu conserver ce brouillon local. Quitter cette page peut perdre des modifications non synchronisées. Quitter quand même ?',
    )
  }

  function clearRecoveryIfClean() {
    if (dirtyWritesRef.current.size > 0 || writeFailuresRef.current.size > 0) return
    const storage = browserSessionStorage()
    clearQuoteEditorRecoveryDraft(storage, currentRecoveryScope())
    clearQuoteEditorRecoveryDraft(storage, { ...recoveryIdentity, quoteId: null })
    requiresExplicitSaveRef.current = false
    recoveryUnavailableRef.current = false
    setRecoveryWarning(null)
    deletedItemIds.current.clear()
    deletedItemKeys.current.clear()
    deletedSectionTempIds.current.clear()
    pendingItemDeletes.current.clear()
    pendingSectionDeletes.current.clear()
  }

  function markWriteDirty(key: string): number {
    const revision = ++draftRevisionRef.current
    dirtyWritesRef.current.set(key, revision)
    setRecoveryRevision(revision)
    if (writeFailuresRef.current.size === 0) {
      setErrorMsg(null)
      setSaveStatus('saving')
    }
    return revision
  }

  function recordWriteFailure(key: string, message: string) {
    const error = /an unexpected response was received from the server/i.test(message)
      ? 'La sauvegarde a échoué. Votre saisie reste dans cet onglet. Vérifiez votre connexion ou reconnectez-vous, puis réessayez.'
      : message || 'Impossible d’enregistrer les modifications.'
    writeFailuresRef.current.set(key, error)
    requiresExplicitSaveRef.current = true
    setSaveStatus('error')
    setErrorMsg(error)
  }

  function markWriteSaved(key: string, revision?: number) {
    if (revision == null || dirtyWritesRef.current.get(key) === revision) dirtyWritesRef.current.delete(key)
    writeFailuresRef.current.delete(key)
    if (writeFailuresRef.current.size > 0) {
      setSaveStatus('error')
      setErrorMsg([...writeFailuresRef.current.values()][0])
      requiresExplicitSaveRef.current = true
      return
    }
    if (dirtyWritesRef.current.size === 0) {
      clearRecoveryIfClean()
      setErrorMsg(null)
      setSaveStatus('saved')
      setTimeout(() => {
        if (dirtyWritesRef.current.size === 0 && writeFailuresRef.current.size === 0) setSaveStatus('idle')
      }, 2000)
    }
  }

  function getWriteFailure(): string | null {
    return writeFailuresRef.current.values().next().value ?? null
  }

  useEffect(() => {
    const scope = currentRecoveryScope(quoteId)
    const previousScope = recoveryActiveScopeRef.current
    const draft = currentRecoveryDraft()
    const signature = JSON.stringify(draft)
    const changed = signature !== recoveryLastSignatureRef.current
    const storage = browserSessionStorage()
    let saved = false

    if (dirtyWritesRef.current.size > 0) {
      if (changed || previousScope.quoteId !== scope.quoteId) {
        saved = writeQuoteEditorRecoveryDraft(storage, scope, draft)
        recoveryUnavailableRef.current = !saved
        setRecoveryWarning(saved ? null : 'Le navigateur n’a pas pu enregistrer ce brouillon local. Gardez cette page ouverte et enregistrez le devis avant de partir.')
      }
    } else {
      clearQuoteEditorRecoveryDraft(storage, scope)
      recoveryUnavailableRef.current = false
      setRecoveryWarning(null)
      saved = true
    }
    if (previousScope.quoteId !== scope.quoteId && saved) clearQuoteEditorRecoveryDraft(storage, previousScope)
    recoveryLastSignatureRef.current = signature
    recoveryActiveScopeRef.current = scope
  }, [
    quoteId, recoveryRevision, sections, title, clientId, validityDays, notesClient,
    clientRequestVisibleOnPdf, aidLabel, aidAmount, showAid, aidMode, parentQuoteId,
    showSectionSubtotals, variantLabel,
  ])
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!recoveryUnavailableRef.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    const guardInternalLinks = (event: MouseEvent) => {
      if (!recoveryUnavailableRef.current || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const target = event.target
      if (!(target instanceof Element)) return
      const anchor = target.closest('a[href]')
      if (!(anchor instanceof HTMLAnchorElement) || (anchor.target && anchor.target !== '_self')) return
      const destination = new URL(anchor.href, window.location.href)
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return
      if (!window.confirm('Le navigateur n’a pas pu conserver ce brouillon local. Quitter cette page peut perdre des modifications non synchronisées. Quitter quand même ?')) {
        event.preventDefault()
        event.stopImmediatePropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', guardInternalLinks, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', guardInternalLinks, true)
    }
  }, [])



  function setSectionsSynced(updater: React.SetStateAction<LocalSection[]>) {
    setSections(prev => {
      const next = typeof updater === 'function'
        ? (updater as (value: LocalSection[]) => LocalSection[])(prev)
        : updater
      sectionsRef.current = next
      return next
    })
  }

  function trackSectionWrite(
    key: string,
    revision: number,
    task: Promise<{ error: string | null; sectionId?: string | null }>,
  ): Promise<void> {
    const tracked = task.then(res => {
      if (res.error || !res.sectionId) {
        recordWriteFailure(key, res.error ?? 'Impossible d’enregistrer le lot.')
      } else {
        markWriteSaved(key, revision)
      }
    }).catch(error => {
      recordWriteFailure(key, error instanceof Error ? error.message : String(error))
    }).finally(() => {
      pendingSectionWrites.current.delete(tracked)
    })
    pendingSectionWrites.current.add(tracked)
    return tracked
  }

  function quoteItemPayload(qId: string, sectionId: string | null, item: LocalItem, id = item.id ?? crypto.randomUUID()) {
    return {
      id,
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
    }
  }

  async function handleCreateVariant() {
    if (!quoteId || !variantNewLabel.trim() || !confirmUnsavedNavigation()) return
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

  async function deleteQuoteItemOrReport(itemId: string, qId: string, revision?: number) {
    const key = `delete-item:${itemId}`
    const writeRevision = revision ?? markWriteDirty(key)
    pendingItemDeletes.current.add(itemId)
    const task = (async () => {
      try {
        const res = await deleteQuoteItem(itemId, qId)
        if (res.error) {
          console.error('[deleteQuoteItem]', res.error)
          recordWriteFailure(key, res.error)
        } else {
          pendingItemDeletes.current.delete(itemId)
          markWriteSaved(key, writeRevision)
        }
        return res
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordWriteFailure(key, message)
        return { error: message }
      }
    })()
    pendingDeleteTasks.current.add(task)
    task.finally(() => pendingDeleteTasks.current.delete(task))
    return task
  }

  async function deleteQuoteSectionOrReport(sectionId: string, revision?: number) {
    const key = `delete-section:${sectionId}`
    const writeRevision = revision ?? markWriteDirty(key)
    pendingSectionDeletes.current.add(sectionId)
    const task = (async () => {
      try {
        const res = await deleteQuoteSection(sectionId)
        if (res.error) {
          console.error('[deleteQuoteSection]', res.error)
          recordWriteFailure(key, res.error)
        } else {
          pendingSectionDeletes.current.delete(sectionId)
          markWriteSaved(key, writeRevision)
        }
        return res
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        recordWriteFailure(key, message)
        return { error: message }
      }
    })()
    pendingDeleteTasks.current.add(task)
    task.finally(() => pendingDeleteTasks.current.delete(task))
    return task
  }

  async function waitForPendingDeletes(): Promise<string | null> {
    while (pendingDeleteTasks.current.size > 0) {
      await Promise.allSettled([...pendingDeleteTasks.current])
    }
    return getWriteFailure()
  }

  async function waitForPendingSectionWrites(): Promise<string | null> {
    while (pendingSectionWrites.current.size > 0) {
      await Promise.allSettled([...pendingSectionWrites.current])
    }
    return getWriteFailure()
  }

  function getCurrentPersistedItemIds() {
    return sectionsRef.current
      .flatMap(section => section.items)
      .map(item => item.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0 && !deletedItemIds.current.has(id))
  }

  async function pruneRemovedQuoteItems(qId: string) {
    const key = 'prune'
    const revision = dirtyWritesRef.current.get(key) ?? markWriteDirty(key)
    try {
      const res = await pruneQuoteItems(qId, getCurrentPersistedItemIds())
      if (res.error) {
        console.error('[pruneQuoteItems]', res.error)
        recordWriteFailure(key, res.error)
      } else {
        markWriteSaved(key, revision)
      }
      return res
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordWriteFailure(key, message)
      return { error: message }
    }
  }

  // ─── Totals ──────────────────────────────────────────────────────────────

  const { allItems, visibleItems, internalItems, totalHt, totalTva, totalTtc, totalInternalHt, internalOnlyHt, internalSaleToDistributeHt, margeHt, margePct, hasInternalItems, pendingSupplierPrices, canDistributeInternalCosts } = computeQuoteTotals(sections)

  // ─── Répartition manuelle de la marge interne ─────────────────────────────
  // Par défaut la répartition reste automatique (au prorata du HT visible).
  // En mode manuel, l'artisan choisit le poids (%) de chaque ligne visible ;
  // la somme doit faire 100 % avant de pouvoir répartir.
  const [manualDistributionMode, setManualDistributionMode] = useState(false)
  const [distributionConfirm, setDistributionConfirm] = useState<{ kind: 'distribute' | 'integrate'; title: string; message: string } | null>(null)
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

  function handleDistributeInternalCostsIntoVisiblePrices(skipConfirm = false) {
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

    if (!skipConfirm) {
      setDistributionConfirm({
        kind: 'distribute',
        title: 'Répartir le montant interne ?',
        message: useManualWeights
          ? `Répartir ${fmt(internalTotal)} HT de montant interne selon les poids choisis ? Les lignes internes resteront masquées et leur coût de revient restera utilisé pour la marge.`
          : `Répartir ${fmt(internalTotal)} HT de montant interne vendu dans les prix des lignes visibles ? Les lignes internes resteront masquées et leur coût de revient restera utilisé pour la marge.`,
      })
      return
    }

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

  function handleMarkInternalSalesAlreadyDistributed(skipConfirm = false) {
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

    if (!skipConfirm) {
      setDistributionConfirm({
        kind: 'integrate',
        title: 'Marquer comme intégré ?',
        message: `Marquer ${fmt(internalTotal)} HT comme déjà répartis ? Les prix visibles ne seront pas modifiés. Les lignes internes garderont leur coût de revient pour la marge.`,
      })
      return
    }

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
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: desc, quantity: 1, unit: 'usage', unit_price: equipmentCostPerUse, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: true, transport_km: null, transport_conso: null, transport_prix_l: null, metal_grid_id: null, price_pending: false, labor_category: null }] }
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
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: desc, quantity: transportLiters, unit: 'L', unit_price: transportPrixL, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: true, transport_km: transportKm, transport_conso: transportConso, transport_prix_l: transportPrixL, metal_grid_id: null, price_pending: false, labor_category: null }] }
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
    try {
      const res = await createQuote({ clientId: resolvedClientId || null, title: title || 'Nouveau devis' })
      if (res.error || !res.quoteId) {
        recordWriteFailure('quote:create', res.error ?? 'Impossible de créer le devis.')
        return null
      }
      setQuoteId(res.quoteId)
      quoteIdRef.current = res.quoteId
      // Mettre à jour l'URL sans déclencher un re-render SSC (évite la réinitialisation du state client)
      const nextUrl = new URL('/finances/quote-editor', window.location.origin)
      nextUrl.searchParams.set('id', res.quoteId)
      nextUrl.searchParams.set('returnTo', returnTo)
      window.history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}`)
      if (!requiresExplicitSaveRef.current) {
        const updates = pendingHeaderUpdatesRef.current
        const versions = Object.keys(updates).map(field => {
          const key = `header:${field}`
          return [key, dirtyWritesRef.current.get(key)] as const
        })
        if (versions.length > 0) {
          pendingHeaderUpdatesRef.current = {}
          const headerResult = await enqueueHeaderWrite(res.quoteId, updates, versions)
          if (headerResult.error) return null
        }
      }
      return res.quoteId
    } catch (error) {
      recordWriteFailure('quote:create', error instanceof Error ? error.message : String(error))
      return null
    }
  }

  // ─── Header auto-save ─────────────────────────────────────────────────────

  function enqueueHeaderWrite(
    quoteId: string,
    updates: Parameters<typeof updateQuote>[1],
    versions: readonly (readonly [string, number | undefined])[],
  ) {
    const previous = pendingHeaderWriteRef.current
    const task = (async () => {
      if (previous) await previous
      try {
        const res = await updateQuote(quoteId, updates)
        if (res.error) {
          for (const [key, revision] of versions) {
            if (revision != null) recordWriteFailure(key, res.error)
          }
          if (versions.every(([, revision]) => revision == null)) recordWriteFailure('header:sync', res.error)
        } else {
          for (const [key, revision] of versions) {
            if (revision != null) markWriteSaved(key, revision)
          }
        }
        return res
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        for (const [key, revision] of versions) {
          if (revision != null) recordWriteFailure(key, message)
        }
        if (versions.every(([, revision]) => revision == null)) recordWriteFailure('header:sync', message)
        return { error: message }
      }
    })()
    pendingHeaderWriteRef.current = task
    void task.finally(() => {
      if (pendingHeaderWriteRef.current === task) pendingHeaderWriteRef.current = null
    })
    return task
  }

  function scheduleHeaderSave(updates: Parameters<typeof updateQuote>[1]) {
    for (const field of Object.keys(updates)) markWriteDirty(`header:${field}`)
    pendingHeaderUpdatesRef.current = { ...pendingHeaderUpdatesRef.current, ...updates }
    clearTimeout(headerDebounce.current ?? undefined)
    if (!quoteIdRef.current) return
    headerDebounce.current = setTimeout(() => {
      headerDebounce.current = null
      const qId = quoteIdRef.current
      if (!qId) return
      const queuedUpdates = pendingHeaderUpdatesRef.current
      const versions = Object.keys(queuedUpdates).map(field => {
        const key = `header:${field}`
        return [key, dirtyWritesRef.current.get(key)] as const
      })
      pendingHeaderUpdatesRef.current = {}
      void enqueueHeaderWrite(qId, queuedUpdates, versions)
    }, 1000)
  }

  async function syncQuoteHeader(quoteId: string) {
    clearTimeout(headerDebounce.current ?? undefined)
    headerDebounce.current = null
    pendingHeaderUpdatesRef.current = {}
    const updates = {
      title: title || 'Nouveau devis',
      client_id: clientId || null,
      validity_days: validityDays,
      notes_client: notesClient,
      client_request_visible_on_pdf: clientRequestVisibleOnPdf,
      aid_label: aidLabel || null,
      aid_amount: aidAmount,
      parent_quote_id: parentQuoteId,
      show_section_subtotals: showSectionSubtotals,
      variant_label: variantLabel || null,
    }
    const versions = Object.keys(updates).map(field => {
      const key = `header:${field}`
      return [key, dirtyWritesRef.current.get(key)] as const
    })
    return enqueueHeaderWrite(quoteId, updates, versions)
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
      const sectionId = crypto.randomUUID()
      deletedSectionTempIds.current.delete(tempId)
      setSectionsSynced(prev => [...prev, { _tempId: tempId, id: sectionId, title: `Section ${pos}`, position: pos, items: [] }])
      const key = `section:${tempId}`
      const revision = markWriteDirty(key)
      startTransition(async () => {
        const task = upsertQuoteSection({ id: sectionId, quote_id: qId, title: `Section ${pos}`, position: pos })
        await trackSectionWrite(key, revision, task)
        if (deletedSectionTempIds.current.has(tempId)) await deleteQuoteSectionOrReport(sectionId)
      })
    } catch (error) {
      recordWriteFailure('section:create', error instanceof Error ? error.message : String(error))
    } finally {
      addingSectionRef.current = false
      setIsAddingSection(false)
    }
  }

  function handleSectionTitleChange(tempId: string, newTitle: string) {
    setSectionsSynced(prev => prev.map(s => s._tempId === tempId ? { ...s, title: newTitle } : s))
    const sec = sectionsRef.current.find(s => s._tempId === tempId)
    const key = `section:${tempId}`
    const revision = markWriteDirty(key)
    if (!sec?.id || !quoteIdRef.current) return
    const sectionId = sec.id
    const qId = quoteIdRef.current
    startTransition(async () => {
      await trackSectionWrite(
        key,
        revision,
        upsertQuoteSection({ id: sectionId, quote_id: qId, title: newTitle, position: sec.position }),
      )
    })
  }

  async function handleRemoveSection(tempId: string) {
    const sec = sections.find(s => s._tempId === tempId)
    deletedSectionTempIds.current.add(tempId)
    const deleteKey = sec?.id ? `delete-section:${sec.id}` : null
    const deleteRevision = deleteKey ? markWriteDirty(deleteKey) : null
    if (sec?.id) pendingSectionDeletes.current.add(sec.id)
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
    const sectionWriteKey = `section:${tempId}`
    if (sec?.id) {
      startTransition(async () => {
        await waitForPendingCreatedItemSaves()
        while (pendingItemWrites.current.size > 0) {
          await Promise.allSettled([...pendingItemWrites.current])
        }
        await waitForPendingSectionWrites()
        await waitForPendingDeletes()
        const res = await deleteQuoteSectionOrReport(sec.id!, deleteRevision ?? undefined)
        if (res.error) return
        markWriteSaved(sectionWriteKey, dirtyWritesRef.current.get(sectionWriteKey))
        for (const item of sec.items) {
          const itemKey = `${tempId}_${item._tempId}`
          markWriteSaved(`item:${itemKey}`, dirtyWritesRef.current.get(`item:${itemKey}`))
        }
      })
    } else {
      markWriteSaved(sectionWriteKey, dirtyWritesRef.current.get(sectionWriteKey))
      for (const item of sec?.items ?? []) {
        const itemKey = `${tempId}_${item._tempId}`
        markWriteSaved(`item:${itemKey}`, dirtyWritesRef.current.get(`item:${itemKey}`))
      }
    }
  }

  // ─── Item mutations ───────────────────────────────────────────────────────

  async function ensureSectionSaved(sectionTempId: string, qId: string): Promise<string | null> {
    if (deletedSectionTempIds.current.has(sectionTempId)) return null
    const sec = sectionsRef.current.find(s => s._tempId === sectionTempId)
    if (!sec) return null
    if (sec.id) return sec.id
    const sectionId = crypto.randomUUID()
    setSectionsSynced(prev => prev.map(s => s._tempId === sectionTempId ? { ...s, id: sectionId } : s))
    const key = `section:${sectionTempId}`
    const revision = dirtyWritesRef.current.get(key) ?? markWriteDirty(key)
    try {
      const res = await upsertQuoteSection({ id: sectionId, quote_id: qId, title: sec.title, position: sec.position })
      if (res.error || !res.sectionId) {
        recordWriteFailure(key, res.error ?? 'Impossible d’enregistrer le lot.')
        return null
      }
      const stillExists = !deletedSectionTempIds.current.has(sectionTempId) && sectionsRef.current.some(s => s._tempId === sectionTempId)
      if (!stillExists) {
        await deleteQuoteSectionOrReport(sectionId)
        return null
      }
      markWriteSaved(key, revision)
      return sectionId
    } catch (error) {
      recordWriteFailure(key, error instanceof Error ? error.message : String(error))
      return null
    }
  }

  async function saveLocalItem(
    sectionTempId: string,
    itemTempId: string,
    qId: string,
    revision: number | undefined,
  ): Promise<string | null> {
    const section = sectionsRef.current.find(s => s._tempId === sectionTempId)
    const item = section?.items.find(i => i._tempId === itemTempId)
    const key = `${sectionTempId}_${itemTempId}`
    const writeKey = `item:${key}`
    if (!section || !item) return null
    if (deletedSectionTempIds.current.has(sectionTempId) || deletedItemKeys.current.has(key) || (item.id && deletedItemIds.current.has(item.id))) return null

    let sectionId: string | null
    if (section._tempId === '_unsectioned') {
      sectionId = null
    } else {
      sectionId = await ensureSectionSaved(sectionTempId, qId)
      if (!sectionId) return getWriteFailure() ?? 'Impossible d’enregistrer le lot.'
    }

    const itemId = item.id ?? crypto.randomUUID()
    if (item.id !== itemId) {
      setSectionsSynced(prev => prev.map(s => s._tempId === sectionTempId
        ? { ...s, items: s.items.map(i => i._tempId === itemTempId ? { ...i, id: itemId } : i) }
        : s))
    }
    try {
      const res = await upsertQuoteItem(quoteItemPayload(qId, sectionId, item, itemId))
      if (res.error || !res.itemId) {
        const message = res.error ?? 'Impossible d’enregistrer la ligne.'
        recordWriteFailure(writeKey, message)
        return message
      }
      if (deletedItemKeys.current.has(key) || deletedItemIds.current.has(itemId) || deletedSectionTempIds.current.has(sectionTempId)) {
        pendingItemKeys.current.delete(key)
        await deleteQuoteItemOrReport(itemId, qId)
        return getWriteFailure()
      }
      persistedItemIdsByKey.current.set(key, itemId)
      pendingItemKeys.current.delete(key)
      markWriteSaved(writeKey, revision)
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      recordWriteFailure(writeKey, message)
      return message
    }
  }

  function trackItemWrite(sectionTempId: string, itemTempId: string, qId: string, revision?: number) {
    const key = `${sectionTempId}_${itemTempId}`
    const previous = pendingItemWritesByKey.current.get(key)
    const task = (async () => {
      if (previous) await previous
      return saveLocalItem(sectionTempId, itemTempId, qId, revision)
    })()
    pendingItemWritesByKey.current.set(key, task)
    pendingItemWrites.current.add(task)
    task.finally(() => {
      pendingItemWrites.current.delete(task)
      if (pendingItemWritesByKey.current.get(key) === task) pendingItemWritesByKey.current.delete(key)
    })
    return task
  }

  async function finalizeCreatedItem(
    sectionTempId: string,
    itemTempId: string,
    itemId: string,
    qId: string,
    _sectionId: string,
    revision: number,
  ) {
    const key = `${sectionTempId}_${itemTempId}`
    const writeKey = `item:${key}`
    persistedItemIdsByKey.current.set(key, itemId)
    const currentItem = sectionsRef.current.find(s => s._tempId === sectionTempId)?.items.find(i => i._tempId === itemTempId)

    if (deletedSectionTempIds.current.has(sectionTempId) || deletedItemKeys.current.has(key) || deletedItemIds.current.has(itemId) || !currentItem) {
      await deleteQuoteItemOrReport(itemId, qId)
      return
    }

    setSectionsSynced(prev => prev.map(s =>
      s._tempId === sectionTempId
        ? { ...s, items: s.items.map(i => i._tempId === itemTempId ? { ...i, id: itemId } : i) }
        : s
    ))

    if (!pendingItemKeys.current.has(key)) {
      markWriteSaved(writeKey, revision)
      return
    }

    clearTimeout(itemDebounces.current[key])
    delete itemDebounces.current[key]
    await saveLocalItem(sectionTempId, itemTempId, qId, dirtyWritesRef.current.get(writeKey))
  }

  function trackCreatedItemSave(key: string, task: Promise<void>) {
    const writeTask = task.then(() => null)
    pendingCreatedItemSaves.current.add(task)
    pendingItemWrites.current.add(writeTask)
    pendingItemWritesByKey.current.set(key, writeTask)
    task.finally(() => pendingCreatedItemSaves.current.delete(task))
    writeTask.finally(() => {
      pendingItemWrites.current.delete(writeTask)
      if (pendingItemWritesByKey.current.get(key) === writeTask) pendingItemWritesByKey.current.delete(key)
    })
    return task
  }

  async function createQuoteItemAndFinalize(
    sectionTempId: string,
    itemTempId: string,
    qId: string,
    sectionId: string,
    item: Parameters<typeof upsertQuoteItem>[0],
  ) {
    const key = `${sectionTempId}_${itemTempId}`
    const writeKey = `item:${key}`
    const localItem = sectionsRef.current.find(s => s._tempId === sectionTempId)?.items.find(i => i._tempId === itemTempId)
    const itemId = localItem?.id ?? item.id ?? crypto.randomUUID()
    const revision = dirtyWritesRef.current.get(writeKey) ?? markWriteDirty(writeKey)
    setSectionsSynced(prev => prev.map(s => s._tempId === sectionTempId
      ? { ...s, items: s.items.map(i => i._tempId === itemTempId ? { ...i, id: itemId } : i) }
      : s))
    const previous = pendingItemWritesByKey.current.get(key)
    const task = (async () => {
      if (previous) await previous
      try {
        const res = await upsertQuoteItem({ ...item, id: itemId })
        if (res.error || !res.itemId) {
          const message = res.error ?? 'Impossible d’enregistrer la ligne.'
          pendingItemKeys.current.add(key)
          recordWriteFailure(writeKey, message)
          return
        }
        await finalizeCreatedItem(sectionTempId, itemTempId, itemId, qId, sectionId, revision)
      } catch (error) {
        pendingItemKeys.current.add(key)
        recordWriteFailure(writeKey, error instanceof Error ? error.message : String(error))
      }
    })()
    return trackCreatedItemSave(key, task)
  }

  async function waitForPendingCreatedItemSaves(): Promise<string | null> {
    while (pendingCreatedItemSaves.current.size > 0) {
      await Promise.allSettled([...pendingCreatedItemSaves.current])
    }
    return getWriteFailure()
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
        ? { ...s, items: [...s.items, { _tempId: tempId, id: null, description: '', quantity: 1, unit: 'u', unit_price: 0, unit_cost_ht: null, vat_rate: defaultVatRate, type: 'custom' as const, material_id: null, labor_rate_id: null, position: pos, length_m: null, width_m: null, height_m: null, dimension_pricing_mode: null, dim_quantity: 1, is_estimated: false, is_internal: internal, transport_km: null, transport_conso: null, transport_prix_l: null, metal_grid_id: null, price_pending: false, labor_category: null }] }
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
  async function handleMetalGridSelect(grid: MetalPriceGrid) {
    const manualPrice = Number(grid.manual_price_eur_kg)
    if (grid.source_type !== 'manual' || !Number.isFinite(manualPrice) || manualPrice <= 0) {
      setErrorMsg('Renseignez un prix manuel valide pour cette grille.')
      return
    }
    const proposedPrice = roundCurrency(manualPrice)
    if (!Number.isFinite(proposedPrice) || proposedPrice <= 0) {
      setErrorMsg('Ce prix est trop faible pour un tarif de devis au centime. Choisissez une unité adaptée.')
      return
    }
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
    const lineLabel = buildMetalGridLineLabel(grid)
    const dimensionMode = grid.unit === 'm²'
      || (grid.unit === 'kg' && grid.thickness_mm !== null && grid.thickness_mm > 0)
      ? 'area' : grid.unit === 'ml' ? 'linear' : null
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
            dimension_pricing_mode: dimensionMode,
            dim_quantity: 1,
            is_estimated: false,
            is_internal: false,
            transport_km: null, transport_conso: null, transport_prix_l: null,
            metal_grid_id: grid.id,
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
    if (field === 'quantity' && typeof value === 'number') {
      const quantity = Math.round((value + Number.EPSILON) * 1000) / 1000
      if (!Number.isFinite(quantity)) {
        setErrorMsg('La quantité doit être un nombre fini.')
        return
      }
      value = quantity
    }
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === sectionTempId
        ? { ...s, items: s.items.map(i => i._tempId === itemTempId
            ? { ...i, [field]: value, ...(field === 'unit_price' ? { is_estimated: false } : {}) }
            : i) }
        : s
    ))
    scheduleItemSave(sectionTempId, itemTempId)
  }

  async function handleRemoveItem(sectionTempId: string, itemTempId: string) {
    const sec = sections.find(s => s._tempId === sectionTempId)
    const item = sec?.items.find(i => i._tempId === itemTempId)
    // Annuler le debounce de sauvegarde avant de supprimer
    const key = `${sectionTempId}_${itemTempId}`
    let persistedItemId = item?.id ?? persistedItemIdsByKey.current.get(key)
    const deleteRevision = persistedItemId ? markWriteDirty(`delete-item:${persistedItemId}`) : null
    if (persistedItemId) {
      deletedItemIds.current.add(persistedItemId)
      pendingItemDeletes.current.add(persistedItemId)
    }
    if (itemDebounces.current[key]) {
      clearTimeout(itemDebounces.current[key])
      delete itemDebounces.current[key]
    }
    pendingItemKeys.current.delete(key)
    setSectionsSynced(prev => prev.map(s =>
      s._tempId === sectionTempId ? { ...s, items: s.items.filter(i => i._tempId !== itemTempId) } : s
    ))
    const writeKey = `item:${key}`
    const qId = quoteIdRef.current
    if (qId) {
      await waitForPendingCreatedItemSaves()
      const pendingWrite = pendingItemWritesByKey.current.get(key)
      if (pendingWrite) await pendingWrite
      persistedItemId ??= persistedItemIdsByKey.current.get(key)
      if (persistedItemId && (deleteRevision != null || !pendingItemDeletes.current.has(persistedItemId))) {
        await deleteQuoteItemOrReport(persistedItemId, qId, deleteRevision ?? undefined)
      }
      const deleteError = await waitForPendingDeletes()
      if (deleteError) setErrorMsg(deleteError)
      if (!persistedItemId || !pendingItemDeletes.current.has(persistedItemId)) {
        markWriteSaved(writeKey, dirtyWritesRef.current.get(writeKey))
      }
      const pruneResult = await pruneRemovedQuoteItems(qId)
      if (pruneResult.error) setErrorMsg(pruneResult.error)
    } else {
      markWriteSaved(writeKey, dirtyWritesRef.current.get(writeKey))
    }
  }

  // ─── Dimensions (linear / area / volume) ──────────────────────────────────

  function scheduleItemSave(sectionTempId: string, itemTempId: string) {
    const key = `${sectionTempId}_${itemTempId}`
    const writeKey = `item:${key}`
    const revision = markWriteDirty(writeKey)
    pendingItemKeys.current.add(key)
    clearTimeout(itemDebounces.current[key])
    const timer = setTimeout(() => {
      if (itemDebounces.current[key] === timer) delete itemDebounces.current[key]
      const qId = quoteIdRef.current
      if (qId) void trackItemWrite(sectionTempId, itemTempId, qId, revision)
    }, 800)
    itemDebounces.current[key] = timer
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
        const nextLength = field === 'length_m' ? value : i.length_m
        const nextWidth = field === 'width_m' ? value : i.width_m
        const nextHeight = field === 'height_m' ? value : i.height_m

        // Une grille manuelle ne doit ni changer d'unité ni reprendre le prix du catalogue lié.
        const grid = i.metal_grid_id ? metalPriceGrids.find(g => g.id === i.metal_grid_id) : null
        if (grid) {
          const quantity = grid.source_type === 'manual' && grid.unit === i.unit
            ? computeManualMetalQuantity(grid, nextLength, nextWidth, i.dim_quantity || 1)
            : null
          return { ...i, [field]: value, quantity: quantity ?? i.quantity }
        }
        const mode = getItemDimensionMode(i)
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
        const grid = i.metal_grid_id ? metalPriceGrids.find(g => g.id === i.metal_grid_id) : null
        if (grid) {
          const quantity = grid.source_type === 'manual' && grid.unit === i.unit
            ? computeManualMetalQuantity(grid, i.length_m, i.width_m, qty)
            : null
          return { ...i, dim_quantity: qty, quantity: quantity ?? i.quantity }
        }
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

  async function flushPendingItemSaves(qId: string, includeAll = false): Promise<string | null> {
    for (const sec of sectionsRef.current) {
      for (const item of sec.items) {
        const key = `${sec._tempId}_${item._tempId}`
        clearTimeout(itemDebounces.current[key])
        delete itemDebounces.current[key]
      }
    }
    while (pendingItemWrites.current.size > 0) {
      await Promise.allSettled([...pendingItemWrites.current])
    }
    const saves: Promise<string | null>[] = []
    for (const sec of sectionsRef.current) {
      for (const item of sec.items) {
        const key = `${sec._tempId}_${item._tempId}`
        if (!includeAll && !pendingItemKeys.current.has(key)) continue
        if (deletedItemKeys.current.has(key) || (item.id && deletedItemIds.current.has(item.id))) continue
        const revision = dirtyWritesRef.current.get(`item:${key}`)
        saves.push(trackItemWrite(sec._tempId, item._tempId, qId, revision))
      }
    }
    const results = await Promise.all(saves)
    return results.find(Boolean) ?? getWriteFailure()
  }

  async function retryPendingSave(): Promise<boolean> {
    writeFailuresRef.current.clear()
    requiresExplicitSaveRef.current = false
    setErrorMsg(null)
    setSaveStatus('saving')

    const qId = await ensureQuote()
    if (!qId) {
      requiresExplicitSaveRef.current = true
      setSaveStatus('error')
      return false
    }

    await waitForPendingCreatedItemSaves()
    await waitForPendingSectionWrites()
    await waitForPendingDeletes()

    const headerRes = await syncQuoteHeader(qId)
    if (headerRes.error) return false

    for (const section of sectionsRef.current) {
      if (section._tempId === '_unsectioned') continue
      const sectionId = section.id ?? crypto.randomUUID()
      if (section.id !== sectionId) {
        setSectionsSynced(prev => prev.map(s => s._tempId === section._tempId ? { ...s, id: sectionId } : s))
      }
      const key = `section:${section._tempId}`
      const revision = dirtyWritesRef.current.get(key) ?? markWriteDirty(key)
      try {
        const res = await upsertQuoteSection({ id: sectionId, quote_id: qId, title: section.title, position: section.position })
        if (res.error || !res.sectionId) {
          recordWriteFailure(key, res.error ?? 'Impossible d’enregistrer le lot.')
          return false
        }
        markWriteSaved(key, revision)
      } catch (error) {
        recordWriteFailure(key, error instanceof Error ? error.message : String(error))
        return false
      }
    }

    for (const itemId of [...pendingItemDeletes.current]) {
      try {
        const res = await deleteQuoteItem(itemId, qId)
        if (res.error && res.error !== 'Ligne introuvable.') {
          recordWriteFailure(`delete-item:${itemId}`, res.error)
          return false
        }
        pendingItemDeletes.current.delete(itemId)
        markWriteSaved(`delete-item:${itemId}`, dirtyWritesRef.current.get(`delete-item:${itemId}`))
      } catch (error) {
        recordWriteFailure(`delete-item:${itemId}`, error instanceof Error ? error.message : String(error))
        return false
      }
    }

    const currentSectionIds = new Set(sectionsRef.current.flatMap(section => section.id ? [section.id] : []))
    for (const section of initialQuote?.sections ?? []) {
      if (!currentSectionIds.has(section.id)) pendingSectionDeletes.current.add(section.id)
    }
    for (const sectionId of [...pendingSectionDeletes.current]) {
      try {
        const res = await deleteQuoteSection(sectionId)
        if (res.error && res.error !== 'Section introuvable.') {
          recordWriteFailure(`delete-section:${sectionId}`, res.error)
          return false
        }
        pendingSectionDeletes.current.delete(sectionId)
        markWriteSaved(`delete-section:${sectionId}`, dirtyWritesRef.current.get(`delete-section:${sectionId}`))
      } catch (error) {
        recordWriteFailure(`delete-section:${sectionId}`, error instanceof Error ? error.message : String(error))
        return false
      }
    }

    const pruneResult = await pruneRemovedQuoteItems(qId)
    if (pruneResult.error) return false
    const itemError = await flushPendingItemSaves(qId, true)
    if (itemError) return false

    if (writeFailuresRef.current.size > 0) {
      setErrorMsg(getWriteFailure())
      setSaveStatus('error')
      requiresExplicitSaveRef.current = true
      return false
    }
    dirtyWritesRef.current.clear()
    clearRecoveryIfClean()
    setErrorMsg(null)
    setSaveStatus('saved')
    setTimeout(() => {
      if (dirtyWritesRef.current.size === 0 && writeFailuresRef.current.size === 0) setSaveStatus('idle')
    }, 2000)
    return true
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
    if (requiresExplicitSaveRef.current || writeFailuresRef.current.size > 0) {
      setSaveStatus('error')
      setErrorMsg(getWriteFailure() ?? 'Enregistrez ou réessayez les modifications avant de continuer.')
      return
    }
    if (sectionsRef.current.some(section => section.items.some(item =>
      !Number.isFinite(item.quantity) || item.quantity <= 0 || item.quantity > 9_999_999.999
      || Math.abs(item.quantity * 1000 - Math.round(item.quantity * 1000)) > 0.000001))) {
      setErrorMsg('Quantité invalide. Choisissez une unité adaptée et une quantité positive, avec trois décimales maximum.')
      return
    }
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
    const queuedError = await waitForPendingCreatedItemSaves()
      ?? await waitForPendingSectionWrites()
      ?? await waitForPendingDeletes()
    if (queuedError) {
      setIsSending(false)
      setErrorMsg(queuedError)
      return
    }
    const pruneResult = await pruneRemovedQuoteItems(qId)
    if (pruneResult.error) { setIsSending(false); setErrorMsg(pruneResult.error); return }
    const itemError = await flushPendingItemSaves(qId)
    if (itemError) { setIsSending(false); setErrorMsg(itemError); return }

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
    if (requiresExplicitSaveRef.current || writeFailuresRef.current.size > 0) {
      setSaveStatus('error')
      setErrorMsg(getWriteFailure() ?? 'Enregistrez ou réessayez les modifications avant de continuer.')
      return
    }
    const qId = await ensureQuote()
    if (!qId) return
    const headerRes = await syncQuoteHeader(qId)
    if (headerRes.error) return
    const queuedError = await waitForPendingCreatedItemSaves()
      ?? await waitForPendingSectionWrites()
      ?? await waitForPendingDeletes()
    if (queuedError) { setErrorMsg(queuedError); return }
    const pruneResult = await pruneRemovedQuoteItems(qId)
    if (pruneResult.error) { setErrorMsg(pruneResult.error); return }
    const itemError = await flushPendingItemSaves(qId)
    if (itemError) { setErrorMsg(itemError); return }
    router.push(`/api/pdf/quote/${qId}`)
  }

  // ─── AI import ───────────────────────────────────────────────────────────

  async function handleAIImport(aiResult: AIQuoteResult) {
    if (!canUseQuoteAssistant) return
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
    if (!canUseQuoteAssistant) return
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

  function updateIntro(value: string) {
    introTouchedRef.current = true
    setNotesClient(value)
    scheduleHeaderSave({ notes_client: value })
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

  const setAIPanelOpenGuarded: typeof setAIPanelOpen = value => {
    setAIPanelOpen(previous => {
      const next = typeof value === 'function' ? value(previous) : value
      return next && !canUseQuoteAssistant ? previous : next
    })
  }
  const setMoaPanelOpenGuarded: typeof setMoaPanelOpen = value => {
    setMoaPanelOpen(previous => {
      const next = typeof value === 'function' ? value(previous) : value
      return next && !canUseQuoteAssistant ? previous : next
    })
  }

  return {
    initialClients,
    initialQuote,
    materials,
    laborRates,
    prestationTypes,
    initialClientId,
    catalogContext,
    modules,
    canUseQuoteVoiceInput,
    canUseQuoteAssistant,
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
    recoveryWarning,
    confirmUnsavedNavigation,
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
    setAIPanelOpen: setAIPanelOpenGuarded,
    chloeBriefBanner,
    setChloeBriefBanner,
    chloeAutoAnalyze,
    setChloeAutoAnalyze,
    startChoice,
    setStartChoice,
    moaPanelOpen,
    setMoaPanelOpen: setMoaPanelOpenGuarded,
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
    distributionConfirm,
    setDistributionConfirm,
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
    retryPendingSave,
    handleAIImport,
    handleInsertMOItems,
    handlePrestationSelect,
    catalogFiltered,
    updateIntro,
  }
}

export type QuoteEditor = ReturnType<typeof useQuoteEditor>
