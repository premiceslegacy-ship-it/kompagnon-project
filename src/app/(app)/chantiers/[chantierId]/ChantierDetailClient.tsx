'use client'
// @atelier-migrated

import { useState } from 'react'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'
import { AddressLink } from '@/components/shared/AddressLink'
import ChantierAIAssistant from '@/components/ai/ChantierAIAssistant'
import ClientEmailRequiredModal from '@/components/ClientEmailRequiredModal'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusPill } from '@/components/ui/StatusPill'
import { formatCurrency } from '@/components/shared'
import { fmtHours, statusPill, statusTransitions } from '../chantiersModel'
import { BillSheet, ContactSheet, DetailsSheet, ReportSheet } from './ChantierDetailSheets'
import ArgentSegment from './ArgentSegment'
import EquipeSegment from './EquipeSegment'
import PhotosSegment from './PhotosSegment'
import TravauxSegment from './TravauxSegment'
import type { Segment } from './chantierModel'
import { useChantierActions } from './useChantierActions'
import { useChantierDetail, type ChantierDetailProps } from './useChantierDetail'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '

function Ring({ percent }: { percent: number }) {
  const size = 92
  const stroke = 9
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  return (
    <div className={fiche.ring} role="img" aria-label={`Avancement : ${percent}${NB}%`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--at-remplissage)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--at-accent)" strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - percent / 100)} />
      </svg>
      <span className={fiche.ringValue}>{percent}{NB}%</span>
    </div>
  )
}

type Overlay = 'details' | 'contact' | 'bill' | 'report' | null

