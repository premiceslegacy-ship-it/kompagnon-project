'use client'
// @atelier-migrated
// Logique de la fiche chantier : états, calculs et envois. L'affichage vit dans ChantierDetailClient.tsx.

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'

import type { ChantierDetail, Tache, TacheStatus, Pointage, ChantierPhoto, ChantierNote, Equipe, ChantierPlanning } from '@/lib/data/queries/chantiers'
import type { QuoteStub } from '@/lib/data/queries/quotes'
import type { TeamMember } from '@/lib/data/queries/team'
import type { OrgRole } from '@/lib/data/queries/roles'
import { getQuoteItemsForSuggestions } from '@/lib/data/mutations/quotes'
import { createTache, updateTache, deleteTache, reorderTaches, createPointage, createMemberPointageAdmin, deletePointage, createChantierNote, deleteChantierNote, uploadChantierPhoto, deleteChantierPhoto, updateChantier, generateChantierPeriodInvoice, createChantierPlanning, deleteChantierPlanning } from '@/lib/data/mutations/chantiers'
import { sendChantierReportEmail } from '@/lib/data/mutations/chantier-report-email'
import { sendChantierPhotosEmail } from '@/lib/data/mutations/chantier-photos-email'
import { compressImageToJpeg } from '@/lib/images/compress'
import { todayParis } from '@/lib/utils'
import { type DeletedPointageInfo } from './RentabiliteTab'

import type { ChantierReserve } from '@/lib/data/queries/chantiers'
import type { ChantierProfitability } from '@/lib/data/queries/chantier-profitability'
import type { ChantierJalon } from '@/lib/data/queries/chantier-jalons'
import type { IndividualMember } from '@/lib/data/queries/members'

import SituationsSection from '@/components/situations/SituationsSection'

import type { SituationsSummary } from '@/lib/data/queries/invoices'

// ─── Helpers ──────────────────────────────────────────────────────────────────
import { arrayMove } from '@dnd-kit/sortable'
import { STATUS_CYCLE, splitDateParts, buildDateFromParts, visibleSegments, type BillingPeriod, type ChantierPermissions, type Segment } from './chantierModel'

export type ChantierDetailProps = {
  chantier: ChantierDetail
  initialTaches: Tache[]
  initialPointages: Pointage[]
  initialPhotos: ChantierPhoto[]
  initialNotes: ChantierNote[]
  allEquipes: Equipe[]
  initialChantierEquipes: Equipe[]
  initialPlannings: ChantierPlanning[]
  linkableQuotes: QuoteStub[]
  taskLibraryTitles: string[]
  orgMembers: TeamMember[]
  orgRoles?: OrgRole[]
  initialProfitability: ChantierProfitability
  initialJalons: ChantierJalon[]
  initialIndividualMembers?: import('@/lib/data/queries/members').IndividualMember[]
  orgPhantomMembers?: import('@/lib/data/queries/members').IndividualMember[]
  invoiceStubs?: import('@/lib/data/queries/invoices').InvoiceStub[]
  orgSector?: string | null
  materials?: import('@/lib/data/queries/catalog').CatalogMaterial[]
  situationsSummary?: SituationsSummary | null
  canCreateSituation?: boolean
  canCreateSolde?: boolean
  canCreateInvoice?: boolean
  currentUserId?: string | null
  permissions: ChantierPermissions
  initialReserves?: ChantierReserve[]
  canDeleteChantier?: boolean
}

