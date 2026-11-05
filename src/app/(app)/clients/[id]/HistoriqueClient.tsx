'use client'
// @atelier-migrated

import { useMemo, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import { paginate } from '@/lib/pagination'
import { useDocumentAction } from './ClientActions'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import docs from '../../finances/Documents.module.css'

type Doc = {
  type: 'quote' | 'invoice'
  id: string
  number: string | null
  title: string | null
  status: string
  total_ttc: number | null
  created_at: string
  signed_at?: string | null
}

type Status = { label: string; status: StatusPillStatus }

const QUOTE_STATUS: Record<string, Status> = {
  draft: { label: 'Brouillon', status: 'neutral' },
  sent: { label: 'Envoyé', status: 'wait' },
  viewed: { label: 'Consulté', status: 'wait' },
  accepted: { label: 'Accepté', status: 'success' },
  refused: { label: 'Refusé', status: 'danger' },
  expired: { label: 'Expiré', status: 'neutral' },
  converted: { label: 'Converti', status: 'success' },
}

const INVOICE_STATUS: Record<string, Status> = {
  draft: { label: 'Brouillon', status: 'neutral' },
  sent: { label: 'Envoyée', status: 'wait' },
  paid: { label: 'Payée', status: 'success' },
  cancelled: { label: 'Annulée', status: 'danger' },
}

const MONTHS_FR = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const PAGE_SIZE = 20
const NB = ' '

const money = (amount: number) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(amount)
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })

/** Historique financier d'un client : filtre par année et par mois, ouverture et actions rapides. */
export function HistoriqueClient({ initialDocuments }: { initialDocuments: Doc[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const [documents, setDocuments] = useState(initialDocuments)
  const [filterYear, setFilterYear] = useState('all')
  const [filterMonth, setFilterMonth] = useState('all')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<Doc | null>(null)
  const action = useDocumentAction()

  const years = useMemo(() => Array.from(new Set(documents.map(d => new Date(d.created_at).getFullYear()))).sort((a, b) => b - a), [documents])
  const filtered = useMemo(() => documents.filter(doc => {
    const d = new Date(doc.created_at)
    if (filterYear !== 'all' && d.getFullYear() !== Number(filterYear)) return false
    if (filterMonth !== 'all' && d.getMonth() !== Number(filterMonth)) return false
    return true
  }), [documents, filterYear, filterMonth])
  const pageData = paginate(filtered, page, PAGE_SIZE)

  if (documents.length === 0) return null

  const hrefOf = (doc: Doc) => `/finances/${doc.type === 'quote' ? 'quote' : 'invoice'}-editor?${new URLSearchParams({ id: doc.id, returnTo: pathname })}`
  const markable = (doc: Doc) => doc.type === 'invoice' ? doc.status !== 'paid' : doc.status !== 'accepted' && doc.status !== 'converted'
  const setStatus = (id: string, status: string) => setDocuments(prev => prev.map(doc => doc.id === id ? { ...doc, status } : doc))

  return (
    <>
      <div className={docs.chips} style={{ marginTop: 0 }}>
        <Menu
          title="Année"
          items={[{ label: 'Toutes les années', checked: filterYear === 'all', onSelect: () => { setFilterYear('all'); setFilterMonth('all'); setPage(1) } },
            ...years.map(y => ({ label: String(y), checked: filterYear === String(y), onSelect: () => { setFilterYear(String(y)); setFilterMonth('all'); setPage(1) } }))]}
          trigger={<button type="button" className={docs.chip} data-on={filterYear !== 'all' ? 'true' : 'false'}>{filterYear === 'all' ? 'Toutes les années' : filterYear}<ChevronDown size={14} aria-hidden="true" /></button>}
        />
        <Menu
          title="Mois"
          items={[{ label: 'Tous les mois', checked: filterMonth === 'all', onSelect: () => { setFilterMonth('all'); setPage(1) } },
            ...MONTHS_FR.map((m, i) => ({ label: m, checked: filterMonth === String(i), disabled: filterYear === 'all', onSelect: () => { setFilterMonth(String(i)); setPage(1) } }))]}
          trigger={<button type="button" className={docs.chip} disabled={filterYear === 'all'} data-on={filterMonth !== 'all' ? 'true' : 'false'}>{filterMonth === 'all' ? 'Tous les mois' : MONTHS_FR[Number(filterMonth)]}<ChevronDown size={14} aria-hidden="true" /></button>}
        />
      </div>

      {filtered.length === 0 ? (
        <p className={styles.notice}>Aucun document sur cette période.</p>
      ) : (
        <ListGroup title="Historique financier" description={`${filtered.length}${NB}document${filtered.length > 1 ? 's' : ''}`}>
          {pageData.items.map(doc => {
            const map = doc.type === 'quote' ? QUOTE_STATUS : INVOICE_STATUS
            const st = map[doc.status] ?? map.draft
            return (
              <ListRow
                key={`${doc.type}-${doc.id}`}
                title={`${doc.type === 'quote' ? 'Devis' : 'Facture'} ${doc.number ?? '/'}`}
                description={`${doc.title ?? (doc.type === 'quote' ? 'Devis sans titre' : 'Facture sans titre')} · ${shortDate(doc.created_at)}${doc.type === 'quote' && doc.status === 'accepted' && doc.signed_at ? ` · signé le ${shortDate(doc.signed_at)}` : ''}`}
                trailing={
                  <span className={styles.trailStack}>
                    <span className={styles.amount}>{doc.total_ttc != null ? money(doc.total_ttc) : '/'}</span>
                    <StatusPill status={st.status}>{st.label}</StatusPill>
                  </span>
                }
                onClick={() => setSelected(doc)}
              />
            )
          })}
        </ListGroup>
      )}

      {pageData.totalPages > 1 && (
        <div className={docs.pager}>
          <button type="button" className={screen.round} aria-label="Page précédente" disabled={pageData.currentPage === 1} onClick={() => setPage(p => Math.max(1, p - 1))}><ChevronLeft size={20} aria-hidden="true" /></button>
          <span className={docs.pagerLabel}>Page {pageData.currentPage} / {pageData.totalPages}</span>
          <button type="button" className={screen.round} aria-label="Page suivante" disabled={pageData.currentPage === pageData.totalPages} onClick={() => setPage(p => Math.min(pageData.totalPages, p + 1))}><ChevronRight size={20} aria-hidden="true" /></button>
        </div>
      )}

      {selected && (
        <Sheet open onOpenChange={open => { if (!open) setSelected(null) }} title={`${selected.type === 'quote' ? 'Devis' : 'Facture'} ${selected.number ?? ''}`.trim()} description={selected.title ?? undefined} cancelLabel="Fermer">
          <ListGroup>
            <ListRow title="Ouvrir" onClick={() => router.push(hrefOf(selected))} />
            {markable(selected) && (
              <ListRow
                title={selected.type === 'invoice' ? 'Marquer comme payée' : 'Marquer comme accepté'}
                disabled={action.pending}
                onClick={() => action.run(selected.type, selected.id, () => { setStatus(selected.id, selected.type === 'invoice' ? 'paid' : 'accepted'); setSelected(null) })}
              />
            )}
          </ListGroup>
        </Sheet>
      )}
    </>
  )
}
