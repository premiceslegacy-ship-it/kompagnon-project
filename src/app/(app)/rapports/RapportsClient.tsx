'use client'
// @atelier-migrated
// Rapports : synthèse de la période (trois chiffres clés, évolution), puis un écran de détail par domaine.

import dynamic from 'next/dynamic'
import { ChevronLeft, ChevronRight, FileText, MoreHorizontal } from 'lucide-react'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SplitBar } from '@/components/ui/SplitBar'
import { StatTile } from '@/components/ui/StatTile'
import ObjectifsView from './ObjectifsView'
import { ActiviteView, ClassementsView, EntretienView, HeuresView, RentabiliteView } from './RapportsDetailViews'
import { canGoNext, delta, deltaText, fmt, hasMaintenanceData, pdfHref, periodLabel, periodShort, type Period } from './rapportsModel'
import { useRapports, type RapportDetail, type RapportsProps, type RapportsState } from './useRapports'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Rapports.module.css'

const RevenueChart = dynamic(() => import('./RevenueChart'), { ssr: false })

const DETAILS: Array<{ id: RapportDetail; title: string; description: string }> = [
  { id: 'renta', title: 'Rentabilité', description: 'Ce que vous gardez une fois les coûts déduits' },
  { id: 'activite', title: 'Activité', description: 'Chantiers, clients, heures, facturation périodique' },
  { id: 'entretien', title: 'Entretien', description: 'Marge des contrats récurrents' },
  { id: 'objectifs', title: 'Objectifs', description: 'Annuels et mensuels' },
  { id: 'heures', title: 'Heures', description: 'Par personne' },
  { id: 'top', title: 'Clients et chantiers', description: 'Les meilleurs, marge par chantier' },
]

const VIEW: Record<RapportDetail, (props: { q: RapportsState }) => React.ReactNode> = {
  renta: RentabiliteView, activite: ActiviteView, entretien: EntretienView, objectifs: ObjectifsView, heures: HeuresView, top: ClassementsView,
}

/** Les détails portent leur propre état : ils sont rendus comme composants, jamais appelés comme fonctions. */
function DetailView({ id, q }: { id: RapportDetail; q: RapportsState }) {
  const View = VIEW[id]
  return <View q={q} />
}

function PeriodBar({ q }: { q: RapportsState }) {
  const p: Period = q.period
  return (
    <div className={local.periodBar}>
      <button type="button" className={screen.round} onClick={q.goPrevious} aria-label="Période précédente"><ChevronLeft size={20} aria-hidden="true" /></button>
      <span className={local.periodLabel} aria-live="polite">{periodShort(p)}</span>
      <button type="button" className={screen.round} onClick={q.goNext} disabled={!canGoNext(p)} aria-label="Période suivante"><ChevronRight size={20} aria-hidden="true" /></button>
    </div>
  )
}

function Figure({ label, value, previous, current, extra, inProgress }: { label: string; value: string; previous?: number; current: number; extra?: string; inProgress?: boolean }) {
  const d = previous === undefined ? null : delta(current, previous, inProgress)
  const text = d ? deltaText(d) : null
  return (
    <StatTile label={label} value={value} detail={(text || extra) && <span className={local.delta} data-kind={d && (d.kind === 'up' || d.kind === 'down') ? d.kind : undefined}>{text ?? extra}</span>} />
  )
}

