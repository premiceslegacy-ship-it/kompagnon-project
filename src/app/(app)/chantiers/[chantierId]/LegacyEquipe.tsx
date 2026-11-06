'use client'

import React, { useState, useEffect, useMemo } from 'react'

import { Calendar, Euro, Plus, Trash2, Clock, CheckCircle2, Download, ChevronRight, Users, UserPlus, RefreshCw, ChevronLeft, ChevronDown, ChevronUp, X, Pencil, Check, Sparkles, Loader2 } from 'lucide-react'
import type { ChantierDetail, Pointage, Equipe, ChantierPlanning } from '@/lib/data/queries/chantiers'

import type { TeamMember } from '@/lib/data/queries/team'
import type { OrgRole } from '@/lib/data/queries/roles'
import { getQuoteItemsForSuggestions } from '@/lib/data/mutations/quotes'
import { createEquipe, deleteEquipe, addEquipeMembre, removeEquipeMembre, updateEquipeMembreTaux, updateEquipeMembreProfile, assignEquipeToChantier, removeEquipeFromChantier } from '@/lib/data/mutations/chantiers'

import { todayParis } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────
import { fmtHours } from '../chantiersModel'
import { RECURRENCE_LABELS, CAL_START_H, CAL_HOURS, ROW_H, TOTAL_H, USER_COLORS, getUserColorIdx, getPointageKey, getMonday, getLocalDateStr, dateFromYmd, fmtWeekLabel } from './chantierModel'

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

export function WeeklyPlanningView({
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

export function EquipesTab({
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

export function PointageAccordion({
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

export function MemberHoursReports({
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
