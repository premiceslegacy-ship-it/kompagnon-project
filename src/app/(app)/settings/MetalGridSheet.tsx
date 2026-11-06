'use client'
// @atelier-migrated
// Devis : une grille de prix matière (création, modification, suppression).

import { useActionState, useEffect, useRef, useState, useTransition } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Field } from '@/components/ui/Field'
import { ListGroup } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { createMetalPriceGrid, deleteMetalPriceGrid, updateMetalPriceGrid, type MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import type { CatalogMaterial } from '@/lib/data/queries/catalog'
import type { Supplier } from '@/lib/data/queries/suppliers'
import { METAL_CODES, METAL_LABELS, type MetalCode } from '@/lib/metal-prices'
import { GRID_UNITS } from './devisModel'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

const INITIAL = { error: null as string | null, success: false }

type Props = {
  open: boolean
  /** Grille à modifier ; absente pour une nouvelle grille. */
  grid?: MetalPriceGrid
  materials: CatalogMaterial[]
  suppliers: Supplier[]
  onClose: () => void
}

/** Le formulaire repart de zéro à chaque ouverture : le parent change la `key`. */
export default function MetalGridSheet({ open, grid, materials, suppliers, onClose }: Props) {
  const [state, formAction, saving] = useActionState(grid ? updateMetalPriceGrid : createMetalPriceGrid, INITIAL)
  const formRef = useRef<HTMLFormElement>(null)
  const [deleting, startDelete] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [label, setLabel] = useState(grid?.label ?? '')
  const [metalCode, setMetalCode] = useState<MetalCode>(grid?.metal_code ?? 'ALU')
  const [sourceType, setSourceType] = useState<'lme' | 'manual'>(grid?.source_type ?? (grid?.metal_code === 'STEEL' ? 'manual' : 'lme'))
  const [unit, setUnit] = useState<string>(grid?.unit ?? 'kg')
  const [catalogItemId, setCatalogItemId] = useState(grid?.catalog_item_id ?? '')
  const [supplierId, setSupplierId] = useState(grid?.supplier_id ?? '')
  const [grade, setGrade] = useState(grid?.grade ?? '')
  const [thickness, setThickness] = useState<number | null>(grid?.thickness_mm ?? null)
  const [format, setFormat] = useState(grid?.format_label ?? '')
  const [price, setPrice] = useState<number | null>(grid?.manual_price_eur_kg ?? null)
  const [coefficient, setCoefficient] = useState<number | null>(grid?.coefficient ?? 1.35)

  useEffect(() => { if (state.success) onClose() }, [state.success]) // eslint-disable-line react-hooks/exhaustive-deps

  const articles = materials.filter(item => item.item_kind === 'article')
  const manual = sourceType === 'manual'
  const valid = label.trim() !== '' && (manual ? (price ?? 0) > 0 : (coefficient ?? 0) > 0)

  function changeMetal(code: MetalCode) {
    setMetalCode(code)
    setSourceType(code === 'STEEL' ? 'manual' : 'lme')
  }

  function changeCatalogItem(id: string) {
    setCatalogItemId(id)
    const material = articles.find(item => item.id === id)
    if (material?.unit && (GRID_UNITS as readonly string[]).includes(material.unit)) setUnit(material.unit)
    if (material?.supplier_id && !supplierId) setSupplierId(material.supplier_id)
  }

  function remove() {
    if (!grid) return
    startDelete(async () => {
      const result = await deleteMetalPriceGrid(grid.id)
      setConfirmDelete(false)
      if (result.error) { setDeleteError(result.error); return }
      onClose()
    })
  }

  return (
    <>
      <Sheet
        open={open}
        onOpenChange={o => { if (!o) onClose() }}
        title={grid ? 'Grille matière' : 'Nouvelle grille'}
        onConfirm={() => formRef.current?.requestSubmit()}
        confirmLabel={grid ? 'Enregistrer' : 'Ajouter'}
        confirmLoading={saving}
        confirmDisabled={!valid}
      >
        <form ref={formRef} action={formAction} className={local.sheetBody} onSubmit={e => { if (!valid) e.preventDefault() }}>
          {grid && <input type="hidden" name="id" value={grid.id} />}
          <input type="hidden" name="label" value={label} />
          <input type="hidden" name="metal_code" value={metalCode} />
          <input type="hidden" name="source_type" value={sourceType} />
          <input type="hidden" name="unit" value={unit} />
          <input type="hidden" name="catalog_item_id" value={catalogItemId} />
          <input type="hidden" name="supplier_id" value={supplierId} />
          <input type="hidden" name="grade" value={grade} />
          <input type="hidden" name="thickness_mm" value={thickness == null ? '' : String(thickness)} />
          <input type="hidden" name="format_label" value={format} />
          {manual
            ? <input type="hidden" name="manual_price_eur_kg" value={price == null ? '' : String(price)} />
            : <input type="hidden" name="coefficient" value={coefficient == null ? '' : String(coefficient)} />}

          <div className={styles.fields}>
            <Field type="text" label="Libellé" placeholder={metalCode === 'STEEL' ? 'Acier S235 fournisseur habituel' : 'Alu 2 mm fournisseur habituel'} value={label} onChange={e => setLabel(e.target.value)} />
            <Field type="select" label="Métal" value={metalCode} onChange={e => changeMetal(e.target.value as MetalCode)}>
              {METAL_CODES.map(code => <option key={code} value={code}>{METAL_LABELS[code]}</option>)}
            </Field>
            <Field type="select" label="Unité" value={unit} onChange={e => setUnit(e.target.value)}>
              {GRID_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
            </Field>
          </div>

          {metalCode === 'STEEL'
            ? <p className={styles.hint}>L’acier n’est pas coté sur le LME : le prix est saisi à la main et mis à jour par vos soins.</p>
            : (
              <SegmentedControl
                label="Source du prix"
                fullWidth
                value={sourceType}
                onChange={v => setSourceType(v as 'lme' | 'manual')}
                options={[{ value: 'lme', label: 'Cours LME' }, { value: 'manual', label: 'Prix fixe' }]}
              />
            )}

          <div>
            <div className={styles.fields}>
              {manual
                ? <Field type="number" label={`Prix fournisseur (€/${unit})`} min={0} decimals={2} placeholder="0,95" allowEmpty value={price} onChange={setPrice} />
                : <Field type="number" label="Coefficient" min={0} decimals={2} allowEmpty value={coefficient} onChange={setCoefficient} />}
            </div>
            <p className={styles.hint}>
              {manual ? 'Prix fixe : à mettre à jour quand votre fournisseur change ses tarifs.' : 'Prix final = cours LME × coefficient.'}
            </p>
          </div>

          <div>
            <div className={styles.fields}>
              <Field type="select" label="Matière catalogue" value={catalogItemId} onChange={e => changeCatalogItem(e.target.value)}>
                <option value="">Aucune</option>
                {articles.map(m => <option key={m.id} value={m.id}>{m.name}{m.reference ? ` · ${m.reference}` : ''}</option>)}
              </Field>
              <Field type="select" label="Fournisseur" value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">Aucun</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Field>
            </div>
            <p className={styles.hint}>La ligne de devis garde le lien catalogue, mais son prix vient de cette grille.</p>
          </div>

          <div className={styles.fields}>
            <Field type="text" label="Nuance" placeholder="S235, 304L, 5754" value={grade} onChange={e => setGrade(e.target.value)} />
            <Field type="number" label="Épaisseur (mm)" min={0} decimals={2} placeholder="2" allowEmpty value={thickness} onChange={setThickness} />
            <Field type="text" label="Format" placeholder="1000×2000, barre 6 m" value={format} onChange={e => setFormat(e.target.value)} />
          </div>

          {(state.error || deleteError) && <p className={screen.error} role="alert">{state.error ?? deleteError}</p>}
        </form>

        {grid && (
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirmDelete(true)}>Supprimer la grille</button></li>
          </ListGroup>
        )}
      </Sheet>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Supprimer « ${grid?.label ?? ''} » ?`}
        description="Les devis déjà validés ne changent pas."
        confirmLabel="Supprimer"
        confirmLoading={deleting}
        onConfirm={remove}
      />
    </>
  )
}
