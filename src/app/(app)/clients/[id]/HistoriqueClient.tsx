'use client'

import React, { useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, Receipt, ChevronLeft, ChevronRight } from 'lucide-react'
import { DocumentActions } from './ClientActions'

type DocStatus = string

type Doc = {
  type: 'quote' | 'invoice'
  id: string
  number: string | null
  title: string | null
  status: DocStatus
  total_ttc: number | null
  created_at: string
  signed_at?: string | null
}

const QUOTE_STATUS: Record<string, { label: string; cls: string }> = {
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

const MONTHS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

const PAGE_SIZE = 20

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount)

export function HistoriqueClient({ initialDocuments }: { initialDocuments: Doc[] }) {
  const [documents, setDocuments] = useState(initialDocuments)
  const pathname = usePathname()

  const [filterYear, setFilterYear] = useState<string>('all')
  const [filterMonth, setFilterMonth] = useState<string>('all')
  const [page, setPage] = useState(1)

  const handleStatusChange = (id: string, newStatus: string) => {
    setDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, status: newStatus } : doc))
  }

  const years = useMemo(() => {
    const set = new Set(documents.map(d => new Date(d.created_at).getFullYear()))
    return Array.from(set).sort((a, b) => b - a)
  }, [documents])

  const filtered = useMemo(() => {
    return documents.filter(doc => {
      const d = new Date(doc.created_at)
      if (filterYear !== 'all' && d.getFullYear() !== Number(filterYear)) return false
      if (filterMonth !== 'all' && d.getMonth() !== Number(filterMonth)) return false
      return true
    })
  }, [documents, filterYear, filterMonth])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const handleYearChange = (v: string) => { setFilterYear(v); setFilterMonth('all'); setPage(1) }
  const handleMonthChange = (v: string) => { setFilterMonth(v); setPage(1) }

  if (documents.length === 0) return null

  return (
    <div>
      {/* Filtres */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-[var(--elevation-border)]">
        <select
          value={filterYear}
          onChange={e => handleYearChange(e.target.value)}
          className="text-sm rounded-full px-3 py-1.5 bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        >
          <option value="all">Toutes les années</option>
          {years.map(y => (
            <option key={y} value={String(y)}>{y}</option>
          ))}
        </select>

        <select
          value={filterMonth}
          onChange={e => handleMonthChange(e.target.value)}
          disabled={filterYear === 'all'}
          className="text-sm rounded-full px-3 py-1.5 bg-base/50 border border-[var(--elevation-border)] text-primary focus:outline-none focus:ring-2 focus:ring-accent/30 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <option value="all">Tous les mois</option>
          {MONTHS_FR.map((m, i) => (
            <option key={i} value={String(i)}>{m}</option>
          ))}
        </select>

        {(filterYear !== 'all' || filterMonth !== 'all') && (
          <button
            onClick={() => { setFilterYear('all'); setFilterMonth('all'); setPage(1) }}
            className="text-xs text-secondary hover:text-primary transition-colors underline underline-offset-2"
          >
            Effacer les filtres
          </button>
        )}

        <span className="ml-auto text-xs text-secondary">
          {filtered.length} document{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-base/30">
              <th className="px-6 py-3 text-xs font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Type</th>
              <th className="px-6 py-3 text-xs font-bold text-secondary uppercase tracking-wider whitespace-nowrap">N° / Titre</th>
              <th className="px-6 py-3 text-xs font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Date</th>
              <th className="px-6 py-3 text-xs font-bold text-secondary uppercase tracking-wider text-right whitespace-nowrap">Montant TTC</th>
              <th className="px-6 py-3 text-xs font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Statut</th>
              <th className="px-6 py-3 text-xs font-bold text-secondary uppercase tracking-wider whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--elevation-border)]">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-sm text-secondary">
                  Aucun document sur cette période.
                </td>
              </tr>
            ) : paginated.map(doc => {
              const statusMap = doc.type === 'quote' ? QUOTE_STATUS : INVOICE_STATUS
              const st = statusMap[doc.status] ?? statusMap['draft']
              const params = new URLSearchParams({ id: doc.id, returnTo: pathname })
              const href = doc.type === 'quote'
                ? `/finances/quote-editor?${params}`
                : `/finances/invoice-editor?${params}`
              return (
                <tr key={`${doc.type}-${doc.id}`} className="hover:bg-accent/5 transition-colors">
                  <td className="px-6 py-3">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-base/50">
                      {doc.type === 'quote'
                        ? <FileText className="w-4 h-4 text-accent" />
                        : <Receipt className="w-4 h-4 text-accent-green" />
                      }
                    </div>
                  </td>
                  <td className="px-6 py-3">
                    <Link href={href} className="hover:text-accent transition-colors">
                      <p className="font-semibold text-primary text-sm">{doc.title ?? (doc.type === 'quote' ? 'Devis sans titre' : 'Facture sans titre')}</p>
                      <p className="text-xs text-secondary font-mono">{doc.number ?? '/'}</p>
                    </Link>
                  </td>
                  <td className="px-6 py-3">
                    <p className="text-sm text-secondary">
                      {new Date(doc.created_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                    </p>
                  </td>
                  <td className="px-6 py-3 text-right">
                    <p className="text-sm font-semibold text-primary tabular-nums">
                      {doc.total_ttc != null ? formatCurrency(doc.total_ttc) : '/'}
                    </p>
                  </td>
                  <td className="px-6 py-3">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider whitespace-nowrap ${st.cls}`}>
                      {st.label}
                    </span>
                    {doc.type === 'quote' && doc.status === 'accepted' && doc.signed_at && (
                      <p className="text-[10px] text-secondary mt-0.5">
                        Signé le {new Date(doc.signed_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}
                      </p>
                    )}
                  </td>
                  <td className="px-6 py-3">
                    <div className="flex items-center gap-2">
                      <Link
                        href={href}
                        className="flex items-center gap-1 px-3 py-1.5 rounded-full text-[10px] font-bold bg-secondary/10 text-secondary hover:bg-secondary/20 transition-colors uppercase tracking-wider"
                      >
                        Ouvrir
                      </Link>
                      <DocumentActions
                        type={doc.type}
                        id={doc.id}
                        status={doc.status}
                        onStatusChange={handleStatusChange}
                      />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-[var(--elevation-border)]">
          <span className="text-xs text-secondary">
            Page {currentPage} / {totalPages}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1.5 rounded-lg hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronLeft className="w-4 h-4 text-secondary" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && (p as number) - (arr[idx - 1] as number) > 1) acc.push('...')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === '...' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-xs text-secondary">...</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`min-w-[28px] h-7 rounded-lg text-xs font-bold transition-colors ${
                      currentPage === p
                        ? 'bg-accent text-black'
                        : 'hover:bg-accent/10 text-secondary'
                    }`}
                  >
                    {p}
                  </button>
                )
              )
            }
            <button
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="p-1.5 rounded-lg hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <ChevronRight className="w-4 h-4 text-secondary" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
