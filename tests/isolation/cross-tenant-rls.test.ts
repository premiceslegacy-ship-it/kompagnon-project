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
let invoiceBState: { status: string; total_paid: number | null }

beforeAll(async () => {
  tenantA = await signInAsTenant(TENANTS.a.email, TENANTS.a.password)
  tenantB = await signInAsTenant(TENANTS.b.email, TENANTS.b.password)

  const admin = adminClient()
  const loadTenantData = async (orgId: string) => {
    const [clientResult, quoteResult, invoiceResult] = await Promise.all([
      admin.from('clients').select('id').eq('organization_id', orgId).single(),
      admin.from('quotes').select('id').eq('organization_id', orgId).single(),
      admin.from('invoices').select('id, status, total_paid').eq('organization_id', orgId).single(),
    ])
    if (clientResult.error || !clientResult.data) {
      throw new Error(`Client isolation fixture missing for ${orgId}: ${clientResult.error?.message}`)
    }
    if (quoteResult.error || !quoteResult.data) {
      throw new Error(`Quote isolation fixture missing for ${orgId}: ${quoteResult.error?.message}`)
    }
    if (invoiceResult.error || !invoiceResult.data) {
      throw new Error(`Invoice isolation fixture missing for ${orgId}: ${invoiceResult.error?.message}`)
    }
    return {
      clientId: clientResult.data.id,
      quoteId: quoteResult.data.id,
      invoiceId: invoiceResult.data.id,
      invoiceState: { status: invoiceResult.data.status, total_paid: invoiceResult.data.total_paid },
    }
  }
  const a = await loadTenantData(tenantA.orgId)
  const b = await loadTenantData(tenantB.orgId)
  dataA = { clientId: a.clientId, quoteId: a.quoteId, invoiceId: a.invoiceId }
  dataB = { clientId: b.clientId, quoteId: b.quoteId, invoiceId: b.invoiceId }
  invoiceBState = b.invoiceState
})

describe('SELECT cross-tenant', () => {
  it('A ne peut pas lire le client de B par id', async () => {
    const { data, error } = await tenantA.client.from('clients').select('*').eq('id', dataB.clientId).maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('A ne peut pas lire le devis de B par id', async () => {
    const { data, error } = await tenantA.client.from('quotes').select('*').eq('id', dataB.quoteId).maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('A ne peut pas lire la facture de B par id', async () => {
    const { data, error } = await tenantA.client.from('invoices').select('*').eq('id', dataB.invoiceId).maybeSingle()
    expect(error).toBeNull()
    expect(data).toBeNull()
  })

  it('un SELECT non filtré par A ne retourne que les lignes de A', async () => {
    const { data, error } = await tenantA.client.from('clients').select('organization_id')
    expect(error).toBeNull()
    expect(data).not.toHaveLength(0)
    for (const row of data ?? []) {
      expect(row.organization_id).toBe(tenantA.orgId)
    }
  })
})

describe('INSERT cross-tenant', () => {
  it('A ne peut pas créer un client rattaché à B', async () => {
    const { data: inserted, error } = await tenantA.client.from('clients').insert({
      organization_id: tenantB.orgId,
      company_name: 'Injection cross-tenant',
    }).select('id').maybeSingle()
    const admin = adminClient()
    if (inserted) {
      const { error: cleanupError } = await admin.from('clients').delete().eq('id', inserted.id)
      if (cleanupError) throw cleanupError
    }
    expect(error).not.toBeNull()
    const { data: persisted, error: persistError } = await admin.from('clients')
      .select('id')
      .eq('organization_id', tenantB.orgId)
      .eq('company_name', 'Injection cross-tenant')
      .maybeSingle()
    if (persistError) throw persistError
    expect(persisted).toBeNull()
  })

  it("A ne peut pas créer un devis rattaché à l'organisation de B", async () => {
    const { data: inserted, error } = await tenantA.client.from('quotes').insert({
      organization_id: tenantB.orgId,
      client_id: dataB.clientId,
      number: 'DEV-INJECT',
      title: 'Injection',
      status: 'draft',
      total_ht: 1,
      total_ttc: 1.2,
    }).select('id').maybeSingle()
    const admin = adminClient()
    if (inserted) {
      const { error: cleanupError } = await admin.from('quotes').delete().eq('id', inserted.id)
      if (cleanupError) throw cleanupError
    }
    expect(error).not.toBeNull()
    const { data: persisted, error: persistError } = await admin.from('quotes')
      .select('id')
      .eq('organization_id', tenantB.orgId)
      .eq('number', 'DEV-INJECT')
      .maybeSingle()
    if (persistError) throw persistError
    expect(persisted).toBeNull()
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
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin
      .from('clients')
      .select('company_name')
      .eq('id', dataB.clientId)
      .single()
    if (beforeError || !before) throw beforeError ?? new Error('Tenant B client fixture missing')

    const result = await tenantA.client
      .from('clients')
      .update({ company_name: 'Modifié par A' })
      .eq('id', dataB.clientId)
      .select()
    expectBlocked(result)

    const { data: after, error: afterError } = await admin.from('clients')
      .select('company_name')
      .eq('id', dataB.clientId)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Tenant B client fixture disappeared')
    expect(after).toEqual(before)
  })

  it('A ne peut pas modifier la facture de B', async () => {
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin.from('invoices')
      .select('status, total_paid')
      .eq('id', dataB.invoiceId)
      .single()
    if (beforeError || !before) throw beforeError ?? new Error('Tenant B invoice fixture missing')
    expect(before).toEqual(invoiceBState)

    const result = await tenantA.client
      .from('invoices')
      .update({ status: 'paid' })
      .eq('id', dataB.invoiceId)
      .select()
    expectBlocked(result)

    const { data: after, error: afterError } = await admin.from('invoices')
      .select('status, total_paid')
      .eq('id', dataB.invoiceId)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Tenant B invoice fixture disappeared')
    expect(after).toEqual(before)
  })
})

describe('DELETE cross-tenant', () => {
  it('A ne peut pas supprimer le devis de B', async () => {
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin.from('quotes')
      .select('id, organization_id')
      .eq('id', dataB.quoteId)
      .maybeSingle()
    if (beforeError || !before) throw beforeError ?? new Error('Tenant B quote fixture missing')

    const result = await tenantA.client.from('quotes').delete().eq('id', dataB.quoteId).select()
    expectBlocked(result)

    const { data: after, error: afterError } = await admin.from('quotes')
      .select('id, organization_id')
      .eq('id', dataB.quoteId)
      .maybeSingle()
    if (afterError || !after) throw afterError ?? new Error('Tenant B quote fixture disappeared')
    expect(after).toEqual(before)
  })
})

describe("memberships — anti privilege escalation (règle d'or #2 du skill auth-rls-access-control)", () => {
  it("A ne peut pas altérer un membership de l'organisation de B", async () => {
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin
      .from('memberships')
      .select('id, role_id, is_active')
      .eq('organization_id', tenantB.orgId)
      .eq('user_id', tenantB.userId)
      .single()
    if (beforeError || !before) throw beforeError ?? new Error('Tenant B owner membership fixture missing')

    const result = await tenantA.client
      .from('memberships')
      .update({ role_id: before.role_id })
      .eq('id', before.id)
      .select()
    expectBlocked(result)

    const { data: after, error: afterError } = await admin.from('memberships')
      .select('id, role_id, is_active')
      .eq('id', before.id)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Tenant B owner membership fixture disappeared')
    expect(after).toEqual(before)
  })
})
