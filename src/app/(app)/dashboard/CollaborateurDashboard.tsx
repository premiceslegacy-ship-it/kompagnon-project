import React from 'react'
import Link from 'next/link'
import {
  CheckCircle2, Clock, AlertTriangle, CalendarDays,
  HardHat, Target, TrendingUp, MapPin,
} from 'lucide-react'
import type { CollaborateurDashboard } from '@/lib/data/queries/dashboard-collaborateur'
import type { MemberGoalWithProgress } from '@/lib/data/queries/member-goals'

const cardCls = "rounded-3xl p-6 card transition-all duration-300 ease-out"

function fmtTime(t: string | null): string {
  if (!t) return ''
  return t.slice(0, 5)
}

function fmtDate(d: string | null): string {
  if (!d) return ''
  return new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })
}

function ProgressBar({ percent }: { percent: number }) {
  const w = Math.min(100, Math.max(0, percent))
  return (
    <div className="h-2 bg-black/5 dark:bg-white/10 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${
          w >= 100 ? 'bg-accent-green' : w >= 60 ? 'bg-accent' : 'bg-blue-500'
        }`}
        style={{ width: `${w}%` }}
      />
    </div>
  )
}

function GoalCard({ goal }: { goal: MemberGoalWithProgress }) {
  const label = goal.label ?? goal.metric
  const unit = goal.unit ?? ''
  const currentFmt = Number.isInteger(goal.current) ? goal.current : goal.current.toFixed(1)
  const targetFmt = Number.isInteger(goal.target) ? goal.target : goal.target.toFixed(1)

  return (
    <div className="flex flex-col gap-2 p-4 rounded-2xl bg-black/3 dark:bg-white/5 border border-black/5 dark:border-white/10">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-primary">{label}</p>
        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
          goal.percent >= 100
            ? 'bg-green-100 dark:bg-green-500/15 text-green-700 dark:text-green-400'
            : 'bg-accent/10 text-accent'
        }`}>
          {goal.percent}%
        </span>
      </div>
      <ProgressBar percent={goal.percent} />
      <p className="text-xs text-secondary">
        {currentFmt}{unit} / {targetFmt}{unit}
      </p>
    </div>
  )
}

type Props = {
  data: CollaborateurDashboard
  goals: MemberGoalWithProgress[]
  firstName: string | null
}

