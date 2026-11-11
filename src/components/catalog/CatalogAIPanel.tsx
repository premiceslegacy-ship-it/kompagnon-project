'use client'
// @atelier-migrated

import { useState, useRef, useCallback, useEffect } from 'react'
import type {
  CatalogDraftItem,
  CatalogDraftMaterial,
  CatalogDraftLaborRate,
  CatalogDraftPrestationType,
  CatalogDraftSupplier,
  CatalogExtractResult,
} from '@/app/api/ai/catalog-extract/route'
import { bulkCreateFromAI } from '@/lib/data/mutations/catalog-bulk'
import { AI_NAME } from '@/lib/brand'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import styles from '@/app/(app)/finances/quote-editor/QuoteEditor.module.css'

type Mode = 'voice' | 'text' | 'pdf' | 'presets'

const ACCEPTED_FILE_TYPES = '.pdf,application/pdf,.png,.jpg,.jpeg,image/png,image/jpeg,image/jpg'
const ACCEPTED_MIME_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'])

const KIND_LABELS: Record<string, string> = {
  material: 'Produit / Matière',
  service: 'Service',
  labor_rate: 'Ressource interne',
  prestation_type: 'Modèle de devis',
  supplier: 'Fournisseur',
}

const DIM_MODE_LABELS: Record<string, string> = {
  none: 'Forfait / Unité',
  linear: 'Linéaire (ml)',
  area: 'Surface (m²)',
  volume: 'Volume (m³)',
}

const LABOR_TYPE_LABELS: Record<string, string> = {
  human: 'Humain',
  machine: 'Machine',
  equipment: 'Équipement',
  subcontractor: 'Sous-traitant',
  other: 'Autre',
}

const DEFAULT_CATEGORIES: Record<string, string[]> = {
  material: ['Fournitures chantier', 'Matière première', 'Plomberie', 'Électricité', 'Consommables', 'Finition'],
  service: ['Pose', 'Main-d\'œuvre', 'Dépannage', 'Maintenance', 'Mise en service', 'Prestation'],
  labor_rate: ['Taux chantier', 'Encadrement', 'Sous-traitance', 'Machine', 'Équipe'],
  prestation_type: ['Installation type', 'Dépannage', 'Entretien', 'Rénovation'],
  supplier: [],
}

function getItemName(item: CatalogDraftItem): string {
  if (item.kind === 'labor_rate') return (item as CatalogDraftLaborRate).designation
  if (item.kind === 'supplier') return (item as CatalogDraftSupplier).name
  if (item.kind === 'material' || item.kind === 'service') return (item as CatalogDraftMaterial).name
  if (item.kind === 'prestation_type') return (item as CatalogDraftPrestationType).name
  return ''
}

function getItemCategory(item: CatalogDraftItem): string | null | undefined {
  if (item.kind === 'supplier') return null
  return (item as CatalogDraftMaterial | CatalogDraftLaborRate | CatalogDraftPrestationType).category
}

function getCompactTabLabel(label: string): string {
  return label.trim().split(/\s+/)[0] || label
}


type Props = {
  open: boolean
  onClose: () => void
  onCreated: (count: number) => void
  bundleTemplateLabel?: string
  bundleTemplatePluralLabel?: string
  activityLabel?: string
  activityDescription?: string | null
}

