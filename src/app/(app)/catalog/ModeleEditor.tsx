'use client'
// @atelier-migrated
// Éditeur d'un modèle de devis (écran poussé) : en-tête, sections, lignes, prix client et marge.

import { useState } from 'react'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { Dock } from '@/components/ui/Dock'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { StatusPill } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import type { CatalogLaborRate, CatalogMaterial, PrestationType } from '@/lib/data/queries/catalog'
import type { ResolvedCatalogContext } from '@/lib/catalog-context'
import { fmtMoney } from './catalogModel'
import { lineAmount, lineTitle, lineUnitAmount, newLocalItem, type LineType, type LocalItem } from './modelesModel'
import { LineSheet, NameSheet, SectionSheet, TypeSheet } from './ModeleSheets'
import { useModeleEditor } from './useModeleEditor'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Catalog.module.css'

const NB = ' '

export default function ModeleEditor({ editing, ctx, materials, laborRates, onSaved, onClose, onArchive }: {
  editing: PrestationType | null
  ctx: ResolvedCatalogContext
  materials: CatalogMaterial[]
  laborRates: CatalogLaborRate[]
  onSaved: (p: PrestationType) => void
  onClose: () => void
  onArchive: (p: PrestationType) => void
}) {
  const q = useModeleEditor({ editing, onSaved })
  const [nameOpen, setNameOpen] = useState(false)
  const [typeFor, setTypeFor] = useState<string | null>(null)
  const [line, setLine] = useState<{ sectionId: string; item: LocalItem; isNew: boolean } | null>(null)
  const [sectionSheet, setSectionSheet] = useState<string | 'new' | null>(null)
  const [leaving, setLeaving] = useState(false)
  const singular = ctx.labelSet.bundleTemplate.singular
  const t = q.totals
  const lineLabels = ctx.bundleTemplateUi.lineTypeLabels
  const empty = q.sections.length === 1 && q.sections[0].items.length === 0
  const sectionForSheet = sectionSheet && sectionSheet !== 'new' ? q.sections.find(s => s.tempId === sectionSheet) : null

  function leave() { if (q.dirty) setLeaving(true); else onClose() }
  async function save() { if (await q.save()) onClose() }
  function addLine(sectionId: string, type: LineType) { setTypeFor(null); setLine({ sectionId, item: newLocalItem(type), isNew: true }) }

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <button type="button" className={styles.back} onClick={leave}>
          <ChevronLeft size={20} aria-hidden="true" />
          Catalogue
        </button>
        <header className={screen.header}>
          <div style={{ minWidth: 0 }}>
            <p className={screen.kicker}>{editing ? singular : `Nouveau ${singular.toLowerCase()}`}</p>
            <h1 className={screen.title}>{q.header.name || 'Sans nom'}</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu
              title={singular}
              items={[
                { label: 'Nom et description', onSelect: () => setNameOpen(true) },
                ...(editing ? [{ label: `Archiver ${singular.toLowerCase()}`, destructive: true, onSelect: () => onArchive(editing) }] : []),
              ]}
              trigger={<button type="button" className={screen.round} aria-label="Plus d’options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
            />
          </div>
        </header>

        <div className={styles.stack}>
          <div className={styles.total}>
            <small>Prix client HT</small>
            <b>{fmtMoney(t.price)}</b>
            <small>
              Coût de revient {fmtMoney(t.cost)}
              {t.marginPct !== null && <> · <StatusPill status={t.marginPct >= 25 ? 'success' : t.marginPct >= 5 ? 'wait' : 'danger'}>Marge {t.marginPct.toFixed(1).replace('.', ',')}{NB}%</StatusPill></>}
            </small>
          </div>

          <ListGroup description={ctx.bundleTemplateUi.internalLineHelp && t.hasInternal ? ctx.bundleTemplateUi.internalLineHelp : undefined}>
            <ListRow title="Nom" trailing={<span className={styles.amount}>{q.header.name || 'À renseigner'}</span>} onClick={() => setNameOpen(true)} />
            <ListRow title="Description" description={q.header.description || 'Facultative'} onClick={() => setNameOpen(true)} />
            <ListRow title="Disponible" description="Proposé dans l’éditeur de devis" trailing={<Switch label="Disponible" checked={q.header.is_active} onChange={v => q.setHeader({ is_active: v })} />} />
          </ListGroup>

          {empty ? (
            <EmptyState title="Composition vide" description="Ajoutez des lignes : main-d’œuvre, fournitures, transport, équipement." actionLabel="Ajouter une ligne" onAction={() => setTypeFor(q.sections[0].tempId)} />
          ) : q.sections.map((s, i) => (
            <ListGroup
              key={s.tempId}
              title={s.title || (q.sections.length > 1 ? `Section ${i + 1}` : 'Composition')}
              action={q.sections.length > 1 || s.title ? <Button variant="text" size="sm" onClick={() => setSectionSheet(s.tempId)}>Renommer</Button> : undefined}
            >
              {s.items.map(it => {
                const unitAmount = lineUnitAmount(it)
                return (
                  <ListRow
                    key={it.tempId}
                    title={lineTitle(it)}
                    description={`${lineLabels[it.item_type]} · ${parseFloat(it.quantity) || 0}${NB}${it.item_type === 'equipment' ? 'usage' : it.unit} × ${fmtMoney(unitAmount)}`}
                    trailing={<span className={styles.trailStack}><span className={styles.amount}>{fmtMoney(lineAmount(it))}</span>{it.is_internal && <StatusPill status="neutral">Interne</StatusPill>}</span>}
                    onClick={() => setLine({ sectionId: s.tempId, item: it, isNew: false })}
                  />
                )
              })}
              <ListRow title="Ajouter une ligne" className={styles.accentRow} onClick={() => setTypeFor(s.tempId)} />
            </ListGroup>
          ))}

          <ListGroup>
            <ListRow title="Ajouter une section" className={styles.accentRow} onClick={() => setSectionSheet('new')} />
          </ListGroup>
          {q.error && <p className={screen.error} role="alert">{q.error}</p>}
        </div>

        <Dock totalLabel="Prix client HT" total={fmtMoney(t.price)} actionLabel="Enregistrer" onAction={() => void save()} loading={q.saving} disabled={!q.header.name.trim()} />
      </div>

      {nameOpen && <NameSheet header={q.header} onChange={q.setHeader} onClose={() => setNameOpen(false)} />}
      {typeFor && <TypeSheet ctx={ctx} onPick={t2 => addLine(typeFor, t2)} onClose={() => setTypeFor(null)} />}
      {line && (
        <LineSheet
          key={line.item.tempId}
          initial={line.item}
          isNew={line.isNew}
          ctx={ctx}
          materials={materials}
          laborRates={laborRates}
          onSave={item => q.saveItem(line.sectionId, item)}
          onDelete={() => q.removeItem(line.sectionId, line.item.tempId)}
          onClose={() => setLine(null)}
        />
      )}
      {sectionSheet && (
        <SectionSheet
          key={sectionSheet}
          title={sectionForSheet?.title ?? ''}
          canDelete={!!sectionForSheet && q.sections.length > 1}
          onSave={title => { if (sectionSheet === 'new') q.addSection(title); else q.renameSection(sectionSheet, title) }}
          onDelete={() => { if (sectionForSheet) q.removeSection(sectionForSheet.tempId) }}
          onClose={() => setSectionSheet(null)}
        />
      )}
      <AlertDialog
        open={leaving}
        onOpenChange={setLeaving}
        title="Ignorer les modifications ?"
        description={`Les changements de ce ${singular.toLowerCase()} ne seront pas enregistrés.`}
        confirmLabel="Ignorer"
        onConfirm={() => { setLeaving(false); onClose() }}
      />
    </main>
  )
}
