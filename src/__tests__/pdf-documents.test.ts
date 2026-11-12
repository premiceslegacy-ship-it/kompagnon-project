import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { renderInvoicePdfWithFonts, invoiceStatus } from '@/lib/pdf/documents/invoice'
import { renderQuotePdfWithFonts } from '@/lib/pdf/documents/quote'
import { loadFontBytes } from '@/lib/pdf/engine/fonts'
import { sampleClient, sampleInvoice, sampleOrganization, sampleQuote } from '@/lib/pdf/samples'
import { generateFacturXml } from '@/lib/pdf/facturx-xml'
import { embedFacturXml } from '@/lib/pdf/facturx-embed'

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

// ─── Les autres documents ────────────────────────────────────────────────────

import { renderChantierPdfWithFonts } from '@/lib/pdf/documents/chantier'
import { renderContractPdfWithFonts } from '@/lib/pdf/documents/contract'
import { renderDgdPdfWithFonts } from '@/lib/pdf/documents/dgd'
import { renderMaintenanceInterventionPdfWithFonts } from '@/lib/pdf/documents/maintenance-intervention'
import { renderMemberHoursReportPdfWithFonts } from '@/lib/pdf/documents/member-hours-report'
import { renderMonthlyReportPdfWithFonts } from '@/lib/pdf/documents/monthly-report'
import { renderRapportKpiPdfWithFonts } from '@/lib/pdf/documents/rapport-kpi'
import { renderTourneePdfWithFonts } from '@/lib/pdf/documents/tournee'
import {
  sampleChantier, sampleContract, sampleDgd, sampleIntervention, sampleMemberHours, sampleMonthlyReport, sampleRapportKpi, sampleTournee,
} from '@/lib/pdf/samples'

describe('PDF : contrat et DGD', () => {
  it('génère un contrat sur plusieurs pages avec ses signatures', async () => {
    expect(await pageCount(await renderContractPdfWithFonts(sampleContract, fonts))).toBeGreaterThan(1)
  })

  it('génère un DGD sur une page, avec ou sans retenue de garantie', async () => {
    expect(await pageCount(await renderDgdPdfWithFonts(sampleDgd, fonts))).toBe(1)
    const withoutRetention = { ...sampleDgd, totalRetentionHt: 0, lines: sampleDgd.lines.map(l => ({ ...l, retention_amount: null, retention_pct: null })) }
    expect(await pageCount(await renderDgdPdfWithFonts(withoutRetention, fonts))).toBe(1)
  })
})

describe('PDF : chantier, intervention, tournée', () => {
  it('génère le rapport de chantier', async () => {
    expect(await pageCount(await renderChantierPdfWithFonts(sampleChantier, fonts))).toBe(1)
  })

  it('génère le rapport de chantier sans tâche ni journal', async () => {
    const empty = { ...sampleChantier, taches: [], notes: [] }
    expect(await pageCount(await renderChantierPdfWithFonts(empty, fonts))).toBe(1)
  })

  it('continue le rapport de chantier sur plusieurs pages quand les tâches sont nombreuses', async () => {
    const taches = Array.from({ length: 70 }, (_, i) => ({ ...sampleChantier.taches[0], id: `t-${i}`, title: `Tâche ${i + 1}` }))
    expect(await pageCount(await renderChantierPdfWithFonts({ ...sampleChantier, taches }, fonts))).toBeGreaterThan(1)
  })

  it("génère le rapport d'intervention", async () => {
    expect(await pageCount(await renderMaintenanceInterventionPdfWithFonts(sampleIntervention, fonts))).toBe(1)
  })

  it('génère la feuille de route avec ses notes terrain', async () => {
    expect(await pageCount(await renderTourneePdfWithFonts(sampleTournee, fonts))).toBe(1)
  })

  it('génère une feuille de route sans point de départ', async () => {
    const data = { ...sampleTournee, departureAddress: null, departurePostalCode: null, departureCity: null }
    expect(await pageCount(await renderTourneePdfWithFonts(data, fonts))).toBe(1)
  })
})

