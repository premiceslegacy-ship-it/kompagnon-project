'use client'
// @atelier-migrated

import { useState } from 'react'
import { AlertDialog } from '@/components/ui/AlertDialog'
import { Button } from '@/components/ui/Button'
import { ListGroup, ListRow } from '@/components/ui/ListGroup'
import { Sheet } from '@/components/ui/Sheet'
import { StatusPill } from '@/components/ui/StatusPill'
import { formatAddress, getMapsDirectionsUrl } from '@/lib/address'
import { AI_NAME } from '@/lib/brand'
import type { QuoteRequest } from './page'
import { attachmentLabel, convertLabel, formatRequestDate, replyMailto, requestStatus } from './requestsModel'
import { useRequestActions, type RequestsState } from './useRequests'
import styles from '../finances/quote-editor/QuoteEditor.module.css'

/** Détail d'une demande : coordonnées, projet, pièce jointe et actions. */
export function RequestSheet({ request, patch, onClose }: { request: QuoteRequest; patch: RequestsState['patch']; onClose: () => void }) {
  const a = useRequestActions(request, patch, onClose)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const status = requestStatus(request.status)
  const converted = request.status === 'converted'
  const address = formatAddress({ address_line1: request.chantier_address_line1, postal_code: request.chantier_postal_code, city: request.chantier_city })

  return (
    <>
      <Sheet
        open
        onOpenChange={open => { if (!open) onClose() }}
        title={request.name}
        description={`${formatRequestDate(request.created_at)}${request.subject ? ` · ${request.subject}` : ''}`}
        cancelLabel="Fermer"
      >
        <div className={styles.detail}>
          <div className={styles.inline}>
            <StatusPill status={status.status}>{status.label}</StatusPill>
            {request.type === 'catalog' && <StatusPill status="neutral">Catalogue</StatusPill>}
            {request.prestation_type && <StatusPill status="neutral">{request.prestation_type}</StatusPill>}
          </div>

          <ListGroup title="Coordonnées">
            <ListRow title="Email" description={request.email} href={`mailto:${request.email}`} />
            {request.phone && <ListRow title="Téléphone" description={request.phone} href={`tel:${request.phone}`} />}
            {request.company_name && <ListRow title="Entreprise" description={request.company_name} />}
            {address && <ListRow title="Chantier" description={address} href={getMapsDirectionsUrl(address)} target="_blank" rel="noopener noreferrer" />}
          </ListGroup>

          {request.type === 'catalog' && request.catalog_items && request.catalog_items.length > 0 && (
            <ListGroup title="Prestations sélectionnées">
              {request.catalog_items.map((item, i) => (
                <ListRow key={i} title={item.description} trailing={<span className={styles.amount}>× {item.quantity}{item.unit ? ` ${item.unit}` : ''}</span>} />
              ))}
            </ListGroup>
          )}

          {(request.prestation_type || request.dimensions) && (
            <ListGroup>
              {request.prestation_type && <ListRow title="Prestation" description={request.prestation_type} />}
              {request.dimensions && <ListRow title="Dimensions" description={request.dimensions} />}
            </ListGroup>
          )}

          <ListGroup title="Description du projet">
            <li><p className={styles.requestText}>{request.description}</p></li>
          </ListGroup>

          {request.has_attachment && (
            <ListGroup title="Pièce jointe">
              <ListRow title={`Télécharger ${attachmentLabel(request)}`} href={`/api/requests/${encodeURIComponent(request.id)}/attachment`} />
              {!converted && (
                <ListRow
                  title={`Générer un devis avec ${AI_NAME}`}
                  description={a.isAnalyzingAI ? 'Analyse du document…' : 'Lit le document et prépare les lignes'}
                  disabled={a.isAnalyzingAI}
                  onClick={() => void a.handleAnalyzeWithAI()}
                />
              )}
            </ListGroup>
          )}
          {a.aiError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{a.aiError}</p>}
          {a.convertError && <p className={`${styles.hint} ${styles.warn}`} role="alert" style={{ marginTop: 0 }}>{a.convertError}</p>}

          {converted ? (
            <ListGroup>
              <ListRow title="Lead créé" description="Cette demande a déjà été convertie" />
              {request.quote_id && <ListRow title="Voir le devis" className={styles.accentRow} onClick={() => a.openQuote(request.quote_id!)} />}
            </ListGroup>
          ) : (
            <Button size="lg" loading={a.isConverting} disabled={a.isPending} onClick={a.handleConvert}>
              {convertLabel(request)}
            </Button>
          )}

          <ListGroup>
            <ListRow title="Répondre par e-mail" href={replyMailto(request)} />
          </ListGroup>
          <ListGroup>
            <li className={styles.destructiveRow}><button type="button" disabled={a.isPending} onClick={() => setConfirmArchive(true)}>Archiver la demande</button></li>
          </ListGroup>
        </div>
      </Sheet>
      <AlertDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title="Archiver cette demande ?"
        description="Elle ne sera plus visible dans la liste."
        confirmLabel="Archiver"
        onConfirm={() => { setConfirmArchive(false); a.handleArchive() }}
      />
    </>
  )
}
