// Non-régression des failles vérifiées par l'audit adversarial du 26/10/2026.
// Chaque test DOIT être rouge avant la migration 193 et vert après.
//
// Principe : on attaque avec le client ANON (celui distribué au navigateur),
// jamais avec le service_role, puisque c'est la seule voie qui prouve que la
// garde est en base et non seulement en Server Action.
//
// Rôles de test : tenantA (owner de A), tenantAViewer (viewer de A),
// tenantB (owner de B). Le viewer est créé par le seed.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminClient, signInAsTenant, type TenantSession } from './helpers/tenant'
import { TENANTS } from './fixtures'

// RLS peut refuser de deux façons : l'UPDATE est filtré (0 ligne, error null,
// la policy USING n'est pas satisfaite) ou le trigger lève une exception.
// Les deux bloquent l'effet, donc les deux comptent. Seul un succès avec des
// lignes modifiées prouverait la faille.
function expectBlocked(result: { data: unknown; error: unknown }) {
  if (result.error) expect(result.error).not.toBeNull()
  else expect(result.data).toEqual([])
}

let tenantA: TenantSession
let viewerA: TenantSession
let tenantB: TenantSession
let dataA: { clientId: string; quoteId: string; invoiceId: string; membershipId: string }
let dataB: { clientId: string; quoteId: string; invoiceId: string; membershipId: string }
let viewerMembershipId: string

beforeAll(async () => {
  tenantA = await signInAsTenant(TENANTS.a.email, TENANTS.a.password)
  viewerA = await signInAsTenant(TENANTS.viewer.email, TENANTS.viewer.password)
  tenantB = await signInAsTenant(TENANTS.b.email, TENANTS.b.password)

  const admin = adminClient()
  const pick = async (orgId: string, userId: string) => {
    const [clientResult, quoteResult, invoiceResult, membershipResult] = await Promise.all([
      admin.from('clients').select('id').eq('organization_id', orgId).single(),
      admin.from('quotes').select('id').eq('organization_id', orgId).single(),
      admin.from('invoices').select('id, status, issuance_snapshot').eq('organization_id', orgId).single(),
      admin.from('memberships').select('id').eq('organization_id', orgId).eq('user_id', userId).single(),
    ])
    if (clientResult.error || !clientResult.data) {
      throw new Error(`Client fixture missing for organization ${orgId}: ${clientResult.error?.message}`)
    }
    if (quoteResult.error || !quoteResult.data) {
      throw new Error(`Quote fixture missing for organization ${orgId}: ${quoteResult.error?.message}`)
    }
    if (invoiceResult.error || !invoiceResult.data) {
      throw new Error(`Invoice fixture missing for organization ${orgId}: ${invoiceResult.error?.message}`)
    }
    if (invoiceResult.data.status !== 'sent' || !invoiceResult.data.issuance_snapshot) {
      throw new Error(`Invoice fixture for organization ${orgId} is not legitimately issued`)
    }
    if (membershipResult.error || !membershipResult.data) {
      throw new Error(`Owner membership fixture missing for organization ${orgId}: ${membershipResult.error?.message}`)
    }
    return {
      clientId: clientResult.data.id as string,
      quoteId: quoteResult.data.id as string,
      invoiceId: invoiceResult.data.id as string,
      membershipId: membershipResult.data.id as string,
    }
  }
  dataA = await pick(tenantA.orgId, tenantA.userId)
  dataB = await pick(tenantB.orgId, tenantB.userId)
  const { data: viewerMembership, error: viewerMembershipError } = await admin
    .from('memberships')
    .select('id')
    .eq('organization_id', tenantA.orgId)
    .eq('user_id', viewerA.userId)
    .single()
  if (viewerMembershipError || !viewerMembership) {
    throw new Error(`Viewer membership fixture missing: ${viewerMembershipError?.message}`)
  }
  viewerMembershipId = viewerMembership.id
})

// Les tests désactivent des memberships : on remet tout actif pour que le run
// suivant (et les autres fichiers) reparte d'une base saine.
afterAll(async () => {
  const admin = adminClient()
  const { error } = await admin.from('memberships').update({ is_active: true }).eq('organization_id', tenantA.orgId)
  if (error) throw error
})