export default function CatalogAIPanel({
  open,
  onClose,
  onCreated,
  bundleTemplateLabel = 'Modèle de devis',
  bundleTemplatePluralLabel,
  activityLabel,
  activityDescription,
}: Props) {
  const [mode, setMode] = useState<Mode>('voice')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [items, setItems] = useState<CatalogDraftItem[]>([])
  const [currentPage, setCurrentPage] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [presetsDescription, setPresetsDescription] = useState('')
  const [presetsCustomMode, setPresetsCustomMode] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) {
      setMode('voice')
      setText('')
      setFile(null)
      setItems([])
      setError(null)
      setSuccessMsg(null)
      setIsRecording(false)
      setPresetsDescription('')
      setPresetsCustomMode(false)
    }
  }, [open])

  useEffect(() => () => { mediaRecorderRef.current?.stop() }, [])

  const startRecording = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop())
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
        setIsTranscribing(true)
        try {
          const fd = new FormData()
          fd.append('audio', blob, 'recording.webm')
          const res = await fetch('/api/ai/transcribe-audio', { method: 'POST', body: fd })
          const data = await res.json()
          if (!res.ok) setError(data?.code === 'permission_denied' ? 'Vous n’avez pas accès à la transcription vocale.' : 'La transcription vocale n’a pas abouti. Réessayez dans un instant.')
          else setText(data.text ?? '')
        } catch {
          setError("Impossible de transcrire l'audio.")
        } finally {
          setIsTranscribing(false)
        }
      }
      mediaRecorderRef.current = recorder
      recorder.start()
      setIsRecording(true)
    } catch {
      setError('Accès micro refusé ou non disponible.')
    }
  }, [])

  const stopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop()
    setIsRecording(false)
  }, [])

  async function handleAnalyze() {
    if (isRecording) stopRecording()
    setIsAnalyzing(true)
    setError(null)
    setItems([])
    setCurrentPage(0)
    setSuccessMsg(null)
    try {
      let res: Response
      if (mode === 'presets') {
        res = await fetch('/api/ai/catalog-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'presets', description: presetsDescription }),
        })
      } else if (mode === 'pdf' && file) {
        const formData = new FormData()
        formData.append('file', file)
        res = await fetch('/api/ai/catalog-extract', { method: 'POST', body: formData })
      } else {
        res = await fetch('/api/ai/catalog-extract', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      }
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 400 && typeof data.error === 'string') {
          setError(data.error)
        } else if (data?.code === 'permission_denied' || res.status === 403) {
          setError('L’extraction du catalogue n’est pas disponible pour ce compte.')
        } else if (res.status === 429) {
          setError('Trop de demandes. Réessayez dans un instant.')
        } else {
          setError('L’analyse du catalogue n’a pas abouti. Réessayez dans un instant.')
        }
      } else {
        const result = data as CatalogExtractResult
        setItems(result.items ?? [])
        if ((result.items ?? []).length === 0) setError("L'IA n'a détecté aucun élément de catalogue.")
      }
    } catch {
      setError("Impossible de contacter l'IA. Vérifiez votre connexion.")
    } finally {
      setIsAnalyzing(false)
    }
  }

  function handleUpdateItem(idx: number, updated: CatalogDraftItem) {
    setItems(prev => prev.map((item, i) => i === idx ? updated : item))
  }

  async function handleCreateAll() {
    if (items.length === 0) return
    setIsCreating(true)
    setError(null)
    setSuccessMsg(null)
    try {
      const result = await bulkCreateFromAI(items)
      if (result.created > 0) {
        setSuccessMsg(`${result.created} élément${result.created > 1 ? 's' : ''} créé${result.created > 1 ? 's' : ''} avec succès !`)
        onCreated(result.created)
        setItems([])
      }
      if (result.errors.length > 0) {
        setError(`${result.errors.length} erreur(s) : ${result.errors.map(e => e.error).join(', ')}`)
      }
    } catch {
      setError('Erreur lors de la création.')
    } finally {
      setIsCreating(false)
    }
  }

  const canAnalyze = mode === 'presets' ? true : mode === 'pdf' ? !!file : text.trim().length >= 5
  const bundlePlural = bundleTemplatePluralLabel ?? `${bundleTemplateLabel}s`
  const bundleTabLabel = getCompactTabLabel(bundlePlural)
  const bundleSingularLower = bundleTemplateLabel.toLowerCase()
  const bundlePluralLower = bundlePlural.toLowerCase()
  const activitySentence = activityLabel
    ? ` pour votre activité : ${activityLabel.toLowerCase()}`
    : ' pour votre activité'

  if (!open) return null

  const reviewing = items.length > 0 && !successMsg
  const showInput = items.length === 0 && !successMsg
  const modeOptions = [
    { value: 'voice', label: 'Voix' },
    { value: 'text', label: 'Texte' },
    { value: 'pdf', label: 'Document' },
    { value: 'presets', label: bundleTabLabel },
  ]
  const note = (message: string, warn = false) => (
    <p className={warn ? `${styles.hint} ${styles.warn}` : styles.hint} role={warn ? 'alert' : undefined} style={{ marginTop: 0 }}>{message}</p>
  )

  let confirmLabel = mode === 'presets' ? `Demander à ${AI_NAME}` : `Confier à ${AI_NAME}`
  let onConfirm: (() => void) | undefined = handleAnalyze
  let confirmLoading = isAnalyzing
  let confirmDisabled = !canAnalyze
  if (reviewing) {
    confirmLabel = `Tout créer (${items.length} élément${items.length > 1 ? 's' : ''})`
    onConfirm = handleCreateAll
    confirmLoading = isCreating
    confirmDisabled = false
  } else if (successMsg) {
    confirmLabel = 'Terminé'
    onConfirm = onClose
    confirmLoading = false
    confirmDisabled = false
  }

  return (
    <Sheet
      open
      onOpenChange={next => { if (!next) onClose() }}
      title={`${AI_NAME}, catalogue`}
      description="Dictez, écrivez ou importez un document : l’assistante prépare les fiches."
      cancelLabel="Fermer"
      onConfirm={onConfirm}
      confirmLabel={confirmLabel}
      confirmLoading={confirmLoading}
      confirmDisabled={confirmDisabled}
    >
      <div className={styles.detail}>
        {showInput && (
          <>
            <SegmentedControl
              fullWidth
              label="Mode de saisie"
              value={mode}
              options={modeOptions}
              onChange={v => { setMode(v as Mode); setText(''); setFile(null); setError(null); setPresetsCustomMode(false) }}
            />

            {mode === 'voice' && (
              <>
                {note(`Décrivez vos produits, matières, services, ressources ou fournisseurs. ${AI_NAME} les range dans le bon onglet.`)}
                <div className={styles.inline}>
                  <Button variant="secondary" size="lg" onClick={isRecording ? stopRecording : startRecording} loading={isTranscribing} loadingText="Transcription…">
                    {isRecording ? 'Arrêter l’enregistrement' : 'Parler'}
                  </Button>
                </div>
                {text && <ListGroup title="Transcription"><ListRow title={text} /></ListGroup>}
              </>
            )}

            {mode === 'text' && (
              <div className={styles.fields}>
                <Field
                  type="textarea"
                  label="Contenu"
                  rows={8}
                  placeholder="Tôle acier S235 2 mm, plaque 1 m × 1 m, 25,50 € à l’achat, marge 40 %. Service découpe laser au ml à 8 €. Fournisseur ArcelorMittal…"
                  value={text}
                  onChange={e => setText(e.target.value)}
                />
              </div>
            )}

            {mode === 'presets' && (
              !presetsCustomMode ? (
                <>
                  {note(`${AI_NAME} prépare 5 à 8 ${bundlePluralLower} adaptés${activitySentence}. ${activityDescription ?? ''}`.trim())}
                  <div className={styles.fields}>
                    <Field
                      type="textarea"
                      label="Description"
                      hint="Facultatif."
                      rows={3}
                      placeholder="Surtout des rénovations de salles de bain et des dépannages plomberie urgents…"
                      value={presetsDescription}
                      onChange={e => setPresetsDescription(e.target.value)}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className={styles.inline}>
                    <Button variant="text" size="sm" onClick={() => setPresetsCustomMode(false)}>Retour aux suggestions automatiques</Button>
                  </div>
                  <div className={styles.fields}>
                    <Field
                      type="textarea"
                      label={`Décrivez le ${bundleSingularLower}`}
                      rows={6}
                      placeholder="Pose d’un tableau électrique 13 modules avec remplacement des disjoncteurs, environ 4 h de main-d’œuvre…"
                      value={presetsDescription}
                      onChange={e => setPresetsDescription(e.target.value)}
                    />
                  </div>
                </>
              )
            )}

            {mode === 'pdf' && (
              <>
                {note('PDF, PNG ou JPEG : cahier des charges, catalogue fournisseur, modèle papier scanné…')}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPTED_FILE_TYPES}
                  hidden
                  aria-label="Document à analyser"
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) { setFile(f); setError(null) }
                    e.target.value = ''
                  }}
                />
                {!file ? (
                  <div
                    className={styles.inline}
                    onDragOver={e => e.preventDefault()}
                    onDrop={e => {
                      e.preventDefault()
                      const dropped = e.dataTransfer.files[0]
                      if (dropped && ACCEPTED_MIME_TYPES.has(dropped.type)) { setFile(dropped); setError(null) }
                      else setError('Formats acceptés : PDF, PNG, JPEG')
                    }}
                  >
                    <Button variant="secondary" size="md" onClick={() => fileInputRef.current?.click()}>Choisir un document</Button>
                  </div>
                ) : (
                  <ListGroup>
                    <ListRow
                      title={file.name}
                      description={`${(file.size / 1024).toFixed(0)} Ko`}
                      trailing={<Button variant="text" size="sm" onClick={() => setFile(null)}>Retirer</Button>}
                    />
                  </ListGroup>
                )}
              </>
            )}

            {error && note(error, true)}
          </>
        )}

        {successMsg && (
          <>
            {note(successMsg)}
            {error && note(error, true)}
          </>
        )}

        {reviewing && (
          <>
            {note(`${items.length} ${mode === 'presets' ? bundleSingularLower : 'élément'}${items.length > 1 ? 's' : ''} ${mode === 'presets' ? 'proposé' : 'détecté'}${items.length > 1 ? 's' : ''}. Relisez, corrigez, supprimez ce qui ne convient pas.`)}
            <div className={styles.inline}>
              <Button variant="text" size="sm" onClick={() => { setItems([]); setCurrentPage(0); setError(null) }}>Recommencer</Button>
              {mode === 'presets' && (
                <Button
                  variant="text"
                  size="sm"
                  onClick={() => { setItems([]); setCurrentPage(0); setError(null); setPresetsCustomMode(true); setPresetsDescription('') }}
                >
                  {`Décrire un ${bundleSingularLower} précis`}
                </Button>
              )}
            </div>
            {error && note(error, true)}
            <ItemReviewCard
              key={currentPage}
              item={items[currentPage]}
              onRemove={() => {
                const next = items.filter((_, i) => i !== currentPage)
                setItems(next)
                setCurrentPage(p => Math.min(p, next.length - 1))
              }}
              onChange={updated => handleUpdateItem(currentPage, updated)}
            />
            <div className={styles.inline} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Button variant="secondary" size="sm" onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}>Précédent</Button>
              <span className={styles.fieldValue}>{currentPage + 1} / {items.length}</span>
              <Button variant="secondary" size="sm" onClick={() => setCurrentPage(p => Math.min(items.length - 1, p + 1))} disabled={currentPage === items.length - 1}>Suivant</Button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  )
}

