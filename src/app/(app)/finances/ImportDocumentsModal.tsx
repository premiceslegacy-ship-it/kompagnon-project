'use client'
// @atelier-migrated

import React, { useState, useRef, useTransition } from 'react'
import { importInvoices, importQuotes, type ImportDocumentRow, type ImportDocumentsResult } from '@/lib/data/mutations/import-documents'
import AICreditsErrorModal from '@/components/shared/AICreditsErrorModal'
import { Button } from '@/components/ui/Button'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import styles from './quote-editor/QuoteEditor.module.css'

// ─── Types ────────────────────────────────────────────────────────────────────

type DocType = 'invoices' | 'quotes'

// ─── CSV templates ────────────────────────────────────────────────────────────

const INVOICE_HEADERS = [
  'numero_facture', 'date_emission', 'date_echeance',
  'client_nom', 'client_type', 'client_email', 'client_telephone', 'client_siret', 'client_adresse',
  'designation', 'quantite', 'unite', 'prix_unitaire_ht', 'tva',
  'statut', 'recurrente', 'frequence', 'notes',
]

const QUOTE_HEADERS = [
  'numero_devis', 'date_emission', 'date_validite',
  'client_nom', 'client_type', 'client_email', 'client_telephone', 'client_siret', 'client_adresse',
  'titre_projet', 'designation', 'quantite', 'unite', 'prix_unitaire_ht', 'tva',
  'statut', 'notes',
]

const INVOICE_EXAMPLE = [
  'FAC-2024-001', '15/03/2024', '14/04/2024',
  'Dupont Bâtiment', 'professionnel', 'contact@dupont.fr', '06 12 34 56 78', '12345678900012', '12 rue de la Paix 75001 Paris',
  'Pose bardage acier', '1', 'forfait', '2500', '20',
  'payee', 'non', '', '',
]

const QUOTE_EXAMPLE = [
  'DEV-2024-001', '10/02/2024', '10/03/2024',
  'Jean Dupont', 'particulier', 'jean.dupont@gmail.com', '06 98 76 54 32', '', '',
  'Rénovation toiture', 'Dépose ancienne toiture', '1', 'forfait', '800', '10',
  'accepte', '',
]

function downloadTemplate(type: DocType) {
  const headers = type === 'invoices' ? INVOICE_HEADERS : QUOTE_HEADERS
  const example = type === 'invoices' ? INVOICE_EXAMPLE : QUOTE_EXAMPLE
  const bom = '\uFEFF'
  const csv = bom + headers.join(';') + '\n' + example.join(';') + '\n'
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = type === 'invoices' ? 'template_factures.csv' : 'template_devis.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim())
  if (lines.length < 2) return { headers: [], rows: [] }
  const sep = lines[0].includes(';') ? ';' : ','
  const parse = (line: string) => {
    const row: string[] = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === sep && !inQ) { row.push(cur.trim()); cur = '' }
      else { cur += ch }
    }
    row.push(cur.trim())
    return row
  }
  return { headers: parse(lines[0]).map(h => h.toLowerCase().trim()), rows: lines.slice(1).map(parse) }
}

async function parseFileToRows(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
    const XLSX = await import('xlsx')
    const buf = await file.arrayBuffer()
    const wb = XLSX.read(buf, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const raw = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' })
    if (raw.length < 2) return { headers: [], rows: [] }
    return { headers: raw[0].map(s => String(s).toLowerCase().trim()), rows: raw.slice(1).map(r => r.map(String)) }
  }
  const text = await file.text()
  return parseCSV(text)
}

function rowsToDocumentRows(headers: string[], rows: string[][], type: DocType): ImportDocumentRow[] {
  const idx = (name: string) => headers.indexOf(name)
  const get = (row: string[], name: string) => row[idx(name)]?.trim() || undefined

  return rows
    .filter(r => r.some(c => c.trim()))
    .map(row => {
      const numField = type === 'invoices' ? 'numero_facture' : 'numero_devis'
      return {
        numero: get(row, numField),
        date_emission: get(row, 'date_emission') ?? '',
        date_echeance: get(row, 'date_echeance'),
        date_validite: get(row, 'date_validite'),
        titre_projet: get(row, 'titre_projet'),
        client_nom: get(row, 'client_nom') ?? '',
        client_type: get(row, 'client_type'),
        client_email: get(row, 'client_email'),
        client_telephone: get(row, 'client_telephone'),
        client_siret: get(row, 'client_siret'),
        client_adresse: get(row, 'client_adresse'),
        designation: get(row, 'designation') ?? '',
        quantite: get(row, 'quantite'),
        unite: get(row, 'unite'),
        prix_unitaire_ht: get(row, 'prix_unitaire_ht') ?? '0',
        tva: get(row, 'tva'),
        statut: get(row, 'statut'),
        recurrente: get(row, 'recurrente'),
        frequence: get(row, 'frequence'),
        notes: get(row, 'notes'),
      } satisfies ImportDocumentRow
    })
}

