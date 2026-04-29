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
