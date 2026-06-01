'use client'

import React, { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import type { Quote } from '@/lib/data/queries/quotes'
import type { Invoice } from '@/lib/data/queries/invoices'
import { formatCurrency, ActionMenu } from '@/components/shared'
import { archiveQuote, markQuoteAccepted, duplicateQuote } from '@/lib/data/mutations/quotes'
import { archiveInvoice, markInvoicePaid, generateDepositInvoice, recordScheduledPayment } from '@/lib/data/mutations/invoices'
import { createChantierFromQuote } from '@/lib/data/mutations/chantiers'
import ImportDocumentsModal from './ImportDocumentsModal'
import SituationsSection from '@/components/situations/SituationsSection'
import { loadSituationsSummary } from './actions'
import type { SituationsSummary } from '@/lib/data/queries/invoices'
import { todayParis } from '@/lib/utils'
import {
  Search, Plus, FileText, Bot,
  CheckCircle2, Clock, Percent, Wallet, Receipt, AlertTriangle,
  Edit2, Trash2, FileDown, Eye, Repeat, Check, Copy, Landmark, HardHat,
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Upload, Loader2, CalendarClock, X, RefreshCw,
} from 'lucide-react'

// ─── Helpers mois ─────────────────────────────────────────────────────────────

const MONTHS_FR = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']

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

function DeltaBadge({ current, prev }: { current: number; prev: number }) {
  if (prev === 0 && current === 0) return null
  if (prev === 0) return <span className="text-xs font-semibold text-accent-green">Nouveau</span>
  const pct = Math.round(((current - prev) / prev) * 100)
  if (pct === 0) return <span className="text-xs text-secondary">= mois préc.</span>
  const up = pct > 0
  return (
    <span className={`text-xs font-semibold flex items-center gap-0.5 ${up ? 'text-accent-green' : 'text-red-500'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {up ? '+' : ''}{pct}% vs mois préc.
    </span>
  )
}

const STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon', cls: 'bg-secondary/10 text-secondary' },
  sent:      { label: 'Envoyé',    cls: 'bg-accent/10 text-accent' },
  viewed:    { label: 'Consulté',  cls: 'bg-blue-500/10 text-blue-500' },
  accepted:  { label: 'Accepté',   cls: 'bg-accent-green/10 text-accent-green' },
  refused:   { label: 'Refusé',    cls: 'bg-red-500/10 text-red-500' },
  expired:   { label: 'Expiré',    cls: 'bg-orange-500/10 text-orange-500' },
  converted: { label: 'Converti',  cls: 'bg-purple-500/10 text-purple-500' },
}

const INVOICE_STATUS: Record<string, { label: string; cls: string }> = {
  draft:     { label: 'Brouillon',           cls: 'bg-secondary/10 text-secondary' },
  sent:      { label: 'Envoyée',             cls: 'bg-accent/10 text-accent' },
  partial:   { label: 'Partiellement payée', cls: 'bg-blue-500/10 text-blue-500' },
  paid:      { label: 'Payée',               cls: 'bg-accent-green/10 text-accent-green' },
  cancelled: { label: 'Annulée',             cls: 'bg-red-500/10 text-red-500' },
}

function StatCard({ icon, label, value, danger }: { icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-3xl card p-6 flex items-center gap-4">
      <div className="flex-shrink-0">{icon}</div>
      <div>
        <p className="text-sm font-semibold text-secondary uppercase tracking-wider">{label}</p>
        <p className={`text-2xl font-bold tabular-nums ${danger ? 'text-red-500' : 'text-primary'}`}>{value}</p>
      </div>
    </div>
  )
}

function buildEditorHref(path: string, params: Record<string, string | null | undefined> = {}) {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) query.set(key, value)
  })
  const qs = query.toString()
  return qs ? `${path}?${qs}` : path
}

function EmptyState({ type, canCreate, returnTo }: { type: 'quotes' | 'invoices'; canCreate: boolean; returnTo: string }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <FileText className="w-10 h-10 text-secondary opacity-20" />
      <div>
        <p className="text-xl font-bold text-primary">
          Aucun {type === 'quotes' ? 'devis' : 'facture'} pour l&apos;instant
        </p>
        <p className="text-secondary mt-1">
          {type === 'quotes' ? 'Créez votre premier devis pour commencer.' : 'Vos factures apparaîtront ici une fois créées.'}
        </p>
      </div>
      {canCreate && type === 'quotes' && (
        <Link href={buildEditorHref('/finances/quote-editor', { returnTo })} className="mt-2 px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 whitespace-nowrap">
          <Bot className="w-4 h-4" />Nouveau Devis
        </Link>
      )}
      {canCreate && type === 'invoices' && (
        <Link href={buildEditorHref('/finances/invoice-editor', { returnTo })} className="mt-2 px-6 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center gap-2 hover:bg-base transition-all whitespace-nowrap">
          <Plus className="w-4 h-4" />Nouvelle Facture
        </Link>
      )}
    </div>
  )
}

export default function FinancesClient({
  initialQuotes, initialInvoices,
  canCreateQuote, canEditQuote, canSendQuote, canDeleteQuote,
  canCreateInvoice, canSendInvoice, canRecordPayment, canDeleteInvoice,
  canCreateSituation = false, canCreateSolde = false,
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
}) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [activeTab, setActiveTab] = useState<'quotes' | 'invoices'>(
    searchParams.get('tab') === 'invoices' ? 'invoices' : 'quotes'
  )
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

  const qEmisCount = quotesOfMonth.length
  const qEmisCountPrev = quotesOfPrevMonth.length
  const qEmisHt = quotesOfMonth.reduce((s, q) => s + (q.total_ht ?? 0), 0)
  const qEmisHtPrev = quotesOfPrevMonth.reduce((s, q) => s + (q.total_ht ?? 0), 0)
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
  const activeFilteredCount = activeTab === 'quotes' ? filtered.length : filteredInvoices.length
  const totalPages = Math.max(1, Math.ceil(activeFilteredCount / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const pageStart = (currentPage - 1) * PAGE_SIZE
  const paginatedQuotes = filtered.slice(pageStart, pageStart + PAGE_SIZE)
  const paginatedInvoices = filteredInvoices.slice(pageStart, pageStart + PAGE_SIZE)

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
      alert(res.error)
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
    setIsRefreshing(false)
  }, [initialQuotes, initialInvoices])

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
  const handleTabChange = (tab: 'quotes' | 'invoices') => {
    setActiveTab(tab)
    setStatusFilter('all')
    setSearchTerm('')
    setPage(1)
    router.replace(`/finances?tab=${tab}`, { scroll: false })
  }

  const activeStatusMap = activeTab === 'quotes' ? STATUS : INVOICE_STATUS

  const depositPreview = depositModal
    ? Math.round((depositModal.quoteTtc ?? 0) * depositRate / 100 * 100) / 100
    : 0

  return (
    <main className="page-container space-y-6 md:space-y-8">

      {isNavigating && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-base/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            <p className="text-sm text-secondary">Chargement...</p>
          </div>
        </div>
      )}

      <ImportDocumentsModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        defaultType={importDefaultType}
      />

      {/* ── Modale paiement échéancier ── */}
      {paymentModal && (
        <div className="modal-overlay">
          <div className="modal-panel space-y-5 sm:max-w-sm">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/10 flex items-center justify-center">
                  <CalendarClock className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-primary">Encaisser un versement</h2>
                  <p className="text-xs text-secondary">{paymentModal.invoiceNumber ?? 'Facture'}</p>
                </div>
              </div>
              <button onClick={() => setPaymentModal(null)} className="text-secondary hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Échéance à solder</label>
              <select
                value={paymentScheduleItemId}
                onChange={e => setPaymentScheduleItemId(e.target.value)}
                className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none"
              >
                <option value="">Sélectionner...</option>
                {paymentModal.schedule.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.label} - {s.amount_type === 'percentage' && s.percentage ? `${s.percentage}% · ` : ''}{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(s.amount)} · {new Date(s.due_date).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-secondary">Date de réception</label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={e => setPaymentDate(e.target.value)}
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/50 tabular-nums"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-secondary">Mode</label>
                <select
                  value={paymentMethod}
                  onChange={e => setPaymentMethod(e.target.value)}
                  className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/50 appearance-none"
                >
                  <option value="virement">Virement</option>
                  <option value="cheque">Chèque</option>
                  <option value="cb">CB</option>
                  <option value="especes">Espèces</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-semibold text-secondary">Référence (optionnel)</label>
              <input
                type="text"
                value={paymentRef}
                onChange={e => setPaymentRef(e.target.value)}
                placeholder="N° virement, chèque..."
                className="w-full p-3 rounded-xl bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-blue-500/50"
              />
            </div>

            {paymentError && <p className="text-xs text-red-500">{paymentError}</p>}

            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setPaymentModal(null)}
                className="flex-1 py-3 rounded-full border border-[var(--elevation-border)] text-secondary font-semibold hover:text-primary transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleRecordScheduledPayment}
                disabled={paymentLoading || !paymentScheduleItemId}
                className="flex-1 py-3 rounded-full bg-blue-500 text-white font-bold flex items-center justify-center gap-2 hover:bg-blue-600 transition-colors disabled:opacity-50"
              >
                {paymentLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Encaisser
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modale acompte ── */}
      {depositModal && (
        <div className="modal-overlay">
          <div className="modal-panel space-y-6 sm:max-w-sm">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-accent/10 flex items-center justify-center">
                <Landmark className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-primary">Facture d&apos;acompte</h2>
                <p className="text-xs text-secondary truncate max-w-[200px]">{depositModal.quoteTitle ?? 'Devis'}</p>
              </div>
            </div>
            <div className="space-y-3">
              <label className="text-sm font-semibold text-secondary">Taux d&apos;acompte</label>
              <div className="flex items-center gap-3">
                {[20, 30, 40, 50].map(pct => (
                  <button
                    key={pct}
                    onClick={() => setDepositRate(pct)}
                    className={`flex-1 py-2 rounded-xl text-sm font-bold transition-all border ${depositRate === pct ? 'bg-accent text-black border-accent' : 'bg-base border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
                  >
                    {pct}%
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1} max={100}
                  value={depositRate}
                  onChange={e => setDepositRate(Math.min(100, Math.max(1, Number(e.target.value))))}
                  className="w-24 p-2 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm text-center focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
                <span className="text-sm text-secondary">% du total TTC</span>
              </div>
              {depositModal.quoteTtc != null && (
                <div className="p-3 rounded-xl bg-accent/5 border border-accent/20">
                  <p className="text-xs text-secondary">Montant de l&apos;acompte</p>
                  <p className="text-xl font-bold text-primary tabular-nums">{formatCurrency(depositPreview)}</p>
                </div>
              )}
            </div>
            <div className="space-y-4 pt-1 border-t border-[var(--elevation-border)]">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-secondary">Échéance de cet acompte</label>
                <input
                  type="date"
                  value={depositDueDate}
                  onChange={e => setDepositDueDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-secondary">Échéance du solde restant</label>
                <p className="text-xs text-secondary/70">Date à laquelle le reste du montant devra être réglé.</p>
                <input
                  type="date"
                  value={depositBalanceDueDate}
                  onChange={e => setDepositBalanceDueDate(e.target.value)}
                  className="w-full p-2.5 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm focus:outline-none focus:ring-2 focus:ring-accent/50"
                />
              </div>
            </div>
            {depositError && <p className="text-xs text-red-500">{depositError}</p>}
            <div className="flex gap-3">
              <button
                onClick={() => { setDepositModal(null); setDepositError(null) }}
                className="flex-1 py-2.5 rounded-xl border border-[var(--elevation-border)] text-secondary text-sm font-semibold hover:text-primary transition-colors"
              >
                Annuler
              </button>
              <button
                onClick={handleGenerateDeposit}
                disabled={depositLoading}
                className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100"
              >
                {depositLoading ? 'Création…' : 'Générer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal situations de travaux ── */}
      {situationsPanel && (
        <div className="modal-overlay">
          <div className="modal-panel space-y-5 sm:max-w-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-accent/10 flex items-center justify-center flex-shrink-0">
                  <TrendingUp className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-primary">Situations de travaux</h2>
                  <p className="text-xs text-secondary truncate max-w-[240px]">{situationsPanel.quoteTitle ?? 'Devis'}</p>
                </div>
              </div>
              <button
                onClick={() => { setSituationsPanel(null); setSituationsSummary(null) }}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors flex-shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {situationsSummaryLoading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-accent" />
              </div>
            )}

            {!situationsSummaryLoading && !situationsSummary && (
              <p className="text-sm text-secondary text-center py-6">
                Impossible de charger les situations pour ce devis.
              </p>
            )}

            {!situationsSummaryLoading && situationsSummary && situationsPanel.chantierId && (
              <SituationsSection
                chantierId={situationsPanel.chantierId}
                summary={situationsSummary}
                canCreateSituation={canCreateSituation}
                canCreateSolde={canCreateSolde}
                returnTo="/finances?tab=quotes"
              />
            )}

            {!situationsSummaryLoading && situationsSummary && !situationsPanel.chantierId && (
              <div className="space-y-4">
                <SituationsSection
                  chantierId=""
                  summary={situationsSummary}
                  canCreateSituation={false}
                  canCreateSolde={false}
                  returnTo="/finances?tab=quotes"
                />
                <p className="text-xs text-secondary border-t border-[var(--elevation-border)] pt-3">
                  Pour créer une situation, ce devis doit être lié à un chantier.{' '}
                  <button
                    onClick={() => { setSituationsPanel(null); handleCreateChantierFromQuote(situationsPanel.quoteId) }}
                    className="text-accent underline"
                  >
                    Créer le chantier
                  </button>
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 text-center md:text-left">
        <div className="flex flex-col gap-2 items-center md:items-start">
          <h1 className="text-4xl font-bold text-primary">Devis & Factures</h1>
          <p className="text-secondary text-lg">Gérez vos documents financiers et suivez vos encaissements.</p>
        </div>
        <div className="flex items-center justify-center md:justify-end gap-3 flex-wrap">
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            title="Actualiser"
            className="px-5 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-secondary font-semibold flex items-center justify-center gap-2 hover:text-primary hover:bg-base transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Actualiser
          </button>
          <button
            onClick={() => { setImportDefaultType(activeTab === 'invoices' ? 'invoices' : 'quotes'); setImportOpen(true) }}
            className="px-5 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-secondary font-semibold flex items-center justify-center gap-2 hover:text-primary hover:bg-base transition-all"
          >
            <Upload className="w-4 h-4" />Importer
          </button>
          <Link href="/finances/recurring" className="px-5 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-secondary font-semibold flex items-center justify-center gap-2 hover:text-primary hover:bg-base transition-all whitespace-nowrap">
            <Repeat className="w-4 h-4" />Récurrentes
          </Link>
          {canCreateInvoice && (
            <Link href={invoiceEditorHref()} className="px-5 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all whitespace-nowrap">
              <Plus className="w-4 h-4" />Nouvelle Facture
            </Link>
          )}
          {canCreateQuote && (
            <Link href={quoteEditorHref()} className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20 whitespace-nowrap">
              <Bot className="w-4 h-4" />Nouveau Devis
            </Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-base/50 rounded-full w-fit border border-[var(--elevation-border)] mx-auto md:mx-0">
        <button onClick={() => handleTabChange('quotes')} className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'quotes' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>Devis</button>
        <button onClick={() => handleTabChange('invoices')} className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'invoices' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>Factures</button>
      </div>

      {/* Stats */}
      <div className="space-y-3">
        {/* Sélecteur de mois */}
        {(activeTab === 'invoices' || activeTab === 'quotes') && (
          <div className="flex items-center justify-between gap-3">
            {/* Nav mois */}
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Période :</span>
              <button
                onClick={() => activeTab === 'quotes' ? setQuoteStatsMonth(m => offsetYM(m, -1)) : setStatsMonth(m => offsetYM(m, -1))}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-base transition-colors text-secondary hover:text-primary"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm font-bold text-primary min-w-[80px] text-center">
                {fmtYM(activeTab === 'quotes' ? quoteStatsMonth : statsMonth)}
              </span>
              <button
                onClick={() => activeTab === 'quotes' ? setQuoteStatsMonth(m => offsetYM(m, 1)) : setStatsMonth(m => offsetYM(m, 1))}
                disabled={activeTab === 'quotes' ? isCurrentQuoteMonth : isCurrentMonth}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-base transition-colors text-secondary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {(activeTab === 'quotes' ? !isCurrentQuoteMonth : !isCurrentMonth) && (
                <button
                  onClick={() => activeTab === 'quotes' ? setQuoteStatsMonth(getCurrentYM()) : setStatsMonth(getCurrentYM())}
                  className="text-xs font-semibold text-accent hover:underline"
                >
                  Aujourd&apos;hui
                </button>
              )}
            </div>
            {/* Bouton rapport - uniquement onglet factures */}
            {activeTab === 'invoices' && (
              <button
                onClick={handleDownloadMonthlyReport}
                disabled={reportLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border border-[var(--elevation-border)] text-secondary dark:text-secondary bg-transparent hover:text-accent hover:border-accent dark:hover:text-accent dark:hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {reportLoading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <FileDown className="w-3.5 h-3.5" />
                }
                {reportLoading ? 'Génération…' : `Rapport ${fmtYM(statsMonth)}`}
              </button>
            )}
          </div>
        )}
        <div className={`grid grid-cols-2 gap-4 ${activeTab === 'quotes' ? 'md:grid-cols-4' : 'md:grid-cols-3'}`}>
          {activeTab === 'quotes' ? (
            <>
              <div className="rounded-3xl card p-6 flex items-center gap-4">
                <FileText className="w-6 h-6 text-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Devis émis</p>
                  <p className="text-2xl font-bold tabular-nums text-primary">{qEmisCount}</p>
                  <DeltaBadge current={qEmisCount} prev={qEmisCountPrev} />
                </div>
              </div>
              <div className="rounded-3xl card p-6 flex items-center gap-4">
                <Wallet className="w-6 h-6 text-accent-green flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Montant proposé HT</p>
                  <p className="text-2xl font-bold tabular-nums text-primary">{formatCurrency(qEmisHt)}</p>
                  <DeltaBadge current={qEmisHt} prev={qEmisHtPrev} />
                </div>
              </div>
              <div className="rounded-3xl card p-6 flex items-center gap-4">
                <CheckCircle2 className="w-6 h-6 text-accent-green flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Accepté HT</p>
                  <p className="text-2xl font-bold tabular-nums text-primary">{formatCurrency(qAcceptedHt)}</p>
                  <DeltaBadge current={qAcceptedHt} prev={qAcceptedHtPrev} />
                </div>
              </div>
              <div className="rounded-3xl card p-6 flex items-center gap-4">
                <Percent className="w-6 h-6 text-blue-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Taux de conversion</p>
                  <p className="text-2xl font-bold tabular-nums text-primary">{qConvRate}%</p>
                  <DeltaBadge current={qConvRate} prev={qConvRatePrev} />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-3xl card p-6 flex items-center gap-4">
                <Wallet className="w-6 h-6 text-accent-green flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Montant facturé HT</p>
                  <p className="text-2xl font-bold tabular-nums text-primary">{formatCurrency(caMois)}</p>
                  {caMoisPrev > 0 || caMois > 0 ? (
                    <DeltaBadge current={caMois} prev={caMoisPrev} />
                  ) : null}
                </div>
              </div>
              <div className="rounded-3xl card p-6 flex items-center gap-4">
                <Receipt className="w-6 h-6 text-accent flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-secondary uppercase tracking-wider">Encaissé TTC</p>
                  <p className="text-2xl font-bold tabular-nums text-primary">{formatCurrency(totalEncaisse)}</p>
                  {totalEncaissePrev > 0 || totalEncaisse > 0 ? (
                    <DeltaBadge current={totalEncaisse} prev={totalEncaissePrev} />
                  ) : null}
                </div>
              </div>
              <div className="rounded-3xl card p-6 flex items-center gap-4">
                <AlertTriangle className={`w-6 h-6 flex-shrink-0 ${enRetardCount > 0 ? 'text-red-500' : 'text-secondary'}`} />
                <div>
                  <p className="text-sm font-semibold text-secondary uppercase tracking-wider">En retard</p>
                  <p className={`text-2xl font-bold tabular-nums ${enRetardCount > 0 ? 'text-red-500' : 'text-primary'}`}>{enRetardCount}</p>
                  {resteARecouvrer > 0 && <p className="text-xs text-secondary mt-0.5">{formatCurrency(resteARecouvrer)} TTC à recouvrer</p>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Table */}
      <div className="rounded-3xl card overflow-visible">
        <div className="p-6 border-b border-[var(--elevation-border)] flex flex-col sm:flex-row items-center gap-4">
          <div className="relative w-full max-w-md">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-secondary" />
            <input
              type="text"
              placeholder={`Rechercher ${activeTab === 'quotes' ? 'un devis' : 'une facture'}...`}
              value={searchTerm}
              onChange={e => { setSearchTerm(e.target.value); setPage(1) }}
              className="w-full pl-12 pr-4 py-3 rounded-full bg-base/50 border border-[var(--elevation-border)] focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-primary"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="w-full sm:w-auto px-4 py-3 rounded-full bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all appearance-none"
          >
            <option value="all">Tous les statuts</option>
            {Object.entries(activeStatusMap).map(([val, { label }]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        <div className="overflow-visible sm:overflow-x-auto">
          <table className="w-full text-left border-collapse table-fixed sm:table-auto">
            <thead className="hidden sm:table-header-group">
              <tr className="bg-base/30">
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">N°</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Titre / Client</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Date</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">Montant HT</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Statut</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--elevation-border)]">
              {activeTab === 'quotes' ? (
                filtered.length > 0 ? paginatedQuotes.map(q => {
                  const st = STATUS[q.status] ?? STATUS['draft']
                  const date = new Date(q.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
                  const clientName = q.client?.company_name ?? q.client?.email ?? '/'
                  return (
                    <tr
                      key={q.id}
                      className="hover:bg-accent/5 transition-colors cursor-pointer"
                      onClick={() => router.push(quoteEditorHref(q.id))}
                    >
                      <td className="hidden sm:table-cell px-6 py-4"><p className="text-sm font-mono text-secondary">{q.number ?? '/'}</p></td>
                      <td className="px-4 sm:px-6 py-3 sm:py-4 min-w-0">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="font-bold text-primary truncate min-w-0" title={q.title ?? 'Sans titre'}>{q.title ?? 'Sans titre'}</p>
                            <span className={`sm:hidden px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0 ${st.cls}`}>
                              {st.label}
                            </span>
                          </div>
                          <p className="text-xs text-secondary truncate mt-0.5" title={clientName}>{clientName}</p>
                          <p className="sm:hidden text-[11px] text-secondary/70 truncate mt-0.5">
                            {q.number ?? 'Sans n°'} · {date}
                          </p>
                        </div>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-4"><p className="text-sm text-secondary">{date}</p></td>
                      <td className="pl-2 pr-3 sm:px-6 py-3 sm:py-4 text-right w-[92px] sm:w-auto">
                        <p className="text-sm font-semibold sm:font-medium text-primary tabular-nums whitespace-nowrap">
                          {q.total_ht != null ? formatCurrency(q.total_ht) : '/'}
                        </p>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="pl-3 pr-4 sm:px-6 py-3 sm:py-4 text-right w-14 sm:w-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => router.push(`/api/pdf/quote/${q.id}`)}
                            title="Aperçu PDF"
                            className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <a
                            href={`/api/pdf/quote/${q.id}?download=1`}
                            download
                            title="Télécharger PDF"
                            className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <FileDown className="w-4 h-4" />
                          </a>
                          <ActionMenu actions={[
                            ...(canSendQuote && (q.status === 'sent' || q.status === 'viewed') ? [{ label: 'Marquer accepté', icon: <Check className="w-4 h-4" />, onClick: () => handleMarkQuoteAccepted(q.id) }] : []),
                            ...(canCreateInvoice && (q.status === 'accepted' || q.status === 'converted' || q.status === 'fully_invoiced') ? [
                              { label: 'Générer acompte', icon: <Landmark className="w-4 h-4" />, onClick: () => { setDepositRate(30); setDepositDueDate(''); setDepositBalanceDueDate(''); setDepositError(null); setDepositModal({ quoteId: q.id, quoteTitle: q.title, quoteTtc: q.total_ttc }) } },
                              { label: 'Créer chantier', icon: <HardHat className="w-4 h-4" />, onClick: () => handleCreateChantierFromQuote(q.id) },
                            ] : []),
                            ...((canCreateSituation || canCreateSolde) && (q.status === 'accepted' || q.status === 'converted' || q.status === 'fully_invoiced') ? [
                              { label: 'Situations de travaux', icon: <TrendingUp className="w-4 h-4" />, onClick: () => handleOpenSituations(q.id, q.title) },
                            ] : []),
                            ...(canEditQuote ? [{ label: 'Modifier', icon: <Edit2 className="w-4 h-4" />, onClick: () => router.push(quoteEditorHref(q.id)) }] : []),
                            ...(canCreateQuote ? [{ label: 'Dupliquer', icon: <Copy className="w-4 h-4" />, onClick: () => handleDuplicateQuote(q.id) }] : []),
                            ...(canDeleteQuote ? [{ label: 'Archiver', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleArchiveQuote(q.id) }] : []),
                          ]} />
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                      <EmptyState type="quotes" canCreate={canCreateQuote} returnTo={returnTo} />
                    </td>
                  </tr>
                )
              ) : (
                filteredInvoices.length > 0 ? paginatedInvoices.map(inv => {
                  const st = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS['draft']
                  const date = new Date(invDate(inv)).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
                  const clientName = inv.client?.company_name ?? inv.client?.email ?? '/'
                  const isOverdue = (inv.status === 'sent' || inv.status === 'partial') && inv.due_date != null && inv.due_date < today
                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-accent/5 transition-colors cursor-pointer"
                      onClick={() => router.push(invoiceEditorHref(inv.id))}
                    >
                      <td className="hidden sm:table-cell px-6 py-4"><p className="text-sm font-mono text-secondary">{inv.number ?? '/'}</p></td>
                      <td className="px-4 sm:px-6 py-3 sm:py-4 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="font-bold text-primary truncate min-w-0" title={inv.title ?? 'Sans titre'}>{inv.title ?? 'Sans titre'}</p>
                          {inv.invoice_type === 'acompte' && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 uppercase tracking-wide flex-shrink-0">Acompte</span>
                          )}
                          {inv.invoice_type === 'solde' && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-accent/10 text-accent uppercase tracking-wide flex-shrink-0">Solde</span>
                          )}
                          <span className={`sm:hidden px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider whitespace-nowrap shrink-0 ${st.cls}`}>
                            {st.label}
                          </span>
                        </div>
                        <p className="text-xs text-secondary truncate mt-0.5" title={clientName}>{clientName}</p>
                        <p className="sm:hidden text-[11px] text-secondary/70 truncate mt-0.5">
                          {inv.number ?? 'Sans n°'} · {date}
                        </p>
                        {isOverdue && inv.due_date && (
                          <p className="text-xs text-red-500 font-semibold mt-0.5">
                            Échue le {new Date(inv.due_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </p>
                        )}
                      </td>
                      <td className="hidden sm:table-cell px-6 py-4"><p className="text-sm text-secondary">{date}</p></td>
                      <td className="pl-2 pr-3 sm:px-6 py-3 sm:py-4 text-right w-[92px] sm:w-auto">
                        <p className="text-sm font-semibold sm:font-medium text-primary tabular-nums whitespace-nowrap">
                          {inv.total_ht != null ? formatCurrency(inv.total_ht) : '/'}
                        </p>
                      </td>
                      <td className="hidden sm:table-cell px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="pl-3 pr-4 sm:px-6 py-3 sm:py-4 text-right w-14 sm:w-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => router.push(`/api/pdf/invoice/${inv.id}`)}
                            title="Aperçu PDF"
                            className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <a
                            href={`/api/pdf/invoice/${inv.id}?download=1`}
                            download
                            title="Télécharger PDF"
                            className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <FileDown className="w-4 h-4" />
                          </a>
                          {canRecordPayment && inv.status === 'sent' && (
                            <button
                              onClick={() => handleMarkPaid(inv.id)}
                              disabled={!!markPaidLoadingId}
                              title="Marquer payée"
                              className="hidden sm:flex w-8 h-8 rounded-lg items-center justify-center text-accent-green hover:bg-accent-green/10 transition-colors disabled:opacity-50"
                            >
                              {markPaidLoadingId === inv.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                            </button>
                          )}
                          <ActionMenu actions={[
                            ...(canSendInvoice ? [{ label: 'Modifier', icon: <Edit2 className="w-4 h-4" />, onClick: () => router.push(invoiceEditorHref(inv.id)) }] : []),
                            ...(canCreateInvoice ? [{ label: 'Convertir en récurrente', icon: <Repeat className="w-4 h-4" />, onClick: () => router.push(`/finances/recurring?from_invoice=${inv.id}`) }] : []),
                            ...(canRecordPayment && (inv.status === 'sent' || inv.status === 'partial') ? [{
                              label: 'Encaisser un versement',
                              icon: loadingScheduleId === inv.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CalendarClock className="w-4 h-4" />,
                              onClick: async () => {
                                setLoadingScheduleId(inv.id)
                                try {
                                  const res = await fetch(`/api/invoices/${inv.id}/schedule`)
                                  const data = await res.json()
                                  const unpaid = (data.schedule ?? []).filter((s: any) => !s.paid_payment_id)
                                  const scheduleToShow = unpaid.length > 0 ? unpaid : [{
                                    id: '__full__',
                                    label: 'Paiement intégral',
                                    due_date: todayParis(),
                                    amount: inv.total_ttc ?? 0,
                                    amount_type: 'amount',
                                    percentage: null,
                                  }]
                                  setPaymentScheduleItemId(scheduleToShow[0].id)
                                  setPaymentDate(todayParis())
                                  setPaymentMethod('virement')
                                  setPaymentRef('')
                                  setPaymentError(null)
                                  setPaymentModal({ invoiceId: inv.id, invoiceNumber: inv.number, schedule: scheduleToShow })
                                } finally {
                                  setLoadingScheduleId(null)
                                }
                              },
                            }] : []),
                            ...(canDeleteInvoice ? [{ label: 'Archiver', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleArchiveInvoice(inv.id) }] : []),
                          ]} />
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                      <EmptyState type="invoices" canCreate={canCreateInvoice} returnTo={returnTo} />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--elevation-border)]">
            <span className="text-xs text-secondary">
              {pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, activeFilteredCount)} sur {activeFilteredCount}
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Page précédente"
              >
                <ChevronLeft className="w-4 h-4 text-secondary" />
              </button>
              <span className="px-2 text-xs font-semibold text-secondary">Page {currentPage} / {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title="Page suivante"
              >
                <ChevronRight className="w-4 h-4 text-secondary" />
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