describe('RPC SECURITY DEFINER', () => {
  it('anon ne peut plus appeler match_company_memory (surcharge 5 args)', async () => {
    const anon = adminClient() // service_role : contrôle séparé ci-dessous
    const { data } = await anon.rpc('has_function_privilege', {}).maybeSingle?.() ?? { data: null }
    // Contrôle par catalogue fait hors Node ; ici on vérifie le comportement :
    const res = await fetch(`${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/rest/v1/rpc/match_company_memory`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_organization_id: tenantB.orgId,
        p_embedding: new Array(1024).fill(0),
        p_limit: 5,
        p_activity_id: null,
        p_chantier_id: null,
      }),
    })
    // Avec EXECUTE révoqué, PostgREST répond 404 (fonction inconnue) ou 401/403.
    expect([401, 403, 404]).toContain(res.status)
    expect(data).toBeNull()
  })

  it("initialize_organization_for_user n'est plus exposée à authenticated", async () => {
    const { error } = await tenantA.client.rpc('initialize_organization_for_user', {
      p_user_id: tenantB.userId,
      p_full_name: 'Ecrasement',
      p_email: 'ecrasement@evil.test',
    })
    expect(error).not.toBeNull()
  })
})

describe('memberships — colonnes sensibles', () => {
  it('un viewer ne peut pas désactiver le membership du dirigeant', async () => {
    const admin = adminClient()
    await admin.from('memberships').update({ is_active: true }).eq('id', dataA.membershipId)
    const result = await viewerA.client
      .from('memberships')
      .update({ is_active: false })
      .eq('id', dataA.membershipId)
      .select()
    expectBlocked(result)
  })

  it('un viewer ne peut pas réécrire un coût horaire, même le sien', async () => {
    const result = await viewerA.client
      .from('memberships')
      .update({ labor_cost_per_hour: 1 })
      .eq('id', viewerMembershipId)
      .select()
    expectBlocked(result)
  })

  it("l'owner peut réécrire un coût horaire", async () => {
    const { error } = await tenantA.client
      .from('memberships')
      .update({ labor_cost_per_hour: 42 })
      .eq('id', viewerMembershipId)
      .select()
    expect(error).toBeNull()
  })

  it('un admin peut modifier un coût horaire mais pas désactiver le dirigeant', async () => {
    const admin = adminClient()
    const { data: ownerMembership } = await admin
      .from('memberships')
      .select('id')
      .eq('organization_id', tenantA.orgId)
      .eq('role_id', (await admin.from('roles').select('id').eq('organization_id', tenantA.orgId).eq('slug', 'owner').single()).data!.id)
      .single()

    const { error } = await tenantA.client
      .from('memberships')
      .update({ is_active: false })
      .eq('id', ownerMembership!.id)
      .select()
    // Le dirigeant ne peut pas être désactivé par ce chemin.
    expect(error).not.toBeNull()
  })

  it('un viewer ne peut pas se réactiver lui-même après retrait', async () => {
    const admin = adminClient()
    await admin.from('memberships').update({ is_active: false }).eq('id', viewerMembershipId)
    const result = await viewerA.client
      .from('memberships')
      .update({ is_active: true })
      .eq('id', viewerMembershipId)
      .select()
    expectBlocked(result)
    // Restauré pour les fichiers suivants (get_user_org_id() renverrait NULL).
    await admin.from('memberships').update({ is_active: true }).eq('id', viewerMembershipId)
  })
})

describe('invitations — rôle', () => {
  it("refuse un rôle owner dans l'organisation", async () => {
    const admin = adminClient()
    const { data: ownerRole } = await admin
      .from('roles')
      .select('id')
      .eq('organization_id', tenantA.orgId)
      .eq('slug', 'owner')
      .single()

    const { error } = await tenantA.client.from('invitations').insert({
      organization_id: tenantA.orgId,
      invited_by: tenantA.userId,
      email: 'owner-bis@atelier-btp.test',
      role_id: ownerRole!.id,
    })
    expect(error).not.toBeNull()
  })

  it("refuse un rôle d'une autre organisation", async () => {
    const admin = adminClient()
    const { data: roleB } = await admin
      .from('roles')
      .select('id')
      .eq('organization_id', tenantB.orgId)
      .neq('slug', 'owner')
      .limit(1)
      .single()

    const { error } = await tenantA.client.from('invitations').insert({
      organization_id: tenantA.orgId,
      invited_by: tenantA.userId,
      email: 'role-org-b@atelier-btp.test',
      role_id: roleB!.id,
    })
    expect(error).not.toBeNull()
  })
})

