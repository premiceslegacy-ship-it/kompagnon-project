'use client'
// @atelier-migrated
// Feuilles de l'en-tête de la fiche : détails, contact référent, facturer, rapport PDF.

import { useState } from 'react'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { DateRow } from '../FormRows'
import { BILLING_PERIOD_OPTIONS, MONTH_NAMES } from './chantierModel'
import type { ChantierDetailState } from './useChantierDetail'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from './ChantierFiche.module.css'

const NB = ' '

/** Dates, devis lié, facturation périodique et retenue de garantie : un seul « Enregistrer ». */
export function DetailsSheet({ q, onClose }: { q: ChantierDetailState; onClose: () => void }) {
  const [saving, setSaving] = useState(false)
  const quoteChanged = (q.chantier.quote_id ?? '') !== q.quoteLinkValue
  const billingActive = q.billingPeriod !== 'none'

  const save = async () => {
    if (!q.canEditChantier) return
    setSaving(true)
    const results = [
      await q.handleSaveDates(),
      quoteChanged ? await q.handleSaveQuoteLink() : true,
      await q.handleSaveBilling(),
      await q.handleSaveRetention(),
    ]
    setSaving(false)
    if (results.every(Boolean)) onClose()
  }

  const errors = [q.datesError, q.quoteLinkError, q.billingError, q.retentionError].filter(Boolean) as string[]

  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Détails du chantier"
      confirmLabel={q.canEditChantier ? 'Enregistrer' : undefined}
      onConfirm={q.canEditChantier ? save : undefined}
      confirmLoading={saving}
      cancelLabel={q.canEditChantier ? 'Annuler' : 'Fermer'}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <DateRow label="Début" value={q.startDate} onChange={q.setStartDate} />
          <DateRow label="Fin estimée" value={q.estimatedEndDate} onChange={q.setEstimatedEndDate} />
        </div>

        <Field
          type="select"
          label="Devis lié"
          hint="Le budget et les tâches proposées suivent ce devis."
          value={q.quoteLinkValue}
          onChange={e => q.setQuoteLinkValue(e.target.value)}
          disabled={!q.canEditChantier}
        >
          <option value="">Aucun devis</option>
          {q.linkableQuotes.map(quote => (
            <option key={quote.id} value={quote.id}>
              {quote.number ? `${quote.number} · ` : ''}{quote.title ?? 'Sans titre'}{quote.client_name ? ` (${quote.client_name})` : ''}
            </option>
          ))}
        </Field>

        <ListGroup title="Facturation périodique" description={billingActive ? `Prochaine facture : ${new Date(q.selectedBillingDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}.` : undefined}>
          <li className={styles.fields} style={{ listStyle: 'none' }}>
            <Field type="select" label="Fréquence" value={q.billingPeriod} onChange={e => q.setBillingPeriod(e.target.value as typeof q.billingPeriod)} disabled={!q.canEditChantier}>
              {BILLING_PERIOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Field>
            {billingActive && (
              <>
                <Field type="text" label="Montant HT (€)" inputMode="decimal" value={q.billingAmount} onChange={e => q.setBillingAmount(e.target.value)} disabled={!q.canEditChantier} />
                <Field type="text" label="Libellé de la ligne" placeholder="Maintenance mensuelle" value={q.billingLabel} onChange={e => q.setBillingLabel(e.target.value)} disabled={!q.canEditChantier} />
                <Field type="select" label="Jour" value={q.billingDay} onChange={e => q.setBillingDay(e.target.value)} disabled={!q.canEditChantier}>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map(day => <option key={day} value={day}>{day}</option>)}
                </Field>
                <Field type="select" label="Mois" value={q.billingMonth} onChange={e => q.setBillingMonth(e.target.value)} disabled={!q.canEditChantier}>
                  {MONTH_NAMES.map((name, idx) => <option key={name} value={idx + 1}>{name}</option>)}
                </Field>
                <Field type="select" label="Année" value={q.billingYear} onChange={e => q.setBillingYear(e.target.value)} disabled={!q.canEditChantier}>
                  {q.billingYears.map(year => <option key={year} value={year}>{year}</option>)}
                </Field>
              </>
            )}
          </li>
        </ListGroup>

        <div className={styles.fields}>
          <Field type="text" label={`Retenue de garantie (%)`} inputMode="decimal" hint="Pré-remplie automatiquement sur les nouvelles factures." value={q.retentionPct} onChange={e => q.setRetentionPct(e.target.value)} disabled={!q.canEditChantier} />
        </div>

        {errors.map(err => <p key={err} className={screen.error} role="alert">{err}</p>)}
      </div>
    </Sheet>
  )
}

