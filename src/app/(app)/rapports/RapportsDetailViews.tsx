'use client'
// @atelier-migrated
// Rapports : les détails Rentabilité, Activité, Entretien, Heures, Clients et chantiers.

import Link from 'next/link'
import { useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import {
  deltaText, delta, fmt, fmtH, fmtPct, marginTone, maintenanceFigures, membersWithoutRateTitle, ratio, weightedMargin,
} from './rapportsModel'
import type { RapportsState } from './useRapports'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Rapports.module.css'

function Hero({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <section className={local.hero}>
      <p className={local.heroLabel}>{label}</p>
      <p className={local.heroValue}>{value}</p>
      {note && <p className={local.heroNote}>{note}</p>}
    </section>
  )
}

const money = (n: number, show = true) => <span className={local.value}>{show ? fmt(n) : '-'}</span>

export function RentabiliteView({ q }: { q: RapportsState }) {
  const r = q.report
  if (!r) return <p className={styles.hint}>Aucune donnée pour cette période.</p>
  const billed = q.isVatSubject ? 'Facturé HT' : 'Facturé'
  const collected = q.isVatSubject ? 'Encaissé TTC' : 'Encaissé'
  const marginRatio = ratio(r.beneficeEstime, r.caHt)
  const periodWord = q.vue === 'mois' ? 'ce mois-ci' : 'cette année'
  return (
    <div className={local.stack}>
      <Hero label="Bénéfice réel" value={r.hasCostData ? fmt(r.beneficeEstime) : '-'} note={r.hasCostData ? `${fmtPct(marginRatio)} · facturé HT moins dépenses et main-d’œuvre réelles` : `Aucun coût réel saisi ${periodWord}`} />
      {r.costsLikelyIncomplete && (
        <p className={local.notice} role="status">
          <strong>Coûts probablement incomplets {periodWord}.</strong> Les dépenses et heures saisies pèsent moins de 5 % du facturé : « bénéfice réel » et « trésorerie nette » sont sans doute surestimés. Pensez à enregistrer le matériel acheté et les heures pointées.
        </p>
      )}
      <ListGroup>
        <ListRow title={billed} description={q.isVatSubject && r.caTtc > 0 ? `${fmt(r.caTtc)} TTC facturé` : 'Factures émises, non forcément encaissées'} trailing={money(r.caHt, r.caHt > 0)} />
        <ListRow title={collected} description={q.isVatSubject && r.encaisse > 0 ? `dont ${fmt(r.encaisseTva)} de TVA · ${fmt(r.encaisseHt)} HT` : 'Paiements enregistrés'} trailing={money(r.encaisse, r.encaisse > 0)} />
        <ListRow title="Trésorerie nette" description={r.hasCostData ? 'Encaissé moins TVA à reverser et coûts, avant URSSAF et impôts' : `Aucun coût réel saisi ${periodWord}`} trailing={money(r.tresorerieNette, r.hasCostData)} />
        <ListRow title="Marge théorique" description={r.hasProjectedCostData ? `${fmtPct(r.projectedMarginPct)} · d’après les prix de revient des lignes facturées` : 'Aucun prix de revient saisi'} trailing={money(r.projectedMarginHt, r.hasProjectedCostData)} />
      </ListGroup>
      <p className={styles.hint} style={{ margin: '0 16px' }}>
        « Bénéfice réel » se base sur les dépenses et heures saisies sur vos chantiers. « Marge théorique » se base sur le prix de revient de chaque ligne facturée, indépendamment des dépenses réellement saisies.
      </p>
      {q.membersWithoutRate.length > 0 && (
        <ListGroup title={membersWithoutRateTitle(q.membersWithoutRate.length)} description="Leurs heures ne sont pas valorisées : le coût de main-d’œuvre est sous-estimé dans le bénéfice.">
          {q.membersWithoutRate.map(m => (
            <ListRow key={`${m.memberId ?? m.userId ?? m.personName}`} title={m.personName} description={`${m.hoursTotal % 1 === 0 ? m.hoursTotal : m.hoursTotal.toFixed(1)} h pointées`} href="/chantiers/heures" />
          ))}
        </ListGroup>
      )}
    </div>
  )
}

export function ActiviteView({ q }: { q: RapportsState }) {
  const m = q.monthlyReport
  const a = q.annualReport
  const r = q.report
  if (!r) return <p className={styles.hint}>Aucune donnée pour cette période.</p>
  const hoursDelta = m ? deltaText(delta(m.heuresTotal, m.prevHeuresTotal)) : null
  return (
    <div className={local.stack}>
      <ListGroup title="Sur la période">
        <ListRow title="Chantiers terminés" trailing={<span className={local.value}>{r.chantiersTermines || '-'}</span>} />
        {m && <ListRow title="Chantiers en cours" description={m.chantiersEnCoursIsSnapshot ? 'Statut d’aujourd’hui, pas un historique de ce mois' : undefined} trailing={<span className={local.value}>{m.chantiersEnCours || '-'}</span>} />}
        {a && <ListRow title="Nouveaux clients" trailing={<span className={local.value}>{a.nouveauxClients || '-'}</span>} />}
        <ListRow title="Heures travaillées" description={hoursDelta ?? undefined} trailing={<span className={local.value}>{r.heuresTotal > 0 ? fmtH(r.heuresTotal) : '-'}</span>} />
        <ListRow title={q.isVatSubject ? 'TVA facturée' : 'TVA non applicable'} trailing={<span className={local.value}>{q.isVatSubject && r.tvaDue > 0 ? fmt(r.tvaDue) : '-'}</span>} />
      </ListGroup>
      {m && (
        <ListGroup title="Facturation périodique" description="Contrats récurrents à facturer ou déjà générés ce mois.">
          <ListRow title="Contrats à facturer" description={m.recurringExpectedHt > 0 ? `${fmt(m.recurringExpectedHt)} HT prévu ce mois` : 'Aucune facture de période à générer'} trailing={<span className={local.value}>{m.recurringContractsDue || '-'}</span>} />
          <ListRow title="Déjà générées" description="Factures de période déjà émises" trailing={money(m.recurringBilledHt, m.recurringBilledHt > 0)} />
        </ListGroup>
      )}
    </div>
  )
}

export function EntretienView({ q }: { q: RapportsState }) {
  const mr = q.maintenanceReport
  if (!mr) return <p className={styles.hint}>Aucune donnée d’entretien pour cette période.</p>
  const f = maintenanceFigures(mr)
  const tone = marginTone(f.actualMarginPct)
  const hasExpected = mr.expectedRevenueHt > 0 || mr.expectedCostHt > 0
  return (
    <div className={local.stack}>
      {f.actualCost > 0 ? (
        <Hero label="Marge des contrats" value={mr.revenueHt > 0 ? fmtPct(f.actualMarginPct) : '-'} note={hasExpected ? `Prévu ${fmtPct(f.expectedMarginPct)}, réel ${fmtPct(f.actualMarginPct)}` : undefined} />
      ) : (
        <p className={styles.hint} style={{ margin: '0 16px' }}>Aucun coût réel saisi sur la période : la marge s’affichera dès qu’une heure ou une dépense est enregistrée.</p>
      )}
      {f.actualCost > 0 && (
        <div className={local.track} role="img" aria-label={`Marge réelle ${fmtPct(f.actualMarginPct)}`}>
          <i className={local.fill} data-tone={tone === 'wait' ? undefined : tone} style={{ width: `${Math.max(0, Math.min(100, f.actualMarginPct * 100))}%` }} />
        </div>
      )}
      <ListGroup title="Sur la période">
        <ListRow title="Interventions" trailing={<span className={local.value}>{mr.interventionsDone || '-'}</span>} />
        <ListRow title="Heures d’entretien" description={mr.laborCost > 0 ? `${fmt(mr.laborCost)} de coût de main-d’œuvre` : undefined} trailing={<span className={local.value}>{mr.hoursTotal > 0 ? fmtH(mr.hoursTotal) : '-'}</span>} />
        <ListRow title="Facturé HT" description="Factures émises sur la période" trailing={money(mr.revenueHt, mr.revenueHt > 0)} />
        <ListRow title="Encaissé HT" description={mr.revenueHt > 0 && mr.encaisseHt < mr.revenueHt ? `${fmt(mr.revenueHt - mr.encaisseHt)} en attente` : 'Factures marquées payées'} trailing={money(mr.encaisseHt, mr.encaisseHt > 0)} />
        {f.actualCost > 0 && <ListRow title="Coûts terrain" description={`Pièces ${fmt(mr.partsCost)} · déplacement ${fmt(mr.travelCost)} · autres dépenses du chantier support`} trailing={money(f.fieldCost)} />}
        {f.actualCost > 0 && <ListRow title="Marge estimée" description={mr.revenueHt > 0 ? `${fmtPct(f.actualMarginPct)} après coûts terrain et main-d’œuvre` : undefined} trailing={money(mr.marginEur, mr.marginEur > 0)} />}
      </ListGroup>
      {hasExpected && (
        <ListGroup title="Prévu par cycle de contrat" description="Un cycle complet du contrat (par exemple un trimestre), pas ramené au mois affiché : le prévu et le réel ne sont pas directement comparables si le cycle ne correspond pas à un mois.">
          <ListRow title="Chiffre d’affaires prévu" description="Montant contractuel" trailing={money(mr.expectedRevenueHt, mr.expectedRevenueHt > 0)} />
          <ListRow title="Coût prévu" description="Référence du catalogue d’entretien" trailing={money(mr.expectedCostHt, mr.expectedCostHt > 0)} />
          <ListRow title="Marge prévue" description={`${fmtPct(f.expectedMarginPct)} prévu`} trailing={money(mr.expectedMarginHt)} />
        </ListGroup>
      )}
      <ListGroup>
        <ListRow title="Voir les contrats" href="/chantiers/entretien" />
      </ListGroup>
    </div>
  )
}

export function HeuresView({ q }: { q: RapportsState }) {
  const h = q.hoursReport
  return (
    <div className={local.stack}>
      <Hero label="Total sur la période" value={h && h.total > 0 ? fmtH(h.total) : '-'} />
      <ListGroup title="Par personne" description={h && h.byPerson.length === 0 ? undefined : 'Part des heures de la période.'}>
        {(!h || h.byPerson.length === 0) && <ListRow title="Aucune heure pointée sur cette période" />}
        {h?.byPerson.map(p => (
          <ListRow
            key={`${p.memberId ?? p.userId ?? p.personName}`}
            leading={<Avatar name={p.personName} size={40} />}
            title={p.personName}
            description={`${h.total > 0 ? Math.round((p.hours / h.total) * 100) : 0} % du total`}
            trailing={<span className={local.value}>{fmtH(p.hours)}</span>}
          />
        ))}
      </ListGroup>
      <ListGroup>
        <ListRow title="Détail des heures et rapports PDF" description="Par personne ou par chantier, pointages à corriger" href="/chantiers/heures" />
      </ListGroup>
    </div>
  )
}

export function ClassementsView({ q }: { q: RapportsState }) {
  const [pickedId, setPickedId] = useState('')
  const billed = q.isVatSubject ? 'Facturé HT' : 'Facturé'
  const collected = q.isVatSubject ? 'Encaissé TTC' : 'Encaissé'
  const chantiers = q.topChantiers
  const average = weightedMargin(chantiers)
  const picked = chantiers.find(c => c.chantierId === pickedId) ?? chantiers[0] ?? null
  const bestChantiers = [...chantiers].sort((a, b) => b.marginEur - a.marginEur).slice(0, 10)
  const tone = picked ? marginTone(picked.marginPct) : 'wait'
  const pill = (t: typeof tone) => (t === 'wait' ? 'wait' : t)
  return (
    <div className={local.stack}>
      <ListGroup title="Meilleurs clients" description="Classés par facturé sur la période.">
        {q.topClients.length === 0 && <ListRow title="Aucune donnée pour cette période" />}
        {q.topClients.slice(0, 10).map((c, i) => (
          <ListRow key={c.clientId} leading={<span className={local.rank}>{i + 1}</span>} title={c.clientName}
            description={`Marge ${fmt(c.marginEur)}${c.chantiersCount > 0 ? ` · ${c.chantiersCount} chantier${c.chantiersCount > 1 ? 's' : ''}` : ''}`}
            trailing={<span className={local.value}>{fmt(c.caHt)}</span>} href={`/clients/${c.clientId}`} />
        ))}
      </ListGroup>
      <ListGroup title="Meilleurs chantiers" description="Classés par marge HT encaissée.">
        {bestChantiers.length === 0 && <ListRow title="Aucune donnée pour cette période" />}
        {bestChantiers.map((c, i) => (
          <ListRow key={c.chantierId} leading={<span className={local.rank}>{i + 1}</span>} title={c.chantierTitle}
            description={[c.clientName, `${billed} ${fmt(c.caHt)}`, `Marge HT ${fmtPct(c.marginPct)}`].filter(Boolean).join(' · ')}
            trailing={<span className={`${local.value} ${c.marginEur >= 0 ? local.good : local.bad}`}>{fmt(c.marginEur)}</span>} href={`/chantiers/${c.chantierId}`} />
        ))}
      </ListGroup>
      {picked && (
        <div>
          <p className={styles.hint} style={{ margin: '0 16px 8px' }}>Marge par chantier</p>
          <div className={styles.fields}>
            <Field type="select" label="Chantier" value={picked.chantierId} onChange={e => setPickedId(e.target.value)}>
              {[...chantiers].sort((a, b) => a.chantierTitle.localeCompare(b.chantierTitle, 'fr')).map(c => <option key={c.chantierId} value={c.chantierId}>{c.chantierTitle}</option>)}
            </Field>
          </div>
          <ListGroup description={`Moyenne pondérée de tous les chantiers : ${fmtPct(average)}.`}>
            <ListRow title={picked.chantierTitle} description={picked.clientName ?? undefined} href={`/chantiers/${picked.chantierId}`} trailing={<StatusPill status={pill(tone)}>{fmtPct(picked.marginPct)}</StatusPill>} />
            <ListRow title={billed} trailing={<span className={local.value}>{fmt(picked.caHt)}</span>} />
            <ListRow title={collected} trailing={<span className={local.value}>{fmt(picked.encaisseTtc)}</span>} />
            <ListRow title="Marge HT" trailing={<span className={local.value}>{fmt(picked.marginEur)}</span>} />
          </ListGroup>
        </div>
      )}
      <p className={styles.hint} style={{ margin: '0 16px' }}><Link href="/clients">Tous les clients</Link> · <Link href="/chantiers">Tous les chantiers</Link></p>
    </div>
  )
}