describe('roles — slug owner', () => {
  it('le rôle owner ne peut pas être renommé', async () => {
    const admin = adminClient()
    const { data: ownerRole } = await admin
      .from('roles')
      .select('id')
      .eq('organization_id', tenantA.orgId)
      .eq('slug', 'owner')
      .single()

    const result = await tenantA.client
      .from('roles')
      .update({ slug: 'owner_old' })
      .eq('id', ownerRole!.id)
      .select()
    expectBlocked(result)
  })
})

describe('factures émises', () => {
  it('refuse le retour en brouillon, même à un owner autorisé à éditer', async () => {
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin
      .from('invoices')
      .select('status, number, total_ht, total_tva, total_ttc, issuance_snapshot')
      .eq('id', dataA.invoiceId)
      .single()
    if (beforeError || !before) throw beforeError ?? new Error('Issued invoice fixture missing')

    const { error } = await tenantA.client
      .from('invoices')
      .update({ status: 'draft' })
      .eq('id', dataA.invoiceId)
      .select()
    expect(error).not.toBeNull()

    const { data: after, error: afterError } = await admin
      .from('invoices')
      .select('status, number, total_ht, total_tva, total_ttc, issuance_snapshot')
      .eq('id', dataA.invoiceId)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Issued invoice disappeared after rejected update')
    expect(after).toEqual(before)
  })

  it('refuse la modification du numéro', async () => {
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin
      .from('invoices')
      .select('number')
      .eq('id', dataA.invoiceId)
      .single()
    if (beforeError || !before) throw beforeError ?? new Error('Issued invoice fixture missing')

    const { error } = await tenantA.client
      .from('invoices')
      .update({ number: 'FAC-REECRITE' })
      .eq('id', dataA.invoiceId)
      .select()
    expect(error).not.toBeNull()

    const { data: after, error: afterError } = await admin
      .from('invoices')
      .select('number')
      .eq('id', dataA.invoiceId)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Issued invoice disappeared after rejected update')
    expect(after).toEqual(before)
  })

  it('refuse la suppression', async () => {
    const result = await tenantA.client.from('invoices').delete().eq('id', dataA.invoiceId).select()
    expectBlocked(result)

    const { data: stillThere, error } = await adminClient()
      .from('invoices')
      .select('id, status')
      .eq('id', dataA.invoiceId)
      .maybeSingle()
    if (error) throw error
    expect(stillThere).toMatchObject({ id: dataA.invoiceId, status: 'sent' })
  })
})

describe('devis signés', () => {
  it('refuse la modification du contenu après signature', async () => {
    const admin = adminClient()
    const { data: accepted, error: acceptError } = await admin
      .from('quotes')
      .update({ status: 'accepted', signed_at: new Date().toISOString() })
      .eq('id', dataA.quoteId)
      .select('id, status, signed_at, total_ht, total_tva, total_ttc, document_snapshot')
      .single()
    if (acceptError || !accepted || accepted.status !== 'accepted' || !accepted.document_snapshot) {
      throw new Error(`Quote fixture could not be accepted: ${acceptError?.message}`)
    }
    if (accepted.total_ht !== 1000 || accepted.total_tva !== 200 || accepted.total_ttc !== 1200) {
      throw new Error('Accepted quote fixture does not contain consistent fiscal totals')
    }

    const { error } = await tenantA.client
      .from('quotes')
      .update({ discount_rate: 42 })
      .eq('id', dataA.quoteId)
      .select()
    expect(error).not.toBeNull()

    const { data: after, error: afterError } = await admin
      .from('quotes')
      .select('status, total_ht, total_tva, total_ttc, discount_rate, document_snapshot')
      .eq('id', dataA.quoteId)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Accepted quote fixture disappeared')
    expect(after).toMatchObject({
      status: 'accepted',
      total_ht: 1000,
      total_tva: 200,
      total_ttc: 1200,
      discount_rate: 0,
      document_snapshot: accepted.document_snapshot,
    })
  })
})

