'use client'

import { Fragment, useState, useTransition, useRef } from 'react'
import { useFormState, useFormStatus } from 'react-dom'
import { Plus, Trash2, Edit3, Loader2, X, Check, Upload, FileSpreadsheet, AlertCircle } from 'lucide-react'
import {
  createMetalPriceGrid,
  updateMetalPriceGrid,
  deleteMetalPriceGrid,
  importMetalPriceGrids,
  type MetalPriceGrid,
  type ImportGridRow,
} from '@/lib/data/mutations/metal-price-grids'
import type { CatalogMaterial } from '@/lib/data/queries/catalog'
import type { Supplier } from '@/lib/data/queries/suppliers'
import { METAL_CODES, METAL_LABELS, type MetalCode } from '@/lib/metal-prices'

const INITIAL_STATE = { error: null, success: false }

const INPUT_CLASS =
  'w-full px-4 py-3 bg-base dark:bg-white/5 border border-transparent focus:border-accent focus:ring-1 focus:ring-accent rounded-xl text-primary outline-none transition-all text-sm'

const UNITS = ['kg', 'm²', 'ml', 'pièce', 'tonne']

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex items-center gap-2 px-4 py-2.5 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-60"
    >
      {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
      {label}
    </button>
  )
}

type GridFormProps = {
  grid?: MetalPriceGrid
  materials: CatalogMaterial[]
  suppliers: Supplier[]
  onClose: () => void
}

