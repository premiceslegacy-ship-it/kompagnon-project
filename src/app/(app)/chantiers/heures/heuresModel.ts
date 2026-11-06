// Heures pointées : périodes, regroupements par personne et par chantier, rapports PDF. Sans React.
import type { GlobalPointage, MissingPointageSlot } from '@/lib/data/queries/chantiers'
import type { IndividualMember } from '@/lib/data/queries/members'

export type Period = 'week' | 'month' | 'custom'

export const MONTH_NAMES = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

export function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  d.setHours(0, 0, 0, 0)
  return d
}

export function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getPersonKey(p: { user_id: string | null; member_id: string | null }): string {
  return p.user_id ?? `member_${p.member_id ?? 'unknown'}`
}

/** Bornes de la période affichée : semaine, mois ou plage libre. */
export function periodRange(period: Period, weekStart: Date, monthIdx: number, monthYear: number, customFrom: string, customTo: string) {
  if (period === 'week') {
    const end = new Date(weekStart)
    end.setDate(end.getDate() + 6)
    return { fromStr: toLocalDateStr(weekStart), toStr: toLocalDateStr(end) }
  }
  if (period === 'month') {
    const m = monthIdx + 1
    const monthStr = `${monthYear}-${String(m).padStart(2, '0')}`
    return { fromStr: `${monthStr}-01`, toStr: toLocalDateStr(new Date(monthYear, m, 0)) }
  }
  return { fromStr: customFrom, toStr: customTo }
}

export function filterPointages(list: GlobalPointage[], fromStr: string, toStr: string, chantierId: string, userKey: string): GlobalPointage[] {
  return list.filter(p => {
    if (p.date < fromStr || p.date > toStr) return false
    if (chantierId && p.chantier_id !== chantierId) return false
    if (userKey && getPersonKey(p) !== userKey) return false
    return true
  })
}

export type PersonGroup = { key: string; name: string; hours: number; chantierIds: Set<string>; entries: GlobalPointage[] }

export function groupByPerson(list: GlobalPointage[]): PersonGroup[] {
  const map = new Map<string, PersonGroup>()
  for (const p of list) {
    const key = getPersonKey(p)
    const g = map.get(key)
    if (g) { g.hours += p.hours; g.chantierIds.add(p.chantier_id); g.entries.push(p) }
    else map.set(key, { key, name: p.user_name, hours: p.hours, chantierIds: new Set([p.chantier_id]), entries: [p] })
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours)
}

export type ChantierGroup = { id: string; title: string; hours: number; memberKeys: Set<string> }

export function groupByChantier(list: GlobalPointage[]): ChantierGroup[] {
  const map = new Map<string, ChantierGroup>()
  for (const p of list) {
    const key = getPersonKey(p)
    const g = map.get(p.chantier_id)
    if (g) { g.hours += p.hours; g.memberKeys.add(key) }
    else map.set(p.chantier_id, { id: p.chantier_id, title: p.chantier_title, hours: p.hours, memberKeys: new Set([key]) })
  }
  return [...map.values()].sort((a, b) => b.hours - a.hours)
}

/** Heures par défaut d'un créneau à régulariser : durée du créneau, sinon 7 h. */
export function slotDefaultHours(slot: MissingPointageSlot): number {
  if (slot.start_time && slot.end_time) {
    const [sh, sm] = slot.start_time.split(':').map(Number)
    const [eh, em] = slot.end_time.split(':').map(Number)
    const h = (eh * 60 + em - sh * 60 - sm) / 60
    if (h > 0 && h <= 24) return Math.round(h * 100) / 100
  }
  if (slot.duration_min && slot.duration_min > 0) return Math.round((slot.duration_min / 60) * 100) / 100
  return 7
}

export function slotWho(slot: MissingPointageSlot): string {
  return slot.member_name
    ?? (slot.equipe_name ? `Équipe ${slot.equipe_name}` : null)
    ?? (slot.label?.trim() || null)
    ?? (slot.team_size ? `${slot.team_size} personne${slot.team_size > 1 ? 's' : ''}` : 'Intervenant non renseigné')
}

export type ReportEntry = { id: string; idType: 'member' | 'user'; fullName: string; roleLabel?: string | null }

/** Personnes ayant pointé, sans doublon entre un compte et son membre lié. */
export function reportEntries(pointages: GlobalPointage[], individualMembers: IndividualMember[]): ReportEntry[] {
  const byUserId = new Map<string, ReportEntry>()
  const memberProfileMap = new Map<string, string | null>()
  for (const p of pointages) {
    if (p.user_id && !byUserId.has(p.user_id)) byUserId.set(p.user_id, { id: p.user_id, idType: 'user', fullName: p.user_name })
    if (p.member_id && !memberProfileMap.has(p.member_id)) memberProfileMap.set(p.member_id, p.member_profile_id ?? null)
  }
  const memberEntries: ReportEntry[] = []
  for (const [memberId, profileId] of memberProfileMap) {
    if (profileId && byUserId.has(profileId)) continue
    const p = pointages.find(pt => pt.member_id === memberId)!
    const info = individualMembers.find(m => m.id === memberId)
    const fullName = info ? ([info.prenom, info.name].filter(Boolean).join(' ') || (info.name ?? p.user_name)) : p.user_name
    memberEntries.push({ id: memberId, idType: 'member', fullName, roleLabel: info?.role_label })
  }
  return [...byUserId.values(), ...memberEntries].sort((a, b) => a.fullName.localeCompare(b.fullName, 'fr'))
}

/** « 2026-11 » → mois ; « 2026 » → année entière. */
export function reportRange(selection: string) {
  if (selection.length === 4) return { from: `${selection}-01-01`, to: `${selection}-12-31` }
  const [y, mo] = selection.split('-').map(Number)
  // Date locale : toISOString() décalerait d'un jour en arrière à Paris (minuit local = 23 h UTC la veille).
  return { from: `${selection}-01`, to: toLocalDateStr(new Date(y, mo, 0)) }
}

export function reportOptions(thisYear: number, minYear: number) {
  const opts: { value: string; label: string }[] = []
  for (let y = thisYear; y >= minYear; y--) {
    opts.push({ value: String(y), label: `Année ${y}` })
    for (let mo = 12; mo >= 1; mo--) {
      opts.push({ value: `${y}-${String(mo).padStart(2, '0')}`, label: new Date(y, mo - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }) })
    }
  }
  return opts
}
