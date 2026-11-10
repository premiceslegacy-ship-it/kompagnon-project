'use client'
// @atelier-migrated
// Feuilles du catalogue : fourniture / service, ressource, fournisseur, import en 3 étapes.

import { useEffect, useRef, useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { Button } from '@/components/ui/Button'
import DimensionConfigEditor from '@/components/catalog/DimensionConfigEditor'
import type { CatalogLaborRate, CatalogMaterial } from '@/lib/data/queries/catalog'
import type { Supplier } from '@/lib/data/queries/suppliers'
import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import { createMaterial, createLaborRate, updateMaterial, updateLaborRate, type ImportCatalogState } from '@/lib/data/mutations/catalog'
import { createSupplier, updateSupplier } from '@/lib/data/mutations/suppliers'
import { buildCatalogPricingPreview, displayUnitToMeters, type DimensionPricingMode } from '@/lib/catalog-pricing'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { getCatalogLabelsForProfile } from '@/lib/catalog-ui'
import { getUnitGroups, isBuiltInUnit, normalizeUnit } from '@/lib/units'
import { downloadCSVTemplate, parseFileToRows } from './catalogImport'
import {
  NEW_CATEGORY, autoMapColumns, blankLaborForm, blankMaterialForm, blankSupplierForm, dimensionError, fmtMoney, laborFormData, laborMarginPct,
  laborToForm, laborUpdatePayload, mapImportRows, materialAfterUpdate, materialFormData, materialToForm, materialUpdatePayload,
  supplierPayload, supplierToForm, withDimensionMode, withEquipmentField, withLaborType, withPricing,
  type ImportConfig, type LaborForm, type MaterialForm, type MaterialKind, type SupplierForm,
} from './catalogModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Catalog.module.css'

const NB = ' '
const OTHER_UNIT = '__other__'
const manualPriceFormat = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })

/** Unité : liste par familles, ou saisie libre pour une unité propre à l'entreprise. */
function UnitField({ value, onChange, allowedUnits, disabled = false }: { value: string; onChange: (v: string) => void; allowedUnits?: string[] | null; disabled?: boolean }) {
  const [free, setFree] = useState(!!value && !isBuiltInUnit(value))
  const groups = getUnitGroups(allowedUnits)
  const known = groups.some(g => g.options.some(o => o.value === normalizeUnit(value)))
  if (free) {
    return <Field type="text" label="Unité" placeholder="m³/h" disabled={disabled} value={value} onChange={e => onChange(e.target.value)} />
  }
  return (
    <Field
      type="select"
      label="Unité"
      disabled={disabled}
      value={normalizeUnit(value)}
      onChange={e => { if (e.target.value === OTHER_UNIT) { setFree(true); onChange('') } else onChange(e.target.value) }}
    >
      {!known && value && <option value={normalizeUnit(value)}>{normalizeUnit(value)}</option>}
      {groups.map(g => (
        <optgroup key={g.label} label={g.label}>{g.options.map(o => <option key={o.value} value={o.value}>{o.value}</option>)}</optgroup>
      ))}
      <option value={OTHER_UNIT}>Autre…</option>
    </Field>
  )
}

/** Catégorie : liste, ou création d'une nouvelle catégorie à la volée. */
function CategoryField({ value, newValue, categories, onChange, onNewChange }: {
  value: string; newValue: string; categories: string[]; onChange: (v: string) => void; onNewChange: (v: string) => void
}) {
  return (
    <>
      <Field type="select" label="Catégorie" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">Aucune</option>
        {value && value !== NEW_CATEGORY && !categories.includes(value) && <option value={value}>{value}</option>}
        {categories.map(c => <option key={c} value={c}>{c}</option>)}
        <option value={NEW_CATEGORY}>＋ Créer une catégorie</option>
      </Field>
      {value === NEW_CATEGORY && <Field type="text" label="Nouvelle catégorie" placeholder="Nom de la catégorie" value={newValue} onChange={e => onNewChange(e.target.value)} />}
    </>
  )
}