function GridForm({ grid, materials, suppliers, onClose }: GridFormProps) {
  const action = grid ? updateMetalPriceGrid : createMetalPriceGrid
  const [state, formAction] = useFormState(action, INITIAL_STATE)

  const defaultSourceType = grid?.source_type ?? (grid?.metal_code === 'STEEL' ? 'manual' : 'lme')
  const [sourceType, setSourceType] = useState<'lme' | 'manual'>(defaultSourceType)
  const [metalCode, setMetalCode] = useState<MetalCode>(grid?.metal_code ?? 'ALU')
  const [unit, setUnit] = useState(grid?.unit ?? 'kg')
  const [catalogItemId, setCatalogItemId] = useState(grid?.catalog_item_id ?? '')
  const [supplierId, setSupplierId] = useState(grid?.supplier_id ?? '')

  const catalogMaterials = materials.filter((item) => item.item_kind === 'article')

  function handleMetalChange(code: MetalCode) {
    setMetalCode(code)
    if (code === 'STEEL') setSourceType('manual')
    else setSourceType('lme')
  }

  function handleCatalogItemChange(id: string) {
    setCatalogItemId(id)
    const material = catalogMaterials.find((item) => item.id === id)
    if (material?.unit && UNITS.includes(material.unit)) setUnit(material.unit)
    if (material?.supplier_id && !supplierId) setSupplierId(material.supplier_id)
  }

  if (state.success) {
    onClose()
    return null
  }

  return (
    <form action={formAction} className="space-y-4">
      {grid && <input type="hidden" name="id" value={grid.id} />}
      <input type="hidden" name="source_type" value={sourceType} />

      <div className="space-y-2">
        <label className="text-sm font-semibold text-secondary">Libellé</label>
        <input
          name="label"
          type="text"
          required
          defaultValue={grid?.label ?? ''}
          placeholder={metalCode === 'STEEL' ? 'Ex : Acier S235 fournisseur habituel' : 'Ex : Alu 2mm fournisseur habituel'}
          className={INPUT_CLASS}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-2xl border border-[var(--elevation-border)] bg-[var(--elevation-1)]/30 p-4">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">Matière catalogue liée</label>
          <select
            name="catalog_item_id"
            value={catalogItemId}
            onChange={(e) => handleCatalogItemChange(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Aucune matière liée</option>
            {catalogMaterials.map((material) => (
              <option key={material.id} value={material.id}>
                {material.name}{material.reference ? ` · ${material.reference}` : ''}
              </option>
            ))}
          </select>
          <p className="text-xs text-secondary">
            La ligne de devis gardera le lien catalogue, mais le prix viendra de cette grille.
          </p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">Fournisseur lié</label>
          <select
            name="supplier_id"
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={INPUT_CLASS}
          >
            <option value="">Aucun fournisseur lié</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
            ))}
          </select>
          <p className="text-xs text-secondary">
            Utile pour retrouver l'origine du tarif et vos achats matière.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">Métal</label>
          <select
            name="metal_code"
            value={metalCode}
            onChange={(e) => handleMetalChange(e.target.value as MetalCode)}
            className={INPUT_CLASS}
          >
            {METAL_CODES.map((code) => (
              <option key={code} value={code}>{METAL_LABELS[code]}</option>
            ))}
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">Unité</label>
          <select name="unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={INPUT_CLASS}>
            {UNITS.map((u) => (
              <option key={u} value={u}>{u}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Champs enrichis */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">
            Nuance / grade
            <span className="ml-1 text-xs font-normal text-secondary">(optionnel)</span>
          </label>
          <input
            name="grade"
            type="text"
            defaultValue={grid?.grade ?? ''}
            placeholder="Ex : S235, 304L, 5754"
            className={INPUT_CLASS}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">
            Épaisseur (mm)
            <span className="ml-1 text-xs font-normal text-secondary">(optionnel)</span>
          </label>
          <input
            name="thickness_mm"
            type="number"
            step="0.1"
            min="0.1"
            defaultValue={grid?.thickness_mm ?? ''}
            placeholder="Ex : 2, 3, 0.8"
            className={INPUT_CLASS + ' tabular-nums'}
          />
        </div>
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">
            Format
            <span className="ml-1 text-xs font-normal text-secondary">(optionnel)</span>
          </label>
          <input
            name="format_label"
            type="text"
            defaultValue={grid?.format_label ?? ''}
            placeholder="Ex : 1000×2000, barre 6m"
            className={INPUT_CLASS}
          />
        </div>
      </div>

      {/* Toggle source — masqué pour l'acier */}
      {metalCode !== 'STEEL' && (
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">Source du prix</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setSourceType('lme')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                sourceType === 'lme'
                  ? 'bg-accent text-white border-accent'
                  : 'text-secondary border-[var(--elevation-border)] hover:border-accent/40'
              }`}
            >
              Cours LME automatique
            </button>
            <button
              type="button"
              onClick={() => setSourceType('manual')}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border transition-all ${
                sourceType === 'manual'
                  ? 'bg-accent text-white border-accent'
                  : 'text-secondary border-[var(--elevation-border)] hover:border-accent/40'
              }`}
            >
              Prix fixe fournisseur
            </button>
          </div>
        </div>
      )}

      {metalCode === 'STEEL' && (
        <p className="text-xs text-secondary rounded-xl border border-[var(--elevation-border)] bg-[var(--elevation-1)]/40 px-4 py-2.5">
          L'acier n'est pas coté sur le LME. Le prix est saisi manuellement et mis à jour par vos soins.
        </p>
      )}

      {sourceType === 'manual' ? (
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">
            Prix fournisseur
            <span className="ml-2 text-xs font-normal text-secondary">€/{unit}</span>
          </label>
          <input
            name="manual_price_eur_kg"
            type="number"
            step="0.01"
            min="0.01"
            required
            defaultValue={grid?.manual_price_eur_kg ?? ''}
            placeholder="Ex : 0.95"
            className={INPUT_CLASS + ' tabular-nums'}
          />
          <p className="text-xs text-secondary">
            Ce prix est fixe. Mettez-le à jour quand votre fournisseur change ses tarifs.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="text-sm font-semibold text-secondary">
            Coefficient fournisseur
            <span className="ml-2 text-xs font-normal text-secondary">
              Prix final = cours LME × coefficient
            </span>
          </label>
          <input
            name="coefficient"
            type="number"
            step="0.01"
            min="0.01"
            required
            defaultValue={grid?.coefficient ?? 1.35}
            className={INPUT_CLASS + ' tabular-nums'}
          />
        </div>
      )}

      {state.error && (
        <p className="text-sm text-red-500">{state.error}</p>
      )}

      <div className="flex gap-3 pt-2">
        <SubmitButton label={grid ? 'Enregistrer' : 'Ajouter'} />
        <button
          type="button"
          onClick={onClose}
          className="px-4 py-2.5 rounded-xl text-sm font-semibold text-secondary hover:text-primary transition-colors border border-[var(--elevation-border)] hover:border-accent/40"
        >
          Annuler
        </button>
      </div>
    </form>
  )
}

