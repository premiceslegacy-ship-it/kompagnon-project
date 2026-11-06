'use client'
// @atelier-migrated

import { useState } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { MEASUREMENT_TRADE_LABELS, type PlanMeasurementItem } from '@/lib/plan-measurement'
import type { AtelierIA } from './useAtelierIA'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

const NB = ' '

function confidenceStatus(confidence: number | null | undefined) {
  if (confidence == null) return { label: 'n/a', status: 'neutral' as const }
  const pct = `${Math.round(confidence * 100)}${NB}%`
  return { label: pct, status: confidence >= 0.8 ? 'success' as const : confidence >= 0.6 ? 'wait' as const : 'danger' as const }
}

const sourceLabel = (kind: PlanMeasurementItem['sourceKind']) => kind === 'measured' ? 'Mesuré' : kind === 'derived' ? 'Dérivé' : 'Provision estimative'

/** Une ligne du pré-métré : tous les champs modifiables, dans une feuille. */
function ItemSheet({ q, index, onClose }: { q: AtelierIA; index: number; onClose: () => void }) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const item = q.measurement?.items[index]
  if (!item) return null
  const update = (patch: Partial<PlanMeasurementItem>) => q.updateMeasurementItem(index, patch)
  const dims = [['Longueur L', 'length_m'], ['Largeur W', 'width_m'], ['Hauteur H', 'height_m']] as const
  return (
    <>
      <Sheet open onOpenChange={open => { if (!open) onClose() }} title="Ligne du métré" cancelLabel="Fermer" onConfirm={onClose} confirmLabel="OK">
        <div className={styles.detail}>
          <div className={styles.fields}>
            <Field type="text" label="Pièce" value={item.roomName} onChange={e => update({ roomName: e.target.value })} />
            <Field type="text" label="Poste" value={item.designation} onChange={e => update({ designation: e.target.value })} />
            <Field type="number" label="Quantité" min={0} decimals={2} value={Number.isFinite(item.quantity) ? item.quantity : 0}
              onChange={v => { const quantity = Math.max(0, v ?? 0); update({ quantity, formulaVariables: { ...item.formulaVariables, quantity } }) }} />
            <Field type="text" label="Unité" value={item.unit} onChange={e => update({ unit: e.target.value })} />
          </div>

          <ListGroup title="Cotes" description="Corriger une cote régénère la quantité avec la formule.">
            <li className={styles.panel}>
              <div className={styles.fields}>
                {dims.map(([label, field]) => (
                  <Field key={field} type="number" label={label} min={0} decimals={2} value={item[field] ?? null}
                    onChange={v => update({ [field]: v == null ? null : Math.max(0, v) } as Partial<PlanMeasurementItem>)} />
                ))}
                <Field type="number" label="Nombre N" min={0} decimals={2} value={item.dim_quantity ?? 1} onChange={v => update({ dim_quantity: v ?? 1 })} />
              </div>
            </li>
          </ListGroup>

          <Field type="textarea" label="Formule" rows={2} placeholder="Ex: (L * H - O) * N * (1 + waste)" value={item.formula} onChange={e => update({ formula: e.target.value })} />
          <Field type="textarea" label="Hypothèses" rows={3} placeholder="Hypothèses utilisées…" value={(item.assumptions ?? []).join('\n')}
            onChange={e => update({ assumptions: e.target.value.split('\n').map(v => v.trim()).filter(Boolean) })} />

          <ListGroup>
            <ListRow title="Lot" description={item.trade} />
            <ListRow title="Origine" description={sourceLabel(item.sourceKind)} />
            <ListRow title="Confiance" trailing={<StatusPill status={confidenceStatus(item.confidence).status}>{confidenceStatus(item.confidence).label}</StatusPill>} />
            {(item.warnings ?? []).map((warning, wi) => <ListRow key={wi} title={warning} trailing={<StatusPill status="wait">À vérifier</StatusPill>} />)}
          </ListGroup>

          <ListGroup>
            <ListRow title="Recalculer la quantité" description="Applique la formule aux cotes actuelles" onClick={() => q.recalculateMeasurementItem(index)} />
            <ListRow
              title={item.validationStatus === 'validated' ? 'Ligne validée' : 'Valider la ligne'}
              trailing={item.validationStatus === 'validated' ? <StatusPill status="success">Validée</StatusPill> : undefined}
              onClick={() => update({ validationStatus: 'validated' })}
            />
            <ListRow
              title={item.validationStatus === 'excluded' ? 'Remettre dans le devis' : 'Exclure du devis'}
              trailing={item.validationStatus === 'excluded' ? <StatusPill status="neutral">Exclue</StatusPill> : undefined}
              onClick={() => update({ validationStatus: item.validationStatus === 'excluded' ? 'pending' : 'excluded' })}
            />
          </ListGroup>
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={() => setConfirmDelete(true)}>Supprimer la ligne</button></li>
          </ListGroup>
        </div>
      </Sheet>
      <AlertDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Supprimer cette ligne ?"
        description="Elle sera retirée du pré-métré."
        confirmLabel="Supprimer"
        onConfirm={() => { setConfirmDelete(false); onClose(); q.removeMeasurementItem(index) }}
      />
    </>
  )
}

