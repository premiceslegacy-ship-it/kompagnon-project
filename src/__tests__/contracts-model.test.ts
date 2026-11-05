import { describe, expect, it } from 'vitest'
import {
  applyContractChantier,
  applyContractClient,
  applyContractTemplate,
  applyContractType,
  availableQuotesFor,
  buildInitialForm,
  clientName,
  contractPayload,
  contractStats,
  filterContracts,
  paginate,
} from '@/app/(app)/contracts/contractsModel'
import type { Chantier } from '@/lib/data/queries/chantiers'
import type { Client } from '@/lib/data/queries/clients'
import type { ContractListItem, ContractTemplateOption } from '@/lib/data/queries/contracts'
import type { Quote } from '@/lib/data/queries/quotes'

const templates = [
  { key: 'base-st', title: 'Sous-traitance', type: 'sous_traitance', clauses: { objet: 'ST' }, customSections: [{ id: 's1', title: 'Annexe', content: 'x' }] },
  { key: 'base-mt', title: 'Maintenance', type: 'maintenance', clauses: { objet: 'MT' }, customSections: [] },
  { key: 'custom:1', title: 'Copropriété', type: 'maintenance', clauses: { objet: 'CP' }, customSections: [], isCustom: true },
] as unknown as ContractTemplateOption[]

const clients = [
  { id: 'c1', company_name: 'Martin & Fils', email: 'contact@martin.test', phone: '0600000000', address_line1: '1 rue A', postal_code: '75001', city: 'Paris' },
  { id: 'c2', company_name: null, first_name: 'Élodie', last_name: 'Durand', email: null, phone: null, address_line1: null, postal_code: null, city: null },
] as unknown as Client[]

const quotes = [
  { id: 'q1', number: 'D-1', client: { id: 'c1' } },
  { id: 'q2', number: 'D-2', client: { id: 'c2' } },
  { id: 'q3', number: null, client: { id: 'c1' } },
] as unknown as Quote[]

function contract(overrides: Partial<ContractListItem> = {}): ContractListItem {
  return { id: 'k1', title: 'Entretien chaufferie', counterparty_name: 'Martin & Fils', template_title: 'Maintenance', status: 'draft', pdf_reference: null, pdf_generated_at: null, ...overrides } as unknown as ContractListItem
}

describe('formulaire de contrat', () => {
  it('démarre en sous-traitance avec le premier modèle de ce type', () => {
    const form = buildInitialForm(templates)
    expect(form).toMatchObject({ contractType: 'sous_traitance', templateKey: 'base-st', role: 'donneur_ordre' })
    expect(form.customSections).toHaveLength(1)
  })

  it('changer le type reprend le premier modèle du nouveau type', () => {
    const next = applyContractType(buildInitialForm(templates), 'maintenance', templates)
    expect(next.templateKey).toBe('base-mt')
    expect(next.clauses).toEqual({ objet: 'MT' })
    expect(next.customSections).toEqual([])
  })

  it('changer de modèle remplace clauses et sections, et ignore une clé inconnue', () => {
    const form = buildInitialForm(templates)
    expect(applyContractTemplate(form, 'custom:1', templates).clauses).toEqual({ objet: 'CP' })
    expect(applyContractTemplate(form, 'nope', templates)).toBe(form)
  })

  it('choisir un client remplit la partie contractante', () => {
    const next = applyContractClient(buildInitialForm(templates), 'c1', clients, quotes)
    expect(next).toMatchObject({ clientId: 'c1', counterpartyName: 'Martin & Fils', counterpartyEmail: 'contact@martin.test', counterpartyAddress: '1 rue A, 75001, Paris' })
  })

  it('écarte un devis qui n’appartient pas au nouveau client', () => {
    const form = { ...buildInitialForm(templates), quoteId: 'q1' }
    expect(applyContractClient(form, 'c2', clients, quotes).quoteId).toBe('')
    expect(applyContractClient(form, 'c1', clients, quotes).quoteId).toBe('q1')
  })

  it('un chantier reprend son client, sans écraser les coordonnées s’il n’en a pas', () => {
    const chantiers = [{ id: 'h1', client: { id: 'c2' } }, { id: 'h2', client: null }] as unknown as Chantier[]
    const base = { ...buildInitialForm(templates), counterpartyName: 'Saisi à la main' }
    expect(applyContractChantier(base, 'h1', chantiers, clients)).toMatchObject({ clientId: 'c2', counterpartyName: 'Élodie Durand' })
    expect(applyContractChantier(base, 'h2', chantiers, clients)).toMatchObject({ clientId: '', counterpartyName: 'Saisi à la main' })
  })

  it('ne propose que les devis numérotés, ceux du client si un client est choisi', () => {
    expect(availableQuotesFor({ clientId: '' }, quotes).map(q => q.id)).toEqual(['q1', 'q2'])
    expect(availableQuotesFor({ clientId: 'c1' }, quotes).map(q => q.id)).toEqual(['q1'])
  })

  it('prépare l’envoi avec des null pour les champs vides et une durée rognée', () => {
    const payload = contractPayload({ ...buildInitialForm(templates), durationText: '  12 mois  ' })
    expect(payload).toMatchObject({ clientId: null, chantierId: null, quoteId: null, counterpartyEmail: null, durationText: '12 mois' })
  })
})

describe('liste des contrats', () => {
  const list = [
    contract(),
    contract({ id: 'k2', title: 'Sous-traitance carrelage', counterparty_name: 'Bernard Toiture', template_title: 'Sous-traitance', status: 'signed', pdf_reference: 'CT-2026-007', pdf_generated_at: '2026-10-01' }),
  ]

  it('cherche dans le titre, la partie, le modèle et la référence PDF, sans casse', () => {
    expect(filterContracts(list, 'martin').map(c => c.id)).toEqual(['k1'])
    expect(filterContracts(list, 'ct-2026').map(c => c.id)).toEqual(['k2'])
    expect(filterContracts(list, '  ')).toHaveLength(2)
    expect(filterContracts(list, 'zzz')).toHaveLength(0)
  })

  it('compte les statuts et les PDF générés', () => {
    expect(contractStats(list)).toEqual({ total: 2, draft: 1, signed: 1, generated: 1 })
  })

  it('pagine par dix et borne la page demandée', () => {
    const items = Array.from({ length: 23 }, (_, i) => i)
    expect(paginate(items, 1)).toMatchObject({ totalPages: 3, currentPage: 1, start: 0 })
    expect(paginate(items, 3).items).toHaveLength(3)
    expect(paginate(items, 9).currentPage).toBe(3)
    expect(paginate([], 1).totalPages).toBe(1)
  })

  it('nomme un client sans raison sociale', () => {
    expect(clientName(clients[1])).toBe('Élodie Durand')
  })
})
