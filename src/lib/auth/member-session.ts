import 'server-only'
import { cookies } from 'next/headers'
import { createHmac, randomBytes, createHash, timingSafeEqual } from 'crypto'

const COOKIE_NAME = 'member_session'
const COOKIE_MAX_AGE_S = 8 * 60 * 60 // 8h
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30j

function getSecret(): string {
  const s = process.env.MEMBER_SESSION_SECRET || process.env.NEXTAUTH_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!s) throw new Error('MEMBER_SESSION_SECRET non configuré.')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', getSecret()).update(payload).digest('hex')
}

/** Hash un token brut pour stockage en DB (sha256). */
export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

/** Génère un nouveau magic-link token (à envoyer par email + à stocker hashé). */
export function generateMagicToken(): { raw: string; hash: string; expiresAt: Date } {
  const raw = randomBytes(32).toString('base64url')
  return {
    raw,
    hash: hashToken(raw),
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
  }
}

/** Pose un cookie de session signé après vérification réussie d'un magic-link. */
export async function setMemberSessionCookie(memberId: string, organizationId: string): Promise<void> {
  const issuedAt = Date.now()
  const payload = `${memberId}.${organizationId}.${issuedAt}`
  const sig = sign(payload)
  const cookieValue = `${payload}.${sig}`

  const c = await cookies()
  c.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: COOKIE_MAX_AGE_S,
  })
}

/** Lit le cookie de session et retourne { memberId, organizationId } si valide. */
export async function getMemberSession(): Promise<{ memberId: string; organizationId: string } | null> {
  const c = await cookies()
  const raw = c.get(COOKIE_NAME)?.value
  if (!raw) return null

  const parts = raw.split('.')
  if (parts.length !== 4) return null
  const [memberId, organizationId, issuedAtStr, sig] = parts

  const expected = sign(`${memberId}.${organizationId}.${issuedAtStr}`)
  try {
    const a = Buffer.from(sig, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  } catch {
    return null
  }

  const issuedAt = parseInt(issuedAtStr, 10)
  if (!Number.isFinite(issuedAt)) return null
  if (Date.now() - issuedAt > COOKIE_MAX_AGE_S * 1000) return null

  return { memberId, organizationId }
}

export async function clearMemberSessionCookie(): Promise<void> {
  const c = await cookies()
  c.delete(COOKIE_NAME)
}

export async function requireMemberSession(): Promise<{ memberId: string; organizationId: string }> {
  const s = await getMemberSession()
  if (!s) throw new Error('Session espace membre invalide ou expirée.')
  return s
}
