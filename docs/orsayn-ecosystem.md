# **Orsayn Ecosystem — SOP Transversal**

## **Vision**

Orsayn construit un écosystème d'apps et d'agents IA déployables en trois modes :

MODES DE DÉPLOIEMENT  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
Per-client (instance dédiée)  
  → Une instance = un client, variables d'env isolées  
  → Ex. : Atelier (BTP), futur projet médecins, futur projet e-com  
  → Isolation totale : BDD séparée, domaine séparé, clés séparées

SaaS classique (multi-tenant)  
  → Une instance = tous les clients, isolation par RLS + org_id  
  → Ex. : SaaS PME généraliste, outil abonnement B2C

AaaS — Agentic as a Service  
  → Agents IA exposés en API ou en interface, consommés par des tiers  
  → Ex. : agent de devis automatique, agent de relance, agent de synthèse  
  → Peut être standalone ou embarqué dans une app per-client ou SaaS

Cockpit Opérateur (transversal)  
  → Agrège les events de toutes les instances (coûts IA, activité, alertes)  
  → Projet Supabase séparé — RBAC opérateur isolé du RBAC tenant

---

## **Stack commune à tous les projets Orsayn**

INVARIANTS TECHNIQUES  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
Framework     : Next.js (App Router) + TypeScript strict  
BDD           : Supabase (Postgres + RLS + Auth)  
Déploiement   : Cloudflare (Workers + Pages) via open-next  
Styles        : Tailwind CSS  
Auth          : Supabase Auth (SSR pattern, httpOnly cookies)  
IA            : OpenRouter (LLM) + Mistral (audio/transcription)  
Email         : Resend (transactionnel) + templates per-tenant  
PDF           : @react-pdf/renderer (rendu) + pdf-lib (manipulation)  
Storage       : Supabase Storage (signed URLs, magic bytes validés)  
Monitoring    : Sentry (exceptions + replays)  
Tests         : Vitest (unitaires) + Playwright (E2E selon criticité)

CONVENTIONS DE NOMMAGE (toujours respectées)  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
Tables BDD          : snake_case, pluriel (invoices, organization_members)  
Fonctions /lib/     : camelCase verbe + nom (getInvoiceById, sendEmail)  
Server Actions      : camelCase, fichier par domaine (mutations/invoices.ts)  
Routes API          : kebab-case (/api/cron/recurring-invoices)  
Variables d'env     : SCREAMING_SNAKE_CASE, préfixe NEXT_PUBLIC_ si client
Migrations          : NNN_description.sql numérotation séquentielle (001_, 002_…)  
Composants React    : PascalCase (InvoicePDF, QuoteCard)

---

## **Variables d'env communes (template)**

Toutes les apps Orsayn partagent ce socle. Les variables marquées [PER-CLIENT] changent par instance.

```
# ─── Supabase ────────────────────────────────────────────────────────────────
NEXT_PUBLIC_SUPABASE_URL=          [PER-CLIENT]
NEXT_PUBLIC_SUPABASE_ANON_KEY=     [PER-CLIENT]
SUPABASE_SERVICE_ROLE_KEY=         [PER-CLIENT] — jamais côté client

# ─── App ─────────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL=               [PER-CLIENT]  ex. https://app.client.fr
NEXT_PUBLIC_APP_NAME=              [PER-CLIENT]  ex. "Atelier BTP"

# ─── IA ──────────────────────────────────────────────────────────────────────
OPENROUTER_API_KEY=                partagée ou per-client selon budget
MISTRAL_API_KEY=                   idem

# ─── Email ───────────────────────────────────────────────────────────────────
RESEND_API_KEY=                    [PER-CLIENT] ou partagée (sender domain)
RESEND_FROM_EMAIL=                 ex. "Atelier <contact@atelier-xyz.fr>"

# ─── Cron ────────────────────────────────────────────────────────────────────
CRON_SECRET=                       [PER-CLIENT] 128-bit aléatoire

# ─── Cockpit opérateur (optionnel) ───────────────────────────────────────────
OPERATOR_MODE=                     true | false
OPERATOR_INGEST_URL=               URL du cockpit central
OPERATOR_INGEST_SECRET=            [PER-CLIENT] secret HMAC partagé avec le cockpit
```

---

## **Architecture /lib/ standard Orsayn**

Toutes les apps suivent la même structure. Ce qui change entre projets = le contenu des dossiers, pas leur organisation.

```
/lib/
  supabase/
    client.ts      → createClient (browser)
    server.ts      → createServerClient (SSR, cookies)
    admin.ts       → createAdminClient (service_role — jamais côté client)
    operator.ts    → createOperatorAdminClient (cockpit, si OPERATOR_MODE)
  auth/
    session.ts     → getCurrentUser(), getCurrentOrganizationId()
    permissions.ts → checkPermission(userId, orgId, action)
  data/
    types.ts       → DbResult<T> + types générés depuis Supabase
    queries/       → lectures par domaine
    mutations/     → écritures par domaine (Server Actions uniquement)
  ai/
    callAI.ts      → wrapper LLM (feature gating + usage log + cockpit sync)
    prompts/       → un fichier par cas d'usage, jamais inline
  email/
    index.ts       → sendEmail()
    templates.ts   → DEFAULT_EMAIL_TEMPLATES + interpolation
  pdf/             → si génération PDF (render + manipulation)
  providers/       → adapters intégrations tierces (paiement, messaging…)
  features.ts      → isFeatureEnabled(orgId, featureKey)
  config.ts        → getTenantConfig(orgId, key, fallback)
  archive.ts       → archiveDocument() — si compliance légale
  utils.ts         → fonctions pures sans effet de bord
  validations/     → tous les schémas Zod
```

