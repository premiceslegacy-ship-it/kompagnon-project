'use client'

import React, { useState, useTransition } from 'react'
import Link from 'next/link'
import { formatCurrency } from '@/components/shared'
import {
  Mail, Check, X, Loader2, Flame, Hourglass, CheckCircle2, Settings, AlertTriangle,
} from 'lucide-react'
import type { RemindersData, OverdueInvoice, PendingQuote } from '@/lib/data/queries/reminders'
import { sendInvoiceReminder, sendQuoteFollowup, markQuoteRefused } from '@/lib/data/mutations/reminders'
import { markInvoicePaid } from '@/lib/data/mutations/invoices'
import { markQuoteAccepted } from '@/lib/data/mutations/quotes'

export default function RemindersClient({ initialData }: { initialData: RemindersData }) {
  const [invoices, setInvoices] = useState<OverdueInvoice[]>(initialData.overdueInvoices)
  const [quotes, setQuotes] = useState<PendingQuote[]>(initialData.pendingQuotes)
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [bulkLoading, setBulkLoading] = useState<'invoices' | 'quotes' | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [isPending, startTransition] = useTransition()

  const totalOverdue = invoices.reduce((acc, inv) => acc + (inv.total_ttc ?? 0), 0)
  const totalPending = quotes.reduce((acc, q) => acc + (q.total_ttc ?? 0), 0)

  function setError(id: string, msg: string) {
    setErrors(prev => ({ ...prev, [id]: msg }))
    setTimeout(() => setErrors(prev => { const n = { ...prev }; delete n[id]; return n }), 4000)
  }

  // ── Relancer tout (factures) ───────────────────────────────────────────────

  async function handleSendAllInvoiceReminders() {
    const withEmail = invoices.filter(inv => inv.clientEmail)
    if (withEmail.length === 0) return
    if (!confirm(`Envoyer ${withEmail.length} relance${withEmail.length > 1 ? 's' : ''} maintenant ?`)) return
    setBulkLoading('invoices')
    const sent: string[] = []
    for (const invoice of withEmail) {
      const res = await sendInvoiceReminder(invoice.id)
      if (!res.error) sent.push(invoice.id)
    }
    setInvoices(prev => prev.filter(inv => !sent.includes(inv.id)))
    setBulkLoading(null)
  }

  // ── Relancer tout (devis) ──────────────────────────────────────────────────

  async function handleSendAllQuoteFollowups() {
    const withEmail = quotes.filter(q => q.clientEmail)
    if (withEmail.length === 0) return
    if (!confirm(`Envoyer ${withEmail.length} relance${withEmail.length > 1 ? 's' : ''} maintenant ?`)) return
    setBulkLoading('quotes')
    const sent: string[] = []
    for (const quote of withEmail) {
      const res = await sendQuoteFollowup(quote.id)
      if (!res.error) sent.push(quote.id)
    }
    setQuotes(prev => prev.filter(q => !sent.includes(q.id)))
    setBulkLoading(null)
  }

  // ── Relance facture ────────────────────────────────────────────────────────

  function handleSendInvoiceReminder(invoice: OverdueInvoice) {
    if (!invoice.clientEmail) {
      setError(invoice.id, 'Ce client n\'a pas d\'adresse email.')
      return
    }
    setLoadingId(invoice.id)
    startTransition(async () => {
      const res = await sendInvoiceReminder(invoice.id)
      if (res.error) {
        setError(invoice.id, res.error)
      } else {
        // Retirer immédiatement — réapparaîtra après le cooldown de 3 jours
        setInvoices(prev => prev.filter(inv => inv.id !== invoice.id))
      }
      setLoadingId(null)
    })
  }

  // ── Marquer facture payée ──────────────────────────────────────────────────

  function handleMarkInvoicePaid(invoiceId: string) {
    setLoadingId(`paid-${invoiceId}`)
    startTransition(async () => {
      const res = await markInvoicePaid(invoiceId)
      if (res.error) {
        setError(invoiceId, res.error)
      } else {
        setInvoices(prev => prev.filter(inv => inv.id !== invoiceId))
      }
      setLoadingId(null)
    })
  }

  // ── Relance devis ──────────────────────────────────────────────────────────

  function handleSendQuoteFollowup(quote: PendingQuote) {
    if (!quote.clientEmail) {
      setError(quote.id, 'Ce client n\'a pas d\'adresse email.')
      return
    }
    setLoadingId(quote.id)
    startTransition(async () => {
      const res = await sendQuoteFollowup(quote.id)
      if (res.error) {
        setError(quote.id, res.error)
      } else {
        // Retirer immédiatement — réapparaîtra après le cooldown de 3 jours
        setQuotes(prev => prev.filter(q => q.id !== quote.id))
      }
      setLoadingId(null)
    })
  }

  // ── Marquer devis accepté ──────────────────────────────────────────────────

  function handleMarkQuoteAccepted(quoteId: string) {
    setLoadingId(`accepted-${quoteId}`)
    startTransition(async () => {
      const res = await markQuoteAccepted(quoteId)
      if (res.error) {
        setError(quoteId, res.error)
      } else {
        setQuotes(prev => prev.filter(q => q.id !== quoteId))
      }
      setLoadingId(null)
    })
  }

  // ── Marquer devis refusé ───────────────────────────────────────────────────

  function handleMarkQuoteRefused(quoteId: string) {
    setLoadingId(`refused-${quoteId}`)
    startTransition(async () => {
      const res = await markQuoteRefused(quoteId)
      if (res.error) {
        setError(quoteId, res.error)
      } else {
        setQuotes(prev => prev.filter(q => q.id !== quoteId))
      }
      setLoadingId(null)
    })
  }

  return (
    <main className="flex-1 p-8 max-w-[1400px] mx-auto w-full space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-4xl font-bold text-primary">Centre de Relances</h1>
          <p className="text-secondary text-lg">Suivez et gérez vos factures impayées et devis sans réponse.</p>
        </div>
        <Link
          href="/settings?tab=emails"
          className="px-6 py-3 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-semibold flex items-center justify-center gap-2 hover:bg-base transition-all"
        >
          <Settings className="w-4 h-4" />Configurer les modèles
        </Link>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] transition-all duration-300 ease-out p-6 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-red-500/5 rounded-bl-full -mr-8 -mt-8" />
          <span className="text-sm font-semibold text-secondary uppercase tracking-wider flex items-center gap-2">
            <Flame className="w-4 h-4 text-red-500" />Factures en retard
          </span>
          <span className="text-4xl font-bold text-red-500 tabular-nums">
            {invoices.length > 0 ? formatCurrency(totalOverdue) : '-'}
          </span>
          <span className="text-sm text-secondary mt-2">
            {invoices.length} facture{invoices.length !== 1 ? 's' : ''} à relancer
          </span>
        </div>
        <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] transition-all duration-300 ease-out p-6 flex flex-col gap-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-bl-full -mr-8 -mt-8" />
          <span className="text-sm font-semibold text-secondary uppercase tracking-wider flex items-center gap-2">
            <Hourglass className="w-4 h-4 text-accent" />Devis sans réponse
          </span>
          <span className="text-4xl font-bold text-accent tabular-nums">
            {quotes.length > 0 ? formatCurrency(totalPending) : '-'}
          </span>
          <span className="text-sm text-secondary mt-2">{quotes.length} devis en attente</span>
        </div>
      </div>

      {/* Listes */}
      <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-surface/2 dark:backdrop-blur-glass border border-[var(--elevation-border)] transition-all duration-300 ease-out overflow-hidden flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-[var(--elevation-border)]">

        {/* Urgences — Factures */}
        <div className="flex-1 p-8 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-primary flex items-center gap-2">
              <Flame className="w-5 h-5 text-red-500" />Urgences (Factures)
            </h2>
            {invoices.filter(i => i.clientEmail).length > 0 && (
              <button
                onClick={handleSendAllInvoiceReminders}
                disabled={bulkLoading === 'invoices'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-60"
              >
                {bulkLoading === 'invoices' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Relancer tout ({invoices.filter(i => i.clientEmail).length})
              </button>
            )}
          </div>
          <div className="space-y-4">
            {invoices.length > 0 ? invoices.map(invoice => (
              <div key={invoice.id} className="p-4 rounded-2xl bg-base/50 border border-[var(--elevation-border)] flex flex-col gap-3 hover:border-red-500/30 transition-colors">
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-primary">{invoice.clientName}</span>
                      {invoice.number && (
                        <span className="text-sm text-secondary px-2 py-0.5 rounded-md bg-surface dark:bg-white/5 border border-[var(--elevation-border)]">
                          {invoice.number}
                        </span>
                      )}
                      {invoice.reminderCount > 0 && (
                        <span className="text-xs text-orange-500 bg-orange-50 dark:bg-orange-500/10 px-2 py-0.5 rounded-full font-medium">
                          {invoice.reminderCount} relance{invoice.reminderCount > 1 ? 's' : ''} envoyée{invoice.reminderCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      {invoice.total_ttc != null && (
                        <span className="font-semibold text-primary tabular-nums">{formatCurrency(invoice.total_ttc)}</span>
                      )}
                      <span className="text-red-500 font-medium">Dépassé de {invoice.daysOverdue} jour{invoice.daysOverdue > 1 ? 's' : ''}</span>
                    </div>
                    {!invoice.clientEmail && (
                      <p className="text-xs text-amber-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />Aucun email — relance par email impossible
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 w-full xl:w-auto">
                    <button
                      onClick={() => handleMarkInvoicePaid(invoice.id)}
                      disabled={!!loadingId || isPending}
                      className="p-2 text-secondary hover:text-accent-green transition-colors disabled:opacity-50"
                      title="Marquer comme payé"
                    >
                      {loadingId === `paid-${invoice.id}` ? <Loader2 className="w-5 h-5 animate-spin" /> : <Check className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => handleSendInvoiceReminder(invoice)}
                      disabled={!!loadingId || isPending}
                      className="flex-1 xl:flex-none px-4 py-2 rounded-full bg-accent text-black font-bold flex items-center justify-center gap-2 hover:scale-105 transition-all disabled:opacity-50 disabled:hover:scale-100"
                    >
                      {loadingId === invoice.id
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Envoi...</>
                        : <><Mail className="w-4 h-4" />{invoice.reminderCount === 0 ? 'Envoyer Relance' : `Relance ${invoice.reminderCount + 1}`}</>
                      }
                    </button>
                  </div>
                </div>
                {errors[invoice.id] && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />{errors[invoice.id]}
                  </p>
                )}
              </div>
            )) : (
              <div className="text-center py-12 text-secondary">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p className="font-semibold">Aucune facture en retard</p>
                <p className="text-sm mt-1">Les factures impayées dépassant leur échéance apparaîtront ici.</p>
              </div>
            )}
          </div>
        </div>

        {/* En attente — Devis */}
        <div className="flex-1 p-8 space-y-6">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-xl font-bold text-primary flex items-center gap-2">
              <Hourglass className="w-5 h-5 text-accent" />En attente (Devis)
            </h2>
            {quotes.filter(q => q.clientEmail).length > 0 && (
              <button
                onClick={handleSendAllQuoteFollowups}
                disabled={bulkLoading === 'quotes'}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold bg-accent/10 text-accent hover:bg-accent/20 transition-colors disabled:opacity-60"
              >
                {bulkLoading === 'quotes' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}
                Relancer tout ({quotes.filter(q => q.clientEmail).length})
              </button>
            )}
          </div>
          <div className="space-y-4">
            {quotes.length > 0 ? quotes.map(quote => (
              <div key={quote.id} className="p-4 rounded-2xl bg-base/50 border border-[var(--elevation-border)] flex flex-col gap-3 hover:border-accent/30 transition-colors">
                <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-primary">{quote.clientName}</span>
                      {quote.number && (
                        <span className="text-sm text-secondary px-2 py-0.5 rounded-md bg-surface dark:bg-white/5 border border-[var(--elevation-border)]">
                          {quote.number}
                        </span>
                      )}
                      {quote.reminderCount > 0 && (
                        <span className="text-xs text-accent bg-accent/10 px-2 py-0.5 rounded-full font-medium">
                          {quote.reminderCount} relance{quote.reminderCount > 1 ? 's' : ''} envoyée{quote.reminderCount > 1 ? 's' : ''}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      {quote.total_ttc != null && (
                        <span className="font-semibold text-primary tabular-nums">{formatCurrency(quote.total_ttc)}</span>
                      )}
                      <span className="text-accent font-medium">En attente depuis {quote.daysPending} jour{quote.daysPending > 1 ? 's' : ''}</span>
                    </div>
                    {quote.title && <p className="text-xs text-secondary">{quote.title}</p>}
                    {!quote.clientEmail && (
                      <p className="text-xs text-amber-500 flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" />Aucun email — relance par email impossible
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 w-full xl:w-auto">
                    <button
                      onClick={() => handleMarkQuoteAccepted(quote.id)}
                      disabled={!!loadingId || isPending}
                      className="p-2 text-secondary hover:text-accent-green transition-colors disabled:opacity-50"
                      title="Marquer comme accepté"
                    >
                      {loadingId === `accepted-${quote.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => handleMarkQuoteRefused(quote.id)}
                      disabled={!!loadingId || isPending}
                      className="p-2 text-secondary hover:text-red-500 transition-colors disabled:opacity-50"
                      title="Marquer comme refusé"
                    >
                      {loadingId === `refused-${quote.id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <X className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => handleSendQuoteFollowup(quote)}
                      disabled={!!loadingId || isPending}
                      className="flex-1 xl:flex-none px-4 py-2 rounded-full bg-surface dark:bg-white/5 border border-[var(--elevation-border)] text-primary font-bold flex items-center justify-center gap-2 hover:bg-accent/10 hover:border-accent hover:text-accent transition-all disabled:opacity-50"
                    >
                      {loadingId === quote.id
                        ? <><Loader2 className="w-4 h-4 animate-spin" />Envoi...</>
                        : <><Mail className="w-4 h-4" />Relancer</>
                      }
                    </button>
                  </div>
                </div>
                {errors[quote.id] && (
                  <p className="text-xs text-red-500 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />{errors[quote.id]}
                  </p>
                )}
              </div>
            )) : (
              <div className="text-center py-12 text-secondary">
                <CheckCircle2 className="w-12 h-12 mx-auto mb-4 opacity-20" />
                <p className="font-semibold">Aucun devis en attente</p>
                <p className="text-sm mt-1">Les devis envoyés sans réponse après 7 jours apparaîtront ici.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
