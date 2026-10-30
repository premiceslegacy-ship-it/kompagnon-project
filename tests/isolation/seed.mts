// Seed deux organisations distinctes sur une base Supabase LOCALE, pour les
// tests d'isolation cross-tenant. Ne jamais pointer ce script sur un projet
// cloud — il crée des utilisateurs de test avec un mot de passe faible connu.
//
// Usage :
//   supabase start
//   supabase db reset          (rejoue les 186 migrations + supabase/seed.sql)
//   node --import tsx tests/isolation/seed.mts
//
// Idempotent : supprime puis recrée les deux tenants de test à chaque run.

import { createClient } from '@supabase/supabase-js'
import { TENANTS } from './fixtures'
import { isLocalSupabaseUrl, seedOwnedOrganizationIds } from './seed-safety'

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY requis (voir `supabase status` après `supabase start`).')
}

if (!isLocalSupabaseUrl(SUPABASE_URL)) {
  throw new Error(
    `SUPABASE_URL="${SUPABASE_URL}" ne correspond pas exactement à un hôte loopback autorisé. ` +
      'Ce script crée des comptes de test avec un mot de passe faible connu — ' +
      'interdit sur un projet cloud.',
  )
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function deleteExistingTestUser(email: string, protectedOrganizationIds: readonly string[] = []) {
  const perPage = 100
  let existing: { id: string } | undefined
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage })
    if (error) throw new Error(`Recherche utilisateur ${email} échouée: ${error.message}`)
    const users = data?.users ?? []
    existing = users.find((user) => user.email === email)
    if (existing) break
    if (users.length < perPage) return
  }
  if (!existing) return

  const { data: memberships, error: membershipError } = await admin
    .from('memberships')
    .select('organization_id, role_id')
    .eq('user_id', existing.id)
  if (membershipError) throw new Error(`Lecture des memberships de ${email} échouée: ${membershipError.message}`)

  const roleIds = [...new Set((memberships ?? []).map((membership) => membership.role_id))]
  const rolesById = new Map<string, string>()
  if (roleIds.length > 0) {
    const { data: roles, error: rolesError } = await admin.from('roles').select('id, slug').in('id', roleIds)
    if (rolesError) throw new Error(`Lecture des rôles de ${email} échouée: ${rolesError.message}`)
    for (const role of roles ?? []) rolesById.set(role.id, role.slug)
  }
  const ownedOrganizationIds = seedOwnedOrganizationIds(
    (memberships ?? []).map((membership) => ({
      organization_id: membership.organization_id,
      role_slug: rolesById.get(membership.role_id) ?? null,
    })),
    protectedOrganizationIds,
  )

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(existing.id)
  if (deleteUserError) throw new Error(`Suppression utilisateur ${email} échouée: ${deleteUserError.message}`)

  for (const organizationId of ownedOrganizationIds) {
    const { error } = await admin.from('organizations').delete().eq('id', organizationId)
    if (error) throw new Error(`Suppression organisation seed ${organizationId} échouée: ${error.message}`)
  }
}

