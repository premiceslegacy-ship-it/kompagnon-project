'use client'
// @atelier-migrated
// Devis : valeurs par défaut, prix matières métaux, clauses réutilisables.

import { useState } from 'react'
import { Dock } from '@/components/ui/Dock'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import type { MetalPriceGrid } from '@/lib/data/mutations/metal-price-grids'
import type { QuoteClauseTemplate } from '@/lib/data/queries/clause-templates'
import { METAL_LABELS } from '@/lib/metal-prices'
import ClauseSheet from './ClauseSheet'
import MetalGridImportSheet from './MetalGridImportSheet'
import MetalGridSheet from './MetalGridSheet'
import { clampValidity, clausePreview, clauseToForm, emptyClauseForm, gridDetails, gridPriceLabel, sortClauses, upsertClause, type ClauseForm } from './devisModel'
import { useSavedDirty } from './useSavedDirty'
import type { SettingsState } from './useSettings'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Settings.module.css'

export default function DevisView({ q }: { q: SettingsState }) {
  const dirty = useSavedDirty(q.autoReminder, q.autoReminderSaveStatus)
  const saving = q.autoReminderSaveStatus === 'saving'
  const [clauses, setClauses] = useState<QuoteClauseTemplate[]>(q.initialClauseTemplates)
  const [clauseForm, setClauseForm] = useState<ClauseForm | null>(null)
  // Le formulaire d'une grille repart de zéro à chaque ouverture (changement de `key`).
  const [gridTarget, setGridTarget] = useState<{ grid?: MetalPriceGrid; key: number; open: boolean }>({ key: 0, open: false })
  const [importOpen, setImportOpen] = useState(false)
  const grids: MetalPriceGrid[] = q.initialMetalPriceGrids
  const materialName = (id: string | null) => (id ? q.catalogMaterials.find(m => m.id === id)?.name ?? null : null)
  const supplierName = (id: string | null) => (id ? q.suppliers.find(s => s.id === id)?.name ?? null : null)
  const openGrid = (grid?: MetalPriceGrid) => setGridTarget(t => ({ grid, key: t.key + 1, open: true }))

  return (
    <div className={local.detail}>
      <div className={local.sections}>
        <div>
          <div className={styles.fields}>
            <Field type="number" label="Validité par défaut (jours)" min={1} max={365} decimals={0} allowEmpty={false}
              value={q.autoReminder.defaultQuoteValidityDays}
              onChange={n => q.setAutoReminder(a => ({ ...a, defaultQuoteValidityDays: clampValidity(n) }))} />
          </div>
          <p className={styles.hint}>Pré-rempli à la création de chaque devis, modifiable devis par devis.</p>
        </div>

        <ListGroup description="Affiche le montant HT de chaque lot en bas du lot sur le PDF. Modifiable devis par devis.">
          <ListRow
            title="Sous-totaux par lot"
            description={q.subtotalsSaveStatus === 'saved' ? 'Préférence enregistrée' : q.subtotalsSaveStatus === 'saving' ? 'Enregistrement…' : q.defaultShowSectionSubtotals ? 'Affichés' : 'Masqués'}
            trailing={<Switch label="Sous-totaux par lot" checked={q.defaultShowSectionSubtotals} disabled={q.isPending || q.subtotalsSaveStatus === 'saving'} onChange={q.handleSaveDefaultShowSectionSubtotals} />}
          />
        </ListGroup>
        {q.subtotalsSaveStatus === 'error' && <p className={screen.error} role="alert">La préférence n’a pas pu être enregistrée.</p>}

        {q.hasMetalPricing && (
          <ListGroup
            title="Prix matières métaux"
            description="Vos prix fournisseur HT, saisis et mis à jour par votre entreprise. Ils pré-remplissent les devis sans cours automatique. Les documents déjà validés ne changent pas."
          >
            {grids.map(grid => {
              const detail = [METAL_LABELS[grid.metal_code], gridPriceLabel(grid), ...gridDetails(grid)]
              const links = [materialName(grid.catalog_item_id) && `Catalogue : ${materialName(grid.catalog_item_id)}`, supplierName(grid.supplier_id) && `Fournisseur : ${supplierName(grid.supplier_id)}`].filter(Boolean)
              return (
                <ListRow
                  key={grid.id}
                  title={grid.label}
                  description={[...detail, ...links].join(' · ')}
                  trailing={<StatusPill status="neutral">{grid.source_type === 'manual' ? 'Prix manuel' : 'À compléter'}</StatusPill>}
                  onClick={() => openGrid(grid)}
                />
              )
            })}
            {grids.length === 0 && <ListRow title="Aucune grille" description="Ajoutez votre premier métal source." />}
            <ListRow title="Ajouter une grille" className={styles.accentRow} onClick={() => openGrid()} />
            <ListRow title="Importer un fichier CSV" className={styles.accentRow} onClick={() => setImportOpen(true)} />
          </ListGroup>
        )}

        <ListGroup
          title="Clauses réutilisables"
          description="Disponibles à l’insertion dans l’éditeur de devis : introduction ou conditions."
        >
          {sortClauses(clauses).map(clause => (
            <ListRow
              key={clause.id}
              title={clause.title}
              description={`${clause.category ?? 'Général'} · ${clausePreview(clause.body)}`}
              onClick={() => setClauseForm(clauseToForm(clause))}
            />
          ))}
          {clauses.length === 0 && <ListRow title="Aucune clause" description="Créez votre première clause type : délais, tolérances, paiement…" />}
          <ListRow title="Nouvelle clause" className={styles.accentRow} onClick={() => setClauseForm(emptyClauseForm(clauses.length))} />
        </ListGroup>
      </div>

      {(dirty || saving) && (
        <Dock totalLabel="Devis" total="Modifié" actionLabel="Enregistrer" onAction={q.handleSaveAutoReminder} loading={saving} disabled={q.isPending} />
      )}
      {q.autoReminderSaveStatus === 'error' && <p className={screen.error} role="alert">Les réglages n’ont pas pu être enregistrés.</p>}

      <ClauseSheet
        form={clauseForm}
        onChange={setClauseForm}
        onSaved={clause => setClauses(prev => upsertClause(prev, clause))}
        onDeleted={id => setClauses(prev => prev.filter(c => c.id !== id))}
      />
      {q.hasMetalPricing && (
        <>
          <MetalGridSheet key={gridTarget.key} open={gridTarget.open} grid={gridTarget.grid} materials={q.catalogMaterials} suppliers={q.suppliers} onClose={() => setGridTarget(t => ({ ...t, open: false }))} />
          <MetalGridImportSheet open={importOpen} onClose={() => setImportOpen(false)} />
        </>
      )}
    </div>
  )
}
