'use client'

import React, { useState, useMemo } from 'react'
import Link from 'next/link'
import { ArrowLeft, Clock, Users, Calendar, Filter } from 'lucide-react'
import type { GlobalPointage } from '@/lib/data/queries/chantiers'

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

function getUserColor(userId: string): string {
  let h = 0
  for (const c of userId) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff
  return USER_COLORS[Math.abs(h) % USER_COLORS.length]
}

function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

type Period = 'week' | 'month' | 'custom'

export default function HeuresGlobalesClient({ initialPointages }: { initialPointages: GlobalPointage[] }) {
  const today = new Date()
  const [period, setPeriod] = useState<Period>('week')
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today))
  const [selectedMonth, setSelectedMonth] = useState(() => today.toISOString().slice(0, 7))
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(getWeekStart(today)))
  const [customTo, setCustomTo] = useState(toLocalDateStr(today))
  const [selectedChantier, setSelectedChantier] = useState('')
  const [selectedUser, setSelectedUser] = useState('')

  const chantiers = useMemo(() => {
    const map = new Map<string, string>()
    initialPointages.forEach(p => map.set(p.chantier_id, p.chantier_title))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [initialPointages])

  const users = useMemo(() => {
    const map = new Map<string, string>()
    initialPointages.forEach(p => map.set(p.user_id, p.user_name))
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]))
  }, [initialPointages])

  const { fromStr, toStr } = useMemo(() => {
    if (period === 'week') {
      const end = new Date(weekStart)
      end.setDate(end.getDate() + 6)
      return { fromStr: toLocalDateStr(weekStart), toStr: toLocalDateStr(end) }
    }
    if (period === 'month') {
      const [y, m] = selectedMonth.split('-').map(Number)
      const last = new Date(y, m, 0)
      return { fromStr: `${selectedMonth}-01`, toStr: toLocalDateStr(last) }
    }
    return { fromStr: customFrom, toStr: customTo }
  }, [period, weekStart, selectedMonth, customFrom, customTo])

  const filtered = useMemo(() => {
    return initialPointages.filter(p => {
      if (p.date < fromStr || p.date > toStr) return false
      if (selectedChantier && p.chantier_id !== selectedChantier) return false
      if (selectedUser && p.user_id !== selectedUser) return false
      return true
    })
  }, [initialPointages, fromStr, toStr, selectedChantier, selectedUser])

  // Totaux par personne
  const byUser = useMemo(() => {
    const map = new Map<string, { name: string; hours: number; chantiers: Set<string> }>()
    filtered.forEach(p => {
      const existing = map.get(p.user_id)
      if (existing) {
        existing.hours += p.hours
        existing.chantiers.add(p.chantier_id)
      } else {
        map.set(p.user_id, { name: p.user_name, hours: p.hours, chantiers: new Set([p.chantier_id]) })
      }
    })
    return [...map.entries()]
      .map(([uid, v]) => ({ uid, ...v, chantierCount: v.chantiers.size }))
      .sort((a, b) => b.hours - a.hours)
  }, [filtered])

  // Totaux par chantier
  const byChantier = useMemo(() => {
    const map = new Map<string, { title: string; hours: number; members: Set<string> }>()
    filtered.forEach(p => {
      const existing = map.get(p.chantier_id)
      if (existing) {
        existing.hours += p.hours
        existing.members.add(p.user_id)
      } else {
        map.set(p.chantier_id, { title: p.chantier_title, hours: p.hours, members: new Set([p.user_id]) })
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
    ? new Date(selectedMonth + '-01').toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
    : `${customFrom} → ${customTo}`

  return (
    <div className="p-8 space-y-6 max-w-6xl mx-auto">
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
        {/* Période */}
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
          <input
            type="month"
            className="input w-48"
            value={selectedMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          />
        )}

        {period === 'custom' && (
          <div className="flex items-center gap-3 flex-wrap">
            <input type="date" className="input" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            <span className="text-secondary">→</span>
            <input type="date" className="input" value={customTo} onChange={e => setCustomTo(e.target.value)} />
          </div>
        )}

        {/* Filtres chantier / personne */}
        <div className="flex flex-wrap gap-3">
          <select className="input text-sm" value={selectedChantier} onChange={e => setSelectedChantier(e.target.value)}>
            <option value="">Tous les chantiers</option>
            {chantiers.map(([cid, title]) => <option key={cid} value={cid}>{title}</option>)}
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

      {/* Détail ligne par ligne */}
      {filtered.length > 0 && (
        <div className="card overflow-hidden">
          <div className="p-4 border-b border-[var(--elevation-border)]">
            <p className="font-bold text-primary text-sm">Détail des pointages</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                  <th className="text-left px-4 py-2 text-xs font-semibold text-secondary uppercase tracking-wider">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-secondary uppercase tracking-wider">Personne</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-secondary uppercase tracking-wider">Chantier</th>
                  <th className="text-left px-4 py-2 text-xs font-semibold text-secondary uppercase tracking-wider">Tâche</th>
                  <th className="text-right px-4 py-2 text-xs font-semibold text-secondary uppercase tracking-wider">Heures</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--elevation-border)]">
                {filtered.map(p => (
                  <tr key={p.id} className="hover:bg-[var(--elevation-1)] transition-colors">
                    <td className="px-4 py-2.5 text-secondary whitespace-nowrap">
                      {new Date(p.date + 'T00:00:00').toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white flex-shrink-0" style={{ backgroundColor: getUserColor(p.user_id) }}>
                          {p.user_name[0]?.toUpperCase() ?? '?'}
                        </div>
                        <span className="font-medium text-primary">{p.user_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <Link href={`/chantiers/${p.chantier_id}`} className="text-primary hover:text-accent transition-colors">
                        {p.chantier_title}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-secondary">{p.tache_title ?? <span className="opacity-40">—</span>}</td>
                    <td className="px-4 py-2.5 text-right font-bold text-primary">{fmtHours(p.hours)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--elevation-border)] bg-[var(--elevation-1)]">
                  <td colSpan={4} className="px-4 py-2.5 text-xs font-semibold text-secondary uppercase tracking-wider">Total</td>
                  <td className="px-4 py-2.5 text-right font-extrabold text-primary">{fmtHours(totalHours)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
