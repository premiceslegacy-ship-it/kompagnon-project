// Test de charge local contre le runtime Workers réel (npm run preview, port 8787),
// pas contre npm run dev (Node complet, ne reproduit ni les contraintes CPU/mémoire
// ni le comportement ICU/Intl du runtime workerd).
//
// Usage :
//   1. npm run preview  (laisser tourner dans un autre terminal, port 8787)
//   2. Récupérer un cookie de session valide (login via le navigateur ou Playwright
//      contre http://localhost:8787/login), le passer en variable d'env COOKIE.
//   3. COOKIE="sb-xxx-auth-token=...; atelier_onboarded=..." node scripts/load-test.mjs
//
// Sortie : p50/p95/erreurs par endpoint, JSON daté dans .scratch/load-test/.

import autocannon from 'autocannon'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE_URL = process.env.LOAD_TEST_URL ?? 'http://localhost:8787'
const COOKIE = process.env.COOKIE ?? ''
const QUOTE_ID = process.env.LOAD_TEST_QUOTE_ID ?? null

if (!COOKIE) {
  console.error('COOKIE manquant. Voir le commentaire en tête de ce script pour l\'obtenir.')
  process.exit(1)
}

const OUT_DIR = join(process.cwd(), '.scratch', 'load-test')
mkdirSync(OUT_DIR, { recursive: true })

// Ordre de priorité du plan Phase 7 : PDF chantier (CPU + risque OOM) en premier,
// puis dashboard (le plus de requêtes Supabase), puis listes, puis PDF devis/facture.
const targets = [
  { name: 'dashboard', path: '/dashboard' },
  { name: 'chantiers-list', path: '/chantiers' },
  { name: 'finances-list', path: '/finances' },
  { name: 'clients-list', path: '/clients' },
  ...(QUOTE_ID ? [{ name: 'pdf-quote', path: `/api/pdf/quote/${QUOTE_ID}` }] : []),
]

async function runTarget({ name, path }) {
  console.log(`\n── ${name} (${path}) ──`)
  const result = await autocannon({
    url: BASE_URL + path,
    connections: 3,
    duration: 12,
    headers: { cookie: COOKIE },
  })
  const summary = {
    name,
    path,
    p50: result.latency.p50,
    p95: result.latency.p97_5, // autocannon n'expose pas p95 pile, p97_5 est le plus proche disponible
    p99: result.latency.p99,
    mean: result.latency.mean,
    errors: result.errors,
    non2xx: result.non2xx,
    timeouts: result.timeouts,
    requestsTotal: result.requests.total,
    throughputMeanBytes: result.throughput.mean,
  }
  console.log(`p50=${summary.p50}ms p95=${summary.p95}ms p99=${summary.p99}ms erreurs=${summary.errors} non2xx=${summary.non2xx}`)
  return summary
}

async function main() {
  const results = []
  for (const target of targets) {
    results.push(await runTarget(target))
  }
  const outPath = join(OUT_DIR, `run-${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(outPath, JSON.stringify(results, null, 2))
  console.log(`\nRésultats écrits dans ${outPath}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
