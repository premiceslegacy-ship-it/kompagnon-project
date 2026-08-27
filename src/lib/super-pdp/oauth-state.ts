// State signe du flux OAuth Super PDP (authorization_code, voir docs/atelier-facturation-electronique.md §7.3).
// Reutilise le HMAC de src/lib/operator.ts (deja utilise par ingest/config-sync) plutot que
// d'introduire un second mecanisme de signature. Le state encode quelle instance et quelle
// organisation ont initie le flux, pour savoir ou rediriger l'utilisateur a la fin (le callback
// OAuth est unique, cote cockpit, partage par toutes les instances clientes).

import { signOperatorPayload, verifyOperatorSignature } from '@/lib/operator'

const STATE_TTL_MS = 10 * 60 * 1000

export type OauthStatePayload = {
  source_instance: string
  organization_id: string
  nonce: string
  issued_at: number
}

function getOauthStateSecret(): string {
  const secret = process.env.OPERATOR_CONFIG_SYNC_SECRET?.trim()
    || process.env.OPERATOR_INGEST_SECRET?.trim()
  if (!secret) {
    throw new Error('OPERATOR_CONFIG_SYNC_SECRET / OPERATOR_INGEST_SECRET manquant')
  }
  return secret
}

function toBase64Url(input: string): string {
  const base64 = btoa(unescape(encodeURIComponent(input)))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(input: string): string {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/').padEnd(input.length + (4 - (input.length % 4)) % 4, '=')
  return decodeURIComponent(escape(atob(padded)))
}

export function signOauthState(sourceInstance: string, organizationId: string): string {
  const payload: OauthStatePayload = {
    source_instance: sourceInstance,
    organization_id: organizationId,
    nonce: crypto.randomUUID(),
    issued_at: Date.now(),
  }
  const encoded = toBase64Url(JSON.stringify(payload))
  const signature = signOperatorPayload(encoded, getOauthStateSecret())
  return `${encoded}.${signature}`
}

export function verifyOauthState(state: string | null): OauthStatePayload | null {
  if (!state) return null

  const separatorIndex = state.lastIndexOf('.')
  if (separatorIndex === -1) return null

  const encoded = state.slice(0, separatorIndex)
  const signature = state.slice(separatorIndex + 1)

  if (!verifyOperatorSignature(encoded, getOauthStateSecret(), signature)) return null

  let payload: OauthStatePayload
  try {
    payload = JSON.parse(fromBase64Url(encoded))
  } catch {
    return null
  }

  if (
    typeof payload.source_instance !== 'string' || !payload.source_instance
    || typeof payload.organization_id !== 'string' || !payload.organization_id
    || typeof payload.nonce !== 'string' || !payload.nonce
    || typeof payload.issued_at !== 'number'
  ) {
    return null
  }

  if (Date.now() - payload.issued_at > STATE_TTL_MS) return null

  return payload
}
