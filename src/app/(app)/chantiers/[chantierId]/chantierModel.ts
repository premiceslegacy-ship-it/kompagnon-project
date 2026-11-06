// @atelier-migrated
// Fiche chantier : types, constantes et calculs purs. Aucun état React ici.
import type { TacheStatus } from '@/lib/data/queries/chantiers'

export type Tab = 'taches' | 'jalons' | 'planning' | 'pointages' | 'photos' | 'notes' | 'equipes' | 'rentabilite' | 'reception'
export type BillingPeriod = 'none' | 'mensuelle' | 'bimestrielle' | 'trimestrielle' | 'annuelle'

export type ChantierPermissions = {
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

export const STATUS_CYCLE: Record<TacheStatus, TacheStatus> = {
  a_faire: 'en_cours',
  en_cours: 'termine',
  termine: 'a_faire',
}



// ─── Constants ────────────────────────────────────────────────────────────────

export const RECURRENCE_LABELS: Record<string, string> = {
  quotidien:         'Tous les jours',
  plurihebdomadaire: 'fois/semaine',
  hebdomadaire:      'Toutes les semaines',
  mensuel:           'Tous les mois',
  bimensuel:         'Tous les 2 mois',
  trimestriel:       'Tous les trimestres',
}

export const BILLING_PERIOD_OPTIONS = [
  { value: 'none', label: 'Pas de facturation périodique' },
  { value: 'mensuelle', label: 'Mensuelle' },
  { value: 'bimestrielle', label: 'Tous les 2 mois' },
  { value: 'trimestrielle', label: 'Trimestrielle' },
  { value: 'annuelle', label: 'Annuelle' },
] as const

export const MONTH_NAMES = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
]

export function splitDateParts(date: string | null | undefined) {
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

export function buildDateFromParts(year: string, month: string, day: string) {
  const y = Number(year)
  const m = Number(month)
  const d = Number(day)
  const lastDay = new Date(y, m, 0).getDate()
  return `${y}-${String(m).padStart(2, '0')}-${String(Math.min(d, lastDay)).padStart(2, '0')}`
}

export const CAL_START_H = 5
export const CAL_END_H = 23
export const CAL_HOURS = CAL_END_H - CAL_START_H  // 18
export const ROW_H = 52  // px per hour
export const TOTAL_H = CAL_HOURS * ROW_H  // 884px

export const USER_COLORS = [
  { bg: 'bg-indigo-500/20', border: 'border-indigo-400/50', text: 'text-indigo-600 dark:text-indigo-300' },
  { bg: 'bg-blue-500/20',   border: 'border-blue-400/50',   text: 'text-blue-600 dark:text-blue-300' },
  { bg: 'bg-emerald-500/20',border: 'border-emerald-400/50',text: 'text-emerald-600 dark:text-emerald-300' },
  { bg: 'bg-amber-500/20',  border: 'border-amber-400/50',  text: 'text-amber-600 dark:text-amber-300' },
  { bg: 'bg-purple-500/20', border: 'border-purple-400/50', text: 'text-purple-600 dark:text-purple-300' },
  { bg: 'bg-rose-500/20',   border: 'border-rose-400/50',   text: 'text-rose-600 dark:text-rose-300' },
  { bg: 'bg-teal-500/20',   border: 'border-teal-400/50',   text: 'text-teal-600 dark:text-teal-300' },
  { bg: 'bg-orange-500/20', border: 'border-orange-400/50', text: 'text-orange-600 dark:text-orange-300' },
]

export function getUserColorIdx(userId: string | null | undefined): number {
  if (!userId) return 0
  let hash = 0
  for (const ch of userId) hash = (hash * 31 + ch.charCodeAt(0)) & 0xffffffff
  return Math.abs(hash) % USER_COLORS.length
}

export function getPointageKey(p: { user_id: string | null | undefined; member_id?: string | null }): string {
  return p.user_id ?? `member_${p.member_id ?? 'unknown'}`
}

export function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1 - day)
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function getLocalDateStr(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function dateFromYmd(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0)
}

export function fmtWeekLabel(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }
  return `${monday.toLocaleDateString('fr-FR', opts)} - ${sunday.toLocaleDateString('fr-FR', { ...opts, year: 'numeric' })}`
}

// ─── Sortable Task Item ───────────────────────────────────────────────────────


export type Segment = 'travaux' | 'equipe' | 'argent' | 'photos'

/** Segments de la fiche, selon les droits : rien de ce qui était masqué ne devient visible. */
export function visibleSegments(p: ChantierPermissions): { value: Segment; label: string }[] {
  const out: { value: Segment; label: string }[] = [{ value: 'travaux', label: 'Travaux' }]
  if (p.canEditChantier || p.canManageTeam || p.canPointage || p.canManagePointages) out.push({ value: 'equipe', label: 'Équipe' })
  if (p.canViewExpenses || p.canCreateExpenses || p.canEditChantier) {
    out.push({ value: 'argent', label: p.canViewExpenses || p.canEditChantier ? 'Argent' : 'Mes dépenses' })
  }
  if (p.canEditChantier) out.push({ value: 'photos', label: 'Photos' })
  return out
}
