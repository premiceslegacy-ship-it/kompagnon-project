import { PDFDocument, PDFName } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { embedFacturXml } from '@/lib/pdf/facturx-embed'
import { generateFacturXml } from '@/lib/pdf/facturx-xml'
import { loadFontBytes } from '../engine/fonts'
import { invoiceRecord, LOGO_DATA_URL, organization, quoteClient, quoteRecord } from '../__fixtures__/samples'
import { renderInvoicePdfWithFonts } from './invoice'
import { renderQuotePdfWithFonts } from './quote'

async function inspect(buffer: Buffer) {
  const pdf = await PDFDocument.load(buffer)
  const raw = buffer.toString('latin1')
  const fonts = [...raw.matchAll(/\/BaseFont \/([A-Z]{6}\+)?([\w-]+)/g)].map(m => m[2])
  // pdf-lib suffixe le nom des polices (« Geist-Bold-13 »).
  return { pdf, pages: pdf.getPageCount(), fonts: new Set(fonts.map(f => f.replace(/-\d+$/, ''))) }
}

const fontsPromise = loadFontBytes('')
// Plusieurs rendus par test : délai large pour les machines chargées.
const SLOW = 60_000

describe('PDF devis', () => {
  it('tient sur une page avec des données courtes, titres en Geist et texte en Inter', async () => {
    const buffer = await renderQuotePdfWithFonts({ quote: quoteRecord(false), organization, client: quoteClient }, await fontsPromise)
    const { pages, fonts, pdf } = await inspect(buffer)
    expect(pages).toBe(1)
    expect(fonts.has('Geist-Bold')).toBe(true)
    expect(fonts.has('Geist-Medium')).toBe(true)
    expect(fonts.has('Inter-Regular')).toBe(true)
    expect([...fonts].some(f => f.includes('Jakarta'))).toBe(false)
    const [w, h] = [pdf.getPage(0).getWidth(), pdf.getPage(0).getHeight()]
    expect(Math.round(w)).toBe(595)
    expect(Math.round(h)).toBe(842)
  }, SLOW)

  it('passe sur plusieurs pages avec des données longues', async () => {
    const buffer = await renderQuotePdfWithFonts({ quote: quoteRecord(true), organization, client: quoteClient }, await fontsPromise)
    const { pages } = await inspect(buffer)
    expect(pages).toBeGreaterThanOrEqual(2)
  }, SLOW)

  it('se génère avec un logo, signé, sans client et hors TVA', async () => {
    const quote = {
      ...quoteRecord(false),
      signed_at: '2026-11-03T10:00:00Z',
      client_signature_image: LOGO_DATA_URL,
      client_signatory_name: 'Jean Dupont',
      client_signatory_role: 'Gérant',
    }
    const buffer = await renderQuotePdfWithFonts({
      quote,
      organization: { ...organization, logo_url: LOGO_DATA_URL, is_vat_subject: false },
      client: null,
    }, await fontsPromise)
    const { pages } = await inspect(buffer)
    // Signature avec image (carte plus haute) : la page 2 n'accueille que les cartes de fin (écart déclaré).
    expect(pages).toBeLessThanOrEqual(2)
  }, SLOW)
})

describe('PDF facture', () => {
  it('tient sur une page avec des données courtes', async () => {
    const buffer = await renderInvoicePdfWithFonts({ invoice: invoiceRecord(false), organization }, await fontsPromise)
    expect((await inspect(buffer)).pages).toBe(1)
  }, SLOW)

  it('se génère en version longue, en situation de travaux et en autoliquidation', async () => {
    const fonts = await fontsPromise
    const long = await renderInvoicePdfWithFonts({ invoice: invoiceRecord(true), organization }, fonts)
    expect((await inspect(long)).pages).toBeGreaterThanOrEqual(1)
    const situation = await renderInvoicePdfWithFonts({ invoice: invoiceRecord(false, 'situation'), organization }, fonts)
    expect((await inspect(situation)).pages).toBe(1)
    const reverse = await renderInvoicePdfWithFonts({ invoice: { ...invoiceRecord(false), is_reverse_charge: true, status: 'paid' }, organization }, fonts)
    expect((await inspect(reverse)).pages).toBe(1)
  }, SLOW)

  it('reste une facture Factur-X après intégration du XML', async () => {
    const invoice = invoiceRecord(false)
    const pdf = await renderInvoicePdfWithFonts({ invoice, organization }, await fontsPromise)
    const xml = generateFacturXml(invoice, organization)
    const out = await embedFacturXml(pdf, xml, { conformanceLevel: 'EN 16931', language: 'fr-FR' })
    const doc = await PDFDocument.load(out)
    expect(doc.catalog.get(PDFName.of('Metadata'))).toBeDefined()
    expect(doc.catalog.get(PDFName.of('OutputIntents'))).toBeDefined()
    expect(doc.catalog.get(PDFName.of('AF'))).toBeDefined()
    const raw = out.toString('latin1')
    expect(raw).toContain('factur-x.xml')
    expect(raw).toContain('urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#')
  }, SLOW)
})
