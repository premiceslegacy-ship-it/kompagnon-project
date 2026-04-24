'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Quote } from '@/lib/data/queries/quotes'
import type { Invoice } from '@/lib/data/queries/invoices'
import { formatCurrency, ActionMenu } from '@/components/shared'
import { archiveQuote, markQuoteAccepted, duplicateQuote } from '@/lib/data/mutations/quotes'
import { archiveInvoice, markInvoicePaid, generateDepositInvoice } from '@/lib/data/mutations/invoices'
import { createChantierFromQuote } from '@/lib/data/mutations/chantiers'
import ImportDocumentsModal from './ImportDocumentsModal'
import {
  Search, Plus, FileText, Bot,
  CheckCircle2, Clock, Percent, Wallet, Receipt, AlertTriangle,
  Edit2, Trash2, FileDown, Eye, Repeat, Check, Copy, Landmark, HardHat,
  ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Upload,
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
  draft:     { label: 'Brouillon', cls: 'bg-secondary/10 text-secondary' },
  sent:      { label: 'Envoyée',   cls: 'bg-accent/10 text-accent' },
  paid:      { label: 'Payée',     cls: 'bg-accent-green/10 text-accent-green' },
  cancelled: { label: 'Annulée',   cls: 'bg-red-500/10 text-red-500' },
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

function EmptyState({ type }: { type: 'quotes' | 'invoices' }) {
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
      {type === 'quotes' && (
        <Link href="/finances/quote-editor" className="mt-2 px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20">
          <Bot className="w-4 h-4" />Nouveau Devis
        </Link>
      )}
      {type === 'invoices' && (
        <Link href="/finances/invoice-editor" className="mt-2 px-6 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center gap-2 hover:bg-base transition-all">
          <Plus className="w-4 h-4" />Nouvelle Facture
        </Link>
      )}
    </div>
  )
}

