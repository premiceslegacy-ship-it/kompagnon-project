// @atelier-migrated
// Rapports : formats, navigation de période, évolutions, marges, objectifs (outils purs).

import type {
  AnnualObjectives, MaintenanceReport, MonthlyObjectives, TopChantierEntry,
} from '@/lib/data/queries/reporting'

export const MONTH_LABELS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']

export type Vue = 'mois' | 'annee'
export type Period = { vue: Vue; year: number; month: number }

/** 12 345 € (espace ordinaire, signe moins devant). */
export function fmt(n: number): string {
  const parts = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).formatToParts(Math.round(Math.abs(n)))
  return `${n < 0 ? '-' : ''}${parts.map(p => (p.type === 'group' ? ' ' : p.value)).join('')} €`
}

export const fmtPct = (n: number) => `${(n * 100).toFixed(1)} %`

/** Heures décimales → « 7:30 ». */
export function fmtH(n: number): string {
  const h = Math.floor(n)
  const min = Math.round((n - h) * 60)
  return min === 60 ? `${h + 1}:00` : min === 0 ? `${h}:00` : `${h}:${String(min).padStart(2, '0')}`
}

export const periodLabel = (p: Period) => (p.vue === 'mois' ? `${MONTH_LABELS[p.month - 1]} ${p.year}` : `Année ${p.year}`)

/** Libellé court de la barre de période : « Nov. 2026 » ou « 2026 ». */
export const periodShort = (p: Period) => (p.vue === 'mois' ? `${MONTH_LABELS[p.month - 1].slice(0, 3)}. ${p.year}` : String(p.year))

export function previousPeriod(p: Period): Period {
  if (p.vue === 'annee') return { ...p, year: p.year - 1 }
  return p.month === 1 ? { ...p, year: p.year - 1, month: 12 } : { ...p, month: p.month - 1 }
}

export function nextPeriod(p: Period): Period {
  if (p.vue === 'annee') return { ...p, year: p.year + 1 }
  return p.month === 12 ? { ...p, year: p.year + 1, month: 1 } : { ...p, month: p.month + 1 }
}

/** Le mois en cours est consultable ; au-delà, rien à montrer. L'année en cours aussi. */
export function isFuturePeriod(p: Period, now: Date = new Date()): boolean {
  if (p.vue === 'annee') return p.year > now.getFullYear()
  return p.year > now.getFullYear() || (p.year === now.getFullYear() && p.month > now.getMonth() + 1)
}

/** La période suivante est-elle hors de portée (bouton « suivant » désactivé) ? */
export const canGoNext = (p: Period, now: Date = new Date()) => !isFuturePeriod(nextPeriod(p), now)

export function periodParam(p: Period): string {
  return p.vue === 'mois' ? `${p.year}-${String(p.month).padStart(2, '0')}` : String(p.year)
}

export const pdfHref = (p: Period) => `/api/exports/rapport-pdf?vue=${p.vue}&periode=${periodParam(p)}`

/* ── Évolutions ──────────────────────────────────────────────────────── */

export type Delta = { kind: 'none' } | { kind: 'new' } | { kind: 'same' } | { kind: 'up' | 'down'; pct: number }

export function delta(current: number, prev: number): Delta {
  if (prev === 0 && current === 0) return { kind: 'none' }
  if (prev === 0) return { kind: 'new' }
  const pct = Math.round(((current - prev) / prev) * 100)
  if (pct === 0) return { kind: 'same' }
  return { kind: pct > 0 ? 'up' : 'down', pct: Math.abs(pct) }
}

export function deltaText(d: Delta): string | null {
  if (d.kind === 'none') return null
  if (d.kind === 'new') return 'Nouveau'
  if (d.kind === 'same') return 'Stable sur la période précédente'
  return `${d.kind === 'up' ? '+' : '-'}${d.pct} % sur la période précédente`
}

/* ── Marges ──────────────────────────────────────────────────────────── */

export type Tone = 'success' | 'wait' | 'danger'

/** ≥ 20 % bon, ≥ 5 % correct, en dessous à surveiller. */
export const marginTone = (pct: number): Tone => (pct >= 0.2 ? 'success' : pct >= 0.05 ? 'wait' : 'danger')