export default function ChantierDetailClient(props: ChantierDetailProps) {
  const q = useChantierDetail(props)
  const actions = useChantierActions(q.chantier)
  const [overlay, setOverlay] = useState<Overlay>(null)
  const c = q.chantier
  const pill = statusPill(actions.status)
  const nextTask = q.taches.find(t => t.status !== 'termine')
  const nextWho = nextTask ? (nextTask.assignments ?? []).map(a => a.label).join(', ') : ''
  const clientName = c.client?.company_name ?? null
  const team = q.initialChantierEquipes.map(e => e.name).slice(0, 2).join(', ')
  const dates = q.startDate || q.estimatedEndDate
    ? `${q.startDate ? new Date(q.startDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '—'} → ${q.estimatedEndDate ? new Date(q.estimatedEndDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}`
    : 'Sans date'
  const linkedQuote = q.linkedQuote
  const hasAddress = Boolean(c.address_line1 || c.city)
  const contactTitle = q.contactName || 'Personne référente'
  const contactDescription = [q.contactPhone, q.contactEmail].filter(Boolean).join(' · ') || (q.canEditChantier ? 'Ajouter un contact' : 'Aucun contact')

  const menuItems: MenuItem[] = [
    { label: 'Rapport PDF', onSelect: () => setOverlay('report') },
    ...(q.canEditChantier ? [
      { label: 'Demander à Marco', onSelect: () => q.setShowAIAssistant(true) },
      { label: 'Modifier les détails', onSelect: () => setOverlay('details') },
      ...statusTransitions(actions.status).map(t => ({ label: t.label, onSelect: () => actions.changeStatus(t.to) })),
      { label: 'Dupliquer', onSelect: actions.duplicate },
    ] : []),
    ...(q.canDeleteChantier ? [{ label: 'Archiver le chantier', destructive: true, onSelect: () => actions.setConfirmArchive(true) }] : []),
  ]

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <button type="button" className={styles.back} onClick={() => q.router.replace('/chantiers')}>
          <ChevronLeft size={20} aria-hidden="true" />
          Chantiers
        </button>

        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{[clientName, c.city].filter(Boolean).join(' · ') || 'Chantier'}</p>
            <h1 className={screen.title}>{c.title}</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu
              title={c.title}
              items={menuItems}
              trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
            />
            {(q.canEditChantier || q.canCreateInvoice) && (
              <Button size="md" onClick={() => setOverlay('bill')}>Facturer</Button>
            )}
          </div>
        </header>
        {actions.error && <p className={screen.error} role="alert">{actions.error}</p>}

        <div className={fiche.layout}>
          <div className={fiche.left}>
            <section className={fiche.hero} aria-label="Avancement">
              <div className={fiche.heroTop}>
                <Ring percent={q.donePct} />
                <div className={fiche.next}>
                  <p className={fiche.nextLabel}>
                    {nextTask ? 'Prochaine étape' : q.taches.length ? 'Travaux terminés' : 'Aucune tâche'}
                    {' · '}
                    <StatusPill status={pill.status}>{pill.label}</StatusPill>
                  </p>
                  <p className={fiche.nextTitle}>{nextTask ? nextTask.title : q.taches.length ? 'Toutes les tâches sont faites' : 'Ajoutez les premières tâches'}</p>
                  <p className={fiche.nextSub}>{nextTask ? (nextWho ? `Assignée à ${nextWho}` : 'Non assignée') : `${q.tachesDone}${NB}/${NB}${q.tachesCount}${NB}tâches`}</p>
                </div>
              </div>
              <div className={fiche.stats}>
                <div className={fiche.stat}><span className={fiche.statKey}>Budget HT</span><span className={fiche.statValue}>{formatCurrency(c.budget_ht)}</span></div>
                <div className={fiche.stat}><span className={fiche.statKey}>Heures</span><span className={fiche.statValue}>{fmtHours(q.totalHours)}</span></div>
                <div className={fiche.stat}><span className={fiche.statKey}>Photos</span><span className={fiche.statValue}>{q.photos.length}</span></div>
              </div>
            </section>

            <ListGroup>
              {c.client && (
                <ListRow
                  leading={<Avatar name={clientName ?? 'Client'} />}
                  title={clientName ?? 'Client'}
                  description="Voir la fiche client"
                  href={`/clients/${c.client.id}`}
                />
              )}
              {hasAddress && (
                <li className={fiche.addressRow}>
                  <AddressLink address_line1={c.address_line1} postal_code={c.postal_code} city={c.city} className={fiche.addressLink} textClassName={fiche.addressText} />
                </li>
              )}
              {q.canEditChantier ? (
                <ListRow title={contactTitle} description={contactDescription} onClick={() => setOverlay('contact')} />
              ) : (
                <ListRow title={contactTitle} description={contactDescription} />
              )}
              <ListRow
                title="Détails du chantier"
                description={`${dates}${linkedQuote ? ` · devis ${linkedQuote.number ?? ''}` : ''}`}
                onClick={() => setOverlay('details')}
              />
            </ListGroup>
          </div>

          <div>
            <SegmentedControl
              fullWidth
              label="Sections du chantier"
              options={q.segments}
              value={q.activeSegment}
              onChange={v => q.setSegment(v as Segment)}
            />
            <div className={fiche.body}>
              {q.activeSegment === 'travaux' && <TravauxSegment q={q} />}
              {q.activeSegment === 'equipe' && <EquipeSegment q={q} />}
              {q.activeSegment === 'argent' && <ArgentSegment q={q} />}
              {q.activeSegment === 'photos' && <PhotosSegment q={q} />}
            </div>
          </div>
        </div>
      </div>

      {overlay === 'details' && <DetailsSheet q={q} onClose={() => setOverlay(null)} />}
      {overlay === 'contact' && <ContactSheet q={q} onClose={() => setOverlay(null)} />}
      {overlay === 'bill' && <BillSheet q={q} onClose={() => setOverlay(null)} />}
      {overlay === 'report' && <ReportSheet q={q} onClose={() => setOverlay(null)} />}

      {q.showAIAssistant && (
        <ChantierAIAssistant
          chantierId={c.id}
          chantierTitle={c.title}
          onClose={() => q.setShowAIAssistant(false)}
          onPlanningCreated={() => { q.setSegment('equipe'); q.router.refresh() }}
        />
      )}

      <ClientEmailRequiredModal
        open={q.reportEmailRequiredOpen}
        client={q.getReportClientEmailTarget()}
        documentLabel="le rapport de chantier"
        onCancel={() => q.setReportEmailRequiredOpen(false)}
        onSaved={q.handleReportClientEmailSaved}
      />
      <ClientEmailRequiredModal
        open={q.photosEmailRequiredOpen}
        client={q.getReportClientEmailTarget()}
        documentLabel="les photos du chantier"
        onCancel={() => q.setPhotosEmailRequiredOpen(false)}
        onSaved={q.handlePhotosClientEmailSaved}
      />

      <AlertDialog
        open={actions.confirmArchive}
        onOpenChange={actions.setConfirmArchive}
        title={`Archiver « ${c.title} » ?`}
        description="Le chantier sera archivé et n’apparaîtra plus dans la liste."
        confirmLabel="Archiver"
        confirmLoading={actions.pending}
        onConfirm={actions.archive}
      />
    </main>
  )
}
