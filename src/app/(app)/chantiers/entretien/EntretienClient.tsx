'use client'
// @atelier-migrated
// Entretien récurrent : contrats par statut, interventions, rapports, suivi de facturation et de marge.

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusPill } from '@/components/ui/StatusPill'
import ContractDetail from './ContractDetail'
import { ContractSheet, InterventionSheet } from './EntretienSheets'
import { CONTRACT_FILTERS, CONTRACT_STATUS, FREQUENCE_LABELS, clientDisplayName, fmtDateShort, fmtMoney, todayStr } from './entretienModel'
import { useEntretien, type EntretienProps } from './useEntretien'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import local from './Entretien.module.css'

export default function EntretienClient(props: EntretienProps) {
  const q = useEntretien(props)
  const { clients, quotes, teamMembers, ghostMembers, currentUserId, currentUserName, materials, laborRates, prestationTypes, orgSector = null } = props
  const open = q.selectedContract
  const count = q.contracts.length
  const confirm = q.confirmDelete

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <div className={local.split} data-open={open ? 'true' : 'false'}>
          <div className={local.listPane} data-hidden={open ? 'true' : 'false'}>
            <Link href="/chantiers" className={styles.back}>
              <ChevronLeft size={20} aria-hidden="true" />
              Chantiers
            </Link>
            <header className={screen.header}>
              <div>
                <p className={screen.kicker}>{count}{' '}contrat{count > 1 ? 's' : ''} d’entretien</p>
                <h1 className={screen.title}>Entretien</h1>
              </div>
              <Button size="md" onClick={q.openCreateContract}>Nouveau contrat</Button>
            </header>

            <div className={styles.stack}>
              <SearchField label="Rechercher un contrat ou un client" placeholder="Contrat ou client" value={q.search} onChange={q.setSearch} />
              <SegmentedControl label="Statut du contrat" fullWidth value={q.filterTab} onChange={q.setFilterTab} options={CONTRACT_FILTERS.map(t => ({ value: t.key, label: t.label }))} />

              {q.filtered.length === 0 ? (
                count === 0 ? (
                  <EmptyState title="Aucun contrat d’entretien" description="Créez votre premier contrat pour planifier les passages, rédiger les rapports et facturer chaque période." actionLabel="Nouveau contrat" onAction={q.openCreateContract} />
                ) : (
                  <EmptyState title="Aucun contrat trouvé" description="Modifiez la recherche ou le statut." actionLabel="Voir les contrats actifs" onAction={() => { q.setSearch(''); q.setFilterTab('all') }} />
                )
              ) : (
                <ListGroup>
                  {q.filtered.map(c => {
                    const client = clientDisplayName(c.client)
                    const next = c.prochaine_intervention && c.prochaine_intervention >= todayStr() ? `Prochaine : ${fmtDateShort(c.prochaine_intervention)}` : null
                    const st = CONTRACT_STATUS[c.status]
                    return (
                      <ListRow
                        key={c.id}
                        className={open?.id === c.id ? local.selected : undefined}
                        title={c.title}
                        description={[client, FREQUENCE_LABELS[c.frequence], c.interventions_count > 0 ? `${c.interventions_count} intervention${c.interventions_count > 1 ? 's' : ''}` : null, next].filter(Boolean).join(' · ')}
                        trailing={
                          <span className={styles.trailStack}>
                            {c.montant_ht !== null && <span className={styles.amount}>{fmtMoney(c.montant_ht)}</span>}
                            {c.status !== 'actif' && <StatusPill status={st.pill}>{st.label}</StatusPill>}
                          </span>
                        }
                        onClick={() => q.openDetail(c)}
                      />
                    )
                  })}
                </ListGroup>
              )}
            </div>
          </div>

          {open && (
            <ContractDetail
              key={open.id}
              q={q}
              contract={open}
              catalog={{ materials, laborRates, prestationTypes, ghostMembers, teamMembers }}
              orgSector={orgSector}
            />
          )}
        </div>
      </div>

      <ContractSheet q={q} clients={clients} quotes={quotes} />
      <InterventionSheet q={q} teamMembers={teamMembers} ghostMembers={ghostMembers} currentUserId={currentUserId} currentUserName={currentUserName} />
      <AlertDialog
        open={confirm !== null}
        onOpenChange={o => { if (!o) q.setConfirmDelete(null) }}
        title={confirm?.type === 'contract' ? 'Résilier ce contrat ?' : 'Supprimer cette intervention ?'}
        description={confirm?.type === 'contract' ? 'Le contrat passera au statut « Résilié ». Vous pourrez le rétablir en le modifiant.' : 'Cette intervention sera supprimée définitivement.'}
        confirmLabel={confirm?.type === 'contract' ? 'Résilier' : 'Supprimer'}
        onConfirm={() => {
          if (!confirm) return
          if (confirm.type === 'contract') q.confirmDeleteContract(confirm.id)
          else q.confirmDeleteIntervention(confirm.id)
        }}
      />
    </main>
  )
}
