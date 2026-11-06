// @atelier-migrated
// Planning global : dates, libellés, couleurs de série et filtres. Sans React.
import type { GlobalPlanning } from '@/lib/data/queries/chantiers'
import type { AIPlanningSlot } from '@/lib/data/mutations/planning'

export const EVENT_TYPE_LABELS: Record<string, string> = {
  chantier: 'Chantier',
  rdv_commercial: 'RDV commercial',
  visite_technique: 'Visite technique',
  personnel: 'Personnel',
  autre: 'Autre',
}


// ─── Helpers ─────────────────────────────────────────────────────────────────

export function getMonday(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day))
  d.setHours(0, 0, 0, 0)
  return d
}

export function getLocalDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateFromYmd(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day, 12, 0, 0)
}

export function fmtWeekLabel(monday: Date): string {
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return `${monday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} - ${sunday.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`
}

export function fmtHours(hours: number): string {
  const h = Math.floor(hours)
  const min = Math.round((hours - h) * 60)
  if (min === 0) return `${h}h`
  return `${h}h${String(min).padStart(2, '0')}`
}

export function fmtTime(t: string): string {
  const [h, m] = t.split(':').map(Number)
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

export function sIsChantierSlot(slot: AIPlanningSlot): boolean {
  return slot.source !== 'maintenance' && !slot.maintenanceContractId
}

/** Couleur de série (jeton Atelier) d'un créneau : stable par chantier, grise pour un événement libre. */
export function slotColor(p: Pick<GlobalPlanning, 'chantier_id' | 'chantier_color_idx'>): string {
  return p.chantier_id ? `var(--at-s${(Math.abs(p.chantier_color_idx) % 5) + 1})` : 'var(--at-encre-3)'
}

/** Libellé d'un créneau : chantier, type d'événement ou entretien. */
export function slotWhere(p: GlobalPlanning): string {
  if (p.source === 'maintenance') return `Entretien · ${p.chantier_title}`
  if (p.chantier_id) return p.chantier_title
  return p.title || EVENT_TYPE_LABELS[p.event_type] || 'Événement'
}

export function slotHours(p: Pick<GlobalPlanning, 'start_time' | 'end_time'>): string {
  if (!p.start_time) return 'Journée'
  const s = p.start_time.slice(0, 5).replace(':', 'h')
  return p.end_time ? `${s} – ${p.end_time.slice(0, 5).replace(':', 'h')}` : s
}

/** Durée prévue en heures (0 sans horaires). */
export function slotDuration(p: Pick<GlobalPlanning, 'start_time' | 'end_time'>): number {
  if (!p.start_time || !p.end_time) return 0
  const [sh, sm] = p.start_time.split(':').map(Number)
  const [eh, em] = p.end_time.split(':').map(Number)
  return Math.max(0, eh + em / 60 - (sh + sm / 60))
}

export function filterPlannings(plannings: GlobalPlanning[], chantierId: string, status: string): GlobalPlanning[] {
  return plannings.filter(p => {
    if (chantierId !== 'tous' && p.chantier_id !== chantierId) return false
    if (status !== 'tous' && p.chantier_status !== status) return false
    return true
  })
}

export function groupByDay(plannings: GlobalPlanning[]): Record<string, GlobalPlanning[]> {
  const out: Record<string, GlobalPlanning[]> = {}
  for (const p of plannings) out[p.planned_date] = [...(out[p.planned_date] ?? []), p]
  for (const k of Object.keys(out)) out[k].sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? ''))
  return out
}

/** Chiffres de la semaine : sites actifs, personnes planifiées, jour le plus chargé. */
export function weekStats(plannings: GlobalPlanning[]) {
  const sites = new Set(plannings.map(p => p.chantier_id))
  const totalPersonnes = plannings.reduce((s, p) => s + p.team_size, 0)
  const byDayCount = plannings.reduce<Record<string, number>>((acc, p) => {
    acc[p.planned_date] = (acc[p.planned_date] ?? 0) + p.team_size
    return acc
  }, {})
  const busiest = Object.entries(byDayCount).sort(([, a], [, b]) => b - a)[0]
  return { chantiersActifs: sites.size, totalPersonnes, jourLePlusCharge: busiest }
}
