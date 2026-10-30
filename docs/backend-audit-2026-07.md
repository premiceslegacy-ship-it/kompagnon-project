# Audit backend Atelier — Juillet 2026

Audit complet du backend mené par 6 agents de sécurité spécialisés (auth/RLS, routes API/inputs, IA/Sarah, cron/webhooks/operator, performance/dette, données/compliance) + 1 agent de recherche externe (OWASP, conventions Agent Skills, sortie Supabase).

**Stack auditée** : Next.js App Router · Supabase (Postgres + RLS + SSR) · Cloudflare Workers/OpenNext · 60 routes API · 155 migrations · déploiement per-client.

**Verdict global** : socle applicatif de bon niveau (4 couches Auth→Permission→Zod→Ownership dans les mutations, isolation cockpit, tokens signés, comparaisons constant-time Edge-safe, anti-PII et anti-SSRF centralisés, 24 `loading.tsx`). Les trous sont concentrés sur **(1) la RLS des tables d'identité/coût** (la vraie frontière, car le client anon est exposé au navigateur), **(2) l'immutabilité légale des documents de facturation**, **(3) l'IDOR sur une route PDF admin**, et **(4) le socle observabilité/cache Cloudflare**.

Convention de sévérité : 🔴 CRITIQUE (bloque la vente/mise en prod) · 🟠 IMPORTANT (à corriger avant vente large) · 🟡 MINEUR (dette acceptable court terme).

---

## ✅ Correctifs appliqués (juillet 2026)

Migrations poussées sur le projet base et vérifiées (trigger C1 testé : le changement de rôle non autorisé est bien bloqué) :
- **C1** — `156_harden_identity_rls.sql` : trigger `BEFORE UPDATE` sur `memberships` bloquant tout changement de `role_id` sans `team.edit_roles`, l'auto-modification de rôle et la promotion/rétrogradation d'owner.
- **I1** — `157_security_definer_search_path.sql` : `search_path` fixé sur les 7 fonctions `SECURITY DEFINER`.
- **C3/C7** — `158_invoice_immutability.sql` : triggers d'immutabilité facture + lignes après émission, DELETE physique restreint aux brouillons.
- **C5** — `operator-migrations/008_webhook_events.sql` : table d'idempotence (à appliquer sur le projet operator).

