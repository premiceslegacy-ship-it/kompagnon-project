import type { PDFDocument, PDFImage } from 'pdf-lib'
import type { PdfDoc } from './doc'

type ImageFormat = 'png' | 'jpeg' | 'webp' | 'heic' | 'unknown'

/** Détecte le format réel depuis les premiers octets (magic bytes), indépendamment du Content-Type déclaré. */
function detectFormat(bytes: Uint8Array): ImageFormat {
  if (bytes.length < 12) return 'unknown'
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg'
  const isRiff = bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
  if (isRiff && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) return 'webp'
  const ftyp = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7])
  const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
  if (ftyp === 'ftyp' && (brand === 'heic' || brand === 'heix' || brand === 'mif1' || brand === 'msf1' || brand === 'heim' || brand === 'heis')) return 'heic'
  return 'unknown'
}

/** Embarque une image depuis une data URL (base64) ou une URL http(s). PNG/JPEG uniquement (pdf-lib ne sait pas décoder WebP/HEIC). */
export async function embedImage(doc: PDFDocument, source: string): Promise<PDFImage | null> {
  try {
    let bytes: Uint8Array

    if (source.startsWith('data:')) {
      const match = source.match(/^data:([^;]+);base64,(.+)$/)
      if (!match) return null
      const [, mime, base64] = match
      if (mime.includes('svg')) return null
      bytes = Buffer.from(base64, 'base64')
    } else {
      const res = await fetch(source, { signal: AbortSignal.timeout(10_000) })
      if (!res.ok) {
        console.error('[pdf/image] fetch echoue', { status: res.status, source })
        return null
      }
      const contentType = res.headers.get('content-type') ?? ''
      if (contentType.includes('svg')) return null
      bytes = new Uint8Array(await res.arrayBuffer())
    }

    const format = detectFormat(bytes)
    if (format === 'png') return await doc.embedPng(bytes)
    if (format === 'jpeg') return await doc.embedJpg(bytes)

    console.error('[pdf/image] format non embarquable', { format, source: source.startsWith('data:') ? 'data-url' : source })
    return null
  } catch (err) {
    console.error('[pdf/image] embed echoue', { source: source.startsWith('data:') ? 'data-url' : source, err: err instanceof Error ? err.message : String(err) })
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