// ─── Fiche de relecture ───────────────────────────────────────────────────────

function ItemReviewCard({
  item,
  onRemove,
  onChange,
}: {
  item: CatalogDraftItem
  onRemove: () => void
  onChange: (updated: CatalogDraftItem) => void
}) {
  const hasLow = Object.values(item.confidence ?? {}).some(v => v === 'low')

  function patch(field: string, value: unknown) {
    onChange({ ...item, [field]: value } as CatalogDraftItem)
  }
  function patchNested(parentField: string, idx: number, field: string, value: unknown) {
    const arr = [...(((item as unknown) as Record<string, unknown[]>)[parentField] ?? [])] as Record<string, unknown>[]
    arr[idx] = { ...arr[idx], [field]: value }
    onChange({ ...item, [parentField]: arr } as CatalogDraftItem)
  }

  const category = getItemCategory(item)
  return (
    <>
      <ListGroup>
        <ListRow
          title={getItemName(item) || 'Sans nom'}
          description={[KIND_LABELS[item.kind] ?? item.kind, category, hasLow ? 'À vérifier' : null].filter(Boolean).join(' · ')}
          trailing={<Button variant="text" size="sm" onClick={onRemove}>Supprimer</Button>}
        />
      </ListGroup>
      {(item.kind === 'material' || item.kind === 'service') && <MaterialFields item={item as CatalogDraftMaterial} patch={patch} />}
      {item.kind === 'labor_rate' && <LaborRateFields item={item as CatalogDraftLaborRate} patch={patch} />}
      {item.kind === 'prestation_type' && <PrestationTypeFields item={item as CatalogDraftPrestationType} patch={patch} patchNested={patchNested} />}
      {item.kind === 'supplier' && <SupplierFields item={item as CatalogDraftSupplier} patch={patch} />}
    </>
  )
}

