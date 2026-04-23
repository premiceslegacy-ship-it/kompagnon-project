'use client'

import React, { useState, useMemo, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Users,
  Filter,
  LayoutList,
  CalendarDays,
  ArrowLeft,
  Sparkles,
  Loader2,
  Check,
  X,
  Clock,
} from 'lucide-react'
import type { GlobalPlanning, Chantier } from '@/lib/data/queries/chantiers'
import { planWeekWithAI, createPlanningSlots } from '@/lib/data/mutations/planning'
import type { AIPlanningSlot } from '@/lib/data/mutations/planning'

// ─── Palette de couleurs (12 couleurs pour les chantiers) ────────────────────

const CHANTIER_COLORS = [
  { bg: 'bg-indigo-500/20',  border: 'border-indigo-400', text: 'text-indigo-700 dark:text-indigo-300',   hex: '#6366f1' },
  { bg: 'bg-blue-500/20',    border: 'border-blue-400',   text: 'text-blue-700 dark:text-blue-300',       hex: '#3b82f6' },
  { bg: 'bg-emerald-500/20', border: 'border-emerald-400',text: 'text-emerald-700 dark:text-emerald-300', hex: '#10b981' },
  { bg: 'bg-amber-500/20',   border: 'border-amber-400',  text: 'text-amber-700 dark:text-amber-300',     hex: '#f59e0b' },
  { bg: 'bg-purple-500/20',  border: 'border-purple-400', text: 'text-purple-700 dark:text-purple-300',   hex: '#a855f7' },
  { bg: 'bg-rose-500/20',    border: 'border-rose-400',   text: 'text-rose-700 dark:text-rose-300',       hex: '#f43f5e' },
  { bg: 'bg-teal-500/20',    border: 'border-teal-400',   text: 'text-teal-700 dark:text-teal-300',       hex: '#14b8a6' },
  { bg: 'bg-orange-500/20',  border: 'border-orange-400', text: 'text-orange-700 dark:text-orange-300',   hex: '#f97316' },
  { bg: 'bg-sky-500/20',     border: 'border-sky-400',    text: 'text-sky-700 dark:text-sky-300',         hex: '#0ea5e9' },
  { bg: 'bg-lime-500/20',    border: 'border-lime-400',   text: 'text-lime-700 dark:text-lime-300',       hex: '#84cc16' },
  { bg: 'bg-pink-500/20',    border: 'border-pink-400',   text: 'text-pink-700 dark:text-pink-300',       hex: '#ec4899' },
  { bg: 'bg-cyan-500/20',    border: 'border-cyan-400',   text: 'text-cyan-700 dark:text-cyan-300',       hex: '#06b6d4' },
]

// ─── Constantes calendrier ───────────────────────────────────────────────────

const CAL_START_H = 5
const CAL_END_H = 23
const CAL_HOURS = CAL_END_H - CAL_START_H // 18
const ROW_H = 48 // px par heure

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

function getLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function fmtWeekLabel(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return `${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} – ${sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

// ─── Props ───────────────────────────────────────────────────────────────────

interface Props {
  initialPlannings: GlobalPlanning[]
  chantiers: Chantier[]
  planningAiEnabled: boolean
}

// ─── Composant principal ─────────────────────────────────────────────────────

export default function PlanningGlobalClient({ initialPlannings, chantiers, planningAiEnabled }: Props) {
  const router = useRouter()

  // State
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()))
  const [viewMode, setViewMode] = useState<'semaine' | 'liste'>('semaine')
  const [filterChantier, setFilterChantier] = useState<string>('tous')
  const [filterStatus, setFilterStatus] = useState<string>('tous')

  // ─── Agent IA ────────────────────────────────────────────────────────────────
  const [aiModalOpen, setAiModalOpen] = useState(false)
  const [aiPrompt, setAiPrompt] = useState('')
  const [aiStatus, setAiStatus] = useState<'idle' | 'loading' | 'preview' | 'saving' | 'done' | 'error'>('idle')
  const [aiSlots, setAiSlots] = useState<AIPlanningSlot[]>([])
  const [aiSummary, setAiSummary] = useState('')
  const [aiError, setAiError] = useState('')
  const [, startTransition] = useTransition()

  function openAiModal() {
    if (!planningAiEnabled) return
    setAiPrompt('')
    setAiStatus('idle')
    setAiSlots([])
    setAiSummary('')
    setAiError('')
    setAiModalOpen(true)
  }

  async function handleAiGenerate() {
    if (!aiPrompt.trim()) return
    setAiStatus('loading')
    setAiError('')
    const weekDateStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`
    const result = await planWeekWithAI(aiPrompt, weekDateStr)
    if (result.error || !result.slots.length) {
      setAiError(result.error ?? 'Aucun créneau détecté. Reformulez votre demande.')
      setAiStatus('error')
      return
    }
    setAiSlots(result.slots)
    setAiSummary(result.summary)
    setAiStatus('preview')
  }

  async function handleAiConfirm() {
    setAiStatus('saving')
    startTransition(async () => {
      const { error } = await createPlanningSlots(aiSlots.map(s => ({
        chantierId: s.chantierId,
        plannedDate: s.plannedDate,
        startTime: s.startTime,
        endTime: s.endTime,
        label: s.label,
        teamSize: s.teamSize,
        notes: s.notes,
      })))
      if (error) {
        setAiError(error)
        setAiStatus('error')
      } else {
        setAiStatus('done')
        setTimeout(() => { setAiModalOpen(false); router.refresh() }, 1200)
      }
    })
  }

  // Valeurs dérivées
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d
  })
  const todayStr = getLocalDateStr(new Date())
  const dayNames = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
  const timeLabels = Array.from({ length: CAL_HOURS }, (_, i) =>
    `${String(CAL_START_H + i).padStart(2, '0')}:00`
  )
  const TOTAL_H = CAL_HOURS * ROW_H
  const weekDates = days.map(getLocalDateStr)

  const filteredPlannings = useMemo(
    () =>
      initialPlannings.filter(p => {
        if (filterChantier !== 'tous' && p.chantier_id !== filterChantier) return false
        const chantier = chantiers.find(c => c.id === p.chantier_id)
        if (filterStatus !== 'tous' && chantier?.status !== filterStatus) return false
        return true
      }),
    [initialPlannings, filterChantier, filterStatus, chantiers]
  )

  const weekPlannings = useMemo(
    () => filteredPlannings.filter(p => weekDates.includes(p.planned_date)),
    [filteredPlannings, weekDates]
  )

  // Stats pour la semaine courante
  const weekStats = useMemo(() => {
    const chantiersIds = new Set(weekPlannings.map(p => p.chantier_id))
    const totalPersonnes = weekPlannings.reduce((s, p) => s + p.team_size, 0)
    const byDayCount = weekPlannings.reduce<Record<string, number>>((acc, p) => {
      acc[p.planned_date] = (acc[p.planned_date] ?? 0) + p.team_size
      return acc
    }, {})
    const jourLePlusCharge = Object.entries(byDayCount).sort(([, a], [, b]) => b - a)[0]
    return { chantiersActifs: chantiersIds.size, totalPersonnes, jourLePlusCharge }
  }, [weekPlannings])

  const byDay = useMemo(
    () =>
      weekPlannings.reduce<Record<string, GlobalPlanning[]>>((acc, p) => {
        acc[p.planned_date] = [...(acc[p.planned_date] ?? []), p]
        return acc
      }, {}),
    [weekPlannings]
  )

  // Chantiers uniques dans la semaine (pour la légende)
  const uniqueChantiers = useMemo(() => {
    const seen = new Set<string>()
    return weekPlannings.filter(p => {
      if (seen.has(p.chantier_id)) return false
      seen.add(p.chantier_id)
      return true
    })
  }, [weekPlannings])

  // Navigation semaine
  const prevWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() - 7)
    setWeekStart(d)
  }
  const nextWeek = () => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + 7)
    setWeekStart(d)
  }
  const goToday = () => setWeekStart(getMonday(new Date()))

  // Heure actuelle pour la ligne rouge
  const now = new Date()
  const nowH = now.getHours() + now.getMinutes() / 60
  const nowTopPx = (nowH - CAL_START_H) * ROW_H

  // Jour le plus chargé — libellé lisible
  const jourLePlusChargeLabel = useMemo(() => {
    if (!weekStats.jourLePlusCharge) return '/'
    const [dateStr] = weekStats.jourLePlusCharge
    try {
      return new Date(dateStr + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      })
    } catch {
      return dateStr
    }
  }, [weekStats.jourLePlusCharge])

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-[1400px] mx-auto">
      {/* ── En-tête ── */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.back()}
          className="p-2 rounded-lg hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors border border-[var(--elevation-border)]"
        >
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-extrabold text-primary flex items-center gap-3">
            <Calendar className="w-6 h-6 text-accent" />
            Planning global
          </h1>
          <p className="text-sm text-secondary mt-0.5">Vue d&apos;ensemble de tous les chantiers actifs</p>
        </div>
        <a
          href="/chantiers/heures"
          className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[var(--elevation-border)] text-sm font-semibold text-secondary hover:text-primary hover:border-accent/40 transition-all"
        >
          <Clock className="w-4 h-4" />
          Heures pointées
        </a>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Chantiers actifs cette semaine"
          value={weekStats.chantiersActifs}
        />
        <StatCard
          label="Personnes mobilisées"
          value={weekStats.totalPersonnes}
          suffix="pers."
        />
        <StatCard
          label="Créneaux planifiés"
          value={weekPlannings.length}
          suffix={weekPlannings.length > 1 ? 'créneaux' : 'créneau'}
        />
        <div className="card p-4 space-y-1">
          <p className="text-xs text-secondary font-medium">Jour le plus chargé</p>
          <p className="text-xl font-extrabold text-primary leading-tight">
            {jourLePlusChargeLabel}
          </p>
          {weekStats.jourLePlusCharge && (
            <p className="text-xs text-secondary">
              {weekStats.jourLePlusCharge[1]} pers.
            </p>
          )}
        </div>
      </div>

      {/* ── Filtres + toggle de vue ── */}
      <div className="flex flex-wrap items-center gap-3">
        <Filter className="w-4 h-4 text-secondary flex-shrink-0" />

        {/* Filtre chantier */}
        <select
          value={filterChantier}
          onChange={e => setFilterChantier(e.target.value)}
          className="text-sm rounded-lg border border-[var(--elevation-border)] bg-[var(--elevation-1)] text-primary px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="tous">Tous les chantiers</option>
          {chantiers.map(c => (
            <option key={c.id} value={c.id}>
              {c.title}{c.city ? ` · ${c.city}` : ''}
            </option>
          ))}
        </select>

        {/* Filtre statut */}
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="text-sm rounded-lg border border-[var(--elevation-border)] bg-[var(--elevation-1)] text-primary px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-accent/40"
        >
          <option value="tous">Tous les statuts</option>
          <option value="planifie">Planifié</option>
          <option value="en_cours">En cours</option>
          <option value="suspendu">Suspendu</option>
        </select>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Bouton IA */}
        {planningAiEnabled && (
          <button
            onClick={openAiModal}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-black font-semibold text-sm hover:scale-105 transition-all shadow-lg shadow-accent/20"
          >
            <Sparkles className="w-4 h-4" />
            Planifier avec l&apos;IA
          </button>
        )}

        {/* Toggle vue */}
        <div className="flex items-center rounded-lg border border-[var(--elevation-border)] overflow-hidden">
          <button
            onClick={() => setViewMode('semaine')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'semaine'
                ? 'bg-accent text-white'
                : 'text-secondary hover:text-primary hover:bg-[var(--elevation-1)]'
            }`}
          >
            <CalendarDays className="w-4 h-4" />
            Semaine
          </button>
          <button
            onClick={() => setViewMode('liste')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium transition-colors ${
              viewMode === 'liste'
                ? 'bg-accent text-white'
                : 'text-secondary hover:text-primary hover:bg-[var(--elevation-1)]'
            }`}
          >
            <LayoutList className="w-4 h-4" />
            Liste
          </button>
        </div>
      </div>

      {/* ── Navigation semaine ── */}
      <div className="flex items-center justify-between gap-4">
        <button
          onClick={prevWeek}
          className="p-2 rounded-lg border border-[var(--elevation-border)] hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-primary">
            {fmtWeekLabel(weekStart)}
          </span>
          <button
            onClick={goToday}
            className="text-xs px-3 py-1 rounded-full border border-[var(--elevation-border)] hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors"
          >
            Aujourd&apos;hui
          </button>
        </div>
        <button
          onClick={nextWeek}
          className="p-2 rounded-lg border border-[var(--elevation-border)] hover:bg-[var(--elevation-1)] text-secondary hover:text-primary transition-colors"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* ── Légende chantiers ── */}
      {uniqueChantiers.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {uniqueChantiers.map(c => {
            const col = CHANTIER_COLORS[c.chantier_color_idx]
            const isActive = filterChantier === c.chantier_id
            return (
              <button
                key={c.chantier_id}
                onClick={() =>
                  setFilterChantier(prev => (prev === c.chantier_id ? 'tous' : c.chantier_id))
                }
                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  isActive
                    ? `${col.bg} ${col.border} ${col.text}`
                    : 'border-[var(--elevation-border)] text-secondary hover:text-primary'
                }`}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: col.hex }}
                />
                {c.chantier_title}
                {c.chantier_city && (
                  <span className="opacity-60">· {c.chantier_city}</span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Contenu principal ── */}
      {weekPlannings.length === 0 ? (
        <div className="card p-12 flex flex-col items-center justify-center gap-4 text-center">
          <Calendar className="w-12 h-12 text-secondary/40" />
          <p className="text-secondary font-medium">Aucun créneau planifié cette semaine</p>
          <p className="text-sm text-secondary/70">
            Changez de semaine ou ajustez les filtres pour voir les plannings.
          </p>
        </div>
      ) : viewMode === 'semaine' ? (
        <SemaineView
          days={days}
          dayNames={dayNames}
          todayStr={todayStr}
          timeLabels={timeLabels}
          TOTAL_H={TOTAL_H}
          byDay={byDay}
          nowTopPx={nowTopPx}
          nowH={nowH}
        />
      ) : (
        <ListeView
          days={days}
          todayStr={todayStr}
          byDay={byDay}
        />
      )}

      {/* ── Modal IA planning ── */}
      {aiModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-surface dark:bg-[#1a1a1a] border border-[var(--elevation-border)] rounded-2xl shadow-2xl w-full max-w-lg">

            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-[var(--elevation-border)]">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-accent/10 flex items-center justify-center">
                  <Sparkles className="w-4 h-4 text-accent" />
                </div>
                <div>
                  <h2 className="font-bold text-primary text-base">Planifier avec l&apos;IA</h2>
                  <p className="text-xs text-secondary">Semaine du {fmtWeekLabel(weekStart)}</p>
                </div>
              </div>
              <button onClick={() => setAiModalOpen(false)} className="text-secondary hover:text-primary transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Phase saisie ou erreur */}
              {(aiStatus === 'idle' || aiStatus === 'error') && (
                <>
                  <p className="text-sm text-secondary">
                    Décrivez votre semaine en langage naturel. L&apos;IA créera les créneaux automatiquement.
                  </p>
                  <div className="bg-base rounded-xl p-3 border border-[var(--elevation-border)] text-xs text-secondary/70 space-y-1">
                    <p className="font-semibold text-secondary">Exemples :</p>
                    <p>• &quot;Chantier Martin lundi 8h-12h, équipe Karim + Ahmed (2 pers)&quot;</p>
                    <p>• &quot;Dupont toute la journée mardi et mercredi, moi seul&quot;</p>
                    <p>• &quot;Visite Excella jeudi après-midi&quot;</p>
                  </div>
                  <textarea
                    value={aiPrompt}
                    onChange={e => setAiPrompt(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && e.metaKey) handleAiGenerate() }}
                    placeholder="Décrivez votre planning de la semaine..."
                    rows={5}
                    className="w-full px-4 py-3 rounded-xl bg-base border border-[var(--elevation-border)] text-primary text-sm resize-none focus:outline-none focus:border-accent"
                    autoFocus
                  />
                  {aiStatus === 'error' && (
                    <p className="text-sm text-red-500 flex items-center gap-2">
                      <X className="w-4 h-4 flex-shrink-0" /> {aiError}
                    </p>
                  )}
                  <button
                    onClick={handleAiGenerate}
                    disabled={!aiPrompt.trim()}
                    className="w-full py-3 rounded-xl bg-accent text-black font-bold text-sm hover:scale-[1.02] transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100"
                  >
                    Générer le planning
                  </button>
                </>
              )}

              {/* Phase chargement */}
              {aiStatus === 'loading' && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <p className="text-sm text-secondary">L&apos;IA analyse votre planning...</p>
                </div>
              )}

              {/* Phase preview */}
              {aiStatus === 'preview' && (
                <>
                  <p className="text-sm text-secondary">{aiSummary}</p>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {aiSlots.map((slot, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-base border border-[var(--elevation-border)]">
                        <div className="w-2 h-2 rounded-full bg-accent mt-1.5 flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-primary truncate">{slot.chantierTitle}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="text-xs text-secondary">
                              {new Date(slot.plannedDate + 'T12:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                            </span>
                            {slot.startTime && (
                              <span className="text-xs text-secondary flex items-center gap-1">
                                <Clock className="w-3 h-3" />{slot.startTime}{slot.endTime ? `–${slot.endTime}` : ''}
                              </span>
                            )}
                            <span className="text-xs text-secondary flex items-center gap-1">
                              <Users className="w-3 h-3" />{slot.teamSize ?? 1}
                            </span>
                          </div>
                          {slot.label && slot.label !== 'Équipe' && (
                            <p className="text-xs text-secondary/70 mt-0.5">{slot.label}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-3 pt-1">
                    <button
                      onClick={() => setAiStatus('idle')}
                      className="flex-1 py-2.5 rounded-xl border border-[var(--elevation-border)] text-secondary text-sm font-semibold hover:text-primary transition-colors"
                    >
                      Modifier
                    </button>
                    <button
                      onClick={handleAiConfirm}
                      className="flex-1 py-2.5 rounded-xl bg-accent text-black text-sm font-bold hover:scale-[1.02] transition-all"
                    >
                      Confirmer ({aiSlots.length} créneau{aiSlots.length > 1 ? 'x' : ''})
                    </button>
                  </div>
                </>
              )}

              {/* Phase saving */}
              {aiStatus === 'saving' && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <Loader2 className="w-8 h-8 text-accent animate-spin" />
                  <p className="text-sm text-secondary">Enregistrement en cours...</p>
                </div>
              )}

              {/* Phase done */}
              {aiStatus === 'done' && (
                <div className="flex flex-col items-center gap-4 py-8">
                  <div className="w-12 h-12 rounded-full bg-green-500/10 flex items-center justify-center">
                    <Check className="w-6 h-6 text-green-500" />
                  </div>
                  <p className="text-sm text-secondary">Planning créé avec succès !</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Sous-composant : Carte stat ──────────────────────────────────────────────

function StatCard({
  label,
  value,
  suffix,
}: {
  label: string
  value: number
  suffix?: string
}) {
  return (
    <div className="card p-4 space-y-1">
      <p className="text-xs text-secondary font-medium">{label}</p>
      <p className="text-2xl font-extrabold text-primary leading-tight">
        {value}
        {suffix && <span className="text-sm font-normal text-secondary ml-1">{suffix}</span>}
      </p>
    </div>
  )
}

// ─── Sous-composant : Vue semaine ─────────────────────────────────────────────

interface SemaineViewProps {
  days: Date[]
  dayNames: string[]
  todayStr: string
  timeLabels: string[]
  TOTAL_H: number
  byDay: Record<string, GlobalPlanning[]>
  nowTopPx: number
  nowH: number
}

function SemaineView({
  days,
  dayNames,
  todayStr,
  timeLabels,
  TOTAL_H,
  byDay,
  nowTopPx,
  nowH,
}: SemaineViewProps) {
  return (
    <div className="card overflow-hidden">
      {/* En-tête jours */}
      <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-[var(--elevation-border)]">
        <div className="border-r border-[var(--elevation-border)]" />
        {days.map((day, i) => {
          const dateStr = getLocalDateStr(day)
          const isToday = dateStr === todayStr
          return (
            <div
              key={dateStr}
              className={`p-2 text-center border-r border-[var(--elevation-border)] last:border-r-0 ${
                isToday ? 'bg-accent/5' : ''
              }`}
            >
              <p className="text-[10px] font-semibold text-secondary uppercase tracking-wide">
                {dayNames[i]}
              </p>
              <p
                className={`text-sm font-bold mt-0.5 w-7 h-7 flex items-center justify-center rounded-full mx-auto ${
                  isToday
                    ? 'bg-accent text-white'
                    : 'text-primary'
                }`}
              >
                {day.getDate()}
              </p>
            </div>
          )
        })}
      </div>

      {/* Grille horaire */}
      <div className="overflow-y-auto max-h-[680px]">
        <div className="grid grid-cols-[56px_repeat(7,1fr)]">
          {/* Colonne heures */}
          <div className="border-r border-[var(--elevation-border)]" style={{ height: TOTAL_H }}>
            {timeLabels.map(t => (
              <div
                key={t}
                className="flex items-start justify-end pr-2 pt-0.5"
                style={{ height: ROW_H }}
              >
                <span className="text-[10px] text-secondary/70 font-medium">{t}</span>
              </div>
            ))}
          </div>

          {/* Colonnes jours */}
          {days.map(day => {
            const dateStr = getLocalDateStr(day)
            const isToday = dateStr === todayStr
            const dayPlannings = byDay[dateStr] ?? []
            const withTime = dayPlannings.filter(p => p.start_time)
            const withoutTime = dayPlannings.filter(p => !p.start_time)

            return (
              <div
                key={dateStr}
                className={`relative border-r border-[var(--elevation-border)] last:border-r-0 ${
                  isToday ? 'bg-accent/[0.03]' : ''
                }`}
                style={{ height: TOTAL_H }}
              >
                {/* Lignes horaires */}
                {timeLabels.map((_, idx) => (
                  <div
                    key={idx}
                    className="absolute left-0 right-0 border-t border-[var(--elevation-border)]/50"
                    style={{ top: idx * ROW_H }}
                  />
                ))}

                {/* Ligne heure actuelle */}
                {isToday && nowH >= CAL_START_H && nowH <= CAL_END_H && (
                  <div
                    className="absolute left-0 right-0 z-20 flex items-center"
                    style={{ top: nowTopPx }}
                  >
                    <div className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0 -ml-1" />
                    <div className="flex-1 h-px bg-red-500" />
                  </div>
                )}

                {/* Créneaux avec heure */}
                {withTime.map(p => {
                  const [h, m] = p.start_time!.split(':').map(Number)
                  const startH = h + m / 60
                  const topPx = Math.max(0, (startH - CAL_START_H) * ROW_H)
                  const endH = p.end_time
                    ? (() => {
                        const [eh, em] = p.end_time!.split(':').map(Number)
                        return eh + em / 60
                      })()
                    : startH + 2
                  const heightPx = Math.max((endH - startH) * ROW_H, 36)
                  const col = CHANTIER_COLORS[p.chantier_color_idx]

                  return (
                    <div
                      key={p.id}
                      style={{ top: topPx, height: heightPx }}
                      className={`absolute left-0.5 right-0.5 rounded-lg border px-1.5 py-1 overflow-hidden z-10 ${col.bg} ${col.border}`}
                    >
                      {/* Plage horaire */}
                      <p className={`text-[9px] font-semibold leading-tight ${col.text} opacity-90`}>
                        {fmtTime(p.start_time!)}{p.end_time ? ` à ${fmtTime(p.end_time)}` : ''}
                      </p>
                      {/* Titre chantier */}
                      <p className={`text-[10px] font-bold leading-tight truncate mt-0.5 ${col.text}`}>
                        {p.chantier_title}
                      </p>
                      <p className={`text-[10px] leading-tight truncate ${col.text} opacity-80`}>
                        {p.label}
                      </p>
                      {heightPx > 44 && (
                        <div className={`text-[9px] leading-tight ${col.text} flex flex-col mt-0.5 overflow-hidden gap-0.5`}>
                          {/* Durée calculée */}
                          {p.end_time && (
                            <p className="font-bold opacity-90">{fmtHours(endH - startH)}</p>
                          )}
                          <p className="opacity-70 flex items-center gap-0.5">
                            <Users className="w-2.5 h-2.5" />
                            {p.team_size} pers.
                          </p>
                          {p.notes && (
                            <p className="opacity-80 mt-0.5 whitespace-pre-wrap break-words overflow-y-auto">{p.notes}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}

                {/* Créneaux sans heure — bandeaux en bas */}
                {withoutTime.length > 0 && (
                  <div className="absolute bottom-1 left-0.5 right-0.5 flex flex-col gap-0.5">
                    {withoutTime.map(p => {
                      const col = CHANTIER_COLORS[p.chantier_color_idx]
                      return (
                        <div
                          key={p.id}
                          className={`rounded px-1.5 py-0.5 border ${col.bg} ${col.border} flex items-center gap-1`}
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                            style={{ backgroundColor: col.hex }}
                          />
                          <p className={`text-[9px] font-semibold truncate ${col.text}`}>
                            {p.chantier_title}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ─── Sous-composant : Vue liste ───────────────────────────────────────────────

interface ListeViewProps {
  days: Date[]
  todayStr: string
  byDay: Record<string, GlobalPlanning[]>
}

function ListeView({ days, todayStr, byDay }: ListeViewProps) {
  const daysWithPlannings = days.filter(d => {
    const dateStr = getLocalDateStr(d)
    return (byDay[dateStr]?.length ?? 0) > 0
  })

  if (daysWithPlannings.length === 0) {
    return (
      <div className="card p-12 flex flex-col items-center justify-center gap-4 text-center">
        <Calendar className="w-12 h-12 text-secondary/40" />
        <p className="text-secondary font-medium">Aucun créneau planifié cette semaine</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {daysWithPlannings.map(day => {
        const dateStr = getLocalDateStr(day)
        const isToday = dateStr === todayStr
        const dayPlannings = [...(byDay[dateStr] ?? [])].sort((a, b) => {
          if (a.start_time && b.start_time) return a.start_time.localeCompare(b.start_time)
          if (a.start_time) return -1
          if (b.start_time) return 1
          return a.label.localeCompare(b.label)
        })

        return (
          <div key={dateStr}>
            <h3 className="text-sm font-bold text-primary mb-2 flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${isToday ? 'bg-accent' : 'bg-secondary/40'}`}
              />
              {day.toLocaleDateString('fr-FR', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
              <span className="text-xs font-normal text-secondary">
                ({dayPlannings.length} créneau{dayPlannings.length > 1 ? 'x' : ''})
              </span>
            </h3>
            <div className="space-y-2 mb-6">
              {dayPlannings.map(p => {
                const col = CHANTIER_COLORS[p.chantier_color_idx]
                return (
                  <div
                    key={p.id}
                    className="card p-3 border-l-4 flex flex-col"
                    style={{ borderLeftColor: col.hex }}
                  >
                    <div className="flex items-center gap-4">
                    {/* Heure */}
                    <div className="text-center w-20 flex-shrink-0">
                      {p.start_time ? (
                        <>
                          <p className="text-sm font-bold text-primary leading-tight">
                            {fmtTime(p.start_time)}{p.end_time ? ` à ${fmtTime(p.end_time)}` : ''}
                          </p>
                          {p.end_time && (() => {
                            const [sh, sm] = p.start_time.split(':').map(Number)
                            const [eh, em] = p.end_time.split(':').map(Number)
                            const dur = (eh + em / 60) - (sh + sm / 60)
                            return dur > 0 ? (
                              <p className="text-xs text-secondary font-semibold mt-0.5">{fmtHours(dur)}</p>
                            ) : null
                          })()}
                        </>
                      ) : (
                        <p className="text-xs text-secondary italic">Sans heure</p>
                      )}
                    </div>

                    {/* Séparateur */}
                    <div className="w-px h-10 bg-[var(--elevation-border)] flex-shrink-0" />

                    {/* Infos chantier */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-primary truncate">
                        {p.chantier_title}
                      </p>
                      <p className="text-xs text-secondary truncate">{p.label}</p>
                    </div>

                    {/* Méta */}
                    <div className="flex items-center gap-3 flex-shrink-0 text-xs text-secondary">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" />
                        {p.team_size}
                      </span>
                      {p.chantier_city && (
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" />
                          {p.chantier_city}
                        </span>
                      )}
                    </div>
                    </div>
                    {p.notes && (
                      <div className="mt-2 text-xs italic bg-[var(--elevation-1)] border border-[var(--elevation-border)] p-2 rounded-lg text-secondary whitespace-pre-wrap w-full">
                        {p.notes}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
