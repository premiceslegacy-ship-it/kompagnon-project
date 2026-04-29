'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, Receipt } from 'lucide-react'
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

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount)

export function HistoriqueClient({ initialDocuments }: { initialDocuments: Doc[] }) {
  const [documents, setDocuments] = useState(initialDocuments)
  const pathname = usePathname()

  const handleStatusChange = (id: string, newStatus: string) => {
    setDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, status: newStatus } : doc))
  }

  if (documents.length === 0) return null

  return (
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
          {documents.map(doc => {
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
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${st.cls}`}>
                    {st.label}
                  </span>
                  {/* Date de signature pour les devis acceptés */}
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
  )
}
