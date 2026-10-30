// Non-régression du secret HMAC par instance et de l'anti-rejeu
// (audit du 26/10/2026). Avant correctif, un porteur du secret d'une seule
// instance pouvait signer un corps annonçant n'importe quel source_instance.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deriveInstanceSecret,
  getOperatorSigningSecret,
  operatorSignedString,
  readOperatorRequest,
  signOperatorPayload,
  signOperatorRequest,
  verifyOperatorRequest,
  OPERATOR_TIMESTAMP_HEADER,
} from '@/lib/operator'

const MASTER = 'a'.repeat(64)
const SOURCE_A = 'atelier-a'
const SOURCE_B = 'atelier-b'

function headers(values: Record<string, string>): Headers {
  return new Headers(values)
}

beforeEach(() => {
  process.env.OPERATOR_MASTER_SECRET = MASTER
  delete process.env.OPERATOR_CONFIG_SYNC_SECRET
  delete process.env.OPERATOR_INGEST_SECRET
})

afterEach(() => {
  delete process.env.OPERATOR_MASTER_SECRET
  delete process.env.OPERATOR_CONFIG_SYNC_SECRET
  delete process.env.OPERATOR_INGEST_SECRET
})

describe('dérivation du secret par instance', () => {
  it('donne un secret différent par instance, stable pour une même instance', () => {
    const a1 = deriveInstanceSecret(MASTER, SOURCE_A)
    const a2 = deriveInstanceSecret(MASTER, SOURCE_A)
    const b = deriveInstanceSecret(MASTER, SOURCE_B)

    expect(a1).toBe(a2)
    expect(a1).not.toBe(b)
    expect(a1).toMatch(/^[0-9a-f]{64}$/)
  })

  it('getOperatorSigningSecret suit le master quand il est présent', () => {
    expect(getOperatorSigningSecret(SOURCE_A)).toBe(deriveInstanceSecret(MASTER, SOURCE_A))
  })

  it('retombe sur le secret partagé quand aucun master n\'est configuré', () => {
    delete process.env.OPERATOR_MASTER_SECRET
    process.env.OPERATOR_INGEST_SECRET = 'legacy-secret'
    expect(getOperatorSigningSecret(SOURCE_A)).toBe('legacy-secret')
  })
})

describe('signature liée au source_instance', () => {
  it('accepte une requête signée avec le secret de son instance', () => {
    const body = JSON.stringify({ source_instance: SOURCE_A, organization_id: 'org-1' })
    const { signature, timestamp } = signOperatorRequest(body, deriveInstanceSecret(MASTER, SOURCE_A))

    expect(verifyOperatorRequest({
      body,
      sourceInstance: SOURCE_A,
      signature,
      timestamp,
    })).toBe(true)
  })

  it("refuse un corps annonçant l'instance B signé avec le secret de A", () => {
    const body = JSON.stringify({ source_instance: SOURCE_B, organization_id: 'org-b' })
    const { signature, timestamp } = signOperatorRequest(body, deriveInstanceSecret(MASTER, SOURCE_A))

    expect(verifyOperatorRequest({
      body,
      sourceInstance: SOURCE_B,
      signature,
      timestamp,
    })).toBe(false)
  })
})

describe('freshness de requête', () => {
  it('refuse un timestamp plus vieux que 5 minutes', () => {
    const body = JSON.stringify({ source_instance: SOURCE_A })
    const old = (Date.now() - 6 * 60 * 1000).toString()
    const signature = signOperatorPayload(operatorSignedString(old, body), deriveInstanceSecret(MASTER, SOURCE_A))

    expect(verifyOperatorRequest({ body, sourceInstance: SOURCE_A, signature, timestamp: old })).toBe(false)
  })

  it('refuse un timestamp absent, même avec le secret historique partagé', () => {
    delete process.env.OPERATOR_MASTER_SECRET
    process.env.OPERATOR_INGEST_SECRET = 'legacy-secret'
    const body = JSON.stringify({ source_instance: SOURCE_A })
    const signature = signOperatorPayload(body, 'legacy-secret')

    expect(verifyOperatorRequest({ body, sourceInstance: SOURCE_A, signature, timestamp: null })).toBe(false)
  })

  it('le récepteur client conserve la vérification du secret configuré sans exiger le master cockpit', () => {
    delete process.env.OPERATOR_MASTER_SECRET
    process.env.OPERATOR_CONFIG_SYNC_SECRET = 'client-receiver-secret'
    const body = JSON.stringify({ source_instance: SOURCE_A, organization_id: 'org-1' })
    const { signature, timestamp } = signOperatorRequest(body, 'client-receiver-secret')

    expect(verifyOperatorRequest({ body, sourceInstance: SOURCE_A, signature, timestamp })).toBe(true)
  })

  it('le cockpit en mode requireMaster refuse tout repli sur un secret partagé', () => {
    delete process.env.OPERATOR_MASTER_SECRET
    process.env.OPERATOR_INGEST_SECRET = 'legacy-secret'
    const body = JSON.stringify({ source_instance: SOURCE_A })
    const timestamp = Date.now().toString()
    const signature = signOperatorPayload(operatorSignedString(timestamp, body), 'legacy-secret')

    expect(verifyOperatorRequest({
      body,
      sourceInstance: SOURCE_A,
      signature,
      timestamp,
      requireMaster: true,
    })).toBe(false)
  })

  it('une signature fraîche reste rejouable dans la fenêtre : la fraîcheur seule ne fournit pas l’idempotence', () => {
    const body = JSON.stringify({ source_instance: SOURCE_A, organization_id: 'org-1' })
    const { signature, timestamp } = signOperatorRequest(body, deriveInstanceSecret(MASTER, SOURCE_A))
    const request = { body, sourceInstance: SOURCE_A, signature, timestamp }

    expect(verifyOperatorRequest(request)).toBe(true)
    expect(verifyOperatorRequest(request)).toBe(true)
  })
})

