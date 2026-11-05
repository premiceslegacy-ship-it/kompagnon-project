'use client'
// @atelier-migrated

import { useState } from 'react'
import { ChevronLeft, MoreHorizontal } from 'lucide-react'
import AttachmentPickerModal from '@/components/AttachmentPickerModal'
import ClientEmailRequiredModal from '@/components/ClientEmailRequiredModal'
import SaveToCatalogModal, { type SaveToCatalogResult, type SaveToCatalogSource } from '@/components/catalog/SaveToCatalogModal'
import { Dock } from '@/components/ui/Dock'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Menu, type MenuItem } from '@/components/ui/Menu'
import { StatusPill, type StatusPillStatus } from '@/components/ui/StatusPill'
import { Switch } from '@/components/ui/Switch'
import { ClientSheet, EquipmentSheet, NewClientSheet, TransportSheet } from '../EditorSheets'
import { clientDisplayName, fmt, isEquipmentLine, isSectionItem, parseEquipmentAmortization } from './invoiceEditorModel'
import {
  ChantierSheet, InvoiceAddSheet, InvoiceAidSheet, InvoiceCatalogSheet, InvoiceLineSheet, InvoiceMarginSheet,
  InvoiceSectionSheet, QuoteImportSheet, ScheduleSheet,
} from './InvoiceSheets'
import { useInvoiceEditor, type InvoiceEditorProps } from './useInvoiceEditor'
import screen from '@/components/layout/Screen.module.css'
import styles from '../quote-editor/QuoteEditor.module.css'

const NB = ' '

type Panel = 'client' | 'aid' | 'margin' | 'chantier' | 'schedule' | null

const INVOICE_STATUS: Record<string, { label: string; status: StatusPillStatus }> = {
  draft: { label: 'Brouillon', status: 'neutral' },
  sent: { label: 'Envoyée', status: 'wait' },
  partial: { label: 'Partiellement payée', status: 'wait' },
  paid: { label: 'Payée', status: 'success' },
  cancelled: { label: 'Annulée', status: 'danger' },
}

