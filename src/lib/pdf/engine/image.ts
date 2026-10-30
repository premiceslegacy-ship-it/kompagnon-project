import type { PDFDocument, PDFImage } from 'pdf-lib'
import type { PdfDoc } from './doc'
import { loadPdfImage } from './image-source'


/** Embarque une image depuis une data URL (base64) ou une URL http(s). PNG/JPEG uniquement (pdf-lib ne sait pas décoder WebP/HEIC). */

export async function embedImage(doc: PDFDocument, source: string): Promise<PDFImage | null> {
  const image = await loadPdfImage(source)
  if (!image) return null
  try {
    return image.format === 'png'
      ? await doc.embedPng(image.bytes)
      : await doc.embedJpg(image.bytes)
  } catch {
    console.error('[pdf/image] Invalid image encoding', { format: image.format })
    return null
  }
}

/** Dessine une image dans une box avec fit "contain" (préserve le ratio, centré). */
export function drawImageContained(
  doc: PdfDoc,
  img: PDFImage,
  box: { x: number; y: number; w: number; h: number },
  align: 'left' | 'center' = 'left',
): void {
  const ratio = Math.min(box.w / img.width, box.h / img.height)
  const drawW = img.width * ratio
  const drawH = img.height * ratio
  const offsetX = align === 'center' ? (box.w - drawW) / 2 : 0
  const offsetY = (box.h - drawH) / 2
  doc.page.drawImage(img, {
    x: box.x + offsetX,
    y: box.y + offsetY,
    width: drawW,
    height: drawH,
  })
}