/** Marge moyenne pondérée par le facturé : un petit chantier ne pèse pas autant qu'un gros. */
export function weightedMargin(chantiers: Pick<TopChantierEntry, 'caHt' | 'marginEur'>[]): number {
  const ca = chantiers.reduce((s, c) => s + c.caHt, 0)
  const eur = chantiers.reduce((s, c) => s + c.marginEur, 0)
  return ca > 0 ? eur / ca : 0
}

export const ratio = (part: number, whole: number) => (whole > 0 ? part / whole : 0)

export function maintenanceFigures(mr: MaintenanceReport) {
  const actualCost = mr.laborCost + mr.partsCost + mr.travelCost + mr.otherCost
  return {
    actualCost,
    actualMarginPct: ratio(mr.marginEur, mr.revenueHt),
    expectedMarginPct: ratio(mr.expectedMarginHt, mr.expectedRevenueHt),
    fieldCost: mr.partsCost + mr.travelCost + mr.otherCost,
  }
}

/** Le bloc entretien n'apparaît que s'il y a quelque chose à montrer. */
export const hasMaintenanceData = (mr: MaintenanceReport | null): mr is MaintenanceReport =>
  !!mr && (mr.interventionsDone > 0 || mr.hoursTotal > 0 || mr.revenueHt > 0 || mr.partsCost > 0 || mr.travelCost > 0 || mr.expectedRevenueHt > 0 || mr.expectedCostHt > 0)

/* ── Objectifs ───────────────────────────────────────────────────────── */

export type StandardKey = 'revenue_ht_target' | 'margin_eur_target' | 'margin_pct_target' | 'chantiers_count_target' | 'new_clients_target' | 'hours_target'

export type StandardOpt = { key: StandardKey; label: string; unit: string; placeholder: string }

export const ANNUAL_STANDARD_OPTS: StandardOpt[] = [
  { key: 'revenue_ht_target', label: 'Facturé', unit: '€', placeholder: '100000' },
  { key: 'margin_eur_target', label: 'Marge (€)', unit: '€', placeholder: '30000' },
  { key: 'margin_pct_target', label: 'Marge (%)', unit: '%', placeholder: '30' },
  { key: 'chantiers_count_target', label: 'Chantiers terminés', unit: '', placeholder: '20' },
  { key: 'new_clients_target', label: 'Nouveaux clients', unit: '', placeholder: '10' },
  { key: 'hours_target', label: 'Heures totales', unit: 'h', placeholder: '2000' },
]

export const MONTHLY_STANDARD_OPTS: StandardOpt[] = [
  { key: 'revenue_ht_target', label: 'Facturé', unit: '€', placeholder: '10000' },
  { key: 'margin_eur_target', label: 'Marge (€)', unit: '€', placeholder: '3000' },
  { key: 'margin_pct_target', label: 'Marge (%)', unit: '%', placeholder: '30' },
  { key: 'chantiers_count_target', label: 'Chantiers terminés', unit: '', placeholder: '2' },
  { key: 'hours_target', label: 'Heures totales', unit: 'h', placeholder: '160' },
]

export type ObjEntry =
  | { kind: 'standard'; key: StandardKey; value: number | null }
  | { kind: 'custom'; id?: string; label: string; target: number; unit: string }

type AnyObjectives = AnnualObjectives | MonthlyObjectives

export function objectivesToEntries(obj: AnyObjectives, opts: StandardOpt[]): ObjEntry[] {
  const entries: ObjEntry[] = []
  for (const opt of opts) {
    const value = (obj as unknown as Record<string, number | null | undefined>)[opt.key]
    if (value != null) entries.push({ kind: 'standard', key: opt.key, value })
  }
  for (const c of obj.customs) entries.push({ kind: 'custom', id: c.id, label: c.label, target: c.target, unit: c.unit })
  return entries
}

