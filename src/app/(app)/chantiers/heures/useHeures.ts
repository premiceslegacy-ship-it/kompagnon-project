'use client'
// @atelier-migrated
// Heures pointées : période, filtres et regroupements. L'affichage vit dans HeuresGlobalesClient.tsx.

import { useMemo, useState } from 'react'
import type { GlobalPointage, MissingPointageSlot } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'
import { MONTH_NAMES, filterPointages, getPersonKey, getWeekStart, groupByChantier, groupByPerson, periodRange, toLocalDateStr, type Period } from './heuresModel'

export type HeuresProps = {
  initialPointages: GlobalPointage[]
  individualMembers?: IndividualMember[]
  chantiers?: { id: string; title: string }[]
  canManage?: boolean
  missingSlots?: MissingPointageSlot[]
}

export function useHeures({ initialPointages }: HeuresProps) {
  const today = new Date()
  const [period, setPeriod] = useState<Period>('week')
  const [weekStart, setWeekStart] = useState(() => getWeekStart(today))
  const [monthIdx, setMonthIdx] = useState(() => today.getMonth())
  const [monthYear, setMonthYear] = useState(() => today.getFullYear())
  const [customFrom, setCustomFrom] = useState(toLocalDateStr(getWeekStart(today)))
  const [customTo, setCustomTo] = useState(toLocalDateStr(today))
  const [chantierId, setChantierId] = useState('')
  const [userKey, setUserKey] = useState('')

  const currentYear = today.getFullYear()
  const minMonthYear = currentYear - 1
  const isAtMinMonth = monthYear === minMonthYear && monthIdx === 0
  const isAtCurrentMonth = monthYear === currentYear && monthIdx === today.getMonth()

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

  const { fromStr, toStr } = useMemo(() => periodRange(period, weekStart, monthIdx, monthYear, customFrom, customTo), [period, weekStart, monthIdx, monthYear, customFrom, customTo])
  const filtered = useMemo(() => filterPointages(initialPointages, fromStr, toStr, chantierId, userKey), [initialPointages, fromStr, toStr, chantierId, userKey])
  const byPerson = useMemo(() => groupByPerson(filtered), [filtered])
  const byChantier = useMemo(() => groupByChantier(filtered), [filtered])
  const totalHours = filtered.reduce((s, p) => s + p.hours, 0)

  const periodLabel = period === 'week'
    ? `Semaine du ${weekStart.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`
    : period === 'month'
      ? new Date(monthYear, monthIdx, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })
      : `${customFrom} → ${customTo}`

  const step = (delta: 1 | -1) => {
    if (period === 'week') {
      const d = new Date(weekStart)
      d.setDate(d.getDate() + 7 * delta)
      setWeekStart(d)
    } else if (period === 'month') {
      if (delta === -1 && isAtMinMonth) return
      if (delta === 1 && isAtCurrentMonth) return
      let m = monthIdx + delta
      let y = monthYear
      if (m < 0) { m = 11; y-- }
      if (m > 11) { m = 0; y++ }
      setMonthIdx(m)
      setMonthYear(y)
    }
  }
  const goCurrent = () => { setWeekStart(getWeekStart(today)); setMonthIdx(today.getMonth()); setMonthYear(today.getFullYear()) }
  const atCurrent = period === 'week' ? toLocalDateStr(weekStart) === toLocalDateStr(getWeekStart(today)) : isAtCurrentMonth

  return {
    period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, chantierId, setChantierId, userKey, setUserKey,
    chantiersFilter, users, filtered, byPerson, byChantier, totalHours, periodLabel, step, goCurrent, atCurrent,
    stepDisabled: (delta: 1 | -1) => period === 'month' && (delta === -1 ? isAtMinMonth : isAtCurrentMonth),
    monthNames: MONTH_NAMES,
  }
}

export type HeuresState = ReturnType<typeof useHeures>