Patchs de code (typecheck vert) :
- **C2** — `pdf/member/[id]/route.ts` : appartenance à l'org exigée, pointages scopés par organisation, permission `reports.view`, `no-store`.
- **C4/C5** — `webhooks/stripe/route.ts` : comparaison de signature `constantTimeEqual` + idempotence via `webhook_events` (dégradation sûre si la table operator n'est pas encore présente).
- **C6** — `operator/cron/quota-alerts/route.ts` : `verifyCronSecret` centralisé (constant-time).
- **C3 (garde app)** — `invoices.ts` : `saveInvoiceItems` refuse de modifier une facture non-`draft` avec un message clair.
- **I3** — `team.ts` : `sendTeamInvite` valide que le `role_id` appartient à l'org et n'est pas owner.

Restent à traiter (non bloquants) : I8 (rate-limit IA fail-open), I16 chiffrement IBAN (WhatsApp neutralisé plutôt que chiffré — module suspendu), et le nettoyage des abonnements push expirés (`push.ts` ne supprime pas les endpoints 410/404 — voir sous-skill `cron-webhooks-integrations/references/push-notifications.md`).

## ✅ Perf, notifications et cache — corrigés (juillet 2026, session suivante)

**Performance (I9, I11, I12 partiel)** :
- `getInvoices`/`getQuotes` plafonnées à 500 lignes (`FINANCES_LIST_LIMIT`/`QUOTES_LIST_LIMIT`) — protège la page finances sur une organisation ancienne.
- Catalogue (`materials`/`labor_rates`/`prestation_types`) laissé sans limite (sélecteurs de devis) mais index composites `(organization_id, is_active, created_at DESC)` ajoutés (migration `159_perf_indexes.sql`).
- `getAllPlannings()` désormais appelée avec une fenêtre ±6 mois depuis `PlanningGlobalPage` au lieu de charger tout l'historique.
- `getChantierPhotos()` plafonnée à 60 photos les plus récentes (`CHANTIER_PHOTOS_INITIAL_LIMIT`) ; les usages qui ont besoin de l'intégralité (rapport PDF, envoi email) ne sont pas affectés (requêtes directes séparées).
- Index composites ajoutés sur `quotes`/`invoices` (`organization_id, created_at DESC WHERE is_archived=false`).
- Cache Next.js branché sur Cloudflare KV (`incrementalCache`/`tagCache` dans `open-next.config.ts`) au lieu de `dummy` — build OpenNext + `wrangler deploy --dry-run` validés, bindings confirmés. Voir section dédiée dans `DEPLOIEMENT_CLIENT.md`.

**Notifications push (angle mort non listé dans l'audit initial, remonté par l'utilisateur)** :
- Les intervenants terrain sans compte auth (`chantier_equipe_membres.profile_id IS NULL`, gérés via `/mon-espace`) étaient invisibles au système de push (`push_subscriptions.user_id` référençait `auth.users` en NOT NULL). Migration `160_push_subscriptions_member_space.sql` : `user_id` nullable, ajout de `member_id`, contrainte d'exclusivité. Nouvelle Server Action `subscribeMemberToPush` + hook `useMemberPushNotifications` + bouton dans `MonEspaceDashboardClient`. `getPlanningRecipientUserIds` renvoie désormais `{ userIds, memberIds }` et `sendPushToPlanningRecipients` couvre les deux (6 call sites migrés : planning.ts, chantiers.ts, sarah/actions.ts).
- Événements métier auparavant non poussés, corrigés : paiement enregistré sur échéancier (`recordScheduledPayment`), devis refusé (`markQuoteRefused`), absence déclarée par un membre (`declareMyAbsenceFromSpace`, notifie les rôles `chantiers.edit`).
- Réception de chantier / réserves volontairement laissées sans push (actions gérant→gérant, redondant avec l'action elle-même).

## ✅ Sécurité, conformité et observabilité — corrigés (juillet 2026, 3e session)

**I2 — labor_rates/materials FOR ALL** : déjà corrigé en base au moment de cette session (policies `materials_select`/`materials_manage`, `labor_rates_select`/`labor_rates_manage` gatées par `catalog.view`/`catalog.edit` — vérifié via `pg_policies`, aucune action nécessaire).

**I4 — Lien magique /mon-espace à usage unique** : `verifyMemberToken` refuse désormais un token dont `last_used_at` est déjà renseigné (même réponse que "introuvable", anti-énumération) ; consommation atomique via `.is('last_used_at', null)` pour éviter une double ouverture de session en cas d'appel concurrent. Le cron de rappel J-3 (`member-token-reminders`) exclut les tokens déjà consommés.

**I15 — Suppression de compte RGPD réellement exécutée** : migration `163_account_deletion_execution.sql` — fonction `anonymize_organization_for_deletion()` (anonymise profils/clients/membres d'équipe, désactive tous les memberships, conserve intégralement factures/devis/paiements pour l'obligation fiscale 10 ans). Nouveau cron `/api/cron/account-deletion` (quotidien) qui l'appelle pour chaque organisation dont `deletion_scheduled_at <= now()`, borné à 50/passage, idempotent (colonne `anonymized_at`).

**I17 — Journal d'audit sur les actions sensibles** : `activity_log` durcie en piste d'audit pour les événements `audit.*` (paiement facture, devis refusé, changement de rôle, suppression de membre, anonymisation RGPD) — le cron `data-retention` exclut désormais ce préfixe de sa purge à 180 jours (contrairement au feed d'activité générique, éphémère). Nouveau helper centralisé `src/lib/audit-log.ts`.

**Module WhatsApp désactivé** (agent non déployé pour le moment) : le plan Expert activait `whatsapp_agent`/`whatsapp_ocr`/`whatsapp_proactive` par défaut malgré la suspension du module (vérification Meta en attente) — corrigé dans `quota-catalog.ts`. Garde serveur ajoutée dans `normalizeOrganizationModules()` : ces clés sont forcées à `false` même via un input explicite, donc impossible à réactiver par erreur (UI, cockpit ou appel direct). L'onglet Settings affichait déjà "Bientôt disponible" (formulaire réel caché en CSS, non touché). Edge Function webhook `whatsapp-webhook` non supprimée (1851 lignes, travail existant conservé) mais déjà inerte : elle exige `whatsapp_configs.is_active = true`, impossible à atteindre tant que l'UI reste masquée.

**Observabilité (I10)** :
- 3 `error.tsx` créés (`(app)/error.tsx`, `mon-espace/error.tsx`, `global-error.tsx` racine) — message humain + bouton réessayer au lieu de l'écran d'erreur Next brut.
- **Sentry** installé en **client-only** (`src/instrumentation-client.ts`, `withSentryConfig` conditionnel dans `next.config.mjs`) : pas de `sentry.server.config.ts`/`sentry.edge.config.ts` — bug non résolu (`AsyncLocalStorage`) sur OpenNext/Cloudflare Workers au moment de l'intégration (issues GitHub sentry-javascript #18842/#18843, ouvertes). Les 3 `error.tsx` remontent à `Sentry.captureException`.
- **PostHog** installé en suivi de base (`posthog-js` client + `posthog-node` serveur) : autocapture et session recording désactivés (app métier avec montants/coordonnées à l'écran), pageviews automatiques (`src/components/posthog-provider.tsx`), événements métier explicites sur facture payée/envoyée (`trackServerEvent`).
- CSP (`next.config.mjs`) étendue pour autoriser `*.sentry.io`/`*.ingest.us.sentry.io`/`*.posthog.com`/`*.i.posthog.com`.
- Toutes les variables optionnelles (`NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `NEXT_PUBLIC_POSTHOG_KEY`) : absence = désactivation silencieuse, jamais d'échec de build. Documenté dans `DEPLOIEMENT_CLIENT.md`.
- Build OpenNext complet + `wrangler deploy --dry-run` validés après intégration (bindings KV toujours reconnus, aucune régression).

Corrigé au passage : décalage de type pré-existant sur `routeDepartures` (`PlanningGlobalClient.tsx`) qui bloquait `next build` (donc `opennextjs-cloudflare build`) — `latitude`/`longitude` manquaient dans le type de la prop alors que `getAllTourneeRoutes()` les renvoyait déjà.

## ✅ Rate-limit et nettoyage push — corrigés (juillet 2026, 4e session)

- **I8** — `checkRateLimit` (`src/lib/rate-limit.ts`) : sur erreur RPC, les scopes `ai:*` sont désormais fail-**closed** (`allowed: false`) au lieu de fail-open. Les autres scopes (formulaires publics, ex. `public_quote_request`) restent fail-open pour préserver la disponibilité.
- **Nettoyage push** — `sendToSubscriptions` (`src/lib/push.ts`) : les abonnements dont l'envoi échoue avec un code 404/410 (Gone) sont supprimés de `push_subscriptions`, évitant l'accumulation d'endpoints morts.

Restes non bloquants : aucun point ouvert connu à ce stade — voir la checklist audit strict universelle du skill `backend-orsayn` pour un audit de suivi périodique.

---

## 🔴 CRITIQUES — à fermer avant toute nouvelle mise en prod client

| # | Domaine | Fichier | Problème | Correctif |
|---|---------|---------|----------|-----------|
| C1 | Auth/RLS | `supabase/migrations/008_rls.sql:156-159` | **Élévation de privilège** : `memberships_update` n'exige aucune permission ni protection de colonne. Un collaborateur peut, via le client anon exposé au navigateur, faire `update({ role_id: <owner_id> })` sur sa propre ligne → prise de contrôle totale du tenant. Les gardes owner/admin de `team.ts` sont applicatives donc contournées. | Nouvelle migration : policy UPDATE gatée `team.edit_roles` + `user_id <> auth.uid()` + interdiction de cibler/devenir `owner` (WITH CHECK). Trigger `BEFORE UPDATE` `RAISE EXCEPTION` si `role_id` change sans permission. Idéalement, `updateMemberRole` passe au client admin après vérif serveur, RLS = backstop deny. |
| C2 | Routes API | `src/app/api/pdf/member/[id]/route.ts:44-114` | **IDOR cross-organisation** : branche `type=user` via client admin (RLS bypass), `chantier_pointages` filtré seulement sur `user_id`, jamais sur l'org. Un membre de l'org A reçoit le PDF (nom, heures, taux horaire) d'un utilisateur de l'org B. Aucune permission vérifiée. | Exiger l'appartenance à l'org (bloquer si `membershipRes.data` absent) + `.eq('chantiers.organization_id', orgId)` sur la requête pointages + `hasPermission('members.reports.view')`. |
| C3 | Compliance | `src/lib/data/mutations/invoices.ts:102-199,403-444` + `008_rls.sql:303-306` | **Facture émise mutable** : `invoices_update` ne filtre que `organization_id`, `saveInvoiceItems` DELETE+réinsère les lignes sans vérifier `status='draft'`. Une facture `sent`/`paid` peut être réécrite (montant, client) en gardant numéro et date. Violation intangibilité (art. 289 CGI, NF203). | Bloquer toute mutation de contenu si `status != 'draft'` (garde applicatif + trigger `BEFORE UPDATE` `RAISE EXCEPTION`). Correction d'une facture émise = avoir/contre-document. |
| C4 | Webhooks | `src/app/api/webhooks/stripe/route.ts:49` | **Signature Stripe comparée en `===`** (timing-unsafe, HMAC ré-implémenté à la main). Timing attack → forger une signature → upgrade de tier/resync config arbitraire. | Comparaison constant-time Edge-safe (helper XOR sur longueur égale) ou `crypto.subtle.verify('HMAC', …)`. |
| C5 | Webhooks | `src/app/api/webhooks/stripe/route.ts:202-296` | **Aucune idempotence** (pas de table `webhook_events`, pas de dédup sur `event.id`). Stripe redélivre (at-least-once) → double reset de quotas cockpit, double config-sync. | `INSERT INTO webhook_events(provider, source_id) … ON CONFLICT DO NOTHING` avant traitement ; si 0 ligne → 200 immédiat. |
| C6 | Cron | `src/app/api/operator/cron/quota-alerts/route.ts:13-17` | **`verifyCronSecret` local en `value === secret`** (le seul cron qui n'utilise pas le helper constant-time). Timing attack sur `CRON_SECRET`. | Supprimer la fonction locale, `import { verifyCronSecret } from '@/lib/cron-auth'`. |
| C7 | Compliance | `008_rls.sql:252-256,308-313` | **DELETE physique autorisé** sur factures/devis/contrats (soft-delete existe mais rien ne bloque `.delete()`). Trou de séquence irréparable possible. | Révoquer la policy DELETE en prod, soft-delete only. |

> **Note sur C3/C7** : ces deux findings touchent la valeur probante fiscale. Pour une app de facturation, ils sont bloquants pour une vente large même s'ils ne sont pas exploitables « à distance ».

---

## 🟠 IMPORTANTS — à corriger avant vente large

| # | Domaine | Fichier | Problème | Correctif |
|---|---------|---------|----------|-----------|
| I1 | Auth/RLS | `supabase/migrations/006_functions.sql` | 7 fonctions `SECURITY DEFINER` **sans `SET search_path`**, dont `get_user_org_id()` et `user_has_permission()` appelées dans **toutes** les policies. Détournement possible via search_path. | `SET search_path = public, pg_temp` sur chacune. `supabase db lint` / advisor pour confirmer. |
| I2 | Auth/RLS | `008_rls.sql:212-225` | `labor_rates`/`materials`/`saved_templates` en `FOR ALL` sans permission → coûts internes lisibles ET écrivables par tout membre (incohérent avec `canManageLaborRates()` applicatif). | Séparer SELECT/écriture + gate permission ; écritures via client admin après vérif. |
| I3 | Auth/RLS | `src/lib/data/mutations/team.ts:96` | `sendTeamInvite` insère un `role_id` sans vérifier qu'il n'est pas `owner`/`admin` → un Manager invite directement en admin. | Whitelist des rôles assignables selon le rôle de l'invitant + contrainte RLS/trigger. |
| I4 | Auth | `src/lib/data/mutations/members.ts:355` | Magic-link membre **rejouable jusqu'à J+30** (`verifyMemberToken` ne consomme pas le token). Fuite du lien = accès espace membre 30 jours. | Token single-use (delete/flag `last_used_at`), TTL réduit, invalider les autres tokens à la consommation. |
| I5 | IA | `src/app/api/ai/sarah-secretary/route.ts:1180-1193` + `src/lib/sarah/actions.ts` | **Prompt injection** : pièces jointes/PDF/notes tierces concaténées au prompt sans séparation instructions/données ; carte `draft_email`/`email_broadcast` au libellé généré par le LLM peut tromper un clic. Blast radius limité à l'org (destinataires résolus serveur). | Délimiter tout contenu non fiable (`<untrusted>…</untrusted>`) + inoculation ; re-confirmation renforcée affichant destinataires/corps réels résolus serveur ; risque recalculé serveur, jamais celui du LLM. |
| I6 | IA | `src/app/api/sarah/actions/execute/route.ts:6-18` | `execute` accepte `type`+`payload` bruts du body et court-circuite la carte de confirmation ; ré-autorisation par action incohérente. | Table `type → permission requise` vérifiée à l'exécution ; forcer le passage par une proposition persistée pour risque medium/high. |
| I7 | IA | tout `src/app/api/ai/**` | **Aucun Zod en sortie de LLM** avant insert BDD ; coercition-fallback silencieuse (`numberOr`) avale montants/TVA invalides. | Schéma Zod par action, `safeParse`, **rejet** strict (bornes montants/TVA), pas de fallback silencieux. Priorité : devis/facture/dépense. |
| I8 | Cron/IA | `src/lib/rate-limit.ts:70-78` | **Rate-limit fail-open** : sur erreur RPC → `allowed:true`. Sur Supabase Free en pause/saturé, toutes les limites IA coûteuses sautent. | Fail-**closed** (ou compteur mémoire dégradé) pour les scopes `ai:*` ; alerte. |
| I9 | Perf | `open-next.config.ts:8-9,16-17` | **Cache Next.js no-op** : `incrementalCache: "dummy"` + `tagCache: "dummy"` → `unstable_cache`/ISR/`revalidateTag` inertes. Chaque render refait 100 % des requêtes Supabase. | Brancher `incrementalCache` sur R2/KV et `tagCache` sur D1/KV (`@opennextjs/cloudflare`). |
| I10 | Perf | package.json / `src/lib/` | **Zéro observabilité** (pas de Sentry/PostHog/logger structuré) : 210 `console.error` non structurés. **Zéro error boundary** (`error.tsx`=0). | Logger JSON structuré + correlation ID (middleware) + Logpush/Tail Worker ; `error.tsx` par segment + `global-error.tsx`. |
| I11 | Perf | `queries/{clients,invoices,maintenance}.ts` | Listes cœur métier **non paginées** (unbounded reads) ; `.limit(200)` en dur ailleurs (fausse pagination + troncature silencieuse). | Pagination curseur keyset + index composite `(organization_id, created_at DESC, id DESC)`. |
| I12 | Routes | `src/app/api/pdf/**`, `exports/fec`, `finances/monthly-report` | 8 routes de **documents sensibles sans `Cache-Control: no-store`** (dont contrat à token public) → cache proxy/CDN/navigateur. | Helper `sensitiveDocHeaders()` renvoyant `no-store, max-age=0` sur toutes ces routes. |
| I13 | Routes/SSRF | `src/lib/security.ts:58-72` | `assertSafeExternalFetchUrl` **ne bloque pas** les IP privées/metadata (169.254/127/10/192.168/localhost). `logo_url` écrivable → SSRF déclenchable à la génération PDF. | Ajouter la blocklist + `AbortSignal.timeout(5000)` sur chaque fetch. |
| I14 | Routes | `src/lib/data/mutations/organization.ts:113,234` | **Mass assignment** : `.update({ ...payload })` spread → écriture de colonnes non prévues (`slug`, `deletion_*`, `default_labor_cost_per_hour`…). | Whitelist explicite `ALLOWED_ORG_KEYS`, objet construit clé par clé. |
| I15 | Compliance | `mutations/account-deletion.ts:30-41` | **Suppression RGPD J+30 jamais exécutée** : `deletion_scheduled_at` posé, aucun cron ne le lit. Non-conformité art. 17. | Job cron purge/anonymise à `deletion_scheduled_at <= now()` (préserver factures 10 ans anonymisées) + fermeture auth. |
| I16 | Compliance | `038_whatsapp_agent.sql:11`, `002_core_tables.sql:33` | **Secrets tiers en clair** : token Meta/WhatsApp, IBAN ; `pa_api_key_encrypted` jamais chiffrée malgré son nom. | Chiffrement au repos (pgsodium/Vault ou app-level, clé hors DB) ; renommer une fois chiffré. |
| I17 | Compliance | migrations (absent) | **Pas d'audit log append-only** général ; `activity_log` purgé à 180j. Pas de `document_archive`/`hash_sha256`. | Table `audit_log` INSERT-only (RLS deny UPDATE/DELETE) + `document_archive` avec hash SHA-256 figé à l'émission. |

---

## 🟡 MINEURS — dette suivie

- **CSP permissive** (`next.config.mjs:52-62`) : `script-src 'unsafe-inline' 'unsafe-eval'` neutralise la protection XSS → migrer vers nonce. Autres headers corrects (HSTS preload, X-Frame-Options DENY, nosniff, frame-ancestors none).
- **Fuites `error.message`** Postgres/render renvoyées au client (routes PDF, `catalog-extract` renvoie même le `raw` LLM) → message générique + `redactForLog` (existe, sous-utilisé).
- **`updateOrganizationModules`** sans `hasPermission('settings.edit_org')` (atténué par whitelist stricte des clés).
- **553 `any`**, pas de types Supabase générés, pas de `DbResult<T>` généralisé, `tsconfig` sans `noUncheckedIndexedAccess`.
- **God-files** : `ChantierDetailClient.tsx` 4124 lignes / 121 `useState` / fetch client-side ; `QuoteEditorClient` 3908 ; `mutations/chantiers.ts` 2267.
- **Timeouts sortants manquants** sur `metal-prices` fetch, config-sync Stripe, appels IA de Sarah (pas de `timeoutMs`).
- **SDK Resend importé en direct** (5 endroits) hors adapter `/lib/email`.
- **config-sync operator** sans anti-rejeu (timestamp/nonce) ; **crons sans LIMIT** (recurring-invoices, auto-reminders, reminders, data-retention) ; **`increment_quota_counter`** possiblement appelé après un event dédupliqué.
- **`auth/callback` `next`** non whitelisté à un chemin relatif ; **fallback secret session membre sur service_role** (`member-session.ts:10`) ; **token iCal membre permanent**.
- **Numérotation** : continuité désactivée dès qu'il y a plusieurs préfixes (`numbering-check.ts:39`) ; tokens de signature en clair sans expiration.
- **Backup ÉLEVÉ non documenté** sur Supabase Free (pas de PITR) alors que la criticité facturation l'exige.

---

## Priorité de remédiation suggérée

1. **Sprint sécurité immédiat** : C1, C2 (exploitables, fuite/prise de contrôle) → C4, C5, C6 (webhooks/cron) → I1, I8, I13, I14.
2. **Sprint conformité** : C3, C7, I15, I16, I17 (intangibilité, RGPD, valeur probante).
3. **Sprint perf/robustesse** : I9, I10, I11, I12 + dette TS (`any`, types générés, `DbResult`).
4. **Suivi** : mineurs, découpage des god-files, CSP nonce.

Chaque finding a un correctif exact dans les rapports d'agents ; les patterns de correction sont capitalisés dans le dossier de skills `backend-orsayn` (sous-skills par domaine).