// ─── Colonnes attendues dans le fichier Excel ─────────────────────────────────
// Libellé | Métal | Source | Coefficient | Prix fixe (€/u) | Unité | Nuance | Épaisseur (mm) | Format
const EXCEL_HEADERS = ['Libellé', 'Métal', 'Source', 'Coefficient', 'Prix fixe', 'Unité', 'Nuance', 'Épaisseur (mm)', 'Format']
const METAL_CODE_MAP: Record<string, string> = {
  alu: 'ALU', aluminium: 'ALU', aluminum: 'ALU',
  cuivre: 'XCU', copper: 'XCU', cu: 'XCU',
  zinc: 'ZNC', zn: 'ZNC',
  plomb: 'PB', lead: 'PB', pb: 'PB',
  acier: 'STEEL', steel: 'STEEL', fer: 'STEEL',
}

function parseExcelRows(rows: string[][]): { valid: ImportGridRow[]; errors: string[] } {
  const valid: ImportGridRow[] = []
  const errors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const lineNum = i + 2 // +1 header, +1 1-indexed
    const label = row[0]?.trim()
    if (!label) continue // skip empty rows silently

    const metalRaw = (row[1] ?? '').trim().toLowerCase()
    const metal_code = METAL_CODE_MAP[metalRaw] ?? row[1]?.trim().toUpperCase()
    if (!metal_code) { errors.push(`Ligne ${lineNum} : métal manquant.`); continue }

    const sourceRaw = (row[2] ?? '').trim().toLowerCase()
    const source_type: 'lme' | 'manual' = sourceRaw === 'manuel' || sourceRaw === 'manual' || sourceRaw === 'fixe' ? 'manual' : 'lme'

    const coefficient = parseFloat(row[3] ?? '') || undefined
    const manual_price = parseFloat(row[4] ?? '') || undefined
    const unit = row[5]?.trim() || 'kg'
    const grade = row[6]?.trim() || undefined
    const thickness_mm = parseFloat(row[7] ?? '') || undefined
    const format_label = row[8]?.trim() || undefined

    if (source_type === 'manual' && !manual_price) {
      errors.push(`Ligne ${lineNum} : prix fixe requis pour la source manuelle.`); continue
    }
    if (source_type === 'lme' && metal_code === 'STEEL') {
      errors.push(`Ligne ${lineNum} : l'acier requiert la source manuelle.`); continue
    }

    valid.push({ label, metal_code, source_type, coefficient, manual_price_eur_kg: manual_price, unit, grade, thickness_mm, format_label })
  }

  return { valid, errors }
}