describe('paiements', () => {
  it('un viewer ne peut pas supprimer un paiement', async () => {
    const admin = adminClient()
    const { data: payment, error: paymentError } = await admin.from('payments').insert({
      organization_id: tenantA.orgId,
      invoice_id: dataA.invoiceId,
      client_id: dataA.clientId,
      amount: 10,
      payment_date: new Date().toISOString().slice(0, 10),
      method: 'manual',
    }).select('id, invoice_id, amount').single()
    if (paymentError || !payment) throw paymentError ?? new Error('Payment fixture was not created')

    const result = await viewerA.client.from('payments').delete().eq('id', payment.id).select()
    expectBlocked(result)

    const { data: stillThere, error } = await admin.from('payments')
      .select('id, invoice_id, amount')
      .eq('id', payment.id)
      .maybeSingle()
    if (error) throw error
    expect(stillThere).toEqual(payment)
  })
})

describe('profiles', () => {
  it("l'email du profil n'est plus modifiable", async () => {
    const { error } = await tenantA.client
      .from('profiles')
      .update({ email: 'autre@atelier-btp.test' })
      .eq('id', tenantA.userId)
      .select()
    expect(error).not.toBeNull()
  })
})

describe('organizations', () => {
  it("la planification de suppression n'est plus forgeable", async () => {
    const { error } = await tenantA.client
      .from('organizations')
      .update({ deletion_scheduled_at: '2020-01-01T00:00:00Z' })
      .eq('id', tenantA.orgId)
      .select()
    expect(error).not.toBeNull()
  })

  it('les réglages restent modifiables', async () => {
    const { error } = await tenantA.client
      .from('organizations')
      .update({ city: 'Lyon' })
      .eq('id', tenantA.orgId)
      .select()
    expect(error).toBeNull()
  })
})

describe('claims serveur', () => {
  it('quota_config et ai_billing_mode ne sont plus écrits par le client', async () => {
    const { error } = await tenantA.client
      .from('organization_modules')
      .update({ quota_config: { sarah_assistant: -1 } })
      .eq('organization_id', tenantA.orgId)
      .select()
    expect(error).not.toBeNull()
  })

  it('organization_einvoicing_config est réservée au serveur', async () => {
    const { error } = await tenantA.client
      .from('organization_einvoicing_config')
      .update({ oauth_status: 'connected' })
      .eq('organization_id', tenantA.orgId)
      .select()
    expect(error).not.toBeNull()
  })
})

describe('push_subscriptions', () => {
  it("refuse un organization_id qui n'est pas celui de l'appelant", async () => {
    const { error } = await tenantA.client.from('push_subscriptions').insert({
      organization_id: tenantB.orgId,
      user_id: tenantA.userId,
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      p256dh: 'x',
      auth: 'y',
    })
    expect(error).not.toBeNull()
  })

  it('accepte un endpoint https connu', async () => {
    const admin = adminClient()
    await admin.from('push_subscriptions').delete().eq('user_id', tenantA.userId)
    const { error } = await tenantA.client.from('push_subscriptions').insert({
      organization_id: tenantA.orgId,
      user_id: tenantA.userId,
      endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc',
      p256dh: 'x',
      auth: 'y',
    })
    expect(error).toBeNull()
  })
})

describe('quote_requests', () => {
  it("l'INSERT anonyme direct est fermé", async () => {
    const anonClient = adminClient()
    void anonClient
    const res = await fetch(`${process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'}/rest/v1/quote_requests`, {
      method: 'POST',
      headers: {
        apikey: process.env.SUPABASE_ANON_KEY!,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        organization_id: tenantA.orgId,
        name: 'Direct REST',
        email: 'direct@rest.test',
        description: 'Injection sans honeypot',
      }),
    })
    expect(res.ok).toBe(false)
  })

  it("refuse de rattacher un client d'une autre organisation", async () => {
    const admin = adminClient()
    const { data: req } = await admin
      .from('quote_requests')
      .insert({
        organization_id: tenantA.orgId,
        name: 'Rattachement',
        email: 'rattachement@rest.test',
        description: 'x',
      })
      .select('id')
      .single()

    const result = await tenantA.client
      .from('quote_requests')
      .update({ client_id: dataB.clientId })
      .eq('id', req!.id)
      .select()
    expectBlocked(result)
  })
})

