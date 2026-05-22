'use client'

import React, { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Clock, Users, Calendar, Filter, FileDown,
  PlusCircle, CheckCircle2, AlertCircle,
  X, Check,
} from 'lucide-react'
import type { GlobalPointage } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'
import {
  createMemberPointageAdmin,
  updatePointage,
} from '@/lib/data/mutations/chantiers'

function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

const USER_COLORS = [
  '#6366f1', '#3b82f6', '#22c55e', '#f59e0b',
  '#a855f7', '#ef4444', '#14b8a6', '#f97316',
  '#ec4899', '#84cc16', '#0ea5e9', '#d946ef',
]

function getUserColor(userId: string | null): string {
  if (!userId) return USER_COLORS[0]
  let h = 0
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return USER_COLORS[Math.abs(h) % USER_COLORS.length]
}

function getPersonKey(p: { user_id: string | null; member_id: string | null }): string {
  return p.user_id ?? `member_${p.member_id ?? 'unknown'}`
}

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

type Period = 'week' | 'month' | 'custom'

// ─── Modal d'édition d'un pointage ───────────────────────────────────────────

function EditPointageModal({
  pointage,
  onClose,
  onSaved,
}: {
  pointage: GlobalPointage
  onClose: () => void
  onSaved: () => void
}) {
  const [hours, setHours] = useState(String(pointage.hours))
  const [date, setDate] = useState(pointage.date)
  const [description, setDescription] = useState(pointage.description ?? '')
  const [status, setStatus] = useState<'idle' | 'saving' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleSave = () => {
    const h = parseFloat(hours)
    if (isNaN(h) || h <= 0) return
    setStatus('saving')
    startTransition(async () => {
      const res = await updatePointage(pointage.id, pointage.chantier_id, {
        hours: h,
        date,
        description: description.trim() || null,
      })
      if (res.error) {
        setErrorMsg(res.error)
        setStatus('error')
      } else {
        onSaved()
        onClose()
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50">
      <div className="w-full max-w-sm bg-surface rounded-2xl shadow-xl border border-[var(--elevation-border)] overflow-hidden dark:bg-[#121212]">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--elevation-border)]">
          <h3 className="font-semibold text-primary text-sm">Modifier le pointage</h3>
          <button onClick={onClose} className="text-secondary hover:text-primary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <p className="text-xs text-secondary mb-0.5">Personne</p>
            <p className="font-semibold text-primary text-sm">{pointage.user_name}</p>
            <p className="text-xs text-secondary">{pointage.chantier_title}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Date</label>
              <input
                type="date"
                className="input w-full text-sm"
                value={date}
                onChange={e => setDate(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Heures</label>
              <input
                type="number"
                className="input w-full text-sm"
                min="0.5"
                max="24"
                step="0.5"
                value={hours}
                onChange={e => setHours(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Description (opt.)</label>
            <input
              type="text"
              className="input w-full text-sm"
              placeholder="Travail effectué..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
          {status === 'error' && (
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 flex-shrink-0" /> {errorMsg}
            </p>
          )}
        </div>
        <div className="flex gap-3 px-5 pb-5">
          <button onClick={onClose} className="btn-secondary flex-1 text-sm">Annuler</button>
          <button
            onClick={handleSave}
            disabled={isPending || !hours || !date}
            className="btn-primary flex-1 text-sm flex items-center justify-center gap-2"
          >
            {isPending ? <Clock className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Enregistrer
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Panel pointage manuel membre ────────────────────────────────────────────

function PointageMemberPanel({
  members,
  chantiers,
}: {
  members: IndividualMember[]
  chantiers: { id: string; title: string }[]
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [selectedMember, setSelectedMember] = useState('')
  const [selectedChantier, setSelectedChantier] = useState('')
  const [date, setDate] = useState(today)
  const [hours, setHours] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedMember || !selectedChantier || !hours) return
    const h = parseFloat(hours)
    if (isNaN(h) || h <= 0) return
    setStatus('idle')
    startTransition(async () => {
      const result = await createMemberPointageAdmin(selectedChantier, selectedMember, {
        date,
        hours: h,
        description: description.trim() || null,
      })
      if (result.error) {
        setErrorMsg(result.error)
        setStatus('error')
      } else {
        setStatus('success')
        setHours('')
        setDescription('')
        setTimeout(() => setStatus('idle'), 3000)
      }
    })
  }

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-[var(--elevation-border)] flex items-center gap-2">
        <PlusCircle className="w-4 h-4 text-accent" />
        <p className="font-bold text-primary text-sm">Pointer les heures d&apos;un membre</p>
        <span className="text-xs text-secondary ml-1">— membres sans accès à l&apos;app</span>
      </div>
      <form onSubmit={handleSubmit} className="p-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Membre</label>
            <select
              className="input w-full text-sm"
              value={selectedMember}
              onChange={e => setSelectedMember(e.target.value)}
              required
            >
              <option value="">Sélectionner un membre...</option>
              {members.map(m => {
                const fullName = [m.prenom, m.name].filter(Boolean).join(' ')
                return <option key={m.id} value={m.id}>{fullName}{m.role_label ? ` - ${m.role_label}` : ''}</option>
              })}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Chantier</label>
            <select
              className="input w-full text-sm"
              value={selectedChantier}
              onChange={e => setSelectedChantier(e.target.value)}
              required
            >
              <option value="">Sélectionner un chantier...</option>
              {chantiers.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Date</label>
            <input
              type="date"
              className="input w-full text-sm"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Heures</label>
            <input
              type="number"
              className="input w-full text-sm"
              placeholder="ex : 7.5"
              min="0.5"
              max="24"
              step="0.5"
              value={hours}
              onChange={e => setHours(e.target.value)}
              required
            />
          </div>
          <div className="space-y-1 sm:col-span-1 col-span-2">
            <label className="text-xs font-semibold text-secondary uppercase tracking-wider">Description (opt.)</label>
            <input
              type="text"
              className="input w-full text-sm"
              placeholder="Travail effectué..."
              value={description}
              onChange={e => setDescription(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={isPending || !selectedMember || !selectedChantier || !hours}
            className="btn-primary text-sm flex items-center gap-2"
          >
            <Clock className="w-4 h-4" />
            {isPending ? 'Enregistrement...' : 'Pointer les heures'}
          </button>
          {status === 'success' && (
            <span className="text-sm text-green-600 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" /> Pointage enregistré
            </span>
          )}
          {status === 'error' && (
            <span className="text-sm text-red-600 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4" /> {errorMsg}
            </span>
          )}
        </div>
      </form>
    </div>
  )
}

// ─── Panel rapports PDF ───────────────────────────────────────────────────────

type ReportEntry = {
  id: string
  idType: 'member' | 'user'
  fullName: string
  roleLabel?: string | null
}

const MONTH_NAMES = ['Janv.', 'Févr.', 'Mars', 'Avr.', 'Mai', 'Juin', 'Juil.', 'Août', 'Sept.', 'Oct.', 'Nov.', 'Déc.']

function MemberReportsPanel({
  pointages,
  individualMembers,
}: {
  pointages: GlobalPointage[]
  individualMembers: IndividualMember[]
}) {
  // Déduplication : un membre fantôme avec profile_id = user_id d'un membre app
  // ne doit pas apparaître en double. On utilise member_profile_id du pointage directement.
  const members = useMemo<ReportEntry[]>(() => {
    const byUserId   = new Map<string, ReportEntry>()
    // member_id → member_profile_id (peut être null)
    const memberProfileMap = new Map<string, string | null>()

    for (const p of pointages) {
      if (p.user_id && !byUserId.has(p.user_id)) {
        byUserId.set(p.user_id, { id: p.user_id, idType: 'user', fullName: p.user_name })
      }
      if (p.member_id && !memberProfileMap.has(p.member_id)) {
        memberProfileMap.set(p.member_id, p.member_profile_id ?? null)
      }
    }

    // Construire les entrées membres fantômes, en excluant ceux liés à un user déjà présent
    const memberEntries: ReportEntry[] = []
    for (const [memberId, profileId] of memberProfileMap) {
      if (profileId && byUserId.has(profileId)) continue // doublon avec un user app
      const p = pointages.find(pt => pt.member_id === memberId)!
      const info = individualMembers.find(m => m.id === memberId)
      const fullName = info
        ? ([info.prenom, info.name].filter(Boolean).join(' ') || (info.name ?? p.user_name))
        : p.user_name
      memberEntries.push({ id: memberId, idType: 'member', fullName, roleLabel: info?.role_label })
    }

    return [...byUserId.values(), ...memberEntries]
      .sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'))
  }, [pointages, individualMembers])

  const now = new Date()
  const thisYear      = now.getFullYear()
  const defaultYear   = thisYear
  const defaultMonthIdx = now.getMonth() // 0-based, mois en cours
  const yearOptions   = Array.from({ length: 5 }, (_, i) => thisYear - i)

  const [modes,         setModes]         = useState<Record<string, 'month' | 'year'>>({})
  const [monthIdxs,     setMonthIdxs]     = useState<Record<string, number>>({})
  const [selectedYears, setSelectedYears] = useState<Record<string, number>>({})

  const getMode     = (id: string) => modes[id]          ?? 'month'
  const getMonthIdx = (id: string) => monthIdxs[id]      ?? defaultMonthIdx
  const getYear     = (id: string) => selectedYears[id]  ?? defaultYear

  const handleDownload = (m: ReportEntry) => {
    const mode = getMode(m.id)
    const y    = getYear(m.id)
    let dateFrom: string, dateTo: string
    if (mode === 'year') {
      dateFrom = `${y}-01-01`
      dateTo   = `${y}-12-31`
    } else {
      const mo = getMonthIdx(m.id) + 1 // 1-based
      dateFrom = `${y}-${String(mo).padStart(2, '0')}-01`
      dateTo   = new Date(y, mo, 0).toISOString().slice(0, 10)
    }
    const params = new URLSearchParams({ from: dateFrom, to: dateTo, download: '1', type: m.idType })
    window.open(`/api/pdf/member/${m.id}?${params.toString()}`, '_blank')
  }

  if (members.length === 0) return null

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-[var(--elevation-border)] flex items-center gap-2">
        <FileDown className="w-4 h-4 text-accent" />
        <p className="font-bold text-primary text-sm">Rapports d&apos;heures - par membre</p>
      </div>
      <div className="divide-y divide-[var(--elevation-border)]">
        {members.map(m => (
          <div key={m.id} className="flex items-center gap-3 p-3 flex-wrap">
            <div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center font-bold text-sm flex-shrink-0">
              {(m.fullName?.[0] ?? '?').toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm text-primary truncate">{m.fullName}</p>
              {m.roleLabel && <p className="text-xs text-secondary">{m.roleLabel}</p>}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
              <select
                className="input text-xs px-1.5 py-1 h-7 w-20"
                value={getMode(m.id)}
                onChange={e => setModes(prev => ({ ...prev, [m.id]: e.target.value as 'month' | 'year' }))}
              >
                <option value="month">Mois</option>
                <option value="year">Année</option>
              </select>
              {getMode(m.id) === 'month' && (
                <select
                  className="input text-xs px-1.5 py-1 h-7 w-20"
                  value={getMonthIdx(m.id)}
                  onChange={e => setMonthIdxs(prev => ({ ...prev, [m.id]: Number(e.target.value) }))}
                >
                  {MONTH_NAMES.map((name, i) => (
                    <option key={i} value={i}>{name}</option>
                  ))}
                </select>
              )}
              <select
                className="input text-xs px-1.5 py-1 h-7 w-20"
                value={getYear(m.id)}
                onChange={e => setSelectedYears(prev => ({ ...prev, [m.id]: Number(e.target.value) }))}
              >
                {yearOptions.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <button
                onClick={() => handleDownload(m)}
                className="btn-secondary text-xs flex items-center gap-1.5 py-1 px-2.5"
              >
                <FileDown className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function HeuresGlobalesClient({
  initialPointages,
  individualMembers = [],
  chantiers = [],
  canManage = false,
}: {
  initialPointages: GlobalPointage[]
  individualMembers?: IndividualMember[]
  chantiers?: { id: string; title: string }[]
  canManage?: boolean
}) {
  const today = new Date()
  const [period, setPeriod] = useState<Period>('week')
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today))
  const [selectedMonthIdx, setSelectedMonthIdx] = useState(() => today.getMonth())
  const [selectedMonthYear, setSelectedMonthYear] = useState(() => today.getFullYear())
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(getWeekStart(today)))
  const [customTo, setCustomTo] = useState(toLocalDateStr(today))
  const [selectedChantier, setSelectedChantier] = useState('')
  const [selectedUser, setSelectedUser] = useState('')

  // Gestion edition
  const [editingPointage, setEditingPointage] = useState<GlobalPointage | null>(null)
  const [, startDeleteTransition] = useTransition()

  // Seuil d'alerte : pointage > 12h sur une journée = potentiellement oublié de pointer la fin
  const HOURS_ALERT_THRESHOLD = 12

  const chantiersFilter = useMemo(() => {
    const map = new Map<string, string>()
    initialPointages.forEach(p => map.set(p.chantier_id, p.chantier_title))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [initialPointages])

  const users = useMemo(() => {
    const map = new Map<string, string>()
    initialPointages.forEach(p => map.set(getPersonKey(p), p.user_name))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [initialPointages])

  const { fromStr, toStr } = useMemo(() => {
    if (period === 'week') {
      const end = new Date(weekStart)
      end.setDate(end.getDate() + 6)
      return { fromStr: toLocalDateStr(weekStart), toStr: toLocalDateStr(end) }
    }
    if (period === 'month') {
      const y = selectedMonthYear
      const m = selectedMonthIdx + 1
      const monthStr = `${y}-${String(m).padStart(2, '0')}`
      const last = new Date(y, m, 0)
      return { fromStr: `${monthStr}-01`, toStr: toLocalDateStr(last) }
    }
    return { fromStr: customFrom, toStr: customTo }
  }, [period, weekStart, selectedMonthIdx, selectedMonthYear, customFrom, customTo])

  const filtered = useMemo(() => {
    return initialPointages.filter(p => {
      if (p.date < fromStr || p.date > toStr) return false
      if (selectedChantier && p.chantier_id !== selectedChantier) return false
      if (selectedUser && getPersonKey(p) !== selectedUser) return false
      return true
    })
  }, [initialPointages, fromStr, toStr, selectedChantier, selectedUser])

  const byUser = useMemo(() => {
    const map = new Map<string, { name: string; hours: number; chantiers: Set<string> }>()
    filtered.forEach(p => {
      const key = getPersonKey(p)
      const existing = map.get(key)
      if (existing) {
        existing.hours += p.hours
        existing.chantiers.add(p.chantier_id)
      } else {
        map.set(key, { name: p.user_name, hours: p.hours, chantiers: new Set([p.chantier_id]) })
      }
    })
    return [...map.entries()]
      .map(([uid, v]) => ({ uid, ...v, chantierCount: v.chantiers.size }))
      .sort((a, b) => b.hours - a.hours)
  }, [filtered])

  const byChantier = useMemo(() => {
    const map = new Map<string, { title: string; hours: number; members: Set<string> }>()
    filtered.forEach(p => {
      const key = getPersonKey(p)
      const existing = map.get(p.chantier_id)
      if (existing) {
        existing.hours += p.hours
        existing.members.add(key)
      } else {
        map.set(p.chantier_id, { title: p.chantier_title, hours: p.hours, members: new Set([key]) })
      }
    })
    return [...map.entries()]
      .map(([cid, v]) => ({ cid, ...v, memberCount: v.members.size }))
      .sort((a, b) => b.hours - a.hours)
  }, [filtered])

  const totalHours = filtered.reduce((s, p) => s + p.hours, 0)

  const periodLabel = period === 'week'
    ? `Sem. du ${weekStart.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })}`
    : period === 'month'
    ? new Date(selectedMonthYear, selectedMonthIdx, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : `${customFrom} → ${customTo}`

  return (
    <div className="page-container space-y-6" style={{ maxWidth: '72rem' }}>
      <div className="flex items-center justify-between">
        <Link href="/chantiers" className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Retour aux chantiers
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-extrabold text-primary flex items-center gap-3">
          <Clock className="w-7 h-7 text-accent" />
          Heures pointées
        </h1>
        <p className="text-secondary text-sm mt-1">Vue globale par personne et par chantier</p>
      </div>

      {/* Filtres */}
      <div className="card p-4 space-y-4">
        <div className="flex flex-wrap gap-2 items-center">
          <Filter className="w-4 h-4 text-secondary" />
          {(['week', 'month', 'custom'] as Period[]).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors ${period === p ? 'bg-accent text-white border-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
            >
              {p === 'week' ? 'Semaine' : p === 'month' ? 'Mois' : 'Personnalisé'}
            </button>
          ))}
        </div>

        {period === 'week' && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }}
              className="p-2 rounded-lg border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-primary min-w-40 text-center">{periodLabel}</span>
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }}
              className="p-2 rounded-lg border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors"
            >
              ›
            </button>
            <button onClick={() => setWeekStart(getWeekStart(today))} className="text-xs text-accent hover:underline">
              Cette semaine
            </button>
          </div>
        )}

        {period === 'month' && (
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (selectedMonthIdx === 0) { setSelectedMonthIdx(11); setSelectedMonthYear(y => y - 1) }
                else setSelectedMonthIdx(i => i - 1)
              }}
              className="p-2 rounded-lg border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors"
            >
              ‹
            </button>
            <div className="flex items-center gap-1.5">
              <select
                className="input text-sm py-1 px-2"
                value={selectedMonthIdx}
                onChange={e => setSelectedMonthIdx(Number(e.target.value))}
              >
                {['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'].map((name, i) => (
                  <option key={i} value={i}>{name}</option>
                ))}
              </select>
              <select
                className="input text-sm py-1 px-2"
                value={selectedMonthYear}
                onChange={e => setSelectedMonthYear(Number(e.target.value))}
              >
                {Array.from({ length: 5 }, (_, i) => today.getFullYear() - 3 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                if (selectedMonthIdx === 11) { setSelectedMonthIdx(0); setSelectedMonthYear(y => y + 1) }
                else setSelectedMonthIdx(i => i + 1)
              }}
              className="p-2 rounded-lg border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors"
            >
              ›
            </button>
            <button
              onClick={() => { setSelectedMonthIdx(today.getMonth()); setSelectedMonthYear(today.getFullYear()) }}
              className="text-xs text-accent hover:underline"
            >
              Ce mois-ci
            </button>
          </div>
        )}

        {period === 'custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" className="input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-secondary">→</span>
            <input type="date" className="input" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <select className="input text-sm" value={selectedChantier} onChange={e => setSelectedChantier(e.target.value)}>
            <option value="">Tous les chantiers</option>
            {chantiersFilter.map(([cid, title]) => <option key={cid} value={cid}>{title}</option>)}
          </select>
          <select className="input text-sm" value={selectedUser} onChange={e => setSelectedUser(e.target.value)}>
            <option value="">Toutes les personnes</option>
            {users.map(([uid, name]) => <option key={uid} value={uid}>{name}</option>)}
          </select>
        </div>
      </div>

      {/* Résumé */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="card p-4">
          <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Total heures</p>
          <p className="text-3xl font-extrabold text-primary mt-1">{fmtHours(totalHours)}</p>
          <p className="text-xs text-secondary mt-1">{periodLabel}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Personnes</p>
          <p className="text-3xl font-extrabold text-primary mt-1">{byUser.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Chantiers</p>
          <p className="text-3xl font-extrabold text-primary mt-1">{byChantier.length}</p>
        </div>
        <div className="card p-4">
          <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Pointages</p>
          <p className="text-3xl font-extrabold text-primary mt-1">{filtered.length}</p>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Clock className="w-12 h-12 text-secondary opacity-40 mx-auto mb-3" />
          <p className="text-secondary font-semibold">Aucun pointage sur cette période</p>
        </div>
      ) : (
        <div className="grid md:grid-cols-2 gap-6">
          {/* Par personne */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--elevation-border)] flex items-center gap-2">
              <Users className="w-4 h-4 text-accent" />
              <p className="font-bold text-primary text-sm">Par personne</p>
            </div>
            <div className="divide-y divide-[var(--elevation-border)]">
              {byUser.map(({ uid, name, hours, chantierCount }) => (
                <div key={uid} className="flex items-center gap-3 p-3">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                    style={{ backgroundColor: getUserColor(uid) }}
                  >
                    {name[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-primary truncate">{name}</p>
                    <p className="text-xs text-secondary">{chantierCount} chantier{chantierCount > 1 ? 's' : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-primary">{fmtHours(hours)}</p>
                    <p className="text-xs text-secondary">{Math.round((hours / totalHours) * 100)}%</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Par chantier */}
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--elevation-border)] flex items-center gap-2">
              <Calendar className="w-4 h-4 text-accent" />
              <p className="font-bold text-primary text-sm">Par chantier</p>
            </div>
            <div className="divide-y divide-[var(--elevation-border)]">
              {byChantier.map(({ cid, title, hours, memberCount }) => (
                <Link key={cid} href={`/chantiers/${cid}`} className="flex items-center gap-3 p-3 hover:bg-[var(--elevation-1)] transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-primary truncate">{title}</p>
                    <p className="text-xs text-secondary">{memberCount} personne{memberCount > 1 ? 's' : ''}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-extrabold text-primary">{fmtHours(hours)}</p>
                    <p className="text-xs text-secondary">{Math.round((hours / totalHours) * 100)}%</p>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Pointage manuel pour membres sans accès app */}
      {canManage && individualMembers.length > 0 && (
        <PointageMemberPanel members={individualMembers} chantiers={chantiers} />
      )}

      {/* Rapport PDF par membre */}
      {canManage && initialPointages.length > 0 && (
        <MemberReportsPanel pointages={initialPointages} individualMembers={individualMembers} />
      )}

      {/* Détail des pointages — regroupé par personne + chantier */}
      {filtered.length > 0 && (() => {
        // Regrouper par (personKey, chantier_id)
        type GroupKey = string
        type Group = {
          personKey: string
          user_name: string
          member_id: string | null
          chantier_id: string
          chantier_title: string
          hours: number
          hasAlert: boolean
        }
        const groupMap = new Map<GroupKey, Group>()
        for (const p of filtered) {
          const pk = getPersonKey(p)
          const key = `${pk}__${p.chantier_id}`
          const existing = groupMap.get(key)
          if (existing) {
            existing.hours += p.hours
            if (p.hours >= HOURS_ALERT_THRESHOLD) existing.hasAlert = true
          } else {
            groupMap.set(key, {
              personKey: pk,
              user_name: p.user_name,
              member_id: p.member_id,
              chantier_id: p.chantier_id,
              chantier_title: p.chantier_title,
              hours: p.hours,
              hasAlert: p.hours >= HOURS_ALERT_THRESHOLD,
            })
          }
        }
        const groups = Array.from(groupMap.values()).sort((a, b) =>
          a.user_name.localeCompare(b.user_name, 'fr') || a.chantier_title.localeCompare(b.chantier_title, 'fr')
        )

        return (
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-[var(--elevation-border)] flex items-center justify-between gap-3">
              <p className="font-bold text-primary text-sm">Détail des pointages</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                    <th className="text-left px-4 py-2 text-xs font-semibold text-secondary uppercase tracking-wider whitespace-nowrap">Personne</th>
                    <th className="text-left px-4 py-2 text-xs font-semibold text-secondary uppercase tracking-wider whitespace-nowrap">Chantier</th>
                    <th className="text-right px-4 py-2 text-xs font-semibold text-secondary uppercase tracking-wider whitespace-nowrap">Heures</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--elevation-border)]">
                  {groups.map(g => (
                    <tr key={`${g.personKey}__${g.chantier_id}`} className="hover:bg-[var(--elevation-1)] transition-colors">
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ backgroundColor: getUserColor(g.personKey) }}>
                            {g.user_name[0]?.toUpperCase() ?? '?'}
                          </div>
                          <span className="font-medium text-primary">
                            {g.user_name}
                            {g.member_id && <span className="ml-1 text-xs text-secondary">(ext.)</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link href={`/chantiers/${g.chantier_id}`} className="text-primary hover:text-accent transition-colors">
                          {g.chantier_title}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-primary">{fmtHours(g.hours)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                    <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold text-secondary uppercase tracking-wider">Total</td>
                    <td className="px-4 py-2.5 text-right font-extrabold text-primary">{fmtHours(totalHours)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        )
      })()}

      {/* Modal d'édition */}
      {editingPointage && (
        <EditPointageModal
          pointage={editingPointage}
          onClose={() => setEditingPointage(null)}
          onSaved={() => setEditingPointage(null)}
        />
      )}
    </div>
  )
}