export default function CollaborateurDashboard({ data, goals, firstName }: Props) {
  const { tasks, todayPlanning, weekPointage } = data

  const overdueTasks = tasks.filter(t => t.is_overdue)
  const activeTasks = tasks.filter(t => !t.is_overdue && t.status !== 'termine')

  return (
    <div className="space-y-6 md:space-y-8">

      {/* KPI perso */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className={`${cardCls} flex flex-col justify-between`}>
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold text-secondary tracking-wider uppercase">Tâches en cours</p>
            <CheckCircle2 className="w-4 h-4 text-accent" />
          </div>
          <p className="text-3xl font-bold text-primary tabular-nums mt-4">
            {activeTasks.length > 0 ? activeTasks.length : '-'}
          </p>
          {overdueTasks.length > 0 && (
            <p className="text-xs font-semibold text-red-500 mt-2">
              {overdueTasks.length} en retard
            </p>
          )}
        </div>

        <div className={`${cardCls} flex flex-col justify-between`}>
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold text-secondary tracking-wider uppercase">Chantiers semaine</p>
            <HardHat className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-3xl font-bold text-primary tabular-nums mt-4">
            {weekPointage.days_worked > 0 ? weekPointage.days_worked : '-'}
          </p>
          <p className="text-xs text-secondary mt-2">
            {weekPointage.days_worked > 0 ? `jour${weekPointage.days_worked > 1 ? 's' : ''} de présence` : 'Aucun pointage cette semaine'}
          </p>
        </div>

        <div className={`${cardCls} flex flex-col justify-between`}>
          <div className="flex justify-between items-start">
            <p className="text-xs font-semibold text-secondary tracking-wider uppercase">Heures cette semaine</p>
            <Clock className="w-4 h-4 text-blue-500" />
          </div>
          <p className="text-3xl font-bold text-primary tabular-nums mt-4">
            {weekPointage.total_hours > 0 ? `${weekPointage.total_hours}h` : '-'}
          </p>
          <p className="text-xs text-secondary mt-2">pointées sur chantier</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 lg:grid-cols-12 gap-6 md:gap-8">

        {/* Colonne principale : planning du jour + tâches */}
        <div className="md:col-span-3 lg:col-span-8 space-y-6">

          {/* Planning du jour */}
          <div className={`${cardCls} p-8`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-bold text-primary flex items-center gap-2">
                <CalendarDays className="w-5 h-5 text-accent" />
                Mon planning aujourd'hui
              </h3>
              <Link
                href="/chantiers/planning"
                className="text-xs font-semibold text-accent hover:underline"
              >
                Planning complet
              </Link>
            </div>

            {todayPlanning.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <CalendarDays className="w-8 h-8 text-secondary opacity-20" />
                <p className="text-sm text-secondary">Rien de planifie pour vous aujourd'hui.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {todayPlanning.map(slot => (
                  <div
                    key={slot.id}
                    className="flex items-start gap-4 p-4 rounded-2xl bg-accent/5 border border-accent/15"
                  >
                    <div className="flex-shrink-0 text-center min-w-[48px]">
                      {slot.start_time ? (
                        <>
                          <p className="text-sm font-bold text-primary">{fmtTime(slot.start_time)}</p>
                          {slot.end_time && (
                            <p className="text-xs text-secondary">{fmtTime(slot.end_time)}</p>
                          )}
                        </>
                      ) : (
                        <p className="text-xs text-secondary">Journée</p>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-primary truncate">{slot.chantier_title}</p>
                      {slot.chantier_address && (
                        <p className="text-xs text-secondary flex items-center gap-1 mt-0.5">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          {slot.chantier_address}
                        </p>
                      )}
                      {slot.notes && (
                        <p className="text-xs text-secondary mt-1 italic">{slot.notes}</p>
                      )}
                    </div>
                    <Link
                      href={`/chantiers/${slot.chantier_id}`}
                      className="flex-shrink-0 text-xs font-semibold text-accent hover:underline"
                    >
                      Voir
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Mes tâches */}
          <div className={`${cardCls} p-8`}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-xl font-bold text-primary">Mes tâches</h3>
              {overdueTasks.length > 0 && (
                <span className="text-xs font-bold text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-1 rounded-full">
                  {overdueTasks.length} en retard
                </span>
              )}
            </div>

            {tasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <CheckCircle2 className="w-8 h-8 text-secondary opacity-20" />
                <p className="text-sm text-secondary">Aucune tâche assignée.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {[...overdueTasks, ...activeTasks].map(task => (
                  <Link
                    key={task.id}
                    href={`/chantiers/${task.chantier_id}`}
                    className={`flex items-center justify-between p-3 rounded-2xl border transition-colors hover:bg-black/3 dark:hover:bg-white/5 ${
                      task.is_overdue
                        ? 'bg-red-50 dark:bg-red-500/5 border-red-200 dark:border-red-500/20'
                        : task.status === 'en_cours'
                        ? 'bg-accent/5 border-accent/15'
                        : 'bg-black/2 dark:bg-white/3 border-black/5 dark:border-white/10'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {task.is_overdue
                        ? <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                        : task.status === 'en_cours'
                        ? <TrendingUp className="w-4 h-4 text-accent flex-shrink-0" />
                        : <Clock className="w-4 h-4 text-secondary flex-shrink-0" />
                      }
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-primary truncate">{task.title}</p>
                        <p className="text-xs text-secondary truncate">{task.chantier_title}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 ml-3 flex-shrink-0">
                      {task.due_date && (
                        <span className={`text-xs font-medium ${task.is_overdue ? 'text-red-500' : 'text-secondary'}`}>
                          {fmtDate(task.due_date)}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        task.status === 'en_cours'
                          ? 'bg-accent/10 text-accent'
                          : 'bg-black/5 dark:bg-white/10 text-secondary'
                      }`}>
                        {task.status === 'en_cours' ? 'En cours' : 'A faire'}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Colonne droite : objectifs */}
        <div className="md:col-span-2 lg:col-span-4">
          <div className={`${cardCls} p-6`}>
            <h3 className="text-xl font-bold text-primary mb-5 flex items-center gap-2">
              <Target className="w-5 h-5 text-accent" />
              Mes objectifs
            </h3>

            {goals.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                <Target className="w-8 h-8 text-secondary opacity-20" />
                <p className="text-sm text-secondary">Aucun objectif fixé ce mois.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {goals.map(g => <GoalCard key={g.id} goal={g} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
