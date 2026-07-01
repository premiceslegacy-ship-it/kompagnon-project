'use client'

import React, { useState, useRef, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AddressLink } from '@/components/shared/AddressLink'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext, sortableKeyboardCoordinates, useSortable,
  verticalListSortingStrategy, arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  ArrowLeft, Calendar, Euro, GripVertical, Plus, Trash2,
  Clock, Camera, FileText, CheckCircle2, Circle, Timer, Download,
  ChevronRight, TrendingUp,
  Users, UserPlus, RefreshCw, ChevronLeft, ChevronDown, ChevronUp, X,
  Phone, Mail, User, Pencil, Check, Sparkles, Loader2, Send,
} from 'lucide-react'
import type { ChantierDetail, Tache, TacheStatus, Pointage, ChantierPhoto, ChantierNote, Equipe, ChantierPlanning } from '@/lib/data/queries/chantiers'
import type { QuoteStub } from '@/lib/data/queries/quotes'
import type { TeamMember } from '@/lib/data/queries/team'
import type { OrgRole } from '@/lib/data/queries/roles'
import { getQuoteItemsForSuggestions } from '@/lib/data/mutations/quotes'
import {
  createTache, updateTache, deleteTache, reorderTaches,
  createPointage, createMemberPointageAdmin, deletePointage,
  createChantierNote, deleteChantierNote,
  uploadChantierPhoto, deleteChantierPhoto, updateChantierPhotoCaption, updateChantierPhotoTitle,
  togglePhotoReportFlag,
  updateChantier,
  generateChantierPeriodInvoice,
  createEquipe, deleteEquipe, addEquipeMembre, removeEquipeMembre, updateEquipeMembreTaux, updateEquipeMembreProfile,
  assignEquipeToChantier, removeEquipeFromChantier,
  createChantierPlanning, deleteChantierPlanning,
} from '@/lib/data/mutations/chantiers'
import { sendChantierReportEmail } from '@/lib/data/mutations/chantier-report-email'
import { sendChantierPhotosEmail } from '@/lib/data/mutations/chantier-photos-email'
import { todayParis } from '@/lib/utils'
import RentabiliteTab, { type DeletedPointageInfo } from './RentabiliteTab'
import IndividualMembersSection from './IndividualMembersSection'
import JalonsTab from './JalonsTab'
import ReceptionTab from './ReceptionTab'
import type { ChantierReserve } from '@/lib/data/queries/chantiers'
import type { ChantierProfitability } from '@/lib/data/queries/chantier-profitability'
import type { ChantierJalon } from '@/lib/data/queries/chantier-jalons'
import type { IndividualMember } from '@/lib/data/queries/members'
import ChantierAIAssistant from '@/components/ai/ChantierAIAssistant'
import SituationsSection from '@/components/situations/SituationsSection'
import ClientEmailRequiredModal from '@/components/ClientEmailRequiredModal'
import { AssistantAvatar } from '@/components/ai/AssistantAvatar'
import type { SituationsSummary } from '@/lib/data/queries/invoices'
import AICreditsErrorModal from '@/components/shared/AICreditsErrorModal'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convertit des heures décimales en format lisible : 1.5 → "1h30" */
function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

