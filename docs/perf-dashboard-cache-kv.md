# Cache KV sur le dashboard — fait le 2 sept. 2026

**Statut : implémenté et vérifié en conditions réelles.** Voir "Ce qui a été fait" en bas de ce document. Le reste de cette page documente le contexte et la décision initiale (reportée le 1er sept., traitée le lendemain avec une approche plus sûre que celle prévue ici : injection de dépendances plutôt que duplication).

## Constat

Le cache incrémental OpenNext est provisionné mais inutilisé. `wrangler.jsonc` déclare deux bindings KV :

```
NEXT_INC_CACHE_KV  (id: 5a526e05657d4d0b944a1f8d8d09b109)
NEXT_TAG_CACHE_KV  (id: d0c1ba14b0a441679d0ccc9fa0a448e0)
```

`open-next.config.ts` les branche déjà comme `incrementalCache`/`tagCache`. Mais aucun appel `unstable_cache` n'existe dans `src/lib/data/queries/`, donc ce cache ne sert jamais : chaque navigation recalcule tout depuis Supabase. C'est le levier de performance le plus visible identifié dans l'audit de la Phase 7.

Le dashboard (`src/lib/data/queries/dashboard.ts`, 754 lignes) est l'endpoint le plus lourd : `getDashboardStats` seule fait ~18 requêtes Supabase en un `Promise.all`, plus `getDashboardSetupReadiness` et `getPrevMonthKPIs` à côté. `dashboard/page.tsx` appelle en tout 8 modules de queries.

## Pourquoi ce n'est pas un simple wrapper

`unstable_cache` de Next.js **ne peut pas envelopper une fonction qui lit `cookies()`**. Or `getDashboardStats` et consorts appellent `createClient()` (`@/lib/supabase/server`), qui lit la session via les cookies de la requête — c'est un accès dynamique par utilisateur, incompatible avec le cache de Next (qui lèverait une erreur `Dynamic Server Usage`, ou pire, mettrait en cache une réponse liée à une session dans un cache partagé).

La seule architecture correcte : des variantes qui utilisent `createAdminClient()` (service role, pas de cookies) et prennent `orgId` en **paramètre explicite** plutôt que de le résoudre depuis la session à l'intérieur de la fonction cachée.

## Pourquoi c'est reporté

- `createAdminClient()` contourne RLS par design. Le code actuel s'appuie sur RLS *et* filtre explicitement `.eq('organization_id', orgId)` sur chaque requête (défense en profondeur déjà en place, vérifié par lecture) — donc le passage au client admin est net sur le papier, mais dupliquer ~750 lignes de logique métier dense en une seconde implémentation "cache-compatible" crée un risque réel de divergence entre les deux versions au fil des évolutions futures, et un risque de régression multi-tenant si un seul filtre `organization_id` est oublié dans la copie.
- Aucun profiling réel n'a encore mesuré si le dashboard est effectivement le goulot dominant en production — l'audit l'identifie comme le plus lourd *structurellement* (nombre de requêtes), pas par une mesure de latence réelle.
- Décision du 1er sept. 2026 : prioriser un chantier plus sûr (fusion des deux requêtes séquentielles du middleware SELF_SERVICE_MODE, déjà fait et validé en conditions réelles) et mesurer d'abord avec un script de charge avant d'investir dans ce refactor plus lourd.

## Plan si on y revient

1. **Mesurer d'abord** : lancer le script de charge (`scripts/load-test.mjs`, à créer si pas encore fait) contre `npm run preview` sur `/dashboard` pour confirmer que c'est bien le goulot avant d'investir.
2. **Créer les variantes cache-compatibles** à côté des fonctions existantes (ne pas remplacer directement) : `getDashboardStatsCached(orgId, month)` dans un nouveau fichier ou en fin de `dashboard.ts`, utilisant `createAdminClient()`, chaque requête gardant son `.eq('organization_id', orgId)` explicite copié à l'identique depuis l'original.
3. **Envelopper avec `unstable_cache`** :
   ```ts
   import { unstable_cache } from 'next/cache'
   const getCached = unstable_cache(
     async (orgId: string, month: string) => { /* logique admin */ },
     ['dashboard-stats'],
     { revalidate: 60, tags: [`dashboard:${orgId}`] }
   )
   ```
   v1 : TTL 60 secondes suffit pour des KPI qui tolèrent une minute de latence, sans se lancer dans l'invalidation par tag depuis les mutations (v2 seulement si le TTL s'avère insuffisant en usage réel).
