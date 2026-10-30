export const MAX_PDF_IMAGE_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_PIXELS = 2048 * 2048
const MAX_DATA_URL_LENGTH = 4 * Math.ceil(MAX_PDF_IMAGE_BYTES / 3) + 256

type PdfImageSource = { bytes: Buffer; format: 'png' | 'jpeg' }

function validDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width * height <= MAX_IMAGE_PIXELS
}

function imageFormat(bytes: Uint8Array): PdfImageSource['format'] | null {
  if (bytes.length >= 24
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    && bytes[12] === 0x49 && bytes[13] === 0x48 && bytes[14] === 0x44 && bytes[15] === 0x52) {
    const width = bytes[16] * 0x1000000 + bytes[17] * 0x10000 + bytes[18] * 0x100 + bytes[19]
    const height = bytes[20] * 0x1000000 + bytes[21] * 0x10000 + bytes[22] * 0x100 + bytes[23]
    return validDimensions(width, height) ? 'png' : null
  }
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return null
    while (offset < bytes.length && bytes[offset] === 0xff) offset++
    const marker = bytes[offset++]
    if (marker === 0xd9 || marker === 0xda) return null
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 1 >= bytes.length) return null
    const length = bytes[offset] * 0x100 + bytes[offset + 1]
    if (length < 2 || offset + length > bytes.length) return null
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (length < 8) return null
      const height = bytes[offset + 3] * 0x100 + bytes[offset + 4]
      const width = bytes[offset + 5] * 0x100 + bytes[offset + 6]
      return validDimensions(width, height) ? 'jpeg' : null
    }
    offset += length
  }
  return null
}

/** Remote PDF images come from this deployment's Storage, never a row-supplied host. */
function projectStorageImageUrl(source: string): string | null {
  const configured = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!configured) return null
  try {
    const url = new URL(source)
    const storage = new URL(configured)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password
      || url.origin !== storage.origin
      || !/^\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\//.test(url.pathname)
      || /%(?:2f|5c)/i.test(url.pathname)) return null
    const decodedPath = decodeURIComponent(url.pathname)
    if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(decodedPath)) return null
    return url.toString()
  } catch {
    return null
  }
}

async function readBoundedImage(response: Response): Promise<Buffer | null> {
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (!response.ok || declared > MAX_PDF_IMAGE_BYTES) {
    await response.body?.cancel()
    return null
  }
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > MAX_PDF_IMAGE_BYTES) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  return Buffer.concat(chunks, length)
}

export async function loadPdfImage(source: string | null | undefined): Promise<PdfImageSource | null> {
  if (!source) return null
  try {
    let bytes: Buffer
    if (source.startsWith('data:')) {
      if (source.length > MAX_DATA_URL_LENGTH) return null
      const match = /^data:[^;,\s]{1,128};base64,([A-Za-z0-9+/]*={0,2})$/.exec(source)
      if (!match || match[1].length % 4 !== 0) return null
      const base64 = match[1]
      const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
      if (base64.length / 4 * 3 - padding > MAX_PDF_IMAGE_BYTES) return null
      bytes = Buffer.from(base64, 'base64')
    } else {
      const url = projectStorageImageUrl(source)
      if (!url) return null
      // workerd supports manual, not error; the bounded reader rejects non-2xx.
      const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5_000) })
      const loaded = await readBoundedImage(response)
      if (!loaded) return null
      bytes = loaded
    }
    const format = imageFormat(bytes)
    return format ? { bytes, format } : null
  } catch {
    // Images are optional. Do not log signed URLs or inline signature contents.
    return null
  }
}

/** Only persisted contract preparation needs base64; data readers keep their raw facts. */
export async function loadPdfImageAsDataUrl(source: string | null | undefined): Promise<string | null> {
  const image = await loadPdfImage(source)
  return image ? `data:image/${image.format};base64,${image.bytes.toString('base64')}` : null
}
