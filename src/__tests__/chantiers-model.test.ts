import { describe, expect, it } from 'vitest'
import {
  applyQuoteToForm, EMPTY_CHANTIER_FORM, filterChantiers, fmtHours, recurrenceLabel, statusPill, statusTransitions,
} from '@/app/(app)/chantiers/chantiersModel'
import { buildDateFromParts, splitDateParts, visibleSegments } from '@/app/(app)/chantiers/[chantierId]/chantierModel'
import type { Chantier } from '@/lib/data/queries/chantiers'

const chantier = (over: Partial<Chantier>) => ({ id: 'c', title: 'Salle de bain', city: 'Lyon', status: 'en_cours', client: { id: 'k', company_name: 'Dupont', email: null }, ...over }) as Chantier

describe('liste des chantiers', () => {
  it('formate les heures sans minutes inutiles', () => {
    expect(fmtHours(7)).toBe('7h')
    expect(fmtHours(7.5)).toBe('7h30')
    expect(fmtHours(0.25)).toBe('0h15')
  })

  it('associe chaque statut à une pastille', () => {
    expect(statusPill('en_cours')).toEqual({ status: 'success', label: 'En cours' })
    expect(statusPill('suspendu').status).toBe('wait')
    expect(statusPill('annule').status).toBe('danger')
    expect(statusPill('termine').status).toBe('neutral')
  })

  it('filtre par texte (titre, client, ville) et par statut', () => {
    const list = [chantier({ id: '1' }), chantier({ id: '2', title: 'Terrasse', city: 'Caluire', status: 'termine', client: { id: 'm', company_name: 'Martin', email: null } })]
    expect(filterChantiers(list, 'martin', 'tous').map(c => c.id)).toEqual(['2'])
    expect(filterChantiers(list, 'lyon', 'tous').map(c => c.id)).toEqual(['1'])
    expect(filterChantiers(list, '', 'termine').map(c => c.id)).toEqual(['2'])
    expect(filterChantiers(list, '', 'tous')).toHaveLength(2)
  })

  it('propose les bonnes transitions de statut', () => {
    expect(statusTransitions('en_cours').map(t => t.to)).toEqual(['termine', 'suspendu', 'annule'])
    expect(statusTransitions('suspendu').map(t => t.to)).toEqual(['en_cours', 'termine', 'annule'])
    expect(statusTransitions('termine').map(t => t.to)).toEqual(['en_cours'])
    expect(statusTransitions('annule').map(t => t.to)).toEqual(['en_cours'])
  })

  it('nomme les récurrences et ignore le ponctuel', () => {
    expect(recurrenceLabel('mensuel')).toBe('Tous les mois')
    expect(recurrenceLabel('none')).toBeNull()
    expect(recurrenceLabel(null)).toBeNull()
  })

  it('pré-remplit le formulaire depuis un devis, puis le vide quand on le retire', () => {
    const quotes = [{ id: 'q1', title: 'Salle de bain', client_id: 'k1', total_ht: 4820.4, client_address_line1: '12 rue des Lilas', client_postal_code: '69003', client_city: 'Lyon', client_contact_name: 'Jean', client_contact_email: 'j@d.fr', client_contact_phone: '0612' }]
    const filled = applyQuoteToForm(EMPTY_CHANTIER_FORM, 'q1', quotes)
    expect(filled).toMatchObject({ quoteId: 'q1', title: 'Salle de bain', clientId: 'k1', budgetHt: '4820', city: 'Lyon', contactName: 'Jean' })
    expect(applyQuoteToForm(filled, '', quotes)).toEqual(EMPTY_CHANTIER_FORM)
  })
})

describe('fiche chantier', () => {
  const none = { canEditChantier: false, canManageTeam: false, canPointage: false, canManagePointages: false, canViewExpenses: false, canCreateExpenses: false, canEditExpenses: false, canDeleteExpenses: false, canEditRates: false }

  it('ne montre que les segments permis', () => {
    expect(visibleSegments(none).map(s => s.value)).toEqual(['travaux'])
    expect(visibleSegments({ ...none, canPointage: true }).map(s => s.value)).toEqual(['travaux', 'equipe'])
    expect(visibleSegments({ ...none, canEditChantier: true }).map(s => s.value)).toEqual(['travaux', 'equipe', 'argent', 'photos'])
  })

  it('appelle « Mes dépenses » le segment d’un utilisateur qui ne peut que créer des dépenses', () => {
    expect(visibleSegments({ ...none, canCreateExpenses: true }).find(s => s.value === 'argent')?.label).toBe('Mes dépenses')
    expect(visibleSegments({ ...none, canViewExpenses: true }).find(s => s.value === 'argent')?.label).toBe('Argent')
  })

  it('borne le jour au dernier jour du mois', () => {
    expect(buildDateFromParts('2026', '2', '31')).toBe('2026-02-28')
    expect(buildDateFromParts('2028', '2', '31')).toBe('2028-02-29')
    expect(splitDateParts('2026-11-05')).toEqual({ day: '5', month: '11', year: '2026' })
  })
})