// ─── Champs de relecture ──────────────────────────────────────────────────────

type Patch = (f: string, v: unknown) => void

function isLow(item: CatalogDraftItem, field: string) {
  return (item.confidence?.[field] ?? 'high') === 'low'
}

const LOW_HINT = 'À vérifier : lu avec un doute.'
const VAT_RATES = [0, 5.5, 10, 20]

function Txt({ item, field, label, patch, value, nullable = false, type = 'text', list, placeholder }: {
  item: CatalogDraftItem
  field: string
  label: string
  patch: Patch
  value: string | null | undefined
  nullable?: boolean
  type?: 'text' | 'email' | 'tel'
  list?: string
  placeholder?: string
}) {
  return (
    <Field
      type={type}
      label={label}
      hint={isLow(item, field) ? LOW_HINT : undefined}
      list={list}
      placeholder={placeholder}
      value={value ?? ''}
      onChange={e => patch(field, nullable ? (e.target.value || null) : e.target.value)}
    />
  )
}

function Num({ item, field, label, patch, value, decimals = 2, fallback }: {
  item: CatalogDraftItem
  field: string
  label: string
  patch: Patch
  value: number | null | undefined
  decimals?: number
  fallback?: number
}) {
  return (
    <Field
      type="number"
      label={label}
      hint={isLow(item, field) ? LOW_HINT : undefined}
      decimals={decimals}
      allowEmpty
      value={value ?? null}
      onChange={v => patch(field, v ?? fallback ?? null)}
    />
  )
}