export default function InvoiceEditorClient(props: InvoiceEditorProps) {
  const q = useInvoiceEditor(props)
  const [pickedLine, setPickedLine] = useState<number | null>(null)
  const [creating, setCreating] = useState<{ known: number[] } | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [sectionSheet, setSectionSheet] = useState<number | null>(null)
  const [addSheet, setAddSheet] = useState<{ afterId: number | null } | null>(null)

  // La feuille de la nouvelle ligne s'ouvre dès qu'elle existe.
  const createdItem = creating ? q.items.find(i => !creating.known.includes(i.id) && !isSectionItem(i)) : undefined
  const lineId = pickedLine ?? createdItem?.id ?? null
  const closeLine = () => { setPickedLine(null); setCreating(null) }

  const client = q.clients.find(c => c.id === q.clientId) ?? null
  const chantier = q.linkableChantiers.find(c => c.id === q.chantierId) ?? null
  const status = INVOICE_STATUS[q.existingInvoice?.status ?? 'draft'] ?? INVOICE_STATUS.draft
  const heading = q.existingInvoice?.number ? `Facture ${q.existingInvoice.number}` : q.isEditing ? 'Modifier la facture' : 'Nouvelle facture'
  const aidActive = q.aidAmount != null && q.aidAmount > 0
  const busy = q.isSaving || q.isSending

  // Groupes : une section (intitulé) et les lignes qui la suivent ; les lignes sans section d'abord.
  const groups: { section: (typeof q.items)[number] | null; lines: typeof q.items }[] = []
  for (const item of q.items) {
    if (isSectionItem(item)) groups.push({ section: item, lines: [] })
    else {
      if (groups.length === 0) groups.push({ section: null, lines: [] })
      groups[groups.length - 1].lines.push(item)
    }
  }

  const menuItems: MenuItem[] = [
    { label: 'Aperçu du PDF', disabled: busy, onSelect: q.handlePreview },
    { label: 'Enregistrer le brouillon', disabled: busy, onSelect: q.handleSaveDraft },
  ]

  return (
    <main className={screen.root}>
      <div className={screen.page}>
        <button type="button" className={styles.back} onClick={() => q.router.replace(q.returnTo)}>
          <ChevronLeft size={20} aria-hidden="true" />
          Documents
        </button>

        <header className={screen.header}>
          <div>
            <p className={screen.kicker}>{q.title || (client ? clientDisplayName(client) : 'Facture')}</p>
            <h1 className={screen.title}>{heading}</h1>
          </div>
          <div className={styles.headerEnd}>
            <StatusPill status={status.status}>{status.label}</StatusPill>
            <Menu
              title="Facture"
              items={menuItems}
              trigger={<button type="button" className={screen.round} aria-label="Plus d'options"><MoreHorizontal size={20} aria-hidden="true" /></button>}
            />
          </div>
        </header>
        {q.error && <p className={screen.error} role="alert">{q.error}</p>}

        <div className={styles.stack} style={{ marginTop: 16 }}>
          <ListGroup>
            <ListRow
              title="Facturer depuis un devis"
              description={q.importedQuoteId ? 'Devis importé' : q.acceptedQuotes.length > 0 ? 'Importer un devis accepté' : 'Aucun devis accepté'}
              disabled={q.acceptedQuotes.length === 0}
              onClick={() => q.setIsQuoteModalOpen(true)}
            />
          </ListGroup>

          <ListGroup
            title="Informations"
            description={chantier || q.linkableChantiers.length > 0 ? 'Une facture rattachée à un chantier apparaît dans sa rentabilité.' : undefined}
          >
            <li className={styles.fieldItem}>
              <Field
                type="text"
                label="Intitulé"
                placeholder="Ex : Travaux de toiture - Bâtiment A"
                value={q.title}
                onChange={e => q.setTitle(e.target.value)}
              />
            </li>
            <ListRow
              title="Client"
              trailing={<span className={styles.fieldValue}>{client ? clientDisplayName(client) : 'À choisir'}</span>}
              onClick={() => setPanel('client')}
            />
            <li className={`${styles.fieldItem} ${styles.fieldRow}`}>
              <label htmlFor="invoice-issue-date">Facturation</label>
              <input id="invoice-issue-date" type="date" className={styles.dateInput} value={q.issueDate} onChange={e => q.setIssueDate(e.target.value)} />
            </li>
            <li className={`${styles.fieldItem} ${styles.fieldRow}`}>
              <label htmlFor="invoice-due-date">Échéance</label>
              <input id="invoice-due-date" type="date" className={styles.dateInput} value={q.dueDate} onChange={e => q.setDueDate(e.target.value)} />
            </li>
            {q.linkableChantiers.length > 0 && (
              <ListRow
                title="Chantier rattaché"
                trailing={<span className={styles.fieldValue}>{chantier?.title ?? 'Aucun'}</span>}
                onClick={() => setPanel('chantier')}
              />
            )}
          </ListGroup>

          {groups.length === 0 && <p className={styles.notice}>Ajoutez une ligne, une section, ou importez un devis accepté.</p>}

          {groups.map((group, gi) => {
            const subtotal = group.lines.filter(i => !i.is_internal).reduce((s, i) => s + Number(i.qty) * Number(i.pu), 0)
            const lastId = group.lines.at(-1)?.id ?? group.section?.id ?? null
            return (
              <ListGroup
                key={group.section?.id ?? `loose-${gi}`}
                title={group.section ? (group.section.desc || 'Section sans titre') : undefined}
                action={group.section ? (
                  <span className={styles.sectionHead}>
                    <span className={styles.amount}>{fmt(subtotal)}</span>
                    <button type="button" className={screen.round} aria-label={`Options de la section ${group.section.desc}`.trim()} onClick={() => setSectionSheet(group.section!.id)}>
                      <MoreHorizontal size={20} aria-hidden="true" />
                    </button>
                  </span>
                ) : undefined}
              >
                {group.lines.map(item => {
                  const equipment = isEquipmentLine(item)
                  const meta = equipment ? parseEquipmentAmortization(item.desc, item.pu) : null
                  const name = (meta?.name ?? item.desc.split('\n')[0]).trim()
                  return (
                    <ListRow
                      key={item.id}
                      title={name || 'Ligne sans description'}
                      description={`${item.qty}${item.unit && item.unit !== '__section__' ? `${NB}${item.unit}` : ''} × ${fmt(Number(item.pu))}`}
                      trailing={item.is_internal || equipment
                        ? <StatusPill status="neutral">{equipment ? 'Équipement' : 'Interne'}</StatusPill>
                        : <span className={styles.amount}>{fmt(Number(item.qty) * Number(item.pu))}</span>}
                      onClick={() => setPickedLine(item.id)}
                    />
                  )
                })}
                <ListRow title="Ajouter une ligne" className={styles.accentRow} onClick={() => setAddSheet({ afterId: lastId })} />
              </ListGroup>
            )
          })}

          <ListGroup>
            <ListRow title="Ajouter une section" description="Un lot, avec son sous-total" className={styles.accentRow} onClick={q.addSection} />
            {groups.length === 0 && (
              <ListRow title="Ajouter une ligne" description="Libre, catalogue, transport, équipement" className={styles.accentRow} onClick={() => setAddSheet({ afterId: null })} />
            )}
          </ListGroup>

          <ListGroup>
            <ListRow title="Total HT" trailing={<span className={styles.amount}>{fmt(q.totalHt)}</span>} />
            {Object.entries(q.vatByRate).map(([rate, amount]) => (
              <ListRow key={rate} title={`TVA ${String(rate).replace('.', ',')}${NB}%`} trailing={<span className={styles.amount}>{fmt(amount)}</span>} />
            ))}
            <ListRow title="Total TTC" trailing={<span className={styles.recapTotal}>{fmt(q.totalTtc)}</span>} />
            {aidActive && (
              <>
                <ListRow title={q.aidLabel || 'Aide'} trailing={<span className={styles.amount}>−{fmt(q.aidAmount ?? 0)}</span>} />
                <ListRow title="Reste à charge" trailing={<span className={styles.recapTotal}>{fmt(Math.max(0, q.totalTtc - (q.aidAmount ?? 0)))}</span>} />
              </>
            )}
          </ListGroup>

          <ListGroup description="Plusieurs échéances, en montant ou en pourcentage du total TTC.">
            <ListRow
              title="Échéancier"
              description={q.showSchedule && q.schedule.length > 0
                ? `${q.schedule.length} échéance${q.schedule.length > 1 ? 's' : ''} · reste à ventiler ${fmt(Math.round(q.scheduleRemaining * 100) / 100)}`
                : 'Paiement en plusieurs fois'}
              onClick={() => { q.setShowSchedule(true); if (q.schedule.length === 0) q.addScheduleLine(); setPanel('schedule') }}
            />
          </ListGroup>

          <ListGroup>
            <ListRow
              title="Autoliquidation de la TVA"
              description={q.isReverseCharge
                ? 'La mention « Autoliquidation de la TVA (art. 283-2 nonies du CGI) » sera imprimée. TVA portée par le donneur d’ordre.'
                : 'Sous-traitance du bâtiment, art. 283-2 nonies du CGI'}
              trailing={<Switch label="Autoliquidation de la TVA" checked={q.isReverseCharge} onChange={q.setIsReverseCharge} />}
            />
            <ListRow
              title="Aide ou subvention"
              description={aidActive ? `${q.aidLabel || 'Aide'}, −${fmt(q.aidAmount ?? 0)}` : 'MaPrimeRénov’, CEE…'}
              onClick={() => setPanel('aid')}
            />
            {q.hasInternal && (
              <ListRow title="Marge interne" description={`Marge estimée ${Math.round(q.margePct)}${NB}%`} onClick={() => setPanel('margin')} />
            )}
            <ListRow title="Aperçu du PDF" disabled={busy} onClick={q.handlePreview} />
          </ListGroup>
        </div>

        <Dock
          totalLabel="Total TTC"
          total={fmt(q.totalTtc)}
          actionLabel="Valider et envoyer"
          onAction={q.handleSend}
          loading={q.isSending}
          loadingText="Préparation…"
          disabled={q.isSaving}
        />
      </div>

      {lineId != null && (
        <InvoiceLineSheet q={q} itemId={lineId} onClose={closeLine} onSaveToCatalog={() => {
          const target = q.items.find(i => i.id === lineId)
          if (target) q.openSaveCatalog(target)
        }} />
      )}
      {sectionSheet != null && <InvoiceSectionSheet q={q} sectionId={sectionSheet} onClose={() => setSectionSheet(null)} />}
      {addSheet && <InvoiceAddSheet q={q} afterId={addSheet.afterId} onClose={() => setAddSheet(null)} onAdding={() => setCreating({ known: q.items.map(i => i.id) })} />}

      <ClientSheet clients={q.clients} clientId={q.clientId} onSelect={q.setClientId} open={panel === 'client'} onClose={() => setPanel(null)} onNewClient={() => {
        setPanel(null)
        q.setNewClientError(null)
        q.setNewClientForm({ company_name: '', first_name: '', last_name: '', contact_name: '', email: '', phone: '', address_line1: '', postal_code: '', city: '' })
        q.setNewClientOpen(true)
      }} />
      <NewClientSheet q={q} open={q.newClientOpen} onClose={() => q.setNewClientOpen(false)} />
      <ChantierSheet q={q} open={panel === 'chantier'} onClose={() => setPanel(null)} />
      <InvoiceAidSheet q={q} open={panel === 'aid'} onClose={() => setPanel(null)} />
      <InvoiceMarginSheet q={q} open={panel === 'margin'} onClose={() => setPanel(null)} />
      <ScheduleSheet q={q} open={panel === 'schedule'} onClose={() => setPanel(null)} />
      <QuoteImportSheet q={q} />
      <InvoiceCatalogSheet q={q} />
      <TransportSheet q={q} />
      <EquipmentSheet q={q} />

      {q.saveCatalogItem && (
        <SaveToCatalogModal
          source={{
            description: q.saveCatalogItem.desc,
            unit: q.saveCatalogItem.unit,
            unit_price: q.saveCatalogItem.pu,
            vat_rate: q.saveCatalogItem.vat,
            length_m: q.saveCatalogItem.length_m,
            width_m: q.saveCatalogItem.width_m,
            height_m: q.saveCatalogItem.height_m,
            dimension_pricing_mode: q.saveCatalogItem.dimension_pricing_mode,
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
          title="Envoyer la facture"
          description="Sélectionnez les contrats du même client à joindre en pièces jointes."
          recipientEmail={null}
          groups={q.sendModalGroups}
          loading={q.sendModalLoading}
          submitting={q.isSending}
          error={q.sendModalError}
          onCancel={() => { q.setSendModalOpen(false); q.setPendingInvoiceId(null) }}
          onConfirm={q.confirmInvoiceSend}
        />
      )}
      <ClientEmailRequiredModal
        open={q.emailRequiredOpen}
        client={q.getSelectedClientForSend()}
        documentLabel="la facture"
        onCancel={() => q.setEmailRequiredOpen(false)}
        onSaved={q.handleClientEmailSaved}
      />
    </main>
  )
}
