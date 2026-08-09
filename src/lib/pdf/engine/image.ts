import type { PDFDocument, PDFImage } from 'pdf-lib'
import type { PdfDoc } from './doc'

/** Embarque une image depuis une data URL (base64) ou une URL http(s). PNG/JPEG uniquement. */
export async function embedImage(doc: PDFDocument, source: string): Promise<PDFImage | null> {
  try {
    let bytes: Uint8Array
    let isPng: boolean

    if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) return null
      const [, mime, base64] = match
      if (mime.includes('svg')) return null
      isPng = mime.includes('png')
      bytes = Buffer.from(base64, 'base64')
    } else {
      const res = await fetch(source)
      if (!res.ok) return null
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('svg')) return null
      isPng = contentType.includes('png')
      bytes = new Uint8Array(await res.arrayBuffer())
    }

    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes)
  } catch {
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