function RoleLabelSelect({
  value,
  onChange,
  roles,
  className = 'input w-full text-sm',
}: {
  value: string
  onChange: (value: string) => void
  roles: OrgRole[]
  className?: string
}) {
  if (roles.length === 0) {
    return (
      <input
        className={className}
        placeholder="Rôle"
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    )
  }

  const hasCustomValue = value && !roles.some(role => role.name === value)

  return (
    <select
      className={className}
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">Sans rôle</option>
      {hasCustomValue && <option value={value}>{value}</option>}
      {roles.map(role => (
        <option key={role.id} value={role.name}>{role.name}</option>
      ))}
    </select>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'taches' | 'jalons' | 'planning' | 'pointages' | 'photos' | 'notes' | 'equipes' | 'rentabilite' | 'reception'
type BillingPeriod = 'none' | 'mensuelle' | 'bimestrielle' | 'trimestrielle' | 'annuelle'

type ChantierPermissions = {
  canEditChantier: boolean
  canManageTeam: boolean
  canPointage: boolean
  canManagePointages: boolean
  canViewExpenses: boolean
  canCreateExpenses: boolean
  canEditExpenses: boolean
  canDeleteExpenses: boolean
  canEditRates: boolean
}

const STATUS_CYCLE: Record<TacheStatus, TacheStatus> = {
  a_faire: 'en_cours',
  en_cours: 'termine',
  termine: 'a_faire',
}

const TACHE_STATUS_CONFIG: Record<TacheStatus, { label: string; color: string; icon: React.ReactNode }> = {
  a_faire:  { label: 'À faire',  color: 'text-secondary',    icon: <Circle className="w-4 h-4" /> },
  en_cours: { label: 'En cours', color: 'text-blue-500',     icon: <Timer className="w-4 h-4" /> },
  termine:  { label: 'Terminé',  color: 'text-green-500',    icon: <CheckCircle2 className="w-4 h-4" /> },
}

const CHANTIER_STATUS_CONFIG = {
  planifie:  { label: 'Planifié',  color: 'bg-blue-500/15 text-blue-500' },
  en_cours:  { label: 'En cours',  color: 'bg-green-500/15 text-green-600' },
  suspendu:  { label: 'Suspendu',  color: 'bg-amber-500/15 text-amber-500' },
  termine:   { label: 'Terminé',   color: 'bg-secondary/20 text-secondary' },
  annule:    { label: 'Annulé',    color: 'bg-red-500/15 text-red-500' },
}

// ─── Constants ────────────────────────────────────────────────────────────────

const RECURRENCE_LABELS: Record<string, string> = {
  quotidien:         'Tous les jours',
  plurihebdomadaire: 'fois/semaine',
  hebdomadaire:      'Toutes les semaines',
  mensuel:           'Tous les mois',
  bimensuel:         'Tous les 2 mois',
  trimestriel:       'Tous les trimestres',
}

const BILLING_PERIOD_OPTIONS = [
  { value: 'none', label: 'Pas de facturation périodique' },
  { value: 'mensuelle', label: 'Mensuelle' },
  { value: 'bimestrielle', label: 'Tous les 2 mois' },
  { value: 'trimestrielle', label: 'Trimestrielle' },
  { value: 'annuelle', label: 'Annuelle' },
] as const

const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

function splitDateParts(date: string | null | undefined) {
  if (!date) {
    const now = new Date()
    return {
      day: String(Math.min(now.getDate(), 28)),
      month: String(now.getMonth() + 1),
      year: String(now.getFullYear()),
    }
  }
  const [year, month, day] = date.split('-')
  return { day: String(Number(day)), month: String(Number(month)), year }
}

function buildDateFromParts(year: string, month: string, day: string) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const lastDay = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

const CAL_START_H = 5
const CAL_END_H = 23
const CAL_HOURS = CAL_END_H - CAL_START_H  // 18
const ROW_H = 52  // px per hour
const TOTAL_H = CAL_HOURS * ROW_H  // 884px

const USER_COLORS = [
  { bg: 'bg-indigo-500/20', border: 'border-indigo-400/50', text: 'text-indigo-600 dark:text-indigo-300' },
  { bg: 'bg-blue-500/20',   border: 'border-blue-400/50',   text: 'text-blue-600 dark:text-blue-300' },
  { bg: 'bg-emerald-500/20',border: 'border-emerald-400/50',text: 'text-emerald-600 dark:text-emerald-300' },
  { bg: 'bg-amber-500/20',  border: 'border-amber-400/50',  text: 'text-amber-600 dark:text-amber-300' },
  { bg: 'bg-purple-500/20', border: 'border-purple-400/50', text: 'text-purple-600 dark:text-purple-300' },
  { bg: 'bg-rose-500/20',   border: 'border-rose-400/50',   text: 'text-rose-600 dark:text-rose-300' },
  { bg: 'bg-teal-500/20',   border: 'border-teal-400/50',   text: 'text-teal-600 dark:text-teal-300' },
  { bg: 'bg-orange-500/20', border: 'border-orange-400/50', text: 'text-orange-600 dark:text-orange-300' },
]

function getUserColorIdx(userId: string | null | undefined): number {
  if (!userId) return 0
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return Math.abs(hash) % USER_COLORS.length
}

function getPointageKey(p: { user_id: string | null | undefined; member_id?: string | null }): string {
  return p.user_id ?? `member_${p.member_id ?? 'unknown'}`
}

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

function getLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function dateFromYmd(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0)
}

function fmtWeekLabel(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${monday.toLocaleDateString('fr-FR', opts)} - ${sunday.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`
}

// ─── Sortable Task Item ───────────────────────────────────────────────────────

function SortableTache({
  tache,
  onStatusToggle,
  onDelete,
  onSaveNote,
  onSaveAssignments,
  onRenameTitle,
  equipes,
  members,
  canEdit,
}: {
  tache: Tache
  onStatusToggle: (tache: Tache) => void
  onDelete: (tache: Tache) => void
  onSaveNote: (tache: Tache, note: string) => Promise<void>
  onSaveAssignments: (tache: Tache, equipeIds: string[], memberIds: string[]) => Promise<void>
  onRenameTitle: (tache: Tache, title: string) => Promise<void>
  equipes: Equipe[]
  members: IndividualMember[]
  canEdit: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tache.id })
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteVal, setNoteVal] = useState(tache.progress_note ?? '')
  const [noteSaving, setNoteSaving] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [assignmentSaving, setAssignmentSaving] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleVal, setTitleVal] = useState(tache.title)
  const [titleSaving, setTitleSaving] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [selectedEquipeIds, setSelectedEquipeIds] = useState<Set<string>>(
    () => new Set((tache.assignments ?? []).map(a => a.equipe_id).filter(Boolean) as string[]),
  )
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(
    () => new Set((tache.assignments ?? []).map(a => a.member_id).filter(Boolean) as string[]),
  )

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const cfg = TACHE_STATUS_CONFIG[tache.status]
  const fmtDue = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) : null

  const handleSaveNote = async () => {
    setNoteSaving(true)
    await onSaveNote(tache, noteVal)
    setNoteSaving(false)
    setNoteOpen(false)
  }

  const toggleSet = (setState: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setState(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSaveAssignments = async () => {
    setAssignmentSaving(true)
    await onSaveAssignments(tache, Array.from(selectedEquipeIds), Array.from(selectedMemberIds))
    setAssignmentSaving(false)
    setAssignOpen(false)
  }

  const handleStartEditTitle = () => {
    setTitleVal(tache.title)
    setEditingTitle(true)
    setTimeout(() => titleInputRef.current?.select(), 0)
  }

  const handleSaveTitle = async () => {
    const trimmed = titleVal.trim()
    if (!trimmed || trimmed === tache.title) { setEditingTitle(false); return }
    setTitleSaving(true)
    await onRenameTitle(tache, trimmed)
    setTitleSaving(false)
    setEditingTitle(false)
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card overflow-hidden group"
    >
      <div className="p-3 md:p-4 flex items-center gap-3">
        {/* Drag handle */}
        {canEdit && (
          <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-secondary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <GripVertical className="w-4 h-4" />
          </div>
        )}

        {/* Status toggle */}
        <button
          onClick={() => onStatusToggle(tache)}
          disabled={!canEdit}
          className={`flex-shrink-0 transition-colors ${cfg.color}`}
          title={`Statut : ${cfg.label} (cliquer pour changer)`}
        >
          {cfg.icon}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <div className="flex items-center gap-1.5">
              <input
                ref={titleInputRef}
                value={titleVal}
                onChange={e => setTitleVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(); if (e.key === 'Escape') setEditingTitle(false) }}
                className="input flex-1 text-sm py-0.5 px-2 h-7"
                disabled={titleSaving}
                autoFocus
              />
              <button onClick={handleSaveTitle} disabled={titleSaving} className="text-accent hover:text-accent/80 flex-shrink-0">
                {titleSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setEditingTitle(false)} className="text-secondary hover:text-primary flex-shrink-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <span className={`font-medium text-sm ${tache.status === 'termine' ? 'line-through text-secondary' : 'text-primary'}`}>
              {tache.title}
            </span>
          )}
          {!editingTitle && tache.due_date && (
            <span className="ml-2 text-xs text-secondary">· échéance {fmtDue(tache.due_date)}</span>
          )}
          {tache.progress_note && !noteOpen && (
            <p className="text-xs text-secondary mt-0.5 italic truncate">{tache.progress_note}</p>
          )}
          {(tache.assignments?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {tache.assignments.map(a => (
                <span key={a.id} className="status-pill status-pill-info px-2 py-0.5 text-[10px] font-semibold">
                  {a.equipe_id ? <Users className="w-3 h-3" /> : <User className="w-3 h-3" />}
                  {a.label}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Note avancement (visible si en_cours) */}
        {canEdit && tache.status === 'en_cours' && (
          <button
            onClick={() => { setNoteOpen(v => !v); setNoteVal(tache.progress_note ?? '') }}
            className={`opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-xs px-2 py-1 rounded-lg border ${noteOpen ? 'bg-accent/10 border-accent/40 text-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
            title="Note d'avancement"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
        )}

        {canEdit && (
          <button
            onClick={() => setAssignOpen(v => !v)}
            className={`opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-xs px-2 py-1 rounded-lg border ${assignOpen ? 'bg-accent/10 border-accent/40 text-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
            title="Assigner"
          >
            <Users className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Rename */}
        {canEdit && !editingTitle && (
          <button
            onClick={handleStartEditTitle}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-secondary hover:text-primary flex-shrink-0"
            title="Renommer"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Delete */}
        {canEdit && (
          <button
            onClick={() => onDelete(tache)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-secondary hover:text-red-500 flex-shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Note d'avancement inline */}
      {noteOpen && (
        <div className="px-4 pb-3 border-t border-[var(--elevation-border)] pt-3 bg-[var(--elevation-1)] space-y-2">
          <p className="text-xs font-semibold text-secondary">Note d'avancement</p>
          <textarea
            className="input w-full resize-none text-sm"
            rows={2}
            placeholder="Décris l'avancement : ce qui a été fait, les difficultés, ce qui reste…"
            value={noteVal}
            onChange={e => setNoteVal(e.target.value)}
            autoFocus
          />
          <div className="flex gap-2 justify-end">
            <button onClick={() => setNoteOpen(false)} className="text-xs text-secondary hover:text-primary px-2 py-1">Annuler</button>
            <button onClick={handleSaveNote} disabled={noteSaving} className="btn-primary text-xs py-1 px-3">
              {noteSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}

      {assignOpen && (
        <div className="px-4 pb-3 border-t border-[var(--elevation-border)] pt-3 bg-[var(--elevation-1)] space-y-3">
          <p className="text-xs font-semibold text-secondary">Assignations</p>
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-[11px] font-bold text-secondary uppercase tracking-wider mb-2">Équipes</p>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {equipes.length === 0 ? (
                  <p className="text-xs text-secondary">Aucune équipe.</p>
                ) : equipes.map(equipe => (
                  <label key={equipe.id} className="flex items-center gap-2 text-sm text-primary px-2 py-1.5 rounded-lg hover:bg-base cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedEquipeIds.has(equipe.id)}
                      onChange={() => toggleSet(setSelectedEquipeIds, equipe.id)}
                    />
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: equipe.color }} />
                    {equipe.name}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[11px] font-bold text-secondary uppercase tracking-wider mb-2">Membres</p>
              <div className="space-y-1 max-h-36 overflow-y-auto">
                {members.length === 0 ? (
                  <p className="text-xs text-secondary">Aucun membre.</p>
                ) : members.map(member => {
                  const label = [member.prenom, member.name].filter(Boolean).join(' ')
                  return (
                    <label key={member.id} className="flex items-center gap-2 text-sm text-primary px-2 py-1.5 rounded-lg hover:bg-base cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.has(member.id)}
                        onChange={() => toggleSet(setSelectedMemberIds, member.id)}
                      />
                      <User className="w-3.5 h-3.5 text-secondary" />
                      {label || member.email || 'Membre'}
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setAssignOpen(false)} className="text-xs text-secondary hover:text-primary px-2 py-1">Annuler</button>
            <button onClick={handleSaveAssignments} disabled={assignmentSaving} className="btn-primary text-xs py-1 px-3">
              {assignmentSaving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Weekly Planning View ─────────────────────────────────────────────────────

function WeeklyPlanningView({
  pointages,
  plannings,
  chantier,
  equipes,
  individualMembers,
  onAddPlanning,
  onDeletePlanning,
}: {
  pointages: Pointage[]
  plannings: ChantierPlanning[]
  chantier: ChantierDetail
  equipes: Equipe[]
  individualMembers: import('@/lib/data/queries/members').IndividualMember[]
  onAddPlanning: (data: { plannedDate: string; startTime: string; endTime: string; label: string; equipeId: string | null; memberId: string | null; teamSize: number; notes: string }) => Promise<string | null>
  onDeletePlanning: (id: string) => Promise<void>
}) {
  const [selectedDate, setSelectedDate] = useState(() => dateFromYmd(todayParis()))
  const weekStart = useMemo(() => getMonday(selectedDate), [selectedDate])

  const [isMobile, setIsMobile] = useState(false)
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768)
    check()
    window.addEventListener('resize', check)
    return () => window.removeEventListener('resize', check)
  }, [])

  const [viewMode, setViewMode] = useState<'jour' | 'semaine' | null>(null)
  const effectiveView = viewMode ?? (isMobile ? 'jour' : 'semaine')

  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState(() => ({ date: todayParis(), startTime: '08:00', endTime: '12:00', label: '', equipeId: '', memberId: '', teamSize: 1, notes: '' }))
  const [addLoading, setAddLoading] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)

  const byDayPlannings = plannings.reduce<Record<string, ChantierPlanning[]>>((acc, p) => {
    acc[p.planned_date] = [...(acc[p.planned_date] ?? []), p]
    return acc
  }, {})

  const days = Array.from({ length: effectiveView === 'jour' ? 1 : 7 }, (_, i) => {
    const d = new Date(effectiveView === 'jour' ? selectedDate : weekStart)
    if (effectiveView !== 'jour') {
      d.setDate(weekStart.getDate() + i)
    }
    return d
  })

  const todayStr = todayParis()

  const byDay = pointages.reduce<Record<string, Pointage[]>>((acc, p) => {
    acc[p.date] = [...(acc[p.date] ?? []), p]
    return acc
  }, {})

  const timeLabels = Array.from({ length: CAL_HOURS }, (_, i) => `${String(CAL_START_H + i).padStart(2, '0')}:00`)

  const rec = chantier.recurrence
  let recLabel = ''
  if (rec && rec !== 'none') {
    if (rec === 'plurihebdomadaire') {
      recLabel = `${chantier.recurrence_times ?? '?'} fois/semaine`
    } else {
      recLabel = RECURRENCE_LABELS[rec] ?? rec
    }
    if (chantier.recurrence_team_size) recLabel += ` · ${chantier.recurrence_team_size} pers.`
    if (chantier.recurrence_duration_h) recLabel += ` · ${fmtHours(chantier.recurrence_duration_h)}/passage`
  }

  // ── Vue mobile : liste journalière style Apple Calendar ──────────────────────
  const MobileDayView = () => {
    const dateStr = getLocalDateStr(selectedDate)
    const dayPts = byDay[dateStr] ?? []
    const dayPls = byDayPlannings[dateStr] ?? []

    type CalEvent = { key: string; startMin: number; endMin: number; type: 'pointage' | 'planning'; data: Pointage | ChantierPlanning }

    const events: CalEvent[] = []
    for (const p of dayPts) {
      const [h, m] = (p.start_time ?? '00:00').split(':').map(Number)
      const startMin = h * 60 + m
      const endMin = startMin + Math.round(p.hours * 60)
      events.push({ key: `pt-${p.id}`, startMin, endMin, type: 'pointage', data: p })
    }
    for (const pl of dayPls) {
      const [h, m] = (pl.start_time ?? '00:00').split(':').map(Number)
      const startMin = h * 60 + m
      let endMin = startMin + 60
      if (pl.end_time) {
        const [eh, em] = pl.end_time.split(':').map(Number)
        endMin = eh * 60 + em
      }
      events.push({ key: `pl-${pl.id}`, startMin, endMin, type: 'planning', data: pl })
    }
    events.sort((a, b) => a.startMin - b.startMin)

    const fmtMin = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

    if (events.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <Calendar className="w-10 h-10 text-secondary/30 mb-3" />
          <p className="text-sm font-semibold text-secondary">Aucun créneau ce jour</p>
          <p className="text-xs text-secondary/60 mt-1">Utilisez le bouton Planifier pour ajouter</p>
        </div>
      )
    }

    return (
      <div className="space-y-2 py-2">
        {events.map(ev => {
          if (ev.type === 'pointage') {
            const p = ev.data as Pointage
            const col = USER_COLORS[getUserColorIdx(getPointageKey(p))]
            return (
              <div key={ev.key} className={`flex gap-3 rounded-xl border px-3 py-2.5 ${col.bg} ${col.border}`}>
                <div className="flex flex-col items-center justify-start pt-0.5 min-w-[44px]">
                  <span className={`text-[11px] font-bold tabular-nums ${col.text}`}>{fmtMin(ev.startMin)}</span>
                  <div className="w-px flex-1 my-1 rounded" style={{ background: 'currentColor', minHeight: 12, opacity: 0.3 }} />
                  <span className={`text-[10px] tabular-nums opacity-70 ${col.text}`}>{fmtMin(ev.endMin)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className={`text-xs font-bold ${col.text}`}>{p.user_name}</span>
                    <span className={`text-[10px] opacity-70 ${col.text}`}>{fmtHours(p.hours)}</span>
                  </div>
                  {p.tache_title && <p className={`text-[11px] mt-0.5 opacity-80 ${col.text}`}>{p.tache_title}</p>}
                  {p.description && <p className={`text-[11px] mt-0.5 opacity-60 ${col.text} truncate`}>{p.description}</p>}
                </div>
                <div className="flex-shrink-0 self-start">
                  <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full ${col.bg} ${col.text} border ${col.border}`}>Pointé</span>
                </div>
              </div>
            )
          } else {
            const pl = ev.data as ChantierPlanning
            const eq = equipes.find(e => e.id === pl.equipe_id)
            const color = eq?.color ?? '#6366f1'
            return (
              <div key={ev.key} className="flex gap-3 rounded-xl border px-3 py-2.5 group/plm relative" style={{ backgroundColor: `${color}12`, borderColor: `${color}40` }}>
                <div className="flex flex-col items-center justify-start pt-0.5 min-w-[44px]">
                  <span className="text-[11px] font-bold tabular-nums" style={{ color }}>{fmtMin(ev.startMin)}</span>
                  <div className="w-px flex-1 my-1 rounded" style={{ background: color, minHeight: 12, opacity: 0.3 }} />
                  <span className="text-[10px] tabular-nums opacity-60" style={{ color }}>{fmtMin(ev.endMin)}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-bold" style={{ color }}>{pl.label}</span>
                    <span className="text-[10px] opacity-70" style={{ color }}>{pl.team_size} pers.</span>
                  </div>
                  {pl.notes && <p className="text-[11px] mt-0.5 opacity-70 whitespace-pre-wrap" style={{ color }}>{pl.notes}</p>}
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full text-white" style={{ backgroundColor: color }}>Prévu</span>
                  <button
                    onClick={() => onDeletePlanning(pl.id)}
                    className="opacity-0 group-hover/plm:opacity-100 transition-opacity text-red-400 hover:text-red-600"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )
          }
        })}
      </div>
    )
  }

  // ── Vue desktop : grille avec pistes séparées prévu / pointé ──────────────────
  const DesktopGridView = () => (
    <div className="overflow-x-auto">
      <div style={{ minWidth: days.length === 1 ? '100%' : 700 }}>
        {/* En-têtes colonnes */}
        <div className="flex mb-1 ml-14">
          {days.map((day, i) => {
            const dateStr = getLocalDateStr(day)
            const isToday = dateStr === todayStr
            const dayPts = byDay[dateStr] ?? []
            const dayPls = byDayPlannings[dateStr] ?? []
            const pointedH = dayPts.reduce((s, p) => s + p.hours, 0)
            const plannedH = dayPls.reduce((s, pl) => {
              if (!pl.start_time || !pl.end_time) return s
              const [sh, sm] = pl.start_time.split(':').map(Number)
              const [eh, em] = pl.end_time.split(':').map(Number)
              return s + ((eh + em / 60) - (sh + sm / 60))
            }, 0)
            return (
              <div key={i} className={`flex-1 py-2 rounded-t-lg ${isToday ? 'bg-accent/10' : ''}`}>
                <p className={`text-xs font-semibold uppercase tracking-wider text-center ${isToday ? 'text-accent' : 'text-secondary'}`}>
                  {day.toLocaleDateString('fr-FR', { weekday: 'short' })}
                </p>
                <div className="flex justify-center mt-1 mb-1">
                  <div className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold ${isToday ? 'bg-accent text-white' : 'text-primary'}`}>
                    {day.getDate()}
                  </div>
                </div>
                <div className="flex text-[9px] font-semibold uppercase tracking-wider">
                  <span className="flex-1 text-center text-indigo-500 opacity-80">Prévu</span>
                  <span className="flex-1 text-center text-emerald-600 dark:text-emerald-400 opacity-80">Pointé</span>
                </div>
                {(pointedH > 0 || plannedH > 0) && (
                  <div className="flex justify-center gap-2 mt-0.5">
                    {plannedH > 0 && <span className="text-[9px] text-indigo-500 font-mono">{fmtHours(plannedH)}</span>}
                    {pointedH > 0 && <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-mono">{fmtHours(pointedH)}</span>}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Grille */}
        <div className="flex border border-[var(--elevation-border)] rounded-b-lg overflow-hidden">
          {/* Axe horaire */}
          <div className="w-14 flex-shrink-0 border-r border-[var(--elevation-border)] bg-[var(--elevation-1)]">
            {timeLabels.map((label, i) => (
              <div
                key={i}
                style={{ height: ROW_H }}
                className="flex items-start justify-end pr-2 pt-1 border-b border-[var(--elevation-border)]/50 last:border-0"
              >
                <span className="text-[10px] text-secondary font-mono">{label}</span>
              </div>
            ))}
          </div>

          {/* Colonnes jour */}
          {days.map((day, di) => {
            const dateStr = getLocalDateStr(day)
            const isToday = dateStr === todayStr
            const dayPts = byDay[dateStr] ?? []
            const withTime = dayPts.filter(p => p.start_time)
            const noTime = dayPts.filter(p => !p.start_time)
            const dayPlannings = byDayPlannings[dateStr] ?? []
            const planningsWithTime = dayPlannings.filter(p => p.start_time)
            const planningsNoTime = dayPlannings.filter(p => !p.start_time)

            return (
              <div
                key={di}
                className={`flex-1 relative border-r border-[var(--elevation-border)] last:border-0 ${isToday ? 'bg-accent/5' : ''}`}
                style={{ height: TOTAL_H }}
              >
                {/* Lignes horaires */}
                {timeLabels.map((_, i) => (
                  <div
                    key={i}
                    className="absolute left-0 right-0 border-b border-[var(--elevation-border)]/30"
                    style={{ top: i * ROW_H, height: ROW_H }}
                  />
                ))}

                {/* Séparateur vertical central des deux pistes */}
                <div className="absolute top-0 bottom-0 border-r border-dashed border-[var(--elevation-border)]/60" style={{ left: '50%' }} />

                {/* Heure courante */}
                {isToday && (() => {
                  const now = new Date()
                  const fraction = (now.getHours() + now.getMinutes() / 60 - CAL_START_H) / CAL_HOURS
                  if (fraction < 0 || fraction > 1) return null
                  return (
                    <div className="absolute left-0 right-0 z-20 flex items-center pointer-events-none" style={{ top: fraction * TOTAL_H }}>
                      <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                      <div className="flex-1 h-0.5 bg-red-400" />
                    </div>
                  )
                })()}

                {/* PISTE GAUCHE : plannings prévus */}
                {planningsWithTime.map(pl => {
                  if (!pl.start_time) return null
                  const [h, m] = pl.start_time.split(':').map(Number)
                  const startH = h + m / 60
                  const topPx = Math.max(0, (startH - CAL_START_H) * ROW_H)
                  const endH = pl.end_time ? (() => { const [eh, em] = pl.end_time!.split(':').map(Number); return eh + em / 60 })() : startH + 1
                  const heightPx = Math.max((endH - startH) * ROW_H, 24)
                  const eq = equipes.find(e => e.id === pl.equipe_id)
                  const color = eq?.color ?? '#6366f1'
                  return (
                    <div
                      key={`pl-${pl.id}`}
                      className="absolute rounded-md p-1 z-10 overflow-hidden group/pl cursor-default flex flex-col"
                      style={{ top: topPx, height: heightPx, left: 1, width: 'calc(50% - 3px)', backgroundColor: `${color}20`, border: `1.5px dashed ${color}` }}
                      title={`Prévu · ${pl.label} · ${pl.team_size} pers.${pl.notes ? ` · ${pl.notes}` : ''}`}
                    >
                      <p className="text-[9px] font-bold leading-tight truncate" style={{ color }}>{pl.label}</p>
                      <p className="text-[8px] leading-tight opacity-70 truncate" style={{ color }}>{pl.start_time.slice(0, 5)}{pl.end_time ? `→${pl.end_time.slice(0, 5)}` : ''}</p>
                      <button onClick={() => onDeletePlanning(pl.id)} className="absolute top-0.5 right-0.5 opacity-0 group-hover/pl:opacity-100 transition-opacity text-red-500 hover:text-red-600 bg-white/80 dark:bg-black/50 rounded p-0.5">
                        <X className="w-2 h-2" />
                      </button>
                    </div>
                  )
                })}

                {/* PISTE DROITE : pointages */}
                {withTime.map(p => {
                  if (!p.start_time) return null
                  const [h, m] = p.start_time.split(':').map(Number)
                  const startH = h + m / 60
                  const topPx = Math.max(0, (startH - CAL_START_H) * ROW_H)
                  const heightPx = Math.max(p.hours * ROW_H, 24)
                  const col = USER_COLORS[getUserColorIdx(getPointageKey(p))]
                  return (
                    <div
                      key={p.id}
                      className={`absolute rounded-md p-1 border z-10 overflow-hidden ${col.bg} ${col.border}`}
                      style={{ top: topPx, height: heightPx, right: 1, width: 'calc(50% - 3px)' }}
                      title={`${p.user_name} · ${fmtHours(p.hours)}${p.tache_title ? ` · ${p.tache_title}` : ''}`}
                    >
                      <p className={`text-[9px] font-bold leading-tight truncate ${col.text}`}>{p.user_name}</p>
                      <p className={`text-[8px] leading-tight opacity-80 truncate ${col.text}`}>{p.start_time.slice(0, 5)} · {fmtHours(p.hours)}</p>
                    </div>
                  )
                })}

                {/* Pointages sans heure — bande supérieure droite */}
                {noTime.length > 0 && (
                  <div className="absolute top-1 z-10 flex flex-col gap-0.5" style={{ right: 1, width: 'calc(50% - 3px)' }}>
                    {noTime.map(p => {
                      const col = USER_COLORS[getUserColorIdx(getPointageKey(p))]
                      return (
                        <div key={p.id} className={`rounded px-1 py-0.5 text-[8px] font-semibold truncate border ${col.bg} ${col.border} ${col.text}`}>
                          {p.user_name} {fmtHours(p.hours)}
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Plannings sans heure — bande inférieure gauche */}
                {planningsNoTime.length > 0 && (
                  <div className="absolute bottom-1 z-10 flex flex-col gap-0.5" style={{ left: 1, width: 'calc(50% - 3px)' }}>
                    {planningsNoTime.map(pl => {
                      const eq = equipes.find(e => e.id === pl.equipe_id)
                      const color = eq?.color ?? '#6366f1'
                      return (
                        <div key={`pl-${pl.id}`} className="rounded px-1 py-0.5 flex items-center gap-1 group/pl relative" style={{ backgroundColor: `${color}20`, border: `1px dashed ${color}` }}>
                          <span className="text-[8px] font-semibold truncate flex-1" style={{ color }}>{pl.label}</span>
                          <button onClick={() => onDeletePlanning(pl.id)} className="opacity-0 group-hover/pl:opacity-100 transition-opacity text-red-500 hover:text-red-600">
                            <X className="w-2.5 h-2.5" />
                          </button>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Légende + totaux */}
        {(() => {
          const weekPointedH = days.reduce((sum, day) => sum + (byDay[getLocalDateStr(day)] ?? []).reduce((s, p) => s + p.hours, 0), 0)
          const weekPlannedH = days.reduce((sum, day) => sum + (byDayPlannings[getLocalDateStr(day)] ?? []).reduce((s, pl) => {
            if (!pl.start_time || !pl.end_time) return s
            const [sh, sm] = pl.start_time.split(':').map(Number)
            const [eh, em] = pl.end_time.split(':').map(Number)
            return s + ((eh + em / 60) - (sh + sm / 60))
          }, 0), 0)
          return (
            <div className="flex flex-wrap items-center gap-3 mt-3 text-xs text-secondary">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-0.5 bg-red-400 inline-block rounded" /> Heure actuelle
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2.5 rounded-sm border border-dashed border-indigo-400 bg-indigo-400/15 inline-block" /> Prévu (gauche)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-2.5 rounded-sm border border-emerald-400/50 bg-emerald-400/20 inline-block" /> Pointé (droite)
              </span>
              <span className="ml-auto flex items-center gap-3 font-semibold text-primary">
                {weekPlannedH > 0 && <span className="text-indigo-500">Prévu : {fmtHours(weekPlannedH)}</span>}
                {weekPointedH > 0 && <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><Clock className="w-3.5 h-3.5" /> Pointé : {fmtHours(weekPointedH)}</span>}
              </span>
            </div>
          )
        })()}
      </div>
    </div>
  )

  return (
    <div className="space-y-4">
      {recLabel && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/10 border border-accent/20">
          <RefreshCw className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-primary">Récurrence : {recLabel}</p>
            {chantier.recurrence_notes && (
              <p className="text-xs text-secondary mt-1 whitespace-pre-wrap">{chantier.recurrence_notes}</p>
            )}
          </div>
        </div>
      )}

      <div className="card p-4">
        {/* Barre de navigation */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
          <div className="flex items-center justify-between sm:justify-start w-full sm:w-auto gap-2">
            <button
              onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() - (effectiveView === 'jour' ? 1 : 7)); setSelectedDate(d) }}
              className="p-2 rounded-lg hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors border border-[var(--elevation-border)]"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="text-center flex-1 sm:flex-none sm:min-w-[140px]">
              <p className="text-sm font-bold text-primary capitalize">
                {effectiveView === 'jour'
                  ? selectedDate.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
                  : fmtWeekLabel(weekStart)}
              </p>
              <button
                onClick={() => setSelectedDate(dateFromYmd(todayParis()))}
                className="text-xs text-accent hover:underline mt-0.5"
              >
                Aujourd&apos;hui
              </button>
            </div>
            <button
              onClick={() => { const d = new Date(selectedDate); d.setDate(d.getDate() + (effectiveView === 'jour' ? 1 : 7)); setSelectedDate(d) }}
              className="p-2 rounded-lg hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors border border-[var(--elevation-border)]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-2">
            <div className="flex bg-base/50 p-1 rounded-lg border border-[var(--elevation-border)]">
              <button onClick={() => setViewMode('jour')} className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${effectiveView === 'jour' ? 'bg-[var(--elevation-2)] shadow-sm text-primary' : 'text-secondary hover:text-primary'}`}>Jour</button>
              <button onClick={() => setViewMode('semaine')} className={`px-3 py-1.5 text-xs rounded font-medium transition-colors ${effectiveView === 'semaine' ? 'bg-[var(--elevation-2)] shadow-sm text-primary' : 'text-secondary hover:text-primary'}`}>
                <span className="hidden sm:inline">Semaine</span><span className="sm:hidden">Sem.</span>
              </button>
            </div>
            <button
              onClick={() => setShowAddForm(v => !v)}
              className={`text-xs font-semibold px-3 py-2 rounded-lg border transition-colors flex items-center gap-1.5 ${showAddForm ? 'bg-accent/10 border-accent/40 text-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
            >
              <Plus className="w-3 h-3" /> <span className="hidden sm:inline">Planifier</span>
            </button>
          </div>
        </div>

        {/* Formulaire ajout */}
        {showAddForm && (
          <div className="mb-4 p-4 rounded-xl border border-accent/30 bg-accent/5 space-y-3">
            <p className="text-sm font-semibold text-primary">Nouveau créneau planifié</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">Date *</label>
                <input type="date" className="input w-full text-sm" value={addForm.date} onChange={e => setAddForm(f => ({...f, date: e.target.value}))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">Équipe</label>
                <select className="input w-full text-sm" value={addForm.equipeId} onChange={e => {
                  const eq = equipes.find(eq => eq.id === e.target.value)
                  setAddForm(f => ({...f, equipeId: e.target.value, memberId: '', label: eq ? eq.name : f.label, teamSize: eq ? eq.membres.length || 1 : f.teamSize}))
                }}>
                  <option value="">&mdash; Aucune équipe &mdash;</option>
                  {equipes.map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.membres.length} pers.)</option>)}
                </select>
              </div>
              {individualMembers.length > 0 && (
                <div>
                  <label className="text-xs font-semibold text-secondary block mb-1">Membre individuel</label>
                  <select className="input w-full text-sm" value={addForm.memberId} onChange={e => {
                    const m = individualMembers.find(m => m.id === e.target.value)
                    setAddForm(f => ({...f, memberId: e.target.value, equipeId: '', label: m ? [m.prenom, m.name].filter(Boolean).join(' ') : f.label, teamSize: 1}))
                  }}>
                    <option value="">&mdash; Aucun membre &mdash;</option>
                    {individualMembers.map(m => {
                      const fullName = [m.prenom, m.name].filter(Boolean).join(' ') || m.name
                      return <option key={m.id} value={m.id}>{fullName}{m.role_label ? ` · ${m.role_label}` : ''}{m.taux_horaire != null ? ` · ${m.taux_horaire}€/h` : ''}</option>
                    })}
                  </select>
                </div>
              )}
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">Libellé *</label>
                <input className="input w-full text-sm" placeholder="Équipe A, Jean-Pierre, Sous-traitant..." value={addForm.label} onChange={e => setAddForm(f => ({...f, label: e.target.value}))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">Nb personnes</label>
                <input type="number" min="1" className="input w-full text-sm" value={addForm.teamSize} onChange={e => setAddForm(f => ({...f, teamSize: parseInt(e.target.value)||1}))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">Début</label>
                <input type="time" className="input w-full text-sm" value={addForm.startTime} onChange={e => setAddForm(f => ({...f, startTime: e.target.value}))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">Fin</label>
                <input type="time" className="input w-full text-sm" value={addForm.endTime} onChange={e => setAddForm(f => ({...f, endTime: e.target.value}))} />
              </div>
            </div>
            {addForm.startTime && addForm.endTime && (() => {
              const [sh, sm] = addForm.startTime.split(':').map(Number)
              const [eh, em] = addForm.endTime.split(':').map(Number)
              const dur = (eh + em / 60) - (sh + sm / 60)
              return dur > 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-accent/10 border border-accent/20">
                  <Clock className="w-4 h-4 text-accent" />
                  <span className="text-sm font-bold text-accent">Durée : {fmtHours(dur)}</span>
                </div>
              ) : null
            })()}
            <div>
              <label className="text-xs font-semibold text-secondary block mb-1">Notes</label>
              <input className="input w-full text-sm" placeholder="Consignes, accès, matériel..." value={addForm.notes} onChange={e => setAddForm(f => ({...f, notes: e.target.value}))} />
            </div>
            {addError && <p className="text-xs text-red-500 px-1">{addError}</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowAddForm(false); setAddError(null) }} className="text-xs text-secondary hover:text-primary px-3 py-1.5">Annuler</button>
              <button
                disabled={addLoading || !addForm.date || !addForm.label.trim()}
                onClick={async () => {
                  setAddLoading(true)
                  setAddError(null)
                  const err = await onAddPlanning({ plannedDate: addForm.date, startTime: addForm.startTime, endTime: addForm.endTime, label: addForm.label, equipeId: addForm.equipeId || null, memberId: addForm.memberId || null, teamSize: addForm.teamSize, notes: addForm.notes })
                  setAddLoading(false)
                  if (err) {
                    setAddError(err)
                  } else {
                    setShowAddForm(false)
                    setAddError(null)
                    setAddForm(f => ({...f, date: todayParis(), label: '', equipeId: '', memberId: '', notes: ''}))
                  }
                }}
                className="btn-primary text-xs py-1.5 px-4 inline-flex items-center gap-1.5 min-w-[6.5rem] justify-center"
              >
                {addLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {addLoading ? 'Enregistrement...' : 'Planifier'}
              </button>
            </div>
          </div>
        )}

        {/* Vue mobile (liste) ou desktop (grille) */}
        {effectiveView === 'jour' && isMobile ? <MobileDayView /> : <DesktopGridView />}

        {/* Liste planifications avec notes — sous la grille desktop */}
        {effectiveView !== 'jour' && (() => {
          const weekPlannings = plannings.filter(pl => {
            const start = getLocalDateStr(days[0])
            const end = getLocalDateStr(days[days.length - 1])
            return pl.planned_date >= start && pl.planned_date <= end
          })
          if (weekPlannings.length === 0) return null
          return (
            <div className="mt-4 space-y-2 border-t border-[var(--elevation-border)] pt-4">
              <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Planifications de la semaine</p>
              {weekPlannings.map(pl => {
                const eq = equipes.find(e => e.id === pl.equipe_id)
                const borderColor = eq?.color ?? '#6366f1'
                const dayLabel = new Date(pl.planned_date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'short' })
                return (
                  <div key={pl.id} className="flex gap-3 p-3 rounded-xl border" style={{ borderColor: `${borderColor}40`, backgroundColor: `${borderColor}08` }}>
                    <div className="w-1 rounded-full flex-shrink-0" style={{ backgroundColor: borderColor }} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-bold capitalize" style={{ color: borderColor }}>{dayLabel}</span>
                        {pl.start_time && <span className="text-xs text-secondary">{pl.start_time.slice(0, 5)}{pl.end_time ? ` → ${pl.end_time.slice(0, 5)}` : ''}</span>}
                        <span className="text-xs font-semibold text-primary">{pl.label}</span>
                        <span className="text-xs text-secondary">{pl.team_size} pers.</span>
                      </div>
                      {pl.notes && <p className="text-xs text-secondary mt-1 whitespace-pre-wrap">{pl.notes}</p>}
                    </div>
                    <button onClick={() => onDeletePlanning(pl.id)} className="text-secondary hover:text-red-500 transition-colors flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )
        })()}
      </div>
    </div>
  )
}

// ─── Equipes Tab ──────────────────────────────────────────────────────────────

type TeamSuggestion = {
  _id: string
  designation: string
  quantity: number
  unit: string
  rate: number
  name: string
  color: string
  created: boolean
}

function EquipesTab({
  chantierId,
  allEquipes: initialAllEquipes,
  chantierEquipes: initialChantierEquipes,
  linkedQuoteId,
  orgMembers,
  orgRoles,
  canEditRates,
  currentUserId,
}: {
  chantierId: string
  allEquipes: Equipe[]
  chantierEquipes: Equipe[]
  linkedQuoteId?: string | null
  orgMembers: TeamMember[]
  orgRoles: OrgRole[]
  canEditRates: boolean
  currentUserId?: string | null
}) {
  const [allEquipes, setAllEquipes] = useState(initialAllEquipes)
  const [assignedIds, setAssignedIds] = useState<Set<string>>(
    new Set(initialChantierEquipes.map(e => e.id))
  )
  const [showCreate, setShowCreate] = useState(false)
  const [newEquipeName, setNewEquipeName] = useState('')
  const [newEquipeColor, setNewEquipeColor] = useState('#6366f1')
  const [createLoading, setCreateLoading] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [memberForms, setMemberForms] = useState<Record<string, { name: string; role: string; taux: string; profileId: string | null }>>({})
  const [editingMembreTaux, setEditingMembreTaux] = useState<Record<string, string>>({})
  const [addingMembres, setAddingMembres] = useState<Set<string>>(new Set())
  const [removingMembres, setRemovingMembres] = useState<Set<string>>(new Set())
  const [deletingEquipes, setDeletingEquipes] = useState<Set<string>>(new Set())
  const [pendingMembreIds, setPendingMembreIds] = useState<Record<string, Set<string>>>({})

  // Team suggestions from quote MO lines
  const [teamSuggestions, setTeamSuggestions] = useState<TeamSuggestion[]>([])
  const [suggestTeamsLoading, setSuggestTeamsLoading] = useState(false)
  const [showTeamSuggestions, setShowTeamSuggestions] = useState(false)
  const SUGGEST_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316']

  const handleSuggestTeams = async () => {
    if (!linkedQuoteId) return
    setSuggestTeamsLoading(true)
    const { internal } = await getQuoteItemsForSuggestions(linkedQuoteId)
    setSuggestTeamsLoading(false)
    if (internal.length === 0) return
    setTeamSuggestions(internal.map((item, i) => ({
      _id: `tsugg_${i}_${Date.now()}`,
      designation: item.designation,
      quantity: item.quantity,
      unit: item.unit,
      rate: item.rate,
      name: item.designation,
      color: SUGGEST_COLORS[i % SUGGEST_COLORS.length],
      created: false,
    })))
    setShowTeamSuggestions(true)
  }

  const handleCreateFromSuggestion = async (id: string) => {
    const sugg = teamSuggestions.find(s => s._id === id)
    if (!sugg || sugg.created) return
    const { equipeId, error } = await createEquipe({
      name: sugg.name.trim(),
      color: sugg.color,
      description: `${sugg.quantity} ${sugg.unit} estimés`,
    })
    if (!error && equipeId) {
      const newE: Equipe = {
        id: equipeId, organization_id: '', name: sugg.name.trim(), color: sugg.color,
        description: `${sugg.quantity} ${sugg.unit} estimés`, created_at: new Date().toISOString(), membres: [],
      }
      setAllEquipes(prev => [...prev, newE])
      setTeamSuggestions(prev => prev.map(s => s._id === id ? { ...s, created: true } : s))
      // auto-assign
      setAssignedIds(prev => new Set([...prev, equipeId]))
      await assignEquipeToChantier(chantierId, equipeId)
    }
  }

  const toggleExpand = (id: string) =>
    setExpanded(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s })

  const handleCreateEquipe = async () => {
    if (!newEquipeName.trim()) return
    setCreateLoading(true)
    const { equipeId, error } = await createEquipe({ name: newEquipeName.trim(), color: newEquipeColor })
    setCreateLoading(false)
    if (!error && equipeId) {
      const newE: Equipe = {
        id: equipeId, organization_id: '', name: newEquipeName.trim(), color: newEquipeColor,
        description: null, created_at: new Date().toISOString(), membres: [],
      }
      setAllEquipes(prev => [...prev, newE])
      setNewEquipeName('')
      setNewEquipeColor('#6366f1')
      setShowCreate(false)
    }
  }

  const handleDeleteEquipe = async (equipeId: string) => {
    if (!confirm("Supprimer cette équipe ? Les membres seront conservés comme intervenants solo.")) return
    setDeletingEquipes(prev => new Set([...prev, equipeId]))
    const { error } = await deleteEquipe(equipeId)
    setDeletingEquipes(prev => { const s = new Set(prev); s.delete(equipeId); return s })
    if (error) { alert(error); return }
    setAllEquipes(prev => prev.filter(e => e.id !== equipeId))
    setAssignedIds(prev => { const s = new Set(prev); s.delete(equipeId); return s })
  }

  const handleToggleAssign = async (equipeId: string) => {
    if (assignedIds.has(equipeId)) {
      setAssignedIds(prev => { const s = new Set(prev); s.delete(equipeId); return s })
      await removeEquipeFromChantier(chantierId, equipeId)
    } else {
      setAssignedIds(prev => new Set([...prev, equipeId]))
      await assignEquipeToChantier(chantierId, equipeId)
    }
  }

  const handleAddMembre = async (equipeId: string) => {
    const form = memberForms[equipeId]
    if (!form?.name.trim()) return
    setAddingMembres(prev => new Set([...prev, equipeId]))
    const taux = canEditRates && form.taux ? parseFloat(form.taux) : null
    const profileId = form.profileId ?? null
    const { membreId, error } = await addEquipeMembre(equipeId, { name: form.name.trim(), roleLabel: form.role.trim() || null, tauxHoraire: taux, profileId })
    setAddingMembres(prev => { const s = new Set(prev); s.delete(equipeId); return s })
    if (!error && membreId) {
      setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
        ...e,
        membres: [...e.membres, { id: membreId, equipe_id: equipeId, prenom: null, name: form.name.trim(), email: null, role_label: form.role.trim() || null, profile_id: profileId, taux_horaire: taux }],
      }))
      setMemberForms(prev => ({ ...prev, [equipeId]: { name: '', role: '', taux: '', profileId: null } }))
    }
  }

  const handleAddMultipleMembres = async (equipeId: string) => {
    const ids = [...(pendingMembreIds[equipeId] ?? new Set())]
    if (!ids.length) return
    setAddingMembres(prev => new Set([...prev, equipeId]))
    for (const uid of ids) {
      const member = orgMembers.find(m => m.user_id === uid)
      if (!member) continue
      const taux = canEditRates && member.labor_cost_per_hour != null ? member.labor_cost_per_hour : null
      const { membreId, error } = await addEquipeMembre(equipeId, {
        name: member.full_name ?? member.email,
        roleLabel: member.job_title ?? null,
        tauxHoraire: taux,
        profileId: uid,
      })
      if (!error && membreId) {
        setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
          ...e,
          membres: [...e.membres, { id: membreId, equipe_id: equipeId, prenom: null, name: member.full_name ?? member.email, email: null, role_label: member.job_title ?? null, profile_id: uid, taux_horaire: taux }],
        }))
      }
    }
    setAddingMembres(prev => { const s = new Set(prev); s.delete(equipeId); return s })
    setPendingMembreIds(prev => { const s = { ...prev }; delete s[equipeId]; return s })
  }

  const handleSaveMembreTaux = async (equipeId: string, membreId: string) => {
    if (!canEditRates) return
    const raw = editingMembreTaux[membreId]
    const taux = raw ? parseFloat(raw) : null
    await updateEquipeMembreTaux(membreId, taux)
    setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
      ...e,
      membres: e.membres.map(m => m.id !== membreId ? m : { ...m, taux_horaire: taux }),
    }))
    setEditingMembreTaux(prev => { const s = { ...prev }; delete s[membreId]; return s })
  }

  const handleRemoveMembre = async (equipeId: string, membreId: string) => {
    setRemovingMembres(prev => new Set([...prev, membreId]))
    const { error } = await removeEquipeMembre(membreId)
    setRemovingMembres(prev => { const s = new Set(prev); s.delete(membreId); return s })
    if (error) return
    setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
      ...e, membres: e.membres.filter(m => m.id !== membreId),
    }))
  }

  const PRESET_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316']

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-sm font-bold text-primary flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" /> Équipes terrain
          </h3>
          <p className="text-xs text-secondary mt-0.5">Créez des équipes libres et assignez-les à ce chantier.</p>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
          {linkedQuoteId && !showTeamSuggestions && (
            <button
              onClick={handleSuggestTeams}
              disabled={suggestTeamsLoading}
              className="flex items-center justify-center gap-2 text-sm font-semibold text-violet-600 dark:text-violet-400 px-3 py-2 rounded-xl border border-violet-400/30 bg-violet-500/5 hover:bg-violet-500/10 transition-all disabled:opacity-60"
            >
              {suggestTeamsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Suggérer depuis devis
            </button>
          )}
          <button onClick={() => setShowCreate(v => !v)} className="btn-primary flex items-center justify-center gap-2 text-sm">
            <Plus className="w-4 h-4" /> Créer une équipe
          </button>
        </div>
      </div>

      {/* Team suggestions panel */}
      {showTeamSuggestions && teamSuggestions.length > 0 && (
        <div className="card p-4 space-y-3 border-violet-400/30 bg-violet-500/3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-primary flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-500" />
              Équipes suggérées depuis la MO du devis
            </p>
            <button onClick={() => { setTeamSuggestions([]); setShowTeamSuggestions(false) }} className="p-1 text-secondary hover:text-primary">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="space-y-2">
            {teamSuggestions.map(sugg => (
              <div key={sugg._id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${sugg.created ? 'border-emerald-400/30 bg-emerald-500/5 opacity-70' : 'border-[var(--elevation-border)] bg-surface dark:bg-white/[0.03]'}`}>
                <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: sugg.color }} />
                <div className="flex-1 min-w-0">
                  <input
                    value={sugg.name}
                    onChange={e => setTeamSuggestions(prev => prev.map(s => s._id === sugg._id ? { ...s, name: e.target.value } : s))}
                    disabled={sugg.created}
                    className="bg-transparent outline-none text-sm font-semibold text-primary w-full disabled:cursor-default"
                  />
                  <p className="text-xs text-secondary">{sugg.quantity} {sugg.unit} estimés · {sugg.rate}€/{sugg.unit}</p>
                </div>
                {sugg.created ? (
                  <span className="text-xs text-emerald-500 flex items-center gap-1 flex-shrink-0">
                    <CheckCircle2 className="w-3.5 h-3.5" />Créée
                  </span>
                ) : (
                  <button
                    onClick={() => handleCreateFromSuggestion(sugg._id)}
                    className="btn-primary text-xs px-3 py-1.5 flex-shrink-0"
                  >
                    Créer
                  </button>
                )}
              </div>
            ))}
          </div>
          <button onClick={() => { setTeamSuggestions([]); setShowTeamSuggestions(false) }} className="btn-secondary w-full text-sm">
            Fermer
          </button>
        </div>
      )}

      {showCreate && (
        <div className="card p-4 border-accent/30 bg-accent/5 space-y-3">
          <p className="text-sm font-semibold text-primary">Nouvelle équipe</p>
          <input
            className="input w-full"
            placeholder="Nom de l'équipe (ex : Équipe Nettoyage Nord)"
            value={newEquipeName}
            onChange={e => setNewEquipeName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreateEquipe()}
            autoFocus
          />
          <div>
            <label className="text-xs font-semibold text-secondary block mb-1.5">Couleur</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button key={c} onClick={() => setNewEquipeColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${newEquipeColor === c ? 'border-primary scale-110 ring-2 ring-primary/20' : 'border-transparent'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowCreate(false)} className="btn-secondary flex-1 text-sm">Annuler</button>
            <button onClick={handleCreateEquipe} disabled={createLoading || !newEquipeName.trim()} className="btn-primary flex-1 text-sm">
              {createLoading ? 'Création...' : "Créer l'équipe"}
            </button>
          </div>
        </div>
      )}

      {allEquipes.length === 0 && !showCreate && (
        <div className="card p-12 text-center">
          <Users className="w-12 h-12 text-secondary opacity-30 mx-auto mb-3" />
          <p className="text-secondary font-semibold">Aucune équipe créée</p>
          <p className="text-secondary text-sm mt-1">Créez des équipes pour organiser votre personnel sur le chantier</p>
        </div>
      )}

      {allEquipes.map(equipe => {
        const isAssigned = assignedIds.has(equipe.id)
        const isOpen = expanded.has(equipe.id)
        const mForm = memberForms[equipe.id] ?? { name: '', role: '', taux: '', profileId: null }
        return (
          <div key={equipe.id} className={`card overflow-hidden border-2 transition-colors ${isAssigned ? 'border-accent/40' : 'border-[var(--elevation-border)]'}`}>
            <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: equipe.color }} />
              <div className="w-full min-w-0 flex-1">
                <p className="font-semibold text-primary">{equipe.name}</p>
                <p className="text-xs text-secondary mt-0.5">
                  {equipe.membres.length} membre{equipe.membres.length !== 1 ? 's' : ''}
                  {isAssigned && <span className="ml-2 text-accent font-semibold">· Assignée à ce chantier</span>}
                </p>
              </div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                <button
                  onClick={() => handleToggleAssign(equipe.id)}
                  className={`flex-1 text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors sm:flex-none ${isAssigned ? 'border-red-400/40 text-red-500 hover:bg-red-500/10' : 'border-accent/40 text-accent hover:bg-accent/10'}`}
                >
                  {isAssigned ? 'Retirer' : 'Assigner'}
                </button>
                <button onClick={() => toggleExpand(equipe.id)} className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-[var(--elevation-1)] transition-colors">
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <button onClick={() => handleDeleteEquipe(equipe.id)} disabled={deletingEquipes.has(equipe.id)} className="p-1.5 rounded-lg text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40">
                  {deletingEquipes.has(equipe.id) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-[var(--elevation-border)] bg-[var(--elevation-1)] p-4 space-y-2">
                {equipe.membres.length === 0 && (
                  <p className="text-xs text-secondary italic">Aucun membre. Ajoutez-en ci-dessous.</p>
                )}
                {equipe.membres.map(m => {
                  const isMe = currentUserId && m.profile_id === currentUserId
                  return (
                    <div key={m.id} className="flex flex-col gap-2 rounded-lg border border-[var(--elevation-border)] bg-[var(--elevation-0)] px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3">
                      <div className="flex min-w-0 items-start gap-2 sm:flex-1">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: equipe.color }}>
                          {m.name[0]?.toUpperCase() ?? '?'}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-primary flex flex-wrap items-center gap-1">
                            <span className="min-w-0 truncate">{m.name}</span>
                            {isMe && (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-accent/15 text-accent">Moi</span>
                            )}
                            {m.profile_id ? (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">Lié</span>
                            ) : (
                              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-500">Externe</span>
                            )}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                          {m.role_label && <p className="text-xs text-secondary">{m.role_label}</p>}
                          {canEditRates && editingMembreTaux[m.id] !== undefined ? (
                            <div className="flex items-center gap-1">
                              <input
                                type="number"
                                min="0"
                                step="0.5"
                                className="input w-16 text-xs py-0.5 px-1.5"
                                placeholder="€/h"
                                value={editingMembreTaux[m.id]}
                                onChange={e => setEditingMembreTaux(prev => ({ ...prev, [m.id]: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') handleSaveMembreTaux(equipe.id, m.id) }}
                                autoFocus
                              />
                              <button onClick={() => handleSaveMembreTaux(equipe.id, m.id)} className="p-0.5 text-accent hover:text-accent/80 transition-colors">
                                <Check className="w-3 h-3" />
                              </button>
                              <button onClick={() => setEditingMembreTaux(prev => { const s = { ...prev }; delete s[m.id]; return s })} className="p-0.5 text-secondary hover:text-primary transition-colors">
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          ) : canEditRates ? (
                            <button
                              onClick={() => setEditingMembreTaux(prev => ({ ...prev, [m.id]: m.taux_horaire != null ? String(m.taux_horaire) : '' }))}
                              className="flex items-center gap-0.5 text-xs text-secondary hover:text-primary transition-colors"
                            >
                              <Euro className="w-2.5 h-2.5" />
                              {m.taux_horaire != null ? <span>{m.taux_horaire}€/h</span> : <span className="opacity-40">€/h</span>}
                              <Pencil className="w-2.5 h-2.5 opacity-40" />
                            </button>
                          ) : null}
                          {!m.profile_id && orgMembers.length > 0 && (
                            <select
                              className="mt-0.5 input text-xs py-0.5 px-1 max-w-[160px]"
                              defaultValue=""
                              onChange={async e => {
                                const uid = e.target.value
                                if (!uid) return
                                await updateEquipeMembreProfile(m.id, uid)
                                setAllEquipes(prev => prev.map(eq => eq.id !== equipe.id ? eq : {
                                  ...eq,
                                  membres: eq.membres.map(mm => mm.id !== m.id ? mm : { ...mm, profile_id: uid }),
                                }))
                              }}
                            >
                              <option value="" disabled>Lier à un compte application...</option>
                              {orgMembers.map(om => (
                                <option key={om.user_id} value={om.user_id}>
                                  {om.full_name ?? om.email}
                                </option>
                              ))}
                            </select>
                          )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveMembre(equipe.id, m.id)}
                        disabled={removingMembres.has(m.id)}
                        className="self-end p-1.5 rounded-lg text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors flex-shrink-0 disabled:opacity-40 sm:self-auto"
                      >
                        {removingMembres.has(m.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  )
                })}
                <div className="space-y-2 pt-1">
                  {/* Multi-sélection comptes application */}
                  {orgMembers.length > 0 && (() => {
                    const pending = pendingMembreIds[equipe.id] ?? new Set<string>()
                    const available = orgMembers.filter(m => !equipe.membres.some(em => em.profile_id === m.user_id))
                    if (!available.length) return null
                    return (
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold text-secondary">Comptes application de l&apos;organisation</p>
                        <div className="flex flex-wrap gap-1.5">
                          {available.map(m => {
                            const selected = pending.has(m.user_id)
                            const isMe = currentUserId === m.user_id
                            return (
                              <button
                                key={m.user_id}
                                type="button"
                                onClick={() => setPendingMembreIds(prev => {
                                  const cur = new Set(prev[equipe.id] ?? [])
                                  selected ? cur.delete(m.user_id) : cur.add(m.user_id)
                                  return { ...prev, [equipe.id]: cur }
                                })}
                                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${selected ? 'bg-accent text-white border-accent' : 'border-[var(--elevation-border)] text-secondary hover:border-accent/40 hover:text-primary'}`}
                              >
                                {selected && <Check className="w-3 h-3" />}
                                {isMe ? 'Moi' : (m.full_name ?? m.email)}
                                {m.job_title && <span className="opacity-70">· {m.job_title}</span>}
                              </button>
                            )
                          })}
                        </div>
                        {pending.size > 0 && (
                          <button
                            onClick={() => handleAddMultipleMembres(equipe.id)}
                            disabled={addingMembres.has(equipe.id)}
                            className="inline-flex w-full items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent/90 disabled:opacity-50 sm:w-auto"
                          >
                            {addingMembres.has(equipe.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />}
                            <span>Ajouter</span>
                            <span className="rounded-full bg-white/20 px-1.5 py-0.5 leading-none">{pending.size}</span>
                          </button>
                        )}
                      </div>
                    )
                  })()}
                  {/* Saisie libre (intervenant externe) */}
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-secondary">Intervenant externe sans compte application</p>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        className="input flex-1 text-sm min-w-0"
                        placeholder="Nom"
                        value={mForm.name}
                        onChange={e => setMemberForms(prev => ({ ...prev, [equipe.id]: { ...mForm, name: e.target.value } }))}
                        onKeyDown={e => e.key === 'Enter' && handleAddMembre(equipe.id)}
                      />
                      <div className="flex gap-2">
                        <RoleLabelSelect
                          className="input flex-1 sm:w-32 text-sm"
                          value={mForm.role}
                          onChange={value => setMemberForms(prev => ({ ...prev, [equipe.id]: { ...mForm, role: value } }))}
                          roles={orgRoles}
                        />
                        {canEditRates && (
                          <input
                            type="number"
                            min="0"
                            step="0.5"
                            className="input w-20 text-sm"
                            placeholder="€/h"
                            value={mForm.taux ?? ''}
                            onChange={e => setMemberForms(prev => ({ ...prev, [equipe.id]: { ...mForm, taux: e.target.value } }))}
                            onKeyDown={e => e.key === 'Enter' && handleAddMembre(equipe.id)}
                          />
                        )}
                        <button
                          onClick={() => handleAddMembre(equipe.id)}
                          disabled={!mForm.name.trim() || addingMembres.has(equipe.id)}
                          className="btn-primary px-3 flex items-center gap-1 disabled:opacity-50"
                        >
                          {addingMembres.has(equipe.id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Rapports PDF membres individuels ────────────────────────────────────────

type ReportMember = {
  id: string          // member_id (fantôme) ou user_id (auth)
  idType: 'member' | 'user'
  fullName: string
  roleLabel?: string | null
}

// ─── Accordéon pointages par membre ──────────────────────────────────────────

function PointageAccordion({
  groups,
  canManage,
  onDelete,
}: {
  groups: { key: string; name: string; total: number; entries: Pointage[] }[]
  canManage: boolean
  onDelete: (p: Pointage) => void
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (key: string) =>
    setOpen(prev => { const s = new Set(prev); s.has(key) ? s.delete(key) : s.add(key); return s })

  return (
    <div className="card overflow-hidden divide-y divide-[var(--elevation-border)]">
      {groups.map(g => {
        const isOpen = open.has(g.key)
        const sorted = [...g.entries].sort((a, b) => b.date.localeCompare(a.date))
        return (
          <div key={g.key}>
            <button
              onClick={() => toggle(g.key)}
              className="w-full flex items-center gap-3 px-4 py-3 hover:bg-[var(--elevation-1)] transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-full bg-accent/15 text-accent flex items-center justify-center font-bold text-sm flex-shrink-0">
                {g.name[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-primary truncate">{g.name}</p>
                <p className="text-xs text-secondary">{g.entries.length} pointage{g.entries.length > 1 ? 's' : ''}</p>
              </div>
              <p className="font-extrabold text-primary text-sm flex-shrink-0">{fmtHours(g.total)}</p>
              {isOpen
                ? <ChevronUp className="w-4 h-4 text-secondary flex-shrink-0" />
                : <ChevronDown className="w-4 h-4 text-secondary flex-shrink-0" />}
            </button>
            {isOpen && (
              <div className="border-t border-[var(--elevation-border)] bg-[var(--elevation-1)]/40">
                {sorted.map(p => (
                  <div key={p.id} className="flex items-start gap-3 px-5 py-2.5 border-b border-[var(--elevation-border)] last:border-b-0">
                    <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-0.5 min-w-0">
                      <span className="text-xs text-secondary">
                        {new Date(p.date + 'T00:00:00').toLocaleDateString('fr-FR')}
                        {p.start_time ? <span className="ml-1 text-secondary/60">{p.start_time.slice(0, 5)}</span> : null}
                      </span>
                      <span className="text-xs font-semibold text-primary">{fmtHours(p.hours)}</span>
                      {p.tache_title
                        ? <span className="text-xs text-secondary truncate sm:col-span-1">{p.tache_title}</span>
                        : <span className="text-xs text-secondary/40">—</span>}
                      {p.description
                        ? <span className="text-xs text-secondary truncate sm:col-span-1">{p.description}</span>
                        : <span className="text-xs text-secondary/40">—</span>}
                    </div>
                    {canManage && (
                      <button onClick={() => onDelete(p)} className="text-secondary hover:text-red-500 transition-colors flex-shrink-0 mt-0.5">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function MemberHoursReports({
  pointages,
  individualMembers,
}: {
  pointages: Pointage[]
  individualMembers: import('@/lib/data/queries/members').IndividualMember[]
}) {
  // Construire la liste dédupliquée de tous les membres qui ont pointé
  const members = React.useMemo<ReportMember[]>(() => {
    const seen = new Set<string>()
    const result: ReportMember[] = []

    for (const p of pointages) {
      if (p.member_id && !seen.has(p.member_id)) {
        seen.add(p.member_id)
        const info = individualMembers.find(m => m.id === p.member_id)
        const fullName = info
          ? ([info.prenom, info.name].filter(Boolean).join(' ') || info.name)
          : p.user_name
        result.push({ id: p.member_id, idType: 'member', fullName, roleLabel: info?.role_label })
      } else if (p.user_id && !seen.has(p.user_id)) {
        seen.add(p.user_id)
        result.push({ id: p.user_id, idType: 'user', fullName: p.user_name })
      }
    }

    return result.sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'))
  }, [pointages, individualMembers])

  const now = new Date()
  const thisYear = now.getFullYear()
  const defaultMonthIdx = now.getMonth()
  const minYear = thisYear - 1

  // "YYYY-MM" ou "YYYY" (année complète)
  const [selections, setSelections] = React.useState<Record<string, string>>({})
  const getSelection = (id: string) => selections[id] ?? `${thisYear}-${String(defaultMonthIdx + 1).padStart(2, '0')}`

  const stepMonth = (id: string, dir: 1 | -1) => {
    const sel = getSelection(id)
    if (sel.length === 4) return
    const [y, m] = sel.split('-').map(Number)
    let nm = m + dir
    let ny = y
    if (nm > 12) { nm = 1; ny++ }
    if (nm < 1) { nm = 12; ny-- }
    if (ny < minYear || ny > thisYear) return
    setSelections(prev => ({ ...prev, [id]: `${ny}-${String(nm).padStart(2, '0')}` }))
  }

  const handleDownload = (m: ReportMember) => {
    const sel = getSelection(m.id)
    let dateFrom: string
    let dateTo: string
    if (sel.length === 4) {
      dateFrom = `${sel}-01-01`
      dateTo = `${sel}-12-31`
    } else {
      const [y, mo] = sel.split('-').map(Number)
      dateFrom = `${sel}-01`
      dateTo = new Date(y, mo, 0).toISOString().slice(0, 10)
    }
    const params = new URLSearchParams({ from: dateFrom, to: dateTo, download: '1', type: m.idType })
    window.open(`/api/pdf/member/${m.id}?${params.toString()}`, '_blank')
  }

  const selectOptions = React.useMemo(() => {
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
  }, [minYear, now, thisYear])

  if (members.length === 0) return null

  return (
    <div className="card overflow-hidden">
      <div className="p-4 border-b border-[var(--elevation-border)] flex items-center gap-2">
        <Download className="w-4 h-4 text-accent" />
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
              <button
                onClick={() => stepMonth(m.id, -1)}
                disabled={getSelection(m.id).length === 4}
                className="btn-secondary h-7 w-7 p-0 flex items-center justify-center disabled:opacity-30"
                title="Mois précédent"
                aria-label="Mois précédent"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
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
                className="btn-secondary h-7 w-7 p-0 flex items-center justify-center disabled:opacity-30"
                title="Mois suivant"
                aria-label="Mois suivant"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleDownload(m)}
                className="btn-secondary text-xs flex items-center gap-1.5 py-1 px-2.5"
                title="Télécharger le rapport d'heures PDF"
              >
                <Download className="w-3.5 h-3.5" /> PDF
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function ChantierDetailClient({
  chantier: initialChantier,
  initialTaches,
  initialPointages,
  initialPhotos,
  initialNotes,
  allEquipes,
  initialChantierEquipes,
  initialPlannings,
  linkableQuotes,
  taskLibraryTitles,
  orgMembers,
  orgRoles = [],
  initialProfitability,
  initialJalons,
  initialIndividualMembers = [],
  orgPhantomMembers = [],
  invoiceStubs = [],
  orgSector = null,
  materials = [],
  situationsSummary = null,
  canCreateSituation = false,
  canCreateSolde = false,
  canCreateInvoice = false,
  currentUserId = null,
  permissions,
  initialReserves = [],
}: {
  chantier: ChantierDetail
  initialTaches: Tache[]
  initialPointages: Pointage[]
  initialPhotos: ChantierPhoto[]
  initialNotes: ChantierNote[]
  allEquipes: Equipe[]
  initialChantierEquipes: Equipe[]
  initialPlannings: ChantierPlanning[]
  linkableQuotes: QuoteStub[]
  taskLibraryTitles: string[]
  orgMembers: TeamMember[]
  orgRoles?: OrgRole[]
  initialProfitability: ChantierProfitability
  initialJalons: ChantierJalon[]
  initialIndividualMembers?: import('@/lib/data/queries/members').IndividualMember[]
  orgPhantomMembers?: import('@/lib/data/queries/members').IndividualMember[]
  invoiceStubs?: import('@/lib/data/queries/invoices').InvoiceStub[]
  orgSector?: string | null
  materials?: import('@/lib/data/queries/catalog').CatalogMaterial[]
  situationsSummary?: SituationsSummary | null
  canCreateSituation?: boolean
  canCreateSolde?: boolean
  canCreateInvoice?: boolean
  currentUserId?: string | null
  permissions: ChantierPermissions
  initialReserves?: ChantierReserve[]
}) {
  const router = useRouter()

  const [chantier] = useState(initialChantier)
  const [taches, setTaches] = useState(initialTaches)
  const [pointages, setPointages] = useState(initialPointages)
  const [deletedPointages, setDeletedPointages] = useState<DeletedPointageInfo[]>([])
  const [photos, setPhotos] = useState(initialPhotos)
  const [notes, setNotes] = useState(initialNotes)
  const [plannings, setPlannings] = useState(initialPlannings)
  const [tab, setTab] = useState<Tab>('taches')
  const {
    canEditChantier,
    canManageTeam,
    canPointage,
    canManagePointages,
    canViewExpenses,
    canCreateExpenses,
    canEditExpenses,
    canDeleteExpenses,
    canEditRates,
  } = permissions

  useEffect(() => {
    setPlannings(initialPlannings)
  }, [initialPlannings])

  useEffect(() => {
    if (tab === 'rentabilite' && !canViewExpenses && !canCreateExpenses) setTab('taches')
    if (tab === 'equipes' && !canManageTeam) setTab('taches')
    if (tab === 'planning' && !canEditChantier) setTab('taches')
    if (tab === 'jalons' && !canEditChantier) setTab('taches')
    if (tab === 'photos' && !canEditChantier) setTab('taches')
    if (tab === 'notes' && !canEditChantier) setTab('taches')
    if (tab === 'pointages' && !canPointage && !canManagePointages) setTab('taches')
  }, [tab, canViewExpenses, canManageTeam, canEditChantier, canPointage, canManagePointages])

  // Tâches
  const [newTacheTitle, setNewTacheTitle] = useState('')
  const [newTacheDue, setNewTacheDue] = useState('')
  const [newTacheEquipeIds, setNewTacheEquipeIds] = useState<Set<string>>(new Set())
  const [newTacheMemberIds, setNewTacheMemberIds] = useState<Set<string>>(new Set())
  const [showNewTacheAssignments, setShowNewTacheAssignments] = useState(false)
  const [tacheLoading, setTacheLoading] = useState(false)

  // Pointages
  const [ptDate, setPtDate] = useState(todayParis())
  const [ptStartTime, setPtStartTime] = useState('')
  const [ptHoursInt, setPtHoursInt] = useState('')
  const [ptMinutes, setPtMinutes] = useState('0')
  const [ptDesc, setPtDesc] = useState('')
  const [ptTacheId, setPtTacheId] = useState('')
  const [ptLoading, setPtLoading] = useState(false)
  const [ptMode, setPtMode] = useState<'me' | 'team'>('me')
  const [ptEquipeId, setPtEquipeId] = useState(initialChantierEquipes[0]?.id ?? '')
  const [ptPresentMemberIds, setPtPresentMemberIds] = useState<Set<string>>(
    () => new Set(initialChantierEquipes[0]?.membres.map(m => m.id) ?? []),
  )

  // Notes
  const [noteContent, setNoteContent] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)

  // Photos
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoLoading, setPhotoLoading] = useState(false)
  // Lightbox
  const [lightboxPhoto, setLightboxPhoto] = useState<ChantierPhoto | null>(null)
  const [lightboxTitle, setLightboxTitle] = useState('')
  const [lightboxCaption, setLightboxCaption] = useState('')
  const [lightboxSaving, setLightboxSaving] = useState(false)
  // Sélection multiple + envoi client
  const [selectedPhotoIds, setSelectedPhotoIds] = useState<Set<string>>(new Set())
  const [showSendPhotosPanel, setShowSendPhotosPanel] = useState(false)
  const [photosEmailMsg, setPhotosEmailMsg] = useState('')
  const [photosEmailStatus, setPhotosEmailStatus] = useState<'idle'|'sending'|'done'|'error'>('idle')
  const [photosEmailError, setPhotosEmailError] = useState<string | null>(null)
  const [photosEmailRecipient, setPhotosEmailRecipient] = useState('')

  // Contact référent - édition inline
  const [editContact, setEditContact] = useState(false)
  const [contactName, setContactName] = useState(chantier.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(chantier.contact_email ?? '')
  const [contactPhone, setContactPhone] = useState(chantier.contact_phone ?? '')
  const [chantierClientEmail, setChantierClientEmail] = useState(chantier.client?.email ?? '')
  const [contactSaving, setContactSaving] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)

  // Dates - édition inline
  const [editDates, setEditDates] = useState(false)
  const [startDate, setStartDate] = useState(chantier.start_date ?? '')
  const [estimatedEndDate, setEstimatedEndDate] = useState(chantier.estimated_end_date ?? '')
  const [datesSaving, setDatesSaving] = useState(false)
  const [datesError, setDatesError] = useState<string | null>(null)

  // Facturation périodique - édition inline avec selects
  const initialBillingParts = splitDateParts(chantier.prochaine_facturation)
  const [editBilling, setEditBilling] = useState(false)
  const [billingAmount, setBillingAmount] = useState(chantier.montant_periode_ht != null ? String(chantier.montant_periode_ht) : '')
  const [billingLabel, setBillingLabel] = useState(chantier.libelle_facturation_periode ?? '')
  const [billingPeriod, setBillingPeriod] = useState<BillingPeriod>(chantier.periode_facturation ?? 'none')
  const [billingDay, setBillingDay] = useState(String(chantier.jour_facturation ?? Number(initialBillingParts.day) ?? 1))
  const [billingMonth, setBillingMonth] = useState(initialBillingParts.month)
  const [billingYear, setBillingYear] = useState(initialBillingParts.year)
  const [billingSaving, setBillingSaving] = useState(false)
  const [billingGenerating, setBillingGenerating] = useState(false)
  const [billingError, setBillingError] = useState<string | null>(null)

  // Retenue de garantie par défaut
  const [editRetention, setEditRetention] = useState(false)
  const [retentionPct, setRetentionPct] = useState(String(chantier.default_retention_pct ?? 0))
  const [retentionSaving, setRetentionSaving] = useState(false)
  const [retentionError, setRetentionError] = useState<string | null>(null)

  const handleSaveRetention = async () => {
    const val = parseFloat(retentionPct)
    if (isNaN(val) || val < 0 || val > 100) { setRetentionError('Taux invalide (0-100).'); return }
    setRetentionSaving(true)
    setRetentionError(null)
    const res = await updateChantier(chantier.id, { defaultRetentionPct: val })
    setRetentionSaving(false)
    if (res.error) { setRetentionError(res.error); return }
    setEditRetention(false)
  }

  // Devis lié
  const [linkedQuoteId, setLinkedQuoteId] = useState<string | null>(chantier.quote_id)
  const [editQuoteLink, setEditQuoteLink] = useState(false)
  const [quoteLinkValue, setQuoteLinkValue] = useState(chantier.quote_id ?? '')
  const [quoteLinkSaving, setQuoteLinkSaving] = useState(false)

  // Assistant IA chantier
  const [showAIAssistant, setShowAIAssistant] = useState(false)

  const linkedQuote = linkableQuotes.find(q => q.id === linkedQuoteId) ?? null

  const handleSaveQuoteLink = async () => {
    if (!canEditChantier) return
    setQuoteLinkSaving(true)
    const { error } = await updateChantier(chantier.id, { quoteId: quoteLinkValue || null })
    if (error) { alert(error); setQuoteLinkSaving(false); return }
    setLinkedQuoteId(quoteLinkValue || null)
    setEditQuoteLink(false)
    setQuoteLinkSaving(false)
  }

  const handleSaveContact = async () => {
    if (!canEditChantier) return
    setContactSaving(true)
    setContactError(null)
    const { error } = await updateChantier(chantier.id, {
      contactName: contactName.trim() || null,
      contactEmail: contactEmail.trim() || null,
      contactPhone: contactPhone.trim() || null,
    })
    setContactSaving(false)
    if (error) { setContactError(error); return }
    setEditContact(false)
  }

  const handleSaveDates = async () => {
    if (!canEditChantier) return
    setDatesSaving(true)
    setDatesError(null)
    const { error } = await updateChantier(chantier.id, {
      startDate: startDate || null,
      estimatedEndDate: estimatedEndDate || null,
    })
    setDatesSaving(false)
    if (error) { setDatesError(error); return }
    setEditDates(false)
  }

  const selectedBillingDate = buildDateFromParts(billingYear, billingMonth, billingDay)
  const billingYears = useMemo(() => {
    const now = new Date()
    const start = now.getFullYear()
    return Array.from({ length: 8 }, (_, i) => start + i)
  }, [])

  const handleSaveBilling = async () => {
    if (!canEditChantier) return
    const amount = billingAmount.trim() ? parseFloat(billingAmount.replace(',', '.')) : null
    if (amount != null && (Number.isNaN(amount) || amount < 0)) {
      setBillingError('Montant invalide.')
      return
    }
    setBillingSaving(true)
    setBillingError(null)
    const { error } = await updateChantier(chantier.id, {
      montantPeriodeHt: amount,
      libelleFacturationPeriode: billingLabel || null,
      periodeFacturation: billingPeriod,
      jourFacturation: Number(billingDay),
      prochaineFacturation: billingPeriod === 'none' || !amount ? null : selectedBillingDate,
    })
    setBillingSaving(false)
    if (error) { setBillingError(error); return }
    setEditBilling(false)
  }

  const handleGeneratePeriodInvoice = async () => {
    if (!canCreateInvoice) return
    setBillingGenerating(true)
    setBillingError(null)
    const { invoiceId, error } = await generateChantierPeriodInvoice(chantier.id)
    setBillingGenerating(false)
    if (error || !invoiceId) {
      setBillingError(error ?? 'Facture introuvable.')
      return
    }
    router.push(`/finances/invoice-editor?id=${invoiceId}&returnTo=${encodeURIComponent(`/chantiers/${chantier.id}`)}`)
  }

  // PDF période
  const [showPdfPanel, setShowPdfPanel] = useState(false)
  const [pdfFrom, setPdfFrom] = useState('')
  const [pdfTo, setPdfTo] = useState('')

  // Email rapport
  type EmailStatus = 'idle' | 'sending' | 'done' | 'error'
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('idle')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailRecipient, setEmailRecipient] = useState<string | null>(null)
  const [reportEmailRequiredOpen, setReportEmailRequiredOpen] = useState(false)
  const [photosEmailRequiredOpen, setPhotosEmailRequiredOpen] = useState(false)

  const getReportClientEmailTarget = () => {
    if (!chantier.client) return null
    return {
      id: chantier.client.id,
      company_name: chantier.client.company_name,
      email: chantierClientEmail,
    }
  }

  const handleSendReportEmail = async (skipEmailCheck = false) => {
    if (!canEditChantier) return
    if (!skipEmailCheck && !contactEmail.trim() && chantier.client && !chantierClientEmail.trim()) {
      setEmailError(null)
      setEmailStatus('idle')
      setReportEmailRequiredOpen(true)
      return
    }
    if (!contactEmail.trim() && !chantier.client) {
      setEmailStatus('error')
      setEmailError('Ajoutez un email de contact référent ou liez ce chantier à un client.')
      setEditContact(true)
      return
    }
    setEmailStatus('sending')
    setEmailError(null)
    const { error, recipient } = await sendChantierReportEmail(chantier.id, {
      dateFrom: pdfFrom || undefined,
      dateTo: pdfTo || undefined,
    })
    if (error) {
      setEmailStatus('error')
      setEmailError(error)
    } else {
      setEmailStatus('done')
      setEmailRecipient(recipient ?? null)
      setTimeout(() => setEmailStatus('idle'), 4000)
    }
  }

  const handleReportClientEmailSaved = async (email: string) => {
    setChantierClientEmail(email)
    setReportEmailRequiredOpen(false)
    await handleSendReportEmail(true)
  }

  const handleSendPhotosEmail = async (skipEmailCheck = false) => {
    if (!skipEmailCheck && !contactEmail.trim() && chantier.client && !chantierClientEmail.trim()) {
      setPhotosEmailError(null)
      setPhotosEmailStatus('idle')
      setPhotosEmailRequiredOpen(true)
      return
    }
    if (!contactEmail.trim() && !chantier.client) {
      setPhotosEmailStatus('error')
      setPhotosEmailError('Ajoutez un email de contact référent ou liez ce chantier à un client.')
      setEditContact(true)
      return
    }
    setPhotosEmailStatus('sending')
    setPhotosEmailError(null)
    const { error, recipient } = await sendChantierPhotosEmail({
      chantierId: chantier.id,
      photoIds: Array.from(selectedPhotoIds),
      message: photosEmailMsg || `Veuillez trouver ci-joint des photos du chantier "${chantier.title}".`,
    })
    if (error) {
      setPhotosEmailStatus('error')
      setPhotosEmailError(error)
      return
    }
    setPhotosEmailStatus('done')
    setPhotosEmailRecipient(recipient ?? '')
    setPhotos(prev => prev.map(p => selectedPhotoIds.has(p.id) ? { ...p, shared_with_client_at: new Date().toISOString() } : p))
  }

  const handlePhotosClientEmailSaved = async (email: string) => {
    setChantierClientEmail(email)
    setPhotosEmailRequiredOpen(false)
    await handleSendPhotosEmail(true)
  }

  // Situation — géré par SituationsSection

  // Task suggestions
  type TaskSuggestion = { _id: string; title: string; editing: boolean }
  const [taskSuggestions, setTaskSuggestions] = useState<TaskSuggestion[]>([])
  const [suggestTasksLoading, setSuggestTasksLoading] = useState(false)
  const [suggestTasksError, setSuggestTasksError] = useState<string | null>(null)
  const [suggestTasksCreditsError, setSuggestTasksCreditsError] = useState(false)
  const [showTaskSuggestions, setShowTaskSuggestions] = useState(false)
  const [validateAllLoading, setValidateAllLoading] = useState(false)
  const [validatingSuggId, setValidatingSuggId] = useState<string | null>(null)

  // Task library
  const [showTaskLibrary, setShowTaskLibrary] = useState(false)
  const [taskLibraryFilter, setTaskLibraryFilter] = useState('')

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  // ── Helpers ──

  const fmtDate = (d: string | null) => d
    ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
    : '-'

  const fmtMoney = (n: number) =>
    n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

  const totalHours = pointages.reduce((s, p) => s + p.hours, 0)
  const selectedPointageEquipe = initialChantierEquipes.find(e => e.id === ptEquipeId) ?? null
  const allAssignableMembers = useMemo(() => {
    const map = new Map<string, IndividualMember>()
    const equipeMembers: IndividualMember[] = allEquipes.flatMap(e => e.membres.map(member => ({
      id: member.id,
      organization_id: e.organization_id,
      equipe_id: member.equipe_id,
      prenom: member.prenom,
      name: member.name,
      email: member.email,
      role_label: member.role_label,
      taux_horaire: member.taux_horaire,
      profile_id: member.profile_id,
      created_at: e.created_at,
    })))
    for (const member of [...initialIndividualMembers, ...orgPhantomMembers, ...equipeMembers]) {
      map.set(member.id, member)
    }
    return Array.from(map.values()).sort((a, b) =>
      [a.prenom, a.name].filter(Boolean).join(' ').localeCompare([b.prenom, b.name].filter(Boolean).join(' '), 'fr')
    )
  }, [initialIndividualMembers, orgPhantomMembers, allEquipes])

  // Compteurs dérivés du state vivant (pas du snapshot chantier initial)
  const tachesCount = taches.length
  const tachesDone = taches.filter(t => t.status === 'termine').length
  const donePct = tachesCount > 0 ? Math.round((tachesDone / tachesCount) * 100) : 0

  // ── Tâches ──

  const handleAddTache = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (!canEditChantier) return
    if (!newTacheTitle.trim()) return
    setTacheLoading(true)
    const titleToAdd = newTacheTitle.trim()
    const dueToAdd = newTacheDue || null
    const equipeIdsToAdd = Array.from(newTacheEquipeIds)
    const memberIdsToAdd = Array.from(newTacheMemberIds)
    const { tacheId, error } = await createTache(chantier.id, {
      title: titleToAdd,
      dueDate: dueToAdd,
      equipeIds: equipeIdsToAdd,
      memberIds: memberIdsToAdd,
    })
    setTacheLoading(false)
    if (!error && tacheId) {
      setTaches(prev => [...prev, {
        id: tacheId,
        chantier_id: chantier.id,
        title: titleToAdd,
        description: null,
        status: 'a_faire',
        position: prev.length,
        assigned_to: null,
        due_date: dueToAdd,
        progress_note: null,
        completed_at: null,
        created_at: new Date().toISOString(),
        jalon_id: null,
        assignments: [
          ...equipeIdsToAdd.map(id => {
            const equipe = allEquipes.find(e => e.id === id)
            return {
              id: `temp-eq-${id}`,
              tache_id: tacheId,
              equipe_id: id,
              member_id: null,
              label: equipe?.name ?? 'Équipe',
              color: equipe?.color ?? null,
            }
          }),
          ...memberIdsToAdd.map(id => {
            const member = allAssignableMembers.find(m => m.id === id)
            return {
              id: `temp-m-${id}`,
              tache_id: tacheId,
              equipe_id: null,
              member_id: id,
              label: [member?.prenom, member?.name].filter(Boolean).join(' ') || member?.email || 'Membre',
              color: null,
            }
          }),
        ],
      }])
      setNewTacheTitle('')
      setNewTacheDue('')
      setNewTacheEquipeIds(new Set())
      setNewTacheMemberIds(new Set())
      setShowNewTacheAssignments(false)
    }
  }

  const handleStatusToggle = async (tache: Tache) => {
    if (!canEditChantier) return
    const nextStatus = STATUS_CYCLE[tache.status]
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, status: nextStatus } : t))
    await updateTache(tache.id, chantier.id, { status: nextStatus })
  }

  const handleDeleteTache = async (tache: Tache) => {
    if (!canEditChantier) return
    if (!confirm(`Supprimer la tâche "${tache.title}" ?`)) return
    setTaches(prev => prev.filter(t => t.id !== tache.id))
    await deleteTache(tache.id, chantier.id)
  }

  const handleRenameTache = async (tache: Tache, title: string) => {
    if (!canEditChantier) return
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, title } : t))
    await updateTache(tache.id, chantier.id, { title })
  }

  const handleSaveTacheNote = async (tache: Tache, note: string) => {
    if (!canEditChantier) return
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, progress_note: note || null } : t))
    await updateTache(tache.id, chantier.id, { progressNote: note || null })
  }

  const handleSaveTacheAssignments = async (tache: Tache, equipeIds: string[], memberIds: string[]) => {
    if (!canEditChantier) return
    setTaches(prev => prev.map(t => t.id === tache.id ? {
      ...t,
      assignments: [
        ...equipeIds.map(id => {
          const equipe = allEquipes.find(e => e.id === id)
          return {
            id: `local-eq-${id}`,
            tache_id: tache.id,
            equipe_id: id,
            member_id: null,
            label: equipe?.name ?? 'Équipe',
            color: equipe?.color ?? null,
          }
        }),
        ...memberIds.map(id => {
          const member = allAssignableMembers.find(m => m.id === id)
          return {
            id: `local-m-${id}`,
            tache_id: tache.id,
            equipe_id: null,
            member_id: id,
            label: [member?.prenom, member?.name].filter(Boolean).join(' ') || member?.email || 'Membre',
            color: null,
          }
        }),
      ],
    } : t))
    await updateTache(tache.id, chantier.id, { equipeIds, memberIds })
  }

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!canEditChantier) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIdx = taches.findIndex(t => t.id === active.id)
    const newIdx = taches.findIndex(t => t.id === over.id)
    const reordered = arrayMove(taches, oldIdx, newIdx).map((t, i) => ({ ...t, position: i }))
    setTaches(reordered)
    await reorderTaches(chantier.id, reordered.map(t => t.id))
  }

  // ── Task suggestions ──

  const handleSuggestTasks = async () => {
    if (!canEditChantier) return
    if (!linkedQuoteId) return
    setSuggestTasksLoading(true)
    setSuggestTasksError(null)

    const { visible } = await getQuoteItemsForSuggestions(linkedQuoteId)
    if (visible.length === 0) {
      setSuggestTasksError('Aucune prestation visible trouvée dans le devis lié.')
      setSuggestTasksLoading(false)
      return
    }

    try {
      const res = await fetch('/api/ai/suggest-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: visible }),
      })
      const data = await res.json()
      if (!res.ok || data.error) {
        if (res.status === 402) { setSuggestTasksCreditsError(true); setSuggestTasksLoading(false); return }
        setSuggestTasksError(data.error ?? 'Erreur lors de la génération')
        setSuggestTasksLoading(false)
        return
      }
      setShowTaskSuggestions(false)
      setTaskSuggestions((data as { title: string }[]).map((t, i) => ({
        _id: `sugg_${i}_${Date.now()}`,
        title: t.title,
        editing: false,
      })))
      setShowTaskSuggestions(true)
    } catch {
      setSuggestTasksError('Erreur réseau.')
    }
    setSuggestTasksLoading(false)
  }

  const handleValidateSuggestion = async (id: string) => {
    if (!canEditChantier) return
    if (validatingSuggId || validateAllLoading) return
    const sugg = taskSuggestions.find(s => s._id === id)
    if (!sugg || !sugg.title.trim()) return
    setValidatingSuggId(id)
    const { tacheId } = await createTache(chantier.id, { title: sugg.title.trim() })
    if (tacheId) {
      setTaches(prev => [...prev, {
        id: tacheId, chantier_id: chantier.id, title: sugg.title.trim(),
        description: null, status: 'a_faire', position: prev.length,
        assigned_to: null, due_date: null, progress_note: null,
        completed_at: null, created_at: new Date().toISOString(), jalon_id: null,
        assignments: [],
      }])
      setTaskSuggestions(prev => {
        const next = prev.filter(s => s._id !== id)
        if (next.length === 0) setShowTaskSuggestions(false)
        return next
      })
    }
    setValidatingSuggId(null)
  }

  const handleValidateAllSuggestions = async () => {
    if (!canEditChantier) return
    if (validateAllLoading) return
    setValidateAllLoading(true)
    const remaining = taskSuggestions.filter(s => s.title.trim())
    const startPos = taches.length
    const newTaches: Tache[] = []
    for (let i = 0; i < remaining.length; i++) {
      const { tacheId } = await createTache(chantier.id, { title: remaining[i].title.trim() })
      if (tacheId) {
        newTaches.push({
          id: tacheId, chantier_id: chantier.id, title: remaining[i].title.trim(),
          description: null, status: 'a_faire', position: startPos + i,
          assigned_to: null, due_date: null, progress_note: null,
          completed_at: null, created_at: new Date().toISOString(), jalon_id: null,
          assignments: [],
        })
      }
    }
    setTaches(prev => [...prev, ...newTaches])
    setTaskSuggestions([])
    setShowTaskSuggestions(false)
    setValidateAllLoading(false)
  }

  // ── Plannings ──

  const handleAddPlanning = async (data: { plannedDate: string; startTime: string; endTime: string; label: string; equipeId: string | null; memberId: string | null; teamSize: number; notes: string }): Promise<string | null> => {
    if (!canEditChantier) return 'Action non autorisée.'
    const { planningId, error } = await createChantierPlanning(chantier.id, {
      plannedDate: data.plannedDate,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      equipeId: data.equipeId,
      memberId: data.memberId,
      label: data.label,
      teamSize: data.teamSize,
      notes: data.notes || null,
    })
    if (error) return error
    if (planningId) {
      setPlannings(prev => [...prev, {
        id: planningId,
        chantier_id: chantier.id,
        planned_date: data.plannedDate,
        start_time: data.startTime || null,
        end_time: data.endTime || null,
        equipe_id: data.equipeId,
        member_id: data.memberId,
        label: data.label,
        team_size: data.teamSize,
        notes: data.notes || null,
        created_at: new Date().toISOString(),
        route_id: null,
        route_order: null,
        duration_min: null,
        travel_from_prev_min: null,
      }])
    }
    return null
  }

  const handleDeletePlanning = async (planningId: string) => {
    if (!canEditChantier) return
    setPlannings(prev => prev.filter(p => p.id !== planningId))
    await deleteChantierPlanning(planningId, chantier.id)
  }

  // ── Pointages ──

  const handleAddPointage = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (ptMode === 'team' && !canManagePointages) return
    if (ptMode !== 'team' && !canPointage) return
    const h = parseInt(ptHoursInt) || 0
    const m = parseInt(ptMinutes) || 0
    const hours = h + m / 60
    if (!ptDate || hours <= 0) return
    if (ptMode === 'team' && ptPresentMemberIds.size === 0) return

    const savedDate = ptDate
    const savedHours = ptHoursInt
    const savedMinutes = ptMinutes
    const savedDesc = ptDesc
    const savedStartTime = ptStartTime
    const savedTacheId = ptTacheId
    const savedMode = ptMode
    const savedMembers = selectedPointageEquipe?.membres.filter(m => ptPresentMemberIds.has(m.id)) ?? []
    const tacheTitle = taches.find(t => t.id === savedTacheId)?.title ?? null

    const tempPointages: Pointage[] = savedMode === 'team'
      ? savedMembers.map(member => ({
          id: crypto.randomUUID(),
          chantier_id: chantier.id,
          tache_id: savedTacheId || null,
          user_id: null,
          member_id: member.id,
          date: savedDate,
          hours,
          description: savedDesc || null,
          created_at: new Date().toISOString(),
          start_time: savedStartTime || null,
          user_name: [member.prenom, member.name].filter(Boolean).join(' ') || member.name,
          tache_title: tacheTitle,
        }))
      : [{
          id: crypto.randomUUID(),
          chantier_id: chantier.id,
          tache_id: savedTacheId || null,
          user_id: 'temp',
          member_id: null,
          date: savedDate,
          hours,
          description: savedDesc || null,
          created_at: new Date().toISOString(),
          start_time: savedStartTime || null,
          user_name: 'Moi',
          tache_title: tacheTitle,
        }]

    setPointages(prev => [...tempPointages, ...prev])

    setPtHoursInt('')
    setPtMinutes('0')
    setPtDesc('')
    setPtStartTime('')

    setPtLoading(true)
    let error: string | null = null
    if (savedMode === 'team') {
      for (const member of savedMembers) {
        const result = await createMemberPointageAdmin(chantier.id, member.id, {
          date: savedDate,
          hours,
          description: savedDesc || null,
          start_time: savedStartTime || null,
        })
        if (result.error) {
          error = result.error
          break
        }
      }
    } else {
      const result = await createPointage(chantier.id, {
        date: savedDate,
        hours,
        tacheId: savedTacheId || null,
        description: savedDesc || null,
        start_time: savedStartTime || null,
      })
      error = result.error
    }
    setPtLoading(false)
    if (error) {
      const tempIds = new Set(tempPointages.map(p => p.id))
      setPointages(prev => prev.filter(p => !tempIds.has(p.id)))
      setPtHoursInt(savedHours)
      setPtMinutes(savedMinutes)
      setPtDesc(savedDesc)
      setPtStartTime(savedStartTime)
    }
  }

  const handleDeletePointage = async (p: Pointage) => {
    if (!canManagePointages) return
    setPointages(prev => prev.filter(pt => pt.id !== p.id))
    setDeletedPointages(prev => [...prev, { id: p.id, userId: p.user_id, memberId: p.member_id, hours: p.hours }])
    await deletePointage(p.id, chantier.id)
  }

  // ── Notes ──

  const handleAddNote = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (!canEditChantier) return
    const contentToSave = noteContent.trim()
    if (!contentToSave) return

    // Optimistic: ajouter immédiatement
    const tempId = crypto.randomUUID()
    setNotes(prev => [{ id: tempId, chantier_id: chantier.id, content: contentToSave, created_at: new Date().toISOString(), author_name: 'Moi' }, ...prev])
    setNoteContent('')

    setNoteLoading(true)
    const { error } = await createChantierNote(chantier.id, contentToSave)
    setNoteLoading(false)
    if (error) {
      setNotes(prev => prev.filter(n => n.id !== tempId))
      setNoteContent(contentToSave)
    }
  }

  const handleDeleteNote = async (note: ChantierNote) => {
    if (!canEditChantier) return
    setNotes(prev => prev.filter(n => n.id !== note.id))
    await deleteChantierNote(note.id, chantier.id)
  }

  // ── Photos ──

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEditChantier) return
    const file = e.target.files?.[0]
    if (!file) return

    // Prévisualisation immédiate
    const localUrl = URL.createObjectURL(file)
    const tempId = crypto.randomUUID()
    setPhotos(prev => [{
      id: tempId, chantier_id: chantier.id, tache_id: null,
      storage_path: '', caption: null, taken_at: new Date().toISOString(),
      created_at: new Date().toISOString(), uploaded_by_name: 'Moi', url: localUrl,
      include_in_report: false, shared_with_client_at: null, title: null,
    }, ...prev])
    if (fileInputRef.current) fileInputRef.current.value = ''

    setPhotoLoading(true)
    const fd = new FormData()
    fd.append('file', file)
    const result = await uploadChantierPhoto(chantier.id, 'org', fd)
    setPhotoLoading(false)

    if (!result.error && result.photo) {
      const rp = result.photo
      setPhotos(prev => prev.map(p => p.id === tempId ? { ...rp, chantier_id: chantier.id, tache_id: null, include_in_report: false, shared_with_client_at: null, title: null } : p))
      URL.revokeObjectURL(localUrl)
    } else {
      setPhotos(prev => prev.filter(p => p.id !== tempId))
      URL.revokeObjectURL(localUrl)
    }
  }

  const handleDeletePhoto = async (photo: ChantierPhoto) => {
    if (!canEditChantier) return
    if (!confirm('Supprimer cette photo ?')) return
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    await deleteChantierPhoto(photo.id, chantier.id)
  }


  const statusCfg = CHANTIER_STATUS_CONFIG[chantier.status as keyof typeof CHANTIER_STATUS_CONFIG]
    ?? { label: chantier.status, color: 'bg-secondary/20 text-secondary' }

  // donePct est calculé plus haut depuis le state vivant `taches`

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'taches',      label: 'Tâches',      count: taches.length },
    ...(canEditChantier ? [{ id: 'jalons' as const, label: 'Jalons' }] : []),
    ...(canEditChantier ? [{ id: 'planning' as const, label: 'Planning' }] : []),
    ...(canPointage || canManagePointages ? [{ id: 'pointages' as const, label: 'Pointages', count: pointages.length }] : []),
    ...(canEditChantier ? [{ id: 'photos' as const, label: 'Photos', count: photos.length }] : []),
    ...(canEditChantier ? [{ id: 'notes' as const, label: 'Journal', count: notes.length }] : []),
    ...(canManageTeam ? [{ id: 'equipes' as const, label: 'Équipes' }] : []),
    ...((canViewExpenses || canCreateExpenses) ? [{ id: 'rentabilite' as const, label: canViewExpenses ? 'Rentabilité' : 'Mes dépenses' }] : []),
    ...(canEditChantier ? [{ id: 'reception' as const, label: 'Réception' }] : []),
  ]

  return (
    <div className="page-container space-y-6" style={{ maxWidth: '72rem' }}>
      {/* Back + planning global */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.replace('/chantiers')} className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors">
          <ArrowLeft className="w-4 h-4" /> Retour aux chantiers
        </button>
        <Link
          href="/chantiers/planning"
          className="flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors"
          title="Vue planning global"
        >
          <Calendar className="w-4 h-4" />
          <span className="hidden sm:inline">Planning global</span>
        </Link>
      </div>

      {/* Header Card */}
      <div className="card p-6">
        <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-extrabold text-primary">{chantier.title}</h1>
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusCfg.color}`}>
                {statusCfg.label}
              </span>
            </div>
            {chantier.client?.company_name && (
              <p className="text-secondary font-medium">{chantier.client.company_name}</p>
            )}
            <AddressLink
              address_line1={chantier.address_line1}
              postal_code={chantier.postal_code}
              city={chantier.city}
              className="text-secondary text-sm"
              textClassName="text-secondary hover:text-accent"
            />

            {/* Contact référent */}
            {!editContact ? (
              <div className="flex items-start gap-2 mt-1">
                <div className="flex flex-col gap-1">
                  {contactName && (
                    <p className="text-secondary text-sm flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{contactName}</span>
                    </p>
                  )}
                  {contactEmail && (
                    <a
                      href={`mailto:${contactEmail}`}
                      className="text-accent text-sm flex items-center gap-1.5 hover:underline"
                    >
                      <Mail className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{contactEmail}</span>
                    </a>
                  )}
                  {contactPhone && (
                    <a
                      href={`tel:${contactPhone}`}
                      className="text-accent text-sm flex items-center gap-1.5 hover:underline"
                    >
                      <Phone className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>{contactPhone}</span>
                    </a>
                  )}
                </div>
                {canEditChantier && (
                  <button
                    onClick={() => setEditContact(true)}
                    className="p-1 text-secondary hover:text-primary transition-colors flex-shrink-0"
                    title={contactName || contactEmail || contactPhone ? 'Modifier le contact' : 'Ajouter un contact référent'}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 mt-1 p-3 rounded-xl border border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                <input
                  className="input input-sm w-full"
                  placeholder="Nom du contact"
                  value={contactName}
                  onChange={e => setContactName(e.target.value)}
                  autoFocus
                />
                <input
                  className="input input-sm w-full"
                  type="email"
                  placeholder="Email"
                  value={contactEmail}
                  onChange={e => setContactEmail(e.target.value)}
                />
                <input
                  className="input input-sm w-full"
                  type="tel"
                  placeholder="Téléphone"
                  value={contactPhone}
                  onChange={e => setContactPhone(e.target.value)}
                />
                {contactError && (
                  <p className="text-xs text-red-500">{contactError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditContact(false)}
                    className="btn-secondary text-xs py-1 px-2 flex-1"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSaveContact}
                    disabled={contactSaving}
                    className="btn-primary text-xs py-1 px-2 flex-1 flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {contactSaving ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            )}

            {/* Devis lié */}
            {!editQuoteLink ? (
              <div className="flex items-center gap-2 mt-1">
                {linkedQuote ? (
                  <>
                    <Link
                      href={`/finances/quote-editor?id=${linkedQuote.id}&returnTo=${encodeURIComponent(`/chantiers/${chantier.id}`)}`}
                      className="text-sm flex items-center gap-1.5 text-accent hover:underline"
                    >
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-xs">{linkedQuote.number ?? '/'}</span>
                      {linkedQuote.title && <span className="text-secondary">· {linkedQuote.title}</span>}
                    </Link>
                    {canEditChantier && (
                      <button
                        onClick={() => { setQuoteLinkValue(linkedQuote.id); setEditQuoteLink(true) }}
                        className="p-1 text-secondary hover:text-primary transition-colors flex-shrink-0"
                        title="Changer le devis lié"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </>
                ) : canEditChantier ? (
                  <button
                    onClick={() => { setQuoteLinkValue(''); setEditQuoteLink(true) }}
                    className="text-sm text-secondary hover:text-accent transition-colors flex items-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Lier un devis
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-2 mt-1 p-3 rounded-xl border border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                <p className="text-xs font-semibold text-secondary">Devis lié</p>
                <select
                  className="input input-sm w-full"
                  value={quoteLinkValue}
                  onChange={e => setQuoteLinkValue(e.target.value)}
                  autoFocus
                >
                  <option value="">Aucun devis</option>
                  {linkableQuotes.map(q => (
                    <option key={q.id} value={q.id}>
                      {q.number ? `${q.number} · ` : ''}{q.title ?? 'Sans titre'}{q.client_name ? ` (${q.client_name})` : ''}
                    </option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <button
                    onClick={() => setEditQuoteLink(false)}
                    className="btn-secondary text-xs py-1 px-2 flex-1"
                  >
                    Annuler
                  </button>
                  <button
                    onClick={handleSaveQuoteLink}
                    disabled={quoteLinkSaving}
                    className="btn-primary text-xs py-1 px-2 flex-1 flex items-center justify-center gap-1.5"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {quoteLinkSaving ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2 min-w-fit">
            {/* Dates */}
            {!editDates ? (
              <div className="flex items-center gap-2">
                <div className="text-sm text-secondary flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  <span>{fmtDate(startDate || null)}</span>
                  <ChevronRight className="w-3 h-3" />
                  <span>{fmtDate(estimatedEndDate || null)}</span>
                </div>
                {canEditChantier && (
                  <button
                    onClick={() => setEditDates(true)}
                    className="p-1 text-secondary hover:text-primary transition-colors flex-shrink-0"
                    title="Modifier les dates"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2 p-3 rounded-xl border border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] font-semibold text-secondary mb-0.5 block">Début</label>
                    <input type="date" className="input input-sm w-full" value={startDate} onChange={e => setStartDate(e.target.value)} autoFocus />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-secondary mb-0.5 block">Fin estimée</label>
                    <input type="date" className="input input-sm w-full" value={estimatedEndDate} onChange={e => setEstimatedEndDate(e.target.value)} />
                  </div>
                </div>
                {datesError && <p className="text-xs text-red-500">{datesError}</p>}
                <div className="flex gap-2">
                  <button onClick={() => setEditDates(false)} className="btn-secondary text-xs py-1 px-2 flex-1">Annuler</button>
                  <button onClick={handleSaveDates} disabled={datesSaving} className="btn-primary text-xs py-1 px-2 flex-1 flex items-center justify-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    {datesSaving ? 'Enregistrement...' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            )}
            {/* Budget */}
            <div className="text-sm text-secondary flex items-center gap-2">
              <Euro className="w-4 h-4" />
              <span className="font-semibold text-primary">{fmtMoney(chantier.budget_ht)} HT</span>
            </div>
            {/* Facturation périodique */}
            <div className="rounded-xl border border-[var(--elevation-border)] bg-[var(--elevation-1)] p-3 space-y-2">
              {!editBilling ? (
                <>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-secondary">Facturation périodique</p>
                      {billingPeriod !== 'none' && Number(billingAmount) > 0 ? (
                        <p className="text-sm text-primary">
                          <span className="font-semibold">{fmtMoney(Number(billingAmount))} HT</span>
                          <span className="text-secondary"> · {BILLING_PERIOD_OPTIONS.find(o => o.value === billingPeriod)?.label.toLowerCase()}</span>
                        </p>
                      ) : (
                        <p className="text-sm text-secondary">Non configurée</p>
                      )}
                      {billingPeriod !== 'none' && Number(billingAmount) > 0 && (
                        <>
                          {billingLabel && <p className="text-xs text-secondary truncate">Libellé : {billingLabel}</p>}
                          <p className="text-xs text-secondary">
                            Prochaine facture : {fmtDate(selectedBillingDate)}
                          </p>
                        </>
                      )}
                    </div>
                    {canEditChantier && (
                      <button
                        onClick={() => { setEditBilling(true); setBillingError(null) }}
                        className="p-1 text-secondary hover:text-primary transition-colors flex-shrink-0"
                        title="Modifier la facturation périodique"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                  {billingError && <p className="text-xs text-red-500">{billingError}</p>}
                  {canCreateInvoice && billingPeriod !== 'none' && Number(billingAmount) > 0 && (
                    <button
                      onClick={handleGeneratePeriodInvoice}
                      disabled={billingGenerating}
                      className="btn-primary text-xs py-1.5 px-3 flex items-center justify-center gap-1.5 w-full disabled:opacity-50"
                    >
                      {billingGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Euro className="w-3.5 h-3.5" />}
                      {billingGenerating ? 'Génération...' : 'Générer facture de période'}
                    </button>
                  )}
                </>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-secondary mb-0.5 block">Montant HT</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="input input-sm w-full"
                        value={billingAmount}
                        onChange={e => setBillingAmount(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold text-secondary mb-0.5 block">Fréquence</label>
                      <select
                        className="input input-sm w-full"
                        value={billingPeriod}
                        onChange={e => setBillingPeriod(e.target.value as typeof billingPeriod)}
                      >
                        {BILLING_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-secondary mb-0.5 block">Libellé de ligne</label>
                    <input
                      className="input input-sm w-full"
                      value={billingLabel}
                      onChange={e => setBillingLabel(e.target.value)}
                      placeholder="Maintenance mensuelle"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-semibold text-secondary mb-0.5 block">Prochaine facture</label>
                    <div className="grid grid-cols-[0.8fr_1.2fr_1fr] gap-2">
                      <select className="input input-sm w-full" value={billingDay} onChange={e => setBillingDay(e.target.value)}>
                        {Array.from({ length: 31 }, (_, i) => i + 1).map(day => (
                          <option key={day} value={day}>{day}</option>
                        ))}
                      </select>
                      <select className="input input-sm w-full" value={billingMonth} onChange={e => setBillingMonth(e.target.value)}>
                        {MONTH_NAMES.map((name, idx) => (
                          <option key={name} value={idx + 1}>{name}</option>
                        ))}
                      </select>
                      <select className="input input-sm w-full" value={billingYear} onChange={e => setBillingYear(e.target.value)}>
                        {billingYears.map(year => <option key={year} value={year}>{year}</option>)}
                      </select>
                    </div>
                  </div>
                  {billingError && <p className="text-xs text-red-500">{billingError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setEditBilling(false)} className="btn-secondary text-xs py-1 px-2 flex-1">Annuler</button>
                    <button onClick={handleSaveBilling} disabled={billingSaving} className="btn-primary text-xs py-1 px-2 flex-1 flex items-center justify-center gap-1.5">
                      {billingSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Enregistrer
                    </button>
                  </div>
                </div>
              )}
            </div>
            {/* Retenue de garantie par défaut */}
            <div className="rounded-xl border border-[var(--elevation-border)] bg-[var(--elevation-1)] p-3 space-y-2">
              {!editRetention ? (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-secondary">Retenue de garantie par défaut</p>
                    {(chantier.default_retention_pct ?? 0) > 0 ? (
                      <p className="text-sm text-primary font-semibold">{retentionPct} %</p>
                    ) : (
                      <p className="text-sm text-secondary">Non configurée</p>
                    )}
                    {(chantier.default_retention_pct ?? 0) > 0 && (
                      <p className="text-xs text-secondary">Pré-remplie automatiquement sur les nouvelles factures</p>
                    )}
                  </div>
                  {canEditChantier && (
                    <button
                      onClick={() => { setEditRetention(true); setRetentionError(null) }}
                      className="p-1 text-secondary hover:text-primary transition-colors flex-shrink-0"
                      title="Modifier la retenue de garantie"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-[10px] font-semibold text-secondary block">Taux de retenue (%)</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.5"
                    className="input input-sm w-full"
                    value={retentionPct}
                    onChange={e => setRetentionPct(e.target.value)}
                    autoFocus
                    placeholder="Ex : 5"
                  />
                  {retentionError && <p className="text-xs text-red-500">{retentionError}</p>}
                  <div className="flex gap-2">
                    <button onClick={() => setEditRetention(false)} className="btn-secondary text-xs py-1 px-2 flex-1">Annuler</button>
                    <button onClick={handleSaveRetention} disabled={retentionSaving} className="btn-primary text-xs py-1 px-2 flex-1 flex items-center justify-center gap-1.5">
                      {retentionSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      Enregistrer
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Progression */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs text-secondary">
                <span>{tachesDone}/{tachesCount} tâches</span>
                <span className="font-semibold text-accent">{donePct}%</span>
              </div>
              <div className="h-1.5 bg-secondary/20 rounded-full w-48 border border-[var(--elevation-border)]">
                <div className="h-full bg-accent rounded-full transition-all" style={{ width: `${donePct}%` }} />
              </div>
            </div>
            {/* Actions */}
            <div className="flex gap-2 flex-wrap mt-1">
              {canEditChantier && (
                <Link
                  href={`/finances/invoice-editor?chantier=${chantier.id}&returnTo=${encodeURIComponent(`/chantiers/${chantier.id}`)}`}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                >
                  <Euro className="w-3.5 h-3.5" /> Créer une facture
                </Link>
              )}
              <button
                onClick={() => setShowPdfPanel(v => !v)}
                className={`btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 ${showPdfPanel ? 'ring-2 ring-accent/40' : ''}`}
              >
                <Download className="w-3.5 h-3.5" /> Rapport PDF
              </button>
              {canEditChantier && (
                <button
                  onClick={() => setShowAIAssistant(true)}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                >
                  <AssistantAvatar assistant="marco" size={16} className="border-none bg-transparent shadow-none !rounded-full" /> Assistant IA
                </button>
              )}
            </div>

            {/* Panneau PDF période */}
            {showPdfPanel && (() => {
              const pdfParams = new URLSearchParams()
              if (pdfFrom) pdfParams.set('from', pdfFrom)
              if (pdfTo)   pdfParams.set('to', pdfTo)
              const pdfQuery = pdfParams.toString() ? `?${pdfParams.toString()}` : ''
              const dlQuery  = pdfParams.toString() ? `?download=1&${pdfParams.toString()}` : '?download=1'
              return (
                <div className="mt-3 p-3 rounded-xl border border-[var(--elevation-border)] bg-[var(--elevation-1)] space-y-2">
                  <p className="text-xs font-semibold text-secondary">Période du rapport <span className="font-normal">(optionnel, laissez vide pour tout)</span></p>
                  <div className="flex items-center gap-2">
                    <div className="flex flex-col flex-1">
                      <label className="text-[10px] text-secondary mb-0.5">Du</label>
                      <input type="date" className="input text-xs w-full" value={pdfFrom} onChange={e => setPdfFrom(e.target.value)} />
                    </div>
                    <span className="text-secondary text-xs mt-4">→</span>
                    <div className="flex flex-col flex-1">
                      <label className="text-[10px] text-secondary mb-0.5">Au</label>
                      <input type="date" className="input text-xs w-full" value={pdfTo} onChange={e => setPdfTo(e.target.value)} />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <a
                      href={`/api/pdf/chantier/${chantier.id}${dlQuery}`}
                      className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 flex-1 justify-center"
                      onClick={() => setShowPdfPanel(false)}
                    >
                      <Download className="w-3.5 h-3.5" /> Télécharger
                    </a>
                    <a
                      href={`/api/pdf/chantier/${chantier.id}${pdfQuery}`}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-secondary text-xs py-1.5 px-3 flex-1 text-center"
                      onClick={() => setShowPdfPanel(false)}
                    >
                      Aperçu
                    </a>
                  </div>
                  {/* Envoi email */}
                  <div className="pt-1 border-t border-[var(--elevation-border)]">
                    {emailStatus === 'done' ? (
                      <p className="text-xs text-green-600 flex items-center gap-1.5">
                        <Check className="w-3.5 h-3.5" /> Rapport envoyé à {emailRecipient}
                      </p>
                    ) : emailStatus === 'error' ? (
                      <p className="text-xs text-red-500">{emailError}</p>
                    ) : null}
                    <button
                      onClick={() => handleSendReportEmail()}
                      disabled={emailStatus === 'sending'}
                      className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 w-full justify-center mt-1 disabled:opacity-50"
                    >
                      {emailStatus === 'sending'
                        ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Envoi en cours…</>
                        : <><Send className="w-3.5 h-3.5" /> Envoyer par email</>}
                    </button>
                  </div>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Stats rapides */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-5 pt-5 border-t border-[var(--elevation-border)]">
          <div>
            <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Tâches</p>
            <p className="text-xl font-bold text-primary mt-0.5">{tachesCount}</p>
          </div>
          <div>
            <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Terminées</p>
            <p className="text-xl font-bold text-green-500 mt-0.5">{tachesDone}</p>
          </div>
          <div>
            <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Heures pointées</p>
            <p className="text-xl font-bold text-primary mt-0.5">{fmtHours(totalHours)}</p>
          </div>
          <div>
            <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Photos</p>
            <p className="text-xl font-bold text-primary mt-0.5">{chantier.photos_count}</p>
          </div>
        </div>
      </div>

      {/* ── Section situations de travaux ── */}
      {situationsSummary && chantier.quote_id && (
        <div className="card p-5 space-y-4">
          <h3 className="text-sm font-bold text-primary uppercase tracking-wider flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-accent" /> Situations de travaux
          </h3>
          <SituationsSection
            chantierId={chantier.id}
            summary={situationsSummary}
            canCreateSituation={canCreateSituation}
            canCreateSolde={canCreateSolde}
            returnTo={`/chantiers/${chantier.id}`}
            defaultRetentionPct={chantier.default_retention_pct ?? 0}
          />
        </div>
      )}

      {/* Tabs - onglets scrollables sur tous les écrans */}
      <div>
        <div className="flex gap-0.5 border-b border-[var(--elevation-border)] overflow-x-auto scrollbar-none">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-3 sm:px-4 py-2.5 text-sm font-semibold transition-colors flex items-center gap-1.5 border-b-2 -mb-px whitespace-nowrap flex-shrink-0 ${
                tab === t.id
                  ? 'border-accent text-primary'
                  : 'border-transparent text-secondary hover:text-primary'
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${tab === t.id ? 'bg-accent/20 text-accent' : 'bg-secondary/10 text-secondary'}`}>
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab: Tâches ── */}
      {tab === 'taches' && (
        <div className="space-y-4">
          {/* Add form */}
          {canEditChantier && (
            <form onSubmit={handleAddTache} className="card p-4 space-y-3">
              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  className="input flex-1"
                  placeholder="Ajouter une tâche..."
                  value={newTacheTitle}
                  onChange={e => setNewTacheTitle(e.target.value)}
                  required
                />
                <input
                  type="date"
                  className="input sm:w-40"
                  value={newTacheDue}
                  onChange={e => setNewTacheDue(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowNewTacheAssignments(v => !v)}
                  className={`btn-secondary flex items-center justify-center gap-2 whitespace-nowrap ${showNewTacheAssignments ? 'border-accent/40 text-accent' : ''}`}
                >
                  <Users className="w-4 h-4" />
                  Assigner
                </button>
                <button type="submit" disabled={tacheLoading} className="btn-primary flex items-center justify-center gap-2 whitespace-nowrap">
                  <Plus className="w-4 h-4" /> Ajouter
                </button>
              </div>

              {showNewTacheAssignments && (
                <div className="grid md:grid-cols-2 gap-4 pt-3 border-t border-[var(--elevation-border)]">
                  <div>
                    <p className="text-[11px] font-bold text-secondary uppercase tracking-wider mb-2">Équipes</p>
                    <div className="flex flex-wrap gap-2">
                      {allEquipes.length === 0 ? (
                        <p className="text-xs text-secondary">Aucune équipe créée.</p>
                      ) : allEquipes.map(equipe => (
                        <label key={equipe.id} className="px-3 py-1.5 rounded-lg border border-[var(--elevation-border)] bg-[var(--elevation-1)] text-sm text-primary flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={newTacheEquipeIds.has(equipe.id)}
                            onChange={() => setNewTacheEquipeIds(prev => {
                              const next = new Set(prev)
                              if (next.has(equipe.id)) next.delete(equipe.id)
                              else next.add(equipe.id)
                              return next
                            })}
                          />
                          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: equipe.color }} />
                          {equipe.name}
                        </label>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[11px] font-bold text-secondary uppercase tracking-wider mb-2">Membres</p>
                    <div className="flex flex-wrap gap-2">
                      {allAssignableMembers.length === 0 ? (
                        <p className="text-xs text-secondary">Aucun membre créé.</p>
                      ) : allAssignableMembers.map(member => {
                        const label = [member.prenom, member.name].filter(Boolean).join(' ') || member.email || 'Membre'
                        return (
                          <label key={member.id} className="px-3 py-1.5 rounded-lg border border-[var(--elevation-border)] bg-[var(--elevation-1)] text-sm text-primary flex items-center gap-2 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={newTacheMemberIds.has(member.id)}
                              onChange={() => setNewTacheMemberIds(prev => {
                                const next = new Set(prev)
                                if (next.has(member.id)) next.delete(member.id)
                                else next.add(member.id)
                                return next
                              })}
                            />
                            <User className="w-3.5 h-3.5 text-secondary" />
                            {label}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </form>
          )}

          {/* Actions rapides: IA + Bibliothèque */}
          {canEditChantier && (suggestTasksLoading ? (
            <div className="flex items-center gap-2 text-sm text-violet-500 dark:text-violet-400 px-1">
              <Loader2 className="w-4 h-4 animate-spin" />
              Génération en cours...
            </div>
          ) : !showTaskSuggestions && (
            <div className="flex flex-wrap items-center gap-3">
              {linkedQuoteId && (
                <button
                  onClick={handleSuggestTasks}
                  className="flex items-center gap-2 text-sm font-semibold text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 px-4 py-2 rounded-xl border border-violet-400/30 bg-violet-500/5 hover:bg-violet-500/10 transition-all"
                >
                  <Sparkles className="w-4 h-4" />
                  Importer depuis le devis
                </button>
              )}
              {taskLibraryTitles.length > 0 && (
                <button
                  onClick={() => setShowTaskLibrary(v => !v)}
                  className={`flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl border transition-all ${showTaskLibrary ? 'bg-accent/10 border-accent/40 text-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary bg-[var(--elevation-1)]'}`}
                >
                  <FileText className="w-4 h-4" />
                  Bibliothèque ({taskLibraryTitles.length})
                </button>
              )}
              {suggestTasksCreditsError && <AICreditsErrorModal onClose={() => setSuggestTasksCreditsError(false)} />}
              {suggestTasksError && <p className="text-sm text-red-500">{suggestTasksError}</p>}
            </div>
          ))}

          {/* Bibliothèque de tâches réutilisables */}
          {canEditChantier && showTaskLibrary && !showTaskSuggestions && (
            <div className="card p-4 space-y-3 border-accent/20">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-primary flex items-center gap-2">
                  <FileText className="w-4 h-4 text-accent" />
                  Tâches utilisées dans vos autres chantiers
                </p>
                <button onClick={() => { setShowTaskLibrary(false); setTaskLibraryFilter('') }} className="text-secondary hover:text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <input
                className="input w-full text-sm"
                placeholder="Filtrer..."
                value={taskLibraryFilter}
                onChange={e => setTaskLibraryFilter(e.target.value)}
              />
              <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                {taskLibraryTitles
                  .filter(t => !taskLibraryFilter || t.toLowerCase().includes(taskLibraryFilter.toLowerCase()))
                  .map(title => (
                    <button
                      key={title}
                      onClick={() => { setNewTacheTitle(title); setShowTaskLibrary(false); setTaskLibraryFilter('') }}
                      className="px-3 py-1.5 rounded-lg border border-[var(--elevation-border)] bg-[var(--elevation-1)] text-sm text-primary hover:border-accent/40 hover:bg-accent/5 transition-all text-left"
                    >
                      {title}
                    </button>
                  ))}
              </div>
              <p className="text-xs text-secondary">Cliquez sur une tâche pour pré-remplir le champ de saisie.</p>
            </div>
          )}

          {canEditChantier && showTaskSuggestions && taskSuggestions.length > 0 && (
            <div className="card p-4 space-y-3 border-violet-400/30 dark:border-violet-500/30 bg-violet-500/5 dark:bg-violet-500/10">
              <div className="flex items-center justify-between">
                <p className="text-sm font-bold text-primary flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-violet-500" />
                  Suggestions IA : {taskSuggestions.length} tâche{taskSuggestions.length > 1 ? 's' : ''}
                </p>
                <button onClick={() => { setTaskSuggestions([]); setShowTaskSuggestions(false) }} className="p-1 text-secondary hover:text-primary">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="space-y-2">
                {taskSuggestions.map(sugg => (
                  <div key={sugg._id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--elevation-border)] bg-[var(--elevation-1)] dark:bg-[var(--elevation-2)] hover:border-violet-400/30 transition-colors">
                    {sugg.editing ? (
                      <input
                        autoFocus
                        value={sugg.title}
                        onChange={e => setTaskSuggestions(prev => prev.map(s => s._id === sugg._id ? { ...s, title: e.target.value } : s))}
                        onBlur={() => setTaskSuggestions(prev => prev.map(s => s._id === sugg._id ? { ...s, editing: false } : s))}
                        onKeyDown={e => { if (e.key === 'Enter') setTaskSuggestions(prev => prev.map(s => s._id === sugg._id ? { ...s, editing: false } : s)) }}
                        className="input flex-1 py-1 text-sm"
                      />
                    ) : (
                      <span className="flex-1 text-sm text-primary">{sugg.title}</span>
                    )}
                    <div className="flex items-center gap-1 rounded-lg border border-[var(--elevation-border)] bg-[var(--elevation-1)] dark:bg-[var(--elevation-2)] p-0.5">
                      <button
                        onClick={() => setTaskSuggestions(prev => prev.map(s => s._id === sugg._id ? { ...s, editing: !s.editing } : s))}
                        className="p-1.5 text-secondary hover:text-primary rounded-md hover:bg-[var(--elevation-2)] dark:hover:bg-[var(--elevation-3)] transition-colors"
                        title="Modifier"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <div className="w-px h-4 bg-[var(--elevation-border)]" />
                      <button
                        onClick={() => handleValidateSuggestion(sugg._id)}
                        disabled={validatingSuggId === sugg._id || validateAllLoading}
                        className="p-1.5 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 rounded-md transition-colors disabled:opacity-50"
                        title="Valider"
                      >
                        {validatingSuggId === sugg._id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                      </button>
                      <div className="w-px h-4 bg-[var(--elevation-border)]" />
                      <button
                        onClick={() => setTaskSuggestions(prev => prev.filter(s => s._id !== sugg._id))}
                        className="p-1.5 text-secondary hover:text-red-500 dark:hover:text-red-400 hover:bg-red-500/10 rounded-md transition-colors"
                        title="Supprimer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 pt-1 border-t border-violet-400/20 dark:border-violet-500/20">
                <button onClick={handleValidateAllSuggestions} disabled={validateAllLoading} className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm disabled:opacity-60">
                  {validateAllLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {validateAllLoading ? 'Création en cours...' : 'Valider toutes'}
                </button>
                <button onClick={() => { setTaskSuggestions([]); setShowTaskSuggestions(false) }} className="btn-secondary flex-1 text-sm">
                  Tout ignorer
                </button>
              </div>
            </div>
          )}

          {/* DnD List */}
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={taches.map(t => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {taches.length === 0 && (
                  <div className="card p-8 text-center text-secondary">
                    <p className="font-semibold">Aucune tâche pour l'instant</p>
                    <p className="text-sm mt-1">Ajoutez des tâches ci-dessus</p>
                  </div>
                )}
                {taches.map(t => (
                  <SortableTache
                    key={t.id}
                    tache={t}
                    onStatusToggle={handleStatusToggle}
                    onDelete={handleDeleteTache}
                    onSaveNote={handleSaveTacheNote}
                    onSaveAssignments={handleSaveTacheAssignments}
                    onRenameTitle={handleRenameTache}
                    equipes={allEquipes}
                    members={allAssignableMembers}
                    canEdit={canEditChantier}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      )}

      {/* ── Tab: Planning ── */}
      {tab === 'planning' && (
        <WeeklyPlanningView
          pointages={pointages}
          plannings={plannings}
          chantier={chantier}
          equipes={allEquipes}
          individualMembers={initialIndividualMembers}
          onAddPlanning={handleAddPlanning}
          onDeletePlanning={handleDeletePlanning}
        />
      )}

      {/* ── Tab: Pointages ── */}
      {tab === 'pointages' && (
        <div className="space-y-4">
          {/* Total */}
          <div className="card p-4 flex items-center gap-4">
            <Clock className="w-8 h-8 text-accent" />
            <div>
              <p className="text-xs text-secondary font-semibold uppercase tracking-wider">Total heures pointées</p>
              <p className="text-3xl font-extrabold text-primary">{fmtHours(totalHours)}</p>
            </div>
          </div>

          {/* Add form */}
          {(canPointage || canManagePointages) && (
          <form onSubmit={handleAddPointage} className="card p-4 space-y-3">
            <p className="text-sm font-semibold text-primary">Ajouter un pointage</p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setPtMode('me')}
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  ptMode === 'me'
                    ? 'border-accent bg-accent/10 text-primary'
                    : 'border-[var(--elevation-border)] text-secondary hover:text-primary'
                }`}
              >
                <User className="h-3.5 w-3.5" />
                Moi
              </button>
              {canManagePointages && initialChantierEquipes.length > 0 && (
                <button
                  type="button"
                  onClick={() => setPtMode('team')}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                    ptMode === 'team'
                      ? 'border-accent bg-accent/10 text-primary'
                      : 'border-[var(--elevation-border)] text-secondary hover:text-primary'
                  }`}
                >
                  <Users className="h-3.5 w-3.5" />
                  Équipe
                </button>
              )}
            </div>

            {ptMode === 'team' && (
              <div className="rounded-xl border border-[var(--elevation-border)] bg-base/40 p-3 space-y-3 dark:bg-white/[0.03]">
                <div>
                  <label className="text-xs text-secondary font-semibold mb-1 block">Équipe concernée</label>
                  <select
                    className="input w-full max-w-sm"
                    value={ptEquipeId}
                    onChange={e => {
                      const equipeId = e.target.value
                      const equipe = initialChantierEquipes.find(eq => eq.id === equipeId)
                      setPtEquipeId(equipeId)
                      setPtPresentMemberIds(new Set(equipe?.membres.map(m => m.id) ?? []))
                    }}
                  >
                    {initialChantierEquipes.map(eq => (
                      <option key={eq.id} value={eq.id}>
                        {eq.name} ({eq.membres.length} pers.)
                      </option>
                    ))}
                  </select>
                </div>

                {selectedPointageEquipe && (
                  <div>
                    <p className="text-xs text-secondary font-semibold mb-2">Présents à pointer</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedPointageEquipe.membres.map(member => {
                        const checked = ptPresentMemberIds.has(member.id)
                        const fullName = [member.prenom, member.name].filter(Boolean).join(' ') || member.name
                        return (
                          <label
                            key={member.id}
                            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-xs transition-colors ${
                              checked
                                ? 'border-accent bg-accent/10 text-primary'
                                : 'border-[var(--elevation-border)] text-secondary hover:text-primary'
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="sr-only"
                              checked={checked}
                              onChange={() => {
                                setPtPresentMemberIds(prev => {
                                  const next = new Set(prev)
                                  if (next.has(member.id)) next.delete(member.id)
                                  else next.add(member.id)
                                  return next
                                })
                              }}
                            />
                            {fullName}
                            {canEditRates && member.taux_horaire != null && (
                              <span className="text-secondary/70">· {member.taux_horaire} €/h</span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                    <p className="mt-2 text-xs text-secondary">
                      Un pointage sera créé pour chaque personne cochée. La rentabilité chantier utilisera ensuite son taux horaire.
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Ligne 1 : Date · Heure début · Durée */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <div>
                <label className="text-xs text-secondary font-semibold mb-1 block">Date</label>
                <input type="date" className="input w-full" value={ptDate} onChange={e => setPtDate(e.target.value)} required />
              </div>
              <div>
                <label className="text-xs text-secondary font-semibold mb-1 block">Heure de début</label>
                <input type="time" className="input w-full" value={ptStartTime} onChange={e => setPtStartTime(e.target.value)} />
              </div>
              <div className="col-span-2 md:col-span-1">
                <label className="text-xs text-secondary font-semibold mb-1 block">Durée</label>
                <div className="flex items-center gap-2">
                  <input type="number" min="0" max="23" placeholder="7" className="input flex-1 min-w-0 text-center" value={ptHoursInt} onChange={e => setPtHoursInt(e.target.value)} required />
                  <span className="text-sm font-bold text-secondary flex-shrink-0">h</span>
                  <input type="number" min="0" max="59" step="5" placeholder="30" className="input flex-1 min-w-0 text-center" value={ptMinutes} onChange={e => setPtMinutes(e.target.value)} />
                  <span className="text-sm font-bold text-secondary flex-shrink-0">min</span>
                </div>
              </div>
            </div>
            {/* Ligne 2 : Tâche · Description */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-secondary font-semibold mb-1 block">Tâche (optionnel)</label>
                <select className="input w-full" value={ptTacheId} onChange={e => setPtTacheId(e.target.value)}>
                  <option value="">Aucune</option>
                  {taches.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs text-secondary font-semibold mb-1 block">Description</label>
                <input className="input w-full" placeholder="Optionnel..." value={ptDesc} onChange={e => setPtDesc(e.target.value)} />
              </div>
            </div>
            <button type="submit" disabled={ptLoading || (ptMode === 'team' && ptPresentMemberIds.size === 0)} className="btn-primary flex items-center gap-2 min-w-[8.5rem] justify-center">
              {ptLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              {ptLoading ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </form>
          )}

          {/* Accordéon pointages par membre */}
          {(() => {
            if (pointages.length === 0) {
              return (
                <div className="card p-8 text-center text-secondary text-sm">Aucun pointage</div>
              )
            }
            type MemberGroup = { key: string; name: string; total: number; entries: Pointage[] }
            const memberMap = new Map<string, MemberGroup>()
            for (const p of pointages) {
              const key = p.user_id ?? `m_${p.member_id}`
              const g = memberMap.get(key)
              if (g) { g.total += p.hours; g.entries.push(p) }
              else memberMap.set(key, { key, name: p.user_name, total: p.hours, entries: [p] })
            }
            const groups = [...memberMap.values()].sort((a, b) => b.total - a.total)
            return (
              <PointageAccordion
                groups={groups}
                canManage={canManagePointages}
                onDelete={handleDeletePointage}
              />
            )
          })()}

          {/* Rapports PDF par membre */}
          {canManagePointages && pointages.length > 0 && (
            <MemberHoursReports pointages={pointages} individualMembers={initialIndividualMembers} />
          )}
        </div>
      )}

      {/* ── Tab: Photos ── */}
      {tab === 'photos' && (
        <div className="space-y-4">
          {/* Barre d'actions */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <p className="text-sm text-secondary">{photos.length} photo{photos.length > 1 ? 's' : ''}</p>
              {selectedPhotoIds.size > 0 && (
                <span className="text-xs bg-accent/20 text-accent font-semibold px-2 py-0.5 rounded-full">
                  {selectedPhotoIds.size} sélectionnée{selectedPhotoIds.size > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <div className="flex gap-2 flex-wrap">
              {selectedPhotoIds.size > 0 && (
                <>
                  <button
                    onClick={() => { setShowSendPhotosPanel(true); setPhotosEmailStatus('idle') }}
                    className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                  >
                    <Send className="w-3.5 h-3.5" /> Envoyer au client ({selectedPhotoIds.size})
                  </button>
                  <button
                    onClick={() => setSelectedPhotoIds(new Set())}
                    className="btn-secondary text-xs py-1.5 px-3"
                  >
                    Désélectionner tout
                  </button>
                </>
              )}
              <label className="btn-primary flex items-center gap-2 cursor-pointer text-sm">
                <Camera className="w-4 h-4" />
                {photoLoading ? 'Upload...' : 'Ajouter'}
                <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
              </label>
            </div>
          </div>

          {/* Panel envoi email */}
          {showSendPhotosPanel && (
            <div className="card p-4 border border-accent/30 space-y-3">
              <p className="text-sm font-semibold text-primary flex items-center gap-2">
                <Send className="w-4 h-4" /> Envoyer {selectedPhotoIds.size} photo{selectedPhotoIds.size > 1 ? 's' : ''} au client
              </p>
              <textarea
                className="input w-full text-sm resize-none"
                rows={3}
                placeholder="Message d'accompagnement (facultatif)..."
                value={photosEmailMsg}
                onChange={e => setPhotosEmailMsg(e.target.value)}
              />
              {photosEmailStatus === 'done' && (
                <p className="text-xs text-green-600 flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5" /> Photos envoyées à {photosEmailRecipient}
                </p>
              )}
              {photosEmailStatus === 'error' && (
                <p className="text-xs text-red-500">{photosEmailError}</p>
              )}
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowSendPhotosPanel(false)} className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5" /> Annuler
                </button>
                <button
                  disabled={photosEmailStatus === 'sending'}
                  onClick={() => handleSendPhotosEmail()}
                  className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 disabled:opacity-50"
                >
                  {photosEmailStatus === 'sending'
                    ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Envoi…</>
                    : <><Send className="w-3.5 h-3.5" /> Envoyer</>}
                </button>
              </div>
            </div>
          )}

          {photos.length === 0 && (
            <div className="card p-12 text-center">
              <Camera className="w-12 h-12 text-secondary opacity-40 mx-auto mb-3" />
              <p className="text-secondary font-semibold">Aucune photo pour l'instant</p>
              <p className="text-secondary text-sm mt-1">Documentez l'avancement du chantier</p>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {photos.map(photo => {
              const displayUrl = photo.url ?? ''
              const isSelected = selectedPhotoIds.has(photo.id)
              return (
                <div
                  key={photo.id}
                  className={`group card overflow-hidden cursor-pointer hover:shadow-md transition-shadow relative ${isSelected ? 'ring-2 ring-accent' : ''}`}
                  onClick={() => { setLightboxPhoto(photo); setLightboxTitle(photo.title ?? ''); setLightboxCaption(photo.caption ?? '') }}
                >
                  {/* Checkbox sélection */}
                  <div
                    className="absolute top-2 left-2 z-10"
                    onClick={e => {
                      e.stopPropagation()
                      setSelectedPhotoIds(prev => {
                        const next = new Set(prev)
                        next.has(photo.id) ? next.delete(photo.id) : next.add(photo.id)
                        return next
                      })
                    }}
                  >
                    <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-accent border-accent' : 'bg-black/50 border-white/70'}`}>
                      {isSelected && <Check className="w-3 h-3 text-black" />}
                    </div>
                  </div>

                  {/* Badge rapport */}
                  {photo.include_in_report && (
                    <div className="absolute top-2 right-2 z-10 bg-accent/90 text-black text-[9px] font-bold px-1.5 py-0.5 rounded">
                      RAPPORT
                    </div>
                  )}

                  {/* Image */}
                  <div className="aspect-square overflow-hidden relative">
                    <img src={displayUrl} alt={photo.caption ?? ''} className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                    <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  {/* Caption + author */}
                  <div className="px-2 py-1.5">
                    {photo.caption
                      ? <p className="text-xs font-medium text-primary line-clamp-2 leading-snug">{photo.caption}</p>
                      : <p className="text-xs text-secondary/50 italic">Aucune description</p>
                    }
                    <div className="flex items-center justify-between mt-0.5">
                      <p className="text-[10px] text-secondary">{photo.uploaded_by_name}</p>
                      {photo.shared_with_client_at && (
                        <p className="text-[9px] text-green-500">✓ Envoyé</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Lightbox */}
          {lightboxPhoto && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm p-4"
              onClick={(e) => { if (e.target === e.currentTarget) setLightboxPhoto(null) }}
            >
              <div className="relative w-full max-w-4xl flex flex-col bg-[#1a1a1a] rounded-2xl overflow-hidden shadow-2xl border border-white/10 max-h-[90vh]">
                {/* Close */}
                <button
                  onClick={() => setLightboxPhoto(null)}
                  className="absolute top-3 right-3 z-10 w-9 h-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>

                {/* Image */}
                <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden" style={{ maxHeight: '65vh' }}>
                  <img
                    src={lightboxPhoto.url ?? ''}
                    alt={lightboxPhoto.caption ?? ''}
                    className="max-w-full max-h-full object-contain"
                  />
                </div>

                {/* Footer: meta + description + rapport flag */}
                <div className="p-4 space-y-3 border-t border-white/10">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-zinc-400">
                      Par {lightboxPhoto.uploaded_by_name}
                      {lightboxPhoto.taken_at && ` · ${new Date(lightboxPhoto.taken_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`}
                    </p>
                    {/* Checkbox inclure dans le rapport */}
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={lightboxPhoto.include_in_report}
                        onChange={async (e) => {
                          const val = e.target.checked
                          await togglePhotoReportFlag(lightboxPhoto.id, chantier.id, val)
                          setPhotos(prev => prev.map(p => p.id === lightboxPhoto.id ? { ...p, include_in_report: val } : p))
                          setLightboxPhoto(prev => prev ? { ...prev, include_in_report: val } : null)
                        }}
                        className="rounded accent-accent"
                      />
                      <span className="text-xs text-zinc-300">Inclure dans le rapport PDF</span>
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={lightboxTitle}
                      onChange={e => setLightboxTitle(e.target.value)}
                      placeholder="Titre (affiché dans le rapport PDF)..."
                      className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/40"
                    />
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={lightboxCaption}
                      onChange={e => setLightboxCaption(e.target.value)}
                      placeholder="Description..."
                      className="flex-1 bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-white/40"
                    />
                    <button
                      onClick={async () => {
                        setLightboxSaving(true)
                        await Promise.all([
                          updateChantierPhotoTitle(lightboxPhoto.id, chantier.id, lightboxTitle || null),
                          updateChantierPhotoCaption(lightboxPhoto.id, chantier.id, lightboxCaption || null),
                        ])
                        setPhotos(prev => prev.map(p => p.id === lightboxPhoto.id ? { ...p, title: lightboxTitle || null, caption: lightboxCaption || null } : p))
                        setLightboxPhoto(prev => prev ? { ...prev, title: lightboxTitle || null, caption: lightboxCaption || null } : null)
                        setLightboxSaving(false)
                      }}
                      disabled={lightboxSaving}
                      className="bg-accent hover:bg-accent/90 text-black font-semibold text-sm px-4 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                    >
                      {lightboxSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                      Sauvegarder
                    </button>
                    <button
                      onClick={async () => {
                        if (!confirm('Supprimer cette photo ?')) return
                        await handleDeletePhoto(lightboxPhoto)
                        setLightboxPhoto(null)
                      }}
                      className="w-10 h-10 rounded-xl border border-red-500/40 text-red-400 flex items-center justify-center hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Notes ── */}
      {tab === 'notes' && (
        <div className="space-y-4">
          {/* Add form */}
          <form onSubmit={handleAddNote} className="card p-4 space-y-3">
            <p className="text-sm font-semibold text-primary flex items-center gap-2">
              <FileText className="w-4 h-4" /> Nouvelle entrée de journal
            </p>
            <textarea
              className="input w-full h-24 resize-none"
              placeholder="Observations du jour, problèmes rencontrés, décisions prises..."
              value={noteContent}
              onChange={e => setNoteContent(e.target.value)}
              required
            />
            <button type="submit" disabled={noteLoading} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> {noteLoading ? 'Enregistrement...' : 'Ajouter'}
            </button>
          </form>

          {/* Liste notes */}
          <div className="space-y-3">
            {notes.length === 0 && (
              <div className="card p-8 text-center text-secondary">
                <p className="font-semibold">Aucune note</p>
                <p className="text-sm mt-1">Commencez le journal de chantier</p>
              </div>
            )}
            {notes.map(note => (
              <div key={note.id} className="card p-4 flex gap-4">
                <div className="w-2 bg-accent/30 rounded-full flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold text-secondary">
                      {note.author_name} · {new Date(note.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <button onClick={() => handleDeleteNote(note)} className="text-secondary hover:text-red-500 transition-colors flex-shrink-0">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-sm text-primary whitespace-pre-wrap">{note.content}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Tab: Jalons ── */}
      {tab === 'jalons' && (
        <JalonsTab
          initialJalons={initialJalons}
          chantierId={chantier.id}
          budgetHt={chantier.budget_ht ?? 0}
          taches={taches}
        />
      )}

      {/* ── Tab: Rentabilité ── */}
      {tab === 'rentabilite' && (
        <RentabiliteTab
          chantierId={chantier.id}
          initialProfitability={initialProfitability}
          orgMembers={orgMembers}
          orgSector={orgSector}
          materials={materials}
          invoiceStubs={invoiceStubs}
          targetMarginPct={chantier.target_margin_pct ?? 30}
          permissions={{
            canCreateExpenses,
            canEditExpenses,
            canDeleteExpenses,
            canEditRates,
            canEditChantier,
          }}
          deletedPointages={deletedPointages}
        />
      )}

      {/* ── Tab: Équipes ── */}
      {tab === 'equipes' && (
        <div className="space-y-8">
          <EquipesTab
            chantierId={chantier.id}
            allEquipes={allEquipes}
            chantierEquipes={initialChantierEquipes}
            linkedQuoteId={linkedQuoteId}
            orgMembers={orgMembers}
            orgRoles={orgRoles}
            canEditRates={canEditRates}
            currentUserId={currentUserId}
          />
          <IndividualMembersSection
            chantierId={chantier.id}
            initialMembers={initialIndividualMembers}
            orgMembers={orgMembers}
            orgPhantomMembers={orgPhantomMembers}
            orgRoles={orgRoles}
            canEditRates={canEditRates}
            currentUserId={currentUserId}
          />
        </div>
      )}

      {/* ── Tab: Réception ── */}
      {tab === 'reception' && (
        <ReceptionTab
          chantier={chantier}
          reserves={initialReserves}
          canEdit={canEditChantier}
        />
      )}

      {/* ── Assistant IA chantier ── */}
      {showAIAssistant && (
        <ChantierAIAssistant
          chantierId={chantier.id}
          chantierTitle={chantier.title}
          onClose={() => setShowAIAssistant(false)}
          onPlanningCreated={() => { setTab('planning'); router.refresh() }}
        />
      )}
      <ClientEmailRequiredModal
        open={reportEmailRequiredOpen}
        client={getReportClientEmailTarget()}
        documentLabel="le rapport de chantier"
        onCancel={() => setReportEmailRequiredOpen(false)}
        onSaved={handleReportClientEmailSaved}
      />
      <ClientEmailRequiredModal
        open={photosEmailRequiredOpen}
        client={getReportClientEmailTarget()}
        documentLabel="les photos du chantier"
        onCancel={() => setPhotosEmailRequiredOpen(false)}
        onSaved={handlePhotosClientEmailSaved}
      />
    </div>
  )
}
