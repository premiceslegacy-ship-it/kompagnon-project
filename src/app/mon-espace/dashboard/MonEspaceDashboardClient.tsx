'use client'

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { IndividualMember, MemberPointage, MemberPlanning, MemberTask } from '@/lib/data/queries/members'
import type { MemberGoalWithProgress } from '@/lib/data/queries/member-goals'
import {
  pointMyHoursFromSpace,
  sendMyHoursReportFromSpace,
  logoutFromMonEspace,
  updateMyTaskFromSpace,
  uploadPhotoFromSpace,
  setPlanningArrivedAtFromSpace,
} from '@/lib/data/mutations/members'
import { declareMyAbsenceFromSpace, type ConflictingSlot } from '@/lib/data/mutations/absences'
import { useMemberPushNotifications } from '@/lib/hooks/use-member-push-notifications'
import { compressImageToJpeg } from '@/lib/images/compress'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Field } from '@/components/ui/Field'
import { Hud } from '@/components/ui/Hud'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { Sheet } from '@/components/ui/Sheet'
import { StatTile } from '@/components/ui/StatTile'
import { StatusPill } from '@/components/ui/StatusPill'
import { PublicError, PublicPage } from '@/components/public/PublicPage'

const MAX_MEMBER_PHOTO_SIZE = 10 * 1024 * 1024 // 10 Mo

type ChantierStub = { id: string; title: string }

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function getLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, '0')}`
}

function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

function getPlanningHours(planning: MemberPlanning): number | null {
  if (planning.duration_min != null && planning.duration_min > 0) {
    return Math.round((planning.duration_min / 60) * 10) / 10
  }
  if (!planning.start_time || !planning.end_time) return null
  const [sh, sm] = planning.start_time.split(':').map(Number)
  const [eh, em] = planning.end_time.split(':').map(Number)
  if ([sh, sm, eh, em].some(n => Number.isNaN(n))) return null
  const hours = (eh + em / 60) - (sh + sm / 60)
  return hours > 0 ? Math.round(hours * 10) / 10 : null
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function longDay(iso: string): string {
  return capitalize(new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }))
}

function shortDay(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' })
}

function planningAddress(p: MemberPlanning): string {
  return [p.chantier_address_line1, p.chantier_postal_code, p.chantier_city].filter(Boolean).join(', ')
}

function mapsUrlFor(address: string): string | null {
  return address ? `https://maps.google.com/maps?q=${encodeURIComponent(address)}` : null
}

function timeRange(p: MemberPlanning): string {
  if (!p.start_time) return 'Heure libre'
  return p.end_time ? `${p.start_time.slice(0, 5)} – ${p.end_time.slice(0, 5)}` : p.start_time.slice(0, 5)
}

