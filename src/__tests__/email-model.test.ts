import { describe, expect, it } from 'vitest'
import { buildFilter, contactsWithEmail, recipientCountFor, recipientLabelFor, visibleContactsFor } from '@/app/(app)/clients/emailModel'
import { countNew, convertLabel, filterRequests, replyMailto, requestStatus } from '@/app/(app)/requests/requestsModel'
import type { QuoteRequest } from '@/app/(app)/requests/page'
import type { Client } from '@/lib/data/queries/clients'

const clients = [
  { id: '1', company_name: 'Martin & Fils', email: 'contact@martin.test', status: 'active' },
  { id: '2', company_name: 'Bernard Toiture', email: ' ', status: 'active' },
  { id: '3', company_name: 'Lafayette', email: 'syndic@lafayette.test', status: 'lead_cold' },
  { id: '4', company_name: 'Durand', email: 'durand@x.test', status: 'lead_cold' },
] as unknown as Client[]

describe('destinataires de l’email groupé', () => {
  it('ne garde que les contacts avec une adresse', () => {
    expect(contactsWithEmail(clients).map(c => c.id)).toEqual(['1', '3', '4'])
  })

  it('filtre par catégorie puis par recherche (nom ou adresse)', () => {
    expect(visibleContactsFor(clients, 'lead_cold', '').map(c => c.id)).toEqual(['3', '4'])
    expect(visibleContactsFor(clients, 'all', 'DURAND').map(c => c.id)).toEqual(['4'])
    expect(visibleContactsFor(clients, 'all', 'lafayette.test').map(c => c.id)).toEqual(['3'])
  })

  it('compte la sélection manuelle avant la catégorie', () => {
    expect(recipientCountFor(clients, 'all', 0)).toBe(3)
    expect(recipientCountFor(clients, 'lead_cold', 0)).toBe(2)
    expect(recipientCountFor(clients, 'lead_cold', 1)).toBe(1)
    expect(recipientLabelFor('lead_cold', 0)).toBe('Leads froids')
    expect(recipientLabelFor('all', 2)).toBe('2 contacts sélectionnés')
  })

  it('choisit le filtre d’envoi', () => {
    expect(buildFilter(['a', 'b'], 'all')).toEqual({ mode: 'manual', ids: ['a', 'b'] })
    expect(buildFilter([], 'all')).toEqual({ mode: 'all' })
    expect(buildFilter([], 'active')).toEqual({ mode: 'all_active' })
    expect(buildFilter([], 'inactive')).toEqual({ mode: 'by_status', statuses: ['inactive'] })
  })
})

describe('demandes de devis', () => {
  const requests = [
    { id: 'a', status: 'new', email: 'a@x.test', subject: 'Terrasse', type: 'form' },
    { id: 'b', status: 'read', email: 'b@x.test', subject: null, type: 'catalog', freeform_notes: ' ' },
    { id: 'c', status: 'new', email: 'c@x.test', subject: null, type: 'catalog', freeform_notes: 'Précisions' },
  ] as unknown as QuoteRequest[]

  it('filtre et compte les nouvelles demandes', () => {
    expect(filterRequests(requests, 'new').map(r => r.id)).toEqual(['a', 'c'])
    expect(filterRequests(requests, 'all')).toHaveLength(3)
    expect(countNew(requests)).toBe(2)
  })

  it('traduit les statuts, avec « lu » par défaut', () => {
    expect(requestStatus('converted').status).toBe('success')
    expect(requestStatus('inconnu').label).toBe('Lu')
  })

  it('prépare la réponse par e-mail et le libellé de conversion', () => {
    expect(replyMailto(requests[0])).toBe('mailto:a@x.test?subject=Réponse à votre demande de devis : Terrasse')
    expect(replyMailto(requests[1])).toBe('mailto:b@x.test?subject=Réponse à votre demande de devis')
    expect(convertLabel(requests[0])).toBe('Convertir en lead + devis')
    expect(convertLabel(requests[1])).toBe('Créer client + devis catalogue')
    expect(convertLabel(requests[2])).toBe('Créer client + devis (catalogue + IA)')
  })
})
