'use client'
// @atelier-migrated

import React, { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Quote } from '@/lib/data/queries/quotes'
import type { Invoice } from '@/lib/data/queries/invoices'
import type { ReceivedInvoice } from '@/lib/data/queries/received-invoices'
import { formatCurrency } from '@/components/shared'
import { archiveQuote, markQuoteAccepted, duplicateQuote } from '@/lib/data/mutations/quotes'
import { archiveInvoice, markInvoicePaid, generateDepositInvoice, recordScheduledPayment } from '@/lib/data/mutations/invoices'
import { createChantierFromQuote } from '@/lib/data/mutations/chantiers'
import { linkReceivedInvoiceToChantier } from '@/lib/data/mutations/chantier-expenses'
import ImportDocumentsModal from './ImportDocumentsModal'
import SituationsSection from '@/components/situations/SituationsSection'
import { loadSituationsSummary } from './actions'
import type { SituationsSummary } from '@/lib/data/queries/invoices'
import { todayParis } from '@/lib/utils'
import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Hud } from '@/components/ui/Hud'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import screen from '@/components/layout/Screen.module.css'
import styles from './Documents.module.css'

const NB = ' '

// ─── Helpers mois ─────────────────────────────────────────────────────────────

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

function getCurrentYM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function offsetYM(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function fmtYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_FR[m - 1]} ${y}`
}

const MONTHS_SHORT = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']

function fmtShortYM(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return `${MONTHS_SHORT[m - 1]} ${y}`
}

function pct(current: number, prev: number): string {
  if (prev === 0 || current === 0) return ''
  const p = Math.round(((current - prev) / prev) * 100)
  if (p === 0) return ''
  return ` (${p > 0 ? '+' : '−'}${Math.abs(p)}${NB}% vs mois précédent)`
}

type Status = { label: string; status: StatusPillStatus }

const STATUS: Record<string, Status> = {
  draft:          { label: 'Brouillon', status: 'neutral' },
  sent:           { label: 'Envoyé',    status: 'wait' },
  viewed:         { label: 'Consulté',  status: 'wait' },
  accepted:       { label: 'Accepté',   status: 'success' },
  refused:        { label: 'Refusé',    status: 'danger' },
  expired:        { label: 'Expiré',    status: 'neutral' },
  converted:      { label: 'Converti',  status: 'success' },
  fully_invoiced: { label: 'Facturé',   status: 'success' },
}

const INVOICE_STATUS: Record<string, Status> = {
  draft:     { label: 'Brouillon',           status: 'neutral' },
  sent:      { label: 'Envoyée',             status: 'wait' },
  partial:   { label: 'Partiellement payée', status: 'wait' },
  paid:      { label: 'Payée',               status: 'success' },
  cancelled: { label: 'Annulée',             status: 'danger' },
}

const RECEIVED_INVOICE_STATUS: Record<string, Status> = {
  received:  { label: 'Reçue',   status: 'wait' },
  verified:  { label: 'À payer', status: 'wait' },
  accounted: { label: 'Payée',   status: 'success' },
  rejected:  { label: 'Rejetée', status: 'danger' },
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })

function buildEditorHref(path: string, params: Record<string, string | null | undefined> = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

type Selected =
  | { kind: 'quote'; id: string }
  | { kind: 'invoice'; id: string }
  | { kind: 'received'; id: string }

export default function FinancesClient({
  initialQuotes, initialInvoices,
  canCreateQuote, canEditQuote, canSendQuote, canDeleteQuote,
  canCreateInvoice, canSendInvoice, canRecordPayment, canDeleteInvoice,
  canCreateSituation = false, canCreateSolde = false,
  canViewReceivedInvoices = false, initialReceivedInvoices = [],
  linkableChantiers = [], canLinkReceivedInvoice = false,
}: {
  initialQuotes: Quote[]
  initialInvoices: Invoice[]
  canCreateQuote: boolean
  canEditQuote: boolean
  canSendQuote: boolean
  canDeleteQuote: boolean
  canCreateInvoice: boolean
  canSendInvoice: boolean
  canRecordPayment: boolean
  canDeleteInvoice: boolean
  canCreateSituation?: boolean
  canCreateSolde?: boolean
  canViewReceivedInvoices?: boolean
  initialReceivedInvoices?: ReceivedInvoice[]
  linkableChantiers?: { id: string; title: string }[]
  canLinkReceivedInvoice?: boolean
}) {
  const [selected, setSelected] = useState<Selected | null>(null)
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null)
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<'quotes' | 'invoices' | 'received'>(
    searchParams.get('tab') === 'invoices' ? 'invoices'
      : searchParams.get('tab') === 'received' && canViewReceivedInvoices ? 'received'
      : 'quotes'
  )
  const [receivedInvoices, setReceivedInvoices] = useState(initialReceivedInvoices)
  const [linkingReceivedInvoiceId, setLinkingReceivedInvoiceId] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [quotes, setQuotes] = useState(initialQuotes)
  const [invoices, setInvoices] = useState(initialInvoices)
  const [isNavigating, setIsNavigating] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [loadingScheduleId, setLoadingScheduleId] = useState<string | null>(null)
  const [depositModal, setDepositModal] = useState<{ quoteId: string; quoteTitle: string | null; quoteTtc: number | null } | null>(null)
  const [situationsPanel, setSituationsPanel] = useState<{ quoteId: string; quoteTitle: string | null; chantierId: string | null } | null>(null)
  const [situationsSummary, setSituationsSummary] = useState<SituationsSummary | null>(null)
  const [situationsSummaryLoading, setSituationsSummaryLoading] = useState(false)
  const [statsMonth, setStatsMonth] = useState(() => {
    const m = searchParams.get('month')
    return m && /^\d{4}-\d{2}$/.test(m) ? m : getCurrentYM()
  })
  const [quoteStatsMonth, setQuoteStatsMonth] = useState(() => {
    const m = searchParams.get('month')
    return m && /^\d{4}-\d{2}$/.test(m) ? m : getCurrentYM()
  })
  const [depositRate, setDepositRate] = useState(30)
  const [depositDueDate, setDepositDueDate] = useState('')
  const [depositBalanceDueDate, setDepositBalanceDueDate] = useState('')
  const [depositLoading, setDepositLoading] = useState(false)
  const [depositError, setDepositError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importDefaultType, setImportDefaultType] = useState<'invoices' | 'quotes'>('invoices')
  const [reportLoading, setReportLoading] = useState(false)
	  const [paymentModal, setPaymentModal] = useState<{
	    invoiceId: string
	    invoiceNumber: string | null
	    schedule: { id: string; label: string; due_date: string; amount: number; amount_type?: 'amount' | 'percentage'; percentage?: number | null }[]
	  } | null>(null)
  const [paymentScheduleItemId, setPaymentScheduleItemId] = useState('')
  const [paymentDate, setPaymentDate] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('virement')
  const [paymentRef, setPaymentRef] = useState('')
  const [paymentLoading, setPaymentLoading] = useState(false)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const [markPaidLoadingId, setMarkPaidLoadingId] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 10
  const returnTo = activeTab === 'quotes'
    ? `/finances?tab=quotes&month=${quoteStatsMonth}`
    : `/finances?tab=invoices&month=${statsMonth}`
  const quoteEditorHref = (id?: string) => buildEditorHref('/finances/quote-editor', { id, returnTo })
  const invoiceEditorHref = (id?: string) => buildEditorHref('/finances/invoice-editor', { id, returnTo })

  // ── Quote filters & stats ────────────────────────────────────────────────────

  const filtered = quotes.filter(q => {
    const clientName = q.client?.company_name ?? q.client?.email ?? ''
    const matchSearch = !searchTerm ||
      clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.number ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.title ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = statusFilter === 'all' || q.status === statusFilter
    const matchMonth = q.created_at.startsWith(quoteStatsMonth)
    return matchSearch && matchStatus && matchMonth
  })

  const sentCount = quotes.filter(q => q.status === 'sent' || q.status === 'viewed').length
  const acceptedCount = quotes.filter(q => q.status === 'accepted').length
  const conversionRate = quotes.length > 0 ? Math.round((acceptedCount / quotes.length) * 100) : 0
  // Total accepté en HT (référence professionnelle BTP)
  const acceptedTotal = quotes.filter(q => q.status === 'accepted').reduce((sum, q) => sum + (q.total_ht ?? 0), 0)

  // ── Stats mensuelles devis ───────────────────────────────────────────────────
  const prevQuoteStatsMonth = offsetYM(quoteStatsMonth, -1)
  const isCurrentQuoteMonth = quoteStatsMonth === getCurrentYM()

  const quotesOfMonth = quotes.filter(q => q.created_at.startsWith(quoteStatsMonth))
  const quotesOfPrevMonth = quotes.filter(q => q.created_at.startsWith(prevQuoteStatsMonth))
  const emittedQuoteStatuses = ['sent', 'viewed', 'accepted', 'refused', 'expired', 'converted', 'fully_invoiced']
  const emittedQuotesOfMonth = quotesOfMonth.filter(q => emittedQuoteStatuses.includes(q.status))
  const emittedQuotesOfPrevMonth = quotesOfPrevMonth.filter(q => emittedQuoteStatuses.includes(q.status))

  const qEmisCount = emittedQuotesOfMonth.length
  const qEmisCountPrev = emittedQuotesOfPrevMonth.length
  const qEmisHt = emittedQuotesOfMonth.reduce((s, q) => s + (q.total_ht ?? 0), 0)
  const qEmisHtPrev = emittedQuotesOfPrevMonth.reduce((s, q) => s + (q.total_ht ?? 0), 0)
  const qAcceptedCount = quotesOfMonth.filter(q => q.status === 'accepted').length
  const qAcceptedHt = quotesOfMonth.filter(q => q.status === 'accepted').reduce((s, q) => s + (q.total_ht ?? 0), 0)
  const qAcceptedHtPrev = quotesOfPrevMonth.filter(q => q.status === 'accepted').reduce((s, q) => s + (q.total_ht ?? 0), 0)
  const qConvBase = quotesOfMonth.filter(q => ['sent', 'viewed', 'accepted', 'refused', 'expired'].includes(q.status)).length
  const qConvRate = qConvBase > 0 ? Math.round((qAcceptedCount / qConvBase) * 100) : 0
  const qConvBasePrev = quotesOfPrevMonth.filter(q => ['sent', 'viewed', 'accepted', 'refused', 'expired'].includes(q.status)).length
  const qAcceptedCountPrev = quotesOfPrevMonth.filter(q => q.status === 'accepted').length
  const qConvRatePrev = qConvBasePrev > 0 ? Math.round((qAcceptedCountPrev / qConvBasePrev) * 100) : 0

  // ── Invoice filters & stats ──────────────────────────────────────────────────

  const today = todayParis()
  const prevStatsMonth = offsetYM(statsMonth, -1)
  const isCurrentMonth = statsMonth === getCurrentYM()
  const invDate = (inv: Invoice) => inv.issue_date ?? inv.sent_at ?? inv.created_at

  const filteredInvoices = invoices.filter(inv => {
    const clientName = inv.client?.company_name ?? inv.client?.email ?? ''
    const matchSearch = !searchTerm ||
      clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.number ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.title ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter
    const matchMonth = invDate(inv).startsWith(statsMonth)
    return matchSearch && matchStatus && matchMonth
  })

  // ── Received invoice filters ─────────────────────────────────────────────────

  const filteredReceivedInvoices = receivedInvoices.filter(ri => {
    const matchSearch = !searchTerm ||
      ri.supplier_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      ri.invoice_number.toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = statusFilter === 'all' || ri.status === statusFilter
    return matchSearch && matchStatus
  })

  const receivedToPayCount = receivedInvoices.filter(ri => ri.status === 'verified').length
  const receivedToPayTotal = receivedInvoices.filter(ri => ri.status === 'verified').reduce((s, ri) => s + ri.total_ttc, 0)
  const receivedOverdueCount = receivedInvoices.filter(
    ri => ri.status === 'verified' && ri.due_date != null && ri.due_date < today
  ).length

  const activeFilteredCount = activeTab === 'quotes' ? filtered.length : activeTab === 'invoices' ? filteredInvoices.length : filteredReceivedInvoices.length
  const totalPages = Math.max(1, Math.ceil(activeFilteredCount / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const paginatedQuotes = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const paginatedInvoices = filteredInvoices.slice(pageStart, pageStart + PAGE_SIZE)
  const paginatedReceivedInvoices = filteredReceivedInvoices.slice(pageStart, pageStart + PAGE_SIZE)

  // Stats globales (toutes périodes) - pour les lignes de la table
  // Stats par mois sélectionné - pour les KPI cards
  const invOfMonth = invoices.filter(inv => invDate(inv).startsWith(statsMonth))
  const invOfPrevMonth = invoices.filter(inv => invDate(inv).startsWith(prevStatsMonth))

  const invoicePaidAmount = (inv: Invoice) =>
    inv.status === 'partial' ? (inv.total_paid ?? 0) : inv.status === 'paid' ? (inv.total_ttc ?? 0) : 0
  const invoiceRemainingAmount = (inv: Invoice) =>
    inv.status === 'partial' ? Math.max(0, (inv.total_ttc ?? 0) - (inv.total_paid ?? 0)) : inv.status === 'sent' ? (inv.total_ttc ?? 0) : 0

  const totalEncaisse = invOfMonth.reduce((s, inv) => s + invoicePaidAmount(inv), 0)
  const totalEncaissePrev = invOfPrevMonth.reduce((s, inv) => s + invoicePaidAmount(inv), 0)

  const resteARecouvrer = invOfMonth.reduce((s, inv) => s + invoiceRemainingAmount(inv), 0)

  const enRetardCount = invoices.filter(
    inv => (inv.status === 'sent' || inv.status === 'partial') && inv.due_date != null && inv.due_date < today
  ).length

  // Montant facturé du mois = factures envoyées ou payées (sent + partial + paid) HT
  const caMois = invOfMonth.filter(inv => ['sent', 'partial', 'paid'].includes(inv.status)).reduce((s, inv) => s + (inv.total_ht ?? 0), 0)
  const caMoisPrev = invOfPrevMonth.filter(inv => ['sent', 'partial', 'paid'].includes(inv.status)).reduce((s, inv) => s + (inv.total_ht ?? 0), 0)

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleArchiveQuote = async (id: string) => {
    await archiveQuote(id)
    setQuotes(prev => prev.filter(q => q.id !== id))
  }

  const handleArchiveInvoice = async (id: string) => {
    await archiveInvoice(id)
    setInvoices(prev => prev.filter(inv => inv.id !== id))
  }

  const handleMarkPaid = async (id: string) => {
    if (markPaidLoadingId) return
    const previousInvoices = invoices
    const optimisticPaidAt = new Date().toISOString()
    setMarkPaidLoadingId(id)
    setInvoices(prev => prev.map(inv =>
      inv.id === id
        ? { ...inv, status: 'paid' as const, total_paid: inv.total_ttc ?? inv.total_paid, paid_at: optimisticPaidAt }
        : inv
    ))
    const res = await markInvoicePaid(id)
    setMarkPaidLoadingId(null)
    if (res.error) {
      setInvoices(previousInvoices)
      setNotice({ message: res.error, error: true })
      return
    }
    setInvoices(prev => prev.map(inv =>
      inv.id === id
        ? { ...inv, status: 'paid' as const, total_paid: res.total_paid ?? inv.total_ttc, paid_at: res.paid_at ?? inv.paid_at }
        : inv
    ))
  }

  const handleRecordScheduledPayment = async () => {
    if (!paymentModal || !paymentScheduleItemId) return
    setPaymentLoading(true)
    setPaymentError(null)

    // Cas sans échéancier : on marque directement comme payée
    if (paymentScheduleItemId === '__full__') {
      const res = await markInvoicePaid(paymentModal.invoiceId)
      setPaymentLoading(false)
      if (res.error) { setPaymentError(res.error); return }
      setInvoices(prev => prev.map(inv =>
        inv.id === paymentModal.invoiceId
          ? { ...inv, status: 'paid' as const, total_paid: res.total_paid ?? inv.total_ttc, paid_at: res.paid_at ?? inv.paid_at }
          : inv
      ))
      setPaymentModal(null)
      return
    }

    const scheduleItem = paymentModal.schedule.find(s => s.id === paymentScheduleItemId)
    if (!scheduleItem) { setPaymentError('Échéance introuvable.'); setPaymentLoading(false); return }
    const res = await recordScheduledPayment(paymentModal.invoiceId, paymentScheduleItemId, {
      amount: scheduleItem.amount,
      payment_date: paymentDate || todayParis(),
      method: paymentMethod || undefined,
      reference: paymentRef || undefined,
    })
    setPaymentLoading(false)
    if (res.error) { setPaymentError(res.error); return }
    setInvoices(prev => prev.map(inv =>
      inv.id === paymentModal.invoiceId
        ? { ...inv, status: res.status ?? 'partial' as const, total_paid: res.total_paid ?? inv.total_paid }
        : inv
    ))
    setPaymentModal(null)
  }

  useEffect(() => {
    setQuotes(initialQuotes)
    setInvoices(initialInvoices)
    setReceivedInvoices(initialReceivedInvoices)
    setIsRefreshing(false)
  }, [initialQuotes, initialInvoices, initialReceivedInvoices])

  const handleRefresh = () => {
    setIsRefreshing(true)
    router.refresh()
  }

  const handleMarkQuoteAccepted = async (id: string) => {
    await markQuoteAccepted(id)
    setQuotes(prev => prev.map(q => q.id === id ? { ...q, status: 'accepted' as const } : q))
  }

  const handleDuplicateQuote = async (id: string) => {
    const { quoteId, error } = await duplicateQuote(id)
    if (!error && quoteId) { setIsNavigating(true); router.push(quoteEditorHref(quoteId)) }
  }

  const handleCreateChantierFromQuote = async (quoteId: string) => {
    const { chantierId, error } = await createChantierFromQuote(quoteId)
    if (!error && chantierId) { setIsNavigating(true); router.push(`/chantiers/${chantierId}`) }
  }

  const handleOpenSituations = async (quoteId: string, quoteTitle: string | null) => {
    setSituationsPanel({ quoteId, quoteTitle, chantierId: null })
    setSituationsSummary(null)
    setSituationsSummaryLoading(true)
    const { summary, chantierId } = await loadSituationsSummary(quoteId)
    setSituationsPanel({ quoteId, quoteTitle, chantierId })
    setSituationsSummary(summary)
    setSituationsSummaryLoading(false)
  }

  const handleGenerateDeposit = async () => {
    if (!depositModal) return
    setDepositLoading(true)
    setDepositError(null)
    const { invoiceId, error } = await generateDepositInvoice(
      depositModal.quoteId,
      depositRate,
      depositDueDate || null,
      depositBalanceDueDate || null,
    )
    setDepositLoading(false)
    if (error) { setDepositError(error); return }
    setDepositModal(null)
    if (invoiceId) { setIsNavigating(true); router.push(invoiceEditorHref(invoiceId)) }
  }

  const handleDownloadMonthlyReport = async () => {
    setReportLoading(true)
    try {
      const res = await fetch(`/api/finances/monthly-report?month=${statsMonth}`)
      if (!res.ok) { setReportLoading(false); return }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = res.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1] ?? `rapport-${statsMonth}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setReportLoading(false)
    }
  }

  // Reset status filter when switching tabs + sync URL
  const handleTabChange = (tab: 'quotes' | 'invoices' | 'received') => {
    setActiveTab(tab)
    setStatusFilter('all')
    setSearchTerm('')
    setPage(1)
    router.replace(`/finances?tab=${tab}`, { scroll: false })
  }

  const handleLinkReceivedInvoiceChantier = async (receivedInvoiceId: string, chantierId: string | null) => {
    setLinkingReceivedInvoiceId(receivedInvoiceId)
    const previousReceivedInvoices = receivedInvoices
    const chantierTitle = chantierId ? (linkableChantiers.find(c => c.id === chantierId)?.title ?? null) : null
    setReceivedInvoices(prev => prev.map(ri =>
      ri.id === receivedInvoiceId ? { ...ri, chantier_id: chantierId, chantier_title: chantierTitle } : ri
    ))
    const res = await linkReceivedInvoiceToChantier(receivedInvoiceId, chantierId)
    setLinkingReceivedInvoiceId(null)
    if (res.error) {
      setReceivedInvoices(previousReceivedInvoices)
      setNotice({ message: res.error, error: true })
    }
  }

  // ── Retours d'action et détail ───────────────────────────────────────────────

  const activeStatusMap = activeTab === 'quotes' ? STATUS : activeTab === 'invoices' ? INVOICE_STATUS : RECEIVED_INVOICE_STATUS

  const depositPreview = depositModal
    ? Math.round((depositModal.quoteTtc ?? 0) * depositRate / 100 * 100) / 100
    : 0

  const go = (href: string) => { setIsNavigating(true); router.push(href) }

  const openPayment = async (inv: Invoice) => {
    setLoadingScheduleId(inv.id)
    try {
      const res = await fetch(`/api/invoices/${inv.id}/schedule`)
      const data = await res.json()
      const unpaid = (data.schedule ?? []).filter((s: { paid_payment_id?: string | null }) => !s.paid_payment_id)
      const scheduleToShow = unpaid.length > 0 ? unpaid : [{
        id: '__full__',
        label: 'Paiement intégral',
        due_date: todayParis(),
        amount: inv.total_ttc ?? 0,
        amount_type: 'amount' as const,
        percentage: null,
      }]
      setPaymentScheduleItemId(scheduleToShow[0].id)
      setPaymentDate(todayParis())
      setPaymentMethod('virement')
      setPaymentRef('')
      setPaymentError(null)
      setSelected(null)
      setPaymentModal({ invoiceId: inv.id, invoiceNumber: inv.number, schedule: scheduleToShow })
    } finally {
      setLoadingScheduleId(null)
    }
  }

  const openDeposit = (q: Quote) => {
    setDepositRate(30); setDepositDueDate(''); setDepositBalanceDueDate(''); setDepositError(null)
    setSelected(null)
    setDepositModal({ quoteId: q.id, quoteTitle: q.title, quoteTtc: q.total_ttc })
  }

  const run = async (fn: () => Promise<void>, message: string) => {
    setSelected(null)
    await fn()
    setNotice({ message })
  }

  const selectedQuote = selected?.kind === 'quote' ? quotes.find(q => q.id === selected.id) ?? null : null
  const selectedInvoice = selected?.kind === 'invoice' ? invoices.find(i => i.id === selected.id) ?? null : null
  const selectedReceived = selected?.kind === 'received' ? receivedInvoices.find(r => r.id === selected.id) ?? null : null

  const acceptedLike = (s: string) => s === 'accepted' || s === 'converted' || s === 'fully_invoiced'

  // Action principale du détail, d'après la maquette (un seul bouton plein).
  function quotePrimary(q: Quote): { label: string; onClick: () => void } | null {
    if (q.status === 'draft' && canEditQuote) return { label: 'Modifier le devis', onClick: () => go(quoteEditorHref(q.id)) }
    if ((q.status === 'sent' || q.status === 'viewed') && canSendQuote) return { label: 'Marquer accepté', onClick: () => run(() => handleMarkQuoteAccepted(q.id), `${q.number ?? 'Devis'} accepté`) }
    if (q.status === 'accepted' && canCreateInvoice) return { label: "Générer l'acompte", onClick: () => openDeposit(q) }
    if ((q.status === 'converted' || q.status === 'fully_invoiced') && (canCreateSituation || canCreateSolde)) return { label: 'Situations de travaux', onClick: () => { setSelected(null); handleOpenSituations(q.id, q.title) } }
    if ((q.status === 'refused' || q.status === 'expired') && canCreateQuote) return { label: 'Dupliquer', onClick: () => { setSelected(null); handleDuplicateQuote(q.id) } }
    return null
  }

  function invoicePrimary(inv: Invoice): { label: string; onClick: () => void; loading?: boolean } | null {
    if (inv.status === 'draft' && canSendInvoice) return { label: 'Valider et envoyer', onClick: () => go(invoiceEditorHref(inv.id)) }
    if ((inv.status === 'sent' || inv.status === 'partial') && canRecordPayment) return { label: 'Encaisser un versement', onClick: () => openPayment(inv), loading: loadingScheduleId === inv.id }
    return null
  }

  const clientOf = (doc: Quote | Invoice) => doc.client?.company_name ?? doc.client?.email ?? 'Sans client'

  // ── Résumé du segment, dans l'en-tête de la liste ────────────────────────────
  const summary = activeTab === 'quotes'
    ? `${qEmisCount} émis, ${qAcceptedCount} accepté${qAcceptedCount > 1 ? 's' : ''} · ${formatCurrency(qEmisHt)} HT${pct(qEmisHt, qEmisHtPrev)}`
    : activeTab === 'invoices'
      ? `${formatCurrency(caMois)} HT facturé${pct(caMois, caMoisPrev)} · ${formatCurrency(totalEncaisse)} encaissé${pct(totalEncaisse, totalEncaissePrev)}`
      : `${receivedToPayTotal > 0 ? `${formatCurrency(receivedToPayTotal)} à payer` : 'Rien à payer'}${receivedOverdueCount > 0 ? ` · ${receivedOverdueCount} en retard` : ''}`

  const noun = activeTab === 'quotes' ? 'devis' : activeTab === 'invoices' ? 'facture' : 'facture reçue'
  const listIsEmpty = activeFilteredCount === 0
  const filtersActive = statusFilter !== 'all' || searchTerm.trim() !== ''

  const segments = [
    { value: 'quotes', label: 'Devis' },
    { value: 'invoices', label: 'Factures' },
    ...(canViewReceivedInvoices ? [{ value: 'received', label: 'Reçues' }] : []),
  ]

  const listMenu = [
    { label: isRefreshing ? 'Actualisation…' : 'Actualiser', onSelect: handleRefresh },
    { label: 'Importer des documents', onSelect: () => { setImportDefaultType(activeTab === 'invoices' ? 'invoices' : 'quotes'); setImportOpen(true) } },
    { label: 'Factures récurrentes', onSelect: () => router.push('/finances/recurring') },
    { label: 'Contrats', onSelect: () => router.push('/contracts') },
    ...(activeTab === 'invoices' ? [{ label: reportLoading ? 'Génération du rapport…' : `Rapport ${fmtYM(statsMonth).toLocaleLowerCase('fr-FR')} (PDF)`, onSelect: handleDownloadMonthlyReport, disabled: reportLoading }] : []),
  ]

  const month = activeTab === 'quotes' ? quoteStatsMonth : statsMonth
  const setMonth = (delta: number | 'now') => {
    const update = (m: string) => delta === 'now' ? getCurrentYM() : offsetYM(m, delta)
    if (activeTab === 'quotes') setQuoteStatsMonth(update)
    else setStatsMonth(update)
    setPage(1)
  }
  const atCurrentMonth = activeTab === 'quotes' ? isCurrentQuoteMonth : isCurrentMonth

  const statusItems = [
    { label: 'Tous les statuts', onSelect: () => { setStatusFilter('all'); setPage(1) }, checked: statusFilter === 'all' },
    ...Object.entries(activeStatusMap).map(([key, s]) => ({ label: s.label, onSelect: () => { setStatusFilter(key); setPage(1) }, checked: statusFilter === key })),
  ]

  const createPrimary = activeTab === 'invoices'
    ? (canCreateInvoice ? { label: 'Nouvelle facture', href: invoiceEditorHref() } : null)
    : activeTab === 'quotes'
      ? (canCreateQuote ? { label: 'Nouveau devis', href: quoteEditorHref() } : null)
      : null

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        {isNavigating && (
          <div className={styles.navigating} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            <span>Chargement…</span>
          </div>
        )}

        <ImportDocumentsModal
          isOpen={importOpen}
          onClose={() => setImportOpen(false)}
          defaultType={importDefaultType}
        />

        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{activeTab === 'received' ? 'Factures fournisseurs' : fmtYM(month)}</p>
            <h1 className={screen.title}>Documents</h1>
          </div>
          <div className={styles.actions}>
            <Menu
              title="Documents"
              items={listMenu}
              trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
            />
            {createPrimary ? (
              <>
                <Button size="md" className={styles.createWide} onClick={() => go(createPrimary.href)}>{createPrimary.label}</Button>
                <button type="button" className={styles.createRound} onClick={() => go(createPrimary.href)} aria-label={createPrimary.label}>
                  <Plus size={20} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </header>

        <div className={styles.segmentRow}>
          <SegmentedControl
            label="Type de document"
            fullWidth
            options={segments}
            value={activeTab}
            onChange={(v) => handleTabChange(v as 'quotes' | 'invoices' | 'received')}
          />
          <p className={styles.summary}>{summary}</p>
        </div>

        <div className={styles.searchRow}>
          <SearchField
            value={searchTerm}
            onChange={(v) => { setSearchTerm(v); setPage(1) }}
            label="Rechercher"
            placeholder={activeTab === 'received' ? 'Fournisseur ou numéro' : 'Client, numéro ou titre'}
          />
        </div>

        <div className={styles.chips}>
          {activeTab !== 'received' ? (
            <div className={styles.monthChip}>
              <button type="button" className={styles.chipIcon} onClick={() => setMonth(-1)} aria-label="Mois précédent"><ChevronLeft size={16} aria-hidden="true" /></button>
              <button type="button" className={styles.chipLabel} onClick={() => setMonth('now')} disabled={atCurrentMonth} aria-label={atCurrentMonth ? fmtYM(month) : `${fmtYM(month)}, revenir au mois en cours`}><span className={styles.longMonth}>{fmtYM(month)}</span><span className={styles.shortMonth} aria-hidden="true">{fmtShortYM(month)}</span></button>
              <button type="button" className={styles.chipIcon} onClick={() => setMonth(1)} disabled={atCurrentMonth} aria-label="Mois suivant"><ChevronRight size={16} aria-hidden="true" /></button>
            </div>
          ) : null}
          <Menu
            title="Statut"
            items={statusItems}
            trigger={
              <button type="button" className={styles.chip} data-on={statusFilter !== 'all' ? 'true' : 'false'}>
                {statusFilter === 'all' ? 'Tous les statuts' : activeStatusMap[statusFilter]?.label ?? 'Statut'}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
            }
          />
          {activeTab === 'invoices' && enRetardCount > 0 ? (
            <span className={styles.lateNote}>{enRetardCount} en retard</span>
          ) : null}
        </div>

        {listIsEmpty ? (
          <div className={`${screen.empty} ${styles.emptyBlock}`}>
            <b>{filtersActive ? `Aucun ${noun} ne correspond` : activeTab === 'received' ? "Aucune facture reçue pour l'instant" : `Aucun${activeTab === 'invoices' ? 'e' : ''} ${noun} ce mois-ci`}</b>
            {filtersActive
              ? 'Essayez un autre statut ou une autre recherche.'
              : activeTab === 'received'
                ? 'Les factures reçues par votre plateforme de facturation électronique apparaîtront ici.'
                : 'Changez de mois, ou créez un document.'}
            {filtersActive ? (
              <div className={styles.emptyAction}>
                <Button variant="secondary" size="md" onClick={() => { setStatusFilter('all'); setSearchTerm(''); setPage(1) }}>Effacer les filtres</Button>
              </div>
            ) : null}
          </div>
        ) : (
          <section className={screen.group} aria-label={`Liste des ${noun}s`}>
            <ul className={screen.list}>
              {activeTab === 'quotes' && paginatedQuotes.map(q => {
                const st = STATUS[q.status] ?? STATUS.draft
                const client = clientOf(q)
                return (
                  <li key={q.id}>
                    <button type="button" className={screen.row} onClick={() => setSelected({ kind: 'quote', id: q.id })} aria-haspopup="dialog">
                      <span aria-hidden="true"><Avatar name={client} size={34} /></span>
                      <span className={screen.mid}>
                        <span className={screen.rowTitle}>{client}</span>
                        <span className={screen.rowSub}>{[q.number ?? 'Sans numéro', q.title ?? 'Sans titre'].join(' · ')}</span>
                      </span>
                      <span className={screen.rowEnd}>
                        <span className={screen.amount}>{q.total_ttc != null ? formatCurrency(q.total_ttc) : '/'}</span>
                        <StatusPill status={st.status}>{st.label}</StatusPill>
                      </span>
                    </button>
                  </li>
                )
              })}
              {activeTab === 'invoices' && paginatedInvoices.map(inv => {
                const st = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.draft
                const client = clientOf(inv)
                const isOverdue = (inv.status === 'sent' || inv.status === 'partial') && inv.due_date != null && inv.due_date < today
                const kind = inv.invoice_type === 'acompte' ? 'Acompte' : inv.invoice_type === 'solde' ? 'Solde' : inv.invoice_type === 'situation' ? 'Situation' : null
                return (
                  <li key={inv.id}>
                    <button type="button" className={screen.row} onClick={() => setSelected({ kind: 'invoice', id: inv.id })} aria-haspopup="dialog">
                      <span aria-hidden="true"><Avatar name={client} size={34} /></span>
                      <span className={screen.mid}>
                        <span className={screen.rowTitle}>{client}</span>
                        <span className={screen.rowSub}>
                          {[inv.number ?? 'Sans numéro', kind, inv.title].filter(Boolean).join(' · ')}
                          {isOverdue && inv.due_date ? <span className={styles.late}> · échue le {shortDate(inv.due_date)}</span> : null}
                        </span>
                      </span>
                      <span className={screen.rowEnd}>
                        <span className={screen.amount}>{inv.total_ttc != null ? formatCurrency(inv.total_ttc) : '/'}</span>
                        <StatusPill status={isOverdue ? 'danger' : st.status}>{isOverdue ? 'En retard' : st.label}</StatusPill>
                      </span>
                    </button>
                  </li>
                )
              })}
              {activeTab === 'received' && paginatedReceivedInvoices.map(ri => {
                const st = RECEIVED_INVOICE_STATUS[ri.status] ?? RECEIVED_INVOICE_STATUS.received
                const isOverdue = ri.status === 'verified' && ri.due_date != null && ri.due_date < today
                return (
                  <li key={ri.id}>
                    <button type="button" className={screen.row} onClick={() => setSelected({ kind: 'received', id: ri.id })} aria-haspopup="dialog">
                      <span aria-hidden="true"><Avatar name={ri.supplier_name} size={34} /></span>
                      <span className={screen.mid}>
                        <span className={screen.rowTitle}>{ri.supplier_name}</span>
                        <span className={screen.rowSub}>
                          {[ri.invoice_number, shortDate(ri.invoice_date), ri.chantier_title].filter(Boolean).join(' · ')}
                          {isOverdue && ri.due_date ? <span className={styles.late}> · échue le {shortDate(ri.due_date)}</span> : null}
                        </span>
                      </span>
                      <span className={screen.rowEnd}>
                        <span className={screen.amount}>{formatCurrency(ri.total_ttc)}</span>
                        <StatusPill status={isOverdue ? 'danger' : st.status}>{isOverdue ? 'En retard' : st.label}</StatusPill>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {totalPages > 1 ? (
              <div className={styles.pager}>
                <button type="button" className={screen.round} onClick={() => setPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} aria-label="Page précédente"><ChevronLeft size={18} aria-hidden="true" /></button>
                <span className={styles.pagerLabel}>Page {currentPage} sur {totalPages}</span>
                <button type="button" className={screen.round} onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} aria-label="Page suivante"><ChevronRight size={18} aria-hidden="true" /></button>
              </div>
            ) : null}
          </section>
        )}
      </div>

      {/* ── Détail d'un devis ── */}
      <Sheet
        open={selectedQuote !== null}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        title={selectedQuote ? `Devis ${selectedQuote.number ?? ''}`.trim() : 'Devis'}
        description={selectedQuote ? clientOf(selectedQuote) : undefined}
      >
        {selectedQuote ? (() => {
          const q = selectedQuote
          const st = STATUS[q.status] ?? STATUS.draft
          const primary = quotePrimary(q)
          const next: React.ReactNode[] = []
          if (canSendQuote && (q.status === 'sent' || q.status === 'viewed') && primary?.label !== 'Marquer accepté') next.push(<ListRow key="acc" title="Marquer accepté" description="Le client a donné son accord" onClick={() => run(() => handleMarkQuoteAccepted(q.id), `${q.number ?? 'Devis'} accepté`)} />)
          if (canCreateInvoice && acceptedLike(q.status)) {
            if (primary?.label !== "Générer l'acompte") next.push(<ListRow key="dep" title="Générer l'acompte" description="Taux et échéances au choix" onClick={() => openDeposit(q)} />)
            next.push(<ListRow key="ch" title="Créer le chantier" description="À partir de ce devis" onClick={() => { setSelected(null); handleCreateChantierFromQuote(q.id) }} />)
          }
          if ((canCreateSituation || canCreateSolde) && acceptedLike(q.status) && primary?.label !== 'Situations de travaux') next.push(<ListRow key="sit" title="Situations de travaux" description="Facturer selon l'avancement" onClick={() => { setSelected(null); handleOpenSituations(q.id, q.title) }} />)
          const edit: React.ReactNode[] = []
          if (canEditQuote && primary?.label !== 'Modifier le devis') edit.push(<ListRow key="ed" title="Modifier" onClick={() => go(quoteEditorHref(q.id))} />)
          if (canCreateQuote && primary?.label !== 'Dupliquer') edit.push(<ListRow key="dup" title="Dupliquer" description="Nouveau brouillon avec les mêmes lignes" onClick={() => { setSelected(null); handleDuplicateQuote(q.id) }} />)
          return (
            <div className={styles.detail}>
              <section className={`${screen.card} ${screen.hero}`}>
                <div className={screen.label}><span>Total TTC</span><StatusPill status={st.status}>{st.label}</StatusPill></div>
                <div className={screen.big}>{q.total_ttc != null ? formatCurrency(q.total_ttc) : '/'}</div>
                <div className={screen.sub}>{q.total_ht != null ? `${formatCurrency(q.total_ht)} HT` : ''}{q.title ? ` · ${q.title}` : ''}</div>
              </section>
              {primary ? <Button size="lg" className={styles.primary} onClick={primary.onClick}>{primary.label}</Button> : null}
              <ListGroup title="Informations">
                <ListRow title="Créé le" trailing={<span className={styles.value}>{shortDate(q.created_at)}</span>} />
                {q.valid_until ? <ListRow title="Valable jusqu'au" trailing={<span className={styles.value}>{shortDate(q.valid_until)}</span>} /> : null}
              </ListGroup>
              <ListGroup title="Document">
                <ListRow title="Aperçu du PDF" href={`/api/pdf/quote/${q.id}`} />
                <ListRow title="Télécharger le PDF" href={`/api/pdf/quote/${q.id}?download=1`} />
              </ListGroup>
              {next.length ? <ListGroup title="Ensuite">{next}</ListGroup> : null}
              {edit.length ? <ListGroup>{edit}</ListGroup> : null}
              {canDeleteQuote ? (
                <ListGroup>
                  <li className={styles.destructiveRow}>
                    <button type="button" onClick={() => run(() => handleArchiveQuote(q.id), `${q.number ?? 'Devis'} archivé`)}>Archiver le devis</button>
                  </li>
                </ListGroup>
              ) : null}
            </div>
          )
        })() : null}
      </Sheet>

      {/* ── Détail d'une facture ── */}
      <Sheet
        open={selectedInvoice !== null}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        title={selectedInvoice ? `Facture ${selectedInvoice.number ?? ''}`.trim() : 'Facture'}
        description={selectedInvoice ? clientOf(selectedInvoice) : undefined}
      >
        {selectedInvoice ? (() => {
          const inv = selectedInvoice
          const st = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS.draft
          const isOverdue = (inv.status === 'sent' || inv.status === 'partial') && inv.due_date != null && inv.due_date < today
          const primary = invoicePrimary(inv)
          const next: React.ReactNode[] = []
          if (canRecordPayment && inv.status === 'sent') next.push(<ListRow key="paid" title="Marquer payée" description="Paiement intégral reçu" disabled={markPaidLoadingId !== null} onClick={() => run(() => handleMarkPaid(inv.id), `${inv.number ?? 'Facture'} marquée payée`)} />)
          if (canCreateInvoice) next.push(<ListRow key="rec" title="Convertir en facture récurrente" onClick={() => go(`/finances/recurring?from_invoice=${inv.id}`)} />)
          const remaining = inv.status === 'partial' ? Math.max(0, (inv.total_ttc ?? 0) - (inv.total_paid ?? 0)) : null
          return (
            <div className={styles.detail}>
              <section className={`${screen.card} ${screen.hero}`}>
                <div className={screen.label}><span>Total TTC</span><StatusPill status={isOverdue ? 'danger' : st.status}>{isOverdue ? 'En retard' : st.label}</StatusPill></div>
                <div className={screen.big}>{inv.total_ttc != null ? formatCurrency(inv.total_ttc) : '/'}</div>
                <div className={screen.sub}>
                  {inv.total_ht != null ? `${formatCurrency(inv.total_ht)} HT` : ''}
                  {remaining != null ? ` · reste ${formatCurrency(remaining)}` : ''}
                </div>
              </section>
              {primary ? <Button size="lg" className={styles.primary} onClick={primary.onClick} loading={primary.loading}>{primary.label}</Button> : null}
              <ListGroup title="Informations">
                <ListRow title="Émise le" trailing={<span className={styles.value}>{shortDate(invDate(inv))}</span>} />
                {inv.due_date ? <ListRow title="Échéance" trailing={<span className={`${styles.value}${isOverdue ? ` ${styles.late}` : ''}`}>{shortDate(inv.due_date)}</span>} /> : null}
                {inv.title ? <ListRow title="Objet" trailing={<span className={styles.value}>{inv.title}</span>} /> : null}
              </ListGroup>
              <ListGroup title="Document">
                <ListRow title="Aperçu du PDF" href={`/api/pdf/invoice/${inv.id}`} />
                <ListRow title="Télécharger le PDF" href={`/api/pdf/invoice/${inv.id}?download=1`} />
              </ListGroup>
              {next.length ? <ListGroup title="Ensuite">{next}</ListGroup> : null}
              {canSendInvoice && inv.status !== 'draft' ? <ListGroup><ListRow title="Modifier" onClick={() => go(invoiceEditorHref(inv.id))} /></ListGroup> : null}
              {canDeleteInvoice ? (
                <ListGroup>
                  <li className={styles.destructiveRow}>
                    <button type="button" onClick={() => run(() => handleArchiveInvoice(inv.id), `${inv.number ?? 'Facture'} archivée`)}>Archiver la facture</button>
                  </li>
                </ListGroup>
              ) : null}
            </div>
          )
        })() : null}
      </Sheet>

      {/* ── Détail d'une facture reçue ── */}
      <Sheet
        open={selectedReceived !== null}
        onOpenChange={(open) => { if (!open) setSelected(null) }}
        title={selectedReceived ? `Facture ${selectedReceived.invoice_number}` : 'Facture reçue'}
        description={selectedReceived?.supplier_name}
      >
        {selectedReceived ? (() => {
          const ri = selectedReceived
          const st = RECEIVED_INVOICE_STATUS[ri.status] ?? RECEIVED_INVOICE_STATUS.received
          return (
            <div className={styles.detail}>
              <section className={`${screen.card} ${screen.hero}`}>
                <div className={screen.label}><span>Montant TTC</span><StatusPill status={st.status}>{st.label}</StatusPill></div>
                <div className={screen.big}>{formatCurrency(ri.total_ttc)}</div>
                <div className={screen.sub}>{formatCurrency(ri.total_ht)} HT · TVA {formatCurrency(ri.total_tva)}</div>
              </section>
              <ListGroup title="Informations">
                <ListRow title="Reçue le" trailing={<span className={styles.value}>{shortDate(ri.invoice_date)}</span>} />
                {ri.due_date ? <ListRow title="Échéance" trailing={<span className={styles.value}>{shortDate(ri.due_date)}</span>} /> : null}
                {ri.status === 'rejected' && ri.rejection_reason ? <ListRow title="Motif du rejet" description={ri.rejection_reason} /> : null}
              </ListGroup>
              {canLinkReceivedInvoice ? (
                <ListGroup title="Chantier rattaché" description="La facture compte dans la rentabilité du chantier choisi.">
                  {[{ id: '', title: 'Aucun chantier' }, ...linkableChantiers].map(c => {
                    const on = (ri.chantier_id ?? '') === c.id
                    return (
                      <ListRow
                        key={c.id || 'none'}
                        title={c.title}
                        trailing={on ? <span className={styles.tick} aria-label="Sélectionné">✓</span> : undefined}
                        disabled={linkingReceivedInvoiceId === ri.id}
                        onClick={() => { if (!on) handleLinkReceivedInvoiceChantier(ri.id, c.id || null) }}
                      />
                    )
                  })}
                </ListGroup>
              ) : (
                <ListGroup title="Chantier rattaché"><ListRow title={ri.chantier_title ?? 'Aucun chantier'} /></ListGroup>
              )}
            </div>
          )
        })() : null}
      </Sheet>

      {/* ── Encaisser un versement ── */}
      <Sheet
        open={paymentModal !== null}
        onOpenChange={(open) => { if (!open && !paymentLoading) setPaymentModal(null) }}
        title="Encaisser un versement"
        description={paymentModal?.invoiceNumber ?? undefined}
        onConfirm={handleRecordScheduledPayment}
        confirmLabel="Encaisser"
        confirmLoading={paymentLoading}
        confirmDisabled={!paymentScheduleItemId}
      >
        {paymentModal ? (
          <div className={styles.detail}>
            <ListGroup title="Échéance à solder">
              {paymentModal.schedule.map(s => (
                <ListRow
                  key={s.id}
                  title={s.label}
                  description={`${s.amount_type === 'percentage' && s.percentage ? `${s.percentage}${NB}% · ` : ''}${shortDate(s.due_date)}`}
                  trailing={<span className={styles.value}>{formatCurrency(s.amount)}{paymentScheduleItemId === s.id ? <span className={styles.tick} aria-label=", sélectionnée"> ✓</span> : null}</span>}
                  onClick={() => setPaymentScheduleItemId(s.id)}
                />
              ))}
            </ListGroup>
            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Date de réception</span>
                <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Mode de paiement</span>
                <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                  <option value="virement">Virement</option>
                  <option value="cheque">Chèque</option>
                  <option value="cb">Carte</option>
                  <option value="especes">Espèces</option>
                </select>
              </label>
              <label className={styles.field}>
                <span>Référence</span>
                <input type="text" value={paymentRef} onChange={e => setPaymentRef(e.target.value)} placeholder="Facultatif" />
              </label>
            </div>
            {paymentError ? <p className={screen.error} role="alert">{paymentError}</p> : null}
          </div>
        ) : null}
      </Sheet>

      {/* ── Facture d'acompte ── */}
      <Sheet
        open={depositModal !== null}
        onOpenChange={(open) => { if (!open && !depositLoading) { setDepositModal(null); setDepositError(null) } }}
        title="Facture d'acompte"
        description={depositModal?.quoteTitle ?? undefined}
        onConfirm={handleGenerateDeposit}
        confirmLabel="Générer"
        confirmLoading={depositLoading}
      >
        {depositModal ? (
          <div className={styles.detail}>
            {depositModal.quoteTtc != null ? (
              <div className={styles.total}>
                <small>Montant de l&apos;acompte</small>
                <b>{formatCurrency(depositPreview)}</b>
              </div>
            ) : null}
            <SegmentedControl
              label="Taux d'acompte"
              options={[20, 30, 40, 50].map(p => ({ value: String(p), label: `${p}${NB}%` }))}
              value={[20, 30, 40, 50].includes(depositRate) ? String(depositRate) : ''}
              onChange={(v) => setDepositRate(Number(v))}
            />
            <div className={styles.fields}>
              <label className={styles.field}>
                <span>Autre taux (% du TTC)</span>
                <input type="number" min={1} max={100} inputMode="numeric" value={depositRate} onChange={e => setDepositRate(Math.min(100, Math.max(1, Number(e.target.value))))} />
              </label>
              <label className={styles.field}>
                <span>Échéance de l&apos;acompte</span>
                <input type="date" value={depositDueDate} onChange={e => setDepositDueDate(e.target.value)} />
              </label>
              <label className={styles.field}>
                <span>Échéance du solde</span>
                <input type="date" value={depositBalanceDueDate} onChange={e => setDepositBalanceDueDate(e.target.value)} />
              </label>
            </div>
            {depositError ? <p className={screen.error} role="alert">{depositError}</p> : null}
          </div>
        ) : null}
      </Sheet>

      {/* ── Situations de travaux ── */}
      <Sheet
        open={situationsPanel !== null}
        onOpenChange={(open) => { if (!open) { setSituationsPanel(null); setSituationsSummary(null) } }}
        title="Situations de travaux"
        description={situationsPanel?.quoteTitle ?? undefined}
      >
        {situationsPanel ? (
          <div className={styles.detail}>
            {situationsSummaryLoading ? <p className={screen.sub} role="status">Chargement des situations…</p> : null}
            {!situationsSummaryLoading && !situationsSummary ? <p className={screen.sub}>Impossible de charger les situations pour ce devis.</p> : null}
            {!situationsSummaryLoading && situationsSummary && situationsPanel.chantierId ? (
              <SituationsSection
                chantierId={situationsPanel.chantierId}
                summary={situationsSummary}
                canCreateSituation={canCreateSituation}
                canCreateSolde={canCreateSolde}
                returnTo="/finances?tab=quotes"
              />
            ) : null}
            {!situationsSummaryLoading && situationsSummary && !situationsPanel.chantierId ? (
              <>
                <SituationsSection
                  chantierId=""
                  summary={situationsSummary}
                  canCreateSituation={false}
                  canCreateSolde={false}
                  returnTo="/finances?tab=quotes"
                />
                <p className={screen.sub}>Pour créer une situation, ce devis doit être lié à un chantier.</p>
                <Button variant="secondary" size="md" onClick={() => { const id = situationsPanel.quoteId; setSituationsPanel(null); handleCreateChantierFromQuote(id) }}>Créer le chantier</Button>
              </>
            ) : null}
          </div>
        ) : null}
      </Sheet>

      <Hud
        open={notice !== null && !notice.error}
        onOpenChange={(open) => { if (!open) setNotice(null) }}
        message={notice && !notice.error ? notice.message : ''}
      />
      <Hud
        open={notice !== null && notice.error === true}
        onOpenChange={(open) => { if (!open) setNotice(null) }}
        variant="error"
        message={notice?.error ? notice.message : ''}
        onRetry={() => { setNotice(null); handleRefresh() }}
      />
    </main>
  )
}
