/**
 * Compare two strings without early-exit on matching-length inputs.
 * Length mismatch still fails fast because the secret length is not treated as
 * sensitive in Atelier tokens, but matching-length values are compared in full.
 */
export function constantTimeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false

  const encoder = new TextEncoder()
  const left = encoder.encode(a)
  const right = encoder.encode(b)

  if (left.length !== right.length) return false

  let diff = 0
  for (let i = 0; i < left.length; i += 1) {
    diff |= left[i] ^ right[i]
  }

  return diff === 0
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Checks a route param looks like a UUID before it reaches a Postgres `.eq()`.
 * Without this, a malformed id causes Postgres error 22P02 (invalid input syntax
 * for type uuid), which surfaces as an unhandled 500 instead of a clean 404.
 */
export function isValidUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value)
}

const SENSITIVE_LOG_KEY = /token|secret|password|authorization|signature|cookie|api[_-]?key|access[_-]?token|refresh[_-]?token|email|phone|address|ip|user[_-]?agent/i

/**
 * Redacts common secrets and PII before values are sent to logs.
 * Keep this deliberately conservative: logs should preserve shape, not payloads.
 */
export function redactForLog(value: unknown, depth = 0): unknown {
  if (value == null) return value
  if (depth > 3) return '[redacted:depth]'

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    }
  }

  if (typeof value === 'string') {
    if (value.length > 120) return `${value.slice(0, 120)}...[redacted:${value.length}]`
    return value
  }

  if (typeof value !== 'object') return value

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => redactForLog(item, depth + 1))
  }

  const redacted: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    redacted[key] = SENSITIVE_LOG_KEY.test(key) ? '[redacted]' : redactForLog(item, depth + 1)
  }
  return redacted
}

export function assertSafeExternalFetchUrl(rawUrl: string | null | undefined): URL | null {
  if (!rawUrl) return null

  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }

  if (url.protocol !== 'https:') return null
  if (!url.hostname || url.username || url.password) return null
  if (isPrivateHostname(url.hostname)) return null

  return url
}

/** Parse an IPv6 literal into eight 16-bit words; hostnames are not accepted. */
function parseIpv6Words(host: string): number[] | null {
  if (!host.includes(':')) return null

  let normalized = host
  if (normalized.includes('.')) {
    const lastColon = normalized.lastIndexOf(':')
    if (lastColon < 0) return null
    const ipv4Parts = normalized.slice(lastColon + 1).split('.')
    if (ipv4Parts.length !== 4 || ipv4Parts.some(part => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null
    const [a, b, c, d] = ipv4Parts.map(Number)
    normalized = `${normalized.slice(0, lastColon + 1)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`
  }

  const compressionIndex = normalized.indexOf('::')
  if (compressionIndex !== -1 && normalized.indexOf('::', compressionIndex + 2) !== -1) return null

  const groupCount = normalized.split(':').filter(Boolean).length
  if (compressionIndex !== -1 && groupCount >= 8) return null
  const groups = compressionIndex === -1
    ? normalized.split(':')
    : [
      ...normalized.slice(0, compressionIndex).split(':').filter(Boolean),
      ...Array(8 - groupCount).fill('0'),
      ...normalized.slice(compressionIndex + 2).split(':').filter(Boolean),
    ]
  if (groups.length !== 8 || groups.some(group => !/^[\da-f]{1,4}$/i.test(group))) return null

  return groups.map(group => Number.parseInt(group, 16))
}

function isPrivateIpv4Bytes(a: number, b: number): boolean {
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!match) return false
  const parts = match.slice(1).map(Number)
  if (parts.some(part => part > 255)) return false
  return isPrivateIpv4Bytes(parts[0], parts[1])
}

/**
 * Hôtes internes qu'une URL fournie par un tiers ne doit pas atteindre (SSRF
 * vers le réseau du Worker ou les métadonnées cloud).
 *
 * `URL` normalise déjà les formes abrégées (`127.1`, `0x7f000001`) et met les
 * IPv6 entre crochets. La résolution DNS n'est pas faite ici : un domaine
 * public pointant vers une IP privée passe, ce qui est le compromis retenu.
 */
export function isPrivateHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) return true
  if (host.startsWith('169.254.')) return true // link-local, métadonnées cloud

  const ipv6 = parseIpv6Words(host)
  if (ipv6) {
    if (ipv6.every(word => word === 0) || (ipv6.slice(0, 7).every(word => word === 0) && ipv6[7] === 1)) return true
    if ((ipv6[0] & 0xfe00) === 0xfc00) return true // fc00::/7
    if ((ipv6[0] & 0xffc0) === 0xfe80) return true // fe80::/10

    const isIpv4Mapped = ipv6.slice(0, 5).every(word => word === 0) && ipv6[5] === 0xffff
    if (isIpv4Mapped) {
      const address = ((ipv6[6] << 16) | ipv6[7]) >>> 0
      return isPrivateIpv4Bytes(address >>> 24, address >>> 16 & 0xff)
    }
    return false
  }

  return isPrivateIpv4(host)
}

/**
 * Valide une signature manuscrite reçue en data URL.
 *
 * Le seul contrôle historique était le préfixe `data:image/` : une valeur
 * tronquée marquait le devis « accepté » sans preuve, un SVG n'était de toute
 * façon pas rendu par pdf-lib, et un PNG déclarant des dimensions énormes
 * faisait gonfler la décompression à chaque génération de PDF.
 *
 * Retourne la data URL normalisée, ou null si elle est inexploitable.
 */
export function normalizeSignatureImage(raw: string | null | undefined): string | null {
  if (!raw) return null

  const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(raw.trim())
  if (!match) return null

  const base64 = match[1]
  if (base64.length > 400_000) return null

  let bytes: Buffer
  try {
    bytes = Buffer.from(base64, 'base64')
  } catch {
    return null
  }

  // Signature PNG : 8 octets de magic, puis IHDR (largeur/hauteur en BE).
  if (bytes.length < 24) return null
  if (bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null
  if (bytes.subarray(12, 16).toString('ascii') !== 'IHDR') return null

  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width === 0 || height === 0 || width > 2000 || height > 1000) return null

  return `data:image/png;base64,${base64}`
}

/**
 * Durée de validité d'un lien public de signature (devis, contrat).
 * Le lien est une capacité : au-delà, il faut le renvoyer.
 */
export const SIGNATURE_TOKEN_TTL_MS = 60 * 24 * 60 * 60 * 1000

/** Create a unique public-signature capability with the configured finite lifetime. */
export function createSignatureTokenGrant(): { token: string; expiresAt: string } {
  return {
    token: crypto.randomUUID(),
    expiresAt: new Date(Date.now() + SIGNATURE_TOKEN_TTL_MS).toISOString(),
  }
}

/** A signature token is fresh only when its known expiry is later than now. */
export function isSignatureTokenFresh(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false
  const deadline = Date.parse(expiresAt)
  return Number.isFinite(deadline) && deadline > Date.now()
}

const PUBLIC_QUOTE_DOCUMENT_STATUSES: Readonly<Record<string, true>> = {
  sent: true,
  viewed: true,
  accepted: true,
  converted: true,
  fully_invoiced: true,
}

/** Published/final states remain readable; only open offers permit new consent. */
export function isPublicQuoteDocumentState(status: string, isArchived: boolean | null | undefined = false): boolean {
  return !isArchived && Object.hasOwn(PUBLIC_QUOTE_DOCUMENT_STATUSES, status)
}
