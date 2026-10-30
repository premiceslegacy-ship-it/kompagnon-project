# Audit Backend Client-Ready — Atelier / Kompagnon

Date: 2026-05-18
Profil: App Orsayn per-client, Supabase/Postgres/RLS, Next.js App Router, Cloudflare/OpenNext, crons, IA, PDF, operator cockpit, signature publique.

## Synthèse

Statut global: **client-ready sous réserve de validation des secrets de production et du build OpenNext en environnement Cloudflare**.

Ce passage a corrigé les points bloquants ou risqués visibles sans toucher aux workflows métier:
- le test de permissions planning suit maintenant la migration 093: `chantiers.planning` est le droit officiel, séparé de `chantiers.edit`;
- le webhook WhatsApp ne log plus le payload complet;
- les logs d'erreurs IA ne dump plus de fragments bruts de réponse modèle;
- les erreurs signature contrat ne log plus IP/user-agent en clair;
- les helpers `redactForLog` et `assertSafeExternalFetchUrl` centralisent la redaction et le contrôle minimal des fetchs externes;
- les fetchs de logos/URLs publiques serveur refusent les URLs non-HTTPS ou avec credentials;
- le preflight dispose d'un mode `--strict-env` pour transformer les secrets prod absents en erreurs.

## Matrice API

| Surface | Auth / secret | Ownership | Validation | Cache | Statut |
| --- | --- | --- | --- | --- | --- |
| `/api/ai/*` | utilisateur Supabase + modules/quota/rate limit selon route | org courante / RLS | taille fichiers, type payload, parsing JSON IA | no-store implicite route dynamique | OK, logs IA redacted |
| `/api/cron/*` | `CRON_SECRET` via comparaison constante | service role contrôlé par job | limites métier par job | non cacheable | OK, secrets à valider en prod |
| `/api/pdf/*` | utilisateur Supabase ou token public contrat | orgId vérifié avant rendu | params route simples | PDF no-store/inlined selon route | OK, tokens publics existants conservés |
| `/api/operator/*` | HMAC `x-operator-signature` | cockpit séparé | JSON shape check | no-store implicite | OK, pas de PII métier brute attendue |
| `/api/planning/ical` | token HMAC sur orgId | orgId signé | params `orgId` + `token` | `no-cache` | OK, révocation = rotation secret/service key |
| `/api/manifest`, `/api/app-icon` | public | n/a | params bornés | public attendu | OK |
| Server Actions publiques | honeypot + rate limit DB | org slug/form settings | champs limités | n/a | OK, à surveiller sur pièces jointes publiques |

## RLS Et Migrations

Vérification statique des migrations récentes `078` à `098`:
- `invoice_payment_schedule`, `contracts`, `contract_templates`, `member_goals`, `tournee_routes` activent RLS et définissent des policies;
- les RPC critiques récentes utilisent `SECURITY DEFINER` avec `SET search_path = public` lorsque le code le requiert;
- `member_space_tokens` est deny-all côté RLS, tokens stockés hashés;
- les droits planning/rentabilité sont bien séparés dans `093_planning_and_profitability_permissions.sql`;
- `094_restrict_collaborateur_permissions.sql` retire les permissions sensibles aux rôles terrain.

Points à valider contre une base Supabase réelle avant go-live:
- exécuter `supabase db push` ou équivalent client par client;
- confirmer buckets Storage créés: `logos`, `chantier-photos`, `quote-attachments`, `organization-exports`;
- vérifier que les policies Storage correspondent au niveau de confidentialité client;
- confirmer que les migrations opérateur sont appliquées si `OPERATOR_MODE=true`.

## Sécurité Applicative

OWASP Top 10:
- Broken Access Control: RLS + ownership applicatif + tests permissions chantier/planning.
- Cryptographic Failures: cookies httpOnly, tokens magic links hashés, HMAC operator/ical/cron; secrets uniques requis par instance.
- Injection: accès DB via Supabase query builder/RPC, pas de SQL string concaténé détecté dans les surfaces inspectées.
- Insecure Design: mode per-client isolé infra, flags/modules en DB, cockpit séparé.
- Security Misconfiguration: headers sécurité présents; CSP contient encore `unsafe-inline`/`unsafe-eval`, accepté temporairement pour Next/react-pdf mais à revisiter.
- Vulnerable Components: `npm audit` non exécuté dans ce passage; à ajouter au pipeline CI.
- Identification/Auth Failures: middleware Supabase SSR conforme, évite les bugs de refresh session; espaces membres signés et TTL 8h.
- Software/Data Integrity: migrations numérotées uniques, preflight vérifie la SOP.
- Logging/Monitoring: observability Cloudflare activée; logs PII réduits dans les zones corrigées.
- SSRF: fetchs externes serveur durcis pour logos/URLs publiques; poursuivre l'application du helper sur tout nouveau fetch dynamique.

## Données Et Visibilité

Données collectées principales:
- auth/profil: email, nom, téléphone, avatar;
- organisation: informations légales, coordonnées, branding, paiement, modules;
- métier: clients, devis, factures, contrats, chantiers, photos, pointages, relances, fournisseurs;
- IA: usage_logs avec provider, feature, modèle, coût, tokens, statut, metadata limitée;
- espaces publics: demandes de devis, pièces jointes publiques, signatures par token.

Qui voit quoi:
- utilisateur authentifié: uniquement son organisation via RLS et permissions;
- collaborateur/membre terrain: permissions restreintes, pointages/espace membre séparés;
- public: formulaire demande, signature devis/contrat par token, éventuelles pièces jointes publiques;
- operator cockpit: métriques/modules/quotas signés HMAC, pas accès direct aux tables métier client sauf configuration prévue;
- service role: réservé aux crons, rendus PDF, exports, operator/config sync, webhooks.

## Déploiement

Commandes de validation:
- `npm run typecheck`
- `npm test`
- `npm run preflight:client -- atelier-audit`
- `npm run preflight:client -- atelier-audit --strict-env` avant prod avec secrets chargés
- `npm run build`
- `npm run preflight:client -- atelier-audit --with-open-next-build`

Secrets obligatoires en production:
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `RESEND_API_KEY`
- `RESEND_FROM_ADDRESS`
- `CRON_SECRET`
- `MEMBER_SESSION_SECRET`
- `RATE_LIMIT_SECRET`

Règles:
- `RATE_LIMIT_SECRET` doit être unique et distinct de `SUPABASE_SERVICE_ROLE_KEY`;
- `CRON_SECRET` et `MEMBER_SESSION_SECRET` doivent être uniques par instance client;
- ne jamais exposer `SERVICE_ROLE_KEY` au navigateur;
- conserver `keep_vars=true` côté Wrangler et injecter les secrets via Cloudflare.

## Risques Résiduels

- Le build OpenNext/Cloudflare doit être validé localement ou en CI avec les bons secrets.
- Les tokens publics historiques de signature ne sont pas expirés pour préserver les liens envoyés; une politique d'expiration peut être ajoutée plus tard avec migration et communication client.
- La CSP reste permissive sur scripts inline/eval; non bloquant aujourd'hui, mais à durcir quand Next/react-pdf le permettent.
- Les quotas IA sont calculés via lecture des logs mensuels; acceptable au volume actuel, mais à remplacer par compteur atomique si forte charge.
