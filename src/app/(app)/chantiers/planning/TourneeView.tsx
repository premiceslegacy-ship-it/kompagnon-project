'use client'
// @atelier-migrated
// Tournée du jour : ordre de passage d'une équipe, trajets estimés, optimisation, feuille de route.

import { useState } from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { TourneeRouteMap } from '@/components/maps/TourneeRouteMap'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { DepartureSheet, SiteFormSheet, SiteSheet } from './TourneeSheets'
import { addMinutesToTime, fmtMin } from './tourneeModel'
import { useTournee, type TourneeProps } from './useTournee'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import docs from '../../finances/Documents.module.css'
import fiche from '../[chantierId]/ChantierFiche.module.css'
import planning from './Planning.module.css'

const NB = ' '
const hm = (t: string | null) => (t ? t.slice(0, 5).replace(':', 'h') : '—')

export default function TourneeView(props: TourneeProps) {
  const q = useTournee(props)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [reordering, setReordering] = useState(false)
  const slots = q.routeSlots
  const site = slots.find(s => s.id === siteId) ?? null
  const first = slots[0]
  const endTime = first?.start_time ? addMinutesToTime(first.start_time, q.summary.totalSiteMin + q.summary.totalTravelMin) : null

  if (slots.length === 0 && q.routeIds.length === 0 && q.pendingNewRouteId === null) {
    return (
      <>
        {q.canManage ? (
          <EmptyState
            title="Aucune tournée pour cette journée"
            description="Une tournée est l’ordre de passage d’une équipe sur la journée. Ajoutez les sites, réordonnez-les, puis exportez la feuille de route."
            actionLabel="Nouvelle tournée"
            onAction={q.handleNewRoute}
          />
        ) : (
          <EmptyState title="Aucune tournée pour cette journée" description="Une tournée est l’ordre de passage d’une équipe sur la journée." />
        )}
        {q.freeSlots.length > 0 && <FreeSlots q={q} />}
        <SiteFormSheet q={q} />
      </>
    )
  }

  return (
    <div className={styles.stack}>
      {q.routeIds.length > 1 && (
        <div className={docs.chips}>
          {q.routeIds.map((rid, i) => (
            <button key={rid} type="button" className={docs.chip} data-on={rid === q.effectiveRouteId ? 'true' : 'false'} onClick={() => { q.setActiveRouteId(rid); q.setLocalRouteSlots(null) }}>
              {q.routeGroups.get(rid)?.[0]?.label ?? `Tournée ${i + 1}`} · {q.routeGroups.get(rid)?.length ?? 0}
            </button>
          ))}
        </div>
      )}

      <section className={fiche.hero} aria-label="Résumé de la tournée">
        <p className={fiche.nextLabel}>{q.routeLabel}</p>
        <div className={fiche.stats} style={{ marginTop: 12 }}>
          <div className={fiche.stat}><span className={fiche.statKey}>Sites</span><span className={fiche.statValue}>{q.summary.count}</span></div>
          <div className={fiche.stat}><span className={fiche.statKey}>Sur site</span><span className={fiche.statValue}>{fmtMin(q.summary.totalSiteMin)}</span></div>
          <div className={fiche.stat}><span className={fiche.statKey}>Trajet</span><span className={fiche.statValue}>~{fmtMin(q.summary.totalTravelMin)}</span></div>
        </div>
        <p className={fiche.nextSub} style={{ marginTop: 10 }}>Départ {hm(q.summary.startTime)}{endTime ? ` · fin estimée ${hm(endTime)}` : ''}</p>
      </section>

      <ListGroup
        title="Ordre de passage"
        description={slots.length > 1 ? 'Les temps de trajet sont estimés d’après les codes postaux.' : undefined}
        action={slots.length > 1 && q.canManage ? <Button size="sm" variant="text" onClick={() => setReordering(v => !v)}>{reordering ? 'Terminé' : 'Réordonner'}</Button> : undefined}
      >
        {slots.map((s, i) => {
          const description = `${hm(s.start_time)}${s.end_time ? ` – ${hm(s.end_time)}` : ''} · ${[s.chantier_address_line1, s.chantier_city].filter(Boolean).join(', ') || s.label}${i > 0 && s.travel_from_prev_min != null ? ` · ~${fmtMin(s.travel_from_prev_min)} de trajet` : ''}`
          const lead = <span className={planning.time}>{i + 1}</span>
          if (reordering) {
            return (
              <ListRow
                key={s.id}
                leading={lead}
                title={`${s.chantier_title}`}
                description={description}
                trailing={
                  <span style={{ display: 'inline-flex' }}>
                    <button type="button" className={fiche.iconButton} aria-label="Monter" disabled={i === 0} onClick={() => q.moveStop(i, -1)}><ArrowUp size={18} aria-hidden="true" /></button>
                    <button type="button" className={fiche.iconButton} aria-label="Descendre" disabled={i === slots.length - 1} onClick={() => q.moveStop(i, 1)}><ArrowDown size={18} aria-hidden="true" /></button>
                  </span>
                }
              />
            )
          }
          return (
            <ListRow
              key={s.id}
              leading={lead}
              title={s.chantier_title}
              description={description}
              trailing={s.duration_min != null ? <span className={styles.amount}>{fmtMin(s.duration_min)}</span> : undefined}
              onClick={() => setSiteId(s.id)}
            />
          )
        })}
        {q.canManage && <ListRow title="Ajouter un site" className={fiche.linkRow} onClick={() => q.openAddModal()} />}
      </ListGroup>

      {q.canManage && (
        <ListGroup title="Préparer" description="La feuille de route PDF donne à l’équipe les adresses et les horaires.">
          {slots.length > 1 && <ListRow title={q.isOptimizing ? 'Optimisation…' : 'Optimiser l’ordre estimé'} description="Classe les sites par proximité" disabled={q.isOptimizing} onClick={q.handleOptimize} />}
          <ListRow title="Point de départ" description={q.hasDeparture ? [q.resolvedDepartureAddress, q.resolvedDeparturePostalCode, q.resolvedDepartureCity].filter(Boolean).join(' ') : 'Non renseigné'} onClick={q.openDepartureEditor} />
          <ListRow title="Dupliquer au lundi suivant" description="Même tournée, sept jours plus tard" onClick={() => q.setShowDuplicateConfirm(true)} />
          {q.effectiveRouteId && <ListRow title="Feuille de route PDF" href={`/api/pdf/tournee/${q.effectiveRouteId}?download=1`} />}
        </ListGroup>
      )}
      {!q.canManage && q.effectiveRouteId && (
        <ListGroup><ListRow title="Feuille de route PDF" href={`/api/pdf/tournee/${q.effectiveRouteId}?download=1`} /></ListGroup>
      )}

      {slots.length > 0 && <TourneeRouteMap slots={slots} departure={{ latitude: props.orgDepartureLatitude ?? null, longitude: props.orgDepartureLongitude ?? null }} />}

      {q.freeSlots.length > 0 && <FreeSlots q={q} />}

      {site && <SiteSheet q={q} slot={site} onClose={() => setSiteId(null)} />}
      <SiteFormSheet q={q} />
      <DepartureSheet q={q} />
      <AlertDialog
        open={q.showDuplicateConfirm}
        onOpenChange={q.setShowDuplicateConfirm}
        title="Dupliquer la tournée ?"
        description="Les sites sont recopiés au même jour, la semaine suivante."
        confirmLabel="Dupliquer"
        confirmLoading={q.isDuplicating}
        onConfirm={q.handleDuplicate}
      />
    </div>
  )
}

function FreeSlots({ q }: { q: ReturnType<typeof useTournee> }) {
  return (
    <ListGroup title="Créneaux hors tournée ce jour" description={q.canManage ? 'Touchez un créneau pour l’ajouter à la tournée.' : undefined}>
      {q.freeSlots.map(s => (
        q.canManage && s.chantier_id
          ? <ListRow key={s.id} title={s.chantier_title} description={`${hm(s.start_time)}${s.end_time ? ` – ${hm(s.end_time)}` : ''} · ${s.label}`} onClick={() => q.handleMoveExistingSlotToRoute(s)} />
          : <ListRow key={s.id} title={s.chantier_title} description={`${hm(s.start_time)}${s.end_time ? ` – ${hm(s.end_time)}` : ''} · ${s.label}`} />
      ))}
    </ListGroup>
  )
}
