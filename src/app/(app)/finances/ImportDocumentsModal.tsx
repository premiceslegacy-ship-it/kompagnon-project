'use client'

import React, { useState, useRef, useTransition } from 'react'
import { X, Upload, Download, CheckCircle2, AlertCircle, Loader2, FileText, Sparkles } from 'lucide-react'
import { importInvoices, importQuotes, type ImportDocumentRow, type ImportDocumentsResult } from '@/lib/data/mutations/import-documents'

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

// ─── Modal ────────────────────────────────────────────────────────────────────

type Props = {
  isOpen: boolean
  onClose: () => void
  defaultType?: DocType
}

export default function ImportDocumentsModal({ isOpen, onClose, defaultType = 'invoices' }: Props) {
  const [docType, setDocType] = useState<DocType>(defaultType)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [preview, setPreview] = useState<{ headers: string[]; rows: string[][] } | null>(null)
  const [pdfRows, setPdfRows] = useState<ImportDocumentRow[] | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
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
        if (!res.ok || data.error) { setParseError(data.error ?? "Impossible d'analyser le PDF."); setAiLoading(false); return }
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

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="rounded-3xl bg-surface shadow-kompagnon dark:bg-[#111] border border-[var(--elevation-border)] w-full max-w-2xl p-8 relative animate-in fade-in zoom-in duration-200">
        <button onClick={handleClose} className="absolute top-6 right-6 text-secondary hover:text-primary"><X className="w-6 h-6" /></button>

        <div className="flex items-center gap-3 mb-6">
          <FileText className="w-6 h-6 text-accent" />
          <h2 className="text-2xl font-bold text-primary">Importer des {docType === 'invoices' ? 'factures' : 'devis'}</h2>
        </div>

        {/* Toggle devis / factures */}
        {step === 1 && (
          <div className="flex rounded-xl overflow-hidden border border-[var(--elevation-border)] mb-6">
            {(['invoices', 'quotes'] as DocType[]).map(t => (
              <button key={t} type="button" onClick={() => setDocType(t)}
                className={`flex-1 py-2.5 text-sm font-semibold transition-colors ${docType === t ? 'bg-accent text-black' : 'text-secondary hover:text-primary'}`}>
                {t === 'invoices' ? 'Factures' : 'Devis'}
              </button>
            ))}
          </div>
        )}

        {/* ── Step 1 : upload ── */}
        {step === 1 && (
          <div className="space-y-5">
            <div
              className="rounded-2xl border-2 border-dashed border-[var(--elevation-border)] p-8 text-center space-y-3 transition-colors"
              onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('border-accent', 'bg-accent/5') }}
              onDragLeave={e => { e.currentTarget.classList.remove('border-accent', 'bg-accent/5') }}
              onDrop={async e => {
                e.preventDefault()
                e.currentTarget.classList.remove('border-accent', 'bg-accent/5')
                const file = e.dataTransfer.files[0]
                if (!file) return
                if (fileRef.current) {
                  const dt = new DataTransfer()
                  dt.items.add(file)
                  fileRef.current.files = dt.files
                  fileRef.current.dispatchEvent(new Event('change', { bubbles: true }))
                }
              }}
            >
              {aiLoading ? (
                <>
                  <Sparkles className="w-8 h-8 text-accent mx-auto animate-pulse" />
                  <div>
                    <p className="font-semibold text-primary text-sm">L&apos;IA analyse votre PDF…</p>
                    <p className="text-xs text-secondary mt-1">Extraction des données en cours, cela prend quelques secondes.</p>
                  </div>
                  <Loader2 className="w-5 h-5 text-accent mx-auto animate-spin" />
                </>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-secondary mx-auto opacity-40" />
                  <div>
                    <p className="font-semibold text-primary text-sm">CSV, Excel ou PDF</p>
                    <p className="text-xs text-secondary mt-1">
                      PDF : l&apos;IA extrait automatiquement les données. CSV/Excel : plusieurs lignes par document = multi-lignes.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="px-6 py-2.5 rounded-full bg-accent text-black font-bold text-sm hover:scale-105 transition-all shadow-lg shadow-accent/20"
                  >
                    Choisir un fichier
                  </button>
                </>
              )}
              <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls,.pdf" className="hidden" onChange={handleFile} disabled={aiLoading} />
            </div>

            {parseError && (
              <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-xs text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {parseError}
              </div>
            )}

            <div className="flex items-center justify-between text-sm">
              <p className="text-secondary">Pas encore de fichier ? Téléchargez le modèle :</p>
              <button
                type="button"
                onClick={() => downloadTemplate(docType)}
                className="flex items-center gap-1.5 text-accent hover:text-accent/80 font-semibold text-xs"
              >
                <Download className="w-3.5 h-3.5" />
                Modèle {docType === 'invoices' ? 'factures' : 'devis'} (.csv)
              </button>
            </div>

            {/* Aide format */}
            <div className="rounded-xl bg-base/50 border border-[var(--elevation-border)] p-4 text-xs text-secondary space-y-1.5">
              <p className="font-bold text-primary text-xs mb-1">Format attendu</p>
              <p><strong>Dates</strong> : JJ/MM/AAAA ou AAAA-MM-JJ</p>
              <p><strong>Statut {docType === 'invoices' ? 'facture' : 'devis'}</strong> : {docType === 'invoices' ? 'payee, envoyee, brouillon' : 'accepte, refuse, envoye, brouillon'}</p>
              {docType === 'invoices' && <p><strong>Récurrente</strong> : oui / non — <strong>Fréquence</strong> : mensuelle, trimestrielle, hebdomadaire, annuelle</p>}
              <p><strong>client_type</strong> : professionnel / particulier</p>
              <p><strong>Multi-lignes</strong> : même numéro de {docType === 'invoices' ? 'facture' : 'devis'} sur plusieurs lignes = un seul document avec plusieurs lignes</p>
            </div>
          </div>
        )}

        {/* ── Step 2 : preview ── */}
        {step === 2 && (
          <div className="space-y-5">
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-accent/10 border border-accent/20 text-sm">
              {pdfRows ? <Sparkles className="w-4 h-4 text-accent shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />}
              <p className="text-primary">
                {pdfRows
                  ? <><strong>{validRows} ligne{validRows > 1 ? 's' : ''}</strong> extraite{validRows > 1 ? 's' : ''} par l&apos;IA depuis le PDF</>
                  : <><strong>{validRows} ligne{validRows > 1 ? 's' : ''}</strong> détectée{validRows > 1 ? 's' : ''} dans le fichier</>
                }
              </p>
            </div>

            {pdfRows ? (
              <div className="rounded-xl border border-[var(--elevation-border)] overflow-hidden">
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-base/30 border-b border-[var(--elevation-border)]">
                        {['Client', 'Date', 'Désignation', 'Qté', 'Prix HT', 'TVA', 'Statut'].map(h => (
                          <th key={h} className="px-3 py-2 text-left text-secondary font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--elevation-border)]">
                      {pdfRows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="hover:bg-accent/5">
                          <td className="px-3 py-2 text-primary whitespace-nowrap max-w-[120px] truncate">{row.client_nom}</td>
                          <td className="px-3 py-2 text-primary whitespace-nowrap">{row.date_emission}</td>
                          <td className="px-3 py-2 text-primary whitespace-nowrap max-w-[150px] truncate">{row.designation}</td>
                          <td className="px-3 py-2 text-primary whitespace-nowrap">{row.quantite}</td>
                          <td className="px-3 py-2 text-primary whitespace-nowrap">{row.prix_unitaire_ht} €</td>
                          <td className="px-3 py-2 text-primary whitespace-nowrap">{row.tva}%</td>
                          <td className="px-3 py-2 text-primary whitespace-nowrap">{row.statut}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {pdfRows.length > 5 && (
                  <p className="text-xs text-secondary px-3 py-2 border-t border-[var(--elevation-border)]">… et {pdfRows.length - 5} ligne{pdfRows.length - 5 > 1 ? 's' : ''} de plus</p>
                )}
              </div>
            ) : preview ? (
              <div className="rounded-xl border border-[var(--elevation-border)] overflow-hidden">
                <div className="overflow-x-auto max-h-48">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-base/30 border-b border-[var(--elevation-border)]">
                        {preview.headers.map(h => <th key={h} className="px-3 py-2 text-left text-secondary font-bold uppercase tracking-wider whitespace-nowrap">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--elevation-border)]">
                      {preview.rows.slice(0, 5).map((row, i) => (
                        <tr key={i} className="hover:bg-accent/5">
                          {preview.headers.map((_, j) => (
                            <td key={j} className="px-3 py-2 text-primary whitespace-nowrap max-w-[120px] truncate">{row[j] || ''}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.rows.length > 5 && (
                  <p className="text-xs text-secondary px-3 py-2 border-t border-[var(--elevation-border)]">… et {preview.rows.length - 5} ligne{preview.rows.length - 5 > 1 ? 's' : ''} de plus</p>
                )}
              </div>
            ) : null}

            <p className="text-xs text-secondary">
              Les clients non trouvés dans votre base seront créés automatiquement. Chaque document importé alimentera aussi la mémoire d&apos;entreprise pour l&apos;IA.
            </p>

            <div className="flex gap-3">
              <button type="button" onClick={() => { setStep(1); setPdfRows(null); setPreview(null) }} className="flex-1 py-3 rounded-full border border-[var(--elevation-border)] text-secondary font-semibold hover:text-primary transition-colors">
                Retour
              </button>
              <button type="button" onClick={handleImport} disabled={isPending}
                className="flex-1 py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20 disabled:opacity-60 disabled:hover:scale-100 flex items-center justify-center gap-2">
                {isPending ? <><Loader2 className="w-4 h-4 animate-spin" />Import en cours...</> : `Importer ${validRows} ligne${validRows > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3 : result ── */}
        {step === 3 && result && (
          <div className="space-y-5">
            {result.error ? (
              <div className="flex items-start gap-2 px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/25 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {result.error}
              </div>
            ) : (
              <div className="flex items-start gap-3 px-4 py-4 rounded-xl bg-accent/10 border border-accent/20">
                <CheckCircle2 className="w-5 h-5 text-accent shrink-0 mt-0.5" />
                <div className="text-sm space-y-1">
                  <p className="font-bold text-primary">{result.imported} {docType === 'invoices' ? 'facture' : 'devis'}{result.imported > 1 ? 's' : ''} importé{result.imported > 1 ? 'es' : 'e'} avec succès</p>
                  {result.clients_created > 0 && <p className="text-secondary">{result.clients_created} nouveau{result.clients_created > 1 ? 'x' : ''} client{result.clients_created > 1 ? 's' : ''} créé{result.clients_created > 1 ? 's' : ''}</p>}
                  {result.memory_entries > 0 && <p className="text-secondary">{result.memory_entries} entrée{result.memory_entries > 1 ? 's' : ''} ajoutée{result.memory_entries > 1 ? 's' : ''} à la mémoire d&apos;entreprise</p>}
                  {result.skipped > 0 && <p className="text-secondary">{result.skipped} document{result.skipped > 1 ? 's' : ''} ignoré{result.skipped > 1 ? 's' : ''}</p>}
                  {result.skipped_reasons && result.skipped_reasons.length > 0 && (
                    <ul className="mt-2 space-y-1 max-h-28 overflow-y-auto text-left">
                      {result.skipped_reasons.map((r, i) => (
                        <li key={i} className="text-xs text-amber-500 flex items-start gap-1.5">
                          <span className="shrink-0 mt-0.5">⚠</span>{r}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            <button type="button" onClick={handleClose}
              className="w-full py-3 rounded-full bg-accent text-black font-bold hover:scale-105 transition-all shadow-lg shadow-accent/20">
              Terminé
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
