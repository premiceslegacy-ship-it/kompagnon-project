import { constantTimeEqual } from '@/lib/security'

/**
 * Vérifie le secret cron de manière résistante aux timing attacks.
 * Renvoie true si le secret est valide.
 */
export function verifyCronSecret(incoming: string | null): boolean {
  const expected = process.env.CRON_SECRET
  if (!incoming || !expected) return false

  return constantTimeEqual(incoming, expected)
}
