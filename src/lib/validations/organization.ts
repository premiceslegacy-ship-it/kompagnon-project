export type OrganizationValidationField =
  | 'name'
  | 'siret'
  | 'vat_number'
  | 'email'
  | 'postal_code'
  | 'iban'
  | 'bic'
  | 'payment_terms_days'
  | 'late_penalty_rate'
  | 'court_competent'
  | 'default_vat_rate'
  | 'departure_latitude'
  | 'departure_longitude'

export type OrganizationFieldErrors = Partial<Record<OrganizationValidationField, string>>

export type OrganizationValidationResult<T> = {
  value: T
  fieldErrors: OrganizationFieldErrors
}

const SIRET_GROUPS = [3, 3, 3, 5]

function groupValue(value: string, groups: number[]): string {
  const parts: string[] = []
  let cursor = 0
  for (const groupLength of groups) {
    const part = value.slice(cursor, cursor + groupLength)
    if (!part) break
    parts.push(part)
    cursor += groupLength
  }
  if (cursor < value.length) parts.push(value.slice(cursor))
  return parts.join(' ')
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

function compactUpper(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase()
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === ''
}

export function formatSiretInput(value: string): string {
  return groupValue(digitsOnly(value).slice(0, 14), SIRET_GROUPS)
}

export function formatSirenInput(value: string): string {
  return groupValue(digitsOnly(value).slice(0, 9), [3, 3, 3])
}

export function normalizeSiret(value: string | null | undefined): { value: string | null; siren: string | null; error?: string } {
  if (isBlank(value)) return { value: null, siren: null }
  const digits = digitsOnly(String(value))
  if (digits.length !== 14) {
    return {
      value: formatSiretInput(String(value)),
      siren: digits.length >= 9 ? formatSirenInput(digits.slice(0, 9)) : null,
      error: 'Le SIRET doit contenir exactement 14 chiffres.',
    }
  }
  return {
    value: formatSiretInput(digits),
    siren: formatSirenInput(digits.slice(0, 9)),
  }
}

export function formatVatNumberInput(value: string): string {
  const compact = compactUpper(value).replace(/[^A-Z0-9]/g, '').slice(0, 13)
  if (!compact) return ''
  if (compact.length <= 4) return compact
  const prefix = compact.slice(0, 4)
  const siren = compact.slice(4)
  return [prefix, groupValue(siren, [3, 3, 3])].filter(Boolean).join(' ')
}

export function normalizeFrenchVatNumber(value: string | null | undefined): { value: string | null; error?: string } {
  if (isBlank(value)) return { value: null }
  const compact = compactUpper(String(value)).replace(/[^A-Z0-9]/g, '')
  if (!/^FR[A-Z0-9]{2}\d{9}$/.test(compact)) {
    return {
      value: formatVatNumberInput(String(value)),
      error: 'Le numéro de TVA doit respecter le format FR + 2 caractères + 9 chiffres.',
    }
  }
  return { value: formatVatNumberInput(compact) }
}

export function formatIbanInput(value: string): string {
  return compactUpper(value).replace(/[^A-Z0-9]/g, '').slice(0, 34).replace(/(.{4})/g, '$1 ').trim()
}

function ibanMod97(iban: string): number {
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`
  let remainder = 0
  for (const char of rearranged) {
    const code = char.charCodeAt(0)
    const chunk = code >= 65 && code <= 90 ? String(code - 55) : char
    for (const digit of chunk) {
      remainder = (remainder * 10 + Number(digit)) % 97
    }
  }
  return remainder
}

export function normalizeIban(value: string | null | undefined): { value: string | null; error?: string } {
  if (isBlank(value)) return { value: null }
  const compact = compactUpper(String(value)).replace(/[^A-Z0-9]/g, '')
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(compact)) {
    return { value: formatIbanInput(String(value)), error: 'L’IBAN doit commencer par 2 lettres de pays puis 2 chiffres de contrôle.' }
  }
  if (compact.length < 15 || compact.length > 34) {
    return { value: formatIbanInput(String(value)), error: 'Un IBAN doit contenir entre 15 et 34 caractères hors espaces selon le pays.' }
  }
  if (ibanMod97(compact) !== 1) {
    return { value: formatIbanInput(String(value)), error: 'La clé de contrôle de l’IBAN est invalide.' }
  }
  return { value: formatIbanInput(compact) }
}

export function normalizeFrenchIban(value: string | null | undefined): { value: string | null; error?: string } {
  return normalizeIban(value)
}

export function formatBicInput(value: string): string {
  return compactUpper(value).replace(/[^A-Z0-9]/g, '').slice(0, 11)
}

export function normalizeBic(value: string | null | undefined): { value: string | null; error?: string } {
  if (isBlank(value)) return { value: null }
  const compact = formatBicInput(String(value))
  if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(compact)) {
    return { value: compact, error: 'Le BIC doit contenir 8 ou 11 caractères, par exemple BNPAFRPPXXX.' }
  }
  return { value: compact }
}

export function normalizeCommercialCourt(value: string | null | undefined): string | null {
  if (isBlank(value)) return null
  const trimmed = String(value).trim().replace(/\s+/g, ' ')
  if (/^tribunal\b/i.test(trimmed)) return trimmed
  return `Tribunal de commerce de ${trimmed}`
}

export function normalizePostalCode(value: string | null | undefined): { value: string | null; error?: string } {
  if (isBlank(value)) return { value: null }
  const digits = digitsOnly(String(value)).slice(0, 5)
  if (digits.length !== 5) return { value: digits, error: 'Le code postal doit contenir 5 chiffres.' }
  return { value: digits }
}

export function formatPostalCodeInput(value: string): string {
  return digitsOnly(value).slice(0, 5)
}

export function normalizeEmail(value: string | null | undefined): { value: string | null; error?: string } {
  if (isBlank(value)) return { value: null }
  const trimmed = String(value).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { value: trimmed, error: 'L’adresse email n’est pas valide.' }
  }
  return { value: trimmed }
}
