'use client'
// @atelier-migrated

import { Avatar } from '@/components/ui/Avatar'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusPill } from '@/components/ui/StatusPill'
import type { QuoteRequest } from './page'
import { REQUEST_FILTERS, formatRequestDate, requestStatus, type RequestFilter } from './requestsModel'
import { RequestSheet } from './RequestSheet'
import { useRequests } from './useRequests'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

export default function RequestsClient({ initialRequests }: { initialRequests: QuoteRequest[] }) {
  const q = useRequests(initialRequests)

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>Reçues par votre formulaire public</p>
            <h1 className={screen.title}>{q.newCount > 0 ? `${q.newCount} nouvelle${q.newCount > 1 ? 's' : ''} demande${q.newCount > 1 ? 's' : ''}` : 'Demandes de devis'}</h1>
          </div>
        </header>

        <div style={{ marginTop: 12 }}>
          <SegmentedControl
            label="Filtrer les demandes"
            value={q.filter}
            options={REQUEST_FILTERS}
            onChange={v => q.setFilter(v as RequestFilter)}
          />
        </div>

        <div className={styles.stack} style={{ marginTop: 16 }}>
          {q.filtered.length === 0 ? (
            <EmptyState
              title={q.filter === 'new' ? 'Aucune nouvelle demande' : 'Aucune demande pour le moment'}
              description={q.filter === 'new'
                ? 'Toutes les demandes ont été traitées.'
                : 'Partagez le lien de votre formulaire à vos prospects pour recevoir des demandes ici.'}
            />
          ) : (
            <ListGroup>
              {q.filtered.map(request => {
                const status = requestStatus(request.status)
                return (
                  <ListRow
                    key={request.id}
                    leading={<Avatar name={request.name} />}
                    title={request.name}
                    description={[request.subject ?? request.prestation_type, formatRequestDate(request.created_at, false)].filter(Boolean).join(' · ')}
                    trailing={<StatusPill status={status.status}>{status.label}</StatusPill>}
                    onClick={() => q.open(request)}
                  />
                )
              })}
            </ListGroup>
          )}
        </div>
      </div>

      {q.selected && <RequestSheet request={q.selected} patch={q.patch} onClose={() => q.setSelectedId(null)} />}
    </main>
  )
}
