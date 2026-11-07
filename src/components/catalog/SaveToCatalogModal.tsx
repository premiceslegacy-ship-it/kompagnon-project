'use client'
// @atelier-migrated

import { useId, useState } from 'react'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { createMaterialQuick, createLaborRateQuick } from '@/lib/data/mutations/catalog'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import styles from '@/app/(app)/finances/quote-editor/QuoteEditor.module.css'

const fmt = (n: number) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(n)

// ─── Types ────────────────────────────────────────────────────────────────────

export type SaveToCatalogSource = {
  description: string
  unit: string
  unit_price: number
  vat_rate: number
  // dimensions optionnelles
  length_m?: number | null
  width_m?: number | null
  height_m?: number | null
  dimension_pricing_mode?: 'none' | 'linear' | 'area' | 'volume' | null
  // hints pour pré-sélectionner le type
  hint?: 'material' | 'service' | 'labor' | 'equipment'
}

export type SaveToCatalogResult =
  | { kind: 'material'; id: string }
  | { kind: 'labor'; id: string }

type CatalogEntryKind = 'material' | 'service' | 'labor' | 'equipment'

type LaborSubtype = 'human' | 'machine' | 'equipment' | 'subcontractor' | 'other'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function deriveDimMode(src: SaveToCatalogSource): 'none' | 'linear' | 'area' | 'volume' {
  const m = src.dimension_pricing_mode
  if (m === 'linear' || m === 'area' || m === 'volume') return m
  return 'none'
}

type KindOption = {
  value: CatalogEntryKind
  label: string
  sublabel: string
}

// ─── Composant principal ──────────────────────────────────────────────────────