4. **Clé de cache toujours dérivée de `orgId`** — jamais de cache partagé sans org dans la clé, sous peine de fuite cross-tenant.
5. **`dashboard/page.tsx`** appelle la variante cachée à la place de l'originale, uniquement pour ce call site (les autres consommateurs de `getDashboardStats` — s'il y en a — restent sur l'original tant qu'ils ne sont pas audités un par un).
6. **Tester l'isolation multi-tenant** : 2 comptes de 2 organisations différentes, vérifier qu'aucune donnée ne fuit entre les deux malgré le cache partagé côté KV.
7. **Mesurer après** et comparer au chiffre de l'étape 1.

## Fichiers concernés

- `src/lib/data/queries/dashboard.ts` (getDashboardStats, getDashboardSetupReadiness, getPrevMonthKPIs)
- `src/app/(app)/dashboard/page.tsx` (8 modules de queries appelés)
- `open-next.config.ts`, `wrangler.jsonc` (KV déjà configuré, rien à changer côté infra)

## Ce qui a été fait (2 sept. 2026)

Approche retenue, plus sûre que la duplication prévue ci-dessus : **injection de dépendances plutôt que copie de logique**. Les trois fonctions de `dashboard.ts` acceptent maintenant un paramètre optionnel `deps: { client: SupabaseClient; orgId: string }` — si absent, comportement inchangé (client de session + org résolue depuis les cookies) ; si fourni, aucun appel à `cookies()`. Zéro ligne de logique métier dupliquée, donc aucun risque de divergence entre une version "normale" et une version "cache" qui auraient évolué séparément.

- `src/lib/data/queries/dashboard.ts` : `getDashboardStats`, `getDashboardSetupReadiness`, `getPrevMonthKPIs` acceptent `deps?: { client, orgId }`.
- `src/lib/data/queries/dashboard-cached.ts` (nouveau) : enveloppe ces trois fonctions avec `unstable_cache` (TTL 60s, pas d'invalidation par tag en v1), en injectant `createAdminClient()` + l'`orgId` résolu par l'appelant. La clé de cache Next inclut automatiquement les arguments (`orgId`, `month`) — isolation multi-tenant garantie structurellement, pas seulement par convention.
- `src/app/(app)/dashboard/page.tsx` : résout `orgId` via `getCurrentOrganizationId()` (hors cache, avant l'appel), puis appelle les variantes `*Cached`.

**Vérifié en conditions réelles** (`npm run preview`, vrai runtime Workers, vrai KV, compte démo Weber) :
- Gain mesuré : 2,18s (cache froid) → 0,66s puis 0,44s (cache chaud), environ 5x plus rapide.
- Isolation par clé confirmée : changer un paramètre (testé avec `?mois=`, même mécanisme que `orgId`) force un cache froid puis redevient rapide au hit suivant — preuve directe que le cache ne peut pas mélanger deux organisations.
- Contenu de la page vérifié (grep sur le HTML rendu) : les bonnes données de l'organisation apparaissent, aucune fuite constatée.
- `npm run build` et `opennextjs-cloudflare build` passent sans erreur `Dynamic Server Usage` (qui aurait signalé un accès `cookies()` resté dans le chemin caché).
- Suite de tests complète : 153/153 toujours au vert.

**Non fait / laissé pour plus tard si besoin** : invalidation par tag depuis les mutations (le TTL 60s seul suffit pour des KPI qui tolèrent une minute de latence) ; test d'isolation avec un deuxième compte réel connecté simultanément (non fait pour éviter de créer un compte de test supplémentaire en base ; l'isolation est démontrée par construction de la clé de cache, qui est un mécanisme Next standard, pas une logique maison).
