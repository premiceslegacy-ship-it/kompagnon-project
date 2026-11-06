// @atelier-migrated
// Export comptable : périodes, contenu, aperçu et règles de blocage (outils purs).

export type ExportFormat = 'fec' | 'csv'
export type ExportPeriod = 'current_month' | 'current_quarter' | 'fiscal_year' | 'custom'
export type ExportPreset = 'fiscal_year' | 'period'

export type PreviewData = {
  invoiceCount: number
  acompteCount: number
  avoirCount: number
  paymentCount: number
  receivedInvoiceCount: number
  autoLiqCount: number
  vatBreakdowns: { base20: number; base10: number; base55: number; tva20: number; tva10: number; tva55: number; total: number }
  estimatedLines: number
  numberingHasGaps: boolean
  numberingGaps: string[]
}

export type ExportContent = { invoices: boolean; avoirs: boolean; payments: boolean; received: boolean }

/** Date locale au format AAAA-MM-JJ (pas d'UTC : en France, minuit local tombe la veille en UTC). */
export function ymd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Dates de début et de fin d'une période prédéfinie ; null pour « personnalisée ». */
export function periodRange(period: ExportPeriod, now: Date = new Date()): { from: string; to: string } | null {
  const y = now.getFullYear()
  const m = now.getMonth()
  if (period === 'current_month') return { from: ymd(new Date(y, m, 1)), to: ymd(new Date(y, m + 1, 0)) }
  if (period === 'current_quarter') {
    const start = Math.floor(m / 3) * 3
    return { from: ymd(new Date(y, start, 1)), to: ymd(new Date(y, start + 3, 0)) }
  }
  if (period === 'fiscal_year') return { from: `${y}-01-01`, to: `${y}-12-31` }
  return null
}

export const presetOf = (period: ExportPeriod): ExportPreset => (period === 'fiscal_year' ? 'fiscal_year' : 'period')

export const PERIOD_OPTIONS = [
  { value: 'current_month', label: 'Mois' },
  { value: 'current_quarter', label: 'Trimestre' },
  { value: 'fiscal_year', label: 'Exercice' },
  { value: 'custom', label: 'Libre' },
] as const

export const hasSelectedContent = (c: ExportContent) => c.invoices || c.avoirs || c.payments || c.received

/** Le CSV simplifié n'exporte pas les factures fournisseurs reçues. */
export const hasDownloadableContent = (c: ExportContent, format: ExportFormat) =>
  format === 'fec' ? hasSelectedContent(c) : c.invoices || c.avoirs || c.payments

/** Un trou de numérotation bloque seulement un FEC d'exercice complet. */
export const isBlockingGap = (preview: PreviewData | null, format: ExportFormat, period: ExportPeriod) =>
  Boolean(preview?.numberingHasGaps) && format === 'fec' && presetOf(period) === 'fiscal_year'

export function canDownload(args: { content: ExportContent; format: ExportFormat; period: ExportPeriod; preview: PreviewData | null; siren: string | null; busy: boolean }): boolean {
  const { content, format, period, preview, siren, busy } = args
  return !busy && !isBlockingGap(preview, format, period) && hasDownloadableContent(content, format) && !(format === 'fec' && !siren)
}

export function downloadParams(args: { from: string; to: string; format: ExportFormat; period: ExportPeriod; content: ExportContent }): URLSearchParams {
  const { from, to, format, period, content } = args
  return new URLSearchParams({
    from, to, format, preset: presetOf(period),
    include_invoices: String(content.invoices),
    include_avoirs: String(content.avoirs),
    include_payments: String(content.payments),
    include_received: String(content.received),
  })
}

export const fmtEur = (n: number) => n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €'

export const defaultFilename = (format: ExportFormat) => `export-comptable.${format === 'fec' ? 'txt' : 'csv'}`

export async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    if ((res.headers.get('content-type') ?? '').includes('json')) return (await res.json()).error ?? fallback
    return (await res.text()).trim() || fallback
  } catch {
    return fallback
  }
}

/* ── Sauvegardes et fermeture du compte ───────────────────────────────── */

export type BackupStatus = 'ready' | 'failed' | 'expired' | 'processing'

export function backupStatus(status: BackupStatus): { label: string; pill: 'success' | 'danger' | 'neutral' | 'wait' } {
  if (status === 'ready') return { label: 'Prêt', pill: 'success' }
  if (status === 'failed') return { label: 'Échoué', pill: 'danger' }
  if (status === 'expired') return { label: 'Expirée', pill: 'neutral' }
  return { label: 'En cours', pill: 'wait' }
}

export function formatFileSize(value: number | null): string {
  if (!value) return 'Taille en attente'
  const units = ['o', 'Ko', 'Mo', 'Go']
  let size = value
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size >= 10 || unit === 0 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`
}

/** Le nom de l'organisation doit être saisi à l'identique pour passer à l'étape suivante. */
export const closureNameMatches = (typed: string, orgName: string | null | undefined) => !!orgName && typed === orgName

export function memoryTypeLabel(type: string, aiName: string, metadata?: { chantier_id?: string | null } | null): string {
  if (type === 'chloe_price_correction') return `Prix corrigé par ${aiName}`
  if (type === 'sarah_memory') return `Retenu par ${aiName}`
  if (type === 'marco_memory') return metadata?.chantier_id ? `Retenu par ${aiName} · ce chantier` : `Retenu par ${aiName} · tous les chantiers`
  if (type === 'quote' || type === 'invoice') return 'Résumé document'
  return type
}
