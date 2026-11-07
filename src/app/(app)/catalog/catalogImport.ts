// Lecture des fichiers d'import (CSV, Excel) et téléchargement du modèle CSV.

export function parseCSV(text: string): string[][] {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
  const sep = lines[0]?.includes(';') ? ';' : ','
  return lines.map(line => {
    const row: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === sep && !inQ) { row.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    row.push(cur.trim())
    return row
  }).filter(r => r.some(c => c))
}

export async function parseFileToRows(file: File): Promise<{ headers: string[]; dataRows: string[][] }> {
  const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls')
  if (isExcel) {
    const XLSX = await import('xlsx')
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
    if (rows.length < 2) return { headers: [], dataRows: [] }
    return { headers: rows[0].map(String), dataRows: rows.slice(1).map(r => r.map(String)) }
  }
  const text = await file.text()
  const rows = parseCSV(text)
  if (rows.length < 2) return { headers: [], dataRows: [] }
  return { headers: rows[0], dataRows: rows.slice(1) }
}

export function downloadCSVTemplate(fields: Array<{ key: string; label: string }>, filename: string, exampleRow: string[]) {
  const headers = fields.map(f => f.label).join(';')
  const example = exampleRow.map(v => (v.includes(';') ? `"${v}"` : v)).join(';')
  const blob = new Blob(['\uFEFF' + headers + '\n' + example + '\n'], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

