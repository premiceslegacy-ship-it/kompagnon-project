'use client'
// @atelier-migrated

import { useState } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight, MoreHorizontal, Plus } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusPill } from '@/components/ui/StatusPill'
import { AI_NAME } from '@/lib/brand'
import type { GlobalPlanning } from '@/lib/data/queries/chantiers'
import TourneeView from './TourneeView'
import { AbsenceSheet, AiSheet, DuplicateSheet, IcalSheet, NewSlotSheet, SlotSheet } from './PlanningSheets'
import { fmtHours, fmtWeekLabel, getLocalDateStr, slotColor, slotDuration, slotHours, slotWhere } from './planningModel'
import { usePlanning, type PlanningProps } from './usePlanning'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import docs from '../../finances/Documents.module.css'
import planning from './Planning.module.css'

const NB = ' '
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const dayTitle = (d: Date) => cap(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))
const STATUSES = [['tous', 'Tous les statuts'], ['planifie', 'Planifié'], ['en_cours', 'En cours'], ['termine', 'Terminé'], ['suspendu', 'Suspendu']] as const

export default function PlanningGlobalClient(props: PlanningProps) {
  const q = usePlanning(props)
  const [slotId, setSlotId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<GlobalPlanning | null>(null)
  const view = q.effectiveView
  const single = view === 'jour' || view === 'tournee'
  const selectedStr = getLocalDateStr(q.selectedDate)
  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(q.weekStart); d.setDate(q.weekStart.getDate() + i); return d })
  const allWeek = weekDays.map(getLocalDateStr)
  const weekSlots = q.filteredPlannings.filter(p => allWeek.includes(p.planned_date))
  const byDayWeek = (ds: string) => weekSlots.filter(p => p.planned_date === ds).sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
  const slot = q.plannings.find(p => p.id === slotId) ?? null
  const hours = weekSlots.reduce((s, p) => s + slotDuration(p) * p.team_size, 0)
  const busiest = Object.entries(weekSlots.reduce<Record<string, number>>((a, p) => { a[p.planned_date] = (a[p.planned_date] ?? 0) + p.team_size; return a }, {})).sort(([, a], [, b]) => b - a)[0]
  const chantierLabel = q.filterChantier === 'tous' ? 'Tous les chantiers' : q.chantiers.find(c => c.id === q.filterChantier)?.title ?? 'Chantier'
  const statusLabel = STATUSES.find(([v]) => v === q.filterStatus)?.[1] ?? 'Statut'

  const menuItems: MenuItem[] = [
    ...(q.planningAiEnabled && q.canManage ? [{ label: q.checkingSarahBrief ? 'Vérification…' : `Planifier avec ${AI_NAME}`, onSelect: q.openAiModal, disabled: q.checkingSarahBrief }] : []),
    ...(q.canManage ? [{ label: 'Dupliquer la semaine', onSelect: q.openDuplicateWeek }] : []),
    ...(q.canManage && q.individualMembers.length > 0 ? [{ label: 'Déclarer une absence', onSelect: () => q.openAbsenceModal('', '') }] : []),
    ...(q.icalUrl ? [{ label: 'Synchroniser le calendrier', onSelect: () => q.setShowIcalModal(true) }] : []),
    { label: 'Heures pointées', onSelect: () => q.router.push('/chantiers/heures') },
  ]

  const empty = (title: string, description: string) => <EmptyState title={title} description={description} />

  const row = (p: GlobalPlanning) => (
    <ListRow
      key={p.id}
      leading={<span className={planning.time}>{p.start_time ? p.start_time.slice(0, 5) : '—'}</span>}
      title={p.label}
      description={`${slotWhere(p)}${p.member_name || p.equipe_name ? ` · ${p.member_name || p.equipe_name}` : ''}${p.team_size > 1 ? ` · ${p.team_size}${NB}pers.` : ''}`}
      trailing={<StatusPill status={p.arrived_at ? 'success' : 'neutral'}>{p.arrived_at ? 'Sur place' : slotHours(p)}</StatusPill>}
      onClick={() => setSlotId(p.id)}
    />
  )

  const dayBody = (ds: string) => {
    const xs = byDayWeek(ds)
    return xs.length ? <ListGroup>{xs.map(row)}</ListGroup> : empty('Aucun créneau ce jour', 'Planifiez les passages de vos équipes.')
  }

  const strip = (
    <div className={planning.strip} role="group" aria-label="Jours de la semaine">
      {weekDays.map(d => {
        const ds = getLocalDateStr(d)
        const n = byDayWeek(ds).length
        return (
          <button
            key={ds}
            type="button"
            className={planning.stripDay}
            aria-pressed={ds === selectedStr}
            data-today={ds === q.todayStr}
            aria-label={`${dayTitle(d)}${n ? `, ${n} créneau${n > 1 ? 'x' : ''}` : ''}`}
            onClick={() => q.setSelectedDate(d)}
          >
            <small>{d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}</small>
            <b>{d.getDate()}</b>
            <i data-has={n > 0} />
          </button>
        )
      })}
    </div>
  )

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{fmtWeekLabel(q.weekStart)}</p>
            <h1 className={screen.title}>Planning</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu title="Planning" items={menuItems} trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>} />
            {q.canManage && q.chantiers.length > 0 && (
              <>
                <Button size="md" className={styles.createWide} onClick={() => q.openNewSlotModal()}>Créneau</Button>
                <button type="button" className={styles.createRound} onClick={() => q.openNewSlotModal()} aria-label="Nouveau créneau"><Plus size={20} aria-hidden="true" /></button>
              </>
            )}
          </div>
        </header>

        {q.sarahInfoBanner && (
          <p className={screen.alert}>
            <span>{q.sarahInfoBanner} · Action déjà effectuée par {AI_NAME}, le planning est à jour.</span>
            <button type="button" className={styles.linkButton} onClick={() => q.setSarahInfoBanner(null)}>Fermer</button>
          </p>
        )}
        {q.actionError && <p className={screen.error} role="alert">{q.actionError}</p>}

        <div style={{ marginTop: 4 }}>
          <SegmentedControl
            fullWidth
            label="Vue du planning"
            options={[{ value: 'jour', label: 'Jour' }, { value: 'semaine', label: 'Semaine' }, { value: 'liste', label: 'Liste' }, { value: 'tournee', label: 'Tournée' }]}
            value={view}
            onChange={v => q.setViewMode(v as 'jour' | 'semaine' | 'liste' | 'tournee')}
          />
        </div>

        <div className={planning.nav}>
          <button type="button" className={screen.round} aria-label="Période précédente" onClick={q.prevDate}><ChevronLeft size={20} aria-hidden="true" /></button>
          <span className={planning.navLabel}>
            {single ? dayTitle(q.selectedDate) : fmtWeekLabel(q.weekStart)}
            {selectedStr !== q.todayStr && single || (!single && !allWeek.includes(q.todayStr)) ? <button type="button" className={planning.navToday} onClick={q.goToday}>Aujourd’hui</button> : null}
          </span>
          <button type="button" className={screen.round} aria-label="Période suivante" onClick={q.nextDate}><ChevronRight size={20} aria-hidden="true" /></button>
        </div>

        {(single || view === 'semaine') && <div className={view === 'semaine' ? planning.mobileOnly : undefined}>{strip}</div>}

        <div className={docs.chips}>
          <Menu
            title="Chantier"
            items={[{ id: 'tous', title: 'Tous les chantiers' }, ...q.chantiers.map(c => ({ id: c.id, title: `${c.title}${c.city ? ` · ${c.city}` : ''}` }))].map(o => ({ label: o.title, checked: q.filterChantier === o.id, onSelect: () => q.setFilterChantier(o.id) }))}
            trigger={<button type="button" className={docs.chip} data-on={q.filterChantier !== 'tous' ? 'true' : 'false'}>{chantierLabel}<ChevronDown size={14} aria-hidden="true" /></button>}
          />
          <Menu
            title="Statut"
            items={STATUSES.map(([v, l]) => ({ label: l, checked: q.filterStatus === v, onSelect: () => q.setFilterStatus(v) }))}
            trigger={<button type="button" className={docs.chip} data-on={q.filterStatus !== 'tous' ? 'true' : 'false'}>{statusLabel}<ChevronDown size={14} aria-hidden="true" /></button>}
          />
        </div>

        {view !== 'tournee' && weekSlots.length > 0 && (
          <p className={planning.stats}>
            {weekSlots.length} créneau{weekSlots.length > 1 ? 'x' : ''} · {fmtHours(hours)}{NB}prévues
            {busiest ? ` · ${cap(new Date(busiest[0] + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'long' }))} est le jour le plus chargé` : ''}
          </p>
        )}

        <div style={{ marginTop: 16 }}>
          {view === 'tournee' && (
            <TourneeView
              dayPlannings={q.filteredPlannings.filter(p => p.planned_date === selectedStr && p.source === 'chantier')}
              chantiers={q.chantiers}
              equipes={q.equipes}
              individualMembers={q.individualMembers}
              selectedDate={q.selectedDate}
              canManage={q.canManage}
              orgDepartureAddress={q.orgDepartureAddress}
              orgDeparturePostalCode={q.orgDeparturePostalCode}
              orgDepartureCity={q.orgDepartureCity}
              orgDepartureLatitude={q.orgDepartureLatitude}
              orgDepartureLongitude={q.orgDepartureLongitude}
              routeDepartures={q.routeDepartures}
              onPlanningsChange={updated => q.setPlannings(prev => [...prev.filter(p => p.planned_date !== selectedStr || p.source === 'maintenance'), ...updated])}
              onDeclareAbsent={q.canManage ? q.openAbsenceModal : undefined}
            />
          )}

          {view === 'jour' && dayBody(selectedStr)}

          {view === 'semaine' && (
            <>
              <div className={planning.week}>
                {weekDays.map(d => {
                  const ds = getLocalDateStr(d)
                  const xs = byDayWeek(ds)
                  return (
                    <div key={ds} className={planning.col} data-today={ds === q.todayStr}>
                      <div className={planning.colHead}>{d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', '')}<b>{d.getDate()}</b></div>
                      {xs.map(p => (
                        <button key={p.id} type="button" className={planning.slot} onClick={() => setSlotId(p.id)}>
                          <span>{p.start_time ? p.start_time.slice(0, 5) : 'Journée'}</span>
                          <b>{p.label}</b>
                          <span><i className={planning.dot} style={{ background: slotColor(p) }} />{slotWhere(p)}</span>
                        </button>
                      ))}
                      {xs.length === 0 && <span className={planning.free}>Libre</span>}
                    </div>
                  )
                })}
              </div>
              <div className={planning.mobileOnly}>{dayBody(selectedStr)}</div>
            </>
          )}

          {view === 'liste' && (weekSlots.length === 0 ? (
            empty('Aucun créneau cette semaine', 'Planifiez les passages de vos équipes sur vos chantiers.')
          ) : (
            <div className={styles.stack}>
              {weekDays.filter(d => byDayWeek(getLocalDateStr(d)).length > 0).map(d => (
                <ListGroup key={getLocalDateStr(d)} title={dayTitle(d)}>{byDayWeek(getLocalDateStr(d)).map(row)}</ListGroup>
              ))}
            </div>
          ))}
        </div>
      </div>

      {slot && <SlotSheet q={q} slot={slot} onClose={() => setSlotId(null)} onDelete={p => { setSlotId(null); setDeleting(p) }} />}
      <NewSlotSheet q={q} />
      <DuplicateSheet q={q} />
      <AbsenceSheet q={q} />
      <IcalSheet q={q} />
      <AiSheet q={q} />
      <AlertDialog
        open={deleting !== null}
        onOpenChange={o => { if (!o) setDeleting(null) }}
        title={`Supprimer « ${deleting?.label ?? ''} » ?`}
        description="Le créneau sera retiré du planning."
        confirmLabel="Supprimer"
        onConfirm={() => { if (deleting) q.handleDeletePlanning(deleting); setDeleting(null) }}
      />
    </main>
  )
}