describe('readOperatorRequest', () => {
  const signed = (body: string, secret = deriveInstanceSecret(MASTER, SOURCE_A)) => {
    const { signature, timestamp } = signOperatorRequest(body, secret)
    return headers({ 'x-operator-signature': signature, [OPERATOR_TIMESTAMP_HEADER]: timestamp })
  }

  it('rejette une signature absente avant même de parser', () => {
    // Le corps est du JSON invalide : la signature manquante doit primer,
    // sinon n'importe qui fait parser du JSON sur une route publique.
    const result = readOperatorRequest('{', headers({}))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('rejette un JSON invalide en 400 une fois signé', () => {
    const body = '{'
    const result = readOperatorRequest(body, signed(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejette un source_instance absent en 400', () => {
    const body = JSON.stringify({ organization_id: 'x' })
    const result = readOperatorRequest(body, signed(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(400)
  })

  it('rejette un corps démesuré en 413', () => {
    const body = JSON.stringify({ source_instance: SOURCE_A, blob: 'x'.repeat(2 * 1024 * 1024) })
    const result = readOperatorRequest(body, signed(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(413)
  })
  it('ne compte pas les caractères UTF-16 à la place des octets UTF-8', () => {
    const body = JSON.stringify({ source_instance: SOURCE_A, blob: '💩'.repeat(524_300) })
    expect(body.length).toBeLessThan(2 * 1024 * 1024)
    const result = readOperatorRequest(body, signed(body))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(413)
  })

  it('rejette les formes de timestamp non canoniques', () => {
    const body = JSON.stringify({ source_instance: SOURCE_A })
    const timestamp = `${Date.now()} `
    const signature = signOperatorPayload(operatorSignedString(timestamp, body), deriveInstanceSecret(MASTER, SOURCE_A))
    const result = readOperatorRequest(body, headers({
      'x-operator-signature': signature,
      [OPERATOR_TIMESTAMP_HEADER]: timestamp,
    }))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('refuse un corps annonçant B signé avec le secret dérivé de A', () => {
    const body = JSON.stringify({ source_instance: SOURCE_B, organization_id: 'org-b' })
    const result = readOperatorRequest(body, signed(body, deriveInstanceSecret(MASTER, SOURCE_A)))

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.status).toBe(401)
  })

  it('accepte côté récepteur client le secret configuré et garde requireMaster réservé au cockpit', () => {
    delete process.env.OPERATOR_MASTER_SECRET
    process.env.OPERATOR_CONFIG_SYNC_SECRET = 'client-receiver-secret'
    const body = JSON.stringify({ source_instance: SOURCE_A, organization_id: 'org-1' })
    const clientResult = readOperatorRequest(body, signed(body, 'client-receiver-secret'))
    const cockpitResult = readOperatorRequest(body, signed(body, 'client-receiver-secret'), { requireMaster: true })

    expect(clientResult.ok).toBe(true)
    expect(cockpitResult.ok).toBe(false)
    if (!cockpitResult.ok) expect(cockpitResult.status).toBe(401)
  })


  it('accepte une requête correctement signée et renvoie le corps parsé', () => {
    const body = JSON.stringify({ source_instance: SOURCE_A, organization_id: 'org-1' })
    const { signature, timestamp } = signOperatorRequest(body, deriveInstanceSecret(MASTER, SOURCE_A))

    const result = readOperatorRequest<{ source_instance: string; organization_id: string }>(
      body,
      headers({ 'x-operator-signature': signature, [OPERATOR_TIMESTAMP_HEADER]: timestamp }),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.sourceInstance).toBe(SOURCE_A)
      expect(result.body.organization_id).toBe('org-1')
    }
  })
})