export default function SaveToCatalogModal({
  source,
  catalogContext,
  existingCategories,
  onClose,
  onSaved,
}: {
  source: SaveToCatalogSource
  catalogContext: ResolvedCatalogContext
  existingCategories?: { material: string[]; service: string[]; labor: string[] }
  onClose: () => void
  onSaved: (result: SaveToCatalogResult) => void
}) {
  const labels = catalogContext.labelSet
  const dc = catalogContext.defaultCategories

  // ── Options de type selon profil ──────────────────────────────────────────
  const kindOptions: KindOption[] = [
    { value: 'material', label: labels.material.singular, sublabel: 'Produit ou fourniture avec prix de vente et coût d’achat' },
    { value: 'service', label: labels.service.singular, sublabel: 'Prestation ou opération facturée à l’unité ou au forfait' },
    { value: 'labor', label: labels.laborRate.singular, sublabel: 'Ressource interne : main-d’œuvre, machine ou équipement amorti' },
  ]

  // ── State ─────────────────────────────────────────────────────────────────
  const initialKind: CatalogEntryKind | null =
    source.hint === 'material' ? 'material'
    : source.hint === 'service' ? 'service'
    : source.hint === 'labor' ? 'labor'
    : source.hint === 'equipment' ? 'equipment'
    : null

  const [step, setStep] = useState<1 | 2>(initialKind ? 2 : 1)
  const [kind, setKind] = useState<CatalogEntryKind | null>(initialKind)

  // Champs communs
  const [name, setName] = useState(source.description.split('\n')[0].trim())
  const [category, setCategory] = useState('')

  // Champs matière / service
  const [salePrice, setSalePrice] = useState(source.unit_price)
  const [purchasePrice, setPurchasePrice] = useState<number | null>(null)
  const [vatRate, setVatRate] = useState(source.vat_rate ?? 20)

  // Champs ressource interne
  const [laborSubtype, setLaborSubtype] = useState<LaborSubtype>('human')
  const [laborRate, setLaborRate] = useState(source.unit_price)
  const [laborCost, setLaborCost] = useState<number | null>(null)
  const [equipPurchase, setEquipPurchase] = useState<number | null>(null)
  const [equipUses, setEquipUses] = useState<number | null>(100)

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const listId = useId()
  const dimMode = deriveDimMode(source)
  const isEquipment = laborSubtype === 'equipment'

  // Suggestions de catégories selon le type
  const categorySuggestions: string[] = Array.from(new Set([
    ...(kind === 'material' ? dc.material : kind === 'service' ? dc.service : dc.laborRate),
    ...(kind === 'material' ? (existingCategories?.material ?? [])
      : kind === 'service' ? (existingCategories?.service ?? [])
      : (existingCategories?.labor ?? [])),
  ]))

  // Labels ressource interne
  const rui = catalogContext.laborRateUi

  function selectKind(k: CatalogEntryKind) {
    setKind(k)
    if (k === 'equipment') setLaborSubtype('equipment')
    setStep(2)
  }

  // ── Sauvegarde ────────────────────────────────────────────────────────────
  async function handleSave() {
    if (!kind || !name.trim()) return
    setPending(true)
    setError(null)
    try {
      if (kind === 'material' || kind === 'service') {
        const res = await createMaterialQuick({
          name: name.trim(),
          item_kind: kind === 'service' ? 'service' : 'article',
          unit: source.unit || null,
          sale_price: salePrice,
          purchase_price: purchasePrice,
          vat_rate: vatRate,
          dimension_pricing_mode: dimMode,
          base_length_m: source.length_m ?? null,
          base_width_m: source.width_m ?? null,
          base_height_m: source.height_m ?? null,
          category: category.trim() || null,
        })
        if (res.error || !res.material) { setError(res.error ?? 'Erreur'); return }
        onSaved({ kind: 'material', id: res.material.id })
      } else {
        // labor ou equipment
        const rateVal = laborRate
        const costVal = laborCost ?? rateVal
        const purchaseVal = equipPurchase
        const usesVal = equipUses
        const res = await createLaborRateQuick({
          designation: name.trim(),
          rate: rateVal,
          cost_rate: costVal,
          unit: source.unit || 'h',
          type: laborSubtype,
          category: category.trim() || null,
          purchase_price: isEquipment ? purchaseVal : null,
          lifetime_uses: isEquipment ? usesVal : null,
        })
        if (res.error || !res.laborRate) { setError(res.error ?? 'Erreur'); return }
        onSaved({ kind: 'labor', id: res.laborRate.id })
      }
    } finally {
      setPending(false)
    }
  }

  const canSave = !!kind && name.trim().length > 0

  const kindLabel = kind === 'material' ? labels.material.singular : kind === 'service' ? labels.service.singular : labels.laborRate.singular
  const costPerUse = isEquipment && equipPurchase && equipUses && equipPurchase > 0 && equipUses > 0
    ? fmt(equipPurchase / equipUses)
    : null

  return (
    <Sheet
      open
      onOpenChange={open => { if (!open && !pending) onClose() }}
      title="Enregistrer dans le catalogue"
      description={step === 2 && kind ? kindLabel : 'Quel type d’élément voulez-vous créer ?'}
      onCancel={step === 2 && !initialKind ? () => setStep(1) : undefined}
      cancelLabel={step === 2 && !initialKind ? 'Retour' : 'Annuler'}
      onConfirm={step === 2 ? handleSave : undefined}
      confirmLabel="Enregistrer"
      confirmLoading={pending}
      confirmDisabled={!canSave}
    >
      <div className={styles.detail}>
        {step === 1 && (
          <ListGroup>
            {kindOptions.map(opt => (
              <ListRow
                key={opt.value}
                title={opt.label}
                description={opt.sublabel}
                onClick={() => selectKind(opt.value)}
              />
            ))}
          </ListGroup>
        )}

        {step === 2 && kind && (
          <>
            {error && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{error}</p>}
            <ListGroup>
              <ListRow
                title="Prix unitaire de la ligne"
                trailing={<span className={styles.fieldValue}>{fmt(source.unit_price)} / {source.unit || 'u'}</span>}
              />
              {dimMode !== 'none' && <ListRow title="Mode tarifaire" trailing={<span className={styles.fieldValue}>{dimMode}</span>} />}
            </ListGroup>

            <div className={styles.fields}>
              <Field type="text" label="Désignation" placeholder="Nom dans le catalogue" value={name} onChange={e => setName(e.target.value)} />
              <Field
                type="text"
                label="Catégorie"
                hint="Facultatif."
                placeholder={categorySuggestions[0] ?? 'Catégorie'}
                list={listId}
                value={category}
                onChange={e => setCategory(e.target.value)}
              />
              <datalist id={listId}>
                {categorySuggestions.map(sug => <option key={sug} value={sug} />)}
              </datalist>
            </div>

            {(kind === 'material' || kind === 'service') && (
              <div className={styles.fields}>
                <Field type="number" label="Prix de vente HT" min={0} decimals={2} allowEmpty={false} value={salePrice} onChange={v => setSalePrice(v ?? 0)} />
                {kind === 'material' && (
                  <Field type="number" label="Prix d’achat HT" hint="Facultatif." min={0} decimals={2} allowEmpty value={purchasePrice} onChange={setPurchasePrice} />
                )}
                <Field type="number" label="TVA (%)" min={0} decimals={1} allowEmpty={false} value={vatRate} onChange={v => setVatRate(v ?? 0)} />
              </div>
            )}

            {(kind === 'labor' || kind === 'equipment') && (
              <>
                <Field type="select" label="Type de ressource" value={laborSubtype} onChange={e => setLaborSubtype(e.target.value as LaborSubtype)}>
                  <option value="human">{rui.typeHumanLabel}</option>
                  <option value="machine">{rui.typeMachineLabel}</option>
                  <option value="equipment">{rui.typeEquipmentLabel}</option>
                  <option value="subcontractor">{rui.typeSubcontractorLabel}</option>
                  <option value="other">{rui.typeOtherLabel}</option>
                </Field>
                <div className={styles.fields}>
                  <Field type="number" label={rui.rateLabel} min={0} decimals={2} allowEmpty={false} value={laborRate} onChange={v => setLaborRate(v ?? 0)} />
                  <Field type="number" label={rui.costLabel} hint="Facultatif." min={0} decimals={2} allowEmpty value={laborCost} onChange={setLaborCost} />
                </div>
                {isEquipment && (
                  <>
                    <div className={styles.fields}>
                      <Field type="number" label="Prix d’achat (€)" min={0} decimals={0} allowEmpty value={equipPurchase} onChange={setEquipPurchase} />
                      <Field type="number" label="Nombre d’usages" min={1} decimals={0} allowEmpty value={equipUses} onChange={setEquipUses} />
                    </div>
                    {costPerUse && <p className={styles.hint} style={{ marginTop: 0 }}>Amortissement : {costPerUse} par usage.</p>}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  )
}
