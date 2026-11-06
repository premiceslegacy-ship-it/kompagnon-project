'use client'
// @atelier-migrated

import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusPill } from '@/components/ui/StatusPill'
import { formatCurrency } from '@/components/shared'
import { CreateChoiceSheet, NewChantierSheet } from './ChantierSheets'
import { STATUS_FILTERS, fmtHours, fmtShortDate, recurrenceLabel, statusPill } from './chantiersModel'
import { useChantiers, type ChantiersProps } from './useChantiers'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import docs from '../finances/Documents.module.css'

const NB = ' '

export default function ChantiersClient(props: ChantiersProps) {
  const q = useChantiers(props)
  const { stats, clients, linkableQuotes, canCreate = false, initialChantiers } = props
  const { pageData } = q
  const statusLabel = STATUS_FILTERS.find(o => o.value === q.filterStatus)?.label ?? 'Statut'

  const menuItems: MenuItem[] = [
    { label: 'Heures pointées', onSelect: () => q.goTo('/chantiers/heures', 'Ouverture des heures...') },
    { label: 'Équipes et intervenants', onSelect: () => q.goTo('/chantiers/equipes', 'Ouverture des équipes...') },
    { label: 'Entretien', onSelect: () => q.goTo('/chantiers/entretien', "Ouverture de l'entretien...") },
  ]

  const summary = `${stats.enCours}${NB}en cours · ${stats.terminesCeMois}${NB}terminé${stats.terminesCeMois > 1 ? 's' : ''} ce mois · ${fmtHours(stats.heuresCeMois)}${NB}pointées`

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{stats.total}{NB}chantier{stats.total > 1 ? 's' : ''}</p>
            <h1 className={screen.title}>Chantiers</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu
              title="Chantiers"
              items={menuItems}
              trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
            />
            {canCreate && (
              <>
                <Button size="md" className={styles.createWide} onClick={() => q.setCreateStep('choice')}>Nouveau chantier</Button>
                <button type="button" className={styles.createRound} onClick={() => q.setCreateStep('choice')} aria-label="Nouveau chantier">
                  <Plus size={20} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        </header>

        <div className={docs.segmentRow}>
          <SegmentedControl
            label="Vue des chantiers"
            fullWidth
            options={[{ value: 'liste', label: 'Liste' }, { value: 'planning', label: 'Planning' }]}
            value="liste"
            onChange={v => { if (v === 'planning') q.goTo('/chantiers/planning', 'Ouverture du planning...') }}
          />
          <p className={docs.summary}>{summary}</p>
        </div>

        {initialChantiers.length > 0 && (
          <>
            <div className={docs.searchRow}>
              <SearchField value={q.search} onChange={v => { q.setSearch(v); q.setPage(1) }} label="Rechercher un chantier" placeholder="Chantier, client ou ville" />
            </div>
            <div className={docs.chips}>
              <Menu
                title="Statut"
                items={STATUS_FILTERS.map(o => ({ label: o.label, checked: q.filterStatus === o.value, onSelect: () => { q.setFilterStatus(o.value); q.setPage(1) } }))}
                trigger={
                  <button type="button" className={docs.chip} data-on={q.filterStatus !== 'tous' ? 'true' : 'false'}>
                    {statusLabel}
                    <ChevronDown size={14} aria-hidden="true" />
                  </button>
                }
              />
            </div>
          </>
        )}

        <div className={styles.stack} style={{ marginTop: 16 }}>
          {initialChantiers.length === 0 ? (
            canCreate ? (
              <EmptyState title="Aucun chantier pour le moment" description="Créez votre premier chantier pour suivre travaux, équipe et marge." actionLabel="Nouveau chantier" onAction={() => q.setCreateStep('choice')} />
            ) : (
              <EmptyState title="Aucun chantier pour le moment" description="Aucun chantier n'a encore été créé." />
            )
          ) : q.filtered.length === 0 ? (
            <EmptyState title="Aucun chantier trouvé" description="Modifiez la recherche ou le statut." actionLabel="Tous les chantiers" onAction={() => { q.setSearch(''); q.setFilterStatus('tous') }} />
          ) : (
            <ListGroup description="Budgets hors taxes.">
              {pageData.items.map(c => {
                const pill = statusPill(c.status)
                const rec = recurrenceLabel(c.recurrence)
                const place = [c.client?.company_name, c.city].filter(Boolean).join(' · ')
                const dates = c.start_date || c.estimated_end_date ? `${fmtShortDate(c.start_date)} → ${fmtShortDate(c.estimated_end_date)}` : ''
                return (
                  <ListRow
                    key={c.id}
                    href={`/chantiers/${c.id}`}
                    leading={<Avatar name={c.client?.company_name ?? c.title} />}
                    title={c.title}
                    description={[place, rec, dates].filter(Boolean).join(' · ') || undefined}
                    trailing={
                      <span className={styles.trailStack}>
                        <span className={styles.amount}>{formatCurrency(c.budget_ht)}</span>
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

      {q.isNavigating && (
        <div className={docs.navigating} role="status">
          <div className={docs.spinner} aria-hidden="true" />
          <p>{q.navigationLabel}</p>
        </div>
      )}

      {q.createStep === 'choice' && (
        <CreateChoiceSheet
          onClose={() => q.setCreateStep(null)}
          onSelectChantier={() => q.setCreateStep('form')}
          onSelectEntretien={() => { q.setCreateStep(null); q.goTo('/chantiers/entretien', "Ouverture de l'entretien...") }}
        />
      )}
      {q.createStep === 'form' && (
        <NewChantierSheet
          clients={clients}
          linkableQuotes={linkableQuotes}
          onClose={() => q.setCreateStep(null)}
          onCreated={id => { q.setCreateStep(null); q.goTo(`/chantiers/${id}`, 'Ouverture du chantier...') }}
        />
      )}
    </main>
  )
}