// La grille manuelle sert de référence, sans écraser le prix de vente catalogue.
function MetalGridHint({ grid }: { grid: MetalPriceGrid }) {
  const price = grid.source_type === 'manual' ? grid.manual_price_eur_kg : null
  const hasPrice = price !== null && Number.isFinite(price) && price > 0
  return (
    <p className={screen.note} role="status" style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <TrendingUp size={15} aria-hidden="true" style={{ flex: 'none', marginTop: 2 }} />
      <span>
        {hasPrice
          ? `Grille matière liée (${grid.label}) : ${manualPriceFormat.format(price!)}${NB}€ HT / ${grid.unit}, saisis manuellement. Le prix de vente reste inchangé tant que vous ne le modifiez pas vous-même.`
          : 'Cette grille nécessite un prix manuel. Renseignez-le dans Réglages → Devis.'}
      </span>
    </p>
  )
}

/** Fourniture ou service : création et modification. */
export function MaterialSheet({ kind, material, categories, ctx, suppliers, metalGrid, onSaved, onCreated, onDuplicate, onArchive, onClose }: {
  kind: MaterialKind
  material: CatalogMaterial | null
  categories: string[]
  ctx: ResolvedCatalogContext
  suppliers: Supplier[]
  metalGrid: MetalPriceGrid | null
  onSaved: (m: CatalogMaterial) => void
  onCreated: () => void
  onDuplicate: (m: CatalogMaterial) => void
  onArchive: (m: CatalogMaterial) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<MaterialForm>(() => material ? materialToForm(material) : blankMaterialForm(kind))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [advanced, setAdvanced] = useState(() => (material?.price_variants?.length ?? 0) > 0)
  const [priceAsk, setPriceAsk] = useState(false)
  const labels = getCatalogLabelsForProfile(ctx)
  const kindLabels = kind === 'service' ? ctx.labelSet.service : ctx.labelSet.material
  const set = <K extends keyof MaterialForm>(k: K, v: MaterialForm[K]) => setForm(f => ({ ...f, [k]: v }))
  const dimmed = form.dimMode !== 'none'
  const preview = dimmed
    ? buildCatalogPricingPreview({
        sale_price: parseFloat(form.salePrice) || null,
        purchase_price: parseFloat(form.purchasePrice) || null,
        unit: form.unit,
        dimension_pricing_mode: form.dimMode,
        base_length_m: displayUnitToMeters(parseFloat(form.baseLength), form.schema.length.unit),
        base_width_m: displayUnitToMeters(parseFloat(form.baseWidth), form.schema.width.unit),
        base_height_m: displayUnitToMeters(parseFloat(form.baseHeight), form.schema.height.unit),
      })
    : null
  const modeHelp = labels.dimensionModes.find(m => m.value === form.dimMode)?.help
  const priceChanged = !!material && (parseFloat(form.salePrice) || 0) !== (material.sale_price ?? 0)

  async function submit(confirmed = false) {
    if (!form.name.trim()) { setError('La désignation est requise.'); return }
    const dErr = dimensionError(form)
    if (dErr) { setError(dErr); return }
    if (priceChanged && !confirmed) { setPriceAsk(true); return }
    setSaving(true)
    setError(null)
    if (material) {
      const payload = materialUpdatePayload(form, kind, suppliers)
      const res = await updateMaterial(material.id, payload)
      setSaving(false)
      if (res.error) { setError(res.error); return }
      onSaved(materialAfterUpdate(material, payload))
    } else {
      const res = await createMaterial({ error: null, success: false }, materialFormData(form, kind))
      setSaving(false)
      if (res.error) { setError(res.error); return }
      onCreated()
    }
    onClose()
  }

  return (
    <>
      <Sheet
        open
        onOpenChange={o => { if (!o && !priceAsk) onClose() }}
        title={material ? `Modifier ${kindLabels.singular.toLowerCase()}` : kindLabels.createLabel}
        description={material ? (material.reference ?? undefined) : undefined}
        confirmLabel={material ? 'Enregistrer' : 'Ajouter'}
        confirmLoading={saving}
        confirmDisabled={!form.name.trim()}
        onConfirm={() => submit()}
      >
        <div className={local.sheetBody}>
          <div className={styles.fields}>
            <Field type="text" label="Désignation" placeholder={kind === 'service' ? labels.serviceItemPlaceholder : labels.materialItemPlaceholder} value={form.name} onChange={e => set('name', e.target.value)} />
            <Field type="text" label="Référence" placeholder="Générée si vide" value={form.reference} onChange={e => set('reference', e.target.value)} />
            <CategoryField value={form.category} newValue={form.newCategory} categories={categories} onChange={v => set('category', v)} onNewChange={v => set('newCategory', v)} />
            <UnitField value={form.unit} onChange={v => set('unit', v)} allowedUnits={kind === 'service' ? ctx.unitSetsByKind.service : ctx.unitSetsByKind.material} />
            {kind !== 'service' && suppliers.length > 0 && (
              <Field type="select" label="Fournisseur" value={form.supplierId} onChange={e => set('supplierId', e.target.value)}>
                <option value="">Aucun</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Field>
            )}
          </div>
          {form.unit === 'forfait' && <p className={screen.note}>{labels.forfaitHelp}</p>}

          <div className={local.sheetSection}>
            <h3 className={local.sheetHeading}>{kind === 'service' ? 'Coût et prix' : 'Prix'}</h3>
            <div className={styles.fields}>
              <Field type="text" label={kind === 'service' ? 'Coût HT (€)' : 'Achat HT (€)'} inputMode="decimal" placeholder="0,00" value={form.purchasePrice} onChange={e => setForm(f => withPricing(f, 'purchasePrice', e.target.value))} />
              <Field type="text" label="Marge (%)" inputMode="decimal" placeholder="30" value={form.marginRate} onChange={e => setForm(f => withPricing(f, 'marginRate', e.target.value))} />
              <Field type="text" label="Vente HT (€)" inputMode="decimal" placeholder="Calculé" hint="Le prix de vente se calcule à partir du prix d’achat et de la marge." value={form.salePrice} onChange={e => setForm(f => withPricing(f, 'salePrice', e.target.value))} />
            </div>
            {metalGrid && <MetalGridHint grid={metalGrid} />}
          </div>

          <div className={local.sheetSection}>
            <h3 className={local.sheetHeading}>Tarification selon dimensions</h3>
            <SegmentedControl
              label="Mode de tarification selon les dimensions"
              fullWidth
              value={form.dimMode}
              onChange={v => setForm(f => withDimensionMode(f, v as DimensionPricingMode))}
              options={labels.dimensionModes.map(m => ({ value: m.value, label: m.label }))}
            />
            {modeHelp && <p className={screen.note}>{modeHelp}</p>}
            {dimmed && (
              <>
                <div className={styles.fields}>
                  <Field type="text" label={`${form.schema.length.label} (${form.schema.length.unit})`} inputMode="decimal" placeholder="1,000" value={form.baseLength} onChange={e => set('baseLength', e.target.value)} />
                  {(form.dimMode === 'area' || form.dimMode === 'volume') && (
                    <Field type="text" label={`${form.schema.width.label} (${form.schema.width.unit})`} inputMode="decimal" placeholder="1,000" value={form.baseWidth} onChange={e => set('baseWidth', e.target.value)} />
                  )}
                  {form.dimMode === 'volume' && (
                    <Field type="text" label={`${form.schema.height.label} (${form.schema.height.unit})`} inputMode="decimal" placeholder="0,100" value={form.baseHeight} onChange={e => set('baseHeight', e.target.value)} />
                  )}
                </div>
                <p className={screen.note}>Saisissez uniquement les dimensions utilisées pour calculer le prix de base. Sans elles, le prix est appliqué tel quel (quantité 1) dans les devis.</p>
                {preview && preview.unitPrice > 0 && (
                  <p className={screen.note}>Prix unitaire calculé : {preview.unitPrice.toFixed(2)}{NB}€ / {preview.unit}, base de référence {preview.quantity}{NB}{preview.unit}.</p>
                )}
                <ListGroup>
                  <ListRow title={advanced ? 'Masquer les options avancées' : 'Options avancées'} description="Axes, unités et variantes de prix." className={styles.accentRow} onClick={() => setAdvanced(a => !a)} />
                </ListGroup>
                {advanced && (
                  <DimensionConfigEditor
                    mode={form.dimMode}
                    schema={form.schema}
                    variants={form.variants}
                    labels={labels.dimensionEditorLabels}
                    onSchemaChange={schema => set('schema', schema)}
                    onVariantsChange={variants => set('variants', variants)}
                  />
                )}
              </>
            )}
          </div>

          {material && (
            <div className={local.sheetSection}>
              <Field type="textarea" label="Description interne" rows={2} placeholder="Notes internes, caractéristiques techniques…" hint="Non visible par le client." value={form.description} onChange={e => set('description', e.target.value)} />
            </div>
          )}

          {material && (
            <ListGroup>
              <ListRow title="Dupliquer" onClick={() => { onDuplicate(material); onClose() }} />
              <li className={styles.destructiveRow}><button type="button" onClick={() => onArchive(material)}>Archiver</button></li>
            </ListGroup>
          )}
          {error && <p className={screen.error} role="alert">{error}</p>}
        </div>
      </Sheet>
      <AlertDialog
        open={priceAsk}
        onOpenChange={o => { if (!o) setPriceAsk(false) }}
        title="Mettre à jour le prix de vente ?"
        description={`${form.name.trim() || 'Cet article'} : ${fmtMoney(material?.sale_price ?? 0)} → ${fmtMoney(parseFloat(form.salePrice) || 0)}. Les devis et factures déjà créés ne changent pas.`}
        confirmLabel="Confirmer"
        onConfirm={() => { setPriceAsk(false); void submit(true) }}
      />
    </>
  )
}

/** Ressource interne (main-d'œuvre, machine, équipement amorti, sous-traitant) : création et modification. */
export function LaborSheet({ item, categories, ctx, onSaved, onCreated, onArchive, onClose }: {
  item: CatalogLaborRate | null
  categories: string[]
  ctx: ResolvedCatalogContext
  onSaved: (l: CatalogLaborRate) => void
  onCreated: () => void
  onArchive: (l: CatalogLaborRate) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<LaborForm>(() => item ? laborToForm(item) : blankLaborForm(ctx))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = <K extends keyof LaborForm>(k: K, v: LaborForm[K]) => setForm(f => ({ ...f, [k]: v }))
  const equipment = form.type === 'equipment'
  const margin = laborMarginPct(parseFloat(form.costRate) || null, parseFloat(form.rate) || null)
  const ui = ctx.laborRateUi

  async function submit() {
    if (!form.designation.trim()) { setError('La désignation est requise.'); return }
    setSaving(true)
    setError(null)
    if (item) {
      const payload = laborUpdatePayload(form)
      const res = await updateLaborRate(item.id, payload)
      setSaving(false)
      if (res.error) { setError(res.error); return }
      onSaved({ ...item, ...payload })
    } else {
      const res = await createLaborRate({ error: null, success: false }, laborFormData(form))
      setSaving(false)
      if (res.error) { setError(res.error); return }
      onCreated()
    }
    onClose()
  }

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title={item ? 'Modifier la ressource' : ui.modalTitle}
      confirmLabel={item ? 'Enregistrer' : 'Ajouter'}
      confirmLoading={saving}
      confirmDisabled={!form.designation.trim()}
      onConfirm={submit}
    >
      <div className={local.sheetBody}>
        <div className={styles.fields}>
          <Field type="select" label={ui.tableColumnType} value={form.type} onChange={e => setForm(f => withLaborType(f, e.target.value))}>
            {ctx.resourceTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Field>
          <Field type="text" label={ui.designationLabel} placeholder="Pliage CN, carreleur, mini-pelle" value={form.designation} onChange={e => set('designation', e.target.value)} />
          <Field type="text" label="Référence" placeholder={ui.referencePlaceholder} value={form.reference} onChange={e => set('reference', e.target.value)} />
          <CategoryField value={form.category} newValue={form.newCategory} categories={categories} onChange={v => set('category', v)} onNewChange={v => set('newCategory', v)} />
          <UnitField value={form.unit} onChange={v => set('unit', v)} allowedUnits={ctx.unitSetsByKind.laborRate} disabled={equipment} />
        </div>

        {equipment && (
          <div className={local.sheetSection}>
            <h3 className={local.sheetHeading}>Amortissement</h3>
            <div className={styles.fields}>
              <Field type="text" label="Achat HT (€)" inputMode="decimal" placeholder="0,00" value={form.purchasePrice} onChange={e => setForm(f => withEquipmentField(f, 'purchasePrice', e.target.value))} />
              <Field type="text" label="Usages estimés" inputMode="numeric" placeholder="100" hint="Le coût par usage devient le coût interne." value={form.uses} onChange={e => setForm(f => withEquipmentField(f, 'uses', e.target.value))} />
            </div>
          </div>
        )}

        <div className={local.sheetSection}>
          <h3 className={local.sheetHeading}>Coût et prix</h3>
          <div className={styles.fields}>
            <Field type="text" label={`${ui.costLabel}${NB}(€${equipment ? '/usage' : '/u'})`} inputMode="decimal" placeholder="0,00" disabled={equipment} value={form.costRate} onChange={e => set('costRate', e.target.value)} />
            <Field type="text" label="Client HT (€/u)" inputMode="decimal" placeholder="0,00" hint={margin != null ? `Marge ${margin}${NB}%` : undefined} value={form.rate} onChange={e => set('rate', e.target.value)} />
          </div>
        </div>

        {item && (
          <div className={local.sheetSection}>
            <Field type="textarea" label="Description" rows={2} placeholder="Ce que couvre cette prestation…" hint="Peut être affichée au client sur le formulaire de demande en ligne." value={form.description} onChange={e => set('description', e.target.value)} />
          </div>
        )}
        <p className={screen.note}>Sert à calculer vos coûts internes et vos marges, jamais visible sur le devis du client.</p>
        {item && (
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => onArchive(item)}>Archiver</button></li>
          </ListGroup>
        )}
        {error && <p className={screen.error} role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}

/** Fournisseur : création et modification. */
export function SupplierSheet({ supplier, onSaved, onCreated, onArchive, onClose }: {
  supplier: Supplier | null
  onSaved: (s: Supplier) => void
  onCreated: () => void
  onArchive: (s: Supplier) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<SupplierForm>(() => supplier ? supplierToForm(supplier) : blankSupplierForm())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof SupplierForm, v: string) => setForm(f => ({ ...f, [k]: v }))

  async function submit() {
    if (!form.name.trim()) { setError('Le nom est requis.'); return }
    setSaving(true)
    setError(null)
    const payload = supplierPayload(form)
    if (supplier) {
      const res = await updateSupplier(supplier.id, payload)
      setSaving(false)
      if (res.error) { setError(res.error); return }
      onSaved({ ...supplier, ...payload })
    } else {
      const res = await createSupplier(payload)
      setSaving(false)
      if (res.error) { setError(res.error); return }
      onCreated()
    }
    onClose()
  }

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title={supplier ? 'Modifier le fournisseur' : 'Nouveau fournisseur'}
      confirmLabel={supplier ? 'Enregistrer' : 'Ajouter'}
      confirmLoading={saving}
      confirmDisabled={!form.name.trim()}
      onConfirm={submit}
    >
      <div className={local.sheetBody}>
        <div className={styles.fields}>
          <Field type="text" label="Nom" placeholder="ArcelorMittal" value={form.name} onChange={e => set('name', e.target.value)} />
          <Field type="text" label="Contact" placeholder="Paul Martin" value={form.contact} onChange={e => set('contact', e.target.value)} />
          <Field type="text" label="Email" inputMode="email" placeholder="contact@fournisseur.fr" value={form.email} onChange={e => set('email', e.target.value)} />
          <Field type="text" label="Téléphone" inputMode="tel" placeholder="06 12 34 56 78" value={form.phone} onChange={e => set('phone', e.target.value)} />
        </div>
        <div className={styles.fields}>
          <Field type="text" label="Adresse" placeholder="12 rue de l’Acier, 75001 Paris" value={form.address} onChange={e => set('address', e.target.value)} />
          <Field type="text" label="SIRET" inputMode="numeric" placeholder="12345678901234" value={form.siret} onChange={e => set('siret', e.target.value)} />
          <Field type="text" label="Paiement" placeholder="30 jours net" value={form.terms} onChange={e => set('terms', e.target.value)} />
        </div>
        <div className={local.sheetSection}>
          <Field type="textarea" label="Notes" rows={2} placeholder="Notes internes…" value={form.notes} onChange={e => set('notes', e.target.value)} />
        </div>
        {supplier && (
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => onArchive(supplier)}>Supprimer le fournisseur</button></li>
          </ListGroup>
        )}
        {error && <p className={screen.error} role="alert">{error}</p>}
      </div>
    </Sheet>
  )
}

/** Import CSV ou Excel en 3 étapes : fichier, colonnes, résultat. */
export function ImportSheet({ title, config, serverAction, onDone, onClose }: {
  title: string
  config: ImportConfig
  serverAction: (prev: ImportCatalogState, fd: FormData) => Promise<ImportCatalogState>
  onDone: () => void
  onClose: () => void
}) {
  const fileInput = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ImportCatalogState | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setParseError(null)
    setBusy(true)
    try {
      const { headers: hdrs, dataRows } = await parseFileToRows(file)
      if (hdrs.length === 0) { setParseError('Fichier vide ou format non reconnu.'); return }
      setHeaders(hdrs); setRows(dataRows); setMapping(autoMapColumns(config.fields, hdrs)); setStep(2)
    } catch {
      setParseError('Impossible de lire le fichier.')
    } finally {
      setBusy(false)
    }
  }

  async function run() {
    setBusy(true)
    const fd = new FormData()
    fd.set('items_json', JSON.stringify(mapImportRows(config.fields, rows, mapping)))
    const res = await serverAction({ error: null, imported: 0, skipped: 0, skipped_reasons: [] }, fd)
    setBusy(false)
    setResult(res)
    if (!res.error) { setStep(3); onDone() }
  }

  const required = config.fields.filter(f => f.required)
  const missing = required.some(f => mapping[f.key] === undefined || mapping[f.key] === '')

  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title={title} description={step === 1 ? 'Étape 1 sur 3 : le fichier' : step === 2 ? 'Étape 2 sur 3 : les colonnes' : 'Étape 3 sur 3 : le résultat'} cancelLabel={step === 3 ? 'Fermer' : 'Annuler'}>
      <div className={local.sheetBody}>
        {step === 1 && (
          <>
            <ListGroup description="Formats acceptés : CSV (séparateurs , ou ;) et Excel (.xlsx).">
              <ListRow title={busy ? 'Lecture du fichier…' : 'Choisir un fichier'} disabled={busy} className={styles.accentRow} onClick={() => fileInput.current?.click()} />
              <ListRow title="Télécharger le modèle CSV" description="Colonnes et exemple prêts à remplir." onClick={() => downloadCSVTemplate(config.fields, config.filename, config.exampleRow)} />
            </ListGroup>
            <input ref={fileInput} className={local.hiddenInput} type="file" accept=".csv,.xlsx,.xls" tabIndex={-1} aria-label="Choisir un fichier d’import" onChange={onFile} />
            {parseError && <p className={screen.error} role="alert">{parseError}</p>}
          </>
        )}
        {step === 2 && (
          <>
            <p className={screen.note} style={{ margin: '0 4px' }}>{rows.length} ligne{rows.length > 1 ? 's' : ''} détectée{rows.length > 1 ? 's' : ''}. Associez chaque champ à une colonne de votre fichier.</p>
            <div className={styles.fields}>
              {config.fields.map(({ key, label, required: req }) => (
                <Field key={key} type="select" label={`${label}${req ? ' *' : ''}`} value={mapping[key] ?? ''} onChange={e => setMapping(prev => ({ ...prev, [key]: e.target.value }))}>
                  <option value="">Ignorer</option>
                  {headers.map((h, i) => <option key={i} value={String(i)}>{`Colonne ${i + 1} : ${h}${rows[0]?.[i] ? ` (ex : ${rows[0][i]})` : ''}`}</option>)}
                </Field>
              ))}
            </div>
            {result?.error && <p className={screen.error} role="alert">{result.error}</p>}
            <div className={local.cta}>
              <Button size="lg" loading={busy} disabled={missing} onClick={run}>{`Importer ${rows.length} ligne${rows.length > 1 ? 's' : ''}`}</Button>
            </div>
            <Button variant="text" size="md" onClick={() => setStep(1)}>Choisir un autre fichier</Button>
          </>
        )}
        {step === 3 && result && (
          <ListGroup title="Import réussi" description={result.skipped > 0 ? 'Les lignes ignorées sont listées ci-dessous.' : undefined}>
            <ListRow title="Éléments importés" trailing={<StatusPill status="success">{result.imported}</StatusPill>} />
            {result.skipped > 0 && <ListRow title="Lignes ignorées" trailing={<StatusPill status="wait">{result.skipped}</StatusPill>} />}
            {result.skipped_reasons?.map((r, i) => <ListRow key={i} title={r} />)}
          </ListGroup>
        )}
      </div>
    </Sheet>
  )
}
