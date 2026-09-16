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

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321'
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY requis (voir `supabase status` après `supabase start`).')
}

if (!SUPABASE_URL.includes('127.0.0.1') && !SUPABASE_URL.includes('localhost')) {
  throw new Error(
    `SUPABASE_URL="${SUPABASE_URL}" ne ressemble pas à une base locale. ` +
      'Ce script crée des comptes de test avec un mot de passe faible connu — ' +
      'interdit sur un projet cloud.',
  )
}

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function deleteExistingTestUser(email: string) {
  // listUsers pagine par 50 par défaut ; largement suffisant sur une base de test locale.
  const { data } = await admin.auth.admin.listUsers()
  const existing = data?.users.find((u) => u.email === email)
  if (!existing) return

  // La cascade auth.users → memberships supprime le membership, mais pas
  // l'organisation elle-même (memberships référence organizations, pas
  // l'inverse) — sans ce nettoyage explicite, chaque run du seed laisse une
  // organisation orpheline et un tenant fini par en posséder plusieurs,
  // cassant les .single() des tests qui supposent une org par tenant.
  const { data: membership } = await admin
    .from('memberships')
    .select('organization_id')
    .eq('user_id', existing.id)
    .maybeSingle()

  await admin.auth.admin.deleteUser(existing.id)

  if (membership) {
    await admin.from('organizations').delete().eq('id', membership.organization_id)
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
    const { data: membership } = await admin
      .from('memberships')
      .select('organization_id')
      .eq('user_id', userData.user.id)
      .eq('is_active', true)
      .maybeSingle()
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
    .update({ name: tenant.companyName, siret: null })
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
      total_ttc: 1200,
    })
    .select('id')
    .single()
  if (quoteError || !quote) throw new Error(`Seed devis (${label}) échoué: ${quoteError?.message}`)

  const { data: invoice, error: invoiceError } = await admin
    .from('invoices')
    .insert({
      organization_id: orgId,
      client_id: client.id,
      number: `FAC-TEST-${label}`,
      title: `Facture confidentielle ${label}`,
      status: 'draft',
      total_ht: 1000,
      total_ttc: 1200,
      currency: 'EUR',
    })
    .select('id')
    .single()
  if (invoiceError || !invoice) throw new Error(`Seed facture (${label}) échoué: ${invoiceError?.message}`)

  return { clientId: client.id, quoteId: quote.id, invoiceId: invoice.id }
}

async function ensureLogosBucket() {
  // Créé manuellement dans le dashboard en prod (pas de migration) — à
  // reproduire en local pour que les tests Storage aient un bucket à cibler.
  const { data: buckets } = await admin.storage.listBuckets()
  if (!buckets?.some((b) => b.name === 'logos')) {
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

  const dataA = await seedBusinessData(a.orgId, 'A')
  const dataB = await seedBusinessData(b.orgId, 'B')

  const fixture = {
    tenantA: { ...a, ...dataA, email: TENANTS.a.email, password: TENANTS.a.password },
    tenantB: { ...b, ...dataB, email: TENANTS.b.email, password: TENANTS.b.password },
  }

  console.log('\nSeed terminé.')
  console.log(JSON.stringify(fixture, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
