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

// Formes confirmees par execution reelle d'emission/reception le 29/08/2026
// (scripts/super-pdp-emission-reception-probe.mjs, voir docs/atelier-facturation-electronique.md §15).

export type SuperPdpInvoiceEvent = {
  id: number
  created_at: string
  invoice_id: number
  status_code: string
  status_text: string
}

// en_invoice : JSON EN 16931 normalise, rempli apres traitement asynchrone par
// Super PDP (non observe rempli lors du test du 29/08/2026 sur une facture tout
// juste emise - voir §15 de la doc). Forme exacte non confirmee, traite comme
// opaque tant qu'un exemple rempli n'a pas ete observe.
export type SuperPdpInvoice = {
  id: number
  company_id: number
  created_at: string
  events: SuperPdpInvoiceEvent[]
  direction: 'in' | 'out'
  processing_rule: string
  en_invoice?: unknown
}

export type SuperPdpInvoiceList = {
  data: SuperPdpInvoice[]
  count: number
  has_before: boolean
  has_after: boolean
}

// Forme confirmee des erreurs Super PDP (HTTP standard, body JSON) : testee sur
// /v1.beta/invoices avec un XML invalide -> {"http_status_code":400,"message":"..."}.
export type SuperPdpApiError = {
  http_status_code: number
  message: string
}

export function isSuperPdpInvoice(value: unknown): value is SuperPdpInvoice {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return typeof v.id === 'number' && typeof v.company_id === 'number'
}

export function isSuperPdpInvoiceList(value: unknown): value is SuperPdpInvoiceList {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return Array.isArray(v.data) && typeof v.count === 'number'
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
