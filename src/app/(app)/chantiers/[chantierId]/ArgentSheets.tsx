'use client'
// @atelier-migrated
// Feuilles de l'onglet Argent : facture rattachée, rattacher une facture, taux horaire, marge cible, ticket.

import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import type { InvoiceStub } from '@/lib/data/queries/invoices'
import { fmtMoney } from './rentabiliteModel'
import type { RentabiliteState } from './useRentabilite'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '

function invoiceLabel(inv: Pick<InvoiceStub, 'number' | 'title' | 'id'>) {
  return [inv.number, inv.title].filter(Boolean).join(' · ') || '(sans titre)'
}

/** Facture rattachée : ouvrir ou détacher. */
export function InvoiceSheet({ q, invoice, onClose }: { q: RentabiliteState; invoice: InvoiceStub; onClose: () => void }) {
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title={invoiceLabel(invoice)}
      description={`${invoice.total_ht != null ? `${fmtMoney(invoice.total_ht)}${NB}HT` : 'Montant non renseigné'} · ${invoice.status === 'paid' ? 'encaissée' : invoice.status === 'partial' ? 'partiellement encaissée' : 'non encaissée'}`}
      cancelLabel="Fermer"
    >
      <ListGroup>
        <ListRow title="Ouvrir la facture" href={`/finances/invoice-editor?id=${invoice.id}&returnTo=${encodeURIComponent(`/chantiers/${q.chantierId}`)}`} />
        {q.canEditChantier && (
          <li className={styles.destructiveRow}>
            <button type="button" disabled={q.unlinkingId === invoice.id} onClick={async () => { await q.handleUnlinkInvoice(invoice.id); onClose() }}>
              {q.unlinkingId === invoice.id ? 'Détachement…' : 'Détacher du chantier'}
            </button>
          </li>
        )}
      </ListGroup>
    </Sheet>
  )
}

/** Rattacher une facture existante au chantier. */
export function LinkInvoiceSheet({ q, onClose }: { q: RentabiliteState; onClose: () => void }) {
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) { q.setLinkInvoiceError(null); onClose() } }}
      title="Rattacher une facture"
      description="Son montant entre dans le facturé du chantier."
      confirmLabel="Rattacher"
      confirmLoading={q.linkingInvoice}
      confirmDisabled={!q.linkingInvoiceId}
      onConfirm={async () => { if (await q.handleLinkInvoice()) onClose() }}
    >
      <div className={styles.stack}>
        <Field type="select" label="Facture" value={q.linkingInvoiceId} onChange={e => q.setLinkingInvoiceId(e.target.value)}>
          <option value="">Choisir une facture</option>
          {q.availableToLink.map(inv => (
            <option key={inv.id} value={inv.id}>{invoiceLabel(inv)}{inv.total_ht != null ? ` · ${fmtMoney(inv.total_ht)}` : ''}</option>
          ))}
        </Field>
        {q.linkInvoiceError && <p className={screen.error} role="alert">{q.linkInvoiceError}</p>}
      </div>
    </Sheet>
  )
}

/** Taux horaire d'un membre : il s'applique à tous ses chantiers. */
export function RateSheet({ q }: { q: RentabiliteState }) {
  const entry = q.rateEntry
  if (!entry) return null
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.setRateEntry(null) }}
      title={entry.full_name ?? 'Membre'}
      description="Le taux s’applique à tous les chantiers de ce membre."
      confirmLabel="Enregistrer"
      confirmLoading={q.rateSaving}
      onConfirm={() => q.handleSaveRate(entry.membership_id)}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="text" label="Taux horaire (€/h)" inputMode="decimal" value={q.rateInputValue} onChange={e => q.setRateInputValue(e.target.value)} />
        </div>
        {q.rateError && <p className={screen.error} role="alert">{q.rateError}</p>}
      </div>
    </Sheet>
  )
}

/** Marge cible : elle fixe le budget de coûts maximum. */
export function MarginSheet({ q }: { q: RentabiliteState }) {
  if (!q.marginOpen) return null
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) q.setMarginOpen(false) }}
      title="Marge cible"
      description="Budget de coûts maximum = prix du devis × (1 − marge cible)."
      confirmLabel="Enregistrer"
      confirmLoading={q.marginSaving}
      onConfirm={q.handleSaveMargin}
    >
      <div className={styles.fields}>
        <Field type="text" label="Marge cible (%)" inputMode="decimal" value={q.marginInput} onChange={e => q.setMarginInput(e.target.value)} hint="Entre 0 et 99." />
      </div>
    </Sheet>
  )
}

/** Ticket joint à une dépense. */
export function ReceiptSheet({ q }: { q: RentabiliteState }) {
  const path = q.viewingReceiptPath
  if (!path || !q.receiptUrls[path]) return null
  return (
    <Sheet open onOpenChange={o => { if (!o) q.setViewingReceiptPath(null) }} title="Ticket" cancelLabel="Fermer">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className={fiche.photoView} src={q.receiptUrls[path]} alt="Ticket de dépense" />
    </Sheet>
  )
}
