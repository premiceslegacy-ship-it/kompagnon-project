export type AddressParts = {
  address_line1?: string | null
  postal_code?: string | null
  city?: string | null
  country?: string | null
}

export function formatAddress(parts: AddressParts): string {
  return [parts.address_line1, [parts.postal_code, parts.city].filter(Boolean).join(' '), parts.country]
    .filter(Boolean)
    .join(', ')
}

export function getMapsDirectionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
}

export function getMapsSearchUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
}

