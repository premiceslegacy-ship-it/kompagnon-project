// @atelier-migrated
// Tournée : durées, heures et noms. Sans React.
import type { IndividualMember } from '@/lib/data/queries/members'

export function fmtMin(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h === 0) return `${m}min`
  if (m === 0) return `${h}h`
  return `${h}h${String(m).padStart(2, '0')}`
}

export function addMinutesToTime(time: string | null, minutes: number): string {
  const [h, m] = (time ?? '08:00').split(':').map(Number)
  const total = h * 60 + m + minutes
  const hh = Math.floor(total / 60) % 24
  const mm = total % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function durationFromTimes(start: string | null, end: string | null, fallback = 60): number {
  if (!start || !end) return fallback
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const diff = eh * 60 + em - (sh * 60 + sm)
  return diff > 0 ? diff : fallback
}

export function fmtDateLabel(date: Date): string {
  return date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function getLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export type AssignableMember = Pick<IndividualMember, 'id' | 'prenom' | 'name' | 'email' | 'role_label'>

export function memberFullName(member: AssignableMember): string {
  return [member.prenom, member.name].filter(Boolean).join(' ') || member.name
}

export type TourneeMember = {
  id: string
  fullName: string
  roleLabel?: string | null
  email?: string | null
}

/** Heure de fin estimée d'une tournée : départ + durée sur site + trajets. */
export function routeEnd(start: string | null, siteMin: number, travelMin: number): string | null {
  return start ? addMinutesToTime(start, siteMin + travelMin) : null
}
