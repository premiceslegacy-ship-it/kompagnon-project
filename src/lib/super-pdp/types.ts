// Formes reelles des reponses Super PDP, confirmees par execution du flux OAuth
// en sandbox le 25/08/2026 (voir docs/atelier-facturation-electronique.md §7.2).

export type SuperPdpTokenResponse = {
  access_token: string
  expires_in: number
  refresh_token: string
  scope: string
  token_type: string
}

export type SuperPdpCompany = {
  id: number
  created_at: string
  env: 'sandbox' | 'production'
  number_scheme: string
  number: string
  formal_name: string
  trade_name: string
  address: string
  postcode: string
  city: string
  country: string
  vat_regime: string
  has_vat_on_debits: boolean
}

export function isSuperPdpTokenResponse(value: unknown): value is SuperPdpTokenResponse {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.access_token === 'string' && v.access_token.length > 0
    && typeof v.expires_in === 'number'
    && typeof v.refresh_token === 'string' && v.refresh_token.length > 0
    && typeof v.token_type === 'string'
  )
}

export function isSuperPdpCompany(value: unknown): value is SuperPdpCompany {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'number' && typeof v.formal_name === 'string'
}
