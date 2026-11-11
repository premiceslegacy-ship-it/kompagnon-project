'use client'
// @atelier-migrated
// Catalogue : fournitures, main-d'œuvre, ressources internes, modèles de devis, fournisseurs.

import { MoreHorizontal, Plus } from 'lucide-react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu } from '@/components/ui/Menu'
import { SearchField } from '@/components/ui/SearchField'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { StatusPill } from '@/components/ui/StatusPill'
import CatalogAIPanel from '@/components/catalog/CatalogAIPanel'
import { AI_NAME } from '@/lib/brand'
import { getBusinessActivityById } from '@/lib/catalog-context'
import { importLaborRates, importMaterials } from '@/lib/data/mutations/catalog'
import { importSuppliers } from '@/lib/data/mutations/suppliers'
import type { ImportCatalogState } from '@/lib/data/mutations/catalog'
import ModeleEditor from './ModeleEditor'
import ModeleImportSheet from './ModeleImportSheet'
import { ImportSheet, LaborSheet, MaterialSheet, SupplierSheet } from './CatalogSheets'
import {
  fmtMoney, getLaborImportConfig, getMaterialImportConfig, getSupplierImportConfig, laborMarginPct, visibleSlice, type CatalogTab,
} from './catalogModel'
import { useCatalog, type CatalogProps } from './useCatalog'
import screen from '@/components/layout/Screen.module.css'
import styles from '../finances/quote-editor/QuoteEditor.module.css'
import local from './Catalog.module.css'

const NB = ' '