function ExcelImporter({ onImported }: { onImported: (count: number) => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<{ rows: ImportGridRow[]; parseErrors: string[] } | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ inserted: number; errors: string[] } | null>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setImportResult(null)

    try {
      // Lecture brute CSV/XLSX via FileReader — on supporte CSV ici (XLSX nécessiterait une lib)
      // Pour XLSX : l'utilisateur exporte en CSV depuis Excel ou Google Sheets
      const text = await file.text()
      const lines = text.split(/\r?\n/).filter(l => l.trim())
      if (lines.length < 2) { setPreview({ rows: [], parseErrors: ['Le fichier est vide ou ne contient pas de données.'] }); return }
      // Détecter séparateur : ; ou ,
      const sep = lines[0].includes(';') ? ';' : ','
      const dataRows = lines.slice(1).map(l => l.split(sep).map(c => c.replace(/^"|"$/g, '').trim()))
      const { valid, errors } = parseExcelRows(dataRows)
      setPreview({ rows: valid, parseErrors: errors })
    } catch {
      setPreview({ rows: [], parseErrors: ['Impossible de lire le fichier.'] })
    }
  }

  async function handleImport() {
    if (!preview?.rows.length) return
    setImporting(true)
    const result = await importMetalPriceGrids(preview.rows)
    setImportResult(result)
    setImporting(false)
    if (result.inserted > 0) {
      onImported(result.inserted)
      setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-dashed border-[var(--elevation-border)] p-5 space-y-3">
        <div className="flex items-start gap-3">
          <FileSpreadsheet className="w-5 h-5 text-accent mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-primary">Importer depuis un fichier CSV</p>
            <p className="text-xs text-secondary mt-0.5">
              Format attendu (colonnes dans l&apos;ordre) :&nbsp;
              <span className="font-mono">{EXCEL_HEADERS.join(' | ')}</span>
            </p>
            <p className="text-xs text-secondary mt-1">
              Source : <strong>lme</strong> ou <strong>manuel</strong>. Métal : ALU, XCU, ZNC, PB, STEEL (ou nom en français).
            </p>
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.tsv,.txt"
          onChange={handleFile}
          className="block w-full text-sm text-secondary file:mr-3 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-accent file:text-white hover:file:bg-accent/90 transition-colors cursor-pointer"
        />
      </div>

      {preview && (
        <div className="space-y-3">
          {preview.parseErrors.length > 0 && (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-1">
              {preview.parseErrors.map((e, i) => (
                <p key={i} className="flex items-center gap-2 text-xs text-red-500">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />{e}
                </p>
              ))}
            </div>
          )}
          {preview.rows.length > 0 && (
            <div className="rounded-xl border border-[var(--elevation-border)] overflow-hidden">
              <div className="px-4 py-2.5 bg-[var(--elevation-1)]/40 border-b border-[var(--elevation-border)]">
                <p className="text-xs font-semibold text-secondary">{preview.rows.length} grille{preview.rows.length > 1 ? 's' : ''} détectée{preview.rows.length > 1 ? 's' : ''} — vérifiez avant d&apos;importer</p>
              </div>
              <div className="divide-y divide-[var(--elevation-border)] max-h-56 overflow-y-auto">
                {preview.rows.map((row, i) => (
                  <div key={i} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                    <div>
                      <span className="font-medium text-primary">{row.label}</span>
                      <div className="flex flex-wrap gap-1.5 mt-0.5">
                        {row.grade && <span className="text-[10px] bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded font-semibold">{row.grade}</span>}
                        {row.thickness_mm && <span className="text-[10px] bg-[var(--elevation-1)] text-secondary px-1.5 py-0.5 rounded font-semibold">{row.thickness_mm} mm</span>}
                        {row.format_label && <span className="text-[10px] bg-[var(--elevation-1)] text-secondary px-1.5 py-0.5 rounded font-semibold">{row.format_label}</span>}
                      </div>
                    </div>
                    <div className="text-right text-xs text-secondary shrink-0">
                      <span>{row.metal_code}</span>
                      <span className="mx-1.5">·</span>
                      <span>{row.source_type === 'manual' ? `${row.manual_price_eur_kg} €/${row.unit}` : `×${row.coefficient ?? '?'}`}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="px-4 py-3 bg-[var(--elevation-1)]/20 border-t border-[var(--elevation-border)] flex gap-2">
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing}
                  className="flex items-center gap-2 px-4 py-2 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent/90 transition-colors disabled:opacity-60"
                >
                  {importing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                  Importer {preview.rows.length} grille{preview.rows.length > 1 ? 's' : ''}
                </button>
                <button
                  type="button"
                  onClick={() => { setPreview(null); if (fileRef.current) fileRef.current.value = '' }}
                  className="px-4 py-2 rounded-xl text-sm text-secondary hover:text-primary border border-[var(--elevation-border)] hover:border-accent/40 transition-colors"
                >
                  Annuler
                </button>
              </div>
            </div>
          )}
          {importResult && (
            <p className={`text-sm font-semibold ${importResult.inserted > 0 ? 'text-emerald-500' : 'text-red-500'}`}>
              {importResult.inserted > 0 ? `${importResult.inserted} grille${importResult.inserted > 1 ? 's' : ''} importée${importResult.inserted > 1 ? 's' : ''}.` : 'Aucune grille importée.'}
              {importResult.errors.length > 0 && ` ${importResult.errors.length} erreur${importResult.errors.length > 1 ? 's' : ''}.`}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

type Props = {
  initialGrids: MetalPriceGrid[]
  materials: CatalogMaterial[]
  suppliers: Supplier[]
}

export default function MetalPriceGridsSettings({ initialGrids, materials, suppliers }: Props) {
  const [grids, setGrids] = useState(initialGrids)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)

  function handleDelete(id: string) {
    setDeletingId(id)
    startTransition(async () => {
      const result = await deleteMetalPriceGrid(id)
      if (!result.error) {
        setGrids((prev) => prev.filter((g) => g.id !== id))
      }
      setDeletingId(null)
    })
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold text-primary">Grilles matière</h3>
          <p className="text-sm text-secondary mt-0.5">
            Cours indicatif × coefficient ou prix fixe, avec liens catalogue et fournisseur optionnels
          </p>
        </div>
        {!showAddForm && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => { setShowImport(v => !v); setShowAddForm(false) }}
              className="flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-semibold border border-[var(--elevation-border)] text-secondary hover:text-primary hover:border-accent/40 transition-colors"
            >
              <Upload size={14} />
              Importer CSV
            </button>
            <button
              onClick={() => { setShowAddForm(true); setShowImport(false) }}
              className="flex items-center gap-2 px-3 py-2 bg-accent text-white rounded-xl text-sm font-semibold hover:bg-accent/90 transition-colors"
            >
              <Plus size={14} />
              Ajouter une grille
            </button>
          </div>
        )}
      </div>

      {showImport && (
        <div className="rounded-2xl border border-[var(--elevation-border)] bg-[var(--elevation-1)]/20 p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold text-primary">Import depuis fichier CSV fournisseur</span>
            <button onClick={() => setShowImport(false)} className="text-secondary hover:text-primary transition-colors"><X size={16} /></button>
          </div>
          <ExcelImporter onImported={(count) => {
            setShowImport(false)
            // Recharger les grilles après import — on recharge la page pour simplifier
            window.location.reload()
          }} />
        </div>
      )}

      {showAddForm && (
        <div className="rounded-2xl border border-accent/30 bg-accent/5 p-5">
          <div className="flex items-center justify-between mb-4">
            <span className="text-sm font-semibold text-primary">Nouvelle grille</span>
            <button
              onClick={() => setShowAddForm(false)}
              className="text-secondary hover:text-primary transition-colors"
            >
              <X size={16} />
            </button>
          </div>
          <GridForm materials={materials} suppliers={suppliers} onClose={() => setShowAddForm(false)} />
        </div>
      )}

      {grids.length === 0 && !showAddForm && (
        <div className="rounded-2xl border border-[var(--elevation-border)] border-dashed py-8 text-center text-secondary text-sm">
          Aucune grille configurée. Ajoutez votre premier métal source.
        </div>
      )}

      {grids.length > 0 && (
        <div className="space-y-2">
          {grids.map((grid) => (
            <Fragment key={grid.id}>
              <div className="rounded-2xl border border-[var(--elevation-border)] overflow-hidden">
                <div className="flex items-start gap-3 px-4 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-primary text-sm">{grid.label}</p>
                      <span className="text-xs text-secondary shrink-0">{METAL_LABELS[grid.metal_code as MetalCode]}</span>
                      {grid.source_type === 'manual' && (
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-secondary border border-[var(--elevation-border)] rounded px-1.5 py-0.5 shrink-0">
                          Prix fixe
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {grid.grade && <span className="text-[10px] font-semibold bg-blue-500/10 text-blue-500 px-1.5 py-0.5 rounded">{grid.grade}</span>}
                      {grid.thickness_mm && <span className="text-[10px] font-semibold bg-[var(--elevation-1)] text-secondary px-1.5 py-0.5 rounded">{grid.thickness_mm} mm</span>}
                      {grid.format_label && <span className="text-[10px] font-semibold bg-[var(--elevation-1)] text-secondary px-1.5 py-0.5 rounded">{grid.format_label}</span>}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 mt-1.5">
                      <span className="text-xs text-secondary tabular-nums">
                        {grid.source_type === 'manual'
                          ? new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(grid.manual_price_eur_kg ?? 0) + ' €/' + grid.unit
                          : 'Coeff × ' + grid.coefficient.toFixed(2) + ' / ' + grid.unit
                        }
                      </span>
                      {grid.catalog_item_id && <span className="text-xs text-secondary">Catalogue : {materials.find(m => m.id === grid.catalog_item_id)?.name ?? 'lié'}</span>}
                      {grid.supplier_id && <span className="text-xs text-secondary">Fourn. : {suppliers.find(s => s.id === grid.supplier_id)?.name ?? 'lié'}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setEditingId(editingId === grid.id ? null : grid.id)}
                      className="p-1.5 rounded-lg text-secondary hover:text-primary hover:bg-[var(--elevation-1)] transition-colors"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(grid.id)}
                      disabled={deletingId === grid.id || isPending}
                      className="p-1.5 rounded-lg text-secondary hover:text-red-500 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                    >
                      {deletingId === grid.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
                {editingId === grid.id && (
                  <div className="px-4 py-4 bg-[var(--elevation-1)]/40 border-t border-[var(--elevation-border)]">
                    <GridForm grid={grid} materials={materials} suppliers={suppliers} onClose={() => setEditingId(null)} />
                  </div>
                )}
              </div>
            </Fragment>
          ))}
        </div>
      )}

      <p className="text-xs text-secondary">
        Les prix modifiés n&apos;impactent pas les devis déjà validés.
        Les cours LME sont indicatifs, à valider selon votre fournisseur, format, épaisseur et livraison.
      </p>
    </div>
  )
}