/** Pré-métré à valider : géométrie, paramètres de calcul, lignes par lot puis passage au devis. */
export function MeasurementReview({ q }: { q: AtelierIA }) {
  const m = q.measurement
  const [itemIndex, setItemIndex] = useState<number | null>(null)
  if (!m) return null
  const s = q.measurementSettings
  const setSetting = (patch: Partial<typeof s>) => q.setMeasurementSettings(current => ({ ...current, ...patch }))
  const plural = (n: number, word: string) => `${n}${NB}${word}${n > 1 ? 's' : ''}`

  return (
    <div className={styles.stack}>
      <div className={styles.inline} style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p className={styles.fieldValue} style={{ textAlign: 'left', fontWeight: 600, color: 'var(--at-encre)' }}>{m.title}</p>
          <p className={styles.hint} style={{ margin: 0 }}>
            {plural(m.rooms.length, 'pièce')} · {plural(m.openings.length, 'ouverture')} · {m.observations.length}{NB}équipement{m.observations.length > 1 ? 's' : ''} visible{m.observations.length > 1 ? 's' : ''} · {plural(m.items.length, 'ligne')}
          </p>
        </div>
        <Button variant="text" size="sm" onClick={q.handleReset}>Recommencer</Button>
      </div>

      {(m.needsCalibration || m.globalWarnings.length > 0) && (
        <ListGroup title="À vérifier">
          {m.needsCalibration && (
            <ListRow
              title="Échelle ou cotes à confirmer avant devis définitif"
              description="Confirmer après contrôle"
              className={styles.accentRow}
              onClick={() => q.setMeasurement(current => current ? { ...current, needsCalibration: false, scale: { ...current.scale, needsCalibration: false } } : current)}
            />
          )}
          {m.globalWarnings.slice(0, 4).map((warning, wi) => <ListRow key={wi} title={warning} />)}
        </ListGroup>
      )}

      <ListGroup title="Géométrie détectée" description={`Échelle ${m.scale.value ?? 'non confirmée'}. Corriger une cote régénère les lignes dépendantes.`}>
        {m.rooms.map((room, roomIndex) => (
          <li key={room.id} className={styles.panel}>
            <div className={styles.fields}>
              <div className={styles.fieldRow}><span>{room.name}</span><span className={styles.fieldValue}>{room.kind === 'exterior' ? 'Extérieur' : 'Intérieur'}</span></div>
              {([['Surface (m²)', 'area_m2'], ['Périmètre (m)', 'perimeter_m'], ['Hauteur (m)', 'height_m']] as const).map(([label, field]) => (
                <Field key={field} type="number" label={label} min={0} decimals={2} value={room[field] ?? null}
                  onChange={v => q.updateMeasurementRoom(roomIndex, field, v == null ? '' : String(v))} />
              ))}
            </div>
          </li>
        ))}
      </ListGroup>

      <ListGroup title="Paramètres de calcul" description="Variables disponibles : L, W, H, N, A, P, O, waste, spacing.">
        <li className={styles.panel}>
          <div className={styles.fields}>
            <Field type="number" label="Hauteur par défaut (m)" min={0} decimals={2} value={s.defaultHeightM} onChange={v => setSetting({ defaultHeightM: Math.max(0, v ?? 0) })} />
            <Field type="number" label="Couches de peinture" min={1} max={5} decimals={0} value={s.paintCoats} onChange={v => setSetting({ paintCoats: Math.max(1, v ?? 1) })} />
            <Field type="number" label="Pertes (%)" min={0} decimals={1} value={s.wastePct} onChange={v => setSetting({ wastePct: Math.max(0, v ?? 0) })} />
            <Field type="number" label="Entraxe (m)" min={0} decimals={2} value={s.studSpacingM} onChange={v => setSetting({ studSpacingM: Math.max(0, v ?? 0) })} />
            <Field type="number" label="Faïence, hauteur (m)" min={0.1} max={5} decimals={1} value={s.wallTileHeightM} onChange={v => setSetting({ wallTileHeightM: Math.max(0.1, v ?? 0.1) })} />
          </div>
        </li>
        <ListRow title="Recalculer tout" description="Applique ces paramètres à toutes les lignes" onClick={q.recalculateAllMeasurementItems} />
      </ListGroup>
      {q.formulaError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{q.formulaError}</p>}

      <div className={styles.detail}>
        <SegmentedControl
          label="Filtrer par lot"
          value={q.measurementTradeFilter}
          options={[{ value: 'all', label: 'Tous' }, ...m.scope.selectedTrades.map(trade => ({ value: trade, label: `${MEASUREMENT_TRADE_LABELS[trade]} · ${m.items.filter(i => i.tradeId === trade && i.validationStatus !== 'excluded').length}` }))]}
          onChange={v => q.setMeasurementTradeFilter(v as typeof q.measurementTradeFilter)}
        />
        <div className={styles.fields}>
          <Field type="select" label="Pièce" value={q.measurementRoomFilter} onChange={e => q.setMeasurementRoomFilter(e.target.value)}>
            <option value="all">Toutes les pièces</option>
            {m.rooms.map(room => <option key={room.id} value={room.id}>{room.name}</option>)}
          </Field>
        </div>
      </div>

      <ListGroup title="Lignes du métré" description="Touchez une ligne pour modifier ses cotes, sa formule et son état.">
        {q.filteredMeasurementItems.length === 0 && <li><p className={styles.notice}>Aucune ligne pour ce filtre.</p></li>}
        {q.filteredMeasurementItems.map(item => {
          const index = m.items.findIndex(candidate => candidate.id === item.id)
          const c = confidenceStatus(item.confidence)
          return (
            <ListRow
              key={item.id}
              title={item.designation || 'Ligne sans titre'}
              description={`${item.roomName} · ${Number.isFinite(item.quantity) ? item.quantity : 0}${NB}${item.unit}${item.validationStatus === 'validated' ? ' · validée' : item.validationStatus === 'excluded' ? ' · exclue' : ''}`}
              trailing={<StatusPill status={c.status}>{c.label}</StatusPill>}
              onClick={() => setItemIndex(index)}
            />
          )
        })}
        <ListRow title="Ajouter une ligne" className={styles.accentRow} onClick={q.addMeasurementItem} />
      </ListGroup>

      <ListGroup>
        <ListRow
          title="Valider les lignes visibles"
          onClick={() => q.setMeasurement(current => current ? {
            ...current,
            items: current.items.map(item => item.validationStatus === 'excluded'
              || (q.measurementTradeFilter !== 'all' && item.tradeId !== q.measurementTradeFilter)
              || (q.measurementRoomFilter !== 'all' && item.roomId !== q.measurementRoomFilter)
              ? item : { ...item, validationStatus: 'validated' }),
          } : current)}
        />
        <ListRow title="Enregistrer le brouillon" description={q.draftStatus ?? 'Pour le reprendre plus tard'} onClick={() => void q.saveMeasurementDraft()} />
      </ListGroup>

      {q.blockingMeasurementIssues && (
        <p className={`${styles.hint} ${styles.warn}`} role="status" style={{ marginTop: 0 }}>
          {q.measurementSettingsDirty
            ? 'Les paramètres ont changé : touchez « Recalculer tout » avant le passage au devis.'
            : 'Confirmez la calibration et validez ou excluez chaque ligne critique avant le passage au devis.'}
        </p>
      )}
      <Button size="lg" loading={q.isCreating} disabled={q.blockingMeasurementIssues || m.items.every(item => item.validationStatus === 'excluded')} onClick={() => void q.handleCreateMeasurementInEditor()}>
        Générer le devis depuis ce métré
      </Button>
      <p className={styles.hint} style={{ textAlign: 'center', marginTop: -8 }}>Le devis sera créé avec les quantités validées. Les prix resteront à renseigner dans l’éditeur.</p>

      {itemIndex != null && <ItemSheet q={q} index={itemIndex} onClose={() => setItemIndex(null)} />}
    </div>
  )
}