export default function CatalogClient(props: CatalogProps) {
  const { catalogContext: ctx, catalogAIEnabled = false, hasMetalPricing = false, metalPriceGrids = [] } = props
  const q = useCatalog(props)
  const ls = ctx.labelSet
  const activity = getBusinessActivityById(ctx.activityId)
  const typeLabels = new Map(ctx.resourceTypeOptions.map(o => [o.value, o.label]))

  const tabLabels: Record<CatalogTab, string> = {
    materials: ls.material.plural,
    services: ls.service.plural,
    labor: ls.laborRate.plural,
    prestations: ls.bundleTemplate.plural,
    suppliers: 'Fournisseurs',
  }
  const createLabel = q.tab === 'materials' ? ls.material.createLabel
    : q.tab === 'services' ? ls.service.createLabel
      : q.tab === 'labor' ? ls.laborRate.createLabel
        : q.tab === 'prestations' ? ls.bundleTemplate.createLabel
          : 'Nouveau fournisseur'

  const total = q.tab === 'materials' || q.tab === 'services' ? q.filteredMaterials.length
    : q.tab === 'labor' ? q.filteredLabor.length
      : q.tab === 'prestations' ? q.filteredPrestations.length
        : q.filteredSuppliers.length
  const allCount = q.counts[q.tab]
  const mats = visibleSlice(q.filteredMaterials, q.count)
  const labs = visibleSlice(q.filteredLabor, q.count)
  const pres = visibleSlice(q.filteredPrestations, q.count)
  const sups = visibleSlice(q.filteredSuppliers, q.count)
  const rest = q.tab === 'materials' || q.tab === 'services' ? mats.rest : q.tab === 'labor' ? labs.rest : q.tab === 'prestations' ? pres.rest : sups.rest

  const empty = (() => {
    if (q.search.trim()) return { title: q.tab === 'prestations' ? `Aucun ${ls.bundleTemplate.singular.toLowerCase()} trouvé` : 'Aucun élément trouvé', description: 'Modifiez la recherche.', action: false }
    if (q.tab === 'materials') return { title: ls.material.emptyLabel, description: ls.material.emptyHelp, action: true }
    if (q.tab === 'services') return { title: ls.service.emptyLabel, description: ls.service.emptyHelp, action: true }
    if (q.tab === 'labor') return { title: ls.laborRate.emptyLabel, description: ls.laborRate.emptyHelp, action: true }
    if (q.tab === 'prestations') return { title: ls.bundleTemplate.emptyLabel, description: ls.bundleTemplate.emptyHelp, action: true }
    return { title: 'Aucun fournisseur pour l’instant', description: 'Ajoutez vos fournisseurs pour les associer à vos produits.', action: true }
  })()

  const importTitle = (tab: CatalogTab) => tab === 'services' ? `Importer ${ls.service.plural.toLowerCase()}`
    : tab === 'materials' ? `Importer ${ls.material.plural.toLowerCase()}`
      : tab === 'labor' ? `Importer ${ls.laborRate.plural.toLowerCase()}`
        : 'Importer des fournisseurs'

  const menuItems = [
    ...(catalogAIEnabled ? [{ label: `Demander à ${AI_NAME}`, onSelect: () => q.setAiOpen(true) }] : []),
    { label: 'Importer (CSV ou Excel)', onSelect: () => q.setImportTab(q.tab) },
  ]

  const importCfg = q.importTab === 'labor' ? getLaborImportConfig(ctx) : q.importTab === 'suppliers' ? getSupplierImportConfig() : getMaterialImportConfig(ctx)
  const importAction = (q.importTab === 'labor' ? importLaborRates : q.importTab === 'suppliers' ? importSuppliers : importMaterials) as unknown as (prev: ImportCatalogState, fd: FormData) => Promise<ImportCatalogState>

  if (q.editor) {
    return (
      <>
        <ModeleEditor
          key={q.editor.editing?.id ?? 'new-modele'}
          editing={q.editor.editing}
          ctx={ctx}
          materials={q.materials}
          laborRates={q.laborRates}
          onSaved={q.handlePrestationSaved}
          onClose={() => q.setEditor(null)}
          onArchive={p => { q.setEditor(null); q.setConfirm({ type: 'prestation', id: p.id, label: p.name }) }}
        />
      </>
    )
  }

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <header className={screen.header}>
          <div className={local.headerText}>
            <p className={`${screen.kicker} ${local.kickerOneLine}`}>{ls.catalogSubtitle}</p>
            <h1 className={screen.title}>{ls.catalogTitle}</h1>
          </div>
          <div className={styles.headerEnd}>
            <Menu title="Catalogue" items={menuItems} trigger={<button type="button" className={screen.round} aria-label="Plus d’options"><MoreHorizontal size={20} aria-hidden="true" /></button>} />
            <Button size="md" className={styles.createWide} onClick={q.openCreate}>{createLabel}</Button>
            <button type="button" className={styles.createRound} onClick={q.openCreate} aria-label={createLabel}><Plus size={20} aria-hidden="true" /></button>
          </div>
        </header>

        <div className={styles.stack}>
          <SegmentedControl
            label="Type d’élément du catalogue"
            fullWidth
            value={q.tab}
            onChange={v => q.setTab(v as CatalogTab)}
            options={(Object.keys(tabLabels) as CatalogTab[]).map(k => ({ value: k, label: tabLabels[k] }))}
          />
          {allCount > 0 && <SearchField label={`Rechercher dans ${tabLabels[q.tab].toLowerCase()}`} placeholder="Rechercher" value={q.search} onChange={q.setSearch} />}
          {q.actionError && <p className={screen.error} role="alert">{q.actionError}</p>}

          {total === 0 ? (
            empty.action
              ? <EmptyState title={empty.title} description={empty.description} actionLabel={createLabel} onAction={q.openCreate} />
              : <EmptyState title={empty.title} description={empty.description} actionLabel="Effacer la recherche" onAction={() => q.setSearch('')} />
          ) : (
            <ListGroup description={q.tab === 'labor' ? 'Les coûts internes ne figurent jamais sur le devis du client.' : q.tab === 'materials' || q.tab === 'services' ? 'Prix de vente hors taxes.' : undefined}>
              {(q.tab === 'materials' || q.tab === 'services') && mats.items.map(m => (
                <ListRow
                  key={m.id}
                  title={m.name}
                  description={[m.reference, m.category, m.supplier, m.dimension_pricing_mode !== 'none' ? 'tarif par dimensions' : null].filter(Boolean).join(' · ') || undefined}
                  trailing={<span className={styles.trailStack}><span className={styles.amount}>{fmtMoney(m.sale_price)}</span><span className={local.sub}>par {m.unit ?? 'u'}</span></span>}
                  onClick={() => q.setMaterialSheet({ material: m, kind: m.item_kind === 'service' ? 'service' : 'article' })}
                />
              ))}
              {q.tab === 'labor' && labs.items.map(l => {
                const margin = laborMarginPct(l.cost_rate, l.rate)
                const amort = l.type === 'equipment' && l.purchase_price != null && l.lifetime_uses != null ? `achat ${fmtMoney(l.purchase_price, 0)} / ${l.lifetime_uses}${NB}usages` : null
                return (
                  <ListRow
                    key={l.id}
                    title={l.designation}
                    description={[l.reference, typeLabels.get(l.type ?? 'human') ?? ctx.laborRateUi.typeHumanLabel, l.category, amort].filter(Boolean).join(' · ')}
                    trailing={
                      <span className={styles.trailStack}>
                        <span className={styles.amount}>{fmtMoney(l.cost_rate)}</span>
                        <span className={local.sub}>par {l.unit ?? 'h'}, interne</span>
                        {margin != null && <StatusPill status={margin >= 25 ? 'success' : margin >= 5 ? 'wait' : 'danger'}>{margin}{NB}%</StatusPill>}
                      </span>
                    }
                    onClick={() => q.setLaborSheet({ item: l })}
                  />
                )
              })}
              {q.tab === 'prestations' && pres.items.map(p => {
                const n = p.items?.length ?? 0
                return (
                  <ListRow
                    key={p.id}
                    title={p.name}
                    description={[p.category, `${n}${NB}ligne${n > 1 ? 's' : ''}`, p.description].filter(Boolean).join(' · ')}
                    trailing={<span className={styles.trailStack}><span className={styles.amount}>{fmtMoney(p.base_price_ht, 0)}</span>{p.is_active ? <StatusPill status="success">{p.base_margin_pct ?? 0}{NB}%</StatusPill> : <StatusPill status="neutral">Inactif</StatusPill>}</span>}
                    onClick={() => q.setEditor({ editing: p })}
                  />
                )
              })}
              {q.tab === 'suppliers' && sups.items.map(s => (
                <ListRow
                  key={s.id}
                  leading={<Avatar name={s.name} />}
                  title={s.name}
                  description={[s.contact_name ?? 'Sans contact', s.phone].filter(Boolean).join(' · ')}
                  trailing={s.payment_terms ? <span className={local.sub}>{s.payment_terms}</span> : undefined}
                  onClick={() => q.setSupplierSheet({ supplier: s })}
                />
              ))}
              {rest > 0 && <ListRow title={`Afficher les ${rest} suivants`} className={styles.accentRow} onClick={q.showMore} />}
            </ListGroup>
          )}
        </div>
      </div>

      {q.materialSheet && (
        <MaterialSheet
          key={q.materialSheet.material?.id ?? `new-${q.materialSheet.kind}`}
          kind={q.materialSheet.kind}
          material={q.materialSheet.material}
          categories={q.materialSheet.kind === 'service' ? q.serviceCategories : q.materialCategories}
          ctx={ctx}
          suppliers={q.suppliers}
          metalGrid={hasMetalPricing && q.materialSheet.material ? metalPriceGrids.find(g => g.catalog_item_id === q.materialSheet!.material!.id) ?? null : null}
          onSaved={q.handleMaterialSaved}
          onCreated={q.refresh}
          onDuplicate={q.handleDuplicateMaterial}
          onArchive={m => { q.setMaterialSheet(null); q.setConfirm({ type: 'material', id: m.id, label: m.name }) }}
          onClose={() => q.setMaterialSheet(null)}
        />
      )}
      {q.laborSheet && (
        <LaborSheet
          key={q.laborSheet.item?.id ?? 'new-labor'}
          item={q.laborSheet.item}
          categories={q.laborCategories}
          ctx={ctx}
          onSaved={q.handleLaborSaved}
          onCreated={q.refresh}
          onArchive={l => { q.setLaborSheet(null); q.setConfirm({ type: 'labor', id: l.id, label: l.designation }) }}
          onClose={() => q.setLaborSheet(null)}
        />
      )}
      {q.supplierSheet && (
        <SupplierSheet
          key={q.supplierSheet.supplier?.id ?? 'new-supplier'}
          supplier={q.supplierSheet.supplier}
          onSaved={q.handleSupplierSaved}
          onCreated={q.refresh}
          onArchive={s => { q.setSupplierSheet(null); q.setConfirm({ type: 'supplier', id: s.id, label: s.name }) }}
          onClose={() => q.setSupplierSheet(null)}
        />
      )}
      {q.importTab && q.importTab !== 'prestations' && (
        <ImportSheet title={importTitle(q.importTab)} config={importCfg} serverAction={importAction} onDone={q.refresh} onClose={() => q.setImportTab(null)} />
      )}

      {q.importTab === 'prestations' && (
        <ModeleImportSheet
          label={ls.bundleTemplate.singular.toLowerCase()}
          plural={ls.bundleTemplate.plural.toLowerCase()}
          onDone={q.refresh}
          onClose={() => q.setImportTab(null)}
        />
      )}
      {catalogAIEnabled && q.aiOpen && (
        <CatalogAIPanel
          open={q.aiOpen}
          onClose={() => q.setAiOpen(false)}
          onCreated={() => { q.refresh(); q.setAiOpen(false) }}
          bundleTemplateLabel={ls.bundleTemplate.singular}
          bundleTemplatePluralLabel={ls.bundleTemplate.plural}
          activityLabel={activity?.label ?? ctx.sectorFallback}
          activityDescription={activity?.description ?? ctx.onboardingDescription}
        />
      )}

      <AlertDialog
        open={q.confirm !== null}
        onOpenChange={o => { if (!o) q.setConfirm(null) }}
        title={q.confirm?.type === 'supplier' ? `Supprimer « ${q.confirm.label} » ?` : `Archiver « ${q.confirm?.label ?? ''} » ?`}
        description={q.confirm?.type === 'supplier' ? 'Le fournisseur sera retiré de la liste.' : 'L’élément quitte le catalogue ; les devis déjà créés ne changent pas.'}
        confirmLabel={q.confirm?.type === 'supplier' ? 'Supprimer' : 'Archiver'}
        onConfirm={q.handleConfirmArchive}
      />
    </main>
  )
}
