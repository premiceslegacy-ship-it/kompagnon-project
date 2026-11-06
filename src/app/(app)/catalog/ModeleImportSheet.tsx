'use client'
// @atelier-migrated
// Import des modèles de devis : un fichier de modèles et, en option, un fichier de lignes liés par template_ref.

import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { importPrestationTypes, type ImportCatalogState } from '@/lib/data/mutations/catalog'
import { downloadCSVTemplate, parseFileToRows } from './catalogImport'
import {
  PRESTATION_HEADERS_EXAMPLE, PRESTATION_HEADERS_FIELDS, PRESTATION_LINES_EXAMPLE, PRESTATION_LINES_FIELDS,
} from './modelesModel'
import screen from '@/components/layout/Screen.module.css'
import local from './Catalog.module.css'

type Picked = { file: File; count: number | null }

export default function ModeleImportSheet({ label, plural, onDone, onClose }: { label: string; plural: string; onDone: () => void; onClose: () => void }) {
  const headersInput = useRef<HTMLInputElement>(null)
  const linesInput = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [headers, setHeaders] = useState<Picked | null>(null)
  const [lines, setLines] = useState<Picked | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportCatalogState | null>(null)
  const [busy, setBusy] = useState(false)

  async function pick(e: React.ChangeEvent<HTMLInputElement>, set: (p: Picked | null) => void, message: string) {
    const file = e.target.files?.[0] ?? null
    e.target.value = ''
    setError(null)
    if (!file) { set(null); return }
    try {
      const { dataRows } = await parseFileToRows(file)
      set({ file, count: dataRows.length })
    } catch {
      set({ file, count: null })
      setError(message)
    }
  }

  async function run() {
    if (!headers) return
    setBusy(true)
    setError(null)
    try {
      const xlsx = await import('xlsx')
      const parse = async (file: File): Promise<Record<string, string>[]> => {
        const wb = xlsx.read(await file.arrayBuffer(), { type: 'array' })
        return xlsx.utils.sheet_to_json<Record<string, string>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      }
      const fd = new FormData()
      fd.append('headers_json', JSON.stringify(await parse(headers.file)))
      fd.append('lines_json', JSON.stringify(lines ? await parse(lines.file) : []))
      const res = await importPrestationTypes({ error: null, imported: 0, skipped: 0, skipped_reasons: [] }, fd)
      setResult(res)
      if (!res.error) { setStep(3); onDone() }
    } catch {
      setError('Erreur lors de la lecture des fichiers.')
    } finally {
      setBusy(false)
    }
  }

  const cap = label.charAt(0).toUpperCase() + label.slice(1)
  const fileRow = (title: string, picked: Picked | null, input: React.RefObject<HTMLInputElement | null>, cols: string) => (
    <ListRow
      title={picked ? picked.file.name : title}
      description={picked ? `${picked.count ?? '?'} ligne${(picked.count ?? 0) > 1 ? 's' : ''}` : cols}
      onClick={() => input.current?.click()}
    />
  )

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title={`Importer des ${plural}`} description={step === 1 ? 'Étape 1 sur 3 : les fichiers' : step === 2 ? 'Étape 2 sur 3 : l’aperçu' : 'Étape 3 sur 3 : le résultat'} cancelLabel={step === 3 ? 'Fermer' : 'Annuler'}>
      <div className={local.sheetBody}>
        {step === 1 && (
          <>
            <p className={screen.note} style={{ margin: '0 4px' }}>L’import utilise deux fichiers liés par la colonne template_ref. Téléchargez les modèles CSV pour voir le format attendu.</p>
            <ListGroup title={`Fichier ${plural} (obligatoire)`} description={`Colonnes : ${PRESTATION_HEADERS_FIELDS.map(f => f.key).join(', ')}`}>
              {fileRow('Choisir un fichier CSV ou Excel', headers, headersInput, 'CSV ou Excel')}
              <ListRow title="Télécharger le modèle CSV" onClick={() => downloadCSVTemplate(PRESTATION_HEADERS_FIELDS, 'template_modeles_devis.csv', PRESTATION_HEADERS_EXAMPLE)} />
            </ListGroup>
            <ListGroup title="Fichier des lignes (facultatif)" description={`Colonnes : ${PRESTATION_LINES_FIELDS.map(f => f.key).join(', ')}`}>
              {fileRow('Choisir un fichier CSV ou Excel', lines, linesInput, 'CSV ou Excel')}
              <ListRow title="Télécharger le modèle CSV" onClick={() => downloadCSVTemplate(PRESTATION_LINES_FIELDS, 'template_lignes_devis.csv', PRESTATION_LINES_EXAMPLE)} />
            </ListGroup>
            <input ref={headersInput} className={local.hiddenInput} type="file" accept=".csv,.xlsx,.xls" tabIndex={-1} aria-label="Fichier des modèles" onChange={e => pick(e, setHeaders, 'Impossible de lire le fichier modèles.')} />
            <input ref={linesInput} className={local.hiddenInput} type="file" accept=".csv,.xlsx,.xls" tabIndex={-1} aria-label="Fichier des lignes" onChange={e => pick(e, setLines, 'Impossible de lire le fichier des lignes.')} />
            {error && <p className={screen.error} role="alert">{error}</p>}
            <div className={local.cta}><Button size="lg" disabled={!headers} onClick={() => setStep(2)}>Suivant</Button></div>
          </>
        )}
        {step === 2 && (
          <>
            <ListGroup title="Aperçu">
              <ListRow title={`${headers?.count ?? '?'} ${label}${(headers?.count ?? 0) > 1 ? 's' : ''} à importer`} />
              <ListRow title={lines ? `${lines.count ?? '?'} ligne${(lines.count ?? 0) > 1 ? 's' : ''} de détail associées` : 'Pas de fichier de lignes'} description={lines ? undefined : `Les ${plural} seront créés sans lignes de détail.`} />
            </ListGroup>
            {(result?.error || error) && <p className={screen.error} role="alert">{result?.error ?? error}</p>}
            <div className={local.cta}><Button size="lg" loading={busy} onClick={() => void run()}>Importer</Button></div>
            <Button variant="text" size="md" onClick={() => setStep(1)}>Retour</Button>
          </>
        )}
        {step === 3 && result && (
          <ListGroup title="Import réussi" description={result.skipped > 0 ? 'Les lignes ignorées sont listées ci-dessous.' : undefined}>
            <ListRow title={`${cap}s importés`} trailing={<StatusPill status="success">{result.imported}</StatusPill>} />
            {result.skipped > 0 && <ListRow title="Ignorés" trailing={<StatusPill status="wait">{result.skipped}</StatusPill>} />}
            {result.skipped_reasons.map((r, i) => <ListRow key={i} title={r} />)}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}