function VatField({ item, patch, value }: { item: CatalogDraftItem; patch: Patch; value: number }) {
  return (
    <Field type="select" label="TVA" hint={isLow(item, 'vat_rate') ? LOW_HINT : undefined} value={String(value)} onChange={e => patch('vat_rate', parseFloat(e.target.value))}>
      {VAT_RATES.map(r => <option key={r} value={r}>{r} %</option>)}
    </Field>
  )
}

function MaterialFields({ item, patch }: { item: CatalogDraftMaterial; patch: Patch }) {
  const computedSale = item.purchase_price != null && item.margin_rate != null
    ? Math.round(item.purchase_price * (1 + item.margin_rate / 100) * 100) / 100
    : item.sale_price ?? null
  const listId = `cat-list-${item.kind}`
  return (
    <div className={styles.fields}>
      <Txt item={item} field="name" label="Désignation" patch={patch} value={item.name} />
      <Txt item={item} field="reference" label="Référence" patch={patch} value={item.reference} nullable placeholder="Automatique" />
      <Txt item={item} field="category" label="Catégorie" patch={patch} value={item.category} nullable list={listId} placeholder="Fournitures chantier" />
      <datalist id={listId}>{(DEFAULT_CATEGORIES[item.kind] ?? []).map(cat => <option key={cat} value={cat} />)}</datalist>
      <Txt item={item} field="unit" label="Unité" patch={patch} value={item.unit} />
      <Num item={item} field="purchase_price" label="Coût d’achat HT (€)" patch={patch} value={item.purchase_price} />
      <Num item={item} field="margin_rate" label="Marge (%)" patch={patch} value={item.margin_rate} decimals={1} fallback={0} />
      <Num item={item} field="sale_price" label="Prix de vente HT (€)" patch={patch} value={computedSale} />
      <VatField item={item} patch={patch} value={item.vat_rate} />
      <Field type="select" label="Mode de tarification" hint={isLow(item, 'dimension_pricing_mode') ? LOW_HINT : undefined} value={item.dimension_pricing_mode ?? 'none'} onChange={e => patch('dimension_pricing_mode', e.target.value)}>
        {Object.entries(DIM_MODE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Field>
      {item.supplier_name != null && <Txt item={item} field="supplier_name" label="Fournisseur" patch={patch} value={item.supplier_name} nullable />}
    </div>
  )
}

function LaborRateFields({ item, patch }: { item: CatalogDraftLaborRate; patch: Patch }) {
  return (
    <div className={styles.fields}>
      <Txt item={item} field="designation" label="Désignation" patch={patch} value={item.designation} />
      <Field type="select" label="Type" hint={isLow(item, 'type') ? LOW_HINT : undefined} value={item.type} onChange={e => patch('type', e.target.value)}>
        {Object.entries(LABOR_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </Field>
      <Txt item={item} field="category" label="Catégorie" patch={patch} value={item.category} nullable list="cat-list-labor_rate" placeholder="Taux chantier" />
      <datalist id="cat-list-labor_rate">{DEFAULT_CATEGORIES.labor_rate.map(cat => <option key={cat} value={cat} />)}</datalist>
      <Txt item={item} field="unit" label="Unité" patch={patch} value={item.unit} />
      <Num item={item} field="cost_rate" label="Coût interne (€)" patch={patch} value={item.cost_rate} />
      <Num item={item} field="rate" label="Taux de facturation (€)" patch={patch} value={item.rate} fallback={0} />
      <VatField item={item} patch={patch} value={item.vat_rate} />
    </div>
  )
}

function PrestationTypeFields({ item, patch, patchNested }: {
  item: CatalogDraftPrestationType
  patch: Patch
  patchNested: (parent: string, idx: number, field: string, value: unknown) => void
}) {
  return (
    <>
      <div className={styles.fields}>
        <Txt item={item} field="name" label="Nom" patch={patch} value={item.name} />
        <Txt item={item} field="category" label="Catégorie" patch={patch} value={item.category} nullable />
        <Txt item={item} field="unit" label="Unité" patch={patch} value={item.unit} />
        <VatField item={item} patch={patch} value={item.vat_rate} />
        <Num item={item} field="base_price_ht" label="Prix HT (€)" patch={patch} value={item.base_price_ht} fallback={0} />
        <Num item={item} field="base_cost_ht" label="Coût HT (€)" patch={patch} value={item.base_cost_ht} fallback={0} />
        {item.description !== undefined && <Txt item={item} field="description" label="Description" patch={patch} value={item.description} nullable />}
      </div>
      {item.lines && item.lines.length > 0 && (
        <>
          <p className={styles.hint} style={{ marginTop: 0 }}>{item.lines.length} ligne{item.lines.length > 1 ? 's' : ''}</p>
          {item.lines.map((line, i) => (
            <div key={i} className={styles.fields}>
              <Field type="text" label={`Ligne ${i + 1}`} placeholder="Désignation" value={line.designation} onChange={e => patchNested('lines', i, 'designation', e.target.value)} />
              <Field type="number" label="Quantité" decimals={2} allowEmpty={false} value={line.quantity} onChange={v => patchNested('lines', i, 'quantity', v ?? 1)} />
              <Field type="text" label="Unité" value={line.unit} onChange={e => patchNested('lines', i, 'unit', e.target.value)} />
              <Field type="number" label="Prix unitaire HT (€)" decimals={2} allowEmpty value={line.unit_price_ht ?? null} onChange={v => patchNested('lines', i, 'unit_price_ht', v)} />
            </div>
          ))}
        </>
      )}
    </>
  )
}

function SupplierFields({ item, patch }: { item: CatalogDraftSupplier; patch: Patch }) {
  return (
    <div className={styles.fields}>
      <Txt item={item} field="name" label="Nom" patch={patch} value={item.name} />
      <Txt item={item} field="contact_name" label="Contact" patch={patch} value={item.contact_name} nullable />
      <Txt item={item} field="email" label="Email" patch={patch} value={item.email} nullable type="email" />
      <Txt item={item} field="phone" label="Téléphone" patch={patch} value={item.phone} nullable type="tel" />
      <Txt item={item} field="siret" label="SIRET" patch={patch} value={item.siret} nullable />
      <Txt item={item} field="payment_terms" label="Conditions de paiement" patch={patch} value={item.payment_terms} nullable />
      <Txt item={item} field="address" label="Adresse" patch={patch} value={item.address} nullable />
    </div>
  )
}
