'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, Clock, FileDown, LogOut, Plus, Loader2, Check, X, Mail } from 'lucide-react'
import type { IndividualMember, MemberPointage, MemberPlanning } from '@/lib/data/queries/members'
import {
  pointMyHoursFromSpace,
  sendMyHoursReportFromSpace,
  logoutFromMonEspace,
} from '@/lib/data/mutations/members'

type ChantierStub = { id: string; title: string }

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  return min === 0 ? `${h}h` : `${h}h${String(min).padStart(2, '0')}`
}

const dayNames = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']

export default function MonEspaceDashboardClient({
  member,
  organizationName,
  pointages,
  plannings,
  chantiers,
  monthStart,
  monthEnd,
}: {
  member: IndividualMember
  organizationName: string
  pointages: MemberPointage[]
  plannings: MemberPlanning[]
  chantiers: ChantierStub[]
  monthStart: string
  monthEnd: string
}) {
  const router = useRouter()
  const fullName = [member.prenom, member.name].filter(Boolean).join(' ') || member.name

  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)

  // Formulaire pointage
  const [showPoint, setShowPoint] = useState(false)
  const today = new Date().toISOString().slice(0, 10)
  const [pChantier, setPChantier] = useState(chantiers[0]?.id ?? '')
  const [pDate, setPDate]         = useState(today)
  const [pHours, setPHours]       = useState('')
  const [pStartTime, setPStart]   = useState('')
  const [pDescription, setPDesc]  = useState('')
  const [pSaving, setPSaving]     = useState(false)
  const [pError, setPError]       = useState<string | null>(null)

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

  // Plannings groupés par jour
  const planningsByDay = plannings.reduce<Record<string, MemberPlanning[]>>((acc, p) => {
    if (!acc[p.planned_date]) acc[p.planned_date] = []
    acc[p.planned_date].push(p)
    return acc
  }, {})
  const sortedPlanningDates = Object.keys(planningsByDay).sort()

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
