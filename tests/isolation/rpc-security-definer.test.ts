// Non-régression des findings F1/F2 de l'audit du 2026-09-16 (voir
// /Users/useersm/.claude/plans/oui-on-audit-tout-compiled-music.md) : des RPC
// SECURITY DEFINER acceptaient un organization_id fourni par l'appelant sans
// le confronter à l'adhésion réelle de l'utilisateur. Même classe de faille
// que match_company_memory, corrigée le 2026-08-08 (170_cross_tenant_hardening.sql).
//
// Ces tests DOIVENT être rouges avant la migration 186_cross_tenant_hardening_2,
// verts après — sinon ils ne prouvent rien.

import { beforeAll, describe, expect, it } from 'vitest'
import { adminClient, signInAsTenant, type TenantSession } from './helpers/tenant'
import { TENANTS } from './fixtures'

let tenantA: TenantSession
let tenantB: TenantSession

beforeAll(async () => {
  tenantA = await signInAsTenant(TENANTS.a.email, TENANTS.a.password)
  tenantB = await signInAsTenant(TENANTS.b.email, TENANTS.b.password)
})

describe('F1 — generate_invoice_number / generate_quote_number', () => {
  it("A ne peut pas incrémenter le compteur de facturation de B via l'org_id de B", async () => {
    const admin = adminClient()
    const { data: before } = await admin
      .from('organizations')
      .select('last_invoice_number')
      .eq('id', tenantB.orgId)
      .single()

    const { error } = await tenantA.client.rpc('generate_invoice_number', { org_id: tenantB.orgId })

    const { data: after } = await admin
      .from('organizations')
      .select('last_invoice_number')
      .eq('id', tenantB.orgId)
      .single()

    // Le correctif attendu (garde interne dans la fonction) doit soit
    // renvoyer une erreur, soit à défaut ne jamais faire progresser le
    // compteur de B suite à un appel initié par A.
    expect(error !== null || before?.last_invoice_number === after?.last_invoice_number).toBe(true)
  })

  it("A ne peut pas incrémenter le compteur de devis de B via l'org_id de B", async () => {
    const admin = adminClient()
    const { data: before } = await admin
      .from('organizations')
      .select('last_quote_number')
      .eq('id', tenantB.orgId)
      .single()

    const { error } = await tenantA.client.rpc('generate_quote_number', { org_id: tenantB.orgId })

    const { data: after } = await admin
      .from('organizations')
      .select('last_quote_number')
      .eq('id', tenantB.orgId)
      .single()

    expect(error !== null || before?.last_quote_number === after?.last_quote_number).toBe(true)
  })

  it('A peut toujours générer un numéro pour sa propre organisation (non-régression fonctionnelle)', async () => {
    const { error } = await tenantA.client.rpc('generate_invoice_number', { org_id: tenantA.orgId })
    expect(error).toBeNull()
  })
})

describe('F2 — organization_write_access_allowed (oracle entitlement)', () => {
  it("A ne peut pas interroger le statut d'entitlement de B via son organization_id", async () => {
    const { data, error } = await tenantA.client.rpc('organization_write_access_allowed', {
      p_organization_id: tenantB.orgId,
    })
    // Avant correctif : renvoie true/false sans jamais échouer (l'oracle).
    // Après correctif : doit échouer pour un org_id qui n'est pas celui de l'appelant.
    expect(error).not.toBeNull()
    expect(data).toBeNull()
  })

  it('A peut toujours interroger le statut de sa propre organisation (non-régression fonctionnelle)', async () => {
    const { error } = await tenantA.client.rpc('organization_write_access_allowed', {
      p_organization_id: tenantA.orgId,
    })
    expect(error).toBeNull()
  })
})
