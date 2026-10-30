export const QUOTE_ATTACHMENT_BUCKET = 'quote-attachments'
export const QUOTE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
export const QUOTE_ATTACHMENT_MULTIPART_MAX_BYTES = QUOTE_ATTACHMENT_MAX_BYTES + 64 * 1024

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  dwg: 'application/acad',
  dxf: 'application/dxf',
}

const MIME_ALIASES: Record<string, Record<string, true>> = {
  'application/pdf': { 'application/pdf': true },
  'image/jpeg': { 'image/jpeg': true },
  'image/png': { 'image/png': true },
  'image/webp': { 'image/webp': true },
  'application/acad': {
    'application/acad': true,
    'application/x-acad': true,
    'application/autocad_dwg': true,
    'application/vnd.autodesk.dwg': true,
  },
  'application/dxf': {
    'application/dxf': true,
    'application/x-dxf': true,
    'application/vnd.dxf': true,
    'image/vnd.dxf': true,
  },
}
const ALLOWED_STORAGE_MIME_TYPES: Record<string, true> = {
  'application/pdf': true,
  'image/jpeg': true,
  'image/png': true,
  'image/webp': true,
  'application/acad': true,
  'application/dxf': true,
}

function ascii(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes)
}

function hasValidSignature(extension: string, signature: Uint8Array): boolean {
  switch (extension) {
    case 'pdf':
      return ascii(signature.slice(0, 5)) === '%PDF-'
    case 'jpg':
    case 'jpeg':
      return signature.length >= 3 && signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
    case 'png':
      return ascii(signature.slice(0, 8)) === '\x89PNG\r\n\x1a\n'
    case 'webp':
      return signature.length >= 12
        && ascii(signature.slice(0, 4)) === 'RIFF'
        && ascii(signature.slice(8, 12)) === 'WEBP'
    case 'dwg':
      return signature.length >= 6 && /^AC10\d{2}$/.test(ascii(signature.slice(0, 6)))
    case 'dxf': {
      const prefix = ascii(signature.slice(0, 18))
      if (prefix.startsWith('AutoCAD Binary DXF')) return true
      const text = new TextDecoder().decode(signature).replace(/^\uFEFF/, '')
      return /^\s*0\s*\r?\nSECTION\s*\r?\n2\s*\r?\nHEADER\b/i.test(text)
    }
    default:
      return false
  }
}

export function canonicalQuoteAttachmentMimeType(input: {
  filename: string
  declaredMimeType: string
  signature: Uint8Array
}): string | null {
  const extension = input.filename.split(/[\\/]/).pop()?.split('.').pop()?.toLowerCase() ?? ''
  const canonical = MIME_BY_EXTENSION[extension]
  if (!canonical || !hasValidSignature(extension, input.signature)) return null

  const declared = input.declaredMimeType.trim().toLowerCase().split(';', 1)[0]
  if (declared && declared !== 'application/octet-stream' && !Object.hasOwn(MIME_ALIASES[canonical], declared)) {
    return null
  }
  return canonical
}

export function isQuoteAttachmentMimeType(mimeType: string): boolean {
  return Object.hasOwn(ALLOWED_STORAGE_MIME_TYPES, mimeType)
}

export function isSafeQuoteAttachmentOrganizationSlug(slug: string): boolean {
  return /^[A-Za-z0-9._-]{1,128}$/.test(slug) && slug !== '.' && slug !== '..'
}

const ORGANIZATION_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OPAQUE_MIGRATED_FILENAME_RE = /^migrated-[0-9a-f]{64}\.bin$/

export function isOpaqueMigratedQuoteAttachmentStoragePath(path: string, organizationId: string): boolean {
  if (!ORGANIZATION_UUID_RE.test(organizationId)) return false
  const prefix = `quote-requests/${organizationId.toLowerCase()}/`
  if (!path.startsWith(prefix)) return false
  return OPAQUE_MIGRATED_FILENAME_RE.test(path.slice(prefix.length))
}

export function isValidQuoteAttachmentStoragePath(path: string, organizationId: string): boolean {
  if (!ORGANIZATION_UUID_RE.test(organizationId)) return false
  const prefix = `quote-requests/${organizationId.toLowerCase()}/`
  if (!path.startsWith(prefix)) return false
  const filename = path.slice(prefix.length)
  return /^[A-Za-z0-9_-]{1,128}\.(?:pdf|jpe?g|png|webp|dwg|dxf)$/i.test(filename)
    || OPAQUE_MIGRATED_FILENAME_RE.test(filename)
}

export function safeQuoteAttachmentFilename(filename: string, fallback = 'piece-jointe'): string {
  const safe = filename
    .replace(/[\\/\u0000-\u001f\u007f]/g, '_')
    .trim()
  if (!safe) return fallback
  if (safe.length <= 120) return safe
  const extension = /\.(?:pdf|jpe?g|png|webp|dwg|dxf)$/i.exec(safe)?.[0] ?? ''
  // Ne pas couper une paire UTF-16 : encodeURIComponent doit rester valide.
  const stem = safe.slice(0, 120 - extension.length).replace(/[\ud800-\udbff]$/, '')
  return `${stem}${extension}`
}
