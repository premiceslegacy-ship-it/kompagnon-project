import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { renderInvoicePdfWithFonts, invoiceStatus } from '@/lib/pdf/documents/invoice'
import { renderQuotePdfWithFonts } from '@/lib/pdf/documents/quote'
import { loadFontBytes } from '@/lib/pdf/engine/fonts'
import { sampleClient, sampleInvoice, sampleOrganization, sampleQuote } from '@/lib/pdf/samples'

async function pageCount(buffer: Buffer): Promise<number> {
  expect(buffer.subarray(0, 5).toString('latin1')).toBe('%PDF-')
  return (await PDFDocument.load(buffer)).getPageCount()
}

const fonts = await loadFontBytes('')

function longQuote(sections = 14) {
  const base = sampleQuote.sections[0]
  return {
    ...sampleQuote,
    sections: Array.from({ length: sections }, (_, i) => ({
      ...base,
      id: `s-${i}`,
      title: `Lot ${i + 1}`,
      items: base.items.map(item => ({ ...item, id: `${item.id}-${i}`, section_id: `s-${i}` })),
    })),
  }
}

describe('PDF : devis', () => {
  it('tient sur une page quand le devis est court', async () => {
    const pdf = await renderQuotePdfWithFonts({ quote: sampleQuote, organization: sampleOrganization, client: sampleClient }, fonts)
    expect(await pageCount(pdf)).toBe(1)
  })

  it('continue sur plusieurs pages quand le devis est long', async () => {
    const pdf = await renderQuotePdfWithFonts({ quote: longQuote(), organization: sampleOrganization, client: sampleClient }, fonts)
    expect(await pageCount(pdf)).toBeGreaterThan(1)
  })

  it('se génère pour une entreprise sans TVA, sans client et sans pied légal', async () => {
    const organization = { ...sampleOrganization, is_vat_subject: false, forme_juridique: null, capital_social: null, siret: null, rcs: null, vat_number: null, insurance_info: null, certifications: null, decennale_enabled: false }
    const pdf = await renderQuotePdfWithFonts({ quote: sampleQuote, organization, client: null }, fonts)
    expect(await pageCount(pdf)).toBeGreaterThanOrEqual(1)
  })

  it('accepte des noms très longs et des accents rares', async () => {
    const client = { ...sampleClient, company_name: 'Établissements Œuvre-Châtelain & Fils, ingénierie du bâtiment et travaux publics de la région Rhône-Alpes' }
    const pdf = await renderQuotePdfWithFonts({ quote: sampleQuote, organization: sampleOrganization, client }, fonts)
    expect(await pageCount(pdf)).toBeGreaterThanOrEqual(1)
  })
})

describe('PDF : facture', () => {
  const invoiceData = { invoice: sampleInvoice, organization: sampleOrganization }

  it('génère une situation de travaux avec aide et retenue de garantie', async () => {
    expect(await pageCount(await renderInvoicePdfWithFonts(invoiceData, fonts))).toBe(1)
  })

  it('génère une facture standard en autoliquidation', async () => {
    const invoice = { ...sampleInvoice, invoice_type: 'standard', is_reverse_charge: true, aid_label: null, aid_amount: null, retention_pct: null, retention_amount: null }
    expect(await pageCount(await renderInvoicePdfWithFonts({ invoice, organization: sampleOrganization }, fonts))).toBe(1)
  })

  it('continue sur plusieurs pages quand les lignes sont nombreuses', async () => {
    const items = Array.from({ length: 60 }, (_, i) => ({ ...sampleInvoice.items[1], id: `l-${i}`, description: `Ligne ${i + 1}` }))
    const pdf = await renderInvoicePdfWithFonts({ invoice: { ...sampleInvoice, items }, organization: sampleOrganization }, fonts)
    expect(await pageCount(pdf)).toBeGreaterThan(1)
  })

  it('annonce le statut en bas de facture', () => {
    expect(invoiceStatus('paid', null).label).toBe('Payée')
    expect(invoiceStatus('overdue', '2026-08-31').label).toBe('En retard')
    expect(invoiceStatus('partial', null).label).toBe('Partiellement payée')
    expect(invoiceStatus('sent', '2026-08-31')).toEqual({ label: 'À payer', detail: expect.stringContaining('avant le') })
  })
})
