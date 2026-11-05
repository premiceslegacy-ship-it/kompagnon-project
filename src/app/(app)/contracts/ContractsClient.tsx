'use client'
// @atelier-migrated

import { useState } from 'react'
import { ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import AttachmentPickerModal from '@/components/AttachmentPickerModal'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { SearchField } from '@/components/ui/SearchField'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { CONTRACT_DISCLAIMER, CONTRACT_TYPE_LABELS } from '@/lib/contracts/templates'
import { ContractActionsSheet, ContractFormSheet, TemplatesSheet } from './ContractSheets'
import { STATUS_LABELS } from './contractsModel'
import { useContracts, type ContractsProps } from './useContracts'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import docs from '../finances/Documents.module.css'

const NB = ' '

export default function ContractsClient(props: ContractsProps) {
  const q = useContracts(props)
  const { canCreate, canEdit, canDelete, clients, chantiers, templates, quotes } = props
  const [actionsId, setActionsId] = useState<string | null>(null)
  const actionsContract = q.contracts.find(c => c.id === actionsId) ?? null
  const { stats, pageData } = q

  const summary = [
    `${stats.total}${NB}contrat${stats.total > 1 ? 's' : ''}`,
    stats.draft > 0 ? `${stats.draft}${NB}brouillon${stats.draft > 1 ? 's' : ''}` : null,
    stats.signed > 0 ? `${stats.signed}${NB}signé${stats.signed > 1 ? 's' : ''}` : null,
    stats.generated > 0 ? `${stats.generated}${NB}PDF généré${stats.generated > 1 ? 's' : ''}` : null,
  ].filter(Boolean).join(' · ')

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <button type="button" className={styles.back} onClick={() => q.router.push('/finances')}>
          <ChevronLeft size={20} aria-hidden="true" />
          Documents
        </button>

        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>Contrats métier</p>
            <h1 className={screen.title}>Contrats</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu
              title="Contrats"
              items={[
                { label: q.isRefreshing ? 'Actualisation…' : 'Actualiser', disabled: q.isRefreshing, onSelect: q.refresh },
                ...(canCreate ? [{ label: 'Modèles de contrat', onSelect: () => q.setShowTemplate(true) }] : []),
              ]}
              trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
            />
            {canCreate && (
              <>
                <Button size="md" className={styles.createWide} onClick={() => q.setShowCreate(true)}>Nouveau contrat</Button>
                <button type="button" className={styles.createRound} onClick={() => q.setShowCreate(true)} aria-label="Nouveau contrat">
                  <Plus size={20} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </header>
        {q.error && <p className={screen.error} role="alert">{q.error}</p>}

        {q.contracts.length > 0 && <p className={docs.summary}>{summary}</p>}
        {q.contracts.length > 0 && (
          <div className={docs.searchRow}>
            <SearchField value={q.query} onChange={v => { q.setQuery(v); q.setPage(1) }} label="Rechercher un contrat" placeholder="Rechercher un contrat" />
          </div>
        )}

        <div className={styles.stack} style={{ marginTop: 16 }}>
          {q.isRefreshing ? (
            <Skeleton label="Chargement des contrats" />
          ) : q.contracts.length === 0 ? (
            canCreate ? (
              <EmptyState
                title="Aucun contrat"
                description="Créez un contrat de maintenance ou de sous-traitance à partir d'un modèle."
                actionLabel="Nouveau contrat"
                onAction={() => q.setShowCreate(true)}
              />
            ) : (
              <EmptyState title="Aucun contrat" description="Aucun contrat n'a encore été créé." />
            )
          ) : q.filtered.length === 0 ? (
            <EmptyState title="Aucun résultat" description="Aucun contrat ne correspond à votre recherche." />
          ) : (
            <ListGroup>
              {pageData.items.map(contract => {
                const status = STATUS_LABELS[contract.status]
                return (
                  <ListRow
                    key={contract.id}
                    leading={<Avatar name={contract.counterparty_name} />}
                    title={contract.title}
                    description={[
                      contract.counterparty_name,
                      CONTRACT_TYPE_LABELS[contract.contract_type],
                      contract.chantier ? `chantier ${contract.chantier.title}` : null,
                      contract.pdf_reference ?? null,
                    ].filter(Boolean).join(' · ')}
                    trailing={<StatusPill status={status.status}>{status.label}</StatusPill>}
                    onClick={() => setActionsId(contract.id)}
                  />
                )
              })}
            </ListGroup>
          )}

          {pageData.totalPages > 1 && !q.isRefreshing && (
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

          <p className={styles.hint} style={{ margin: '0 16px' }}>{CONTRACT_DISCLAIMER}</p>
        </div>
      </div>

      {actionsContract && (
        <ContractActionsSheet q={q} contract={actionsContract} canCreate={canCreate} canEdit={canEdit} canDelete={canDelete} onClose={() => setActionsId(null)} />
      )}
      {q.showCreate && (
        <ContractFormSheet clients={clients} chantiers={chantiers} templates={templates} quotes={quotes}
          onClose={() => q.setShowCreate(false)} onSaved={() => { q.setShowCreate(false); q.refresh() }} />
      )}
      {q.editingContract && (
        <ContractFormSheet contract={q.editingContract} clients={clients} chantiers={chantiers} templates={templates} quotes={quotes}
          onClose={() => q.setEditingContract(null)} onSaved={() => { q.setEditingContract(null); q.refresh() }} />
      )}
      {q.showTemplate && (
        <TemplatesSheet templates={templates} canCreate={canCreate} canDelete={canDelete}
          onClose={() => q.setShowTemplate(false)} onSaved={() => { q.setShowTemplate(false); q.refresh() }} />
      )}
      {q.sendModalContract && (
        <AttachmentPickerModal
          title="Envoyer le contrat"
          description="Sélectionnez les devis et factures du même client à joindre en pièces jointes."
          recipientEmail={q.sendModalContract.counterparty_email ?? null}
          groups={q.sendModalGroups}
          loading={q.sendModalLoading}
          submitting={q.sendModalSubmitting}
          error={q.sendModalError}
          onCancel={() => q.setSendModalContract(null)}
          onConfirm={q.confirmSend}
        />
      )}
    </main>
  )
}
