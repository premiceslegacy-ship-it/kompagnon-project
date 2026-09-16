// Matrice d'isolation cross-tenant : le tenant A ne doit JAMAIS pouvoir
// lire, écrire, modifier ou supprimer une ligne appartenant au tenant B, en
// passant par le client ANON (celui distribué au navigateur) — c'est la
// seule voie qui prouve quelque chose : le client admin/service_role bypass
// systématiquement la RLS et ne teste rien.
//
// Pré-requis : `supabase start`, `supabase db reset`, puis
// `node --import tsx tests/isolation/seed.mts` pour peupler les 2 tenants.

import { beforeAll, describe, expect, it } from 'vitest'
import { adminClient, signInAsTenant, type TenantSession } from './helpers/tenant'
import { TENANTS } from './fixtures'

let tenantA: TenantSession
let tenantB: TenantSession
let dataA: { clientId: string; quoteId: string; invoiceId: string }
let dataB: { clientId: string; quoteId: string; invoiceId: string }

beforeAll(async () => {
  tenantA = await signInAsTenant(TENANTS.a.email, TENANTS.a.password)
  tenantB = await signInAsTenant(TENANTS.b.email, TENANTS.b.password)

  const admin = adminClient()
  const [{ data: clientA }, { data: quoteA }, { data: invoiceA }] = await Promise.all([
    admin.from('clients').select('id').eq('organization_id', tenantA.orgId).single(),
    admin.from('quotes').select('id').eq('organization_id', tenantA.orgId).single(),
    admin.from('invoices').select('id').eq('organization_id', tenantA.orgId).single(),
  ])
  dataA = { clientId: clientA!.id, quoteId: quoteA!.id, invoiceId: invoiceA!.id }

  const [{ data: clientB }, { data: quoteB }, { data: invoiceB }] = await Promise.all([
    admin.from('clients').select('id').eq('organization_id', tenantB.orgId).single(),
    admin.from('quotes').select('id').eq('organization_id', tenantB.orgId).single(),
    admin.from('invoices').select('id').eq('organization_id', tenantB.orgId).single(),
  ])
  dataB = { clientId: clientB!.id, quoteId: quoteB!.id, invoiceId: invoiceB!.id }
})

describe('SELECT cross-tenant', () => {
  it('A ne peut pas lire le client de B par id', async () => {
    const { data, error } = await tenantA.client.from('clients').select('*').eq('id', dataB.clientId).maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('A ne peut pas lire le devis de B par id', async () => {
    const { data } = await tenantA.client.from('quotes').select('*').eq('id', dataB.quoteId).maybeSingle()
    expect(data).toBeNull()
  })

  it('A ne peut pas lire la facture de B par id', async () => {
    const { data } = await tenantA.client.from('invoices').select('*').eq('id', dataB.invoiceId).maybeSingle()
    expect(data).toBeNull()
  })

  it('un SELECT non filtré par A ne retourne que les lignes de A', async () => {
    const { data } = await tenantA.client.from('clients').select('organization_id')
    expect(data).not.toHaveLength(0)
    for (const row of data ?? []) {
      expect(row.organization_id).toBe(tenantA.orgId)
    }
  })
})

describe('INSERT cross-tenant', () => {
  it('A ne peut pas créer un client rattaché à B', async () => {
    const { error } = await tenantA.client.from('clients').insert({
      organization_id: tenantB.orgId,
      company_name: 'Injection cross-tenant',
    })
    expect(error).not.toBeNull()
  })

  it("A ne peut pas créer un devis rattaché à l'organisation de B", async () => {
    const { error } = await tenantA.client.from('quotes').insert({
      organization_id: tenantB.orgId,
      client_id: dataB.clientId,
      number: 'DEV-INJECT',
      title: 'Injection',
      status: 'draft',
      total_ht: 1,
      total_ttc: 1.2,
    })
    expect(error).not.toBeNull()
  })
})

// Un accès cross-tenant refusé peut se manifester de deux façons également
// valides : la RLS filtre silencieusement (0 lignes, data: []) ou une garde
// explicite lève une erreur (policy RESTRICTIVE entitlement_*_guard, 172 +
// 186) — les deux ferment l'accès, donc les deux comptent comme un blocage.
// Seul un succès HTTP avec des lignes modifiées serait un échec du test.
function expectBlocked(result: { data: unknown; error: unknown }) {
  if (result.error) {
    expect(result.error).not.toBeNull()
  } else {
    expect(result.data).toEqual([])
  }
}

describe('UPDATE cross-tenant', () => {
  it('A ne peut pas modifier le client de B', async () => {
    const result = await tenantA.client
      .from('clients')
      .update({ company_name: 'Modifié par A' })
      .eq('id', dataB.clientId)
      .select()
    expectBlocked(result)

    const admin = adminClient()
    const { data: untouched } = await admin.from('clients').select('company_name').eq('id', dataB.clientId).single()
    expect(untouched?.company_name).not.toBe('Modifié par A')
  })

  it('A ne peut pas modifier la facture de B', async () => {
    const result = await tenantA.client
      .from('invoices')
      .update({ status: 'paid' })
      .eq('id', dataB.invoiceId)
      .select()
    expectBlocked(result)
  })
})

describe('DELETE cross-tenant', () => {
  it('A ne peut pas supprimer le devis de B', async () => {
    const result = await tenantA.client.from('quotes').delete().eq('id', dataB.quoteId).select()
    expectBlocked(result)

    const admin = adminClient()
    const { data: stillThere } = await admin.from('quotes').select('id').eq('id', dataB.quoteId).maybeSingle()
    expect(stillThere).not.toBeNull()
  })
})

describe('memberships — anti privilege escalation (règle d\'or #2 du skill auth-rls-access-control)', () => {
  it("A ne peut pas altérer un membership de l'organisation de B", async () => {
    const admin = adminClient()
    const { data: membershipB } = await admin
      .from('memberships')
      .select('id, role_id')
      .eq('organization_id', tenantB.orgId)
      .eq('user_id', tenantB.userId)
      .single()

    const result = await tenantA.client
      .from('memberships')
      .update({ role_id: membershipB!.role_id })
      .eq('id', membershipB!.id)
      .select()
    expectBlocked(result)
  })
})
