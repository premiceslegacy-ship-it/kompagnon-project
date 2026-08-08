import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef } from 'pdf-lib'

export const MAX_PDF_PAGES = 15
export const MAX_PDF_IMAGE_STREAM_BYTES = 1_500_000
export const MAX_PDF_PAGE_IMAGE_BYTES = 2_500_000

export type PdfVisionInspection = {
  pageCount: number
  imageCount: number
  maxImageBytes: number
  maxPageImageBytes: number
  totalPageImageBytes: number
}

export type PdfVisionValidation =
  | { ok: true; inspection: PdfVisionInspection | null }
  | { ok: false; code: 'too_many_pages' | 'pdf_images_too_heavy'; message: string; inspection: PdfVisionInspection }

export type PdfParserPlugin = {
  id: 'file-parser'
  pdf: { engine: 'mistral-ocr' }
}

/**
 * Retourne le nombre de pages, ou null si le buffer n'est pas un PDF exploitable
 * (chiffré au-delà de ce qu'ignoreEncryption tolère, corrompu, etc.) : dans ce cas
 * on laisse passer la requête, le modèle renverra son propre message d'erreur.
 */
export async function countPdfPages(buffer: Buffer): Promise<number | null> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true })
    return doc.getPageCount()
  } catch {
    return null
  }
}

/**
 * Inspecte les flux XObject /Image réellement embarqués dans chaque page.
 * Le poids du PDF seul est un mauvais signal : un plan vectoriel de plusieurs Mo
 * reste lisible, alors qu'une capture PNG plein format de 2–3 Mo par page peut être
 * ignorée par le pipeline document. Les références répétées sont comptées par page,
 * car chaque page reste coûteuse à décoder pour le fournisseur vision.
 */
export async function inspectPdfForVision(buffer: Buffer): Promise<PdfVisionInspection | null> {
  try {
    const document = await PDFDocument.load(buffer, { ignoreEncryption: true })
    let imageCount = 0
    let maxImageBytes = 0
    let maxPageImageBytes = 0
    let totalPageImageBytes = 0

    for (const page of document.getPages()) {
      const resources = page.node.Resources()
      const xObjects = resources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
      if (!xObjects) continue
      let pageImageBytes = 0
      const seenOnPage = new Set<string>()
      const seenStreams = new WeakSet<PDFRawStream>()

      const inspectXObjects = (objects: PDFDict) => {
        for (const [, value] of objects.entries()) {
          const refKey = value instanceof PDFRef ? value.toString() : null
          if (refKey && seenOnPage.has(refKey)) continue
          if (refKey) seenOnPage.add(refKey)
          const object = document.context.lookup(value)
          if (!(object instanceof PDFRawStream) || seenStreams.has(object)) continue
          seenStreams.add(object)
          const subtype = object.dict.get(PDFName.of('Subtype'))?.toString()
          if (subtype === '/Image') {
            const bytes = object.contents.length
            imageCount += 1
            pageImageBytes += bytes
            maxImageBytes = Math.max(maxImageBytes, bytes)
            continue
          }
          if (subtype === '/Form') {
            const formResources = object.dict.lookupMaybe(PDFName.of('Resources'), PDFDict)
            const nestedObjects = formResources?.lookupMaybe(PDFName.of('XObject'), PDFDict)
            if (nestedObjects) inspectXObjects(nestedObjects)
          }
        }
      }
      inspectXObjects(xObjects)

      totalPageImageBytes += pageImageBytes
      maxPageImageBytes = Math.max(maxPageImageBytes, pageImageBytes)
    }

    return { pageCount: document.getPageCount(), imageCount, maxImageBytes, maxPageImageBytes, totalPageImageBytes }
  } catch {
    return null
  }
}

export function isPdfVisionTooHeavy(inspection: PdfVisionInspection): boolean {
  return inspection.maxImageBytes > MAX_PDF_IMAGE_STREAM_BYTES
    || inspection.maxPageImageBytes > MAX_PDF_PAGE_IMAGE_BYTES
}

/**
 * Les modèles avec lecture PDF native privilégient souvent le texte vectoriel.
 * Lorsqu'un PDF contient des pages-image, on force l'OCR documenté par OpenRouter
 * afin que les pages scannées légères soient réellement transmises au modèle.
 */
export function buildPdfParserPlugins(inspection: PdfVisionInspection | null): PdfParserPlugin[] | undefined {
  return inspection && inspection.imageCount > 0
    ? [{ id: 'file-parser', pdf: { engine: 'mistral-ocr' } }]
    : undefined
}

export async function validatePdfForVision(buffer: Buffer, targetedHint = 'Envoyez un extrait ciblé.'): Promise<PdfVisionValidation> {
  const inspection = await inspectPdfForVision(buffer)
  if (!inspection) return { ok: true, inspection: null }
  if (inspection.pageCount > MAX_PDF_PAGES) {
    return {
      ok: false,
      code: 'too_many_pages',
      message: `Ce PDF contient ${inspection.pageCount} pages (maximum ${MAX_PDF_PAGES}). ${targetedHint}`,
      inspection,
    }
  }
  if (isPdfVisionTooHeavy(inspection)) {
    const megabytes = (inspection.maxPageImageBytes / (1024 * 1024)).toFixed(1).replace('.', ',')
    return {
      ok: false,
      code: 'pdf_images_too_heavy',
      message: `Ce PDF contient au moins une page composée d’une image très lourde (${megabytes} Mo). Elle risque de ne pas être lue entièrement. Réexportez le PDF en qualité standard ou compressez ses images, puis réessayez.`,
      inspection,
    }
  }
  return { ok: true, inspection }
}

export type AIDocumentContentBlock =
  | { type: 'image_url'; image_url: { url: string } }
  | { type: 'file'; file: { filename: string; file_data: string } }

/**
 * Un PDF envoyé en image_url avec une data URL n'est pas le mécanisme documenté par
 * OpenRouter pour les documents : seule la première page est lue de façon fiable.
 * Le bloc `file` (+ file_data) est le canal prévu pour les PDF, y compris multi-pages :
 * OpenRouter sélectionne le moteur natif du modèle si disponible ; les appelants
 * peuvent forcer mistral-ocr via buildPdfParserPlugins pour les PDF composés d'images.
 * Les images restent en image_url, inchangé.
 */
export function buildDocumentContentBlock(mimeType: string, base64: string, filename: string): AIDocumentContentBlock {
  if (mimeType === 'application/pdf') {
    return { type: 'file', file: { filename, file_data: `data:${mimeType};base64,${base64}` } }
  }
  return { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
}
