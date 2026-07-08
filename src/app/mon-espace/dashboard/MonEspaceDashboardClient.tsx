'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Clock, FileDown, LogOut, Plus, Loader2, Check, X, Mail, MapPin, Navigation, Timer, LogIn, AlertTriangle, PlayCircle, ChevronDown, ChevronUp, CalendarDays, Target, Wrench, Camera, ImagePlus, UserX, Bell, BellOff } from 'lucide-react'
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

const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

function PointageAccordionMembre({
  pointagesByDay,
  sortedDates,
}: {
  pointagesByDay: Record<string, MemberPointage[]>
  sortedDates: string[]
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (d: string) =>
    setOpen(prev => { const s = new Set(prev); s.has(d) ? s.delete(d) : s.add(d); return s })

  const totalHours = sortedDates.reduce(
    (sum, d) => sum + pointagesByDay[d].reduce((s, p) => s + p.hours, 0), 0,
  )

  return (
    <div className="card overflow-hidden divide-y divide-[var(--elevation-border)]">
      {sortedDates.map(date => {
        const rows = pointagesByDay[date]
        const dayTotal = rows.reduce((s, p) => s + p.hours, 0)
        const isOpen = open.has(date)
        const d = new Date(date + 'T00:00:00')
        return (
          <div key={date}>
            <button
              onClick={() => toggle(date)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--elevation-1)] transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-primary">
                  {dayNames[d.getDay()]} {fmtDate(date)}
                </p>
                <p className="text-xs text-secondary">{rows.length} pointage{rows.length > 1 ? 's' : ''}</p>
              </div>
              <p className="font-extrabold text-primary text-sm flex-shrink-0">{fmtHours(dayTotal)}</p>
              {isOpen
                ? <ChevronUp className="w-4 h-4 text-secondary flex-shrink-0" />
                : <ChevronDown className="w-4 h-4 text-secondary flex-shrink-0" />}
            </button>
            {isOpen && (
              <div className="border-t border-[var(--elevation-border)] bg-[var(--elevation-1)]/40 divide-y divide-[var(--elevation-border)]">
                {rows.map(p => (
                  <div key={p.id} className="flex items-center gap-3 px-5 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{p.chantier_title}</p>
                      {p.description && <p className="text-xs text-secondary truncate">{p.description}</p>}
                    </div>
                    <p className="text-sm font-semibold text-primary flex-shrink-0 tabular-nums">{fmtHours(p.hours)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--elevation-1)]/60">
        <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Total du mois</p>
        <p className="font-extrabold text-primary">{fmtHours(totalHours)}</p>
      </div>
    </div>
  )
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
}) {
  const router = useRouter()
  const fullName = [member.prenom, member.name].filter(Boolean).join(' ') || member.name

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

  // Formulaire pointage
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
  const [logoutLoading, setLogoutLoading] = useState(false)

  // Déclaration d'absence
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
    if (isNaN(h) || h <= 0 || h > 24) { setPError('Heures invalides (entre 0 et 24).'); return }
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
    router.refresh()
  }

  // Formulaire photo
  const [showPhotoForm, setShowPhotoForm] = useState(false)
  const [phChantier, setPhChantier] = useState(chantiers[0]?.id ?? '')
  const [phFile, setPhFile] = useState<File | null>(null)
  const [phCaption, setPhCaption] = useState('')
  const [phSaving, setPhSaving] = useState(false)
  const [phError, setPhError] = useState<string | null>(null)
  const [phSuccess, setPhSuccess] = useState<string | null>(null)

  const handleUploadPhoto = async () => {
    setPhError(null)
    setPhSuccess(null)
    if (!phChantier) { setPhError('Choisissez un chantier.'); return }
    if (!phFile) { setPhError('Choisissez ou prenez une photo.'); return }
    if (phFile.size > MAX_MEMBER_PHOTO_SIZE) { setPhError('Photo trop volumineuse (10 Mo maximum).'); return }

    setPhSaving(true)
    const fd = new FormData()
    fd.append('file', phFile)
    fd.append('chantierId', phChantier)
    if (phCaption.trim()) fd.append('caption', phCaption.trim())

    const { error } = await uploadPhotoFromSpace(fd)
    setPhSaving(false)
    if (error) { setPhError(error); return }

    setPhSuccess('Photo envoyée !')
    setPhFile(null)
    setPhCaption('')
    router.refresh()
  }

  const handleRouteArrival = (planningId: string) => {
    setQuickError(null)
    setArrivals(prev => ({ ...prev, [planningId]: new Date().toISOString() }))
    // Persistance + notification managers en arrière-plan : ne bloque pas l'UI locale.
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
    router.refresh()
  }

  // Rapport mensuel
  const [reportFrom, setReportFrom] = useState(monthStart)
  const [reportTo, setReportTo]     = useState(monthEnd)
  const [reportSending, setReportSending] = useState(false)
  const [reportMsg, setReportMsg]   = useState<string | null>(null)

  const handleSendReport = async () => {
    setReportMsg(null)
    setReportSending(true)
    const { error } = await sendMyHoursReportFromSpace(reportFrom, reportTo)
    setReportSending(false)
    if (error) { setReportMsg(`Erreur : ${error}`); return }
    setReportMsg('Rapport envoyé à ' + (member.email ?? 'votre adresse'))
  }

  const handleLogout = async () => {
    setLogoutLoading(true)
    await logoutFromMonEspace()
    router.replace('/mon-espace/request-access')
  }

  const handleTaskStatus = async (task: MemberTask, status: 'en_cours' | 'termine') => {
    setTaskError(null)
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

  // Plannings groupés par jour
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

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <header className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider font-semibold text-secondary">{organizationName}</p>
          <h1 className="text-xl font-bold text-primary">Bonjour {member.prenom ?? fullName}</h1>
        </div>
        <div className="flex items-center gap-1">
          {pushState !== 'unsupported' && pushState !== 'granted' && (
            <button
              onClick={handleEnablePush}
              disabled={pushState === 'requesting' || pushState === 'denied'}
              className="text-secondary hover:text-primary p-2 rounded-lg hover:bg-[var(--elevation-1)] transition-colors disabled:opacity-60"
              title={pushState === 'denied' ? 'Notifications bloquées dans le navigateur' : 'Activer les notifications de planning'}
            >
              {pushState === 'requesting'
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : pushState === 'denied'
                  ? <BellOff className="w-4 h-4" />
                  : <Bell className="w-4 h-4" />}
            </button>
          )}
          <button
            onClick={handleLogout}
            disabled={logoutLoading}
            className="text-secondary hover:text-primary p-2 rounded-lg hover:bg-[var(--elevation-1)] transition-colors disabled:opacity-60"
            title="Se déconnecter"
          >
            {logoutLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
          </button>
        </div>
      </header>

      {/* Bandeau résumé du mois */}
      <div className="card p-4">
        <p className="text-xs text-secondary uppercase tracking-wider font-semibold">Mois en cours</p>
        <p className="text-3xl font-bold text-primary mt-1">{fmtHours(totalHours)}</p>
        <p className="text-xs text-secondary mt-0.5">{pointages.length} pointage{pointages.length !== 1 ? 's' : ''} enregistré{pointages.length !== 1 ? 's' : ''}</p>
      </div>

      {/* CTA pointer */}
      {!showPoint && (
        <button
          onClick={() => setShowPoint(true)}
          className="btn-primary w-full flex items-center justify-center gap-2"
          disabled={chantiers.length === 0}
        >
          <Plus className="w-4 h-4" /> Pointer mes heures
        </button>
      )}

      {showPoint && (
        <div className="card p-4 border-accent/30 bg-accent/5 space-y-3">
          <p className="text-sm font-bold text-primary">Nouveau pointage</p>
          <select className="input w-full" value={pChantier} onChange={e => setPChantier(e.target.value)}>
            <option value="">— Choisir un chantier —</option>
            {chantiers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[10px] text-secondary uppercase font-semibold">Date</label>
              <input type="date" className="input w-full" value={pDate} onChange={e => setPDate(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-secondary uppercase font-semibold">Heure début</label>
              <input type="time" className="input w-full" value={pStartTime} onChange={e => setPStart(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] text-secondary uppercase font-semibold">Heures *</label>
              <input
                type="text"
                inputMode="decimal"
                className="input w-full"
                placeholder="ex : 7.5"
                value={pHours}
                onChange={e => setPHours(e.target.value)}
              />
            </div>
          </div>
          <textarea
            className="input w-full min-h-[60px]"
            placeholder="Description (facultatif)"
            value={pDescription}
            onChange={e => setPDesc(e.target.value)}
          />
          {pError && <p className="text-xs text-red-500">{pError}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowPoint(false)} className="btn-secondary text-sm flex items-center gap-1.5">
              <X className="w-3.5 h-3.5" /> Annuler
            </button>
            <button onClick={handlePoint} disabled={pSaving} className="btn-primary text-sm flex items-center gap-1.5">
              {pSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {pSaving ? 'Enregistrement…' : 'Pointer'}
            </button>
          </div>
        </div>
      )}

      {/* CTA photo */}
      {!showPhotoForm && (
        <button
          onClick={() => setShowPhotoForm(true)}
          className="btn-secondary w-full flex items-center justify-center gap-2"
          disabled={chantiers.length === 0}
        >
          <Camera className="w-4 h-4" /> Ajouter une photo
        </button>
      )}

      {showPhotoForm && (
        <div className="card p-4 border-accent/30 bg-accent/5 space-y-3">
          <p className="text-sm font-bold text-primary">Nouvelle photo</p>
          <select className="input w-full" value={phChantier} onChange={e => setPhChantier(e.target.value)}>
            <option value="">— Choisir un chantier —</option>
            {chantiers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
          </select>
          <label className="flex items-center justify-center gap-2 border border-dashed border-[var(--elevation-border)] rounded-lg py-6 cursor-pointer hover:bg-[var(--elevation-1)] transition-colors">
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={e => setPhFile(e.target.files?.[0] ?? null)}
            />
            <ImagePlus className="w-5 h-5 text-secondary" />
            <span className="text-sm text-secondary">
              {phFile ? phFile.name : 'Prendre ou choisir une photo'}
            </span>
          </label>
          <textarea
            className="input w-full min-h-[60px]"
            placeholder="Légende (facultatif)"
            value={phCaption}
            onChange={e => setPhCaption(e.target.value)}
          />
          {phError && <p className="text-xs text-red-500">{phError}</p>}
          {phSuccess && <p className="text-xs text-green-600">{phSuccess}</p>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowPhotoForm(false); setPhFile(null); setPhCaption(''); setPhError(null) }}
              className="btn-secondary text-sm flex items-center gap-1.5"
            >
              <X className="w-3.5 h-3.5" /> Annuler
            </button>
            <button onClick={handleUploadPhoto} disabled={phSaving} className="btn-primary text-sm flex items-center gap-1.5">
              {phSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              {phSaving ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </div>
      )}

      {/* Ma tournée du jour */}
      {todayRoute.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-primary flex items-center gap-2">
            <Navigation className="w-4 h-4 text-accent" /> Ma tournée du jour
          </h2>
          <div className="card p-3 space-y-2">
            <div className="flex items-center justify-between gap-3 border-b border-[var(--elevation-border)] pb-2">
              <div>
                <p className="text-xs uppercase tracking-wider font-semibold text-secondary">{fmtDate(today)}</p>
                <p className="text-sm font-bold text-primary">{todayRoute.length} passage{todayRoute.length > 1 ? 's' : ''} prévu{todayRoute.length > 1 ? 's' : ''}</p>
              </div>
              <span className="text-xs font-semibold text-secondary">
                {todayRoute[0]?.label}
              </span>
            </div>

            {quickError && <p className="text-xs text-red-500">{quickError}</p>}

            {todayRoute.map((planning, index) => {
              const address = [planning.chantier_address_line1, planning.chantier_postal_code, planning.chantier_city].filter(Boolean).join(', ')
              const mapsUrl = address ? `https://maps.google.com/maps?q=${encodeURIComponent(address)}` : null
              const arrivedAtIso = arrivals[planning.id]
              const arrivedAt = arrivedAtIso ? new Date(arrivedAtIso) : null

              return (
                <div key={planning.id} className="rounded-xl border border-[var(--elevation-border)] bg-base/50 p-3 dark:bg-white/[0.03]">
                  {index > 0 && planning.travel_from_prev_min != null && (
                    <div className="mb-2 flex items-center gap-1.5 text-xs text-secondary">
                      <Navigation className="w-3 h-3" />
                      Environ {fmtMin(planning.travel_from_prev_min)} depuis le passage précédent
                    </div>
                  )}
                  <div className="flex gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-black">
                      {index + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-primary">{planning.chantier_title}</p>
                      {address && (
                        <p className="mt-0.5 flex items-start gap-1 text-xs text-secondary">
                          <MapPin className="mt-0.5 h-3 w-3 shrink-0" />
                          <span>{address}</span>
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-secondary">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {planning.start_time ?? 'Heure libre'}{planning.end_time ? ` - ${planning.end_time}` : ''}
                        </span>
                        {planning.duration_min != null && (
                          <span className="flex items-center gap-1">
                            <Timer className="h-3 w-3" />
                            {fmtMin(planning.duration_min)}
                          </span>
                        )}
                      </div>
                      {planning.notes && (
                        <p className="mt-2 rounded-lg bg-surface p-2 text-xs text-secondary dark:bg-white/[0.04]">
                          {planning.notes}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--elevation-border)] pt-3">
                    {mapsUrl && (
                      <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                        <Navigation className="h-3.5 w-3.5" />
                        Itinéraire
                      </a>
                    )}
                    {!arrivedAt ? (
                      <button onClick={() => handleRouteArrival(planning.id)} className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs">
                        <LogIn className="h-3.5 w-3.5" />
                        Arrivée
                      </button>
                    ) : (
                      <>
                        <span className="text-xs text-secondary">
                          Sur site depuis {arrivedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <button
                          onClick={() => handleRouteDeparture(planning)}
                          disabled={quickSavingId === planning.id}
                          className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                        >
                          {quickSavingId === planning.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Départ et pointer
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Mes tâches */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-primary flex items-center gap-2">
          <Check className="w-4 h-4 text-accent" /> Mes tâches
        </h2>
        {taskError && <p className="text-xs text-red-500">{taskError}</p>}
        {tasks.length === 0 ? (
          <div className="card p-4 text-sm text-secondary text-center">
            Aucune tâche assignée.
          </div>
        ) : (
          <div className="space-y-2">
            {tasks.map(task => (
              <div key={task.id} className={`card p-3 ${task.is_overdue ? 'border-red-500/25 bg-red-500/5' : ''}`}>
                <div className="flex items-start gap-3">
                  {task.is_overdue ? (
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                  ) : (
                    <Clock className="mt-0.5 h-4 w-4 shrink-0 text-secondary" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-primary">{task.title}</p>
                    <p className="text-xs text-secondary">{task.chantier_title}</p>
                    {task.due_date && (
                      <p className={`mt-1 text-xs ${task.is_overdue ? 'text-red-500 font-semibold' : 'text-secondary'}`}>
                        Échéance {fmtDate(task.due_date)}
                      </p>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap justify-end gap-2 border-t border-[var(--elevation-border)] pt-3">
                  {task.status === 'a_faire' && (
                    <button
                      onClick={() => handleTaskStatus(task, 'en_cours')}
                      disabled={!!taskLoadingId}
                      className="btn-secondary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                    >
                      {taskLoadingId === `${task.id}:en_cours` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
                      Démarrer
                    </button>
                  )}
                  <button
                    onClick={() => handleTaskStatus(task, 'termine')}
                    disabled={!!taskLoadingId}
                    className="btn-primary flex items-center gap-1.5 px-3 py-1.5 text-xs"
                  >
                    {taskLoadingId === `${task.id}:termine` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Terminer
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Créneaux à venir */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-primary flex items-center gap-2">
            <Calendar className="w-4 h-4 text-accent" /> Mes créneaux planifiés
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAbsence(v => !v)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--elevation-border)] text-xs font-semibold text-secondary hover:text-primary hover:border-accent/40 transition-colors"
            >
              <UserX className="w-3.5 h-3.5" /> Je suis absent(e)
            </button>
            <a
              href={icalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-[var(--elevation-border)] text-xs font-semibold text-secondary hover:text-primary hover:border-accent/40 transition-colors"
              title="Synchroniser avec Apple Calendar, Google Calendar ou votre agenda"
            >
              <CalendarDays className="w-3.5 h-3.5" /> Sync agenda
            </a>
          </div>
        </div>
        {showAbsence && (
          <div className="card p-4 space-y-3">
            {absenceConflicts === null ? (
              <>
                <p className="text-sm font-semibold text-primary">Déclarer une absence</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="text-xs text-secondary space-y-1">
                    <span>Du</span>
                    <input
                      type="date"
                      value={absenceStart}
                      onChange={e => setAbsenceStart(e.target.value)}
                      className="w-full rounded-lg border border-[var(--elevation-border)] px-2.5 py-1.5 text-sm bg-transparent"
                    />
                  </label>
                  <label className="text-xs text-secondary space-y-1">
                    <span>Au</span>
                    <input
                      type="date"
                      value={absenceEnd}
                      onChange={e => setAbsenceEnd(e.target.value)}
                      className="w-full rounded-lg border border-[var(--elevation-border)] px-2.5 py-1.5 text-sm bg-transparent"
                    />
                  </label>
                </div>
                <label className="text-xs text-secondary space-y-1 block">
                  <span>Motif (optionnel)</span>
                  <textarea
                    value={absenceReason}
                    onChange={e => setAbsenceReason(e.target.value)}
                    rows={2}
                    className="w-full rounded-lg border border-[var(--elevation-border)] px-2.5 py-1.5 text-sm bg-transparent"
                    placeholder="Maladie, congé, imprévu..."
                  />
                </label>
                {absenceError && <p className="text-xs text-red-500">{absenceError}</p>}
                <div className="flex items-center gap-2">
                  <button onClick={closeAbsenceForm} className="btn-secondary px-3 py-1.5 text-xs">Annuler</button>
                  <button
                    onClick={handleDeclareAbsence}
                    disabled={absenceSaving}
                    className="btn-primary inline-flex items-center gap-1.5 px-3 py-1.5 text-xs"
                  >
                    {absenceSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    Déclarer l'absence
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">Absence enregistrée.</p>
                {absenceConflicts.length > 0 ? (
                  <div className="space-y-1.5">
                    <p className="text-xs text-secondary">
                      {absenceConflicts.length} créneau{absenceConflicts.length > 1 ? 'x' : ''} déjà planifié{absenceConflicts.length > 1 ? 's' : ''} sur cette période. Prévenez votre responsable, il reste{absenceConflicts.length > 1 ? 'nt' : ''} à traiter :
                    </p>
                    <ul className="text-xs text-secondary space-y-0.5">
                      {absenceConflicts.map(slot => (
                        <li key={slot.id}>
                          {fmtDate(slot.planned_date)} - {slot.chantier_title}{slot.start_time ? ` (${slot.start_time.slice(0, 5)})` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-secondary">Aucun créneau existant sur cette période.</p>
                )}
                <button onClick={closeAbsenceForm} className="btn-secondary px-3 py-1.5 text-xs">Fermer</button>
              </>
            )}
          </div>
        )}
        {quickError && <p className="text-xs text-red-500">{quickError}</p>}
        {sortedPlanningDates.length === 0 ? (
          <div className="card p-4 text-sm text-secondary text-center">
            Aucun créneau à venir dans les 3 prochaines semaines.
          </div>
        ) : (
          <div className="card divide-y divide-[var(--elevation-border)] overflow-hidden">
            {sortedPlanningDates.map(date => {
              const d = new Date(date + 'T00:00:00')
              const isDateToday = date === today
              const slots = planningsByDay[date]
              return (
                <div key={date} className={`px-4 py-3 ${isDateToday ? 'bg-accent/5' : ''}`}>
                  <p className={`text-xs font-bold uppercase tracking-wider mb-2 ${isDateToday ? 'text-accent' : 'text-secondary'}`}>
                    {isDateToday ? "Aujourd'hui" : `${dayNames[d.getDay()]} ${fmtDate(date)}`}
                  </p>
                  <div className="space-y-1.5">
                    {slots.map(p => {
                      const address = [p.chantier_address_line1, p.chantier_postal_code, p.chantier_city].filter(Boolean).join(', ')
                      const mapsUrl = address ? `https://maps.google.com/maps?q=${encodeURIComponent(address)}` : null
                      const plannedHours = getPlanningHours(p)
                      const canPointSlot = Boolean(plannedHours && !p.pointage_id)
                      return (
                        <div key={p.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
                          {/* Heure */}
                          <div className="w-full shrink-0 sm:w-14 sm:text-right">
                            {p.start_time ? (
                              <span className="text-xs font-semibold text-primary tabular-nums">
                                {p.start_time.slice(0, 5)}
                              </span>
                            ) : (
                              <span className="text-xs text-secondary italic">Libre</span>
                            )}
                          </div>
                          {/* Séparateur */}
                          <div className="hidden w-px h-8 bg-[var(--elevation-border)] shrink-0 sm:block" />
                          {/* Infos */}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-primary truncate">{p.chantier_title}</p>
                            {address && (
                              <p className="flex items-center gap-1 text-xs text-secondary truncate">
                                <MapPin className="h-2.5 w-2.5 shrink-0" />
                                <span className="truncate">{address}</span>
                              </p>
                            )}
                            {p.notes && (
                              <p className="text-xs text-secondary/70 truncate italic">{p.notes}</p>
                            )}
                          </div>
                          {/* Durée + itinéraire */}
                          <div className="shrink-0 flex flex-wrap items-center justify-end gap-2">
                            {p.start_time && p.end_time && (() => {
                              const [sh, sm2] = p.start_time.split(':').map(Number)
                              const [eh, em] = p.end_time.split(':').map(Number)
                              const dur = (eh + em / 60) - (sh + sm2 / 60)
                              return dur > 0 ? (
                                <span className="text-xs font-semibold text-primary tabular-nums">
                                  {fmtHours(dur)}
                                </span>
                              ) : null
                            })()}
                            {!p.end_time && p.start_time && (
                              <span className="text-xs text-secondary tabular-nums">
                                {p.start_time.slice(0, 5)}
                              </span>
                            )}
                            {mapsUrl && (
                              <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
                                className="p-1.5 rounded-lg text-accent hover:bg-accent/10 transition-colors"
                                title="Itinéraire">
                                <Navigation className="h-3.5 w-3.5" />
                              </a>
                            )}
                            {p.pointage_id ? (
                              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                <Check className="h-3.5 w-3.5" />
                                Pointé
                              </span>
                            ) : canPointSlot ? (
                              <>
                                <button
                                  onClick={() => handlePointPlannedSlot(p)}
                                  disabled={slotSavingId === p.id}
                                  className="btn-primary inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
                                >
                                  {slotSavingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
                                  Pointer
                                </button>
                                <button
                                  onClick={() => { setAbsenceStart(p.planned_date); setAbsenceEnd(p.planned_date); setShowAbsence(true) }}
                                  className="p-1.5 rounded-lg text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                  title="Je suis absent(e) sur ce créneau"
                                >
                                  <UserX className="h-3.5 w-3.5" />
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Objectifs du mois */}
      {memberGoals.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-primary flex items-center gap-2">
            <Target className="w-4 h-4 text-accent" /> Mes objectifs du mois
          </h2>
          <div className="card divide-y divide-[var(--elevation-border)] overflow-hidden">
            {memberGoals.map(goal => (
              <div key={goal.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-primary">
                    {goal.label ?? (goal.metric === 'heures_terrain' ? 'Heures terrain' : goal.metric === 'taches_completees' ? 'Tâches complétées' : goal.metric === 'chantiers_traites' ? 'Chantiers traités' : 'Objectif')}
                  </p>
                  <p className="text-sm font-semibold text-primary tabular-nums shrink-0">
                    {goal.current}{goal.unit ?? ''} / {goal.target}{goal.unit ?? ''}
                  </p>
                </div>
                <div className="h-2 rounded-full bg-black/8 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-accent transition-all"
                    style={{ width: `${goal.percent}%` }}
                  />
                </div>
                <p className="text-xs text-secondary text-right">{goal.percent}%</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Interventions d'entretien à venir */}
      {upcomingInterventions.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-primary flex items-center gap-2">
            <Wrench className="w-4 h-4 text-accent" /> Mes interventions d&apos;entretien
          </h2>
          <div className="card divide-y divide-[var(--elevation-border)] overflow-hidden">
            {upcomingInterventions.map(iv => {
              const dateLabel = new Date(iv.date_intervention + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })
              const isToday = iv.date_intervention === new Date().toISOString().slice(0, 10)
              return (
                <div key={iv.id} className="px-4 py-3 flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${iv.statut === 'réalisée' ? 'bg-green-500' : 'bg-blue-500'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-primary truncate">
                      {iv.contract?.title ?? 'Entretien'}
                    </p>
                    <p className="text-xs text-secondary">
                      {isToday ? "Aujourd'hui" : dateLabel}
                      {iv.start_time ? ` · ${iv.start_time.slice(0, 5)}` : ''}
                      {iv.duration_hours ? ` · ${iv.duration_hours}h` : ''}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold flex-shrink-0 ${
                    iv.statut === 'réalisée' ? 'bg-green-500/15 text-green-600 dark:text-green-400' :
                    iv.statut === 'planifiée' ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400' :
                    'bg-secondary/20 text-secondary'
                  }`}>
                    {iv.statut === 'planifiée' ? 'Planifiée' : iv.statut === 'réalisée' ? 'Réalisée' : 'Annulée'}
                  </span>
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* Pointages du mois — accordéon par jour */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-primary flex items-center gap-2">
          <Clock className="w-4 h-4 text-accent" /> Mes heures du mois
        </h2>
        {sortedPointageDates.length === 0 ? (
          <div className="card p-4 text-sm text-secondary text-center">
            Aucune heure pointée ce mois-ci.
          </div>
        ) : (
          <PointageAccordionMembre
            pointagesByDay={pointagesByDay}
            sortedDates={sortedPointageDates}
          />
        )}
      </section>

      {/* Rapport par mail */}
      {member.email && (
        <section className="card p-4 space-y-3">
          <h2 className="text-sm font-bold text-primary flex items-center gap-2">
            <FileDown className="w-4 h-4 text-accent" /> Recevoir mon rapport (PDF)
          </h2>
          <p className="text-xs text-secondary">
            Choisissez la période et nous vous enverrons le récapitulatif par email à <strong>{member.email}</strong>.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input type="date" className="input" value={reportFrom} onChange={e => setReportFrom(e.target.value)} />
            <input type="date" className="input" value={reportTo}   onChange={e => setReportTo(e.target.value)} />
          </div>
          <button
            onClick={handleSendReport}
            disabled={reportSending}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {reportSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
            {reportSending ? 'Envoi…' : "M'envoyer le rapport"}
          </button>
          {reportMsg && (
            <p className={`text-xs ${reportMsg.startsWith('Erreur') ? 'text-red-500' : 'text-emerald-500'}`}>
              {reportMsg}
            </p>
          )}
        </section>
      )}
    </div>
  )
}
