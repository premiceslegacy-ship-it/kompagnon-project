'use client'

import React, { useState, useRef } from 'react'
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
import { getQuoteItemsForSuggestions } from '@/lib/data/mutations/quotes'
import {
  createTache, updateTache, deleteTache, reorderTaches,
  createPointage, deletePointage,
  createChantierNote, deleteChantierNote,
  uploadChantierPhoto, deleteChantierPhoto, updateChantierPhotoCaption,
  generateSituationInvoice,
  updateChantier,
  createEquipe, deleteEquipe, addEquipeMembre, removeEquipeMembre,
  assignEquipeToChantier, removeEquipeFromChantier,
  createChantierPlanning, deleteChantierPlanning,
} from '@/lib/data/mutations/chantiers'
import { sendChantierReportEmail } from '@/lib/data/mutations/chantier-report-email'

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convertit des heures décimales en format lisible : 1.5 → "1h30" */
function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Tab = 'taches' | 'planning' | 'pointages' | 'photos' | 'notes' | 'equipes'

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

function getUserColorIdx(userId: string): number {
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return Math.abs(hash) % USER_COLORS.length
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

function fmtWeekLabel(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${monday.toLocaleDateString('fr-FR', opts)} – ${sunday.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`
}

// ─── Sortable Task Item ───────────────────────────────────────────────────────

function SortableTache({
  tache,
  onStatusToggle,
  onDelete,
  onSaveNote,
}: {
  tache: Tache
  onStatusToggle: (tache: Tache) => void
  onDelete: (tache: Tache) => void
  onSaveNote: (tache: Tache, note: string) => Promise<void>
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tache.id })
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteVal, setNoteVal] = useState(tache.progress_note ?? '')
  const [noteSaving, setNoteSaving] = useState(false)

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

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="card overflow-hidden group"
    >
      <div className="p-3 md:p-4 flex items-center gap-3">
        {/* Drag handle */}
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing text-secondary opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          <GripVertical className="w-4 h-4" />
        </div>

        {/* Status toggle */}
        <button
          onClick={() => onStatusToggle(tache)}
          className={`flex-shrink-0 transition-colors ${cfg.color}`}
          title={`Statut : ${cfg.label} (cliquer pour changer)`}
        >
          {cfg.icon}
        </button>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <span className={`font-medium text-sm ${tache.status === 'termine' ? 'line-through text-secondary' : 'text-primary'}`}>
            {tache.title}
          </span>
          {tache.due_date && (
            <span className="ml-2 text-xs text-secondary">· échéance {fmtDue(tache.due_date)}</span>
          )}
          {tache.progress_note && !noteOpen && (
            <p className="text-xs text-secondary mt-0.5 italic truncate">{tache.progress_note}</p>
          )}
        </div>

        {/* Note avancement (visible si en_cours) */}
        {tache.status === 'en_cours' && (
          <button
            onClick={() => { setNoteOpen(v => !v); setNoteVal(tache.progress_note ?? '') }}
            className={`opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 text-xs px-2 py-1 rounded-lg border ${noteOpen ? 'bg-accent/10 border-accent/40 text-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
            title="Note d'avancement"
          >
            <FileText className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Delete */}
        <button
          onClick={() => onDelete(tache)}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-secondary hover:text-red-500 flex-shrink-0"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
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
    </div>
  )
}

// ─── Weekly Planning View ─────────────────────────────────────────────────────

function WeeklyPlanningView({
  pointages,
  plannings,
  chantier,
  equipes,
  onAddPlanning,
  onDeletePlanning,
}: {
  pointages: Pointage[]
  plannings: ChantierPlanning[]
  chantier: ChantierDetail
  equipes: Equipe[]
  onAddPlanning: (data: { plannedDate: string; startTime: string; endTime: string; label: string; equipeId: string | null; teamSize: number; notes: string }) => Promise<void>
  onDeletePlanning: (id: string) => Promise<void>
}) {
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [showAddForm, setShowAddForm] = useState(false)
  const [addForm, setAddForm] = useState({ date: '', startTime: '08:00', endTime: '12:00', label: '', equipeId: '', teamSize: 1, notes: '' })
  const [addLoading, setAddLoading] = useState(false)

  const byDayPlannings = plannings.reduce<Record<string, ChantierPlanning[]>>((acc, p) => {
    acc[p.planned_date] = [...(acc[p.planned_date] ?? []), p]
    return acc
  }, {})

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d
  })

  const todayStr = getLocalDateStr(new Date())
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

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

  return (
    <div className="space-y-4">
      {recLabel && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/10 border border-accent/20">
          <RefreshCw className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-primary">Récurrence : {recLabel}</p>
            {chantier.recurrence_notes && (
              <p className="text-xs text-secondary mt-1 whitespace-pre-wrap">{chantier.recurrence_notes}</p>
            )}
          </div>
        </div>
      )}

      <div className="card p-4">
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() - 7); setWeekStart(d) }}
            className="p-2 rounded-lg hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors border border-[var(--elevation-border)]"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-center">
            <p className="text-sm font-bold text-primary">{fmtWeekLabel(weekStart)}</p>
            <button
              onClick={() => setWeekStart(getMonday(new Date()))}
              className="text-xs text-accent hover:underline mt-0.5"
            >
              Aujourd'hui
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowAddForm(v => !v)}
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${showAddForm ? 'bg-accent/10 border-accent/40 text-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
            >
              <Plus className="w-3 h-3" /> Planifier
            </button>
            <button
              onClick={() => { const d = new Date(weekStart); d.setDate(d.getDate() + 7); setWeekStart(d) }}
              className="p-2 rounded-lg hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors border border-[var(--elevation-border)]"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {showAddForm && (
          <div className="mb-4 p-4 rounded-xl border border-accent/30 bg-accent/5 space-y-3">
            <p className="text-sm font-semibold text-primary">Nouveau créneau planifié</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">Date *</label>
                <input type="date" className="input w-full text-sm" value={addForm.date} onChange={e => setAddForm(f => ({...f, date: e.target.value}))} />
              </div>
              <div>
                <label className="text-xs font-semibold text-secondary block mb-1">Équipe / Personne *</label>
                <select className="input w-full text-sm" value={addForm.equipeId} onChange={e => {
                  const eq = equipes.find(eq => eq.id === e.target.value)
                  setAddForm(f => ({...f, equipeId: e.target.value, label: eq ? eq.name : f.label, teamSize: eq ? eq.membres.length || 1 : f.teamSize}))
                }}>
                  <option value="">Saisie libre</option>
                  {equipes.map(eq => <option key={eq.id} value={eq.id}>{eq.name} ({eq.membres.length} pers.)</option>)}
                </select>
              </div>
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
            {/* Durée calculée */}
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
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowAddForm(false)} className="text-xs text-secondary hover:text-primary px-3 py-1.5">Annuler</button>
              <button
                disabled={addLoading || !addForm.date || !addForm.label.trim()}
                onClick={async () => {
                  setAddLoading(true)
                  await onAddPlanning({ plannedDate: addForm.date, startTime: addForm.startTime, endTime: addForm.endTime, label: addForm.label, equipeId: addForm.equipeId || null, teamSize: addForm.teamSize, notes: addForm.notes })
                  setAddLoading(false)
                  setShowAddForm(false)
                  setAddForm(f => ({...f, date: '', label: '', equipeId: '', notes: ''}))
                }}
                className="btn-primary text-xs py-1.5 px-4"
              >
                {addLoading ? 'Enregistrement...' : 'Planifier'}
              </button>
            </div>
          </div>
        )}

        <div className="overflow-x-auto">
          <div style={{ minWidth: 700 }}>
            {/* Day headers */}
            <div className="flex mb-1 ml-14">
              {days.map((day, i) => {
                const dateStr = getLocalDateStr(day)
                const isToday = dateStr === todayStr
                const dayTotal = (byDay[dateStr] ?? []).reduce((s, p) => s + p.hours, 0)
                return (
                  <div key={i} className={`flex-1 text-center py-2 rounded-t-lg ${isToday ? 'bg-accent/10' : ''}`}>
                    <p className={`text-xs font-semibold uppercase tracking-wider ${isToday ? 'text-accent' : 'text-secondary'}`}>
                      {dayNames[i]}
                    </p>
                    <div className="flex justify-center mt-1 mb-0.5">
                      <div className={`w-7 h-7 flex items-center justify-center rounded-full text-sm font-bold ${isToday ? 'bg-accent text-white' : 'text-primary'}`}>
                        {day.getDate()}
                      </div>
                    </div>
                    {dayTotal > 0 && (
                      <p className="text-xs text-secondary">{dayTotal}h</p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Grid */}
            <div className="flex border border-[var(--elevation-border)] rounded-b-lg overflow-hidden">
              {/* Time labels */}
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

              {/* Day columns */}
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
                    {timeLabels.map((_, i) => (
                      <div
                        key={i}
                        className="absolute left-0 right-0 border-b border-[var(--elevation-border)]/30"
                        style={{ top: i * ROW_H, height: ROW_H }}
                      />
                    ))}

                    {isToday && (() => {
                      const now = new Date()
                      const fraction = (now.getHours() + now.getMinutes() / 60 - CAL_START_H) / CAL_HOURS
                      if (fraction < 0 || fraction > 1) return null
                      return (
                        <div className="absolute left-0 right-0 z-20 flex items-center" style={{ top: fraction * TOTAL_H }}>
                          <div className="w-2 h-2 rounded-full bg-red-400 flex-shrink-0" />
                          <div className="flex-1 h-0.5 bg-red-400" />
                        </div>
                      )
                    })()}

                    {withTime.map(p => {
                      if (!p.start_time) return null
                      const [h, m] = p.start_time.split(':').map(Number)
                      const startH = h + m / 60
                      const topPx = Math.max(0, (startH - CAL_START_H) * ROW_H)
                      const heightPx = Math.max(p.hours * ROW_H, 26)
                      const col = USER_COLORS[getUserColorIdx(p.user_id)]
                      return (
                        <div
                          key={p.id}
                          className={`absolute left-0.5 right-0.5 rounded-lg px-1.5 py-1 border z-10 overflow-hidden ${col.bg} ${col.border}`}
                          style={{ top: topPx, height: heightPx }}
                          title={`${p.user_name} · ${fmtHours(p.hours)}${p.tache_title ? ` · ${p.tache_title}` : ''}`}
                        >
                          <p className={`text-[10px] font-bold leading-tight truncate ${col.text}`}>{p.user_name}</p>
                          <p className={`text-[10px] leading-tight opacity-80 truncate ${col.text}`}>{p.start_time.slice(0, 5)} · {fmtHours(p.hours)}</p>
                        </div>
                      )
                    })}

                    {noTime.length > 0 && (
                      <div className="absolute top-1 left-0.5 right-0.5 z-10 flex flex-col gap-0.5">
                        {noTime.map(p => {
                          const col = USER_COLORS[getUserColorIdx(p.user_id)]
                          return (
                            <div
                              key={p.id}
                              className={`rounded px-1 py-0.5 text-[9px] font-semibold truncate border ${col.bg} ${col.border} ${col.text}`}
                            >
                              {p.user_name} {fmtHours(p.hours)}
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {planningsWithTime.map(pl => {
                      if (!pl.start_time) return null
                      const [h, m] = pl.start_time.split(':').map(Number)
                      const startH = h + m / 60
                      const topPx = Math.max(0, (startH - CAL_START_H) * ROW_H)
                      const endH = pl.end_time ? (() => { const [eh, em] = pl.end_time!.split(':').map(Number); return eh + em / 60 })() : startH + pl.team_size * 0.5
                      const heightPx = Math.max((endH - startH) * ROW_H, 26)
                      const eq = equipes.find(e => e.id === pl.equipe_id)
                      const bgColor = eq ? `${eq.color}25` : '#6366f125'
                      const borderColor = eq ? eq.color : '#6366f1'
                      return (
                        <div
                          key={`pl-${pl.id}`}
                          className="absolute left-0.5 right-0.5 rounded-lg p-1.5 z-5 overflow-hidden group/pl cursor-default flex flex-col"
                          style={{ top: topPx, height: heightPx, backgroundColor: bgColor, border: `1.5px dashed ${borderColor}` }}
                          title={`PRÉVU · ${pl.label} · ${pl.team_size} pers.${pl.notes ? ` · ${pl.notes}` : ''}`}
                        >
                          <p className="text-[9px] font-bold leading-tight truncate flex items-center gap-1" style={{ color: borderColor }}>
                            <span className="text-[8px] font-bold uppercase tracking-widest px-1 py-0.5 rounded-[3px]" style={{ backgroundColor: borderColor, color: 'white' }}>Prévu</span>
                            {pl.label}
                          </p>
                          <p className="text-[9px] leading-tight opacity-70 truncate mt-0.5" style={{ color: borderColor }}>{pl.team_size} pers. · {pl.start_time.slice(0, 5)}{pl.end_time ? `→${pl.end_time.slice(0, 5)}` : ''}</p>
                          {pl.notes && <p className="text-[9px] leading-tight opacity-80 mt-1 whitespace-pre-wrap break-words overflow-y-auto" style={{ color: borderColor }}>{pl.notes}</p>}
                          <button onClick={() => onDeletePlanning(pl.id)} className="absolute top-1 right-1 opacity-0 group-hover/pl:opacity-100 transition-opacity text-red-500 hover:text-red-600 bg-[#fff9] rounded p-0.5"><X className="w-2.5 h-2.5" /></button>
                        </div>
                      )
                    })}

                    {planningsNoTime.length > 0 && (
                      <div className="absolute bottom-1 left-0.5 right-0.5 flex flex-col gap-0.5">
                        {planningsNoTime.map(pl => {
                          const eq = equipes.find(e => e.id === pl.equipe_id)
                          const borderColor = eq ? eq.color : '#6366f1'
                          return (
                            <div key={`pl-${pl.id}`} className="rounded px-1 p-0.5 flex items-center gap-1 group/pl relative" style={{ backgroundColor: `${borderColor}20`, border: `1px dashed ${borderColor}` }}>
                              <span className="text-[9px] font-semibold truncate flex-1 flex items-center gap-1" style={{ color: borderColor }}>
                                <span className="text-[8px] font-bold uppercase tracking-widest px-1 py-0.5 rounded-[3px]" style={{ backgroundColor: borderColor, color: 'white' }}>Prévu</span>
                                {pl.label}
                              </span>
                              <button onClick={() => onDeletePlanning(pl.id)} className="opacity-0 group-hover/pl:opacity-100 transition-opacity text-red-500 hover:text-red-600 mr-0.5"><X className="w-2.5 h-2.5" /></button>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {(() => {
              const weekPointedH = days.reduce((sum, day) => {
                const dayStr = getLocalDateStr(day)
                return sum + (byDay[dayStr] ?? []).reduce((s, p) => s + p.hours, 0)
              }, 0)
              const weekPlannedH = days.reduce((sum, day) => {
                const dayStr = getLocalDateStr(day)
                return sum + (byDayPlannings[dayStr] ?? []).reduce((s, pl) => {
                  if (!pl.start_time || !pl.end_time) return s
                  const [sh, sm] = pl.start_time.split(':').map(Number)
                  const [eh, em] = pl.end_time.split(':').map(Number)
                  return s + ((eh + em / 60) - (sh + sm / 60))
                }, 0)
              }, 0)
              return (
                <div className="flex items-center gap-4 mt-3 text-xs text-secondary">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-red-400 inline-block" /> Heure actuelle</span>
                  <span className="flex items-center gap-1"><span className="text-[8px] font-bold uppercase tracking-widest px-1 py-0.5 rounded-[3px] bg-indigo-500 text-white">Prévu</span> Planification</span>
                  <span className="opacity-60">Pointages sans heure : haut de colonne</span>
                  <span className="ml-auto flex items-center gap-3 font-semibold text-primary">
                    {weekPointedH > 0 && <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-accent" /> Pointé : <span className="text-accent">{fmtHours(weekPointedH)}</span></span>}
                    {weekPlannedH > 0 && <span className="flex items-center gap-1 opacity-70">Prévu : {fmtHours(weekPlannedH)}</span>}
                  </span>
                </div>
              )
            })()}
          </div>
        </div>

        {/* Liste des planifications de la semaine avec consignes */}
        {(() => {
          const weekPlannings = plannings.filter(pl => {
            const d = pl.planned_date
            const start = getLocalDateStr(days[0])
            const end = getLocalDateStr(days[6])
            return d >= start && d <= end
          })
          if (weekPlannings.length === 0) return null
          return (
            <div className="mt-2 space-y-2">
              <p className="text-xs font-semibold text-secondary uppercase tracking-wider">Planifications de la semaine</p>
              {weekPlannings.map(pl => {
                const eq = equipes.find(e => e.id === pl.equipe_id)
                const borderColor = eq ? eq.color : '#6366f1'
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
                      {pl.notes && (
                        <p className="text-xs text-secondary mt-1 whitespace-pre-wrap">{pl.notes}</p>
                      )}
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
}: {
  chantierId: string
  allEquipes: Equipe[]
  chantierEquipes: Equipe[]
  linkedQuoteId?: string | null
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
  const [memberForms, setMemberForms] = useState<Record<string, { name: string; role: string }>>({})

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
    if (!confirm('Supprimer cette équipe et tous ses membres ?')) return
    await deleteEquipe(equipeId)
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
    const { membreId, error } = await addEquipeMembre(equipeId, { name: form.name.trim(), roleLabel: form.role.trim() || null })
    if (!error && membreId) {
      setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
        ...e,
        membres: [...e.membres, { id: membreId, equipe_id: equipeId, name: form.name.trim(), role_label: form.role.trim() || null, profile_id: null }],
      }))
      setMemberForms(prev => ({ ...prev, [equipeId]: { name: '', role: '' } }))
    }
  }

  const handleRemoveMembre = async (equipeId: string, membreId: string) => {
    await removeEquipeMembre(membreId)
    setAllEquipes(prev => prev.map(e => e.id !== equipeId ? e : {
      ...e, membres: e.membres.filter(m => m.id !== membreId),
    }))
  }

  const PRESET_COLORS = ['#6366f1', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#f97316']

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-primary flex items-center gap-2">
            <Users className="w-4 h-4 text-accent" /> Équipes terrain
          </h3>
          <p className="text-xs text-secondary mt-0.5">Créez des équipes libres et assignez-les à ce chantier.</p>
        </div>
        <div className="flex items-center gap-2">
          {linkedQuoteId && !showTeamSuggestions && (
            <button
              onClick={handleSuggestTeams}
              disabled={suggestTeamsLoading}
              className="flex items-center gap-2 text-sm font-semibold text-violet-600 dark:text-violet-400 px-3 py-2 rounded-xl border border-violet-400/30 bg-violet-500/5 hover:bg-violet-500/10 transition-all disabled:opacity-60"
            >
              {suggestTeamsLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              Suggérer depuis devis
            </button>
          )}
          <button onClick={() => setShowCreate(v => !v)} className="btn-primary flex items-center gap-2 text-sm">
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
              <div key={sugg._id} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${sugg.created ? 'border-emerald-400/30 bg-emerald-500/5 opacity-70' : 'border-[var(--elevation-border)] bg-surface'}`}>
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
        const mForm = memberForms[equipe.id] ?? { name: '', role: '' }
        return (
          <div key={equipe.id} className={`card overflow-hidden border-2 transition-colors ${isAssigned ? 'border-accent/40' : 'border-[var(--elevation-border)]'}`}>
            <div className="flex items-center gap-3 p-4">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: equipe.color }} />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-primary">{equipe.name}</p>
                <p className="text-xs text-secondary mt-0.5">
                  {equipe.membres.length} membre{equipe.membres.length !== 1 ? 's' : ''}
                  {isAssigned && <span className="ml-2 text-accent font-semibold">· Assignée à ce chantier</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleToggleAssign(equipe.id)}
                  className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${isAssigned ? 'border-red-400/40 text-red-500 hover:bg-red-500/10' : 'border-accent/40 text-accent hover:bg-accent/10'}`}
                >
                  {isAssigned ? 'Retirer' : 'Assigner'}
                </button>
                <button onClick={() => toggleExpand(equipe.id)} className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-[var(--elevation-1)] transition-colors">
                  {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                </button>
                <button onClick={() => handleDeleteEquipe(equipe.id)} className="p-1.5 rounded-lg text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {isOpen && (
              <div className="border-t border-[var(--elevation-border)] bg-[var(--elevation-1)] p-4 space-y-2">
                {equipe.membres.length === 0 && (
                  <p className="text-xs text-secondary italic">Aucun membre. Ajoutez-en ci-dessous.</p>
                )}
                {equipe.membres.map(m => (
                  <div key={m.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--elevation-0)] border border-[var(--elevation-border)]">
                    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0" style={{ backgroundColor: equipe.color }}>
                      {m.name[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-primary truncate">{m.name}</p>
                      {m.role_label && <p className="text-xs text-secondary">{m.role_label}</p>}
                    </div>
                    <button onClick={() => handleRemoveMembre(equipe.id, m.id)} className="text-secondary hover:text-red-500 transition-colors flex-shrink-0">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-2 pt-1">
                  <input
                    className="input flex-1 text-sm"
                    placeholder="Prénom Nom"
                    value={mForm.name}
                    onChange={e => setMemberForms(prev => ({ ...prev, [equipe.id]: { ...mForm, name: e.target.value } }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddMembre(equipe.id)}
                  />
                  <input
                    className="input w-36 text-sm"
                    placeholder="Rôle (opt.)"
                    value={mForm.role}
                    onChange={e => setMemberForms(prev => ({ ...prev, [equipe.id]: { ...mForm, role: e.target.value } }))}
                    onKeyDown={e => e.key === 'Enter' && handleAddMembre(equipe.id)}
                  />
                  <button onClick={() => handleAddMembre(equipe.id)} disabled={!mForm.name.trim()} className="btn-primary px-3 flex items-center gap-1">
                    <UserPlus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}
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
}) {
  const router = useRouter()

  const [chantier] = useState(initialChantier)
  const [taches, setTaches] = useState(initialTaches)
  const [pointages, setPointages] = useState(initialPointages)
  const [photos, setPhotos] = useState(initialPhotos)
  const [notes, setNotes] = useState(initialNotes)
  const [plannings, setPlannings] = useState(initialPlannings)
  const [tab, setTab] = useState<Tab>('taches')

  // Tâches
  const [newTacheTitle, setNewTacheTitle] = useState('')
  const [newTacheDue, setNewTacheDue] = useState('')
  const [tacheLoading, setTacheLoading] = useState(false)

  // Pointages
  const [ptDate, setPtDate] = useState(new Date().toISOString().split('T')[0])
  const [ptStartTime, setPtStartTime] = useState('')
  const [ptHoursInt, setPtHoursInt] = useState('')
  const [ptMinutes, setPtMinutes] = useState('0')
  const [ptDesc, setPtDesc] = useState('')
  const [ptTacheId, setPtTacheId] = useState('')
  const [ptLoading, setPtLoading] = useState(false)

  // Notes
  const [noteContent, setNoteContent] = useState('')
  const [noteLoading, setNoteLoading] = useState(false)

  // Photos
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [photoLoading, setPhotoLoading] = useState(false)
  // Lightbox
  const [lightboxPhoto, setLightboxPhoto] = useState<ChantierPhoto | null>(null)
  const [lightboxCaption, setLightboxCaption] = useState('')
  const [lightboxSaving, setLightboxSaving] = useState(false)

  // Contact référent — édition inline
  const [editContact, setEditContact] = useState(false)
  const [contactName, setContactName] = useState(chantier.contact_name ?? '')
  const [contactEmail, setContactEmail] = useState(chantier.contact_email ?? '')
  const [contactPhone, setContactPhone] = useState(chantier.contact_phone ?? '')
  const [contactSaving, setContactSaving] = useState(false)
  const [contactError, setContactError] = useState<string | null>(null)

  // Devis lié
  const [linkedQuoteId, setLinkedQuoteId] = useState<string | null>(chantier.quote_id)
  const [editQuoteLink, setEditQuoteLink] = useState(false)
  const [quoteLinkValue, setQuoteLinkValue] = useState(chantier.quote_id ?? '')
  const [quoteLinkSaving, setQuoteLinkSaving] = useState(false)

  const linkedQuote = linkableQuotes.find(q => q.id === linkedQuoteId) ?? null

  const handleSaveQuoteLink = async () => {
    setQuoteLinkSaving(true)
    const { error } = await updateChantier(chantier.id, { quoteId: quoteLinkValue || null })
    if (error) { alert(error); setQuoteLinkSaving(false); return }
    setLinkedQuoteId(quoteLinkValue || null)
    setEditQuoteLink(false)
    setQuoteLinkSaving(false)
  }

  const handleSaveContact = async () => {
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

  // PDF période
  const [showPdfPanel, setShowPdfPanel] = useState(false)
  const [pdfFrom, setPdfFrom] = useState('')
  const [pdfTo, setPdfTo] = useState('')

  // Email rapport
  type EmailStatus = 'idle' | 'sending' | 'done' | 'error'
  const [emailStatus, setEmailStatus] = useState<EmailStatus>('idle')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [emailRecipient, setEmailRecipient] = useState<string | null>(null)

  const handleSendReportEmail = async () => {
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

  // Situation
  const [showSituationModal, setShowSituationModal] = useState(false)
  const [situationRate, setSituationRate] = useState(50)
  const [situationLoading, setSituationLoading] = useState(false)
  const [situationError, setSituationError] = useState<string | null>(null)

  // Task suggestions
  type TaskSuggestion = { _id: string; title: string; editing: boolean }
  const [taskSuggestions, setTaskSuggestions] = useState<TaskSuggestion[]>([])
  const [suggestTasksLoading, setSuggestTasksLoading] = useState(false)
  const [suggestTasksError, setSuggestTasksError] = useState<string | null>(null)
  const [showTaskSuggestions, setShowTaskSuggestions] = useState(false)

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

  // Compteurs dérivés du state vivant (pas du snapshot chantier initial)
  const tachesCount = taches.length
  const tachesDone = taches.filter(t => t.status === 'termine').length
  const donePct = tachesCount > 0 ? Math.round((tachesDone / tachesCount) * 100) : 0

  // ── Tâches ──

  const handleAddTache = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    if (!newTacheTitle.trim()) return
    setTacheLoading(true)
    const titleToAdd = newTacheTitle.trim()
    const dueToAdd = newTacheDue || null
    const { tacheId, error } = await createTache(chantier.id, { title: titleToAdd, dueDate: dueToAdd })
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
      }])
      setNewTacheTitle('')
      setNewTacheDue('')
    }
  }

  const handleStatusToggle = async (tache: Tache) => {
    const nextStatus = STATUS_CYCLE[tache.status]
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, status: nextStatus } : t))
    await updateTache(tache.id, chantier.id, { status: nextStatus })
  }

  const handleDeleteTache = async (tache: Tache) => {
    if (!confirm(`Supprimer la tâche "${tache.title}" ?`)) return
    setTaches(prev => prev.filter(t => t.id !== tache.id))
    await deleteTache(tache.id, chantier.id)
  }

  const handleSaveTacheNote = async (tache: Tache, note: string) => {
    setTaches(prev => prev.map(t => t.id === tache.id ? { ...t, progress_note: note || null } : t))
    await updateTache(tache.id, chantier.id, { progressNote: note || null })
  }

  const handleDragEnd = async (event: DragEndEvent) => {
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
    if (!linkedQuoteId) return
    setSuggestTasksLoading(true)
    setSuggestTasksError(null)
    setShowTaskSuggestions(false)

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
        setSuggestTasksError(data.error ?? 'Erreur lors de la génération')
        setSuggestTasksLoading(false)
        return
      }
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
    const sugg = taskSuggestions.find(s => s._id === id)
    if (!sugg || !sugg.title.trim()) return
    const { tacheId } = await createTache(chantier.id, { title: sugg.title.trim() })
    if (tacheId) {
      setTaches(prev => [...prev, {
        id: tacheId, chantier_id: chantier.id, title: sugg.title.trim(),
        description: null, status: 'a_faire', position: prev.length,
        assigned_to: null, due_date: null, progress_note: null,
        completed_at: null, created_at: new Date().toISOString(),
      }])
      setTaskSuggestions(prev => prev.filter(s => s._id !== id))
      if (taskSuggestions.length === 1) setShowTaskSuggestions(false)
    }
  }

  const handleValidateAllSuggestions = async () => {
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
          completed_at: null, created_at: new Date().toISOString(),
        })
      }
    }
    setTaches(prev => [...prev, ...newTaches])
    setTaskSuggestions([])
    setShowTaskSuggestions(false)
  }

  // ── Plannings ──

  const handleAddPlanning = async (data: { plannedDate: string; startTime: string; endTime: string; label: string; equipeId: string | null; teamSize: number; notes: string }) => {
    const { planningId, error } = await createChantierPlanning(chantier.id, {
      plannedDate: data.plannedDate,
      startTime: data.startTime || null,
      endTime: data.endTime || null,
      equipeId: data.equipeId,
      label: data.label,
      teamSize: data.teamSize,
      notes: data.notes || null,
    })
    if (!error && planningId) {
      setPlannings(prev => [...prev, {
        id: planningId,
        chantier_id: chantier.id,
        planned_date: data.plannedDate,
        start_time: data.startTime || null,
        end_time: data.endTime || null,
        equipe_id: data.equipeId,
        label: data.label,
        team_size: data.teamSize,
        notes: data.notes || null,
        created_at: new Date().toISOString(),
      }])
    }
  }

  const handleDeletePlanning = async (planningId: string) => {
    setPlannings(prev => prev.filter(p => p.id !== planningId))
    await deleteChantierPlanning(planningId, chantier.id)
  }

  // ── Pointages ──

  const handleAddPointage = async (e: React.SyntheticEvent) => {
    e.preventDefault()
    const h = parseInt(ptHoursInt) || 0
    const m = parseInt(ptMinutes) || 0
    const hours = h + m / 60
    if (!ptDate || hours <= 0) return

    // Optimistic: ajouter immédiatement à l'état local
    const tempId = crypto.randomUUID()
    const tempPointage: Pointage = {
      id: tempId,
      chantier_id: chantier.id,
      tache_id: ptTacheId || null,
      user_id: 'temp',
      date: ptDate,
      hours,
      description: ptDesc || null,
      created_at: new Date().toISOString(),
      start_time: ptStartTime || null,
      user_name: 'Moi',
      tache_title: taches.find(t => t.id === ptTacheId)?.title ?? null,
    }
    setPointages(prev => [tempPointage, ...prev])
    const savedDate = ptDate
    const savedHours = ptHoursInt
    const savedMinutes = ptMinutes
    const savedDesc = ptDesc
    const savedStartTime = ptStartTime
    const savedTacheId = ptTacheId
    setPtHoursInt('')
    setPtMinutes('0')
    setPtDesc('')
    setPtStartTime('')

    setPtLoading(true)
    const { error } = await createPointage(chantier.id, {
      date: savedDate,
      hours,
      tacheId: savedTacheId || null,
      description: savedDesc || null,
      start_time: savedStartTime || null,
    })
    setPtLoading(false)
    if (error) {
      setPointages(prev => prev.filter(p => p.id !== tempId))
      setPtHoursInt(savedHours)
      setPtMinutes(savedMinutes)
      setPtDesc(savedDesc)
      setPtStartTime(savedStartTime)
    }
  }

  const handleDeletePointage = async (p: Pointage) => {
    setPointages(prev => prev.filter(pt => pt.id !== p.id))
    await deletePointage(p.id, chantier.id)
  }

  // ── Notes ──

  const handleAddNote = async (e: React.SyntheticEvent) => {
    e.preventDefault()
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
    setNotes(prev => prev.filter(n => n.id !== note.id))
    await deleteChantierNote(note.id, chantier.id)
  }

  // ── Photos ──

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Prévisualisation immédiate
    const localUrl = URL.createObjectURL(file)
    const tempId = crypto.randomUUID()
    setPhotos(prev => [{
      id: tempId, chantier_id: chantier.id, tache_id: null,
      storage_path: '', caption: null, taken_at: new Date().toISOString(),
      created_at: new Date().toISOString(), uploaded_by_name: 'Moi', url: localUrl,
    }, ...prev])
    if (fileInputRef.current) fileInputRef.current.value = ''

    setPhotoLoading(true)
    const fd = new FormData()
    fd.append('file', file)
    const result = await uploadChantierPhoto(chantier.id, 'org', fd)
    setPhotoLoading(false)

    if (!result.error && result.photo) {
      const rp = result.photo
      setPhotos(prev => prev.map(p => p.id === tempId ? { ...rp, chantier_id: chantier.id, tache_id: null } : p))
      URL.revokeObjectURL(localUrl)
    } else {
      setPhotos(prev => prev.filter(p => p.id !== tempId))
      URL.revokeObjectURL(localUrl)
    }
  }

  const handleDeletePhoto = async (photo: ChantierPhoto) => {
    if (!confirm('Supprimer cette photo ?')) return
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
    await deleteChantierPhoto(photo.id, chantier.id)
  }

  // ── Situation ──

  const handleGenerateSituation = async () => {
    setSituationLoading(true)
    setSituationError(null)
    const { invoiceId, error } = await generateSituationInvoice(chantier.id, situationRate)
    setSituationLoading(false)
    if (error) return setSituationError(error)
    setShowSituationModal(false)
    router.push(`/finances/invoice-editor?id=${invoiceId}`)
  }

  const statusCfg = CHANTIER_STATUS_CONFIG[chantier.status as keyof typeof CHANTIER_STATUS_CONFIG]
    ?? { label: chantier.status, color: 'bg-secondary/20 text-secondary' }

  // donePct est calculé plus haut depuis le state vivant `taches`

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'taches',    label: 'Tâches',    count: taches.length },
    { id: 'planning',  label: 'Planning'   },
    { id: 'pointages', label: 'Pointages', count: pointages.length },
    { id: 'photos',    label: 'Photos',    count: photos.length },
    { id: 'notes',     label: 'Journal',   count: notes.length },
    { id: 'equipes',   label: 'Équipes'    },
  ]

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
      {/* Back + planning global */}
      <div className="flex items-center justify-between">
        <button onClick={() => router.back()} className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors">
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
                <button
                  onClick={() => setEditContact(true)}
                  className="p-1 text-secondary hover:text-primary transition-colors flex-shrink-0"
                  title={contactName || contactEmail || contactPhone ? 'Modifier le contact' : 'Ajouter un contact référent'}
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
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
                      href={`/finances/quote-editor?id=${linkedQuote.id}`}
                      className="text-sm flex items-center gap-1.5 text-accent hover:underline"
                    >
                      <FileText className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="font-mono text-xs">{linkedQuote.number ?? '/'}</span>
                      {linkedQuote.title && <span className="text-secondary">· {linkedQuote.title}</span>}
                    </Link>
                    <button
                      onClick={() => { setQuoteLinkValue(linkedQuote.id); setEditQuoteLink(true) }}
                      className="p-1 text-secondary hover:text-primary transition-colors flex-shrink-0"
                      title="Changer le devis lié"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => { setQuoteLinkValue(''); setEditQuoteLink(true) }}
                    className="text-sm text-secondary hover:text-accent transition-colors flex items-center gap-1.5"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    Lier un devis
                  </button>
                )}
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
            <div className="text-sm text-secondary flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>{fmtDate(chantier.start_date)}</span>
              <ChevronRight className="w-3 h-3" />
              <span>{fmtDate(chantier.estimated_end_date)}</span>
            </div>
            {/* Budget */}
            <div className="text-sm text-secondary flex items-center gap-2">
              <Euro className="w-4 h-4" />
              <span className="font-semibold text-primary">{fmtMoney(chantier.budget_ht)} HT</span>
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
              {chantier.quote_id && (
                <button
                  onClick={() => setShowSituationModal(true)}
                  className="btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5"
                >
                  <TrendingUp className="w-3.5 h-3.5" /> Situation de travaux
                </button>
              )}
              <button
                onClick={() => setShowPdfPanel(v => !v)}
                className={`btn-secondary text-xs py-1.5 px-3 flex items-center gap-1.5 ${showPdfPanel ? 'ring-2 ring-accent/40' : ''}`}
              >
                <Download className="w-3.5 h-3.5" /> Rapport PDF
              </button>
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
                      onClick={handleSendReportEmail}
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

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[var(--elevation-border)]">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2.5 text-sm font-semibold transition-colors flex items-center gap-1.5 border-b-2 -mb-px ${
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

      {/* ── Tab: Tâches ── */}
      {tab === 'taches' && (
        <div className="space-y-4">
          {/* Add form */}
          <form onSubmit={handleAddTache} className="card p-4 flex flex-col sm:flex-row gap-3">
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
            <button type="submit" disabled={tacheLoading} className="btn-primary flex items-center gap-2 whitespace-nowrap">
              <Plus className="w-4 h-4" /> Ajouter
            </button>
          </form>

          {/* Actions rapides: IA + Bibliothèque */}
          {!showTaskSuggestions && (
            <div className="flex flex-wrap items-center gap-3">
              {linkedQuoteId && (
                <button
                  onClick={handleSuggestTasks}
                  disabled={suggestTasksLoading}
                  className="flex items-center gap-2 text-sm font-semibold text-violet-600 dark:text-violet-400 hover:text-violet-700 dark:hover:text-violet-300 px-4 py-2 rounded-xl border border-violet-400/30 bg-violet-500/5 hover:bg-violet-500/10 transition-all disabled:opacity-60"
                >
                  {suggestTasksLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {suggestTasksLoading ? 'Génération en cours...' : 'Importer depuis le devis'}
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
              {suggestTasksError && <p className="text-sm text-red-500">{suggestTasksError}</p>}
            </div>
          )}

          {/* Bibliothèque de tâches réutilisables */}
          {showTaskLibrary && !showTaskSuggestions && (
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

          {showTaskSuggestions && taskSuggestions.length > 0 && (
            <div className="card p-4 space-y-3 border-violet-400/30 bg-violet-500/3">
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
                  <div key={sugg._id} className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--elevation-border)] bg-surface hover:border-violet-400/30 transition-colors">
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
                    <button
                      onClick={() => setTaskSuggestions(prev => prev.map(s => s._id === sugg._id ? { ...s, editing: !s.editing } : s))}
                      className="p-1.5 text-secondary hover:text-primary rounded-lg hover:bg-base transition-colors"
                      title="Modifier"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleValidateSuggestion(sugg._id)}
                      className="p-1.5 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors"
                      title="Valider"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setTaskSuggestions(prev => prev.filter(s => s._id !== sugg._id))}
                      className="p-1.5 text-secondary hover:text-red-500 rounded-lg hover:bg-red-500/10 transition-colors"
                      title="Supprimer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <button onClick={handleValidateAllSuggestions} className="btn-primary flex-1 flex items-center justify-center gap-2 text-sm">
                  <CheckCircle2 className="w-4 h-4" /> Valider toutes
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
          <form onSubmit={handleAddPointage} className="card p-4 space-y-3">
            <p className="text-sm font-semibold text-primary">Ajouter un pointage</p>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <div>
                <label className="text-xs text-secondary font-semibold mb-1 block">Date</label>
                <input type="date" className="input w-full" value={ptDate} onChange={e => setPtDate(e.target.value)} required />
              </div>
              <div>
                <label className="text-xs text-secondary font-semibold mb-1 block">Heure de début</label>
                <input type="time" className="input w-full" value={ptStartTime} onChange={e => setPtStartTime(e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-secondary font-semibold mb-1 block">Durée</label>
                <div className="flex items-center gap-1.5">
                  <input type="number" min="0" max="23" placeholder="7" className="input w-20 text-center" value={ptHoursInt} onChange={e => setPtHoursInt(e.target.value)} required />
                  <span className="text-sm font-bold text-secondary">h</span>
                  <input type="number" min="0" max="59" step="5" placeholder="30" className="input w-20 text-center" value={ptMinutes} onChange={e => setPtMinutes(e.target.value)} />
                  <span className="text-sm font-bold text-secondary">min</span>
                </div>
              </div>
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
            <button type="submit" disabled={ptLoading} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> {ptLoading ? 'Enregistrement...' : 'Enregistrer'}
            </button>
          </form>

          {/* Table pointages */}
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--elevation-border)] text-xs text-secondary uppercase tracking-wider">
                  <th className="text-left px-4 py-3 font-semibold">Date</th>
                  <th className="text-left px-4 py-3 font-semibold hidden sm:table-cell">Début</th>
                  <th className="text-left px-4 py-3 font-semibold">Utilisateur</th>
                  <th className="text-right px-4 py-3 font-semibold">Heures</th>
                  <th className="text-left px-4 py-3 font-semibold hidden md:table-cell">Tâche</th>
                  <th className="text-left px-4 py-3 font-semibold hidden lg:table-cell">Description</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {pointages.length === 0 && (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-secondary text-sm">Aucun pointage</td></tr>
                )}
                {pointages.map(p => (
                  <tr key={p.id} className="hover:bg-base/50 transition-colors">
                    <td className="px-4 py-3 text-sm text-primary">{new Date(p.date).toLocaleDateString('fr-FR')}</td>
                    <td className="px-4 py-3 text-sm text-secondary hidden sm:table-cell">{p.start_time ? p.start_time.slice(0, 5) : '/'}</td>
                    <td className="px-4 py-3 text-sm text-secondary">{p.user_name}</td>
                    <td className="px-4 py-3 text-right font-semibold text-primary">{fmtHours(p.hours)}</td>
                    <td className="px-4 py-3 text-sm text-secondary hidden md:table-cell">{p.tache_title ?? '/'}</td>
                    <td className="px-4 py-3 text-sm text-secondary hidden lg:table-cell truncate max-w-xs">{p.description ?? '/'}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => handleDeletePointage(p)} className="text-secondary hover:text-red-500 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: Photos ── */}
      {tab === 'photos' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-secondary">{photos.length} photo{photos.length > 1 ? 's' : ''}</p>
            <label className="btn-primary flex items-center gap-2 cursor-pointer">
              <Camera className="w-4 h-4" />
              {photoLoading ? 'Upload...' : 'Ajouter une photo'}
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
            </label>
          </div>

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
              return (
                <div
                  key={photo.id}
                  className="group card overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                  onClick={() => { setLightboxPhoto(photo); setLightboxCaption(photo.caption ?? '') }}
                >
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
                    <p className="text-[10px] text-secondary mt-0.5">{photo.uploaded_by_name}</p>
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
              <div className="relative w-full max-w-4xl flex flex-col bg-surface rounded-2xl overflow-hidden shadow-2xl border border-[var(--elevation-border)] max-h-[90vh]">
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

                {/* Footer: meta + description */}
                <div className="p-4 space-y-3 border-t border-[var(--elevation-border)]">
                  <p className="text-xs text-secondary">
                    Par {lightboxPhoto.uploaded_by_name}
                    {lightboxPhoto.taken_at && ` · ${new Date(lightboxPhoto.taken_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`}
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={lightboxCaption}
                      onChange={e => setLightboxCaption(e.target.value)}
                      placeholder="Ajouter une description..."
                      className="input flex-1"
                    />
                    <button
                      onClick={async () => {
                        setLightboxSaving(true)
                        await updateChantierPhotoCaption(lightboxPhoto.id, chantier.id, lightboxCaption || null)
                        setPhotos(prev => prev.map(p => p.id === lightboxPhoto.id ? { ...p, caption: lightboxCaption || null } : p))
                        setLightboxPhoto(prev => prev ? { ...prev, caption: lightboxCaption || null } : null)
                        setLightboxSaving(false)
                      }}
                      disabled={lightboxSaving}
                      className="btn-primary flex items-center gap-1.5 px-4"
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
                      className="w-10 h-10 rounded-xl border border-red-500/30 text-red-500 flex items-center justify-center hover:bg-red-500/10 transition-colors"
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

      {/* ── Tab: Équipes ── */}
      {tab === 'equipes' && (
        <EquipesTab
          chantierId={chantier.id}
          allEquipes={allEquipes}
          chantierEquipes={initialChantierEquipes}
          linkedQuoteId={linkedQuoteId}
        />
      )}

      {/* ── Modal Situation de travaux ── */}
      {showSituationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md mx-4 p-6 space-y-5">
            <h2 className="text-lg font-bold text-primary flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent" /> Situation de travaux
            </h2>

            <div>
              <p className="text-sm text-secondary mb-3">
                Facturation partielle basée sur l'avancement du chantier. Le montant sera calculé sur le devis lié, avec déduction des acomptes déjà versés.
              </p>
              <label className="text-xs font-semibold text-secondary block mb-2">Avancement (%)</label>
              <div className="flex items-center gap-3">
                <input
                  type="range" min={1} max={100} step={5}
                  value={situationRate}
                  onChange={e => setSituationRate(parseInt(e.target.value))}
                  className="flex-1"
                />
                <span className="text-xl font-extrabold text-accent w-16 text-right">{situationRate}%</span>
              </div>
              <div className="flex gap-2 mt-3">
                {[25, 50, 75, 100].map(v => (
                  <button
                    key={v}
                    onClick={() => setSituationRate(v)}
                    className={`flex-1 py-1.5 rounded-lg text-sm font-bold border transition-colors ${situationRate === v ? 'bg-accent text-black border-accent' : 'border-[var(--elevation-border)] text-secondary hover:text-primary'}`}
                  >
                    {v}%
                  </button>
                ))}
              </div>
              <div className="mt-4 p-3 card">
                <p className="text-xs text-secondary">Montant de la situation</p>
                <p className="text-xl font-extrabold text-primary mt-0.5">
                  {((chantier.budget_ht * situationRate) / 100).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' })} HT
                </p>
              </div>
            </div>

            {situationError && <p className="text-sm text-red-500">{situationError}</p>}

            <div className="flex gap-3">
              <button onClick={() => setShowSituationModal(false)} className="btn-secondary flex-1">Annuler</button>
              <button onClick={handleGenerateSituation} disabled={situationLoading} className="btn-primary flex-1">
                {situationLoading ? 'Génération...' : 'Générer la facture'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
