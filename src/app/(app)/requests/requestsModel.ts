// @atelier-migrated
// Logique pure des demandes de devis : statuts, filtre, réponse par e-mail. Aucun état React ici.

import type { QuoteRequest } from './page'

export type RequestFilter = 'all' | 'new' | 'read'

export const REQUEST_FILTERS: { value: RequestFilter; label: string }[] = [
  { value: 'all', label: 'Toutes' },
  { value: 'new', label: 'Nouvelles' },
  { value: 'read', label: 'Lues' },
]

export const REQUEST_STATUS: Record<string, { label: string; status: 'wait' | 'success' | 'neutral' }> = {
  new: { label: 'Nouveau', status: 'wait' },
  read: { label: 'Lu', status: 'neutral' },
  converted: { label: 'Converti', status: 'success' },
  archived: { label: 'Archivé', status: 'neutral' },
}

export function requestStatus(status: string) {
  return REQUEST_STATUS[status] ?? REQUEST_STATUS.read
}

export function filterRequests(requests: QuoteRequest[], filter: RequestFilter): QuoteRequest[] {
  return requests.filter(r => filter === 'all' || r.status === filter)
}

export function countNew(requests: QuoteRequest[]): number {
  return requests.filter(r => r.status === 'new').length
}

export function attachmentLabel(request: Pick<QuoteRequest, 'attachments'>): string {
  return request.attachments?.[0]?.filename ?? 'fichier joint'
}

export function replyMailto(request: Pick<QuoteRequest, 'email' | 'subject'>): string {
  return `mailto:${request.email}?subject=Réponse à votre demande de devis${request.subject ? ` : ${request.subject}` : ''}`
}

/** Libellé du bouton de conversion selon le type de demande. */
export function convertLabel(request: Pick<QuoteRequest, 'type' | 'freeform_notes'>): string {
  if (request.type !== 'catalog') return 'Convertir en lead + devis'
  return request.freeform_notes?.trim() ? 'Créer client + devis (catalogue + IA)' : 'Créer client + devis catalogue'
}

export function formatRequestDate(iso: string, long = true): string {
  return new Date(iso).toLocaleDateString('fr-FR', long ? { day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' })
}
