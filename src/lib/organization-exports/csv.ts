export function sanitizeFileName(value: string | null | undefined, fallback = 'export'): string {
  const normalized = (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-')
    .slice(0, 120)

  return normalized || fallback
}

function stringifyCsvValue(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  return JSON.stringify(value)
}

// Excel/LibreOffice interprètent une cellule commençant par = + - @ (ou tab/CR)
// comme une formule. L'archive de réversibilité contient des données saisies
// par des tiers (clients, fournisseurs) : on neutralise par une apostrophe.
const FORMULA_START = /^[=+\-@\t\r]/

function escapeCsvCell(value: string): string {
  const guarded = FORMULA_START.test(value) ? `'${value}` : value
  if (/[;"\n\r]/.test(guarded)) {
    return `"${guarded.replace(/"/g, '""')}"`
  }
  return guarded
}

export function rowsToCsv(
  rows: Array<Record<string, unknown>>,
  preferredHeaders?: string[],
): string {
  const headerSet = new Set<string>(preferredHeaders ?? [])
  rows.forEach((row) => Object.keys(row).forEach((key) => headerSet.add(key)))
  const headers = Array.from(headerSet)

  const lines = [
    headers.map(escapeCsvCell).join(';'),
    ...rows.map((row) =>
      headers
        .map((header) => escapeCsvCell(stringifyCsvValue(row[header])))
        .join(';'),
    ),
  ]

  return '\uFEFF' + lines.join('\n')
}
