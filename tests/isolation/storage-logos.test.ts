// Non-régression du correctif Storage d'août 2026 (170_cross_tenant_hardening.sql) :
// les policies du bucket `logos` doivent contraindre le chemin par auth.uid(),
// pas seulement bucket_id — sinon n'importe quel utilisateur authentifié écrit
// dans n'importe quel dossier du bucket (écrase le logo d'une autre organisation).

import { beforeAll, describe, expect, it } from 'vitest'
import { signInAsTenant, type TenantSession } from './helpers/tenant'
import { TENANTS } from './fixtures'

let tenantA: TenantSession
let tenantB: TenantSession

beforeAll(async () => {
  tenantA = await signInAsTenant(TENANTS.a.email, TENANTS.a.password)
  tenantB = await signInAsTenant(TENANTS.b.email, TENANTS.b.password)
})

describe('Storage bucket logos', () => {
  it("A ne peut pas écraser un fichier dans le dossier de B (path = auth.uid() de B)", async () => {
    const path = `${tenantB.userId}/logo.png`
    const { error } = await tenantA.client.storage
      .from('logos')
      .upload(path, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { upsert: true })
    expect(error).not.toBeNull()
  })

  it('A peut écrire dans son propre dossier (non-régression fonctionnelle)', async () => {
    const path = `${tenantA.userId}/logo.png`
    const { error } = await tenantA.client.storage
      .from('logos')
      .upload(path, new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), { upsert: true })
    expect(error).toBeNull()
  })
})
