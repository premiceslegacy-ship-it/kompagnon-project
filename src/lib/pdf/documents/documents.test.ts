import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { loadFontBytes } from '../engine/fonts'
import { PDF_SAMPLES } from '../__fixtures__/registry'

// Un test de génération par document et par variante (courte, longue) : le PDF
// s'ouvre, est en A4, embarque Geist (titres) et Inter (texte), et les jeux
// courts tiennent sur une page quand c'est possible.
const DOCUMENTS = ['quote', 'invoice', 'contract', 'dgd', 'chantier', 'monthly-report', 'maintenance-intervention', 'member-hours-report', 'tournee', 'rapport-kpi']

describe('génération des PDF', () => {
  const fontsPromise = loadFontBytes('')

  it('couvre les 10 documents, en version courte et longue', () => {
    for (const doc of DOCUMENTS) {
      expect(PDF_SAMPLES.some(s => s.document === doc && !s.long), `${doc} court`).toBe(true)
      expect(PDF_SAMPLES.some(s => s.document === doc && s.long), `${doc} long`).toBe(true)
    }
  })

  for (const sample of PDF_SAMPLES) {
    it(`${sample.document} : ${sample.file}`, async () => {
      const buffer = await sample.render(await fontsPromise)
      const pdf = await PDFDocument.load(buffer)
      const pages = pdf.getPageCount()
      expect(pages).toBeGreaterThanOrEqual(1)
      if (sample.maxPages) expect(pages).toBeLessThanOrEqual(sample.maxPages)
      for (const page of pdf.getPages()) {
        expect(Math.round(page.getWidth())).toBe(595)
        expect(Math.round(page.getHeight())).toBe(842)
      }
      const fonts = new Set([...buffer.toString('latin1').matchAll(/\/BaseFont \/(?:[A-Z]{6}\+)?([\w-]+)/g)].map(m => m[1]))
      const has = (name: string) => [...fonts].some(f => f === name || f.startsWith(`${name}-`))
      expect(has('Geist-Bold') || has('Geist-Medium')).toBe(true)
      expect(has('Inter-Regular')).toBe(true)
      expect([...fonts].some(f => f.includes('Jakarta'))).toBe(false)
    }, 60_000)
  }
})