describe('PDF : rapports', () => {
  it('génère le rapport mensuel', async () => {
    expect(await pageCount(await renderMonthlyReportPdfWithFonts(sampleMonthlyReport, fonts))).toBe(1)
  })

  it('génère le rapport mensuel d’un mois sans activité', async () => {
    expect(await pageCount(await renderMonthlyReportPdfWithFonts({ ...sampleMonthlyReport, invoices: [], quotes: [] }, fonts))).toBe(1)
  })

  it("génère le rapport d'heures d'un intervenant, avec ventilation par taux", async () => {
    expect(await pageCount(await renderMemberHoursReportPdfWithFonts(sampleMemberHours, fonts))).toBe(1)
  })

  it("génère le rapport d'heures d'un mois sans pointage", async () => {
    expect(await pageCount(await renderMemberHoursReportPdfWithFonts({ ...sampleMemberHours, pointages: [], totalHours: 0 }, fonts))).toBe(1)
  })

  it('génère le rapport de pilotage, mensuel puis annuel sans données', async () => {
    expect(await pageCount(await renderRapportKpiPdfWithFonts(sampleRapportKpi, fonts))).toBeGreaterThanOrEqual(1)
    const empty = { ...sampleRapportKpi, vue: 'annee' as const, monthlyReport: null, annualReport: null, hoursReport: null, topClients: [], topChantiers: [], objectives: null }
    expect(await pageCount(await renderRapportKpiPdfWithFonts(empty, fonts))).toBe(1)
  })
})