export default function RapportsClient(props: RapportsProps) {
  const q = useRapports(props)
  const r = q.report
  const billed = q.isVatSubject ? 'Facturé HT' : 'Facturé'
  const collected = q.isVatSubject ? 'Encaissé TTC' : 'Encaissé'
  const open = q.detail
  const current = DETAILS.find(d => d.id === open)
  const menu = [
    { label: 'Rapport PDF de la période', onSelect: () => { window.location.href = pdfHref(q.period) } },
    ...(q.vue === 'mois' ? [{ label: `Rapport PDF de l’année ${q.year}`, onSelect: () => { window.location.href = pdfHref({ ...q.period, vue: 'annee' }) } }] : []),
  ]
  const details = DETAILS.filter(d => d.id !== 'entretien' || hasMaintenanceData(q.maintenanceReport))

  return (
    <main className={`${screen.root} ${q.loading ? local.loading : ''}`} aria-busy={q.loading || undefined}>
      <div className={screen.page}>
        {open && current && (
          <button type="button" className={styles.back} onClick={() => q.openDetail(null)}>
            <ChevronLeft size={20} aria-hidden="true" />
            Rapports
          </button>
        )}
        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{open ? 'Rapports' : periodLabel(q.period)}</p>
            <h1 className={screen.title}>{current ? current.title : 'Rapports'}</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu title="Rapports" items={menu} trigger={<button type="button" className={screen.round} aria-label="Plus d’options"><MoreHorizontal size={20} aria-hidden="true" /></button>} />
          </div>
        </header>

        <SegmentedControl label="Période" fullWidth value={q.vue} onChange={v => q.switchVue(v as 'mois' | 'annee')} options={[{ value: 'mois', label: 'Mois' }, { value: 'annee', label: 'Année' }]} />
        <PeriodBar q={q} />

        {open && current ? (
          <DetailView id={open} q={q} />
        ) : (
          <div className={local.stack}>
            {r?.costsLikelyIncomplete && (
              <p className={local.notice} role="status"><strong>Coûts probablement incomplets.</strong> Les dépenses et heures saisies pèsent moins de 5 % du facturé : le bénéfice est sans doute surestimé.</p>
            )}
            {!r ? (
              <p className={styles.hint} style={{ margin: '0 16px' }}>Aucune donnée pour cette période.</p>
            ) : (
              <div className={local.kpis}>
                <Figure label={billed} value={r.caHt > 0 ? fmt(r.caHt) : '-'} current={r.caHt} previous={r.prevCaHt} inProgress={!canGoNext(q.period)} />
                <Figure label={collected} value={r.encaisse > 0 ? fmt(r.encaisse) : '-'} current={r.encaisse} previous={r.prevEncaisse} inProgress={!canGoNext(q.period)} />
                <Figure label="Bénéfice réel" value={r.hasCostData ? fmt(r.beneficeEstime) : '-'} current={r.beneficeEstime} extra={r.hasCostData ? undefined : 'Aucun coût réel saisi'} />
              </div>
            )}
            {r && r.hasCostData && r.caHt > 0 && (
              <section className={local.chartCard} aria-labelledby="rapports-repartition">
                <h2 id="rapports-repartition" className={local.chartTitle}>Où va le facturé</h2>
                <p className={local.chartNote}>Sur {fmt(r.caHt)} facturés, ce qui reste après les coûts réels.</p>
                <SplitBar
                  label="Répartition du facturé"
                  segments={[
                    { key: 'benefice', label: 'Bénéfice', value: Math.max(0, r.beneficeEstime), tone: 'success', display: fmt(Math.max(0, r.beneficeEstime)) },
                    { key: 'labor', label: 'Main-d’œuvre', value: r.laborCost, tone: 'info', display: fmt(r.laborCost) },
                    { key: 'expenses', label: 'Dépenses', value: r.expensesCost, tone: 'accent', display: fmt(r.expensesCost) },
                  ]}
                />
              </section>
            )}
            {q.vue === 'annee' && q.annualReport && <RevenueChart series={q.annualReport.series} prevSeries={q.annualReport.prevSeries} />}
            <ListGroup title="Voir le détail">
              {details.map(d => <ListRow key={d.id} title={d.title} description={d.description} onClick={() => q.openDetail(d.id)} />)}
            </ListGroup>
            <ListGroup>
              <ListRow title="Rapport PDF de la période" leading={<FileText size={20} aria-hidden="true" />} href={pdfHref(q.period)} />
            </ListGroup>
          </div>
        )}
      </div>
    </main>
  )
}
