'use client'
// @atelier-migrated
// Devis : import de grilles de prix depuis un fichier CSV fournisseur.

import { useRef, useState } from 'react'
import { FileSpreadsheet } from 'lucide-react'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { importMetalPriceGrids, type ImportGridRow } from '@/lib/data/mutations/metal-price-grids'
import { GRID_CSV_HEADERS, gridDetails, parseGridCsv, plural } from './devisModel'
import screen from '@/components/layout/Screen.module.css'
import local from './Settings.module.css'

export default function MetalGridImportSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportGridRow[]>([])
  const [parseErrors, setParseErrors] = useState<string[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<string | null>(null)

  function reset() {
    setRows([]); setParseErrors([]); setResult(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null)
    try {
      const { valid, errors } = parseGridCsv(await file.text())
      setRows(valid); setParseErrors(errors)
    } catch {
      setRows([]); setParseErrors(['Impossible de lire le fichier.'])
    }
  }

  async function handleImport() {
    if (rows.length === 0) return
    setImporting(true)
    const res = await importMetalPriceGrids(rows)
    setImporting(false)
    if (res.inserted > 0) { reset(); onClose(); return }
    setResult(res.errors[0] ?? 'Aucune grille importée.')
  }

  return (
    <Sheet
      open={open}
      onOpenChange={o => { if (!o) { reset(); onClose() } }}
      title="Importer des grilles"
      onConfirm={handleImport}
      confirmLabel={rows.length > 0 ? `Importer ${rows.length}` : 'Importer'}
      confirmLoading={importing}
      confirmDisabled={rows.length === 0}
    >
      <div className={local.sheetBody}>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" className={local.fileInput} tabIndex={-1} aria-hidden="true" onChange={handleFile} />
        <ListGroup description={`Colonnes dans l’ordre : ${GRID_CSV_HEADERS.join(' | ')}. Source : lme ou manuel. Métal : ALU, XCU, ZNC, PB, STEEL, NI, ou le nom en français.`}>
          <ListRow
            title="Choisir un fichier CSV"
            description="Exportez votre tableur en CSV (séparateur « ; » ou « , »)."
            leading={<span className={local.logoEmpty}><FileSpreadsheet size={22} aria-hidden="true" /></span>}
            onClick={() => fileRef.current?.click()}
          />
        </ListGroup>
        {parseErrors.length > 0 && (
          <div role="alert">{parseErrors.map((m, i) => <p key={i} className={screen.error}>{m}</p>)}</div>
        )}
        {rows.length > 0 && (
          <ListGroup title={`${plural(rows.length, 'grille détectée', 'grilles détectées')} : vérifiez avant d’importer`}>
            {rows.map((row, i) => (
              <ListRow
                key={i}
                title={row.label}
                description={[row.metal_code, row.source_type === 'manual' ? `${row.manual_price_eur_kg} €/${row.unit}` : `× ${row.coefficient ?? '?'}`, ...gridDetails({ grade: row.grade ?? null, thickness_mm: row.thickness_mm ?? null, format_label: row.format_label ?? null })].join(' · ')}
              />
            ))}
          </ListGroup>
        )}
        {result && <p className={screen.error} role="alert">{result}</p>}
      </div>
    </Sheet>
  )
}