/** Remet à zéro les objectifs standard puis réapplique la liste ; les personnalisés prennent leur ordre d'apparition. */
export function entriesToObjectives<T extends AnyObjectives>(entries: ObjEntry[], base: T, opts: StandardOpt[]): T {
  const result = { ...base, customs: [] as T['customs'] } as T & Record<string, unknown>
  for (const opt of opts) result[opt.key] = null
  let order = 0
  for (const e of entries) {
    if (e.kind === 'standard') result[e.key] = e.value
    else result.customs.push({ id: e.id, label: e.label, target: e.target, unit: e.unit, sort_order: order++ })
  }
  return result
}

export const objectivesEmpty = (o: AnyObjectives | null) =>
  !o || (!o.revenue_ht_target && !o.margin_eur_target && !o.margin_pct_target && !o.chantiers_count_target && !o.hours_target && o.customs.length === 0
    && !('new_clients_target' in o && o.new_clients_target))

export const progressPct = (current: number, target: number) => (target > 0 ? Math.min((current / target) * 100, 100) : 0)

export const progressTone = (pct: number): Tone => (pct >= 100 ? 'success' : pct >= 70 ? 'wait' : 'danger')

/** Un objectif standard prêt à être ajouté : le premier de la liste pas encore utilisé. */
export function nextEntry(entries: ObjEntry[], opts: StandardOpt[]): ObjEntry {
  const used = new Set(entries.flatMap(e => (e.kind === 'standard' ? [e.key] : [])))
  const free = opts.find(o => !used.has(o.key))
  return free ? { kind: 'standard', key: free.key, value: null } : { kind: 'custom', label: '', target: 0, unit: '' }
}

export const membersWithoutRateTitle = (n: number) => (n === 1 ? '1 intervenant sans taux horaire' : `${n} intervenants sans taux horaire`)

export type ProgressRow = { key: string; label: string; current: number; target: number; kind: 'money' | 'pct' | 'count' | 'hours' | 'custom'; unit?: string }

export type ProgressInputs = {
  vue: Vue
  objectives: AnyObjectives | null
  billedLabel: string
  caHt: number
  benefice: number
  /** Marge réelle en part du facturé (0,25 pour 25 %). */
  marginRatio: number
  chantiers: number
  newClients: number
  hours: number
}

/** Avancement de chaque objectif défini ; les objectifs personnalisés n'ont pas de mesure : ils restent à 0. */
export function objectiveProgress(i: ProgressInputs): ProgressRow[] {
  const o = i.objectives
  if (!o) return []
  const rows: ProgressRow[] = []
  if (o.revenue_ht_target) rows.push({ key: 'revenue', label: i.billedLabel, current: i.caHt, target: o.revenue_ht_target, kind: 'money' })
  if (o.margin_eur_target) rows.push({ key: 'margin_eur', label: 'Bénéfice estimé (€)', current: i.benefice, target: o.margin_eur_target, kind: 'money' })
  if (o.margin_pct_target) rows.push({ key: 'margin_pct', label: 'Bénéfice estimé (%)', current: i.marginRatio * 100, target: o.margin_pct_target, kind: 'pct' })
  if (o.chantiers_count_target) rows.push({ key: 'chantiers', label: 'Chantiers terminés', current: i.chantiers, target: o.chantiers_count_target, kind: 'count' })
  if (i.vue === 'annee' && 'new_clients_target' in o && o.new_clients_target) rows.push({ key: 'clients', label: 'Nouveaux clients', current: i.newClients, target: o.new_clients_target, kind: 'count' })
  if (o.hours_target) rows.push({ key: 'hours', label: 'Heures travaillées', current: i.hours, target: o.hours_target, kind: 'hours' })
  o.customs.forEach((c, idx) => rows.push({ key: `custom-${idx}`, label: c.label, current: 0, target: c.target, kind: 'custom', unit: c.unit }))
  return rows
}

export function formatProgress(row: ProgressRow, value: number): string {
  if (row.kind === 'money') return fmt(value)
  if (row.kind === 'pct') return `${value.toFixed(1)} %`
  if (row.kind === 'hours') return fmtH(value)
  if (row.kind === 'count') return String(Math.round(value))
  return `${value.toFixed(1)} ${row.unit ?? ''}`.trim()
}
