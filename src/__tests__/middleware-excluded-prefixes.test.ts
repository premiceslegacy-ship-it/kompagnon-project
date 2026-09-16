// Finding F4 (audit du 2026-09-16, voir
// /Users/useersm/.claude/plans/oui-on-audit-tout-compiled-music.md) :
// src/middleware.ts exclut des PRÉFIXES entiers (/api/cron, /api/webhooks,
// /api/operator, /api/einvoicing) plutôt que des routes exactes. Aujourd'hui
// chaque route sous ces préfixes vérifie bien son propre secret, mais rien
// n'empêche une future route d'être ajoutée sans garde — elle serait alors
// publique par défaut (déjà arrivé en sens inverse le 2026-08-08 : ingest et
// config-sync manquaient de l'exclusion et étaient inaccessibles en prod).
//
// Ce test grep chaque route.ts sous les préfixes exclus et échoue si l'une
// d'elles n'appelle aucun des helpers de vérification connus.

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const EXCLUDED_PREFIXES = ['src/app/api/cron', 'src/app/api/webhooks', 'src/app/api/operator', 'src/app/api/einvoicing']

const KNOWN_GUARDS = [
  'verifyCronSecret',
  'verifyOperatorSignature',
  'verifyStripeSignature',
  'verifyOauthState',
]

function findRouteFiles(dir: string): string[] {
  const results: string[] = []
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      results.push(...findRouteFiles(fullPath))
    } else if (entry === 'route.ts') {
      results.push(fullPath)
    }
  }
  return results
}

describe('middleware — routes sous préfixe exclu doivent porter leur propre garde', () => {
  for (const prefix of EXCLUDED_PREFIXES) {
    const routeFiles = findRouteFiles(join(process.cwd(), prefix))

    it(`${prefix} : au moins une route trouvée (le test ne doit pas être vide)`, () => {
      expect(routeFiles.length).toBeGreaterThan(0)
    })

    for (const file of routeFiles) {
      const relative = file.replace(`${process.cwd()}/`, '')
      it(`${relative} appelle un helper de vérification connu`, () => {
        const source = readFileSync(file, 'utf8')
        const hasGuard = KNOWN_GUARDS.some((guard) => source.includes(guard))
        expect(hasGuard).toBe(true)
      })
    }
  }
})
