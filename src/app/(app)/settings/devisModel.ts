// @atelier-migrated
// Réglages Devis : validité, clauses réutilisables et grilles de prix matières (outils purs).

import type { ImportGridRow, MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import type { QuoteClauseTemplate } from '@/lib/data/queries/clause-templates'

/* ── Validité par défaut ─────────────────────────────────────────────── */

export const VALIDITY_MIN = 1
export const VALIDITY_MAX = 365
export const VALIDITY_FALLBACK = 30

export function clampValidity(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value) || value === 0) return VALIDITY_FALLBACK
  return Math.min(VALIDITY_MAX, Math.max(VALIDITY_MIN, Math.round(value)))
}

/* ── Clauses ─────────────────────────────────────────────────────────── */

export const CLAUSE_CATEGORIES = [
  'Validité & prix matière',
  'Délai & planning',
  'Plans & cotes',
  'Tolérances',
  'Finition & sous-traitance',
  'Réception & garanties',
  'Paiement',
  'Général',
] as const

export type ClauseForm = { id?: string; title: string; body: string; category: string; position: number }

export const emptyClauseForm = (position = 0): ClauseForm => ({ title: '', body: '', category: '', position })

export function clauseToForm(clause: QuoteClauseTemplate): ClauseForm {
  return { id: clause.id, title: clause.title, body: clause.body, category: clause.category ?? '', position: clause.position }
}

export const clauseFormValid = (form: ClauseForm) => form.title.trim() !== '' && form.body.trim() !== ''

export function clausePayload(form: ClauseForm) {
  return { ...form, category: form.category.trim() || null }
}

/** Clauses triées par catégorie puis par position (« Général » quand aucune catégorie). */
export function sortClauses(clauses: QuoteClauseTemplate[]): QuoteClauseTemplate[] {
  const cat = (c: QuoteClauseTemplate) => c.category ?? 'Général'
  return [...clauses].sort((a, b) => cat(a).localeCompare(cat(b), 'fr') || a.position - b.position)
}

/** Remplace la clause de même id, sinon l'ajoute à la fin. */
export function upsertClause(list: QuoteClauseTemplate[], clause: QuoteClauseTemplate): QuoteClauseTemplate[] {
  const index = list.findIndex(c => c.id === clause.id)
  if (index < 0) return [...list, clause]
  const next = [...list]
  next[index] = clause
  return next
}

export function clausePreview(body: string, max = 90): string {
  const flat = body.replace(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat
}

/* ── Grilles de prix matières ────────────────────────────────────────── */

export const GRID_UNITS = ['kg', 'm²', 'ml', 'pièce', 'tonne'] as const

export const GRID_CSV_HEADERS = ['Libellé', 'Métal', 'Source', 'Coefficient', 'Prix fixe', 'Unité', 'Nuance', 'Épaisseur (mm)', 'Format']

const METAL_CODE_MAP: Record<string, string> = {
  alu: 'ALU', aluminium: 'ALU', aluminum: 'ALU',
  cuivre: 'XCU', copper: 'XCU', cu: 'XCU',
  zinc: 'ZNC', zn: 'ZNC',
  plomb: 'PB', lead: 'PB', pb: 'PB',
  acier: 'STEEL', steel: 'STEEL', fer: 'STEEL',
  nickel: 'NI', ni: 'NI', inox: 'NI', stainless: 'NI',
}

export function parseGridRows(rows: string[][]): { valid: ImportGridRow[]; errors: string[] } {
  const valid: ImportGridRow[] = []
  const errors: string[] = []
  rows.forEach((row, i) => {
    const line = i + 2
    const label = row[0]?.trim()
    if (!label) return
    const metalRaw = (row[1] ?? '').trim().toLowerCase()
    const metal_code = METAL_CODE_MAP[metalRaw] ?? row[1]?.trim().toUpperCase()
    if (!metal_code) { errors.push(`Ligne ${line} : métal manquant.`); return }
    const sourceRaw = (row[2] ?? '').trim().toLowerCase()
    const source_type: 'lme' | 'manual' = sourceRaw === 'manuel' || sourceRaw === 'manual' || sourceRaw === 'fixe' ? 'manual' : 'lme'
    const coefficient = parseFloat(row[3] ?? '') || undefined
    const manual_price = parseFloat(row[4] ?? '') || undefined
    const unit = row[5]?.trim() || 'kg'
    const grade = row[6]?.trim() || undefined
    const thickness_mm = parseFloat(row[7] ?? '') || undefined
    const format_label = row[8]?.trim() || undefined
    if (source_type === 'manual' && !manual_price) { errors.push(`Ligne ${line} : prix fixe requis pour la source manuelle.`); return }
    if (source_type === 'lme' && metal_code === 'STEEL') { errors.push(`Ligne ${line} : l’acier requiert la source manuelle.`); return }
    valid.push({ label, metal_code, source_type, coefficient, manual_price_eur_kg: manual_price, unit, grade, thickness_mm, format_label })
  })
  return { valid, errors }
}

/** Texte CSV (séparateur « ; » ou « , ») → lignes de grilles et erreurs de lecture. */
export function parseGridCsv(text: string): { valid: ImportGridRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  if (lines.length < 2) return { valid: [], errors: ['Le fichier est vide ou ne contient pas de données.'] }
  const sep = lines[0].includes(';') ? ';' : ','
  return parseGridRows(lines.slice(1).map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim())))
}

const eur = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** « 0,95 € / kg » pour un prix fixe, « Cours × 1,35 / kg » pour un cours indicatif. */
export function gridPriceLabel(grid: Pick<MetalPriceGrid, 'source_type' | 'manual_price_eur_kg' | 'coefficient' | 'unit'>): string {
  return grid.source_type === 'manual'
    ? `${eur.format(grid.manual_price_eur_kg ?? 0)} € / ${grid.unit}`
    : `Cours × ${eur.format(grid.coefficient)} / ${grid.unit}`
}

/** Précisions d'une grille (nuance, épaisseur, format) pour la ligne de liste. */
export function gridDetails(grid: Pick<MetalPriceGrid, 'grade' | 'thickness_mm' | 'format_label'>): string[] {
  return [grid.grade, grid.thickness_mm ? `${grid.thickness_mm} mm` : null, grid.format_label].filter((v): v is string => !!v)
}

export const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`