export default function FinancesClient({ initialQuotes, initialInvoices }: { initialQuotes: Quote[]; initialInvoices: Invoice[] }) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<'quotes' | 'invoices'>('quotes')
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [quotes, setQuotes] = useState(initialQuotes)
  const [invoices, setInvoices] = useState(initialInvoices)
  const [depositModal, setDepositModal] = useState<{ quoteId: string; quoteTitle: string | null; quoteTtc: number | null } | null>(null)
  const [statsMonth, setStatsMonth] = useState(getCurrentYM)
  const [depositRate, setDepositRate] = useState(30)
  const [depositDueDate, setDepositDueDate] = useState('')
  const [depositBalanceDueDate, setDepositBalanceDueDate] = useState('')
  const [depositLoading, setDepositLoading] = useState(false)
  const [depositError, setDepositError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importDefaultType, setImportDefaultType] = useState<'invoices' | 'quotes'>('invoices')

  // ── Quote filters & stats ────────────────────────────────────────────────────

  const filtered = quotes.filter(q => {
    const clientName = q.client?.company_name ?? q.client?.email ?? ''
    const matchSearch = !searchTerm ||
      clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.number ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.title ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = statusFilter === 'all' || q.status === statusFilter
    return matchSearch && matchStatus
  })

  const sentCount = quotes.filter(q => q.status === 'sent' || q.status === 'viewed').length
  const acceptedCount = quotes.filter(q => q.status === 'accepted').length
  const conversionRate = quotes.length > 0 ? Math.round((acceptedCount / quotes.length) * 100) : 0
  // Total accepté en HT (référence professionnelle BTP)
  const acceptedTotal = quotes.filter(q => q.status === 'accepted').reduce((sum, q) => sum + (q.total_ht ?? 0), 0)

  // ── Invoice filters & stats ──────────────────────────────────────────────────

  const today = new Date().toISOString().split('T')[0]
  const prevStatsMonth = offsetYM(statsMonth, -1)
  const isCurrentMonth = statsMonth === getCurrentYM()

  const filteredInvoices = invoices.filter(inv => {
    const clientName = inv.client?.company_name ?? inv.client?.email ?? ''
    const matchSearch = !searchTerm ||
      clientName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.number ?? '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (inv.title ?? '').toLowerCase().includes(searchTerm.toLowerCase())
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter
    return matchSearch && matchStatus
  })

  // Stats globales (toutes périodes) — pour les lignes de la table
  // Stats par mois sélectionné — pour les KPI cards
  const invDate = (inv: Invoice) => inv.issue_date ?? inv.sent_at ?? inv.created_at
  const invOfMonth = invoices.filter(inv => invDate(inv).startsWith(statsMonth))
  const invOfPrevMonth = invoices.filter(inv => invDate(inv).startsWith(prevStatsMonth))

  const totalEncaisse = invOfMonth.filter(inv => inv.status === 'paid').reduce((s, inv) => s + (inv.total_ttc ?? 0), 0)
  const totalEncaissePrev = invOfPrevMonth.filter(inv => inv.status === 'paid').reduce((s, inv) => s + (inv.total_ttc ?? 0), 0)

  const resteARecouvrer = invOfMonth.filter(inv => inv.status === 'sent').reduce((s, inv) => s + (inv.total_ht ?? 0), 0)

  const enRetardCount = invoices.filter(
    inv => inv.status === 'sent' && inv.due_date != null && inv.due_date < today
  ).length

  // CA du mois = factures émises (sent + paid) HT
  const caMois = invOfMonth.filter(inv => ['sent', 'paid'].includes(inv.status)).reduce((s, inv) => s + (inv.total_ht ?? 0), 0)
  const caMoisPrev = invOfPrevMonth.filter(inv => ['sent', 'paid'].includes(inv.status)).reduce((s, inv) => s + (inv.total_ht ?? 0), 0)

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
    await markInvoicePaid(id)
    setInvoices(prev => prev.map(inv => inv.id === id ? { ...inv, status: 'paid' as const } : inv))
  }

  const handleMarkQuoteAccepted = async (id: string) => {
    await markQuoteAccepted(id)
    setQuotes(prev => prev.map(q => q.id === id ? { ...q, status: 'accepted' as const } : q))
  }

  const handleDuplicateQuote = async (id: string) => {
    const { quoteId, error } = await duplicateQuote(id)
    if (!error && quoteId) router.push(`/finances/quote-editor?id=${quoteId}`)
  }

  const handleCreateChantierFromQuote = async (quoteId: string) => {
    const { chantierId, error } = await createChantierFromQuote(quoteId)
    if (!error && chantierId) router.push(`/chantiers/${chantierId}`)
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
    if (invoiceId) router.push(`/finances/invoice-editor?id=${invoiceId}`)
  }

  // Reset status filter when switching tabs
  const handleTabChange = (tab: 'quotes' | 'invoices') => {
    setActiveTab(tab)
    setStatusFilter('all')
    setSearchTerm('')
  }

  const activeStatusMap = activeTab === 'quotes' ? STATUS : INVOICE_STATUS

  const depositPreview = depositModal
    ? Math.round((depositModal.quoteTtc ?? 0) * depositRate / 100 * 100) / 100
    : 0

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">

      <ImportDocumentsModal
        isOpen={importOpen}
        onClose={() => setImportOpen(false)}
        defaultType={importDefaultType}
      />

      {/* ── Modale acompte ── */}
      {depositModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="rounded-3xl bg-surface dark:bg-[#111] border border-[var(--elevation-border)] w-full max-w-sm p-8 shadow-2xl space-y-6">
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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold text-primary">Devis & Factures</h1>
          <p className="text-secondary text-lg">Gérez vos documents financiers et suivez vos encaissements.</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setImportDefaultType(activeTab === 'invoices' ? 'invoices' : 'quotes'); setImportOpen(true) }}
            className="px-5 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-secondary font-semibold flex items-center justify-center gap-2 hover:text-primary hover:bg-base transition-all"
          >
            <Upload className="w-4 h-4" />Importer
          </button>
          <Link href="/finances/recurring" className="px-5 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-secondary font-semibold flex items-center justify-center gap-2 hover:text-primary hover:bg-base transition-all">
            <Repeat className="w-4 h-4" />Récurrentes
          </Link>
          <Link href="/finances/invoice-editor" className="px-5 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all">
            <Plus className="w-4 h-4" />Nouvelle Facture
          </Link>
          <Link href="/finances/quote-editor" className="px-6 py-3 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all shadow-lg shadow-accent/20">
            <Bot className="w-4 h-4" />Nouveau Devis
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 p-1 bg-base/50 rounded-full w-fit border border-[var(--elevation-border)]">
        <button onClick={() => handleTabChange('quotes')} className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'quotes' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>Devis</button>
        <button onClick={() => handleTabChange('invoices')} className={`px-8 py-2 rounded-full text-sm font-bold transition-all ${activeTab === 'invoices' ? 'bg-surface dark:bg-white/10 text-primary shadow-sm' : 'text-secondary hover:text-primary'}`}>Factures</button>
      </div>

      {/* Stats */}
      <div className="space-y-3">
        {/* Sélecteur de mois (visible sur l'onglet Factures) */}
        {activeTab === 'invoices' && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-secondary uppercase tracking-wider">Période :</span>
            <button
              onClick={() => setStatsMonth(m => offsetYM(m, -1))}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-base transition-colors text-secondary hover:text-primary"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-sm font-bold text-primary min-w-[80px] text-center">{fmtYM(statsMonth)}</span>
            <button
              onClick={() => setStatsMonth(m => offsetYM(m, 1))}
              disabled={isCurrentMonth}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-base transition-colors text-secondary hover:text-primary disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {!isCurrentMonth && (
              <button onClick={() => setStatsMonth(getCurrentYM())} className="text-xs font-semibold text-accent hover:underline ml-1">
                Aujourd&apos;hui
              </button>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {activeTab === 'quotes' ? (
            <>
              <StatCard icon={<CheckCircle2 className="w-6 h-6 text-accent-green" />} label="Total Accepté HT" value={formatCurrency(acceptedTotal)} />
              <StatCard icon={<Clock className="w-6 h-6 text-accent" />} label="En attente de réponse" value={String(sentCount)} />
              <StatCard icon={<Percent className="w-6 h-6 text-blue-500" />} label="Taux de conversion" value={`${conversionRate}%`} />
            </>
          ) : (
            <>
              <div className="rounded-3xl card p-6 flex items-center gap-4">
                <Wallet className="w-6 h-6 text-accent-green flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-secondary uppercase tracking-wider">CA émis HT</p>
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
                  {resteARecouvrer > 0 && <p className="text-xs text-secondary mt-0.5">{formatCurrency(resteARecouvrer)} HT à recouvrer</p>}
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
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full pl-12 pr-4 py-3 rounded-full bg-base/50 border border-[var(--elevation-border)] focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all text-primary"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full sm:w-auto px-4 py-3 rounded-full bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/50 transition-all appearance-none"
          >
            <option value="all">Tous les statuts</option>
            {Object.entries(activeStatusMap).map(([val, { label }]) => (
              <option key={val} value={val}>{label}</option>
            ))}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-base/30">
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">N°</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Titre / Client</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Date</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Montant HT</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider">Statut</th>
                <th className="px-6 py-4 text-sm font-bold text-secondary uppercase tracking-wider text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--elevation-border)]">
              {activeTab === 'quotes' ? (
                filtered.length > 0 ? filtered.map(q => {
                  const st = STATUS[q.status] ?? STATUS['draft']
                  const date = new Date(q.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
                  const clientName = q.client?.company_name ?? q.client?.email ?? '/'
                  return (
                    <tr
                      key={q.id}
                      className="hover:bg-accent/5 transition-colors cursor-pointer"
                      onClick={() => router.push(`/finances/quote-editor?id=${q.id}`)}
                    >
                      <td className="px-6 py-4"><p className="text-sm font-mono text-secondary">{q.number ?? '/'}</p></td>
                      <td className="px-6 py-4">
                        <p className="font-bold text-primary">{q.title ?? 'Sans titre'}</p>
                        <p className="text-xs text-secondary">{clientName}</p>
                      </td>
                      <td className="px-6 py-4"><p className="text-sm text-secondary">{date}</p></td>
                      <td className="px-6 py-4 text-right">
                        <p className="text-sm font-medium text-primary tabular-nums">
                          {q.total_ht != null ? formatCurrency(q.total_ht) : '/'}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => router.push(`/api/pdf/quote/${q.id}`)}
                            title="Aperçu PDF"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <a
                            href={`/api/pdf/quote/${q.id}?download=1`}
                            download
                            title="Télécharger PDF"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <FileDown className="w-4 h-4" />
                          </a>
                          <ActionMenu actions={[
                            ...(q.status === 'sent' || q.status === 'viewed' ? [{ label: 'Marquer accepté', icon: <Check className="w-4 h-4" />, onClick: () => handleMarkQuoteAccepted(q.id) }] : []),
                            ...(q.status === 'accepted' ? [
                              { label: 'Générer acompte', icon: <Landmark className="w-4 h-4" />, onClick: () => { setDepositRate(30); setDepositDueDate(''); setDepositBalanceDueDate(''); setDepositError(null); setDepositModal({ quoteId: q.id, quoteTitle: q.title, quoteTtc: q.total_ttc }) } },
                              { label: 'Créer chantier', icon: <HardHat className="w-4 h-4" />, onClick: () => handleCreateChantierFromQuote(q.id) },
                            ] : []),
                            { label: 'Modifier', icon: <Edit2 className="w-4 h-4" />, onClick: () => router.push(`/finances/quote-editor?id=${q.id}`) },
                            { label: 'Dupliquer', icon: <Copy className="w-4 h-4" />, onClick: () => handleDuplicateQuote(q.id) },
                            { label: 'Archiver', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleArchiveQuote(q.id) },
                          ]} />
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                      <EmptyState type="quotes" />
                    </td>
                  </tr>
                )
              ) : (
                filteredInvoices.length > 0 ? filteredInvoices.map(inv => {
                  const st = INVOICE_STATUS[inv.status] ?? INVOICE_STATUS['draft']
                  const date = new Date(inv.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })
                  const clientName = inv.client?.company_name ?? inv.client?.email ?? '/'
                  const isOverdue = inv.status === 'sent' && inv.due_date != null && inv.due_date < today
                  return (
                    <tr
                      key={inv.id}
                      className="hover:bg-accent/5 transition-colors cursor-pointer"
                      onClick={() => router.push(`/finances/invoice-editor?id=${inv.id}`)}
                    >
                      <td className="px-6 py-4"><p className="text-sm font-mono text-secondary">{inv.number ?? '/'}</p></td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <p className="font-bold text-primary">{inv.title ?? 'Sans titre'}</p>
                          {inv.invoice_type === 'acompte' && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-violet-500/10 text-violet-600 dark:text-violet-400 uppercase tracking-wide flex-shrink-0">Acompte</span>
                          )}
                          {inv.invoice_type === 'solde' && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-accent/10 text-accent uppercase tracking-wide flex-shrink-0">Solde</span>
                          )}
                        </div>
                        <p className="text-xs text-secondary">{clientName}</p>
                        {isOverdue && inv.due_date && (
                          <p className="text-xs text-red-500 font-semibold mt-0.5">
                            Échue le {new Date(inv.due_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4"><p className="text-sm text-secondary">{date}</p></td>
                      <td className="px-6 py-4 text-right">
                        <p className="text-sm font-medium text-primary tabular-nums">
                          {inv.total_ht != null ? formatCurrency(inv.total_ht) : '/'}
                        </p>
                      </td>
                      <td className="px-6 py-4">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${st.cls}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-1">
                          <button
                            onClick={() => router.push(`/api/pdf/invoice/${inv.id}`)}
                            title="Aperçu PDF"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <a
                            href={`/api/pdf/invoice/${inv.id}?download=1`}
                            download
                            title="Télécharger PDF"
                            className="w-8 h-8 rounded-lg flex items-center justify-center text-secondary hover:text-primary hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                          >
                            <FileDown className="w-4 h-4" />
                          </a>
                          <ActionMenu actions={[
                            { label: 'Modifier', icon: <Edit2 className="w-4 h-4" />, onClick: () => router.push(`/finances/invoice-editor?id=${inv.id}`) },
                            { label: 'Convertir en récurrente', icon: <Repeat className="w-4 h-4" />, onClick: () => router.push(`/finances/recurring?from_invoice=${inv.id}`) },
                            ...(inv.status === 'sent' ? [{ label: 'Marquer payée', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => handleMarkPaid(inv.id) }] : []),
                            { label: 'Archiver', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleArchiveInvoice(inv.id) },
                          ]} />
                        </div>
                      </td>
                    </tr>
                  )
                }) : (
                  <tr>
                    <td colSpan={6} className="px-6 py-20 text-center">
                      <EmptyState type="invoices" />
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  )
}
