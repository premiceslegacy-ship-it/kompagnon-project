import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  MAX_PDF_IMAGE_STREAM_BYTES,
  MAX_PDF_PAGE_IMAGE_BYTES,
  buildPdfParserPlugins,
  inspectPdfForVision,
  isPdfVisionTooHeavy,
  validatePdfForVision,
} from '@/lib/ai/document-content'

async function vectorPdf(pageCount: number): Promise<Buffer> {
  const document = await PDFDocument.create()
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.addPage([595, 842])
    page.drawText(`Plan vectoriel ${index + 1}`, { x: 40, y: 800 })
  }
  return Buffer.from(await document.save())
}

async function pdfWithImageInsideForm(): Promise<Buffer> {
  const pixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z7WQAAAAASUVORK5CYII=', 'base64')
  const document = await PDFDocument.create()
  const image = await document.embedPng(pixel)
  const form = document.context.flateStream('q /Image0 Do Q', {
    Type: 'XObject', Subtype: 'Form', FormType: 1, BBox: [0, 0, 100, 100],
    Resources: { XObject: { Image0: image.ref } },
  })
  document.addPage([100, 100]).node.newXObject('NestedForm', document.context.register(form))
  return Buffer.from(await document.save())
}

describe('PDF vision guard', () => {
  it('laisse passer un PDF vectoriel multipage', async () => {
    const inspection = await inspectPdfForVision(await vectorPdf(2))
    expect(inspection).toMatchObject({ pageCount: 2, imageCount: 0, maxImageBytes: 0 })
    await expect(validatePdfForVision(await vectorPdf(2))).resolves.toMatchObject({ ok: true })
    expect(buildPdfParserPlugins(inspection)).toBeUndefined()
  })

  it('conserve la limite de quinze pages', async () => {
    await expect(validatePdfForVision(await vectorPdf(16))).resolves.toMatchObject({ ok: false, code: 'too_many_pages' })
  })

  it('inspecte aussi les images imbriquées dans un formulaire PDF', async () => {
    await expect(inspectPdfForVision(await pdfWithImageInsideForm())).resolves.toMatchObject({ imageCount: 1 })
  })

  it('rejette un unique flux image trop lourd', () => {
    expect(isPdfVisionTooHeavy({
      pageCount: 2, imageCount: 1, maxImageBytes: MAX_PDF_IMAGE_STREAM_BYTES + 1,
      maxPageImageBytes: MAX_PDF_IMAGE_STREAM_BYTES + 1, totalPageImageBytes: MAX_PDF_IMAGE_STREAM_BYTES + 1,
    })).toBe(true)
  })

  it('rejette plusieurs images dont le poids cumulé surcharge une page', () => {
    expect(isPdfVisionTooHeavy({
      pageCount: 1, imageCount: 3, maxImageBytes: MAX_PDF_IMAGE_STREAM_BYTES - 1,
      maxPageImageBytes: MAX_PDF_PAGE_IMAGE_BYTES + 1, totalPageImageBytes: MAX_PDF_PAGE_IMAGE_BYTES + 1,
    })).toBe(true)
  })

  it('accepte des images raisonnablement compressées', () => {
    const inspection = {
      pageCount: 4, imageCount: 4, maxImageBytes: 180_000,
      maxPageImageBytes: 180_000, totalPageImageBytes: 720_000,
    }
    expect(isPdfVisionTooHeavy(inspection)).toBe(false)
    expect(buildPdfParserPlugins(inspection)).toEqual([
      { id: 'file-parser', pdf: { engine: 'mistral-ocr' } },
    ])
  })
})
