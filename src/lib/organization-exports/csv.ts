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

function escapeCsvCell(value: string): string {
  if (/[;"\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
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
