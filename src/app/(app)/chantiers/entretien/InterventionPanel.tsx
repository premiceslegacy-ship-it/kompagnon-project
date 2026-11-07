'use client'
// @atelier-migrated
// Une intervention : résumé, actions (réaliser, facturer, rapport PDF, envoi au client), photos du rapport.

import { useRef } from 'react'
import ClientEmailRequiredModal from '@/components/ClientEmailRequiredModal'
import { Field } from '@/components/ui/Field'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import type { MaintenanceContract, MaintenanceIntervention } from '@/lib/data/queries/maintenance'
import { INTERVENTION_STATUS, fmtDate, fmtHours, fmtMoney, intervenantName, invoiceBadge } from './entretienModel'
import { useInterventionReport } from './useContractDetail'
import screen from '@/components/layout/Screen.module.css'
import styles from '../../finances/quote-editor/QuoteEditor.module.css'
import fiche from '../[chantierId]/ChantierFiche.module.css'
import local from './Entretien.module.css'

export default function InterventionPanel({ iv, contract, intervenants, busy, error, onClose, onEdit, onBill, onMarkDone, onDelete }: {
  iv: MaintenanceIntervention
  contract: MaintenanceContract
  intervenants: { id: string; label: string }[]
  busy: boolean
  error: string | null
  onClose: () => void
  onEdit: () => void
  onBill: () => void
  onMarkDone: () => void
  onDelete: () => void
}) {
  const r = useInterventionReport(iv, contract)
  const photoInput = useRef<HTMLInputElement>(null)
  const st = INTERVENTION_STATUS[iv.statut]
  const who = intervenantName(iv, intervenants)
  const costs = (iv.cost_parts_ht ?? 0) + (iv.cost_travel_ht ?? 0) + (iv.cost_other_ht ?? 0)
  const badge = iv.invoice ? invoiceBadge(iv.invoice) : null
  return (
    <>
      {/* La fenêtre d'email prend la main : la feuille se retire le temps de la saisie, l'état reste ici. */}
      <Sheet
        open={!r.emailRequiredOpen}
        onOpenChange={o => { if (!o) onClose() }}
        title={fmtDate(iv.date_intervention)}
        description={[st.label, who].filter(Boolean).join(' · ')}
        cancelLabel="Fermer"
      >
        <div className={local.sheetBody}>
          <ListGroup>
            {iv.statut === 'planifiée' && (
              <ListRow title={busy ? 'Enregistrement…' : 'Marquer comme réalisée'} disabled={busy} className={styles.accentRow} onClick={onMarkDone} />
            )}
            {iv.statut === 'réalisée' && !iv.invoice_id && (
              <ListRow title="Facturer l’intervention" description={iv.billable_amount_ht != null ? `${fmtMoney(iv.billable_amount_ht)} HT` : undefined} disabled={busy} className={styles.accentRow} onClick={onBill} />
            )}
            {iv.invoice && <ListRow title="Ouvrir la facture" description={badge?.label} href={`/finances/invoice-editor?id=${iv.invoice.id}`} />}
            <ListRow title="Rapport PDF" href={`/api/pdf/maintenance/intervention/${iv.id}`} target="_blank" rel="noreferrer" />
            <ListRow title={r.sendingReport ? 'Envoi du rapport…' : 'Envoyer le rapport au client'} disabled={r.sendingReport} onClick={() => r.handleSendReport()} />
            <ListRow title="Modifier" onClick={onEdit} />
          </ListGroup>
          {r.sendStatus === 'done' && <p className={screen.ok} role="status">Rapport envoyé au client.</p>}
          {r.sendStatus === 'error' && <p className={screen.error} role="alert">{r.sendError}</p>}
          {error && <p className={screen.error} role="alert">{error}</p>}

          {(iv.duration_hours != null || costs > 0 || iv.billable_amount_ht != null || iv.invoice) && (
            <ListGroup title="Chiffres">
              {iv.duration_hours != null && <ListRow title="Durée" trailing={<span className={styles.amount}>{fmtHours(iv.duration_hours)}</span>} />}
              {costs > 0 && <ListRow title="Coûts" trailing={<span className={styles.amount}>{fmtMoney(costs)}</span>} />}
              {iv.billable_amount_ht != null && <ListRow title="À facturer HT" trailing={<span className={styles.amount}>{fmtMoney(iv.billable_amount_ht)}</span>} />}
              {iv.invoice && badge && (
                <ListRow
                  title="Facture"
                  description={[iv.invoice.number, iv.invoice.total_ht != null ? `${fmtMoney(iv.invoice.total_ht)} HT` : null].filter(Boolean).join(' · ') || undefined}
                  trailing={<StatusPill status={badge.pill}>{badge.label}</StatusPill>}
                />
              )}
            </ListGroup>
          )}

          {iv.rapport && <ListGroup title="Rapport"><ListRow title={iv.rapport} /></ListGroup>}
          {iv.observations && <ListGroup title="Observations"><ListRow title={iv.observations} /></ListGroup>}
          {iv.billable_notes && <ListGroup title="Facturable"><ListRow title={iv.billable_notes} /></ListGroup>}

          <div className={local.sheetSection}>
            <h3 className={local.sheetHeading}>Photos du rapport</h3>
            {r.photos.length > 0 && (
              <div className={local.photos}>
                {r.photos.map(photo => (
                  <figure key={photo.id} className={local.photo} style={{ margin: 0 }}>
                    {photo.url && /* eslint-disable-next-line @next/next/no-img-element */ <img src={photo.url} alt={photo.title ?? photo.caption ?? 'Photo de l’intervention'} />}
                    <p>{photo.title ?? 'Photo'}{photo.caption && <small>{photo.caption}</small>}</p>
                  </figure>
                ))}
              </div>
            )}
            <div className={styles.fields}>
              <Field type="text" label="Titre" placeholder="Titre de la photo" value={r.photoTitle} onChange={e => r.setPhotoTitle(e.target.value)} />
              <Field type="text" label="Description" placeholder="Description" value={r.photoCaption} onChange={e => r.setPhotoCaption(e.target.value)} />
            </div>
            <ListGroup>
              <ListRow title={r.photoUploading ? 'Envoi de la photo…' : 'Ajouter une photo'} disabled={r.photoUploading} className={styles.accentRow} onClick={() => photoInput.current?.click()} />
            </ListGroup>
            <input ref={photoInput} className={fiche.fileInput} type="file" accept="image/*" tabIndex={-1} disabled={r.photoUploading} onChange={r.handlePhotoUpload} aria-label="Ajouter une photo au rapport" />
            {r.photoError && <p className={screen.error} role="alert">{r.photoError}</p>}
          </div>

          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" onClick={onDelete}>Supprimer l’intervention</button></li>
          </ListGroup>
        </div>
      </Sheet>
      <ClientEmailRequiredModal
        open={r.emailRequiredOpen}
        client={r.getEmailTarget()}
        documentLabel="le rapport d’intervention"
        onCancel={() => r.setEmailRequiredOpen(false)}
        onSaved={r.handleClientEmailSaved}
      />
    </>
  )
}
