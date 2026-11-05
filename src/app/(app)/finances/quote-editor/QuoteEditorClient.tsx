'use client'
// @atelier-migrated

import { useState } from 'react'
import Link from 'next/link'
import { Bell, ChevronLeft, ChevronRight, MoreHorizontal } from 'lucide-react'
import AtelierAIPanel from '@/components/ai/AtelierAIPanel'
import LaborEstimatePanel from '@/components/ai/LaborEstimatePanel'
import AttachmentPickerModal from '@/components/AttachmentPickerModal'
import ClientEmailRequiredModal from '@/components/ClientEmailRequiredModal'
import SaveToCatalogModal, { type SaveToCatalogResult, type SaveToCatalogSource } from '@/components/catalog/SaveToCatalogModal'
import BtpMentionsPanel from '@/components/quotes/BtpMentionsPanel'
import MetalPriceBanner from '@/components/quotes/MetalPriceBanner'
import MetalPriceSnapshotPanel from '@/components/quotes/MetalPriceSnapshotPanel'
import SupplierPriceRequestsPanel from '@/components/quotes/SupplierPriceRequestsPanel'
import TechnicalChecklistPanel from '@/components/quotes/TechnicalChecklistPanel'
import { Dock } from '@/components/ui/Dock'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { NumericInput } from '@/components/ui/NumericInput'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import { AI_NAME } from '@/lib/brand'
import { QuoteStartChoice } from './QuoteStartChoice'
import { LineSheet } from './LineSheet'
import {
  AddLineSheet, AidSheet, CatalogSheet, CheckSheet, ClausesSheet, ClientSheet, EquipmentSheet,
  IntroSheet, NewClientSheet, PrestationSheet, ReferenceSheet, RentabilitySheet, SectionSheet,
  TransportSheet, VariantSheet,
} from './QuoteSheets'
import { clientDisplayName, fmt, getItemDimensionMode } from './quoteEditorModel'
import { useQuoteEditor, type QuoteEditorProps } from './useQuoteEditor'
import screen from '@/components/layout/Screen.module.css'
import styles from './QuoteEditor.module.css'

const NB = ' '

type PanelSheet = 'client' | 'reference' | 'intro' | 'aid' | 'rentab' | 'fourn' | 'checklist' | 'mentions' | 'points' | null

const QUOTE_STATUS: Record<string, { label: string; status: StatusPillStatus }> = {
  draft: { label: 'Brouillon', status: 'neutral' },
  sent: { label: 'Envoyé', status: 'wait' },
  accepted: { label: 'Accepté', status: 'success' },
  refused: { label: 'Refusé', status: 'danger' },
  rejected: { label: 'Refusé', status: 'danger' },
  expired: { label: 'Expiré', status: 'neutral' },
}

