'use client'

import React, { useState, useMemo, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Clock, Users, Calendar, Filter, FileDown,
  PlusCircle, CheckCircle2, AlertCircle,
  X, Check, ChevronDown, ChevronUp, Loader2, UserX,
} from 'lucide-react'
import type { GlobalPointage, MissingPointageSlot } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'
import {
  createMemberPointageAdmin,
  updatePointage,
} from '@/lib/data/mutations/chantiers'
import { declareMemberAbsence } from '@/lib/data/mutations/absences'

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
  const defaultMonthIdx = now.getMonth()
  const minYear = thisYear - 1

  // "YYYY-MM" ou "YYYY" (année complète)
  const [selections, setSelections] = useState<Record<string, string>>({})

  const getSelection = (id: string) => selections[id] ?? `${thisYear}-${String(defaultMonthIdx + 1).padStart(2, '0')}`

  const stepMonth = (id: string, dir: 1 | -1) => {
    const sel = getSelection(id)
    if (sel.length === 4) return // mode année, pas de navigation
    const [y, m] = sel.split('-').map(Number)
    let nm = m + dir, ny = y
    if (nm > 12) { nm = 1; ny++ }
    if (nm < 1)  { nm = 12; ny-- }
    if (ny < minYear || ny > thisYear) return
    setSelections(prev => ({ ...prev, [id]: `${ny}-${String(nm).padStart(2, '0')}` }))
  }

  const handleDownload = (m: ReportEntry) => {
    const sel = getSelection(m.id)
    let dateFrom: string, dateTo: string
    if (sel.length === 4) {
      dateFrom = `${sel}-01-01`
      dateTo   = `${sel}-12-31`
    } else {
      const [y, mo] = sel.split('-').map(Number)
      dateFrom = `${sel}-01`
      dateTo   = new Date(y, mo, 0).toISOString().slice(0, 10)
    }
    const params = new URLSearchParams({ from: dateFrom, to: dateTo, download: '1', type: m.idType })
    window.open(`/api/pdf/member/${m.id}?${params.toString()}`, '_blank')
  }

  const buildSelectOptions = () => {
    const opts: { value: string; label: string }[] = []
    for (let y = thisYear; y >= minYear; y--) {
      opts.push({ value: String(y), label: `Année ${y}` })
      for (let mo = 12; mo >= 1; mo--) {
        const val = `${y}-${String(mo).padStart(2, '0')}`
        const label = new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
        opts.push({ value: val, label })
      }
    }
    return opts
  }
  const selectOptions = buildSelectOptions()

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
            {/* min-w-[8rem] : garantit un nom lisible ; sinon les contrôles passent à la ligne (flex-wrap) sur mobile */}
            <div className="flex-1 min-w-[8rem]">
              <p className="font-semibold text-sm text-primary truncate">{m.fullName}</p>
              {m.roleLabel && <p className="text-xs text-secondary">{m.roleLabel}</p>}
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
              <button
                onClick={() => stepMonth(m.id, -1)}
                disabled={getSelection(m.id).length === 4}
                title="Mois précédent"
                aria-label="Mois précédent"
                className="btn-secondary text-xs py-1 px-2 h-7 disabled:opacity-30"
              >
                &lsaquo;
              </button>
              <select
                className="input text-xs px-1.5 py-1 h-7"
                style={{ minWidth: '9rem' }}
                value={getSelection(m.id)}
                onChange={e => setSelections(prev => ({ ...prev, [m.id]: e.target.value }))}
              >
                {selectOptions.map(opt => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <button
                onClick={() => stepMonth(m.id, 1)}
                disabled={getSelection(m.id).length === 4}
                title="Mois suivant"
                aria-label="Mois suivant"
                className="btn-secondary text-xs py-1 px-2 h-7 disabled:opacity-30"
              >
                &rsaquo;
              </button>
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

// ─── Accordéon par personne → chantiers ──────────────────────────────────────

function PersonAccordion({
  groups,
  totalHours,
}: {
  groups: { key: string; name: string; total: number; chantiers: { id: string; title: string; hours: number; count: number }[] }[]
  totalHours: number
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })

  return (
    <div className="card overflow-hidden divide-y divide-[var(--elevation-border)]">
      <div className="p-4 border-b border-[var(--elevation-border)] flex items-center gap-2">
        <Users className="w-4 h-4 text-accent" />
        <p className="font-bold text-primary text-sm">Détail par personne</p>
      </div>
      {groups.map(g => {
        const isOpen = open.has(g.key)
        const sorted = [...g.chantiers].sort((a, b) => b.hours - a.hours)
        return (
          <div key={g.key}>
            <button
              onClick={() => toggle(g.key)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--elevation-1)] transition-colors text-left"
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                style={{ backgroundColor: getUserColor(g.key) }}
              >
                {g.name[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-primary truncate">{g.name}</p>
                <p className="text-xs text-secondary">
                  {g.chantiers.length} chantier{g.chantiers.length > 1 ? 's' : ''} · {Math.round((g.total / totalHours) * 100)}%
                </p>
              </div>
              <p className="font-extrabold text-primary text-sm flex-shrink-0">{fmtHours(g.total)}</p>
              {isOpen
                ? <ChevronUp className="w-4 h-4 text-secondary flex-shrink-0" />
                : <ChevronDown className="w-4 h-4 text-secondary flex-shrink-0" />}
            </button>
            {isOpen && (
              <div className="border-t border-[var(--elevation-border)] bg-[var(--elevation-1)]/40 divide-y divide-[var(--elevation-border)]">
                {sorted.map(c => (
                  <div key={c.id} className="flex items-center gap-3 px-6 py-2.5">
                    <div className="flex-1 min-w-0">
                      <Link href={`/chantiers/${c.id}`} className="text-sm text-primary hover:text-accent transition-colors truncate block">
                        {c.title}
                      </Link>
                      <p className="text-xs text-secondary">{c.count} pointage{c.count > 1 ? 's' : ''}</p>
                    </div>
                    <p className="font-semibold text-sm text-primary flex-shrink-0">{fmtHours(c.hours)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
      <div className="flex items-center justify-between px-4 py-3 bg-[var(--elevation-1)]/60">
        <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Total</p>
        <p className="font-extrabold text-primary">{fmtHours(totalHours)}</p>
      </div>
    </div>
  )
}

// ─── Pointages à vérifier (créneaux passés sans pointage) ────────────────────

function slotDefaultHours(slot: MissingPointageSlot): number {
  if (slot.start_time && slot.end_time) {
    const [sh, sm] = slot.start_time.split(':').map(Number)
    const [eh, em] = slot.end_time.split(':').map(Number)
    const h = (eh * 60 + em - sh * 60 - sm) / 60
    if (h > 0 && h <= 24) return Math.round(h * 100) / 100
  }
  if (slot.duration_min && slot.duration_min > 0) return Math.round((slot.duration_min / 60) * 100) / 100
  return 7
}

function slotWho(slot: MissingPointageSlot): string {
  return slot.member_name
    ?? (slot.equipe_name ? `Équipe ${slot.equipe_name}` : null)
    ?? (slot.label?.trim() || null)
    ?? (slot.team_size ? `${slot.team_size} personne${slot.team_size > 1 ? 's' : ''}` : 'Intervenant non renseigné')
}

function fmtDateFr(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long' })
}

function MissingPointagesSection({
  slots,
  individualMembers,
}: {
  slots: MissingPointageSlot[]
  individualMembers: IndividualMember[]
}) {
  const router = useRouter()
  const [resolved, setResolved] = useState<Set<string>>(new Set())
  const [openForm, setOpenForm] = useState<string | null>(null)
  const [formHours, setFormHours] = useState('')
  const [formMemberId, setFormMemberId] = useState('')
  const [busy, setBusy] = useState<{ id: string; kind: 'pointer' | 'absent' } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = slots.filter(s => !resolved.has(s.id))
  if (visible.length === 0) return null

  function openPointerForm(slot: MissingPointageSlot) {
    setError(null)
    setOpenForm(slot.id)
    setFormHours(String(slotDefaultHours(slot)))
    setFormMemberId(slot.member_id ?? '')
  }

  async function confirmPointer(slot: MissingPointageSlot) {
    const hours = Number(formHours.replace(',', '.'))
    if (!formMemberId) { setError('Sélectionnez le membre à pointer.'); return }
    if (!Number.isFinite(hours) || hours <= 0 || hours > 24) { setError('Nombre d\'heures invalide.'); return }
    setBusy({ id: slot.id, kind: 'pointer' })
    setError(null)
    const res = await createMemberPointageAdmin(slot.chantier_id, formMemberId, {
      date: slot.planned_date,
      hours,
      description: slot.label?.trim() || 'Pointage régularisé',
      start_time: slot.start_time,
    })
    setBusy(null)
    if (res.error) { setError(res.error); return }
    setResolved(prev => new Set(prev).add(slot.id))
    setOpenForm(null)
    router.refresh()
  }

  async function markAbsent(slot: MissingPointageSlot) {
    if (!slot.member_id) return
    setBusy({ id: slot.id, kind: 'absent' })
    setError(null)
    const res = await declareMemberAbsence({
      memberId: slot.member_id,
      startDate: slot.planned_date,
      endDate: slot.planned_date,
      reason: 'Absence constatée (créneau non pointé)',
    })
    setBusy(null)
    if (res.error) { setError(res.error); return }
    setResolved(prev => new Set(prev).add(slot.id))
    router.refresh()
  }

  return (
    <div className="card p-4 border border-red-500/30 space-y-3">
      <div className="flex items-center gap-2">
        <AlertCircle className="w-5 h-5 text-red-500" />
        <h2 className="font-bold text-primary text-sm">
          {visible.length} pointage{visible.length > 1 ? 's' : ''} à vérifier
        </h2>
      </div>
      <p className="text-xs text-secondary">
        Ces créneaux planifiés sont passés sans aucune heure pointée. Contactez la personne concernée,
        puis pointez les heures si c'est un oubli, ou déclarez une absence.
      </p>
      {error && (
        <div className="text-xs text-red-500 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5" /> {error}</div>
      )}
      <div className="divide-y divide-[var(--elevation-border)]">
        {visible.map(slot => {
          const isBusy = busy?.id === slot.id
          return (
            <div key={slot.id} className="py-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-primary">{slotWho(slot)}</p>
                  <p className="text-xs text-secondary">
                    {fmtDateFr(slot.planned_date)}
                    {slot.start_time ? ` · ${slot.start_time.slice(0, 5)}${slot.end_time ? ` – ${slot.end_time.slice(0, 5)}` : ''}` : ''}
                    {' · '}{slot.chantier_title}
                    {slot.label?.trim() ? ` · ${slot.label.trim()}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openForm === slot.id ? setOpenForm(null) : openPointerForm(slot)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isBusy && busy?.kind === 'pointer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Pointer les heures
                  </button>
                  {slot.member_id && (
                    <button
                      onClick={() => markAbsent(slot)}
                      disabled={isBusy}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-red-500/40 text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {isBusy && busy?.kind === 'absent' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserX className="w-3.5 h-3.5" />}
                      Marquer absent
                    </button>
                  )}
                </div>
              </div>
              {openForm === slot.id && (
                <div className="flex flex-wrap items-end gap-2 bg-base rounded-lg p-3">
                  {!slot.member_id && (
                    <label className="text-xs text-secondary space-y-1">
                      <span>Membre</span>
                      <select
                        value={formMemberId}
                        onChange={e => setFormMemberId(e.target.value)}
                        className="block bg-transparent border border-[var(--elevation-border)] rounded-lg px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
                      >
                        <option value="">Choisir…</option>
                        {individualMembers.map(m => (
                          <option key={m.id} value={m.id}>{[m.prenom, m.name].filter(Boolean).join(' ')}</option>
                        ))}
                      </select>
                    </label>
                  )}
                  <label className="text-xs text-secondary space-y-1">
                    <span>Heures</span>
                    <input
                      type="number" min={0.5} max={24} step={0.5}
                      value={formHours}
                      onChange={e => setFormHours(e.target.value)}
                      className="block w-24 bg-transparent border border-[var(--elevation-border)] rounded-lg px-2 py-1.5 text-sm text-primary outline-none focus:border-accent"
                    />
                  </label>
                  <button
                    onClick={() => confirmPointer(slot)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {isBusy && busy?.kind === 'pointer' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Confirmer
                  </button>
                  <button
                    onClick={() => setOpenForm(null)}
                    disabled={isBusy}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-secondary hover:text-primary transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              )}
            </div>
          )
        })}
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
  missingSlots = [],
}: {
  initialPointages: GlobalPointage[]
  individualMembers?: IndividualMember[]
  chantiers?: { id: string; title: string }[]
  canManage?: boolean
  missingSlots?: MissingPointageSlot[]
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
  const currentYear = today.getFullYear()
  const minMonthYear = currentYear - 1
  const isAtMinMonth = selectedMonthYear === minMonthYear && selectedMonthIdx === 0
  const isAtCurrentMonth = selectedMonthYear === currentYear && selectedMonthIdx === today.getMonth()

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

      {canManage && (
        <MissingPointagesSection slots={missingSlots} individualMembers={individualMembers} />
      )}

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
              disabled={isAtMinMonth}
              className="p-2 rounded-lg border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors disabled:opacity-30"
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
                {[currentYear, minMonthYear].map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => {
                if (selectedMonthIdx === 11) { setSelectedMonthIdx(0); setSelectedMonthYear(y => y + 1) }
                else setSelectedMonthIdx(i => i + 1)
              }}
              disabled={isAtCurrentMonth}
              className="p-2 rounded-lg border border-[var(--elevation-border)] text-secondary hover:text-primary transition-colors disabled:opacity-30"
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

      {/* Accordéon par personne → chantiers */}
      {filtered.length > 0 && (() => {
        type ChantierEntry = { id: string; title: string; hours: number; count: number }
        type PersonGroup = { key: string; name: string; total: number; chantiers: ChantierEntry[] }

        const personMap = new Map<string, PersonGroup>()
        for (const p of filtered) {
          const pk = getPersonKey(p)
          let person = personMap.get(pk)
          if (!person) {
            person = { key: pk, name: p.user_name, total: 0, chantiers: [] }
            personMap.set(pk, person)
          }
          person.total += p.hours
          const existing = person.chantiers.find(c => c.id === p.chantier_id)
          if (existing) { existing.hours += p.hours; existing.count++ }
          else person.chantiers.push({ id: p.chantier_id, title: p.chantier_title, hours: p.hours, count: 1 })
        }
        const groups = [...personMap.values()].sort((a, b) => b.total - a.total)

        return <PersonAccordion groups={groups} totalHours={totalHours} />
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