---

## **Matrice des verticales Orsayn**

Pour chaque nouvelle verticale, l'agent identifie le profil et active les domaines correspondants du SOP backend (docs/expert-backend.md).

VERTICALE → PROFIL BACKEND → SPÉCIFICITÉS  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**BTP / Artisan / Tôlerie** (ex. Atelier)  
Profil : App/SaaS + Compliance (facturation légale FR)  
Spécificités : Factur-X EN 16931, numérotation séquentielle, RCP assurance, plannings chantier, relances B2B  
Modules IA typiques : devis auto, estimation main d'œuvre, relances, récapitulatifs chantier  
Compliance : Domaine 15 obligatoire (factures = documents légaux)

**Santé / Médecins / Cabinets**  
Profil : App/SaaS + Compliance (RGPD santé, HDS si hébergement données de santé)  
Spécificités : Données de santé = catégorie spéciale RGPD, HDS obligatoire si stockage, dossiers patients immuables, consentement traçable  
Modules IA typiques : synthèse consultation, aide à la rédaction, agenda intelligent  
Compliance : Domaine 15 renforcé (HDS) + audit log exhaustif + chiffrement au repos  
⚠️ Vérifier hébergement HDS avant toute collecte de données de santé

**E-commerce / Retail**  
Profil : App/SaaS + Intégrations tierces (paiement, logistique, CRM)  
Spécificités : Panier + commandes + stocks, passerelle paiement (Stripe), webhooks logistique, retours/remboursements  
Modules IA typiques : recommandations produits, chatbot support, analyse abandons panier  
Compliance : Domaine 15 (factures clients) + PCI-DSS si stockage CB (éviter — déléguer à Stripe)

**Agents IA / AaaS**  
Profil : Système IA/Automatisation (matrice expert-backend.md)  
Spécificités : Agents exposés en API, orchestration multi-LLM, mémoire vectorielle (RAG), outils (web, BDD, fichiers)  
Stack IA : OpenRouter (routing LLM) + Supabase pgvector (embeddings) + Mistral (audio)  
Modules : feature gating per-tenant, Zod sur sorties, rate-limit per-tenant, usage log  
Compliance : Domaine 15 si l'agent produit des documents légaux

**Immobilier / Gestion locative**  
Profil : App/SaaS + Compliance (baux = contrats légaux) + Intégrations (signatures électroniques)  
Spécificités : Baux immuables, quittances mensuelles, états des lieux, relances loyers  
Modules IA typiques : rédaction baux, analyse documents, alertes loyers  
Compliance : Domaine 15 (quittances + baux) + signatures électroniques (eIDAS)

---

## **SOP de démarrage d'un nouveau projet Orsayn**

À suivre à chaque nouveau projet. S'appuie sur les skills disponibles dans /docs/.

ÉTAPE 1 — Cadrage (30 min)  
  → Définir la verticale et le mode de déploiement (per-client / SaaS / AaaS)  
  → Remplir le calibrage expert-backend.md (8 questions)  
  → Identifier le profil backend et les domaines applicables  
  → Décider si compliance légale activée (Domaine 15)

ÉTAPE 2 — Scaffold  
  → Cloner le template Orsayn (si existant) ou créer un Next.js fresh  
  → Copier la structure /lib/ standard  
  → Configurer les variables d'env depuis le template ci-dessus  
  → Créer le projet Supabase (avec projet cockpit si OPERATOR_MODE)  
  → Migration 001 : extensions (uuid-ossp, pgvector si IA) + tables base (organizations, members, roles, permissions)

ÉTAPE 3 — Backend core (expert-backend.md Phase 1 → Phase 2)  
  → Suivre le plan backend généré par l'agent  
  → RLS sur toutes les tables dès la migration — jamais en rattrapage  
  → Domaine 15 si compliance détectée

ÉTAPE 4 — Features verticale  
  → Activer les modules IA selon la verticale (callAI.ts + org_features)  
  → Intégrations tierces via /lib/providers/  
  → Webhooks entrants via webhook_events + HMAC

ÉTAPE 5 — Avant déploiement  
  → Audit complet via prompt expert-backend.md  
  → Tests couvrant les modules ÉLEVÉ  
  → Secrets uniques par environnement (jamais de copier-coller staging → prod)  
  → Cockpit opérateur vérifié si OPERATOR_MODE=true

---

## **Règles transversales Orsayn (non négociables)**

1. **Stack commune** — pas de remplacement de Supabase, Next.js, Cloudflare sans décision explicite documentée  
2. **Isolation per-client** — en mode per-client, une instance n'a jamais accès aux données d'une autre  
3. **Cockpit séparé** — le projet Supabase du cockpit est toujours distinct des projets clients  
4. **Clé service_role** — jamais exposée côté client, jamais dans un log, jamais dans un chat  
5. **Zod en sortie IA** — tout résultat LLM est parsé par un schéma Zod avant insert BDD  
6. **timingSafeEqual partout** — tout secret partagé (cron, HMAC, API key) comparé via crypto  
7. **Compliance d'abord** — si une verticale touche à des données légales/santé/financières, Domaine 15 s'active avant de coder la première feature  
8. **Tests bloquants** — CI/CD bloque si un module ÉLEVÉ n'a pas de tests

---

## **Liens vers les autres skills**

- [docs/expert-backend.md](expert-backend.md) — SOP backend complet (17 domaines)  
- [docs/PROMPT-SYSTEM.md](PROMPT-SYSTEM.md) — architecture et stack du projet courant  
- [docs/DATA-MODEL.md](DATA-MODEL.md) — schéma BDD du projet courant  
- [docs/PRD.md](PRD.md) — features et priorités du projet courant  
