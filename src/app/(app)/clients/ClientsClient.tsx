'use client'
// @atelier-migrated

import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { SearchField } from '@/components/ui/SearchField'
import { StatusPill } from '@/components/ui/StatusPill'
import { formatCurrency } from '@/components/shared'
import EmailComposerModal from './EmailComposerModal'
import { ImportSheet, NewClientSheet, NewLeadSheet } from './ClientSheets'
import { SORT_OPTIONS, STATUS_FILTERS, clientDisplayName, followupState, isLead, statusPill } from './clientsModel'
import { useClients, type ClientsProps } from './useClients'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import docs from '../finances/Documents.module.css'

const NB = ' '

export default function ClientsClient(props: ClientsProps) {
  const q = useClients(props)
  const { canCreate, canImport, canEmail, initialClients } = props
  const { stats, pageData } = q
  const statusLabel = STATUS_FILTERS.find(o => o.value === q.statusFilter)?.label ?? 'Statut'
  const sortLabel = SORT_OPTIONS.find(o => o.value === q.sortBy)?.label ?? 'Tri'

  const menuItems: MenuItem[] = [
    ...(canCreate ? [{ label: 'Ajouter un lead', onSelect: () => q.setIsNewLeadOpen(true) }] : []),
    ...(canEmail ? [{ label: 'Envoyer un email', onSelect: () => q.setIsEmailOpen(true) }] : []),
    ...(canImport ? [
      { label: 'Importer des clients', onSelect: () => q.setImportMode('clients') },
      { label: 'Importer des leads', onSelect: () => q.setImportMode('leads') },
    ] : []),
    { label: 'Exporter en CSV', onSelect: q.handleExportCSV },
  ]

  const summary = `${stats.active}${NB}client${stats.active > 1 ? 's' : ''} · ${stats.pipeline}${NB}en prospection${stats.revenue > 0 ? ` · ${formatCurrency(stats.revenue)}${NB}de chiffre d’affaires` : ''}`

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>Clients et leads</p>
            <h1 className={screen.title}>Clients</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu
              title="Clients"
              items={menuItems}
              trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
            />
            {canCreate && (
              <>
                <Button size="md" className={styles.createWide} onClick={() => q.setIsNewClientOpen(true)}>Nouveau client</Button>
                <button type="button" className={styles.createRound} onClick={() => q.setIsNewClientOpen(true)} aria-label="Nouveau client">
                  <Plus size={20} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </header>

        {initialClients.length > 0 && <p className={docs.summary}>{summary}</p>}
        {initialClients.length > 0 && (
          <>
            <div className={docs.searchRow}>
              <SearchField value={q.searchTerm} onChange={v => { q.setSearchTerm(v); q.setPage(1) }} label="Rechercher un contact" placeholder="Nom ou email" />
            </div>
            <div className={docs.chips}>
              <Menu
                title="Statut"
                items={STATUS_FILTERS.map(o => ({
                  label: o.value === 'followup' && stats.followup > 0 ? `${o.label} (${stats.followup})` : o.label,
                  checked: q.statusFilter === o.value,
                  onSelect: () => { q.setStatusFilter(o.value); q.setPage(1) },
                }))}
                trigger={
                  <button type="button" className={docs.chip} data-on={q.statusFilter !== 'All' ? 'true' : 'false'}>
                    {statusLabel}
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                }
              />
              <Menu
                title="Trier"
                items={SORT_OPTIONS.map(o => ({ label: o.label, checked: q.sortBy === o.value, onSelect: () => { q.setSortBy(o.value); q.setPage(1) } }))}
                trigger={
                  <button type="button" className={docs.chip}>
                    Trier : {sortLabel}
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                }
              />
            </div>
          </>
        )}

        <div className={styles.stack} style={{ marginTop: 16 }}>
          {initialClients.length === 0 ? (
            canCreate ? (
              <EmptyState title="Aucun contact pour le moment" description="Commencez par ajouter un client ou un lead." actionLabel="Nouveau client" onAction={() => q.setIsNewClientOpen(true)} />
            ) : (
              <EmptyState title="Aucun contact pour le moment" description="Aucun client ni lead n'a encore été ajouté." />
            )
          ) : q.allFiltered.length === 0 ? (
            <EmptyState title="Aucun contact trouvé" description="Essayez de modifier vos critères de recherche." actionLabel="Tous les contacts" onAction={() => { q.setSearchTerm(''); q.setStatusFilter('All') }} />
          ) : (
            <ListGroup>
              {pageData.items.map(client => {
                const pill = statusPill(client.status)
                const followup = followupState(client)
                const lead = isLead(client)
                return (
                  <ListRow
                    key={client.id}
                    href={`/clients/${client.id}`}
                    leading={<Avatar name={clientDisplayName(client)} />}
                    title={clientDisplayName(client)}
                    description={followup.kind !== 'ok'
                      ? followup.label
                      : [client.type === 'company' ? 'Professionnel' : 'Particulier', client.email].filter(Boolean).join(' · ')}
                    trailing={
                      <span className={styles.trailStack}>
                        {!lead && <span className={styles.amount}>{formatCurrency(client.total_revenue ?? 0)}</span>}
                        <StatusPill status={pill.status}>{pill.label}</StatusPill>
                      </span>
                    }
                  />
                )
              })}
            </ListGroup>
          )}

          {pageData.totalPages > 1 && (
            <div className={docs.pager}>
              <button type="button" className={screen.round} aria-label="Page précédente" disabled={pageData.currentPage === 1} onClick={() => q.setPage(p => Math.max(1, p - 1))}>
                <ChevronLeft size={20} aria-hidden="true" />
              </button>
              <span className={docs.pagerLabel}>Page {pageData.currentPage} / {pageData.totalPages}</span>
              <button type="button" className={screen.round} aria-label="Page suivante" disabled={pageData.currentPage === pageData.totalPages} onClick={() => q.setPage(p => Math.min(pageData.totalPages, p + 1))}>
                <ChevronRight size={20} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </div>

      {q.isNewClientOpen && <NewClientSheet onClose={() => q.setIsNewClientOpen(false)} />}
      {q.isNewLeadOpen && <NewLeadSheet onClose={() => q.setIsNewLeadOpen(false)} />}
      {q.importMode && <ImportSheet isLeads={q.importMode === 'leads'} onClose={() => q.setImportMode(null)} />}
      {q.isEmailOpen && (
        <EmailComposerModal
          isOpen={q.isEmailOpen}
          onClose={() => q.setIsEmailOpen(false)}
          allClients={initialClients}
          orgEmail={props.orgEmail}
          orgName={props.orgName}
          orgSignature={props.orgSignature}
          hasAI={props.hasAI}
        />
      )}
    </main>
  )
}
