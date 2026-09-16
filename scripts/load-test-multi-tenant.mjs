// Variante multi-organisation de scripts/load-test.mjs : plusieurs cookies de
// sessions distinctes (organisations différentes) tapent les mêmes endpoints
// en concurrence, pour vérifier deux choses que le load-test mono-tenant ne
// peut pas voir : (1) la volumétrie tient quand plusieurs organisations sont
// actives en même temps sur la même instance mutualisée, (2) aucune réponse
// ne contient de donnée d'une autre organisation (vérification de contenu,
// pas seulement de latence).
//
// Usage :
//   1. npm run preview  (laisser tourner dans un autre terminal, port 8787)
//   2. Récupérer un cookie de session par tenant (login via le navigateur ou
//      Playwright), les passer en JSON dans COOKIES_JSON :
//      COOKIES_JSON='[{"org":"tenant-a","cookie":"sb-xxx-auth-token=..."},{"org":"tenant-b","cookie":"sb-xxx-auth-token=..."}]' \
//        node scripts/load-test-multi-tenant.mjs
//
// Sortie : p50/p95/erreurs par endpoint ET par tenant, plus un rapport de
// fuite de contenu si une réponse contient le nom d'organisation d'un autre
// tenant que celui authentifié. JSON daté dans .scratch/load-test-multi-tenant/.
//
// N'a pas été exécuté en conditions réelles dans cette session (nécessite un
// build + wrangler preview + des cookies de sessions réelles) — à valider
// manuellement avant de s'y fier pour une décision de capacité.

import autocannon from 'autocannon'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.LOAD_TEST_URL ?? 'http://localhost:8787'
const COOKIES_JSON = process.env.COOKIES_JSON ?? ''

if (!COOKIES_JSON) {
  console.error('COOKIES_JSON manquant. Voir le commentaire en tête de ce script pour le format attendu.')
  process.exit(1)
}

let tenants
try {
  tenants = JSON.parse(COOKIES_JSON)
} catch {
  console.error('COOKIES_JSON invalide (JSON attendu : [{"org": "...", "cookie": "..."}])')
  process.exit(1)
}

if (!Array.isArray(tenants) || tenants.length < 2) {
  console.error('Au moins 2 tenants requis pour un test de charge multi-organisation.')
  process.exit(1)
}

const OUT_DIR = join(process.cwd(), '.scratch', 'load-test-multi-tenant')
mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'chantiers-list', path: '/chantiers' },
  { name: 'finances-list', path: '/finances' },
  { name: 'clients-list', path: '/clients' },
]

async function runTargetForTenant(target, tenant) {
  const result = await autocannon({
    url: BASE_URL + target.path,
    connections: 3,
    duration: 12,
    headers: { cookie: tenant.cookie },
  })
  return {
    org: tenant.org,
    name: target.name,
    path: target.path,
    p50: result.latency.p50,
    p95: result.latency.p97_5,
    p99: result.latency.p99,
    mean: result.latency.mean,
    errors: result.errors,
    non2xx: result.non2xx,
    timeouts: result.timeouts,
    requestsTotal: result.requests.total,
  }
}

// Vérification de contenu séparée de la charge (autocannon ne capture pas les
// corps de réponse en detail par défaut) : un aller simple par tenant et par
// endpoint, en vérifiant qu'aucune réponse ne mentionne le nom d'une autre
// organisation que celle authentifiée par ce cookie.
async function checkNoCrossTenantLeak(target, tenant, otherOrgNames) {
  const res = await fetch(BASE_URL + target.path, { headers: { cookie: tenant.cookie } })
  const body = await res.text()
  const leaked = otherOrgNames.filter((name) => name && body.includes(name))
  return { org: tenant.org, name: target.name, status: res.status, leaked }
}

async function main() {
  console.log(`Test de charge multi-tenant : ${tenants.length} organisation(s) en concurrence.\n`)

  const loadResults = []
  for (const target of targets) {
    console.log(`── ${target.name} (${target.path}) — ${tenants.length} tenants en parallèle ──`)
    const perTenant = await Promise.all(tenants.map((tenant) => runTargetForTenant(target, tenant)))
    for (const r of perTenant) {
      console.log(`  [${r.org}] p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms erreurs=${r.errors} non2xx=${r.non2xx}`)
    }
    loadResults.push(...perTenant)
  }

  console.log('\n── Vérification de fuite de contenu cross-tenant ──')
  // otherOrgNames par tenant : les noms des AUTRES orgs, à ne jamais voir dans sa propre réponse.
  const leakResults = []
  for (const target of targets) {
    for (const tenant of tenants) {
      const others = tenants.filter((t) => t.org !== tenant.org).map((t) => t.org)
      const result = await checkNoCrossTenantLeak(target, tenant, others)
      leakResults.push(result)
      if (result.leaked.length > 0) {
        console.error(`  FUITE [${result.org}] ${target.name} contient : ${result.leaked.join(', ')}`)
      } else {
        console.log(`  OK [${result.org}] ${target.name} — aucune donnée d'une autre org détectée`)
      }
    }
  }

  const outPath = join(OUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify({ loadResults, leakResults }, null, 2))
  console.log(`\nRésultats écrits dans ${outPath}`)

  const anyLeak = leakResults.some((r) => r.leaked.length > 0)
  if (anyLeak) {
    console.error('\nFUITE CROSS-TENANT DÉTECTÉE — voir le détail ci-dessus.')
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