export default function QuoteEditorClient(props: QuoteEditorProps) {
  const q = useQuoteEditor(props)
  const [pickedLine, setPickedLine] = useState<{ sectionId: string; itemId: string } | null>(null)
  const [panel, setPanel] = useState<PanelSheet>(null)
  const [sectionSheet, setSectionSheet] = useState<string | null>(null)
  const [addSheet, setAddSheet] = useState<string | null>(null)
  // Ligne en cours de création : la feuille s'ouvre dès qu'elle apparaît, sans attendre le serveur.
  const [creating, setCreating] = useState<{ sectionId: string; known: string[] } | null>(null)

  const createdItem = creating
    ? q.sections.find(s => s._tempId === creating.sectionId)?.items.find(i => !creating.known.includes(i._tempId))
    : undefined
  const line = pickedLine ?? (creating && createdItem ? { sectionId: creating.sectionId, itemId: createdItem._tempId } : null)
  const closeLine = () => { setPickedLine(null); setCreating(null) }

  const client = q.clients.find(c => c.id === q.clientId) ?? null
  const clientNotes = (client as { internal_notes?: string | null } | null)?.internal_notes ?? null
  const referenceCandidates = q.allQuotes.filter(x => x.client_id === q.clientId && x.id !== q.quoteId)
  const titledSections = q.sections.filter(s => s._tempId !== '_unsectioned' && s.title)
  const status = QUOTE_STATUS[q.initialQuote?.status ?? 'draft'] ?? QUOTE_STATUS.draft
  const heading = q.initialQuote?.number ? `Devis ${q.initialQuote.number}` : q.quoteId ? 'Édition du devis' : 'Nouveau devis'
  const aidActive = q.aidAmount != null && q.aidAmount > 0

  const points: string[] = []
  if (q.visibleItems.length > 0) {
    if (!q.clientId) points.push('Aucun client sélectionné.')
    if (q.pendingSupplierPrices > 0) {
      points.push(`${q.pendingSupplierPrices} ligne${q.pendingSupplierPrices > 1 ? 's' : ''} avec prix à confirmer fournisseur.`)
    }
  }

  const menuItems: MenuItem[] = [
    { label: 'Aperçu du PDF', disabled: !q.quoteId, onSelect: () => void q.handlePreviewPdf() },
    ...(q.modules.quote_ai ? [{ label: 'Estimer les ressources internes', onSelect: () => q.setMoaPanelOpen(true) }] : []),
    ...(q.modules.quote_ai && !q.initialQuote?.id && q.visibleItems.length === 0
      ? [{ label: `Assistance ${AI_NAME}`, onSelect: () => q.setAIPanelOpen(true) }]
      : []),
    ...(q.quoteId && !q.variantGroupId ? [{ label: 'Créer une variante (option A/B)', onSelect: () => q.setVariantModalOpen(true) }] : []),
  ]

  const saveText = q.saveStatus === 'saving' ? 'Sauvegarde…' : q.saveStatus === 'saved' ? 'Sauvegardé' : q.saveStatus === 'error' ? 'Échec de la sauvegarde' : ''

  const variantIndex = q.variants.findIndex(v => v.id === q.quoteId)
  const variantCurrent = q.variants[variantIndex]
  const variantPrev = variantIndex > 0 ? q.variants[variantIndex - 1] : null
  const variantNext = variantIndex >= 0 && variantIndex < q.variants.length - 1 ? q.variants[variantIndex + 1] : null
  const variantName = (v: typeof variantCurrent | null) => v ? (v.variant_label ?? v.title ?? `Devis ${v.number}`) : ''

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        {q.startChoice === 'checking' && (
          <div className={styles.preparing} role="status">
            <span className={styles.spinner} aria-hidden="true" />
            <span>Préparation du devis…</span>
          </div>
        )}
        {q.startChoice === 'pending' && (
          <QuoteStartChoice onSelectManual={() => q.setStartChoice('done')} onSelectAI={() => q.router.push('/atelier-ia')} />
        )}

        <button type="button" className={styles.back} onClick={() => q.router.replace(q.returnTo)}>
          <ChevronLeft size={20} aria-hidden="true" />
          Documents
        </button>

        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{q.title || (client ? clientDisplayName(client) : 'Devis')}</p>
            <h1 className={screen.title}>{heading}</h1>
          </div>
          <div className={styles.headerEnd}>
            <StatusPill status={status.status}>{status.label}</StatusPill>
            <Menu
              title="Devis"
              items={menuItems}
              trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
            />
          </div>
        </header>
        <p className={styles.saveState} role="status" data-state={q.saveStatus}>{q.isPending && !saveText ? 'Enregistrement…' : saveText}</p>
        {q.errorMsg && <p className={screen.error} role="alert">{q.errorMsg}</p>}

        {q.variants.length > 0 && (q.variantGroupId || q.variantLabel) && (
          <nav className={styles.variantBar} aria-label="Variantes du devis">
            <div className={styles.variantNav}>
              {variantPrev ? (
                <Link className={styles.variantLink} href={`/finances/quote-editor?id=${variantPrev.id}`} aria-label={`Variante précédente : ${variantName(variantPrev)}`}>
                  <ChevronLeft size={20} aria-hidden="true" />
                </Link>
              ) : <span className={styles.variantLink} aria-disabled="true"><ChevronLeft size={20} aria-hidden="true" /></span>}
              <span className={styles.variantLabel}>
                {variantName(variantCurrent)}
                <small>
                  {variantIndex >= 0 ? variantIndex + 1 : '?'}/{q.variants.length}
                  {variantCurrent?.total_ht != null ? ` · ${variantCurrent.total_ht.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })}` : ''}
                </small>
              </span>
              {variantNext ? (
                <Link className={styles.variantLink} href={`/finances/quote-editor?id=${variantNext.id}`} aria-label={`Variante suivante : ${variantName(variantNext)}`}>
                  <ChevronRight size={20} aria-hidden="true" />
                </Link>
              ) : <span className={styles.variantLink} aria-disabled="true"><ChevronRight size={20} aria-hidden="true" /></span>}
            </div>
            {q.quoteId && <button type="button" className={styles.linkButton} onClick={() => q.setVariantModalOpen(true)}>+ Variante</button>}
          </nav>
        )}

        {points.length > 0 && (
          <button type="button" className={screen.alert} onClick={() => setPanel('points')}>
            <Bell className={screen.alertIcon} size={20} aria-hidden="true" />
            <span>{points.length} point{points.length > 1 ? 's' : ''} à vérifier avant l&apos;envoi</span>
            <ChevronRight className={screen.chevron} size={16} aria-hidden="true" />
          </button>
        )}

        <div className={styles.stack} style={{ marginTop: 16 }}>
          {q.clientRequestDescription && (
            <ListGroup title="Demande du client" description="Reçue par le formulaire en ligne">
              <li><p className={styles.requestText}>{q.clientRequestDescription}</p></li>
              <ListRow
                title="Visible sur le PDF"
                trailing={
                  <Switch
                    label="Demande du client visible sur le PDF"
                    checked={q.clientRequestVisibleOnPdf}
                    onChange={next => {
                      q.setClientRequestVisibleOnPdf(next)
                      if (q.quoteId) q.scheduleHeaderSave({ client_request_visible_on_pdf: next })
                    }}
                  />
                }
              />
            </ListGroup>
          )}

          <ListGroup
            title="Informations"
            description={clientNotes ? `Notes internes du client : ${clientNotes}` : undefined}
          >
            <ListRow
              title="Client"
              trailing={<span className={styles.fieldValue}>{client ? clientDisplayName(client) : 'À choisir'}</span>}
              onClick={() => setPanel('client')}
            />
            <li className={styles.fieldItem}>
              <Field
                type="text"
                label="Titre"
                placeholder="Ex: Rénovation toiture"
                value={q.title}
                onChange={e => { q.setTitle(e.target.value); q.scheduleHeaderSave({ title: e.target.value }) }}
              />
            </li>
            <li className={`${styles.fieldItem} ${styles.fieldRow}`}>
              <label htmlFor="quote-validity">Validité</label>
              <span className={styles.suffixInput}>
                <NumericInput
                  id="quote-validity"
                  className={styles.plainInput}
                  min={1}
                  decimals={0}
                  value={q.validityDays}
                  onChange={v => { const n = v ?? 1; q.setValidityDays(n); q.scheduleHeaderSave({ validity_days: n }) }}
                />
                jours
              </span>
            </li>
            {referenceCandidates.length > 0 && (
              <ListRow
                title="Devis de référence"
                trailing={<span className={styles.fieldValue}>{q.parentQuoteId ? 'Avenant' : 'Aucun'}</span>}
                onClick={() => setPanel('reference')}
              />
            )}
          </ListGroup>

          {q.hasMetalPricing && (
            <>
              <MetalPriceBanner grids={q.metalPriceGrids} onGridSelect={q.handleMetalGridSelect} />
              {q.initialMetalSnapshots.length > 0 && <MetalPriceSnapshotPanel snapshots={q.initialMetalSnapshots} />}
            </>
          )}

          {q.sections.length === 0 && (
            <p className={styles.notice}>Commencez par ajouter un lot, ou choisissez une prestation type.</p>
          )}

          {q.sections.map(sec => {
            const isLoose = sec._tempId === '_unsectioned'
            const subtotal = sec.items.filter(i => !i.is_internal).reduce((s, i) => s + i.quantity * i.unit_price, 0)
            return (
              <ListGroup
                key={sec._tempId}
                title={isLoose ? undefined : (sec.title || 'Lot sans titre')}
                action={isLoose ? undefined : (
                  <span className={styles.sectionHead}>
                    <span className={styles.amount}>{fmt(subtotal)}</span>
                    <button type="button" className={screen.round} aria-label={`Options du lot ${sec.title || ''}`.trim()} onClick={() => setSectionSheet(sec._tempId)}>
                      <MoreHorizontal size={20} aria-hidden="true" />
                    </button>
                  </span>
                )}
              >
                {sec.items.length === 0 && <li><p className={styles.notice}>Aucune ligne. Ajoutez une saisie libre ou choisissez dans le catalogue.</p></li>}
                {sec.items.map(item => {
                  const isEquipment = q.isEquipmentLine(item)
                  const meta = isEquipment ? q.parseEquipmentAmortization(item.description, item.unit_price) : null
                  const name = (meta?.name ?? item.description.split(/\n\n?Comprend\s*:\s*/i)[0]).trim()
                  const parts = [
                    `${item.quantity}${NB}${item.unit} × ${fmt(item.unit_price)}`,
                    item.price_pending ? 'prix à confirmer' : null,
                    item.is_estimated ? 'estimé par l’IA' : null,
                    getItemDimensionMode(item) !== 'none' ? 'dimensions' : null,
                  ].filter(Boolean)
                  return (
                    <ListRow
                      key={item._tempId}
                      title={name || 'Ligne sans description'}
                      description={parts.join(' · ')}
                      trailing={item.is_internal || isEquipment
                        ? <StatusPill status="neutral">{isEquipment ? 'Équipement' : 'Interne'}</StatusPill>
                        : <span className={styles.amount}>{fmt(item.quantity * item.unit_price)}</span>}
                      onClick={() => setPickedLine({ sectionId: sec._tempId, itemId: item._tempId })}
                    />
                  )
                })}
                <ListRow title="Ajouter une ligne" className={styles.accentRow} onClick={() => setAddSheet(sec._tempId)} />
              </ListGroup>
            )
          })}

          <ListGroup>
            <ListRow
              title="Ajouter une section"
              description="Un lot, avec son sous-total"
              className={styles.accentRow}
              disabled={q.isPending || q.isAddingSection}
              onClick={() => void q.handleAddSection()}
            />
            <ListRow
              title="Prestation type"
              description={`Plusieurs lignes d'un coup, depuis ${q.catalogContext.labelSet.bundleTemplate.plural.toLowerCase()}`}
              disabled={q.isPending || q.isAddingSection}
              onClick={() => { q.setPrestationSearch(''); q.setPrestationOpen(true) }}
            />
          </ListGroup>

          <ListGroup>
            <ListRow title="Total HT" trailing={<span className={styles.amount}>{fmt(q.totalHt)}</span>} />
            <ListRow title="TVA" trailing={<span className={styles.amount}>{fmt(q.totalTva)}</span>} />
            <ListRow title="Total TTC" trailing={<span className={styles.recapTotal}>{fmt(q.totalTtc)}</span>} />
            {aidActive && (
              <>
                <ListRow title={q.aidLabel || 'Aide'} trailing={<span className={styles.amount}>−{fmt(q.aidAmount ?? 0)}</span>} />
                <ListRow title="Reste à charge" trailing={<span className={styles.recapTotal}>{fmt(Math.max(0, q.totalTtc - (q.aidAmount ?? 0)))}</span>} />
              </>
            )}
          </ListGroup>

          <ListGroup>
            <ListRow
              title="Texte d'introduction"
              description={q.notesClient ? `${q.notesClient.slice(0, 70)}${q.notesClient.length > 70 ? '…' : ''}` : 'Ajouter un texte pour le client'}
              onClick={() => setPanel('intro')}
            />
            <ListRow
              title="Aide ou subvention"
              description={aidActive ? `${q.aidLabel || 'Aide'}, −${fmt(q.aidAmount ?? 0)}` : 'MaPrimeRénov’, CEE…'}
              onClick={() => setPanel('aid')}
            />
            {titledSections.length > 1 && (
              <ListRow
                title="Sous-totaux par lot sur le PDF"
                trailing={
                  <Switch
                    label="Sous-totaux par lot sur le PDF"
                    checked={q.showSectionSubtotals}
                    onChange={next => {
                      q.setShowSectionSubtotals(next)
                      if (q.quoteId) q.scheduleHeaderSave({ show_section_subtotals: next })
                    }}
                  />
                }
              />
            )}
          </ListGroup>

          <ListGroup>
            <ListRow
              title="Rentabilité"
              description={q.hasInternalItems ? `Marge estimée ${Math.round(q.margePct)}${NB}%` : 'Renseignez des coûts internes pour voir votre marge'}
              onClick={() => setPanel('rentab')}
            />
            {q.quoteId && <ListRow title="Demandes de prix fournisseur" onClick={() => setPanel('fourn')} />}
            {q.quoteId && <ListRow title="Checklist technique" onClick={() => setPanel('checklist')} />}
            {q.orgForMentions && <ListRow title="Mentions légales du bâtiment" description="Vérifiées d'après le devis" onClick={() => setPanel('mentions')} />}
            <ListRow
              title="Aperçu du PDF"
              description={q.quoteId ? undefined : 'Ajoutez une ligne pour générer l’aperçu'}
              disabled={!q.quoteId}
              onClick={() => void q.handlePreviewPdf()}
            />
          </ListGroup>
        </div>

        <Dock
          totalLabel="Total TTC"
          total={fmt(q.totalTtc)}
          actionLabel="Envoyer le devis"
          onAction={() => void q.handleSend()}
          loading={q.isSending}
          loadingText="Préparation…"
          disabled={q.isPending}
        />
      </div>

      {line && <LineSheet q={q} sectionId={line.sectionId} itemId={line.itemId} onClose={closeLine} onSaveToCatalog={() => {
        const target = q.sections.find(s => s._tempId === line.sectionId)?.items.find(i => i._tempId === line.itemId)
        if (target) q.openSaveCatalog(target)
      }} />}
      {sectionSheet && <SectionSheet q={q} sectionId={sectionSheet} onClose={() => setSectionSheet(null)} />}
      {addSheet && <AddLineSheet q={q} sectionId={addSheet} onClose={() => setAddSheet(null)} onAdding={known => setCreating({ sectionId: addSheet, known })} />}

      <ClientSheet q={q} open={panel === 'client'} onClose={() => setPanel(null)} onNewClient={() => {
        setPanel(null)
        q.setNewClientError(null)
        q.setNewClientForm({ company_name: '', contact_name: '', first_name: '', last_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' })
        q.setNewClientOpen(true)
      }} />
      <NewClientSheet q={q} open={q.newClientOpen} onClose={() => q.setNewClientOpen(false)} />
      <ReferenceSheet q={q} open={panel === 'reference'} onClose={() => setPanel(null)} />
      <IntroSheet q={q} open={panel === 'intro'} onClose={() => setPanel(null)} />
      <ClausesSheet q={q} />
      <AidSheet q={q} open={panel === 'aid'} onClose={() => setPanel(null)} />
      <RentabilitySheet q={q} open={panel === 'rentab'} onClose={() => setPanel(null)} />
      <CatalogSheet q={q} />
      <PrestationSheet q={q} />
      <TransportSheet q={q} />
      <EquipmentSheet q={q} />
      <VariantSheet q={q} />
      <CheckSheet warnings={points} open={panel === 'points'} onClose={() => setPanel(null)} />
      <CheckSheet
        warnings={q.checkWarnings}
        open={q.checkModalOpen}
        onClose={() => q.setCheckModalOpen(false)}
        onSendAnyway={() => { q.setCheckModalOpen(false); void q.prepareQuoteSend(false, true) }}
      />

      {q.quoteId && (
        <Sheet open={panel === 'fourn'} onOpenChange={open => { if (!open) setPanel(null) }} title="Prix fournisseur" cancelLabel="Fermer">
          <SupplierPriceRequestsPanel quoteId={q.quoteId} initialRequests={q.initialPriceRequests} suppliers={q.allSuppliers} />
        </Sheet>
      )}
      {q.quoteId && (
        <Sheet open={panel === 'checklist'} onOpenChange={open => { if (!open) setPanel(null) }} title="Checklist technique" cancelLabel="Fermer">
          <TechnicalChecklistPanel
            quoteId={q.quoteId}
            initialChecklist={(q.initialQuote as { technical_checklist?: never } | null)?.technical_checklist ?? null}
            businessProfile={q.catalogContext.businessProfile}
          />
        </Sheet>
      )}
      {q.orgForMentions && (
        <Sheet open={panel === 'mentions'} onOpenChange={open => { if (!open) setPanel(null) }} title="Mentions légales" cancelLabel="Fermer">
          <BtpMentionsPanel
            quote={{
              title: q.title,
              notes_client: q.notesClient,
              payment_conditions: (q.initialQuote as { payment_conditions?: string | null } | null)?.payment_conditions ?? null,
              issue_date: q.initialQuote?.created_at?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
              valid_until: q.validityDays ? new Date(Date.now() + q.validityDays * 86400000).toISOString().slice(0, 10) : null,
              total_ht: q.totalHt,
              total_ttc: q.totalTtc,
              items: q.visibleItems.map(i => ({ description: i.description, quantity: i.quantity, unit: i.unit, unit_price: i.unit_price, vat_rate: i.vat_rate })),
              client: client
                ? {
                    type: (client as { type?: string | null }).type ?? null,
                    company_name: client.company_name ?? null,
                    first_name: client.first_name ?? null,
                    last_name: client.last_name ?? null,
                    address_line1: client.address_line1 ?? null,
                    postal_code: client.postal_code ?? null,
                    city: client.city ?? null,
                    siret: client.siret ?? null,
                  }
                : null,
            }}
            org={q.orgForMentions}
          />
        </Sheet>
      )}

      {q.aiPanelOpen && (
        <AtelierAIPanel
          onImport={q.handleAIImport}
          onClose={() => { q.setAIPanelOpen(false); q.setChloeBriefBanner(null); q.setChloeAutoAnalyze(null) }}
          voiceInputEnabled={q.modules.voice_input}
          briefBanner={q.chloeBriefBanner}
          autoAnalyzeText={q.chloeAutoAnalyze}
        />
      )}
      {q.moaPanelOpen && (
        <LaborEstimatePanel
          laborRates={q.laborRates}
          quoteTitle={q.title}
          onInsert={q.handleInsertMOItems}
          onClose={() => q.setMoaPanelOpen(false)}
        />
      )}
      {q.saveCatalogItem && (
        <SaveToCatalogModal
          source={{
            description: q.saveCatalogItem.description,
            unit: q.saveCatalogItem.unit,
            unit_price: q.saveCatalogItem.unit_price,
            vat_rate: q.saveCatalogItem.vat_rate,
            length_m: q.saveCatalogItem.length_m,
            width_m: q.saveCatalogItem.width_m,
            height_m: q.saveCatalogItem.height_m,
            dimension_pricing_mode: q.saveCatalogItem.dimension_pricing_mode,
            hint: q.saveCatalogItem.type === 'labor' ? 'labor' : undefined,
          } satisfies SaveToCatalogSource}
          catalogContext={q.catalogContext}
          existingCategories={{
            material: Array.from(new Set(q.materials.filter(m => m.item_kind !== 'service' && m.category).map(m => m.category as string))),
            service: Array.from(new Set(q.materials.filter(m => m.item_kind === 'service' && m.category).map(m => m.category as string))),
            labor: Array.from(new Set(q.laborRates.filter(l => l.category).map(l => l.category as string))),
          }}
          onClose={() => q.setSaveCatalogItem(null)}
          onSaved={(result: SaveToCatalogResult) => q.saveCatalogItem && q.handleSavedToCatalog(q.saveCatalogItem, result)}
        />
      )}
      {q.sendModalOpen && (
        <AttachmentPickerModal
          title="Envoyer le devis"
          description="Sélectionnez les contrats du même client à joindre en pièces jointes."
          recipientEmail={null}
          groups={q.sendModalGroups}
          loading={q.sendModalLoading}
          submitting={q.isSending}
          error={q.sendModalError}
          onCancel={() => { q.setSendModalOpen(false); q.setPendingQuoteId(null) }}
          onConfirm={q.confirmQuoteSend}
        />
      )}
      <ClientEmailRequiredModal
        open={q.emailRequiredOpen}
        client={q.getSelectedClientForSend()}
        documentLabel="le devis"
        onCancel={() => q.setEmailRequiredOpen(false)}
        onSaved={q.handleClientEmailSaved}
      />
    </main>
  )
}
