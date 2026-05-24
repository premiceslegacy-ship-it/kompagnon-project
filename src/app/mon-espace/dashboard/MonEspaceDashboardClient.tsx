'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Clock, FileDown, LogOut, Plus, Loader2, Check, X, Mail, MapPin, Navigation, Timer, LogIn, AlertTriangle, PlayCircle } from 'lucide-react'
import type { IndividualMember, MemberPointage, MemberPlanning, MemberTask } from '@/lib/data/queries/members'
import {
  pointMyHoursFromSpace,
  sendMyHoursReportFromSpace,
  logoutFromMonEspace,
  updateMyTaskFromSpace,
} from '@/lib/data/mutations/members'

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

const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

export default function MonEspaceDashboardClient({
  member,
  organizationName,
  pointages,
  plannings,
  tasks: initialTasks,
  chantiers,
  monthStart,
  monthEnd,
}: {
  member: IndividualMember
  organizationName: string
  pointages: MemberPointage[]
  plannings: MemberPlanning[]
  tasks: MemberTask[]
  chantiers: ChantierStub[]
  monthStart: string
  monthEnd: string
}) {
  const router = useRouter()
  const fullName = [member.prenom, member.name].filter(Boolean).join(' ') || member.name

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

  const handleRouteArrival = (planningId: string) => {
    setQuickError(null)
    setArrivals(prev => ({ ...prev, [planningId]: new Date().toISOString() }))
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
        <button
          onClick={handleLogout}
          className="text-secondary hover:text-primary p-2 rounded-lg hover:bg-[var(--elevation-1)] transition-colors"
          title="Se déconnecter"
        >
          <LogOut className="w-4 h-4" />
        </button>
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
        <h2 className="text-sm font-bold text-primary flex items-center gap-2">
          <Calendar className="w-4 h-4 text-accent" /> Mes créneaux planifiés
        </h2>
        {sortedPlanningDates.length === 0 ? (
          <div className="card p-4 text-sm text-secondary text-center">
            Aucun créneau à venir dans les 3 prochaines semaines.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedPlanningDates.map(date => {
              const d = new Date(date + 'T00:00:00')
              return (
                <div key={date} className="card p-3">
                  <p className="text-xs uppercase font-bold text-secondary tracking-wider">
                    {dayNames[d.getDay()]} {fmtDate(date)}
                  </p>
                  <div className="mt-2 space-y-1">
                    {planningsByDay[date].map(p => (
                      <div key={p.id} className="flex items-center gap-2 text-sm">
                        <span className="text-primary font-semibold">{p.chantier_title}</span>
                        {p.chantier_city && <span className="text-secondary text-xs">· {p.chantier_city}</span>}
                        <span className="ml-auto text-secondary text-xs">
                          {p.start_time ?? '—'}{p.end_time ? `–${p.end_time}` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* Pointages du mois */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-primary flex items-center gap-2">
          <Clock className="w-4 h-4 text-accent" /> Mes heures du mois
        </h2>
        {sortedPointageDates.length === 0 ? (
          <div className="card p-4 text-sm text-secondary text-center">
            Aucune heure pointée ce mois-ci.
          </div>
        ) : (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                  <th className="text-left px-3 py-2 text-xs font-semibold text-secondary uppercase">Date</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-secondary uppercase">Chantier</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-secondary uppercase">Heures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {sortedPointageDates.map(date => {
                  const rows = pointagesByDay[date]
                  return rows.map((p, i) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2 text-secondary tabular-nums">{i === 0 ? fmtDate(date) : ''}</td>
                      <td className="px-3 py-2 text-primary">{p.chantier_title}</td>
                      <td className="px-3 py-2 text-right text-primary tabular-nums">{fmtHours(p.hours)}</td>
                    </tr>
                  ))
                })}
              </tbody>
            </table>
          </div>
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
