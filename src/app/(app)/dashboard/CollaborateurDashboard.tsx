'use client'
// @atelier-migrated

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, Loader2, Play } from 'lucide-react'
import type { CollaborateurDashboard, MyTask } from '@/lib/data/queries/dashboard-collaborateur'
import type { MemberGoalWithProgress } from '@/lib/data/queries/member-goals'
import { updateMyAssignedTaskStatus } from '@/lib/data/mutations/chantiers'
import { StatusPill } from '@/components/ui/StatusPill'
import styles from './Today.module.css'

const NB = ' '
const fmtTime = (t: string | null) => (t ? t.slice(0, 5) : '')
const fmtDate = (d: string | null) =>
  d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : ''
const num = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1).replace('.', ','))

type Props = {
  data: CollaborateurDashboard
  goals: MemberGoalWithProgress[]
  firstName: string | null
}

export default function CollaborateurDashboard({ data, goals }: Props) {
  const router = useRouter()
  const { todayPlanning, weekPointage } = data
  const [tasks, setTasks] = useState(data.tasks)
  const [taskLoadingId, setTaskLoadingId] = useState<string | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)

  const overdueTasks = tasks.filter(t => t.is_overdue)
  const activeTasks = tasks.filter(t => !t.is_overdue && t.status !== 'termine')

  const handleTaskStatus = async (task: MyTask, status: 'en_cours' | 'termine') => {
    setTaskError(null)
    setTaskLoadingId(`${task.id}:${status}`)
    if (status === 'termine') setTasks(prev => prev.filter(t => t.id !== task.id))
    else setTasks(prev => prev.map(t => (t.id === task.id ? { ...t, status } : t)))
    const { error } = await updateMyAssignedTaskStatus(task.id, status)
    setTaskLoadingId(null)
    if (error) {
      setTaskError(error)
      setTasks(data.tasks)
      return
    }
    router.refresh()
  }

  const figures = [
    { label: 'Tâches', value: String(activeTasks.length), sub: overdueTasks.length > 0 ? `${overdueTasks.length} en retard` : 'en cours', alert: overdueTasks.length > 0 },
    { label: 'Chantiers', value: String(weekPointage.days_worked), sub: weekPointage.days_worked > 0 ? `jour${weekPointage.days_worked > 1 ? 's' : ''} de présence` : 'aucun pointage cette semaine', alert: false },
    { label: 'Heures', value: `${num(weekPointage.total_hours)}${NB}h`, sub: 'cette semaine', alert: false },
  ]

  return (
    <>
      <div className={styles.duo} style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', marginTop: 14 }}>
        {figures.map(f => (
          <section key={f.label} className={styles.card} aria-label={f.label}>
            <div className={styles.label}><span>{f.label}</span></div>
            <div className={styles.big}>{f.value}</div>
            <div className={`${styles.sub}${f.alert ? ` ${styles.down}` : ''}`}>{f.sub}</div>
          </section>
        ))}
      </div>

      <div className={styles.cols}>
        <div>
          <section className={styles.group} aria-labelledby="collab-planning">
            <h2 className={styles.groupTitle} id="collab-planning">
              Mon planning aujourd&apos;hui
              <Link href="/chantiers/planning" className={styles.link}>Planning complet</Link>
            </h2>
            {todayPlanning.length === 0 ? (
              <div className={styles.empty}>Rien de planifié pour vous aujourd&apos;hui.</div>
            ) : (
              <ul className={styles.list}>
                {todayPlanning.map(slot => (
                  <li key={slot.id}>
                    <Link href={`/chantiers/${slot.chantier_id}`} className={styles.row}>
                      <span className={styles.slotTime} style={{ width: 44, paddingTop: 0 }}>
                        {slot.start_time ? fmtTime(slot.start_time) : 'Jour'}
                      </span>
                      <span className={styles.mid}>
                        <span className={styles.rowTitle}>{slot.chantier_title}</span>
                        <span className={styles.rowSub}>
                          {[slot.end_time ? `Jusqu'à ${fmtTime(slot.end_time)}` : null, slot.chantier_address, slot.notes].filter(Boolean).join(' · ') || 'Voir le chantier'}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.group} aria-labelledby="collab-tasks">
            <h2 className={styles.groupTitle} id="collab-tasks">Mes tâches</h2>
            {tasks.length === 0 || overdueTasks.length + activeTasks.length === 0 ? (
              <div className={styles.empty}>Aucune tâche assignée.</div>
            ) : (
              <ul className={styles.list}>
                {[...overdueTasks, ...activeTasks].map(task => (
                  <li key={task.id}>
                    <div className={styles.row} data-static="true">
                      <Link href={`/chantiers/${task.chantier_id}`} className={styles.mid} style={{ color: 'inherit', textDecoration: 'none' }}>
                        <span className={styles.rowTitle}>{task.title}</span>
                        <span className={styles.rowSub}>
                          {[task.chantier_title, task.due_date ? `pour le ${fmtDate(task.due_date)}` : null].filter(Boolean).join(' · ')}
                        </span>
                      </Link>
                      <StatusPill status={task.is_overdue ? 'danger' : task.status === 'en_cours' ? 'wait' : 'neutral'}>
                        {task.is_overdue ? 'En retard' : task.status === 'en_cours' ? 'En cours' : 'À faire'}
                      </StatusPill>
                      {task.status === 'a_faire' ? (
                        <button
                          type="button"
                          className={styles.round}
                          onClick={() => handleTaskStatus(task, 'en_cours')}
                          disabled={!!taskLoadingId}
                          aria-label={`Commencer : ${task.title}`}
                        >
                          {taskLoadingId === `${task.id}:en_cours` ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={styles.round}
                        onClick={() => handleTaskStatus(task, 'termine')}
                        disabled={!!taskLoadingId}
                        aria-label={`Terminer : ${task.title}`}
                      >
                        {taskLoadingId === `${task.id}:termine` ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Check size={16} aria-hidden="true" />}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {taskError ? <p className={styles.error} role="alert">{taskError}</p> : null}
          </section>
        </div>

        <div>
          <section className={styles.group} aria-labelledby="collab-goals">
            <h2 className={styles.groupTitle} id="collab-goals">Mes objectifs</h2>
            {goals.length === 0 ? (
              <div className={styles.empty}>Aucun objectif fixé ce mois.</div>
            ) : (
              <ul className={styles.list}>
                {goals.map(goal => {
                  const unit = goal.unit ? `${NB}${goal.unit}` : ''
                  const pct = Math.min(100, Math.max(0, goal.percent))
                  return (
                    <li key={goal.id}>
                      <div className={styles.row} data-static="true">
                        <span className={styles.mid}>
                          <span className={styles.rowTitle}>{goal.label ?? goal.metric}</span>
                          <span className={styles.progress} aria-hidden="true"><i style={{ width: `${pct}%` }} /></span>
                        </span>
                        <span className={styles.amount}>{num(goal.current)} / {num(goal.target)}{unit}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {goals.length > 0 ? <p className={styles.note}>Fixés par votre responsable.</p> : null}
          </section>
        </div>
      </div>
    </>
  )
}
