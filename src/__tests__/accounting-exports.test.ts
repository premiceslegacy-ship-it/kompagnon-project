import { describe, expect, it } from 'vitest'
import { generateCsv, type CsvInvoice } from '@/lib/exports/csv-generator'
import { generateFec, type FecInvoice, type FecOrgProfile, type FecReceivedInvoice } from '@/lib/exports/fec-generator'

const orgProfile: FecOrgProfile = {
  siren: '123456789',
  is_vat_subject: true,
  tva_sur_debits: true,
  business_profile: 'btp',
}

const standardInvoice: FecInvoice = {
  id: 'invoice-standard',
  number: 'FAC-2026-001',
  invoice_type: 'standard',
  issue_date: '2026-01-15',
  total_ht: 100,
  total_tva: 20,
  total_ttc: 120,
  total_paid: 120,
  paid_at: '2026-01-20',
  is_vat_subject: true,
  pa_message_id: null,
  client: {
    id: 'client-0001',
    display_name: 'Client Test',
    siret: null,
  },
  items: [{ unit_price: 100, quantity: 1, vat_rate: 20 }],
  chantier_title: null,
}

const creditNote: FecInvoice = {
  ...standardInvoice,
  id: 'invoice-avoir',
  number: 'AV-2026-001',
  invoice_type: 'avoir',
  issue_date: '2026-01-18',
  total_paid: 0,
  paid_at: null,
}

const receivedInvoice: FecReceivedInvoice = {
  id: 'received-1',
  invoice_number: 'FOUR-2026-001',
  invoice_date: '2026-01-19',
  supplier_siret: '12345678900012',
  supplier_name: 'Supplier Test',
  total_ht: 50,
  total_tva: 10,
  total_ttc: 60,
}

describe('generateFec content filters', () => {
  it('includes only emitted invoice lines when only invoices are selected', () => {
    const result = generateFec({
      invoices: [standardInvoice, creditNote],
      receivedInvoices: [receivedInvoice],
      orgProfile,
      includeInvoices: true,
      includeAvoirs: false,
      includePayments: false,
      includeReceivedInvoices: false,
    })

    expect(result.content).toContain('VE|Ventes')
    expect(result.content).not.toContain('AV|Avoirs')
    expect(result.content).not.toContain('BQ|Banque')
    expect(result.content).not.toContain('AC|Achats')
  })

  it('keeps avoirs, payments, and received invoices independently selectable', () => {
    const result = generateFec({
      invoices: [standardInvoice, creditNote],
      receivedInvoices: [receivedInvoice],
      orgProfile,
      includeInvoices: false,
      includeAvoirs: true,
      includePayments: true,
      includeReceivedInvoices: true,
    })

    expect(result.content).not.toContain('VE|Ventes')
    expect(result.content).toContain('AV|Avoirs')
    expect(result.content).toContain('BQ|Banque')
    expect(result.content).toContain('AC|Achats')
  })
})

describe('generateCsv content filters', () => {
  const csvInvoice: CsvInvoice = {
    number: 'FAC-2026-001',
    issue_date: '2026-01-15',
    invoice_type: 'standard',
    client_name: 'Client Test',
    client_siret: null,
    total_ht: 100,
    total_tva: 20,
    total_ttc: 120,
    total_paid: 120,
    paid_at: '2026-01-20',
    status: 'paid',
    chantier_title: null,
    tva_sur_debits: true,
    is_vat_subject: true,
    has_auto_liquidation: false,
    pa_message_id: null,
    vat_breakdown: [{ rate: 20, base_ht: 100, vat_amount: 20 }],
  }

  it('blanks payment columns when payments are excluded', () => {
    const content = generateCsv([csvInvoice], true, false)
    const row = content.split('\r\n')[1]

    expect(row).toContain('FAC-2026-001')
    expect(row).not.toContain('120,00;Payée;2026-01-20')
  })
})
