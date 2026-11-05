import { describe, expect, it } from 'vitest'
import {
  autoMapColumns,
  buildImportRows,
  canImport,
  clientStats,
  exportClientsCsv,
  filterClients,
  followupState,
  importTemplateCsv,
  needsFollowup,
  parseCSV,
  readCSV,
  sortClients,
  sourceLabel,
  statusPill,
} from '@/app/(app)/clients/clientsModel'
import { paginate } from '@/lib/pagination'
import type { Client } from '@/lib/data/queries/clients'

const NOW = new Date('2026-11-06T10:00:00Z').getTime()
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString()

function client(overrides: Partial<Client> = {}): Client {
  return {
    id: 'c', organization_id: 'o', type: 'company', company_name: 'Martin & Fils', contact_name: null, first_name: null, last_name: null,
    email: 'contact@martin.test', phone: null, siret: null, address_line1: null, city: null, postal_code: null, status: 'active', source: null,
    total_revenue: 0, payment_terms_days: 30, internal_notes: null, created_at: daysAgo(100), ...overrides,
  } as Client
}

describe('suivi des relances', () => {
  it('relance un contact avec un devis en attente', () => {
    expect(followupState(client({ pending_quotes: 2 }), NOW)).toEqual({ kind: 'pending_quotes', label: '2 devis en attente' })
  })

  it('relance un lead sans échange depuis quatorze jours, pas avant', () => {
    expect(needsFollowup(client({ status: 'lead_hot', last_activity_at: daysAgo(13) }), NOW)).toBe(false)
    expect(followupState(client({ status: 'lead_hot', last_activity_at: daysAgo(14) }), NOW).label).toBe('Sans échange depuis 14 j')
  })

  it('distingue un lead jamais contacté et ignore les clients actifs', () => {
    expect(followupState(client({ status: 'prospect', created_at: daysAgo(20) }), NOW).label).toBe('Jamais contacté (20 j)')
    expect(needsFollowup(client({ status: 'active', created_at: daysAgo(400) }), NOW)).toBe(false)
  })
})

describe('liste', () => {
  const list = [
    client({ id: '1', company_name: 'Zèbre SARL', total_revenue: 500, created_at: daysAgo(5), status: 'active' }),
    client({ id: '2', company_name: 'Abeille', email: 'a@x.test', total_revenue: 9000, created_at: daysAgo(50), status: 'lead_hot', pending_quotes: 1 }),
    client({ id: '3', company_name: null, first_name: 'Élodie', last_name: 'Durand', email: null, total_revenue: 100, created_at: daysAgo(10), status: 'subcontractor' }),
  ]

  it('cherche dans le nom et l’e-mail, sans tenir compte de la casse', () => {
    expect(filterClients(list, 'abeille', 'All', NOW).map(c => c.id)).toEqual(['2'])
    expect(filterClients(list, 'A@X', 'All', NOW).map(c => c.id)).toEqual(['2'])
  })

  it('filtre par statut et par « à relancer »', () => {
    expect(filterClients(list, '', 'active', NOW).map(c => c.id)).toEqual(['1'])
    expect(filterClients(list, '', 'followup', NOW).map(c => c.id)).toEqual(['2'])
  })

  it('trie par date, par nom ou par chiffre d’affaires', () => {
    expect(sortClients(list, 'created_at').map(c => c.id)).toEqual(['1', '3', '2'])
    expect(sortClients(list, 'name').map(c => c.id)).toEqual(['2', '3', '1'])
    expect(sortClients(list, 'revenue_desc').map(c => c.id)).toEqual(['2', '1', '3'])
  })

  it('compte clients, pipeline, relances et chiffre d’affaires des seuls clients actifs', () => {
    expect(clientStats(list, NOW)).toEqual({ active: 1, pipeline: 1, revenue: 500, followup: 1 })
  })

  it('pagine par dix', () => {
    expect(paginate(Array.from({ length: 12 }, (_, i) => i), 2).items).toHaveLength(2)
  })

  it('traduit statut et source', () => {
    expect(statusPill('lead_hot')).toEqual({ label: 'Lead chaud', status: 'wait' })
    expect(statusPill('inconnu').status).toBe('neutral')
    expect(sourceLabel('site_web')).toBe('Site web')
    expect(sourceLabel(null)).toBe('/')
  })
})

describe('import CSV', () => {
  it('détecte le séparateur et respecte les guillemets', () => {
    expect(parseCSV('Nom;Email\n"Dupont; Fils";a@b.fr')).toEqual([['Nom', 'Email'], ['Dupont; Fils', 'a@b.fr']])
    expect(parseCSV('Nom,Email\nDupont,a@b.fr')[1]).toEqual(['Dupont', 'a@b.fr'])
  })

  it('associe les colonnes d’après leur en-tête', () => {
    const map = autoMapColumns(['company_name', 'Email', 'Phone', 'City'])
    expect(map.company_name).toBe('0')
    expect(map.email).toBe('1')
    expect(map.phone).toBe('2')
    expect(map.city).toBe('3')
  })

  it('ignore un fichier sans ligne de données et les lignes vides', () => {
    expect(readCSV('Nom')).toBeNull()
    expect(readCSV('Nom;Email\nDupont;a@b.fr\n;;')?.dataRows).toHaveLength(1)
  })

  it('exige au moins un nom pour importer', () => {
    expect(canImport({ email: '1' })).toBe(false)
    expect(canImport({ last_name: '0' })).toBe(true)
  })

  it('met « lead froid » par défaut pour un import de leads, sans écraser un statut', () => {
    const rows = buildImportRows([['Dupont', ''], ['Martin', 'lead_hot']], { last_name: '0', status: '1' }, true)
    expect(rows.map(r => r.status)).toEqual(['lead_cold', 'lead_hot'])
    expect(buildImportRows([['Dupont', '']], { last_name: '0', status: '1' }, false)[0].status).toBe('')
  })

  it('fournit un modèle différent pour les leads et les clients, et un export complet', () => {
    expect(importTemplateCsv(true)).toContain('lead_hot')
    expect(importTemplateCsv(false)).toContain('active')
    expect(exportClientsCsv([client({ id: 'x', total_revenue: 12 })]).split('\n')[1]).toBe('x,"Martin & Fils",,,contact@martin.test,,active,,12')
  })
})