// ─── Feuille ──────────────────────────────────────────────────────────────────

type Props = {
  isOpen: boolean
  onClose: () => void
  defaultType?: DocType
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`

/** Import de factures ou de devis depuis un tableur ou un PDF lu par l'assistante. */
export default function ImportDocumentsModal({ isOpen, onClose, defaultType = 'invoices' }: Props) {
  const [docType, setDocType] = useState<DocType>(defaultType)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [pdfRows, setPdfRows] = useState<ImportDocumentRow[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [aiCreditsError, setAiCreditsError] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const [result, setResult] = useState<ImportDocumentsResult | null>(null)
  const [isPending, startTransition] = useTransition()
  const fileRef = useRef<HTMLInputElement>(null)

  function handleClose() {
    setStep(1); setPreview(null); setPdfRows(null); setParseError(null); setResult(null); setAiLoading(false)
    onClose()
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null)

    if (file.name.toLowerCase().endsWith('.pdf')) {
      setAiLoading(true)
      try {
        const fd = new FormData()
        fd.append('file', file)
        fd.append('docType', docType)
        const res = await fetch('/api/ai/parse-document-pdf', { method: 'POST', body: fd })
        const data = await res.json()
        if (!res.ok || data.error) {
          if (res.status === 402) { setAiCreditsError(true); setAiLoading(false); return }
          setParseError(data.error ?? "Impossible d'analyser le PDF."); setAiLoading(false); return
        }
        const rows: ImportDocumentRow[] = data.rows
        if (!rows || rows.length === 0) { setParseError('Aucune ligne extraite du PDF.'); setAiLoading(false); return }
        setPdfRows(rows)
        setPreview(null)
        setStep(2)
      } catch {
        setParseError("Erreur lors de l'envoi du fichier.")
      } finally {
        setAiLoading(false)
      }
      e.target.value = ''
      return
    }

    try {
      const parsed = await parseFileToRows(file)
      if (parsed.headers.length === 0) { setParseError('Fichier vide ou format non reconnu.'); return }
      const required = ['client_nom', 'date_emission', 'designation', 'prix_unitaire_ht']
      const missing = required.filter(h => !parsed.headers.includes(h))
      if (missing.length > 0) {
        setParseError(`Colonnes manquantes : ${missing.join(', ')}. Téléchargez le modèle pour voir la structure attendue.`)
        return
      }
      setPreview(parsed)
      setPdfRows(null)
      setStep(2)
    } catch {
      setParseError('Impossible de lire le fichier.')
    }
    e.target.value = ''
  }

  function handleImport() {
    const docRows = pdfRows ?? (preview ? rowsToDocumentRows(preview.headers, preview.rows, docType) : null)
    if (!docRows) return
    startTransition(async () => {
      const res = docType === 'invoices'
        ? await importInvoices(docRows)
        : await importQuotes(docRows)
      setResult(res)
      setStep(3)
    })
  }

  if (!isOpen) return null

  const validRows = pdfRows
    ? pdfRows.length
    : preview ? preview.rows.filter(r => r.some(c => c.trim())).length : 0
  const previewRows: ImportDocumentRow[] = pdfRows
    ? pdfRows
    : preview ? rowsToDocumentRows(preview.headers, preview.rows, docType) : []
  const label = docType === 'invoices' ? 'factures' : 'devis'

  return (
    <>
      {aiCreditsError && <AICreditsErrorModal onClose={() => setAiCreditsError(false)} />}
      <Sheet
        open
        onOpenChange={open => { if (!open && !isPending) handleClose() }}
        title={`Importer des ${label}`}
        description={step === 1 ? 'Reprenez vos documents existants depuis un tableur ou un PDF.' : undefined}
        cancelLabel={step === 3 ? 'Fermer' : step === 2 ? 'Retour' : 'Annuler'}
        onCancel={step === 2 ? () => { setStep(1); setPdfRows(null); setPreview(null) } : undefined}
        onConfirm={step === 2 ? handleImport : undefined}
        confirmLabel={`Importer ${plural(validRows, 'ligne')}`}
        confirmLoading={isPending}
      >
        <div className={styles.detail}>
          {step === 1 && (
            <>
              <SegmentedControl
                fullWidth
                label="Type de document"
                value={docType}
                options={[{ value: 'invoices', label: 'Factures' }, { value: 'quotes', label: 'Devis' }]}
                onChange={v => setDocType(v as DocType)}
              />
              {parseError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{parseError}</p>}
              {aiLoading && <p className={styles.hint} role="status" style={{ marginTop: 0 }}>L’assistante lit votre PDF. Cela prend quelques secondes.</p>}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf" hidden onChange={handleFile} disabled={aiLoading} aria-label="Fichier à importer" />
              <div className={styles.inline}>
                <Button variant="primary" size="md" onClick={() => fileRef.current?.click()} loading={aiLoading} loadingText="Lecture…">
                  Choisir un fichier
                </Button>
                <Button variant="secondary" size="md" onClick={() => downloadTemplate(docType)}>
                  Télécharger le modèle (.csv)
                </Button>
              </div>
              <ListGroup title="Format attendu" description="CSV, Excel ou PDF. Plusieurs lignes avec le même numéro forment un seul document.">
                <ListRow title="Dates" description="JJ/MM/AAAA ou AAAA-MM-JJ" />
                <ListRow title="Statut" description={docType === 'invoices' ? 'payee, envoyee, brouillon' : 'accepte, refuse, envoye, brouillon'} />
                {docType === 'invoices' && <ListRow title="Récurrence" description="recurrente : oui ou non. frequence : mensuelle, trimestrielle, hebdomadaire, annuelle" />}
                <ListRow title="Type de client" description="client_type : professionnel ou particulier" />
              </ListGroup>
            </>
          )}

          {step === 2 && (
            <>
              <p className={styles.hint} style={{ marginTop: 0 }}>
                {pdfRows ? `${plural(validRows, 'ligne')} lue${validRows > 1 ? 's' : ''} dans le PDF.` : `${plural(validRows, 'ligne')} détectée${validRows > 1 ? 's' : ''} dans le fichier.`}
                {' '}Les clients absents de votre base seront créés. Chaque document importé nourrit aussi la mémoire de l’entreprise pour l’assistante.
              </p>
              <ListGroup title="Aperçu" description={previewRows.length > 5 ? `… et ${plural(previewRows.length - 5, 'ligne')} de plus` : undefined}>
                {previewRows.slice(0, 5).map((row, i) => (
                  <ListRow
                    key={i}
                    title={row.client_nom || 'Client à renseigner'}
                    description={[row.designation, row.quantite ? `× ${row.quantite}` : null, row.tva ? `TVA ${row.tva} %` : null, row.statut].filter(Boolean).join(' · ')}
                    trailing={<span className={styles.fieldValue}>{row.prix_unitaire_ht} €</span>}
                  />
                ))}
              </ListGroup>
            </>
          )}

          {step === 3 && result && (
            result.error ? (
              <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{result.error}</p>
            ) : (
              <>
                <ListGroup title={`${plural(result.imported, 'document')} importé${result.imported > 1 ? 's' : ''}`}>
                  {result.clients_created > 0 && <ListRow title={`${plural(result.clients_created, 'nouveau client', 'nouveaux clients')} créé${result.clients_created > 1 ? 's' : ''}`} />}
                  {result.memory_entries > 0 && <ListRow title={`${plural(result.memory_entries, 'entrée')} ajoutée${result.memory_entries > 1 ? 's' : ''} à la mémoire de l’entreprise`} />}
                  {result.skipped > 0 && <ListRow title={`${plural(result.skipped, 'document')} ignoré${result.skipped > 1 ? 's' : ''}`} />}
                </ListGroup>
                {result.skipped_reasons && result.skipped_reasons.length > 0 && (
                  <ListGroup title="Pourquoi certains documents sont ignorés">
                    {result.skipped_reasons.map((r, i) => <ListRow key={i} title={r} />)}
                  </ListGroup>
                )}
              </>
            )
          )}
        </div>
      </Sheet>
    </>
  )
}