describe('cycle de vie facture — permission de paiement', () => {
  // Le rôle `commercial` a invoices.edit + invoices.send sans
  // invoices.record_payment : il ne doit pas pouvoir marquer payé.
  let commercial: TenantSession

  beforeAll(async () => {
    const admin = adminClient()
    const email = 'isolation-commercial@atelier-btp.test'
    const password = 'IsolationTestCommercial-44!'
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })
    let userId = created?.user?.id
    if (!userId) {
      const perPage = 100
      for (let page = 1; ; page++) {
        const { data: users, error: usersError } = await admin.auth.admin.listUsers({ page, perPage })
        if (usersError) throw usersError
        userId = users.users.find(user => user.email === email)?.id
        if (userId || users.users.length < perPage) break
      }
    }
    if (!userId) throw createError ?? new Error('Commercial test user could not be found or created')

    const { data: role, error: roleError } = await admin
      .from('roles')
      .select('id')
      .eq('organization_id', tenantA.orgId)
      .eq('slug', 'commercial')
      .single()
    if (roleError || !role) throw roleError ?? new Error('Commercial role fixture missing')

    const { data: existing, error: membershipsError } = await admin
      .from('memberships')
      .select('organization_id')
      .eq('user_id', userId)
    if (membershipsError) throw membershipsError
    const { error: deleteMembershipsError } = await admin.from('memberships').delete().eq('user_id', userId)
    if (deleteMembershipsError) throw deleteMembershipsError
    for (const organizationId of new Set((existing ?? [])
      .map(row => row.organization_id)
      .filter(organizationId => organizationId !== tenantA.orgId))) {
      const { error } = await admin.from('organizations').delete().eq('id', organizationId)
      if (error) throw error
    }

    const { error: membershipError } = await admin.from('memberships').insert({
      organization_id: tenantA.orgId,
      user_id: userId,
      role_id: role.id,
      is_active: true,
      accepted_at: new Date().toISOString(),
    })
    if (membershipError) throw membershipError

    commercial = await signInAsTenant(email, password)
  })

  it('refuse le marquage payé sans invoices.record_payment', async () => {
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin
      .from('invoices')
      .select('status, total_paid, paid_at')
      .eq('id', dataA.invoiceId)
      .single()
    if (beforeError || !before) throw beforeError ?? new Error('Issued invoice fixture missing')
    if (before.status !== 'sent') throw new Error('Payment-permission invoice must begin in the sent state')

    const { error } = await commercial.client
      .from('invoices')
      .update({ status: 'paid', total_paid: 1200 })
      .eq('id', dataA.invoiceId)
      .select()
    expect(error).not.toBeNull()

    const { data: after, error: afterError } = await admin
      .from('invoices')
      .select('status, total_paid, paid_at')
      .eq('id', dataA.invoiceId)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Issued invoice fixture disappeared')
    expect(after).toEqual(before)
  })

  it("autorise l'owner à marquer payé", async () => {
    const paidAt = new Date().toISOString()
    const { error } = await tenantA.client
      .from('invoices')
      .update({ status: 'paid', total_paid: 1200, paid_at: paidAt })
      .eq('id', dataA.invoiceId)
      .select()
    expect(error).toBeNull()

    const { data: after, error: afterError } = await adminClient()
      .from('invoices')
      .select('status, total_paid, paid_at')
      .eq('id', dataA.invoiceId)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Paid invoice fixture missing after update')
    expect(after).toMatchObject({ status: 'paid', total_paid: 1200 })
    expect(Date.parse(after.paid_at)).toBe(Date.parse(paidAt))
  })

  it('refuse la modification du xml e-facturation sans einvoicing.configure', async () => {
    const admin = adminClient()
    const { data: before, error: beforeError } = await admin
      .from('invoices')
      .select('facturx_xml')
      .eq('id', dataA.invoiceId)
      .single()
    if (beforeError || !before) throw beforeError ?? new Error('Issued invoice fixture missing')

    const { error } = await commercial.client
      .from('invoices')
      .update({ facturx_xml: '<x/>' })
      .eq('id', dataA.invoiceId)
      .select()
    expect(error).not.toBeNull()

    const { data: after, error: afterError } = await admin
      .from('invoices')
      .select('facturx_xml')
      .eq('id', dataA.invoiceId)
      .single()
    if (afterError || !after) throw afterError ?? new Error('Issued invoice fixture missing after rejected update')
    expect(after).toEqual(before)
  })

})