describe('PDF : facture Factur-X', () => {
  it("garde une page lisible et embarque le XML après la nouvelle mise en page", async () => {
    const pdf = await renderInvoicePdfWithFonts({ invoice: sampleInvoice, organization: sampleOrganization }, fonts)
    const xml = generateFacturXml(sampleInvoice as never, sampleOrganization as never)
    const withXml = await embedFacturXml(pdf, xml, { title: 'Facture' })
    expect(await pageCount(withXml)).toBe(1)
    // Le XML Factur-X est bien présent dans les pièces jointes du PDF.
    expect(withXml.toString('latin1')).toContain('factur-x.xml')
  })
  it('rend un Avoir Factur-X type 381 avec la facture corrigée et ses montants canoniques', async () => {
    const sourceItem = sampleInvoice.items[0]
    const invoice = {
      ...sampleInvoice,
      issue_date: '2026-11-10',
      invoice_type: 'avoir',
      invoice_type_code: '380',
      preceding_invoice_ref: 'FAC-2026-001',
      preceding_invoice_date: '2026-11-01',
      is_reverse_charge: false,
      total_ht: 503.03,
      total_tva: 100.61,
      total_ttc: 603.64,
      vat_breakdown: [{ rate: 20, taxable_basis: 503.03, tax_amount: 100.61 }],
      items: [
        { ...sourceItem, id: 'avoir-line-1', quantity: 8, unit: 'u', unit_price: 62.80, vat_rate: 20, is_internal: false },
        { ...sourceItem, id: 'avoir-line-2', quantity: 0.001, unit: 'u', unit_price: 625.50, vat_rate: 20, is_internal: false },
      ],
    }
    const xml = generateFacturXml(invoice as never, sampleOrganization as never)

    expect(xml).toContain('<ram:TypeCode>381</ram:TypeCode>')
    expect(xml).toContain('<ram:BasisAmount>503.03</ram:BasisAmount>')
    expect(xml).toContain('<ram:CalculatedAmount>100.61</ram:CalculatedAmount>')
    expect(xml).toContain('<ram:GrandTotalAmount>603.64</ram:GrandTotalAmount>')
    const agreement = xml.match(/<ram:ApplicableHeaderTradeAgreement>([\s\S]*?)<\/ram:ApplicableHeaderTradeAgreement>/)?.[1] ?? ''
    const settlement = xml.match(/<ram:ApplicableHeaderTradeSettlement>([\s\S]*?)<\/ram:ApplicableHeaderTradeSettlement>/)?.[1] ?? ''
    expect(agreement).not.toContain('<ram:InvoiceReferencedDocument>')
    expect(settlement).toMatch(/<ram:InvoiceReferencedDocument>[\s\S]*?<ram:IssuerAssignedID>FAC-2026-001<\/ram:IssuerAssignedID>[\s\S]*?<qdt:DateTimeString format="102">20261101<\/qdt:DateTimeString>/)
  })

  it('émet des lignes Avoir autoliquidées sans TVA calculée', async () => {
    const sourceItem = sampleInvoice.items[0]
    const invoice = {
      ...sampleInvoice,
      invoice_type: 'avoir',
      is_reverse_charge: true,
      preceding_invoice_ref: 'FAC-2025-001',
      preceding_invoice_date: '2025-11-01',
      total_ht: 100,
      total_tva: 0,
      total_ttc: 100,
      items: [{ ...sourceItem, quantity: 1, unit: 'forfait', unit_price: 100, vat_rate: 20, is_internal: false }],
    }
    const xml = generateFacturXml(invoice as never, sampleOrganization as never)

    const lineSettlement = xml.match(/<ram:SpecifiedLineTradeSettlement>([\s\S]*?)<\/ram:SpecifiedLineTradeSettlement>/)?.[1] ?? ''
    const headerSettlement = xml.split('<ram:ApplicableHeaderTradeSettlement>')[1] ?? ''

    expect(lineSettlement).toContain('<ram:CategoryCode>AE</ram:CategoryCode>')
    expect(lineSettlement).toContain('<ram:RateApplicablePercent>0.00</ram:RateApplicablePercent>')
    expect(lineSettlement).not.toContain('<ram:CalculatedAmount>')
    expect(lineSettlement).not.toContain('<ram:ExemptionReason>')
    expect(headerSettlement.match(/<ram:CategoryCode>AE<\/ram:CategoryCode>/g)).toHaveLength(1)
    expect(xml).toContain('<ram:GrandTotalAmount>100.00</ram:GrandTotalAmount>')
    expect(xml).not.toContain('<ram:CategoryCode>S</ram:CategoryCode>')
  })

  it('conserve un solde à TVA cumulative nulle sur une base positive', () => {
    const sourceItem = sampleInvoice.items[0]
    const invoice = {
      ...sampleInvoice,
      invoice_type: 'standard',
      is_reverse_charge: false,
      total_ht: 0.03,
      total_tva: 0,
      total_ttc: 0.03,
      vat_breakdown: [{ rate: 20, taxable_basis: 0.03, tax_amount: 0 }],
      items: [{ ...sourceItem, quantity: 1, unit: 'forfait', unit_price: 0.03, vat_rate: 20, is_internal: false }],
    }
    const xml = generateFacturXml(invoice as never, sampleOrganization as never)
    const headerSettlement = xml.split('<ram:ApplicableHeaderTradeSettlement>')[1] ?? ''

    expect(headerSettlement).toContain('<ram:BasisAmount>0.03</ram:BasisAmount>')
    expect(headerSettlement).toContain('<ram:CalculatedAmount>0.00</ram:CalculatedAmount>')
    expect(headerSettlement).toContain('<ram:GrandTotalAmount>0.03</ram:GrandTotalAmount>')
    expect(headerSettlement).toContain('<ram:RateApplicablePercent>20.00</ram:RateApplicablePercent>')
  })

  it('préserve la quantité au millième au lieu d’arrondir les unités comme des euros', () => {
    const invoice = {
      ...sampleInvoice, invoice_type: 'standard', is_reverse_charge: false,
      total_ht: 1, total_tva: 0.20, total_ttc: 1.20, vat_breakdown: null,
      items: [{ ...sampleInvoice.items[0], unit: 'u', quantity: 0.125, unit_price: 8, vat_rate: 20, is_internal: false }],
    }
    const xml = generateFacturXml(invoice as never, sampleOrganization as never)
    const quantity = Number(xml.match(/<(?:\w+:)?BilledQuantity\b[^>]*>([^<]+)</)?.[1])
    expect(quantity).toBe(0.125)
    expect(xml).toContain('<ram:LineTotalAmount>1.00</ram:LineTotalAmount>')
  })
})
