// Script d'intrusion cross-tenant contre une instance déployée (préview ou
// staging) — complète tests/isolation/*.test.ts (qui couvrent déjà en tests
// automatisés SELECT/INSERT/UPDATE/DELETE cross-tenant, RPC SECURITY DEFINER
// et Storage). Ce script-ci cible ce que la suite Vitest ne peut pas exercer
// facilement : les VRAIES routes HTTP Next.js par-dessus la RLS, avec deux
// sessions cookie réelles contre un serveur qui tourne.
//
// Usage :
//   1. npm run preview  (ou une URL de staging via INTRUSION_TEST_URL)
//   2. tests/isolation/seed.mts doit avoir tourné contre la MÊME base que ce
//      serveur cible (sinon les org_id de test n'existent pas côté serveur).
//   3. node --import tsx scripts/intrusion-test-multi-tenant.mjs
//
// Chaque scénario tente une action illégitime et vérifie qu'elle échoue.
// Sortie : rapport JSON dans .scratch/intrusion-test/, exit 1 si un seul
// scénario réussit à faire ce qu'il ne devrait pas pouvoir faire.
//
// Vérifié le 2026-09-16 : le scénario RPC (scenarioForgedRpcDirect, qui ne
// dépend pas du serveur Next) bloque correctement contre supabase start en
// local. Les scénarios HTTP (payload forgé, préfixes middleware) nécessitent
// npm run preview et n'ont pas été exécutés dans cette session — à valider
// avant de s'appuyer dessus pour une décision de sécurité.

import { adminClient, signInAsTenant } from '../tests/isolation/helpers/tenant.ts'
import { TENANTS } from '../tests/isolation/fixtures.ts'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.INTRUSION_TEST_URL ?? 'http://localhost:8787'
const OUT_DIR = join(process.cwd(), '.scratch', 'intrusion-test')
mkdirSync(OUT_DIR, { recursive: true })

const results = []
function record(name, ok, detail) {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'BLOQUÉ ' : 'FUITE !'} ${name} — ${detail}`)
}

function cookieFor(session) {
  const projectRef = new URL(process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321').hostname.split('.')[0] || 'local'
  const payload = {
    access_token: session.accessToken,
    token_type: 'bearer',
    user: { id: session.userId },
  }
  return `sb-${projectRef}-auth-token=base64-${Buffer.from(JSON.stringify(payload)).toString('base64')}`
}

async function scenarioForgedRpcDirect(tenantA, tenantB) {
  // Appel RPC direct via PostgREST, contournant complètement les routes Next —
  // c'est la même vérification que rpc-security-definer.test.ts, rejouée ici
  // pour confirmer qu'elle tient aussi contre le déploiement réel, pas
  // seulement contre supabase start en local.
  const { error } = await tenantA.client.rpc('generate_invoice_number', { org_id: tenantB.orgId })
  record(
    'RPC forgée generate_invoice_number(org_id=B)',
    error !== null,
    error ? `rejeté: ${error.message}` : 'AUCUNE ERREUR — la RPC a accepté un org_id étranger',
  )
}

async function scenarioForgedApiPayload(tenantA, tenantB) {
  // POST forgé sur une route applicative avec un organization_id d'une autre
  // org glissé dans le payload — vérifie que la route dérive bien l'org de la
  // session serveur et ignore tout organization_id venant du corps de requête.
  const cookie = cookieFor(tenantA)
  const res = await fetch(`${BASE_URL}/api/ai/sarah-secretary`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({
      message: 'Liste mes factures',
      organization_id: tenantB.orgId, // injection : organization_id étranger dans le body
      page: 'Tableau de bord',
      pathname: '/dashboard',
      pageContext: null,
      history: [],
      conversationId: crypto.randomUUID(),
    }),
  })
  const body = await res.text()
  const mentionsTenantB = body.includes(tenantB.orgId)
  record(
    'POST /api/ai/sarah-secretary avec organization_id de B injecté dans le body',
    res.status !== 200 || !mentionsTenantB,
    `status=${res.status}, org B mentionnée dans la réponse: ${mentionsTenantB}`,
  )
}

async function scenarioExcludedPrefixWithoutSecret(target) {
  // Vérifie qu'une route sous un préfixe exclu du middleware (F4) refuse bien
  // une requête sans le secret attendu — complément du test statique
  // src/__tests__/middleware-excluded-prefixes.test.ts (qui vérifie que le
  // code APPELLE un helper de garde), ici on vérifie le comportement RUNTIME.
  const res = await fetch(`${BASE_URL}${target}`, { method: 'POST', body: '{}' })
  record(
    `POST ${target} sans secret`,
    res.status === 401 || res.status === 403,
    `status=${res.status} (attendu 401/403)`,
  )
}

async function scenarioMembershipEscalation(tenantA) {
  // Tentative de self-promotion : un utilisateur essaie de changer son propre
  // role_id directement via PostgREST (règle d'or n°2 de auth-rls-access-control).
  const admin = adminClient()
  const { data: anyOwnerRole } = await admin
    .from('roles')
    .select('id')
    .eq('slug', 'owner')
    .eq('organization_id', tenantA.orgId)
    .maybeSingle()
  if (!anyOwnerRole) {
    record('Self-promotion vers owner', true, 'rôle owner introuvable pour ce tenant, scénario non applicable')
    return
  }
  const { data } = await tenantA.client
    .from('memberships')
    .update({ role_id: anyOwnerRole.id })
    .eq('user_id', tenantA.userId)
    .select()
  record(
    'Self-promotion vers owner (memberships.user_id = soi-même)',
    (data ?? []).length === 0,
    `${(data ?? []).length} ligne(s) modifiée(s) (attendu 0)`,
  )
}

async function main() {
  console.log(`Script d'intrusion cross-tenant contre ${BASE_URL}\n`)

  const tenantA = await signInAsTenant(TENANTS.a.email, TENANTS.a.password)
  const tenantB = await signInAsTenant(TENANTS.b.email, TENANTS.b.password)

  await scenarioForgedRpcDirect(tenantA, tenantB)
  await scenarioForgedApiPayload(tenantA, tenantB)
  await scenarioMembershipEscalation(tenantA)

  for (const target of ['/api/cron/reminders', '/api/webhooks/stripe', '/api/operator/ingest']) {
    await scenarioExcludedPrefixWithoutSecret(target)
  }

  const outPath = join(OUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\nRapport écrit dans ${outPath}`)

  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} scénarios bloqués correctement`)
  if (failed.length) {
    console.error('FUITES:', failed.map((f) => f.name).join(', '))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