/** Personne référente du chantier. */
export function ContactSheet({ q, onClose }: { q: ChantierDetailState; onClose: () => void }) {
  const [saving, setSaving] = useState(false)
  return (
    <Sheet
      open
      onOpenChange={o => { if (!o) onClose() }}
      title="Personne référente"
      confirmLabel="Enregistrer"
      confirmLoading={saving}
      onConfirm={async () => { setSaving(true); const ok = await q.handleSaveContact(); setSaving(false); if (ok) onClose() }}
    >
      <div className={styles.stack}>
        <div className={styles.fields}>
          <Field type="text" label="Nom" placeholder="Nom du contact" value={q.contactName} onChange={e => q.setContactName(e.target.value)} />
          <Field type="text" label="Email" inputMode="email" value={q.contactEmail} onChange={e => q.setContactEmail(e.target.value)} />
          <Field type="text" label="Téléphone" inputMode="tel" value={q.contactPhone} onChange={e => q.setContactPhone(e.target.value)} />
        </div>
        {q.contactError && <p className={screen.error} role="alert">{q.contactError}</p>}
      </div>
    </Sheet>
  )
}

/** Facturer : situation, solde, période, retenue ou facture libre, toujours liées au chantier. */
export function BillSheet({ q, onClose }: { q: ChantierDetailState; onClose: () => void }) {
  const returnTo = encodeURIComponent(`/chantiers/${q.chantier.id}`)
  const periodic = q.billingPeriod !== 'none' && Number(q.billingAmount) > 0
  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title="Facturer" description="La facture s’ouvre dans l’éditeur, déjà liée au chantier.">
      <div className={styles.stack}>
        <ListGroup>
          {periodic && q.canCreateInvoice && (
            <ListRow
              title={q.billingGenerating ? 'Génération…' : 'Facture de période'}
              description={`${q.billingAmount}${NB}€ HT · prochaine le ${new Date(q.selectedBillingDate).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}`}
              disabled={q.billingGenerating}
              onClick={q.handleGeneratePeriodInvoice}
            />
          )}
          {q.chantier.quote_id && q.situationsSummary && (
            <ListRow title="Situations de travaux" description="Voir l’avancement facturé dans l’onglet Argent." onClick={() => { onClose(); q.setSegment('argent') }} />
          )}
          <ListRow
            title="Facture libre"
            description="Depuis zéro, liée à ce chantier"
            href={`/finances/invoice-editor?chantier=${q.chantier.id}&returnTo=${returnTo}`}
          />
        </ListGroup>
        {q.billingError && <p className={screen.error} role="alert">{q.billingError}</p>}
      </div>
    </Sheet>
  )
}

/** Rapport de chantier : période facultative, aperçu, téléchargement, envoi par email. */
export function ReportSheet({ q, onClose }: { q: ChantierDetailState; onClose: () => void }) {
  const params = new URLSearchParams()
  if (q.pdfFrom) params.set('from', q.pdfFrom)
  if (q.pdfTo) params.set('to', q.pdfTo)
  const base = `/api/pdf/chantier/${q.chantier.id}`
  const preview = `${base}${params.toString() ? `?${params}` : ''}`
  const download = `${base}?download=1${params.toString() ? `&${params}` : ''}`
  return (
    <Sheet open onOpenChange={o => { if (!o) onClose() }} title="Rapport de chantier" description="Laissez la période vide pour couvrir tout le chantier." cancelLabel="Fermer">
      <div className={styles.stack}>
        <div className={styles.fields}>
          <DateRow label="Du" value={q.pdfFrom} onChange={q.setPdfFrom} />
          <DateRow label="Au" value={q.pdfTo} onChange={q.setPdfTo} />
        </div>
        <div className={fiche.pdfActions}>
          <Button variant="secondary" size="lg" onClick={() => window.open(preview, '_blank', 'noreferrer')}>Aperçu</Button>
          <Button size="lg" onClick={() => window.open(download, '_blank', 'noreferrer')}>Télécharger</Button>
        </div>
        <ListGroup description={q.emailStatus === 'error' ? q.emailError ?? undefined : q.emailStatus === 'done' ? `Rapport envoyé à ${q.emailRecipient}.` : undefined}>
          <ListRow
            title={q.emailStatus === 'sending' ? 'Envoi en cours…' : 'Envoyer par email'}
            disabled={q.emailStatus === 'sending'}
            onClick={() => q.handleSendReportEmail()}
          />
        </ListGroup>
      </div>
    </Sheet>
  )
}
