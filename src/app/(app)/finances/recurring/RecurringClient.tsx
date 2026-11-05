'use client'
// @atelier-migrated

import { useState } from 'react'
import { ChevronLeft, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Skeleton } from '@/components/ui/Skeleton'
import { StatusPill } from '@/components/ui/StatusPill'
import { frequencyLabel } from '@/lib/data/recurring-utils'
import { ClientSheet, EquipmentSheet, NewClientSheet, TransportSheet } from '../EditorSheets'
import { fmt, fmtDate, isReadyToPrepare } from './recurringModel'
import { RecurringActionsSheet, RecurringCatalogSheet, RecurringFormSheet, RecurringLineSheet } from './RecurringSheets'
import { useRecurring, type RecurringProps } from './useRecurring'
import screen from '@/components/layout/Screen.module.css'
import styles from '../quote-editor/QuoteEditor.module.css'

const NB = ' '

export default function RecurringClient(props: RecurringProps) {
  const q = useRecurring(props)
  const [actionsId, setActionsId] = useState<string | null>(null)
  const [lineId, setLineId] = useState<number | null>(null)
  const clientName = (c: { company_name?: string | null; first_name?: string | null; last_name?: string | null } | null | undefined) =>
    c?.company_name || [c?.first_name, c?.last_name].filter(Boolean).join(' ') || '-'
  const openForm = () => { q.resetForm(); q.setShowForm(true) }

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <button type="button" className={styles.back} onClick={() => q.router.push('/finances')}>
          <ChevronLeft size={20} aria-hidden="true" />
          Documents
        </button>

        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>Modèles d&apos;abonnement et contrats mensuels</p>
            <h1 className={screen.title}>Factures récurrentes</h1>
          </div>
          {q.invoices.length > 0 && (
            <div className={styles.headerEnd}>
              <Button size="md" className={styles.createWide} onClick={openForm}>Nouveau modèle</Button>
              <button type="button" className={styles.createRound} onClick={openForm} aria-label="Nouveau modèle">
                <Plus size={20} aria-hidden="true" />
              </button>
            </div>
          )}
        </header>
        {q.pageError && <p className={screen.error} role="alert">{q.pageError}</p>}

        <div className={styles.stack} style={{ marginTop: 16 }}>
          {q.schedules.length > 0 && (
            <ListGroup title="À vérifier" description="Le brouillon est prêt. Vérifiez-le avant l'envoi.">
              {q.schedules.map(s => (
                <ListRow
                  key={s.id}
                  title={s.recurring_invoice?.title ?? '-'}
                  description={[
                    clientName(s.recurring_invoice?.client),
                    s.scheduled_date ? `envoi prévu le ${fmtDate(s.scheduled_date)}` : 'date non définie',
                    s.amount_ht != null ? `${fmt(s.amount_ht)}${NB}HT` : null,
                  ].filter(Boolean).join(' · ')}
                  trailing={
                    <span className={styles.inline}>
                      {s.invoice_id && (
                        <Button size="sm" variant="secondary"
                          onClick={() => q.router.push(`/finances/invoice-editor?id=${s.invoice_id}&returnTo=${encodeURIComponent('/finances/recurring')}`)}>
                          Vérifier et envoyer
                        </Button>
                      )}
                      <Button size="sm" variant="text" disabled={!!q.loadingId} loading={q.loadingId === `skip-${s.id}`} onClick={() => q.handleSkip(s.id)}>
                        Ignorer
                      </Button>
                    </span>
                  }
                />
              ))}
            </ListGroup>
          )}

          {q.isRefreshing ? (
            <Skeleton label="Chargement des modèles" />
          ) : q.invoices.length === 0 ? (
            <EmptyState
              title="Aucun modèle récurrent"
              description="Créez un modèle pour automatiser vos factures mensuelles."
              actionLabel="Nouveau modèle"
              onAction={openForm}
            />
          ) : (
            <ListGroup title="Modèles actifs">
              {q.invoices.map(inv => {
                const total = (inv.items ?? []).reduce((s, i) => s + i.quantity * i.unit_price, 0)
                const highlighted = q.highlightId === inv.id
                return (
                  <ListRow
                    key={inv.id}
                    id={`recurring-${inv.id}`}
                    className={highlighted ? styles.highlight : undefined}
                    title={inv.title}
                    description={[
                      clientName(inv.client),
                      frequencyLabel(inv.frequency) + (inv.frequency === 'monthly' && inv.send_day ? ` le ${inv.send_day}` : '') + (inv.frequency === 'custom' && inv.custom_interval_days ? ` (${inv.custom_interval_days} j)` : ''),
                      total > 0 ? `${fmt(total)}${NB}HT` : null,
                    ].filter(Boolean).join(' · ')}
                    trailing={inv.is_active
                      ? <span className={styles.nextDate}>{isReadyToPrepare(inv) ? <StatusPill status="wait">À préparer</StatusPill> : <>Prochain<br />{fmtDate(inv.next_send_date)}</>}</span>
                      : <StatusPill status="neutral">En pause</StatusPill>}
                    onClick={() => setActionsId(inv.id)}
                  />
                )
              })}
            </ListGroup>
          )}
        </div>
      </div>

      <RecurringFormSheet q={q} fromInvoice={!!props.fromInvoice} onPickLine={setLineId} />
      {lineId != null && <RecurringLineSheet q={q} itemId={lineId} onClose={() => setLineId(null)} />}
      {actionsId && (
        <RecurringActionsSheet
          q={q}
          id={actionsId}
          onClose={() => setActionsId(null)}
          ready={(() => { const inv = q.invoices.find(i => i.id === actionsId); return !!inv && isReadyToPrepare(inv) })()}
        />
      )}
      <RecurringCatalogSheet q={q} />
      <NewClientSheet q={q} open={q.newClientOpen} onClose={() => q.setNewClientOpen(false)} />
      <TransportSheet q={q} />
      <EquipmentSheet q={q} />
    </main>
  )
}