async function createTenant(tenant: (typeof TENANTS)[keyof typeof TENANTS]) {
  await deleteExistingTestUser(tenant.email)

  const { data: userData, error: userError } = await admin.auth.admin.createUser({
    email: tenant.email,
    password: tenant.password,
    email_confirm: true,
    user_metadata: { full_name: tenant.fullName },
  })
  if (userError || !userData.user) {
    throw new Error(`Création user ${tenant.email} échouée: ${userError?.message}`)
  }

  // handle_new_user + handle_new_user_init (triggers sur auth.users) créent
  // le profil, l'organisation et le membership owner de façon asynchrone au
  // sein de la même transaction INSERT — un court sondage suffit à absorber
  // toute latence de trigger sans dépendre d'un timing fixe.
  let orgId: string | null = null
  for (let attempt = 0; attempt < 20 && !orgId; attempt++) {
    const { data: membership, error: membershipError } = await admin
      .from('memberships')
      .select('organization_id')
      .eq('user_id', userData.user.id)
      .eq('is_active', true)
      .maybeSingle()
    if (membershipError) {
      throw new Error(`Lecture du membership de ${tenant.email} échouée: ${membershipError.message}`)
    }
    if (membership) {
      orgId = membership.organization_id
      break
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  if (!orgId) {
    throw new Error(`Aucune organisation créée automatiquement pour ${tenant.email} (trigger absent ou en échec ?)`)
  }

  const { error: orgError } = await admin
    .from('organizations')
    .update({
      name: tenant.companyName,
      siret: null,
      is_vat_subject: true,
      default_vat_rate: 20,
    })
    .eq('id', orgId)
  if (orgError) throw new Error(`Mise à jour organisation ${orgId} échouée: ${orgError.message}`)

  return { userId: userData.user.id, orgId }
}

async function seedBusinessData(orgId: string, label: string) {
  const { data: client, error: clientError } = await admin
    .from('clients')
    .insert({
      organization_id: orgId,
      company_name: `Client de ${label}`,
      contact_name: 'Contact Test',
      email: `client@${label.toLowerCase().replace(/\s+/g, '-')}.test`,
    })
    .select('id')
    .single()
  if (clientError || !client) throw new Error(`Seed client (${label}) échoué: ${clientError?.message}`)

  const { data: quote, error: quoteError } = await admin
    .from('quotes')
    .insert({
      organization_id: orgId,
      client_id: client.id,
      number: `DEV-TEST-${label}`,
      title: `Devis confidentiel ${label}`,
      status: 'draft',
      total_ht: 1000,
      total_tva: 200,
      total_ttc: 1200,
    })
    .select('id')
    .single()
  if (quoteError || !quote) throw new Error(`Seed devis (${label}) échoué: ${quoteError?.message}`)

  const { error: quoteItemError } = await admin.from('quote_items').insert({
    quote_id: quote.id,
    type: 'custom',
    description: `Prestation de test ${label}`,
    quantity: 1,
    unit: 'forfait',
    unit_price: 1000,
    vat_rate: 20,
    total_ht: 1000,
    position: 0,
  })
  if (quoteItemError) throw new Error(`Ligne de devis seed (${label}) échouée: ${quoteItemError.message}`)

  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .insert({
      organization_id: orgId,
      client_id: client.id,
      number: `FAC-TEST-${label}`,
      title: `Facture confidentielle ${label}`,
      status: 'draft',
      total_ht: 1000,
      total_tva: 200,
      total_ttc: 1200,
      currency: 'EUR',
    })
    .select('id')
    .single()
  if (invoiceError || !invoice) throw new Error(`Seed facture (${label}) échoué: ${invoiceError?.message}`)

  const { error: itemError } = await admin.from('invoice_items').insert({
    invoice_id: invoice.id,
    description: `Prestation de test ${label}`,
    quantity: 1,
    unit: 'forfait',
    unit_price: 1000,
    vat_rate: 20,
    total_ht: 1000,
    position: 0,
  })
  if (itemError) throw new Error(`Ligne de facture seed (${label}) échouée: ${itemError.message}`)

  const { data: sendingInvoice, error: sendingError } = await admin
    .from('invoices')
    .update({ status: 'sending' })
    .eq('id', invoice.id)
    .eq('status', 'draft')
    .select('status, issuance_snapshot')
    .single()
  if (sendingError || !sendingInvoice) {
    throw new Error(`Revendiquer l'émission de la facture seed (${label}) a échoué: ${sendingError?.message}`)
  }
  if (sendingInvoice.status !== 'sending' || !sendingInvoice.issuance_snapshot) {
    throw new Error(`L'émission de la facture seed (${label}) n'a pas capturé son autorité`)
  }

  const { data: issuedInvoice, error: issueError } = await admin
    .from('invoices')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', invoice.id)
    .eq('status', 'sending')
    .select('id, status, sent_at, issuance_snapshot')
    .single()
  if (issueError || !issuedInvoice) {
    throw new Error(`Finalisation de l'émission de la facture seed (${label}) a échoué: ${issueError?.message}`)
  }
  const snapshot = issuedInvoice.issuance_snapshot
  if (
    issuedInvoice.status !== 'sent'
    || !issuedInvoice.sent_at
    || !snapshot
    || snapshot.seller.is_vat_subject !== true
    || snapshot.invoice.total_ht !== 1000
    || snapshot.invoice.total_tva !== 200
    || snapshot.invoice.total_ttc !== 1200
    || snapshot.items.length !== 1
    || snapshot.items[0].quantity !== 1
    || snapshot.items[0].unit_price !== 1000
    || snapshot.items[0].vat_rate !== 20
    || snapshot.items[0].total_ht !== 1000
    || snapshot.items[0].vat_amount !== 200
  ) {
    throw new Error(`La facture seed (${label}) n'a pas été émise avec des totaux et lignes cohérents`)
  }

  return { clientId: client.id, quoteId: quote.id, invoiceId: issuedInvoice.id }
}

// Crée un membre au rôle `viewer` dans l'organisation cible. Le trigger
// d'inscription lui crée sa propre organisation : on la supprime après
// réaffectation, pour que le membership reste unique.
async function createViewer(orgId: string) {
  const tenant = TENANTS.viewer
  await deleteExistingTestUser(tenant.email, [orgId])

  const { data: userData, error } = await admin.auth.admin.createUser({
    email: tenant.email,
    password: tenant.password,
    email_confirm: true,
    user_metadata: { full_name: tenant.fullName },
  })
  if (error || !userData.user) throw new Error(`Création viewer échouée: ${error?.message}`)

  const { data: viewerRole, error: roleError } = await admin
    .from('roles')
    .select('id')
    .eq('organization_id', orgId)
    .eq('slug', 'viewer')
    .single()
  if (roleError || !viewerRole) throw new Error(`Rôle viewer introuvable: ${roleError?.message}`)

  let ownOrgId: string | null = null
  for (let attempt = 0; attempt < 20 && !ownOrgId; attempt++) {
    const { data: membership, error: membershipError } = await admin
      .from('memberships')
      .select('organization_id')
      .eq('user_id', userData.user.id)
      .eq('is_active', true)
      .maybeSingle()
    if (membershipError) {
      throw new Error(`Lecture du membership viewer échouée: ${membershipError.message}`)
    }
    if (membership) { ownOrgId = membership.organization_id; break }
    await new Promise((r) => setTimeout(r, 150))
  }
  if (!ownOrgId) throw new Error('Aucune organisation créée automatiquement pour le viewer (trigger absent ou en échec ?)')

  // Le trigger de rôle (156) refuse un UPDATE de role_id avec le client
  // service_role (auth.uid() absent => user_has_permission false). On
  // remplace donc la ligne : le trigger est BEFORE UPDATE seulement.
  const { error: deleteMembershipError } = await admin.from('memberships').delete().eq('user_id', userData.user.id)
  if (deleteMembershipError) throw new Error(`Suppression du membership viewer échouée: ${deleteMembershipError.message}`)
  const { error: moveError } = await admin.from('memberships').insert({
    organization_id: orgId,
    user_id: userData.user.id,
    role_id: viewerRole.id,
    is_active: true,
    accepted_at: new Date().toISOString(),
  })
  if (moveError) throw new Error(`Rattachement viewer échoué: ${moveError.message}`)

  if (ownOrgId !== orgId) {
    const { error: orgDeleteError } = await admin.from('organizations').delete().eq('id', ownOrgId)
    if (orgDeleteError) throw new Error(`Suppression organisation temporaire du viewer échouée: ${orgDeleteError.message}`)
  }
  return { userId: userData.user.id }
}

async function ensureLogosBucket() {
  // Créé manuellement dans le dashboard en prod (pas de migration) — à
  // reproduire en local pour que les tests Storage aient un bucket à cibler.
  const { data: buckets, error: listError } = await admin.storage.listBuckets()
  if (listError) throw new Error(`Lecture des buckets Storage échouée: ${listError.message}`)
  if (!buckets.some((b) => b.name === 'logos')) {
    const { error } = await admin.storage.createBucket('logos', { public: true })
    if (error) throw new Error(`Création du bucket logos échouée: ${error.message}`)
  }
}

async function main() {
  console.log('Seed isolation : suppression + recréation des tenants de test...\n')

  await ensureLogosBucket()

  const a = await createTenant(TENANTS.a)
  const b = await createTenant(TENANTS.b)
  console.log(`Tenant A: org=${a.orgId} user=${a.userId}`)
  console.log(`Tenant B: org=${b.orgId} user=${b.userId}`)

  const viewer = await createViewer(a.orgId)

  const dataA = await seedBusinessData(a.orgId, 'A')
  const dataB = await seedBusinessData(b.orgId, 'B')

  const fixture = {
    tenantA: { ...a, ...dataA, email: TENANTS.a.email, password: TENANTS.a.password },
    tenantB: { ...b, ...dataB, email: TENANTS.b.email, password: TENANTS.b.password },
    viewerA: { ...viewer, email: TENANTS.viewer.email, password: TENANTS.viewer.password },
  }

  console.log('\nSeed terminé.')
  console.log(JSON.stringify(fixture, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