function goalLabel(goal: MemberGoalWithProgress): string {
  if (goal.label) return goal.label
  if (goal.metric === 'heures_terrain') return 'Heures terrain'
  if (goal.metric === 'taches_completees') return 'Tâches complétées'
  if (goal.metric === 'chantiers_traites') return 'Chantiers traités'
  return 'Objectif'
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count > 1 ? pluralForm : singular}`
}

export default function MonEspaceDashboardClient({
  member,
  organizationName,
  pointages,
  plannings,
  tasks: initialTasks,
  chantiers,
  monthStart,
  monthEnd,
  icalUrl,
  memberGoals,
  upcomingInterventions = [],
  upcomingAbsences = [],
}: {
  member: IndividualMember
  organizationName: string
  pointages: MemberPointage[]
  plannings: MemberPlanning[]
  tasks: MemberTask[]
  chantiers: ChantierStub[]
  monthStart: string
  monthEnd: string
  icalUrl: string
  memberGoals: MemberGoalWithProgress[]
  upcomingInterventions?: Array<{
    id: string
    date_intervention: string
    statut: string
    start_time: string | null
    end_time: string | null
    duration_hours: number | null
    rapport: string | null
    observations: string | null
    contract: { id: string; title: string; frequence: string } | null
  }>
  upcomingAbsences?: Array<{
    id: string
    start_date: string
    end_date: string
    reason: string | null
  }>
}) {
  const router = useRouter()
  const fullName = [member.prenom, member.name].filter(Boolean).join(' ') || member.name
  const [hud, setHud] = useState<string | null>(null)

  const { requestSubscription } = useMemberPushNotifications()
  const [pushState, setPushState] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported'>(() => {
    if (typeof window === 'undefined') return 'idle'
    if (!('Notification' in window)) return 'unsupported'
    return Notification.permission === 'granted' ? 'granted' : Notification.permission === 'denied' ? 'denied' : 'idle'
  })
  async function handleEnablePush() {
    setPushState('requesting')
    await requestSubscription()
    setPushState(typeof window !== 'undefined' && 'Notification' in window ? (Notification.permission === 'granted' ? 'granted' : 'denied') : 'unsupported')
  }

  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)
  const [tasks, setTasks] = useState(initialTasks)
  const [taskLoadingId, setTaskLoadingId] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [openTask, setOpenTask] = useState<MemberTask | null>(null)

  // Pointage
  const [showPoint, setShowPoint] = useState(false)
  const today = getLocalDateStr(new Date())
  const [pChantier, setPChantier] = useState(chantiers[0]?.id ?? '')
  const [pDate, setPDate]         = useState(today)
  const [pHours, setPHours]       = useState('')
  const [pStartTime, setPStart]   = useState('')
  const [pDescription, setPDesc]  = useState('')
  const [pSaving, setPSaving]     = useState(false)
  const [pError, setPError]       = useState<string | null>(null)
  const [arrivals, setArrivals] = useState<Record<string, string>>({})
  const [quickSavingId, setQuickSavingId] = useState<string | null>(null)
  const [quickError, setQuickError] = useState<string | null>(null)
  const [slotSavingId, setSlotSavingId] = useState<string | null>(null)
  const [openSlot, setOpenSlot] = useState<MemberPlanning | null>(null)
  const [, setLogoutLoading] = useState(false)

  // Absence
  const [showAbsence, setShowAbsence] = useState(false)
  const [absenceStart, setAbsenceStart] = useState(today)
  const [absenceEnd, setAbsenceEnd] = useState(today)
  const [absenceReason, setAbsenceReason] = useState('')
  const [absenceSaving, setAbsenceSaving] = useState(false)
  const [absenceError, setAbsenceError] = useState<string | null>(null)
  const [absenceConflicts, setAbsenceConflicts] = useState<ConflictingSlot[] | null>(null)

  const handleDeclareAbsence = async () => {
    setAbsenceError(null)
    if (!absenceStart || !absenceEnd) { setAbsenceError('Indiquez une date de début et de fin.'); return }
    if (absenceEnd < absenceStart) { setAbsenceError('La date de fin doit être après la date de début.'); return }

    setAbsenceSaving(true)
    const { error, conflictingSlots } = await declareMyAbsenceFromSpace({
      startDate: absenceStart,
      endDate: absenceEnd,
      reason: absenceReason.trim() || null,
    })
    setAbsenceSaving(false)
    if (error) { setAbsenceError(error); return }

    setAbsenceConflicts(conflictingSlots ?? [])
    router.refresh()
  }

  const openAbsenceForm = (date = today) => {
    setAbsenceStart(date)
    setAbsenceEnd(date)
    setShowAbsence(true)
  }

  const closeAbsenceForm = () => {
    setShowAbsence(false)
    setAbsenceReason('')
    setAbsenceConflicts(null)
    setAbsenceError(null)
  }

  const handlePoint = async () => {
    setPError(null)
    const h = parseFloat(pHours.replace(',', '.'))
    if (!pChantier) { setPError('Choisissez un chantier.'); return }
    if (isNaN(h) || h <= 0 || h > 24) { setPError('Indiquez un nombre d’heures entre 0 et 24.'); return }
    setPSaving(true)
    const { error } = await pointMyHoursFromSpace({
      chantierId: pChantier,
      date: pDate,
      hours: h,
      startTime: pStartTime || null,
      description: pDescription.trim() || null,
    })
    setPSaving(false)
    if (error) { setPError(error); return }
    setShowPoint(false)
    setPHours(''); setPDesc(''); setPStart('')
    setHud(`${fmtHours(h)} pointées`)
    router.refresh()
  }

  // Photo
  const [showPhotoForm, setShowPhotoForm] = useState(false)
  const [phChantier, setPhChantier] = useState(chantiers[0]?.id ?? '')
  const [phFile, setPhFile] = useState<File | null>(null)
  const [phCaption, setPhCaption] = useState('')
  const [phSaving, setPhSaving] = useState(false)
  const [phError, setPhError] = useState<string | null>(null)
  const photoInputRef = useRef<HTMLInputElement>(null)

  const closePhotoForm = () => {
    setShowPhotoForm(false)
    setPhFile(null)
    setPhCaption('')
    setPhError(null)
  }

  const handleUploadPhoto = async () => {
    setPhError(null)
    if (!phChantier) { setPhError('Choisissez un chantier.'); return }
    if (!phFile) { setPhError('Choisissez ou prenez une photo.'); return }
    if (phFile.size > MAX_MEMBER_PHOTO_SIZE) { setPhError('Photo trop volumineuse (10 Mo maximum).'); return }

    setPhSaving(true)
    let file: File
    try {
      file = await compressImageToJpeg(phFile)
    } catch (err) {
      setPhSaving(false)
      setPhError(err instanceof Error ? err.message : 'Photo illisible, réessayez avec un autre format.')
      return
    }
    const fd = new FormData()
    fd.append('file', file)
    fd.append('chantierId', phChantier)
    if (phCaption.trim()) fd.append('caption', phCaption.trim())

    const { error } = await uploadPhotoFromSpace(fd)
    setPhSaving(false)
    if (error) { setPhError(error); return }

    closePhotoForm()
    setHud('Photo envoyée au chantier')
    router.refresh()
  }

  const handleRouteArrival = (planningId: string) => {
    setQuickError(null)
    setArrivals(prev => ({ ...prev, [planningId]: new Date().toISOString() }))
    // Persistance et notification des responsables en arrière-plan : ne bloque pas l'affichage.
    setPlanningArrivedAtFromSpace(planningId).then(({ error }) => {
      if (error) setQuickError(`Arrivée non synchronisée : ${error}`)
    })
  }

  const handleRouteDeparture = async (planning: MemberPlanning) => {
    const arrivedAtIso = arrivals[planning.id]
    if (!arrivedAtIso) return
    const arrivedAt = new Date(arrivedAtIso)
    const now = new Date()
    const hours = Math.max(0.5, Math.round(((now.getTime() - arrivedAt.getTime()) / 3600000) * 10) / 10)
    const startTime = `${String(arrivedAt.getHours()).padStart(2, '0')}:${String(arrivedAt.getMinutes()).padStart(2, '0')}`

    setQuickSavingId(planning.id)
    setQuickError(null)
    const { error } = await pointMyHoursFromSpace({
      chantierId: planning.chantier_id,
      date: planning.planned_date,
      hours,
      startTime,
      description: `Tournée - ${planning.chantier_title}`,
    })
    setQuickSavingId(null)
    if (error) {
      setQuickError(error)
      return
    }
    setArrivals(prev => {
      const next = { ...prev }
      delete next[planning.id]
      return next
    })
    setHud(`${fmtHours(hours)} pointées`)
    router.refresh()
  }

  const handlePointPlannedSlot = async (planning: MemberPlanning) => {
    const plannedHours = getPlanningHours(planning)
    if (!plannedHours) {
      setQuickError('Ce créneau n’a pas de durée exploitable.')
      return
    }

    setSlotSavingId(planning.id)
    setQuickError(null)
    const isMaintenance = planning.id.startsWith('maintenance:')
    const { error } = await pointMyHoursFromSpace({
      chantierId: planning.chantier_id || undefined,
      date: planning.planned_date,
      hours: plannedHours,
      startTime: planning.start_time ?? null,
      description: planning.label ? `Créneau planifié - ${planning.label}` : `Créneau planifié - ${planning.chantier_title}`,
      planningId: isMaintenance ? null : planning.id,
      maintenanceInterventionId: isMaintenance ? planning.id.replace('maintenance:', '') : null,
    })
    setSlotSavingId(null)
    if (error) {
      setQuickError(error)
      return
    }
    setOpenSlot(null)
    setHud(`${fmtHours(plannedHours)} pointées`)
    router.refresh()
  }

  // Rapport d'heures
  const [showReport, setShowReport] = useState(false)
  const [reportFrom, setReportFrom] = useState(monthStart)
  const [reportTo, setReportTo]     = useState(monthEnd)
  const [reportSending, setReportSending] = useState(false)
  const [reportError, setReportError] = useState<string | null>(null)

  const handleSendReport = async () => {
    setReportError(null)
    setReportSending(true)
    const { error } = await sendMyHoursReportFromSpace(reportFrom, reportTo)
    setReportSending(false)
    if (error) { setReportError(error); return }
    setShowReport(false)
    setHud(`Rapport envoyé à ${member.email ?? 'votre adresse'}`)
  }

  const handleLogout = async () => {
    setLogoutLoading(true)
    await logoutFromMonEspace()
    router.replace('/mon-espace/request-access')
  }

  const handleTaskStatus = async (task: MemberTask, status: 'en_cours' | 'termine') => {
    setTaskError(null)
    setOpenTask(null)
    setTaskLoadingId(`${task.id}:${status}`)
    if (status === 'termine') {
      setTasks(prev => prev.filter(t => t.id !== task.id))
    } else {
      setTasks(prev => prev.map(t => t.id === task.id ? { ...t, status } : t))
    }
    const { error } = await updateMyTaskFromSpace(task.id, status)
    setTaskLoadingId(null)
    if (error) {
      setTaskError(error)
      setTasks(initialTasks)
      return
    }
    router.refresh()
  }

  // Créneaux groupés par jour
  const planningsByDay = plannings.reduce<Record<string, MemberPlanning[]>>((acc, p) => {
    if (!acc[p.planned_date]) acc[p.planned_date] = []
    acc[p.planned_date].push(p)
    return acc
  }, {})
  const sortedPlanningDates = Object.keys(planningsByDay).sort()
  const todayRoute = (planningsByDay[today] ?? [])
    .filter(p => p.route_id)
    .sort((a, b) => (a.route_order ?? 999) - (b.route_order ?? 999) || (a.start_time ?? '').localeCompare(b.start_time ?? ''))

  // Pointages groupés par jour
  const pointagesByDay = pointages.reduce<Record<string, MemberPointage[]>>((acc, p) => {
    if (!acc[p.date]) acc[p.date] = []
    acc[p.date].push(p)
    return acc
  }, {})
  const sortedPointageDates = Object.keys(pointagesByDay).sort().reverse()

  const menuItems: MenuItem[] = [
    ...(pushState === 'idle' || pushState === 'requesting'
      ? [{ label: 'Activer les notifications de planning', onSelect: () => { void handleEnablePush() }, disabled: pushState === 'requesting' }]
      : pushState === 'denied'
        ? [{ label: 'Notifications bloquées dans le navigateur', onSelect: () => {}, disabled: true }]
        : []),
    { label: 'Synchroniser mon agenda', onSelect: () => { window.open(icalUrl, '_blank', 'noopener,noreferrer') } },
    ...(member.email ? [{ label: 'Recevoir mon rapport d’heures', onSelect: () => setShowReport(true) }] : []),
    { label: 'Se déconnecter', onSelect: () => { void handleLogout() } },
  ]

  const openSlotHours = openSlot ? getPlanningHours(openSlot) : null
  const openSlotAddress = openSlot ? planningAddress(openSlot) : ''
  const openSlotMaps = mapsUrlFor(openSlotAddress)

  return (
    <PublicPage wide>
      <header className="relative flex flex-col items-center gap-[2px] px-[72px] pb-[18px] pt-espace-48 text-center">
        <p className="m-0 text-titre-2 font-atelier-bold [overflow-wrap:anywhere]">{organizationName}</p>
        <h1 className="m-0 mt-[10px] text-sous-titre font-atelier-medium text-encre-2">Bonjour {member.prenom ?? fullName}</h1>
        <div className="absolute right-0 top-espace-8">
          <Menu title="Mon espace" items={menuItems} trigger={<Button variant="text" aria-label="Plus d’options">Plus</Button>} />
        </div>
      </header>

      <section className="rounded-carte bg-carte pb-[18px]" aria-label="Mois en cours">
        <StatTile
          label="Mois en cours"
          value={fmtHours(totalHours)}
          detail={`${plural(pointages.length, 'pointage')} ${pointages.length > 1 ? 'enregistrés' : 'enregistré'}`}
        />
        <div className="flex gap-[10px] px-[18px]">
          <Button className="flex-[1.2]" onClick={() => setShowPoint(true)} disabled={chantiers.length === 0}>Nouveau pointage</Button>
          <Button className="flex-1" variant="secondary" onClick={() => setShowPhotoForm(true)} disabled={chantiers.length === 0}>Photo</Button>
        </div>
      </section>

      {todayRoute.length > 0 && (
        <ListGroup title={`Aujourd'hui, ${plural(todayRoute.length, 'passage')}`}>
          {todayRoute.map((planning, index) => {
            const address = planningAddress(planning)
            const mapsUrl = mapsUrlFor(address)
            const arrivedAtIso = arrivals[planning.id]
            const arrivedAt = arrivedAtIso ? new Date(arrivedAtIso) : null
            const details = [
              planning.chantier_title,
              address,
              timeRange(planning),
              planning.duration_min != null ? fmtMin(planning.duration_min) : null,
              index > 0 && planning.travel_from_prev_min != null ? `environ ${fmtMin(planning.travel_from_prev_min)} depuis le passage précédent` : null,
              arrivedAt ? `sur site depuis ${arrivedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : null,
              planning.notes,
            ].filter(Boolean).join(' · ')
            const action = arrivedAt ? (
              <Button size="sm" variant="secondary" loading={quickSavingId === planning.id} onClick={() => handleRouteDeparture(planning)}>
                Départ et pointer
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => handleRouteArrival(planning.id)}>Arrivée</Button>
            )
            return mapsUrl ? (
              <ListRow key={planning.id} title={`${index + 1}. ${planning.label || planning.chantier_title}`} description={details} href={mapsUrl} target="_blank" rel="noopener noreferrer" trailing={action} />
            ) : (
              <ListRow key={planning.id} title={`${index + 1}. ${planning.label || planning.chantier_title}`} description={details} trailing={action} />
            )
          })}
        </ListGroup>
      )}
      <PublicError>{quickError}</PublicError>

      <ListGroup title="Mes tâches">
        {tasks.length === 0 ? (
          <ListRow title="Aucune tâche assignée" />
        ) : tasks.map(task => (
          <ListRow
            key={task.id}
            title={task.title}
            description={[
              task.chantier_title,
              task.due_date ? `échéance ${fmtDate(task.due_date)}${task.is_overdue ? ', en retard' : ''}` : null,
              task.status === 'en_cours' ? 'en cours' : null,
            ].filter(Boolean).join(' · ')}
            onClick={() => setOpenTask(task)}
            trailing={task.status === 'a_faire' ? (
              <Button size="sm" variant="secondary" loading={taskLoadingId === `${task.id}:en_cours`} disabled={!!taskLoadingId} onClick={() => handleTaskStatus(task, 'en_cours')}>Démarrer</Button>
            ) : (
              <Button size="sm" variant="secondary" loading={taskLoadingId === `${task.id}:termine`} disabled={!!taskLoadingId} onClick={() => handleTaskStatus(task, 'termine')}>Terminer</Button>
            )}
          />
        ))}
      </ListGroup>
      <PublicError>{taskError}</PublicError>

      {upcomingAbsences.length > 0 && (
        <ListGroup title="Mes absences">
          {upcomingAbsences.map(a => (
            <ListRow
              key={a.id}
              title={a.start_date === a.end_date ? `Absence le ${fmtDate(a.start_date)}` : `Absence du ${fmtDate(a.start_date)} au ${fmtDate(a.end_date)}`}
              description={a.reason ?? undefined}
            />
          ))}
        </ListGroup>
      )}

      <ListGroup title="Mon planning" description="Les 3 prochaines semaines.">
        {sortedPlanningDates.length === 0 && <ListRow title="Aucun créneau à venir" />}
        {sortedPlanningDates.flatMap(date => planningsByDay[date].map((p, index) => (
          <ListRow
            key={p.id}
            leading={<span className="inline-block w-12 text-sous-titre font-atelier-medium text-encre-2 tabular-nums">{index === 0 ? (date === today ? 'Auj.' : shortDay(date)) : ''}</span>}
            title={p.label || p.chantier_title}
            description={[p.label ? p.chantier_title : null, timeRange(p), planningAddress(p), p.notes].filter(Boolean).join(' · ')}
            onClick={() => setOpenSlot(p)}
            trailing={p.pointage_id ? <StatusPill status="success">Pointé</StatusPill> : <StatusPill status="neutral">Prévu</StatusPill>}
          />
        )))}
        <ListRow title="Déclarer une absence" onClick={() => openAbsenceForm()} />
      </ListGroup>

      {memberGoals.length > 0 && (
        <ListGroup title="Mes objectifs du mois">
          {memberGoals.map(goal => (
            <ListRow
              key={goal.id}
              title={goalLabel(goal)}
              description={`${goal.percent} % atteint`}
              trailing={<span className="whitespace-nowrap text-sous-titre text-encre tabular-nums">{goal.current}{goal.unit ?? ''} / {goal.target}{goal.unit ?? ''}</span>}
            />
          ))}
        </ListGroup>
      )}

      {upcomingInterventions.length > 0 && (
        <ListGroup title="Mes interventions d’entretien">
          {upcomingInterventions.map(iv => (
            <ListRow
              key={iv.id}
              title={iv.contract?.title ?? 'Entretien'}
              description={[
                iv.date_intervention === today ? 'Aujourd’hui' : longDay(iv.date_intervention),
                iv.start_time ? iv.start_time.slice(0, 5) : null,
                iv.duration_hours ? `${iv.duration_hours}h` : null,
              ].filter(Boolean).join(' · ')}
              trailing={
                <StatusPill status={iv.statut === 'réalisée' ? 'success' : iv.statut === 'planifiée' ? 'wait' : 'neutral'}>
                  {iv.statut === 'planifiée' ? 'Planifiée' : iv.statut === 'réalisée' ? 'Réalisée' : 'Annulée'}
                </StatusPill>
              }
            />
          ))}
        </ListGroup>
      )}

      {sortedPointageDates.length === 0 ? (
        <EmptyState title="Aucune heure pointée ce mois-ci" description="Vos pointages du mois apparaîtront ici." />
      ) : sortedPointageDates.map(date => {
        const rows = pointagesByDay[date]
        const dayTotal = rows.reduce((s, p) => s + p.hours, 0)
        return (
          <ListGroup key={date} title={`${longDay(date)} · ${fmtHours(dayTotal)}`}>
            {rows.map(p => (
              <ListRow
                key={p.id}
                title={p.chantier_title}
                description={p.description ?? undefined}
                trailing={<span className="whitespace-nowrap text-sous-titre text-encre tabular-nums">{fmtHours(p.hours)}</span>}
              />
            ))}
          </ListGroup>
        )
      })}

      <Sheet
        open={showPoint}
        onOpenChange={(open) => { setShowPoint(open); if (!open) setPError(null) }}
        title="Nouveau pointage"
        confirmLabel="Pointer"
        onConfirm={handlePoint}
        confirmLoading={pSaving}
      >
        <ListGroup>
          <li className="border-b border-trait">
            <Field type="select" label="Chantier" value={pChantier} onChange={e => setPChantier(e.currentTarget.value)}>
              <option value="">Choisir un chantier</option>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Field>
          </li>
          <li className="border-b border-trait">
            <Field type="date" label="Date" value={pDate} onChange={e => setPDate(e.currentTarget.value)} />
          </li>
          <li className="border-b border-trait">
            <Field type="time" label="Heure de début" value={pStartTime} onChange={e => setPStart(e.currentTarget.value)} />
          </li>
          <li className="border-b border-trait">
            <Field type="text" label="Heures" inputMode="decimal" placeholder="7,5" value={pHours} onChange={e => setPHours(e.currentTarget.value)} required />
          </li>
          <li>
            <Field type="textarea" label="Description" placeholder="Facultatif" rows={2} value={pDescription} onChange={e => setPDesc(e.currentTarget.value)} />
          </li>
        </ListGroup>
        <PublicError>{pError}</PublicError>
      </Sheet>

      <Sheet
        open={showPhotoForm}
        onOpenChange={(open) => { if (!open) closePhotoForm(); else setShowPhotoForm(true) }}
        title="Nouvelle photo"
        confirmLabel="Envoyer"
        onConfirm={handleUploadPhoto}
        confirmLoading={phSaving}
      >
        <ListGroup>
          <li className="border-b border-trait">
            <Field type="select" label="Chantier" value={phChantier} onChange={e => setPhChantier(e.currentTarget.value)}>
              <option value="">Choisir un chantier</option>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </Field>
          </li>
          <li className="border-b border-trait">
            <Field type="textarea" label="Légende" placeholder="Facultatif" rows={2} value={phCaption} onChange={e => setPhCaption(e.currentTarget.value)} />
          </li>
          <ListRow
            title={phFile ? phFile.name : 'Prendre ou choisir une photo'}
            description={phFile ? 'Appuyez pour changer de photo' : undefined}
            onClick={() => photoInputRef.current?.click()}
          />
        </ListGroup>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={e => setPhFile(e.target.files?.[0] ?? null)}
        />
        <PublicError>{phError}</PublicError>
      </Sheet>

      <Sheet
        open={showAbsence}
        onOpenChange={(open) => { if (!open) closeAbsenceForm() }}
        title={absenceConflicts === null ? 'Déclarer une absence' : 'Absence enregistrée'}
        confirmLabel={absenceConflicts === null ? 'Déclarer' : 'OK'}
        onConfirm={absenceConflicts === null ? handleDeclareAbsence : closeAbsenceForm}
        confirmLoading={absenceSaving}
      >
        {absenceConflicts === null ? (
          <>
            <ListGroup>
              <li className="border-b border-trait">
                <Field type="date" label="Du" value={absenceStart} onChange={e => setAbsenceStart(e.currentTarget.value)} />
              </li>
              <li className="border-b border-trait">
                <Field type="date" label="Au" value={absenceEnd} onChange={e => setAbsenceEnd(e.currentTarget.value)} />
              </li>
              <li>
                <Field type="textarea" label="Motif" placeholder="Maladie, congé, imprévu… (facultatif)" rows={2} value={absenceReason} onChange={e => setAbsenceReason(e.currentTarget.value)} />
              </li>
            </ListGroup>
            <PublicError>{absenceError}</PublicError>
          </>
        ) : absenceConflicts.length > 0 ? (
          <ListGroup
            title={`${plural(absenceConflicts.length, 'créneau déjà planifié', 'créneaux déjà planifiés')} sur cette période`}
            description="Prévenez votre responsable : ces créneaux restent à traiter."
          >
            {absenceConflicts.map(slot => (
              <ListRow key={slot.id} title={slot.chantier_title} description={`${fmtDate(slot.planned_date)}${slot.start_time ? ` · ${slot.start_time.slice(0, 5)}` : ''}`} />
            ))}
          </ListGroup>
        ) : (
          <p className="mx-espace-16 text-sous-titre text-encre-2">Aucun créneau existant sur cette période.</p>
        )}
      </Sheet>

      <Sheet
        open={showReport}
        onOpenChange={(open) => { setShowReport(open); if (!open) setReportError(null) }}
        title="Recevoir mon rapport d’heures"
        description={member.email ? `Le récapitulatif PDF est envoyé à ${member.email}.` : undefined}
        confirmLabel="Envoyer"
        onConfirm={handleSendReport}
        confirmLoading={reportSending}
      >
        <ListGroup>
          <li className="border-b border-trait">
            <Field type="date" label="Du" value={reportFrom} onChange={e => setReportFrom(e.currentTarget.value)} />
          </li>
          <li>
            <Field type="date" label="Au" value={reportTo} onChange={e => setReportTo(e.currentTarget.value)} />
          </li>
        </ListGroup>
        <PublicError>{reportError}</PublicError>
      </Sheet>

      <Sheet open={openSlot !== null} onOpenChange={(open) => { if (!open) setOpenSlot(null) }} title={openSlot ? (openSlot.label || openSlot.chantier_title) : 'Créneau'}>
        {openSlot && (
          <>
            <ListGroup>
              <ListRow title={openSlot.chantier_title} description={[longDay(openSlot.planned_date), timeRange(openSlot), openSlotAddress, openSlot.notes].filter(Boolean).join(' · ')} />
              {openSlotMaps && <ListRow title="Itinéraire" description="Ouvre la carte dans un nouvel onglet" href={openSlotMaps} target="_blank" rel="noopener noreferrer" />}
            </ListGroup>
            <ListGroup>
              {openSlot.pointage_id ? (
                <ListRow title="Créneau déjà pointé" trailing={<StatusPill status="success">Pointé</StatusPill>} />
              ) : openSlotHours ? (
                <ListRow
                  title={slotSavingId === openSlot.id ? 'Pointage en cours…' : `Pointer ${fmtHours(openSlotHours)}`}
                  description="Crée le pointage depuis ce créneau"
                  disabled={slotSavingId === openSlot.id}
                  onClick={() => handlePointPlannedSlot(openSlot)}
                />
              ) : null}
              <ListRow
                title="Je suis absent ce jour-là"
                onClick={() => { const date = openSlot.planned_date; setOpenSlot(null); openAbsenceForm(date) }}
              />
            </ListGroup>
            <PublicError>{quickError}</PublicError>
          </>
        )}
      </Sheet>

      <Sheet open={openTask !== null} onOpenChange={(open) => { if (!open) setOpenTask(null) }} title={openTask?.title ?? 'Tâche'}>
        {openTask && (
          <ListGroup>
            <ListRow
              title={openTask.chantier_title}
              description={openTask.due_date ? `Échéance ${fmtDate(openTask.due_date)}${openTask.is_overdue ? ', en retard' : ''}` : undefined}
            />
            {openTask.status === 'a_faire' && (
              <ListRow title="Démarrer la tâche" onClick={() => handleTaskStatus(openTask, 'en_cours')} />
            )}
            <ListRow title="Terminer la tâche" onClick={() => handleTaskStatus(openTask, 'termine')} />
          </ListGroup>
        )}
      </Sheet>

      <Hud open={hud !== null} onOpenChange={(open) => { if (!open) setHud(null) }} message={hud ?? ''} />
    </PublicPage>
  )
}
