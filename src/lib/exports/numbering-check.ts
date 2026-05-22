export type NumberingGap = {
  expected: string
  found: string | null
  position: number
}

export type NumberingCheckResult = {
  hasGaps: boolean
  gaps: NumberingGap[]
  invoiceCount: number
  sequenceType: 'numeric' | 'prefixed' | 'mixed' | 'empty'
}

function parseInvoiceNumber(number: string): { prefix: string; seq: number } | null {
  const match = number.match(/^(.*?)(\d+)$/)
  if (!match) return null
  return { prefix: match[1], seq: parseInt(match[2], 10) }
}

export function checkNumberingContinuity(
  invoiceNumbers: (string | null)[],
): NumberingCheckResult {
  const valid = invoiceNumbers.filter((n): n is string => !!n)

  if (valid.length === 0) {
    return { hasGaps: false, gaps: [], invoiceCount: 0, sequenceType: 'empty' }
  }

  const parsed = valid.map(n => ({ original: n, parsed: parseInvoiceNumber(n) }))
  const allParsed = parsed.every(p => p.parsed !== null)

  if (!allParsed) {
    return { hasGaps: false, gaps: [], invoiceCount: valid.length, sequenceType: 'mixed' }
  }

  const prefixes = new Set(parsed.map(p => p.parsed!.prefix))
  const sequenceType = prefixes.size === 1 ? 'prefixed' : 'mixed'

  if (prefixes.size > 1) {
    return { hasGaps: false, gaps: [], invoiceCount: valid.length, sequenceType: 'mixed' }
  }

  const prefix = Array.from(prefixes)[0]
  const sequences = parsed.map(p => p.parsed!.seq).sort((a, b) => a - b)
  const gaps: NumberingGap[] = []

  for (let i = 1; i < sequences.length; i++) {
    if (sequences[i] !== sequences[i - 1] + 1) {
      for (let missing = sequences[i - 1] + 1; missing < sequences[i]; missing++) {
        gaps.push({
          expected: `${prefix}${missing}`,
          found: null,
          position: missing,
        })
      }
    }
  }

  return {
    hasGaps: gaps.length > 0,
    gaps,
    invoiceCount: valid.length,
    sequenceType,
  }
}
