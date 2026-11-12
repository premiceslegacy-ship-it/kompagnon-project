import { describe, expect, it } from 'vitest'
import { generateCsv, type CsvInvoice } from '@/lib/exports/csv-generator'
import { generateFec, type FecInvoice, type FecPayment, type FecOrgProfile, type FecReceivedInvoice } from '@/lib/exports/fec-generator'
import { AccountingExportAuthorityError } from '@/lib/exports/vat-rules'

const orgProfile: FecOrgProfile = {
  siren: '123456789',
  is_vat_subject: true,
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
  is_vat_subject: true,
  is_reverse_charge: false,
  vat_breakdown: null,
  applied_acompte_ht: null,
  credit_note_source: null,
  tva_sur_debits: true,
  business_profile: 'btp',
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
  issue_date: '2026-01-25',
  credit_note_source: { invoice_type: 'standard', paid_amount_before_credit: 120 },
}

const fullPayment: FecPayment = {
  id: 'payment-1', invoice: standardInvoice, amount: 120,
  payment_date: '2026-01-20', reference: 'VIR-001', prior_paid_amount: 0,
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
      payments: [fullPayment],
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
      payments: [fullPayment],
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

describe('issued tax authority in accounting exports', () => {
  function rows(content: string): Array<Record<string, string>> {
    const [header, ...data] = content.trim().split(/\r?\n/).map(line => line.split('|'))
    return data.map(values => Object.fromEntries(header.map((key, index) => [key, values[index]])))
  }

  function exportInvoice(invoice: FecInvoice, payments: FecPayment[] = []) {
    return generateFec({
      invoices: [invoice], payments, receivedInvoices: [], orgProfile,
      includeInvoices: true, includeAvoirs: false, includePayments: true, includeReceivedInvoices: false,
    })
  }

  it('posts VAT from rounded visible line bases, separately for each rate', () => {
    const invoice: FecInvoice = {
      ...standardInvoice, total_ht: 0.20, total_tva: 0.03, total_ttc: 0.23,
      items: [20, 10].flatMap(vat_rate => Array.from({ length: 10 }, () => ({ quantity: 0.001, unit_price: 6, vat_rate }))),
    }
    const entries = rows(exportInvoice(invoice).content)
    const credits = (account: string) => entries.filter(row => row.CompteNum === account)
      .reduce((sum, row) => sum + Math.round(Number(row.Credit.replace(',', '.')) * 100), 0)
    expect(credits('44571')).toBe(2)
    expect(credits('44572')).toBe(1)
    expect(entries.filter(row => row.CompteNum === '411')
      .reduce((sum, row) => sum + Math.round(Number(row.Debit.replace(',', '.')) * 100), 0)).toBe(23)
  })

  it.each([true, false])('never posts collected VAT for reverse charge (VAT on debits: %s)', tva_sur_debits => {
    const invoice: FecInvoice = {
      ...standardInvoice, is_reverse_charge: true, tva_sur_debits, total_tva: 0, total_ttc: 100,
    }
    const entries = rows(exportInvoice(invoice, [{ ...fullPayment, invoice, amount: 100 }]).content)
    expect(entries.some(row => /^4457/.test(row.CompteNum))).toBe(false)
    expect(entries.filter(row => row.CompteNum === '512')
      .reduce((sum, row) => sum + Math.round(Number(row.Debit.replace(',', '.')) * 100), 0)).toBe(10_000)
  })

  it('does not misclassify a non-VAT-subject seller as reverse charge', () => {
    const invoice: FecInvoice = {
      ...standardInvoice, is_vat_subject: false, total_tva: 0, total_ttc: 100,
    }
    expect(exportInvoice(invoice).warnings).toEqual([])
  })

  function sum(entries: Array<Record<string, string>>, account: string, column: 'Debit' | 'Credit') {
    return entries.filter(row => row.CompteNum === account)
      .reduce((total, row) => total + Math.round(Number(row[column].replace(',', '.')) * 100), 0)
  }

  function accounting(invoices: FecInvoice[], payments: FecPayment[] = []) {
    return rows(generateFec({
      invoices, payments, receivedInvoices: [], orgProfile,
      includeInvoices: true, includeAvoirs: true, includePayments: true, includeReceivedInvoices: false,
    }).content)
  }

  const deposit: FecInvoice = {
    ...standardInvoice, id: 'deposit', number: 'AC-2026-001', invoice_type: 'acompte',
    total_ht: 150.91, total_tva: 30.18, total_ttc: 181.09,
    items: [{ quantity: 1, unit_price: 150.91, vat_rate: 20 }],
  }
  const balance: FecInvoice = {
    ...standardInvoice, id: 'balance', number: 'FAC-2026-002', invoice_type: 'solde',
    total_ht: 352.12, total_tva: 70.43, total_ttc: 422.55,
    items: [{ quantity: 1, unit_price: 352.12, vat_rate: 20 }],
    vat_breakdown: [{ rate: 20, taxable_basis: 352.12, tax_amount: 70.43 }],
    applied_acompte_ht: 150.91,
  }

  it('recognizes the whole contract once and clears the advance liability without billing it twice', () => {
    const entries = accounting([deposit, balance])
    expect(sum(entries, '706', 'Credit')).toBe(50_303)
    expect(sum(entries, '4191', 'Credit') - sum(entries, '4191', 'Debit')).toBe(0)
    expect(sum(entries, '44571', 'Credit')).toBe(10_061)
    expect(sum(entries, '411', 'Debit') - sum(entries, '411', 'Credit')).toBe(60_364)
  })

  it('reverses both residual revenue and advance apurement for a full balance credit note', () => {
    const credit: FecInvoice = {
      ...balance, id: 'balance-credit', number: 'AV-2026-002', invoice_type: 'avoir',
      credit_note_source: { invoice_type: 'solde', paid_amount_before_credit: 0 },
    }
    const entries = accounting([deposit, balance, credit])
    expect(sum(entries, '706', 'Credit') - sum(entries, '706', 'Debit')).toBe(0)
    expect(sum(entries, '4191', 'Credit') - sum(entries, '4191', 'Debit')).toBe(15_091)
    expect(sum(entries, '44571', 'Credit') - sum(entries, '44571', 'Debit')).toBe(3_018)
  })

  it('preserves a positive residual base with zero cumulative VAT', () => {
    const tinyDeposit: FecInvoice = {
      ...deposit, total_ht: 0.03, total_tva: 0.01, total_ttc: 0.04,
      items: [{ quantity: 1, unit_price: 0.03, vat_rate: 20 }],
    }
    const tinyBalance: FecInvoice = {
      ...balance, total_ht: 0.03, total_tva: 0, total_ttc: 0.03, applied_acompte_ht: 0.03,
      items: [{ quantity: 1, unit_price: 0.03, vat_rate: 20 }],
      vat_breakdown: [{ rate: 20, taxable_basis: 0.03, tax_amount: 0 }],
    }
    const entries = accounting([tinyDeposit, tinyBalance])
    expect(sum(entries, '706', 'Credit')).toBe(6)
    expect(sum(entries, '44571', 'Credit')).toBe(1)
    expect(sum(entries, '411', 'Debit')).toBe(7)
  })

  it('exports a partial receipt in its own year even when the invoice belongs to the prior year', () => {
    const invoice = { ...standardInvoice, issue_date: '2025-12-15', tva_sur_debits: false }
    const entries = accounting([], [{ ...fullPayment, invoice, amount: 60, prior_paid_amount: 60, payment_date: '2026-01-02' }])
    expect(new Set(entries.map(row => row.EcritureDate))).toEqual(new Set(['20260102']))
    expect(sum(entries, '512', 'Debit')).toBe(6_000)
    expect(sum(entries, '44571', 'Credit')).toBe(1_000)
    expect(sum(entries, '4458', 'Debit')).toBe(1_000)
  })

  it('clears customer TTC and deferred VAT over repeated receipts without losing half-cent allocations', () => {
    const invoice: FecInvoice = {
      ...standardInvoice, total_ht: 33.50, total_tva: 6.70, total_ttc: 40.20, tva_sur_debits: false,
      items: [{ quantity: 1, unit_price: 33.50, vat_rate: 20 }],
    }
    const entries = accounting([invoice], [
      { ...fullPayment, invoice, amount: 6.03 },
      { ...fullPayment, id: 'payment-2', invoice, amount: 34.17, prior_paid_amount: 6.03, payment_date: '2026-02-20' },
    ])
    expect(sum(entries.filter(row => row.EcritureDate === '20260120'), '44571', 'Credit')).toBe(101)
    expect(sum(entries.filter(row => row.EcritureDate === '20260220'), '44571', 'Credit')).toBe(569)
    expect(sum(entries, '4458', 'Credit') - sum(entries, '4458', 'Debit')).toBe(0)
    expect(sum(entries, '411', 'Debit') - sum(entries, '411', 'Credit')).toBe(0)
    expect(sum(entries, '512', 'Debit')).toBe(4_020)
  })

  it('reverses collected and still-deferred VAT when a partly paid invoice is fully credited', () => {
    const invoice = { ...standardInvoice, tva_sur_debits: false }
    const credit: FecInvoice = {
      ...creditNote, tva_sur_debits: false,
      credit_note_source: { invoice_type: 'standard', paid_amount_before_credit: 60 },
    }
    const entries = accounting([invoice, credit], [{ ...fullPayment, invoice, amount: 60 }])
    expect(sum(entries, '706', 'Credit') - sum(entries, '706', 'Debit')).toBe(0)
    expect(sum(entries, '44571', 'Credit') - sum(entries, '44571', 'Debit')).toBe(0)
    expect(sum(entries, '4458', 'Credit') - sum(entries, '4458', 'Debit')).toBe(0)
    expect(sum(entries, '411', 'Debit') - sum(entries, '411', 'Credit')).toBe(-6_000)
  })

  it('reverses the advance liability, not sales, for a full advance credit note', () => {
    const credit: FecInvoice = {
      ...deposit, id: 'deposit-credit', number: 'AV-2026-003', invoice_type: 'avoir',
      credit_note_source: { invoice_type: 'acompte', paid_amount_before_credit: 0 },
    }
    const entries = accounting([deposit, credit])
    expect(sum(entries, '4191', 'Credit') - sum(entries, '4191', 'Debit')).toBe(0)
    expect(entries.some(row => row.CompteNum === '706')).toBe(false)
  })

  it('refuses to reconstruct a different historical VAT declaration from the current calculation rule', () => {
    expect(() => exportInvoice({ ...standardInvoice, total_tva: 19.99, total_ttc: 119.99 })).toThrow(AccountingExportAuthorityError)
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
    credited_ttc: 0,
    paid_in_period: 120,
    last_payment_in_period: '2026-01-20',
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
    const [header, values] = content.replace(/^\uFEFF/, '').split('\r\n').map(line => line.split(';'))
    const record = Object.fromEntries(header.map((key, index) => [key, values[index]]))
    expect(record['Montant encaissé (période)']).toBe('')
    expect(record['Dernier encaissement (période)']).toBe('')
    expect(record['Reste dû actuel']).toBe('')
    expect(record['Montant TTC']).toBe('120,00')
  })
})