export function useChantierDetail({
  chantier: initialChantier,
  initialTaches,
  initialPointages,
  initialPhotos,
  initialNotes,
  allEquipes,
  initialChantierEquipes,
  initialPlannings,
  linkableQuotes,
  taskLibraryTitles,
  orgMembers,
  orgRoles = [],
  initialProfitability,
  initialJalons,
  initialIndividualMembers = [],
  orgPhantomMembers = [],
  invoiceStubs = [],
  orgSector = null,
  materials = [],
  situationsSummary = null,
  canCreateSituation = false,
  canCreateSolde = false,
  canCreateInvoice = false,
  currentUserId = null,
  permissions,
  initialReserves = [],
  canDeleteChantier = false,
}: ChantierDetailProps) {
  const router = useRouter()

  const [chantier] = useState(initialChantier)
  const [taches, setTaches] = useState(initialTaches)
  const [pointages, setPointages] = useState(initialPointages)
  const [deletedPointages, setDeletedPointages] = useState<DeletedPointageInfo[]>([])
  const [photos, setPhotos] = useState(initialPhotos)
  const [notes, setNotes] = useState(initialNotes)
  const [plannings, setPlannings] = useState(initialPlannings)
  const {
    canEditChantier,
    canManageTeam,
    canPointage,
    canManagePointages,
    canViewExpenses,
    canCreateExpenses,
    canEditExpenses,
    canDeleteExpenses,
    canEditRates,
  } = permissions

  useEffect(() => {
    setPlannings(initialPlannings)
  }, [initialPlannings])

  const segments = useMemo(() => visibleSegments(permissions), [permissions])
  const [segment, setSegment] = useState<Segment>('travaux')
  const activeSegment: Segment = segments.some(s => s.value === segment) ? segment : 'travaux'

  // Tâches
  const [newTacheTitle, setNewTacheTitle] = useState('')
  const [newTacheDue, setNewTacheDue] = useState('')
  const [newTacheEquipeIds, setNewTacheEquipeIds] = useState<Set<string>>(new Set())
  const [newTacheMemberIds, setNewTacheMemberIds] = useState<Set<string>>(new Set())
  const [showNewTacheAssignments, setShowNewTacheAssignments] = useState(false)
  const [tacheLoading, setTacheLoading] = useState(false)

  // Pointages
  const [ptDate, setPtDate] = useState(todayParis())
  const [ptStartTime, setPtStartTime] = useState('')
  const [ptHoursInt, setPtHoursInt] = useState('')
  const [ptMinutes, setPtMinutes] = useState('0')
  const [ptDesc, setPtDesc] = useState('')
  const [ptTacheId, setPtTacheId] = useState('')
  const [ptLoading, setPtLoading] = useState(false)
  const [ptMode, setPtMode] = useState<'me' | 'team'>('me')
  const [ptEquipeId, setPtEquipeId] = useState(initialChantierEquipes[0]?.id ?? '')
  const [ptPresentMemberIds, setPtPresentMemberIds] = useState<Set<string>>(
    () => new Set(initialChantierEquipes[0]?.membres.map(m => m.id) ?? []),
  )

  // Notes
  const [noteContent, setNoteContent] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)

  // Photos
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoLoading, setPhotoLoading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  // Lightbox
  const [lightboxPhoto, setLightboxPhoto] = useState<ChantierPhoto | null>(null)
  const [lightboxTitle, setLightboxTitle] = useState('')
  const [lightboxCaption, setLightboxCaption] = useState('')
  const [lightboxSaving, setLightboxSaving] = useState(false)
  // Sélection multiple + envoi client
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set())
  const [showSendPhotosPanel, setShowSendPhotosPanel] = useState(false)
  const [photosEmailMsg, setPhotosEmailMsg] = useState('')
  const [photosEmailStatus, setPhotosEmailStatus] = useState<'idle'|'sending'|'done'|'error'>('idle')
  const [photosEmailError, setPhotosEmailError] = useState<string | null>(null)
  const [photosEmailRecipient, setPhotosEmailRecipient] = useState('')

  // Contact référent - édition inline
  const [editContact, setEditContact] = useState(false)
  const [contactName, setContactName] = useState(chantier.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(chantier.contact_email ?? '')
  const [contactPhone, setContactPhone] = useState(chantier.contact_phone ?? '')
  const [chantierClientEmail, setChantierClientEmail] = useState(chantier.client?.email ?? '')
  const [contactSaving, setContactSaving] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)

  // Dates - édition inline
  const [editDates, setEditDates] = useState(false)
  const [startDate, setStartDate] = useState(chantier.start_date ?? '')
  const [estimatedEndDate, setEstimatedEndDate] = useState(chantier.estimated_end_date ?? '')
  const [datesSaving, setDatesSaving] = useState(false)
  const [datesError, setDatesError] = useState<string | null>(null)

  // Facturation périodique - édition inline avec selects
  const initialBillingParts = splitDateParts(chantier.prochaine_facturation)
  const [editBilling, setEditBilling] = useState(false)
  const [billingAmount, setBillingAmount] = useState(chantier.montant_periode_ht != null ? String(chantier.montant_periode_ht) : '')
  const [billingLabel, setBillingLabel] = useState(chantier.libelle_facturation_periode ?? '')
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(chantier.periode_facturation ?? 'none')
  const [billingDay, setBillingDay] = useState(String(chantier.jour_facturation ?? Number(initialBillingParts.day) ?? 1))
  const [billingMonth, setBillingMonth] = useState(initialBillingParts.month)
  const [billingYear, setBillingYear] = useState(initialBillingParts.year)
  const [billingSaving, setBillingSaving] = useState(false)
  const [billingGenerating, setBillingGenerating] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)

  // Retenue de garantie par défaut
  const [editRetention, setEditRetention] = useState(false)
  const [retentionPct, setRetentionPct] = useState(String(chantier.default_retention_pct ?? 0))
  const [retentionSaving, setRetentionSaving] = useState(false)
  const [retentionError, setRetentionError] = useState<string | null>(null)

  const handleSaveRetention = async (): Promise<boolean> => {
    const val = parseFloat(retentionPct)
    if (isNaN(val) || val < 0 || val > 100) { setRetentionError('Taux invalide (0-100).'); return false }
    setRetentionSaving(true)
    setRetentionError(null)
    const res = await updateChantier(chantier.id, { defaultRetentionPct: val })
    setRetentionSaving(false)
    if (res.error) { setRetentionError(res.error); return false }
    setEditRetention(false)
    return true
  }

  // Devis lié
  const [linkedQuoteId, setLinkedQuoteId] = useState<string | null>(chantier.quote_id)
  const [editQuoteLink, setEditQuoteLink] = useState(false)
  const [quoteLinkValue, setQuoteLinkValue] = useState(chantier.quote_id ?? '')
  const [quoteLinkSaving, setQuoteLinkSaving] = useState(false)
  const [quoteLinkError, setQuoteLinkError] = useState<string | null>(null)

  // Assistant IA chantier
  const [showAIAssistant, setShowAIAssistant] = useState(false)

  const linkedQuote = linkableQuotes.find(q => q.id === linkedQuoteId) ?? null

  const handleSaveQuoteLink = async (): Promise<boolean> => {
    if (!canEditChantier) return false
    setQuoteLinkSaving(true)
    setQuoteLinkError(null)
    const { error } = await updateChantier(chantier.id, { quoteId: quoteLinkValue || null })
    if (error) { setQuoteLinkError(error); setQuoteLinkSaving(false); return false }
    setLinkedQuoteId(quoteLinkValue || null)
    setEditQuoteLink(false)
    setQuoteLinkSaving(false)
    return true
  }

  const handleSaveContact = async (): Promise<boolean> => {
    if (!canEditChantier) return false
    setContactSaving(true)
    setContactError(null)
    const { error } = await updateChantier(chantier.id, {
      contactName: contactName.trim() || null,
      contactEmail: contactEmail.trim() || null,
      contactPhone: contactPhone.trim() || null,
    })
    setContactSaving(false)
    if (error) { setContactError(error); return false }
    setEditContact(false)
    return true
  }

  const handleSaveDates = async (): Promise<boolean> => {
    if (!canEditChantier) return false
    setDatesSaving(true)
    setDatesError(null)
    const { error } = await updateChantier(chantier.id, {
      startDate: startDate || null,
      estimatedEndDate: estimatedEndDate || null,
    })
    setDatesSaving(false)
    if (error) { setDatesError(error); return false }
    setEditDates(false)
    return true
  }

  const selectedBillingDate = buildDateFromParts(billingYear, billingMonth, billingDay)
  const billingYears = useMemo(() => {
    const now = new Date()
    const start = now.getFullYear()
    return Array.from({ length: 8 }, (_, i) => start + i)
  }, [])

  const handleSaveBilling = async (): Promise<boolean> => {
    if (!canEditChantier) return false
    const amount = billingAmount.trim() ? parseFloat(billingAmount.replace(',', '.')) : null
    if (amount != null && (Number.isNaN(amount) || amount < 0)) {
      setBillingError('Montant invalide.')
      return false
    }
    setBillingSaving(true)
    setBillingError(null)
    const { error } = await updateChantier(chantier.id, {
      montantPeriodeHt: amount,
      libelleFacturationPeriode: billingLabel || null,
      periodeFacturation: billingPeriod,
      jourFacturation: Number(billingDay),
      prochaineFacturation: billingPeriod === 'none' || !amount ? null : selectedBillingDate,
    })
    setBillingSaving(false)
    if (error) { setBillingError(error); return false }
    setEditBilling(false)
    return true
  }

  const handleGeneratePeriodInvoice = async () => {
    if (!canCreateInvoice) return
    setBillingGenerating(true)
    setBillingError(null)
    const { invoiceId, error } = await generateChantierPeriodInvoice(chantier.id)
    setBillingGenerating(false)
    if (error || !invoiceId) {
      setBillingError(error ?? 'Facture introuvable.')
      return
    }
    router.push(`/finances/invoice-editor?id=${invoiceId}&returnTo=${encodeURIComponent(`/chantiers/${chantier.id}`)}`)
  }

  // PDF période
  const [showPdfPanel, setShowPdfPanel] = useState(false)
  const [pdfFrom, setPdfFrom] = useState('')
  const [pdfTo, setPdfTo] = useState('')

  // Email rapport
  type EmailStatus = 'idle' | 'sending' | 'done' | 'error'
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('idle')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailRecipient, setEmailRecipient] = useState<string | null>(null)
  const [reportEmailRequiredOpen, setReportEmailRequiredOpen] = useState(false)
  const [photosEmailRequiredOpen, setPhotosEmailRequiredOpen] = useState(false)

  const getReportClientEmailTarget = () => {
    if (!chantier.client) return null
    return {
      id: chantier.client.id,
      company_name: chantier.client.company_name,
      email: chantierClientEmail,
    }
  }

  const handleSendReportEmail = async (skipEmailCheck = false) => {
    if (!canEditChantier) return
    if (!skipEmailCheck && !contactEmail.trim() && chantier.client && !chantierClientEmail.trim()) {
      setEmailError(null)
      setEmailStatus('idle')
      setReportEmailRequiredOpen(true)
      return
    }
    if (!contactEmail.trim() && !chantier.client) {
      setEmailStatus('error')
      setEmailError('Ajoutez un email de contact référent ou liez ce chantier à un client.')
      setEditContact(true)
      return
    }
    setEmailStatus('sending')
    setEmailError(null)
    const { error, recipient } = await sendChantierReportEmail(chantier.id, {
      dateFrom: pdfFrom || undefined,
      dateTo: pdfTo || undefined,
    })
    if (error) {
      setEmailStatus('error')
      setEmailError(error)
    } else {
      setEmailStatus('done')
      setEmailRecipient(recipient ?? null)
      setTimeout(() => setEmailStatus('idle'), 4000)
    }
  }

  const handleReportClientEmailSaved = async (email: string) => {
    setChantierClientEmail(email)
    setReportEmailRequiredOpen(false)
    await handleSendReportEmail(true)
  }

  const handleSendPhotosEmail = async (skipEmailCheck = false) => {
    if (!skipEmailCheck && !contactEmail.trim() && chantier.client && !chantierClientEmail.trim()) {
      setPhotosEmailError(null)
      setPhotosEmailStatus('idle')
      setPhotosEmailRequiredOpen(true)
      return
    }
    if (!contactEmail.trim() && !chantier.client) {
      setPhotosEmailStatus('error')
      setPhotosEmailError('Ajoutez un email de contact référent ou liez ce chantier à un client.')
      setEditContact(true)
      return
    }
    setPhotosEmailStatus('sending')
    setPhotosEmailError(null)
    const { error, recipient } = await sendChantierPhotosEmail({
      chantierId: chantier.id,
      photoIds: Array.from(selectedPhotoIds),
      message: photosEmailMsg || `Veuillez trouver ci-joint des photos du chantier "${chantier.title}".`,
    })
    if (error) {
      setPhotosEmailStatus('error')
      setPhotosEmailError(error)
      return
    }
    setPhotosEmailStatus('done')
    setPhotosEmailRecipient(recipient ?? '')
    setPhotos(prev => prev.map(p => selectedPhotoIds.has(p.id) ? { ...p, shared_with_client_at: new Date().toISOString() } : p))
  }

  const handlePhotosClientEmailSaved = async (email: string) => {
    setChantierClientEmail(email)
    setPhotosEmailRequiredOpen(false)
    await handleSendPhotosEmail(true)
  }

  // Situation — géré par SituationsSection

  // Task suggestions
  type TaskSuggestion = { _id: string; title: string; editing: boolean }
  const [taskSuggestions, setTaskSuggestions] = useState<TaskSuggestion[]>([])
  const [suggestTasksLoading, setSuggestTasksLoading] = useState(false)
  const [suggestTasksError, setSuggestTasksError] = useState<string | null>(null)
  const [suggestTasksCreditsError, setSuggestTasksCreditsError] = useState(false)
  const [showTaskSuggestions, setShowTaskSuggestions] = useState(false)
  const [validateAllLoading, setValidateAllLoading] = useState(false)
  const [validatingSuggId, setValidatingSuggId] = useState<string | null>(null)

  // Task library
  const [showTaskLibrary, setShowTaskLibrary] = useState(false)
  const [taskLibraryFilter, setTaskLibraryFilter] = useState('')

  // ── Helpers ──

  const fmtDate = (d: string | null) => d
    ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '-'

  const fmtMoney = (n: number) =>
    n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)
  const selectedPointageEquipe = initialChantierEquipes.find(e => e.id === ptEquipeId) ?? null
  const allAssignableMembers = useMemo(() => {
    const map = new Map<string, IndividualMember>()
    const equipeMembers: IndividualMember[] = allEquipes.flatMap(e => e.membres.map(member => ({
      id: member.id,
      organization_id: e.organization_id,
      equipe_id: member.equipe_id,
      prenom: member.prenom,
      name: member.name,
      email: member.email,
      role_label: member.role_label,
      taux_horaire: member.taux_horaire,
      profile_id: member.profile_id,
      created_at: e.created_at,
    })))
    for (const member of [...initialIndividualMembers, ...orgPhantomMembers, ...equipeMembers]) {
      map.set(member.id, member)
    }
    return Array.from(map.values()).sort((a, b) =>
      [a.prenom, a.name].filter(Boolean).join(' ').localeCompare([b.prenom, b.name].filter(Boolean).join(' '), 'fr')
    )
  }, [initialIndividualMembers, orgPhantomMembers, allEquipes])

  // Compteurs dérivés du state vivant (pas du snapshot chantier initial)
  const tachesCount = taches.length
  const tachesDone = taches.filter(t => t.status === 'termine').length
  const donePct = tachesCount > 0 ? Math.round((tachesDone / tachesCount) * 100) : 0

  // ── Tâches ──

  const handleAddTache = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (!canEditChantier) return
    if (!newTacheTitle.trim()) return
    setTacheLoading(true)
    const titleToAdd = newTacheTitle.trim()
    const dueToAdd = newTacheDue || null
    const equipeIdsToAdd = Array.from(newTacheEquipeIds)
    const memberIdsToAdd = Array.from(newTacheMemberIds)
    const { tacheId, error } = await createTache(chantier.id, {
      title: titleToAdd,
      dueDate: dueToAdd,
      equipeIds: equipeIdsToAdd,
      memberIds: memberIdsToAdd,
    })
    setTacheLoading(false)
    if (!error && tacheId) {
      setTaches(prev => [...prev, {
        id: tacheId,
        chantier_id: chantier.id,
        title: titleToAdd,
        description: null,
        status: 'a_faire',
        position: prev.length,
        assigned_to: null,
        due_date: dueToAdd,
        progress_note: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        jalon_id: null,
        assignments: [
          ...equipeIdsToAdd.map(id => {
            const equipe = allEquipes.find(e => e.id === id)
            return {
              id: `temp-eq-${id}`,
              tache_id: tacheId,
              equipe_id: id,
              member_id: null,
              label: equipe?.name ?? 'Équipe',
              color: equipe?.color ?? null,
            }
          }),
          ...memberIdsToAdd.map(id => {
            const member = allAssignableMembers.find(m => m.id === id)
            return {
              id: `temp-m-${id}`,
              tache_id: tacheId,
              equipe_id: null,
              member_id: id,
              label: [member?.prenom, member?.name].filter(Boolean).join(' ') || member?.email || 'Membre',
              color: null,
            }
          }),
        ],
      }])
      setNewTacheTitle('')
      setNewTacheDue('')
      setNewTacheEquipeIds(new Set())
      setNewTacheMemberIds(new Set())
      setShowNewTacheAssignments(false)
    }
  }

  const handleStatusToggle = async (tache: Tache) => {
    if (!canEditChantier) return
    const nextStatus = STATUS_CYCLE[tache.status]
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, status: nextStatus } : t))
    await updateTache(tache.id, chantier.id, { status: nextStatus })
  }

  const handleSetTacheStatus = async (tache: Tache, status: TacheStatus) => {
    if (!canEditChantier || tache.status === status) return
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, status } : t))
    await updateTache(tache.id, chantier.id, { status })
  }

  const handleDeleteTache = async (tache: Tache) => {
    if (!canEditChantier) return
    setTaches(prev => prev.filter(t => t.id !== tache.id))
    await deleteTache(tache.id, chantier.id)
  }

  const handleRenameTache = async (tache: Tache, title: string) => {
    if (!canEditChantier) return
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, title } : t))
    await updateTache(tache.id, chantier.id, { title })
  }

  const handleSaveTacheNote = async (tache: Tache, note: string) => {
    if (!canEditChantier) return
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, progress_note: note || null } : t))
    await updateTache(tache.id, chantier.id, { progressNote: note || null })
  }

  const handleSaveTacheAssignments = async (tache: Tache, equipeIds: string[], memberIds: string[]) => {
    if (!canEditChantier) return
    setTaches(prev => prev.map(t => t.id === tache.id ? {
      ...t,
      assignments: [
        ...equipeIds.map(id => {
          const equipe = allEquipes.find(e => e.id === id)
          return {
            id: `local-eq-${id}`,
            tache_id: tache.id,
            equipe_id: id,
            member_id: null,
            label: equipe?.name ?? 'Équipe',
            color: equipe?.color ?? null,
          }
        }),
        ...memberIds.map(id => {
          const member = allAssignableMembers.find(m => m.id === id)
          return {
            id: `local-m-${id}`,
            tache_id: tache.id,
            equipe_id: null,
            member_id: id,
            label: [member?.prenom, member?.name].filter(Boolean).join(' ') || member?.email || 'Membre',
            color: null,
          }
        }),
      ],
    } : t))
    await updateTache(tache.id, chantier.id, { equipeIds, memberIds })
  }

  const handleMoveTache = async (tache: Tache, delta: -1 | 1) => {
    if (!canEditChantier) return
    const oldIdx = taches.findIndex(t => t.id === tache.id)
    const newIdx = oldIdx + delta
    if (oldIdx < 0 || newIdx < 0 || newIdx >= taches.length) return
    const reordered = arrayMove(taches, oldIdx, newIdx).map((t, i) => ({ ...t, position: i }))
    setTaches(reordered)
    await reorderTaches(chantier.id, reordered.map(t => t.id))
  }

  // ── Task suggestions ──

  const handleSuggestTasks = async () => {
    if (!canEditChantier) return
    if (!linkedQuoteId) return
    setSuggestTasksLoading(true)
    setSuggestTasksError(null)

    const { visible } = await getQuoteItemsForSuggestions(linkedQuoteId)
    if (visible.length === 0) {
      setSuggestTasksError('Aucune prestation visible trouvée dans le devis lié.')
      setSuggestTasksLoading(false)
      return
    }

    try {
      const res = await fetch('/api/ai/suggest-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: visible }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        if (res.status === 402) { setSuggestTasksCreditsError(true); setSuggestTasksLoading(false); return }
        setSuggestTasksError(data.error ?? 'Erreur lors de la génération')
        setSuggestTasksLoading(false)
        return
      }
      setShowTaskSuggestions(false)
      setTaskSuggestions((data as { title: string }[]).map((t, i) => ({
        _id: `sugg_${i}_${Date.now()}`,
        title: t.title,
        editing: false,
      })))
      setShowTaskSuggestions(true)
    } catch {
      setSuggestTasksError('Erreur réseau.')
    }
    setSuggestTasksLoading(false)
  }

  const handleValidateSuggestion = async (id: string) => {
    if (!canEditChantier) return
    if (validatingSuggId || validateAllLoading) return
    const sugg = taskSuggestions.find(s => s._id === id)
    if (!sugg || !sugg.title.trim()) return
    setValidatingSuggId(id)
    const { tacheId } = await createTache(chantier.id, { title: sugg.title.trim() })
    if (tacheId) {
      setTaches(prev => [...prev, {
        id: tacheId, chantier_id: chantier.id, title: sugg.title.trim(),
        description: null, status: 'a_faire', position: prev.length,
        assigned_to: null, due_date: null, progress_note: null,
        completed_at: null, created_at: new Date().toISOString(), jalon_id: null,
        assignments: [],
      }])
      setTaskSuggestions(prev => {
        const next = prev.filter(s => s._id !== id)
        if (next.length === 0) setShowTaskSuggestions(false)
        return next
      })
    }
    setValidatingSuggId(null)
  }

  const handleValidateAllSuggestions = async () => {
    if (!canEditChantier) return
    if (validateAllLoading) return
    setValidateAllLoading(true)
    const remaining = taskSuggestions.filter(s => s.title.trim())
    const startPos = taches.length
    const newTaches: Tache[] = []
    for (let i = 0; i < remaining.length; i++) {
      const { tacheId } = await createTache(chantier.id, { title: remaining[i].title.trim() })
      if (tacheId) {
        newTaches.push({
          id: tacheId, chantier_id: chantier.id, title: remaining[i].title.trim(),
          description: null, status: 'a_faire', position: startPos + i,
          assigned_to: null, due_date: null, progress_note: null,
          completed_at: null, created_at: new Date().toISOString(), jalon_id: null,
          assignments: [],
        })
      }
    }
    setTaches(prev => [...prev, ...newTaches])
    setTaskSuggestions([])
    setShowTaskSuggestions(false)
    setValidateAllLoading(false)
  }

  // ── Plannings ──

  const handleAddPlanning = async (data: { plannedDate: string; startTime: string; endTime: string; label: string; equipeId: string | null; memberId: string | null; teamSize: number; notes: string }): Promise<string | null> => {
    if (!canEditChantier) return 'Action non autorisée.'
    const { planningId, error } = await createChantierPlanning(chantier.id, {
      plannedDate: data.plannedDate,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      equipeId: data.equipeId,
      memberId: data.memberId,
      label: data.label,
      teamSize: data.teamSize,
      notes: data.notes || null,
    })
    if (error) return error
    if (planningId) {
      setPlannings(prev => [...prev, {
        id: planningId,
        chantier_id: chantier.id,
        event_type: 'chantier' as const,
        title: null,
        planned_date: data.plannedDate,
        start_time: data.startTime || null,
        end_time: data.endTime || null,
        equipe_id: data.equipeId,
        member_id: data.memberId,
        label: data.label,
        team_size: data.teamSize,
        notes: data.notes || null,
        created_at: new Date().toISOString(),
        route_id: null,
        route_order: null,
        duration_min: null,
        travel_from_prev_min: null,
        arrived_at: null,
      }])
    }
    return null
  }

  const handleDeletePlanning = async (planningId: string) => {
    if (!canEditChantier) return
    setPlannings(prev => prev.filter(p => p.id !== planningId))
    await deleteChantierPlanning(planningId, chantier.id)
  }

  // ── Pointages ──

  const handleAddPointage = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (ptMode === 'team' && !canManagePointages) return
    if (ptMode !== 'team' && !canPointage) return
    const h = parseInt(ptHoursInt) || 0
    const m = parseInt(ptMinutes) || 0
    const hours = h + m / 60
    if (!ptDate || hours <= 0) return
    if (ptMode === 'team' && ptPresentMemberIds.size === 0) return

    const savedDate = ptDate
    const savedHours = ptHoursInt
    const savedMinutes = ptMinutes
    const savedDesc = ptDesc
    const savedStartTime = ptStartTime
    const savedTacheId = ptTacheId
    const savedMode = ptMode
    const savedMembers = selectedPointageEquipe?.membres.filter(m => ptPresentMemberIds.has(m.id)) ?? []
    const tacheTitle = taches.find(t => t.id === savedTacheId)?.title ?? null

    const tempPointages: Pointage[] = savedMode === 'team'
      ? savedMembers.map(member => ({
          id: crypto.randomUUID(),
          chantier_id: chantier.id,
          tache_id: savedTacheId || null,
          user_id: null,
          member_id: member.id,
          date: savedDate,
          hours,
          description: savedDesc || null,
          created_at: new Date().toISOString(),
          start_time: savedStartTime || null,
          user_name: [member.prenom, member.name].filter(Boolean).join(' ') || member.name,
          tache_title: tacheTitle,
        }))
      : [{
          id: crypto.randomUUID(),
          chantier_id: chantier.id,
          tache_id: savedTacheId || null,
          user_id: 'temp',
          member_id: null,
          date: savedDate,
          hours,
          description: savedDesc || null,
          created_at: new Date().toISOString(),
          start_time: savedStartTime || null,
          user_name: 'Moi',
          tache_title: tacheTitle,
        }]

    setPointages(prev => [...tempPointages, ...prev])

    setPtHoursInt('')
    setPtMinutes('0')
    setPtDesc('')
    setPtStartTime('')

    setPtLoading(true)
    let error: string | null = null
    if (savedMode === 'team') {
      for (const member of savedMembers) {
        const result = await createMemberPointageAdmin(chantier.id, member.id, {
          date: savedDate,
          hours,
          description: savedDesc || null,
          start_time: savedStartTime || null,
        })
        if (result.error) {
          error = result.error
          break
        }
      }
    } else {
      const result = await createPointage(chantier.id, {
        date: savedDate,
        hours,
        tacheId: savedTacheId || null,
        description: savedDesc || null,
        start_time: savedStartTime || null,
      })
      error = result.error
    }
    setPtLoading(false)
    if (error) {
      const tempIds = new Set(tempPointages.map(p => p.id))
      setPointages(prev => prev.filter(p => !tempIds.has(p.id)))
      setPtHoursInt(savedHours)
      setPtMinutes(savedMinutes)
      setPtDesc(savedDesc)
      setPtStartTime(savedStartTime)
    }
  }

  const handleDeletePointage = async (p: Pointage) => {
    if (!canManagePointages) return
    setPointages(prev => prev.filter(pt => pt.id !== p.id))
    setDeletedPointages(prev => [...prev, { id: p.id, userId: p.user_id, memberId: p.member_id, hours: p.hours }])
    await deletePointage(p.id, chantier.id)
  }

  // ── Notes ──

  const handleAddNote = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (!canEditChantier) return
    const contentToSave = noteContent.trim()
    if (!contentToSave) return

    // Optimistic: ajouter immédiatement
    const tempId = crypto.randomUUID()
    setNotes(prev => [{ id: tempId, chantier_id: chantier.id, content: contentToSave, created_at: new Date().toISOString(), author_name: 'Moi' }, ...prev])
    setNoteContent('')

    setNoteLoading(true)
    const { error } = await createChantierNote(chantier.id, contentToSave)
    setNoteLoading(false)
    if (error) {
      setNotes(prev => prev.filter(n => n.id !== tempId))
      setNoteContent(contentToSave)
    }
  }

  const handleDeleteNote = async (note: ChantierNote) => {
    if (!canEditChantier) return
    setNotes(prev => prev.filter(n => n.id !== note.id))
    await deleteChantierNote(note.id, chantier.id)
  }

  // ── Photos ──

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEditChantier) return
    const rawFile = e.target.files?.[0]
    if (!rawFile) return
    if (fileInputRef.current) fileInputRef.current.value = ''

    setPhotoError(null)
    setPhotoLoading(true)
    let file: File
    try {
      file = await compressImageToJpeg(rawFile)
    } catch (err) {
      setPhotoLoading(false)
      setPhotoError(err instanceof Error ? err.message : 'Photo illisible, réessayez avec un autre format.')
      return
    }

    // Prévisualisation immédiate
    const localUrl = URL.createObjectURL(file)
    const tempId = crypto.randomUUID()
    setPhotos(prev => [{
      id: tempId, chantier_id: chantier.id, tache_id: null,
      storage_path: '', caption: null, taken_at: new Date().toISOString(),
      created_at: new Date().toISOString(), uploaded_by_name: 'Moi', url: localUrl,
      include_in_report: false, shared_with_client_at: null, title: null,
    }, ...prev])

    const fd = new FormData()
    fd.append('file', file)
    const result = await uploadChantierPhoto(chantier.id, 'org', fd)
    setPhotoLoading(false)

    if (!result.error && result.photo) {
      const rp = result.photo
      setPhotos(prev => prev.map(p => p.id === tempId ? { ...rp, chantier_id: chantier.id, tache_id: null, include_in_report: false, shared_with_client_at: null, title: null } : p))
      URL.revokeObjectURL(localUrl)
    } else {
      setPhotos(prev => prev.filter(p => p.id !== tempId))
      URL.revokeObjectURL(localUrl)
      setPhotoError(result.error ?? 'Envoi de la photo échoué.')
    }
  }

  const handleDeletePhoto = async (photo: ChantierPhoto) => {
    if (!canEditChantier) return
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    await deleteChantierPhoto(photo.id, chantier.id)
  }

  return {
    initialChantier,
    initialTaches,
    initialPointages,
    initialPhotos,
    initialNotes,
    allEquipes,
    initialChantierEquipes,
    initialPlannings,
    linkableQuotes,
    taskLibraryTitles,
    orgMembers,
    orgRoles,
    initialProfitability,
    initialJalons,
    initialIndividualMembers,
    orgPhantomMembers,
    invoiceStubs,
    orgSector,
    materials,
    situationsSummary,
    canCreateSituation,
    canCreateSolde,
    canCreateInvoice,
    currentUserId,
    permissions,
    initialReserves,
    router,
    chantier,
    taches,
    setTaches,
    pointages,
    setPointages,
    deletedPointages,
    setDeletedPointages,
    photos,
    setPhotos,
    notes,
    setNotes,
    plannings,
    setPlannings,
    canEditChantier,
    canManageTeam,
    canPointage,
    canManagePointages,
    canViewExpenses,
    canCreateExpenses,
    canEditExpenses,
    canDeleteExpenses,
    canEditRates,
    segments,
    segment,
    setSegment,
    activeSegment,
    newTacheTitle,
    setNewTacheTitle,
    newTacheDue,
    setNewTacheDue,
    newTacheEquipeIds,
    setNewTacheEquipeIds,
    newTacheMemberIds,
    setNewTacheMemberIds,
    showNewTacheAssignments,
    setShowNewTacheAssignments,
    tacheLoading,
    setTacheLoading,
    ptDate,
    setPtDate,
    ptStartTime,
    setPtStartTime,
    ptHoursInt,
    setPtHoursInt,
    ptMinutes,
    setPtMinutes,
    ptDesc,
    setPtDesc,
    ptTacheId,
    setPtTacheId,
    ptLoading,
    setPtLoading,
    ptMode,
    setPtMode,
    ptEquipeId,
    setPtEquipeId,
    ptPresentMemberIds,
    setPtPresentMemberIds,
    noteContent,
    setNoteContent,
    noteLoading,
    setNoteLoading,
    fileInputRef,
    photoLoading,
    setPhotoLoading,
    photoError,
    setPhotoError,
    lightboxPhoto,
    setLightboxPhoto,
    lightboxTitle,
    setLightboxTitle,
    lightboxCaption,
    setLightboxCaption,
    lightboxSaving,
    setLightboxSaving,
    selectedPhotoIds,
    setSelectedPhotoIds,
    showSendPhotosPanel,
    setShowSendPhotosPanel,
    photosEmailMsg,
    setPhotosEmailMsg,
    photosEmailStatus,
    setPhotosEmailStatus,
    photosEmailError,
    setPhotosEmailError,
    photosEmailRecipient,
    setPhotosEmailRecipient,
    editContact,
    setEditContact,
    contactName,
    setContactName,
    contactEmail,
    setContactEmail,
    contactPhone,
    setContactPhone,
    chantierClientEmail,
    setChantierClientEmail,
    contactSaving,
    setContactSaving,
    contactError,
    setContactError,
    editDates,
    setEditDates,
    startDate,
    setStartDate,
    estimatedEndDate,
    setEstimatedEndDate,
    datesSaving,
    setDatesSaving,
    datesError,
    setDatesError,
    initialBillingParts,
    editBilling,
    setEditBilling,
    billingAmount,
    setBillingAmount,
    billingLabel,
    setBillingLabel,
    billingPeriod,
    setBillingPeriod,
    billingDay,
    setBillingDay,
    billingMonth,
    setBillingMonth,
    billingYear,
    setBillingYear,
    billingSaving,
    setBillingSaving,
    billingGenerating,
    setBillingGenerating,
    billingError,
    setBillingError,
    editRetention,
    setEditRetention,
    retentionPct,
    setRetentionPct,
    retentionSaving,
    setRetentionSaving,
    retentionError,
    setRetentionError,
    handleSaveRetention,
    linkedQuoteId,
    setLinkedQuoteId,
    editQuoteLink,
    setEditQuoteLink,
    quoteLinkValue,
    setQuoteLinkValue,
    quoteLinkSaving,
    setQuoteLinkSaving,
    quoteLinkError,
    setQuoteLinkError,
    showAIAssistant,
    setShowAIAssistant,
    linkedQuote,
    handleSaveQuoteLink,
    handleSaveContact,
    handleSaveDates,
    selectedBillingDate,
    billingYears,
    handleSaveBilling,
    handleGeneratePeriodInvoice,
    showPdfPanel,
    setShowPdfPanel,
    pdfFrom,
    setPdfFrom,
    pdfTo,
    setPdfTo,
    emailStatus,
    setEmailStatus,
    emailError,
    setEmailError,
    emailRecipient,
    setEmailRecipient,
    reportEmailRequiredOpen,
    setReportEmailRequiredOpen,
    photosEmailRequiredOpen,
    setPhotosEmailRequiredOpen,
    getReportClientEmailTarget,
    handleSendReportEmail,
    handleReportClientEmailSaved,
    handleSendPhotosEmail,
    handlePhotosClientEmailSaved,
    taskSuggestions,
    setTaskSuggestions,
    suggestTasksLoading,
    setSuggestTasksLoading,
    suggestTasksError,
    setSuggestTasksError,
    suggestTasksCreditsError,
    setSuggestTasksCreditsError,
    showTaskSuggestions,
    setShowTaskSuggestions,
    validateAllLoading,
    setValidateAllLoading,
    validatingSuggId,
    setValidatingSuggId,
    showTaskLibrary,
    setShowTaskLibrary,
    taskLibraryFilter,
    setTaskLibraryFilter,
    fmtDate,
    fmtMoney,
    totalHours,
    selectedPointageEquipe,
    allAssignableMembers,
    tachesCount,
    tachesDone,
    donePct,
    handleAddTache,
    handleStatusToggle,
    handleSetTacheStatus,
    handleDeleteTache,
    handleRenameTache,
    handleSaveTacheNote,
    handleSaveTacheAssignments,
    handleMoveTache,
    handleSuggestTasks,
    handleValidateSuggestion,
    handleValidateAllSuggestions,
    handleAddPlanning,
    handleDeletePlanning,
    handleAddPointage,
    handleDeletePointage,
    handleAddNote,
    handleDeleteNote,
    handlePhotoUpload,
    handleDeletePhoto,
    canDeleteChantier,
  }
}

export type ChantierDetailState = ReturnType<typeof useChantierDetail>
