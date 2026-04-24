# SOP Déploiement — Nouveau client Atelier

> **Document vivant.** Toute nouvelle étape de déploiement doit être ajoutée ici immédiatement.
> Modèle : **1 Supabase + 1 déploiement Cloudflare Workers + 1 domaine** par client — données totalement isolées.

> **Outils connectés dans chaque session Claude :** Supabase MCP + Supabase CLI (`supabase login` fait) + `wrangler` authentifié → les étapes C1 à C10 sont entièrement automatiques, sans copier-coller.
> **Outils à connecter pour gagner encore :** Cloudflare API token → C3 (variables Cloudflare Workers) deviendrait automatique. Resend API → C2 (création domaine) deviendrait automatique.

---

## Architecture par client

```
Client BTP
  └── Supabase (DB + Auth + Storage + Edge Functions)  → données isolées
  └── Cloudflare Workers (Next.js via OpenNext)        → app full-stack
  └── Cloudflare Worker (cron relances auto)           → 8h chaque matin
  └── Resend (emails transactionnels)                  → devis, factures, invitations
  └── OpenRouter + Mistral (IA)                        → clés Atelier partagées (voir §IA)
  └── Domaine custom                                   → ~€10/an
```

---

## ─── 1 REPO GITHUB → N CLIENTS ────────────────────────────────────────────────

**Principe fondamental : le code ne change jamais selon le client. Seules les variables d'environnement changent.**

```
GitHub (1 seul repo)
    │
    ├── Push → Cloudflare Workers Builds compile OpenNext
    │
    ├── Atelier-Weber    → compile le code + injecte vars Weber    → app Weber
    ├── Atelier-Dupont   → compile le code + injecte vars Dupont   → app Dupont
    └── Atelier-Demo     → compile le code + injecte vars Demo     → app démo
```

**Ce que font les variables d'env :** Cloudflare injecte les variables propres à chaque Worker au runtime. Le code serveur et le navigateur lisent `SUPABASE_URL` et `SUPABASE_ANON_KEY` depuis la config runtime injectée par le layout. Un même bundle peut donc servir plusieurs clients sans rebuild spécifique.

```
Cloudflare Workers — Atelier-Weber
  SUPABASE_URL               = https://weber-ref.supabase.co    ← données Weber
  SUPABASE_ANON_KEY          = anon_weber
  SUPABASE_SERVICE_ROLE_KEY   = clé_weber
  RESEND_FROM_ADDRESS         = contact@weber-tolerie.fr          ← emails au nom de Weber

Cloudflare Workers — Atelier-Dupont
  SUPABASE_URL               = https://dupont-ref.supabase.co   ← données Dupont
  SUPABASE_ANON_KEY          = anon_dupont
  SUPABASE_SERVICE_ROLE_KEY   = clé_dupont
  RESEND_FROM_ADDRESS         = contact@dupont-btp.fr
```

**Ce que ça change quand tu pousses du code :**
- Un bugfix → tous les clients reçoivent le fix automatiquement en 2-3 min
- Une nouvelle feature → idem, mais si elle nécessite une migration SQL, tu l'appliques client par client

**Ce que tu ne fais jamais :** modifier le code "pour un seul client". La personnalisation par client se fait via des flags en base de données (`organizations` table), jamais dans le code.

**Ton `.env.local` (sur ta machine)** n'est jamais pushé sur GitHub (bloqué par `.gitignore`). Il reste utile pour le dev local, mais il n'a plus besoin d'être modifié pour déployer un client ou le cockpit.

---

## ─── PROTOCOLE DE SESSION ──────────────────────────────────────────────────────

> Quand tu demandes à Claude de déployer un nouveau client, donne-lui **uniquement ça** en début de session. Claude fait le reste.

```
Client : [Nom de l'entreprise]
Project ref Supabase : [ex: pyxnmohknxmbpbcuvudg]
SUPABASE_URL : https://[ref].supabase.co
ANON_KEY : eyJ...
SERVICE_ROLE_KEY : eyJ...
RESEND_API_KEY : re_...
Domaine : [ex: weber-tolerie.fr]
Nom affiché email : [ex: Weber Tôlerie]
Adresse email expéditeur : [ex: contact@weber-tolerie.fr]
CRON_SECRET : [laisser vide = Claude génère]
WhatsApp activé : oui / non
  → Si oui : Phone Number ID + Access Token Meta
```

---

## ─── PARTAGE DU TRAVAIL ─────────────────────────────────────────────────────────

### 🙋 TOI — Étapes manuelles (~35 min, une seule fois par client)

Ces étapes nécessitent une interface web ou une action humaine irremplaçable.

| # | Étape | Où | Durée | Pourquoi manuel |
|---|-------|----|-------|-----------------|
| T1 | Créer le projet Supabase (région `eu-west-1`) + copier les 3 clés | [supabase.com](https://supabase.com) → New project | 5 min | Pas d'API de création projet |
| T2 | Créer le compte Resend + ajouter le domaine + poser les records DNS chez le registrar | [resend.com](https://resend.com) → Domains | 15 min | DNS = action humaine chez le registrar |
| T3 | Lancer `./scripts/deploy-client.sh atelier-nomclient` depuis le terminal | Terminal | 2 min | Crée le Worker automatiquement au premier déploiement — le script patche wrangler.jsonc et restaure ensuite |
| T4 | Injecter les variables d'env dans Cloudflare Workers (voir tableau §4) | dash.cloudflare.com → Workers & Pages → le projet → Settings → Variables and Secrets | 5 min | ⚡ Devient automatique si Cloudflare API token fourni |
| T5 | Ajouter le domaine custom + pointer DNS | Cloudflare Workers → Domains & Routes | 3 min | Dépend de la propagation DNS |
| T6 | *(Si WhatsApp)* Créer l'app Meta, générer le token permanent | [developers.facebook.com](https://developers.facebook.com) | 20 min | Formulaire Meta, pas d'API publique |
| T7 | Onboarding owner : créer le compte, remplir les infos entreprise | App en production | 10 min | Action du client final |

**À faire une seule fois sur ta machine (déjà fait) :**
```bash
supabase login                        # débloque C1, C5, C6
wrangler login                        # débloque T3, C7
npm install -g wrangler               # déjà fait
npm install -g @opennextjs/cloudflare # déjà fait
```

**Pour rendre T4 automatique (optionnel) :**
Créer un token API Cloudflare avec scope `Workers Scripts:Edit` → me le donner dans le protocole → je peux injecter les variables via l'API Cloudflare sans navigateur.

---

### 🤖 CLAUDE — Étapes automatisées (~10 min)

Dès que tu m'as donné les infos du protocole de session, je fais tout ça sans intervention.

| # | Étape | Outil | Prérequis |
|---|-------|-------|-----------|
| C1 | Appliquer toutes les migrations SQL du repo dans l'ordre | `supabase db push` | `supabase login` ✅ |
| C2 | Créer les 4 buckets Storage + RLS (`logos`, `chantier-photos`, `quote-attachments`, `organization-exports`) | Supabase MCP | MCP connecté ✅ |
| C3 | Configurer Auth Supabase (Site URL + Redirect URLs + OTP) | Supabase MCP | MCP connecté ✅ |
| C4 | Générer un `CRON_SECRET` unique si non fourni | Terminal (`openssl`) | — |
| C5 | Déployer la Edge Function `whatsapp-webhook` | `supabase functions deploy` | `supabase login` ✅ |
| C6 | Injecter les 5 secrets Edge Function (`OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `APP_URL`) | `./scripts/deploy-edge-functions.sh` | `supabase login` ✅ |
| C7 | Déployer le Cloudflare Worker relances + injecter `APP_URL` + `CRON_SECRET` | `wrangler deploy` | `wrangler login` ✅ |
| C8 | Peupler `company_memory` avec le contexte de l'entretien client | Supabase MCP | MCP connecté ✅ |
| C9 | Vérifier migrations, permissions, buckets | Supabase MCP | MCP connecté ✅ |
| C10 | Afficher récapitulatif final + URL webhook Meta | — | — |

**Note C4 (variables Cloudflare Workers) :** actuellement T4 est manuel. Si tu fournis un `CLOUDFLARE_API_TOKEN` dans le protocole, je peux aussi injecter les variables via l'API Cloudflare (`curl`), éliminant T4.

---

## ─── DÉTAIL TECHNIQUE ───────────────────────────────────────────────────────────

> Cette section est la référence. Elle sert aussi à Claude pour connaître exactement quoi faire.

### 1. Migrations SQL — historique exact du repo

```
001_extensions.sql
002_core_tables.sql
003_catalog_tables.sql
004_business_tables.sql
005_advanced_tables.sql
006_functions.sql
007_triggers.sql
008_rls.sql
009_indexes.sql
010_seed_permissions.sql            ← CRITIQUE : avant le 1er signup
011_fix_invited_user_trigger.sql
012_email_settings.sql
013_currency_and_quote_requests.sql
014_client_locale.sql
015_quote_item_internal.sql        ← Lignes internes invisibles client sur devis
016_quote_signature.sql
017_auto_reminders.sql
018_facturx_prep.sql
019_reminder_hour.sql
020_quote_item_dimensions.sql
021_auto_quote_number_trigger.sql
022_organizations_missing_columns.sql
023_organization_payment_info.sql
024_facturation_electronique_2026.sql
025_fix_number_format_3digits.sql
026_auto_invoice_number_trigger.sql  ← CRITIQUE : sans ça, créer une facture → erreur 400
027_vat_config.sql
028_acomptes.sql
029_chantiers.sql
030_chantiers_equipes.sql
031_chantiers_taches_notes.sql
032_chantier_planning.sql
033_fix_client_totals_trigger.sql
034_chantier_contact.sql
035_client_contact_name.sql         ← Contact référent pour les clients pros
036_quote_requests_v2.sql
037_quote_requests_address.sql
038_whatsapp_agent.sql              ← Agent WhatsApp (whatsapp_configs + whatsapp_messages)
039_prestation_types.sql            ← Prestations types catalogue (CRUD + intégration éditeur devis)
040_prestation_type_items.sql       ← Composition détaillée des prestations types
041_prestation_sections.sql         ← Sections dans les prestations types
042_invoice_item_internal.sql       ← Lignes internes invisibles client sur factures
043_logos_storage_policies.sql      ← Politiques storage logos
044_recalc_quote_totals_exclude_internal.sql ← Totaux devis hors lignes internes
045_fix_client_total_revenue.sql    ← Correctif agrégats client
046_chantier_duration_slots.sql     ← Durées multiples sur récurrences chantier
047_catalog_dimension_pricing.sql   ← Catalogue article/service + tarification dimensionnelle
048_catalog_dimension_modes.sql     ← Modes dimensionnels linear/area/volume + hauteur
049_catalog_business_profiles.sql   ← Contexte catalogue par profil métier
050_catalog_activity_services_variants.sql ← Activité métier explicite + variantes tarifaires + lignes service
051_invoice_item_material_id.sql           ← Référence matériau catalogue sur lignes de facture (recalcul prix dimensionnel)
052_quote_client_request_description.sql   ← Description originale client (formulaire public) stockée sur le devis
053_organization_exports.sql               ← Table organization_exports + bucket privé pour exports de réversibilité owner-only
054_quote_attachments_public_upload.sql    ← Politiques RLS storage quote-attachments (upload anonyme formulaire public)
055_organization_modules_usage_logs.sql    ← Config modules IA par org + journal usage_logs (gating, billing, sync opérateur)
```

Note historique :
- l'ancien `035b_quote_item_internal.sql` a été renommé `015_quote_item_internal.sql` (Supabase CLI exige des versions purement numériques pour `migration repair`)
- ne **jamais** lancer `supabase db pull` sur ce repo : la source de vérité du schéma est cette séquence numérotée, pas le distant. Un pull génère un baseline timestampé et déplace ces fichiers dans `migrations_legacy/`, ce qui casse la procédure de déploiement per-client.
- si un client a déjà un historique Supabase ancien, relancer `supabase db push` pour obtenir une nouvelle proposition de `migration repair` alignée sur ces noms

**Vérification :** `SELECT count(*) FROM permissions` → doit retourner 48.

### 1.b Redéploiement client existant

Quand une feature ajoute une migration après la mise en prod initiale, il faut la pousser sur **chaque Supabase client** avant de tester l'interface.

Ordre recommandé :
1. Vérifier les migrations locales disponibles : `ls supabase/migrations`
2. Se connecter au bon projet client : `supabase link --project-ref <PROJECT_REF>`
3. Appliquer les migrations en attente : `supabase db push`
4. Si la release touche une Edge Function ou un Worker, relancer aussi les déploiements correspondants
5. Ouvrir l'app du client et tester la feature qui dépend de la migration

Pour la release actuelle, les migrations supplémentaires à appliquer chez les clients existants sont :
- `048_catalog_dimension_modes.sql`
- `049_catalog_business_profiles.sql`
- `050_catalog_activity_services_variants.sql`
- `053_organization_exports.sql`
- `055_organization_modules_usage_logs.sql`

Effets de ces migrations :
- `048` : modes dimensionnels `linear`, `area`, `volume` et ajout de `height_m`
- `049` : configuration catalogue contextualisée par profil métier sur `organizations`
- `050` :
  - ajout de `organizations.business_activity_id`
  - ajout de `materials.dimension_schema`
  - création de `material_price_variants`
  - extension des prestations types avec `item_type = 'service'`
  - stockage des dimensions/variantes résolues sur devis, factures, récurrents et prestations types
- `053` :
  - création de `organization_exports`
  - création du bucket privé `organization-exports`
  - traçabilité des exports owner-only de réversibilité
- `055` :
  - création de `organization_modules` (config modules IA par org : `quote_ai`, `planning_ai`, `document_ai`, `whatsapp_agent`)
  - création de `usage_logs` (journal de chaque appel IA : provider, feature, tokens, coût, statut sync opérateur)
  - toutes les features IA passent désormais par `callAI.ts` qui vérifie le module avant d'appeler le provider

Impact déploiement :
- obligatoire avant d'utiliser les nouveaux champs catalogue, les variantes tarifaires et le contexte par activité
- obligatoire avant d'utiliser l'export complet owner-only dans `Settings > Données & confidentialité`
- obligatoire avant tout appel IA en production (`callAI.ts` lit `organization_modules` — sans la table, toutes les features IA échouent)
- ajouter les 3 variables opérateur dans Cloudflare Workers pour activer la sync vers le cockpit (voir §3)
- après migration, vérifier rapidement dans l'app :
  - Settings → activité métier bien sélectionnée
  - Catalogue → création/édition produit/service OK
  - Catalogue → variantes tarifaires enregistrables
  - Formulaire public → affichage correct des produits/services configurés
  - Settings → Données & confidentialité → génération d'un export complet OK
  - Settings → Modules → modules IA visibles et activables

### 2. Buckets Storage

| Nom | Public | Usage | RLS |
|-----|--------|-------|-----|
| `logos` | ✅ | Logos entreprise | Lecture publique |
| `chantier-photos` | ❌ | Photos chantiers | Auth + org uniquement |
| `quote-attachments` | ❌ | PJ formulaire public / demandes de devis | Auth + org uniquement |
| `organization-exports` | ❌ | Archives ZIP de réversibilité | Privé + liens signés owner-only |

SQL RLS `chantier-photos` (appliqué par Claude en C2) :
```sql
CREATE POLICY "chantier_photos_read" ON storage.objects
  FOR SELECT USING (bucket_id = 'chantier-photos' AND auth.role() = 'authenticated');
CREATE POLICY "chantier_photos_insert" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'chantier-photos' AND auth.role() = 'authenticated');
CREATE POLICY "chantier_photos_delete" ON storage.objects
  FOR DELETE USING (bucket_id = 'chantier-photos' AND auth.role() = 'authenticated');
```

### 3. Variables d'environnement (Cloudflare Workers)

```env
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=https://domaine-du-client.fr
RESEND_API_KEY=re_...
RESEND_FROM_ADDRESS=noreply@domaine-du-client.fr
RESEND_FROM_NAME=Dupont BTP
NEXT_PUBLIC_LEGAL_PUBLISHER_NAME=Orsayn
NEXT_PUBLIC_LEGAL_COMPANY_NAME=...
NEXT_PUBLIC_LEGAL_ADDRESS=...
NEXT_PUBLIC_LEGAL_PHONE=...
NEXT_PUBLIC_LEGAL_REGISTRATION=...
NEXT_PUBLIC_LEGAL_VAT_NUMBER=
NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR=...
NEXT_PUBLIC_LEGAL_HOSTING_PROVIDER=Cloudflare, Inc.
NEXT_PUBLIC_LEGAL_HOSTING_WEBSITE=https://www.cloudflare.com
NEXT_PUBLIC_SUPPORT_EMAIL=...
NEXT_PUBLIC_PRIVACY_EMAIL=...
NEXT_PUBLIC_LEGAL_EMAIL=...
OPENROUTER_API_KEY=sk-or-...          ← clé Atelier partagée
MISTRAL_API_KEY=...                    ← clé Atelier partagée
CRON_SECRET=...                        ← unique par client (openssl rand -hex 32)
OPERATOR_INGEST_URL=https://cockpit.orsayn.fr/api/operator/ingest  ← URL du cockpit Orsayn
OPERATOR_INGEST_SECRET=...             ← secret HMAC partagé (identique sur toutes les instances + cockpit)
OPERATOR_SOURCE_INSTANCE=nom-client   ← identifiant du client dans le cockpit (ex: maconnerie-durand)
```

> **Note :** les 3 variables `OPERATOR_*` sont optionnelles. Sans elles, les appels IA fonctionnent normalement mais les coûts ne remontent pas au cockpit (`operator_sync_status = 'skipped'` dans `usage_logs`).

**Note :** les variables `NEXT_PUBLIC_LEGAL_*` et `NEXT_PUBLIC_*EMAIL` servent aux pages publiques `privacy`, `terms`, `legal`
et devront être reprises telles quelles sur la future landing pour garder un wording cohérent.

### 4. Cloudflare Workers / OpenNext — configuration repo

Fichiers clés dans le repo :
- `open-next.config.ts` — config OpenNext 1.x (wrapper cloudflare-node, edge externals)
- `wrangler.jsonc` — config Wrangler (name, main, assets, nodejs_compat)
- `scripts/patch-worker.mjs` — retire l'import `cloudflare/images.js` du worker généré (requiert le plan Cloudflare payant, inutile pour cette app)
- `next.config.mjs` — `images: { unoptimized: true }` (désactive l'optimisation Next.js, incompatible avec le plan gratuit)

#### Prérequis outils (une fois sur ta machine)
```bash
npm install -g wrangler
npm install -g @opennextjs/cloudflare
wrangler login   # authentifie vers ton compte Cloudflare
```

#### Déployer un client

```bash
# Déployer UN client (premier déploiement ou mise à jour)
./scripts/deploy-client.sh atelier-weber

# Mettre à jour TOUS les clients en une commande
./scripts/deploy-all-clients.sh
```

- `deploy-client.sh` : patche temporairement `wrangler.jsonc` avec le bon `name`, lance `npm run deploy`, puis restaure. Pas besoin de modifier le fichier à la main.
- `deploy-all-clients.sh` : lit `scripts/clients.txt` (un worker-name par ligne) et déploie chacun séquentiellement. Affiche un résumé succès/échec à la fin.
- Ajouter chaque nouveau client dans `scripts/clients.txt` pour l'inclure dans les mises à jour futures.

#### Variables d'environnement

À injecter dans Cloudflare Dashboard → Workers & Pages → le projet → Settings → Variables and Secrets :

| Type | Variables |
|------|-----------|
| **Secret** | `OPERATOR_INGEST_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `CRON_SECRET` |
| **Text** | `OPERATOR_MODE`, `OPERATOR_ALLOWED_EMAILS`, `OPERATOR_SUPABASE_URL`, `OPERATOR_USD_TO_EUR_RATE`, `SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`, `OPERATOR_INGEST_URL`, `OPERATOR_SOURCE_INSTANCE` et toutes les `NEXT_PUBLIC_LEGAL_*` |

> **Important :** déconnecter le repo GitHub du projet Cloudflare Pages après le premier déploiement manuel — sinon chaque push GitHub déclenche un build automatique qui échoue (next-on-pages n'est plus utilisé).

### 5. Cloudflare Worker — relances automatiques

Script de déploiement (lancé par Claude via terminal) :
```bash
cd workers/auto-reminder
wrangler secret put APP_URL          # → https://domaine-du-client.fr
wrangler secret put CRON_SECRET      # → même valeur que dans l'app Workers
wrangler deploy
```

Cron : `0 7 * * *` (8h Paris hiver, 9h été) — défini dans `wrangler.toml`.

> **Prérequis critique :** `OPENROUTER_API_KEY` doit être injectée dans les variables Cloudflare Workers de l'app (voir §3). Le Worker appelle `/api/cron/auto-reminders` sur l'app, qui génère chaque email via l'IA. Si cette clé est absente ou invalide, **aucune relance ne part** (échec silencieux côté cron). C'est la clé Atelier partagée — elle est déjà dans ton `.env.local`.

### 6. Edge Function WhatsApp

Script automatisé (lancé par Claude via terminal) :
```bash
./scripts/deploy-edge-functions.sh <PROJECT_REF>
```

Ce script déploie `whatsapp-webhook` et injecte automatiquement tous les secrets depuis `.env.local` :

```bash
./scripts/deploy-edge-functions.sh <PROJECT_REF>
# Injecte : OPENROUTER_API_KEY, MISTRAL_API_KEY, RESEND_API_KEY, RESEND_FROM_EMAIL, APP_URL
```

`APP_URL` est requis pour les liens PDF dans les emails envoyés depuis WhatsApp (`send_quote`, `send_invoice`).

URL webhook à configurer dans Meta :
```
https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook
```

Le Verify Token est généré automatiquement dans **Settings → Agent WhatsApp** de l'app.

**Mise à jour code** (quand la Edge Function évolue) :
```bash
# Un client
./scripts/deploy-edge-functions.sh <ref>

# Tous les clients
for ref in ref1 ref2 ref3; do ./scripts/deploy-edge-functions.sh $ref; done
```

### 7. Company Memory — contexte IA (rempli par Claude après l'entretien)

```sql
INSERT INTO company_memory (organization_id, category, title, content) VALUES
  ('<org_id>', 'profil',   'Profil entreprise',           'Corps de métier, zone géo, taille équipe…'),
  ('<org_id>', 'tarifs',   'Taux et marges habituels',    'Taux horaires, marges matériaux, TVA selon travaux…'),
  ('<org_id>', 'clients',  'Typologie clients',           'Particuliers / pros / promoteurs…'),
  ('<org_id>', 'process',  'Process interne',             'Délais, conditions paiement, acomptes pratiqués…'),
  ('<org_id>', 'contexte', 'Objectifs et points douleur', 'Ce que le client veut améliorer…');
```

### 8. Lien formulaire public

```
https://domaine-du-client.fr/demande/<org-slug>
```

Slug : `SELECT slug FROM organizations` — généré à l'onboarding depuis le nom de l'entreprise.
Activer dans **Settings → Formulaire public** + sélectionner les prestations catalogue.

---

## ─── CHECKLISTS ─────────────────────────────────────────────────────────────────

### Checklist technique (Claude vérifie en C9)

- [ ] `SELECT count(*) FROM permissions` → 48 lignes
- [ ] `SELECT count(*) FROM storage.buckets` → 4 buckets
- [ ] Auth Supabase configurée (Site URL + Redirect URLs)
- [ ] Edge Function `whatsapp-webhook` déployée
- [ ] Worker Cloudflare déployé + cron actif
- [ ] Variables d'env injectées dans Cloudflare Workers

### Checklist fonctionnelle (à tester manuellement après go-live)

- [ ] Onboarding owner → 3 étapes → organisation créée
- [ ] Code entreprise visible dans Paramètres → Équipe
- [ ] Invitation email équipe fonctionne
- [ ] Créer un devis → numéro `DEV-XXXX-001` généré
- [ ] Créer une facture → numéro `FAC-XXXX-001` généré
- [ ] Upload photo chantier → visible dans la grille
- [ ] Résumé "Ma semaine" → répond en < 3s
- [ ] Relance IA → modal s'ouvre + brouillon généré
- [ ] *(Si WhatsApp)* Envoyer "bonjour" → agent répond en < 5s

---

## ─── COCKPIT ORSAYN (déploiement unique, une seule fois) ────────────────────────

> Le cockpit est **ton** tableau de bord privé. Il tourne sur un déploiement Cloudflare Workers séparé, connecté à son propre projet Supabase. Il n'a rien à voir avec les instances clientes.

### Ce qu'il faut faire une fois

**T-O1 — Créer le projet Supabase opérateur**
- Nouveau projet Supabase (ex: `orsayn-operator`) dans la même région
- Appliquer `supabase/operator-migrations/001_operator_usage.sql`
- Puis appliquer `supabase/operator-migrations/002_operator_client_settings.sql`
- Récupérer l'URL et la service role key

**T-O2 — Déployer le cockpit sur Cloudflare Workers**
- Même repo GitHub, nouveau projet Cloudflare Workers (ex: `atelier-orsayn`)
- Même `wrangler.jsonc` que les instances clientes : seule la variable d'environnement change
- Variables d'environnement spécifiques au cockpit :

```env
OPERATOR_MODE=true
OPERATOR_INGEST_SECRET=...                   ← même secret que sur les instances clientes
OPERATOR_ALLOWED_EMAILS=mbebourasam@gmail.com
OPERATOR_SUPABASE_URL=https://<operateur-ref>.supabase.co
OPERATOR_SUPABASE_SERVICE_ROLE_KEY=eyJ...    ← service role du Supabase opérateur
OPERATOR_USD_TO_EUR_RATE=0.92                ← taux fixe V1 pour marge et synthèse globale

# Variables Supabase standard (pour l'auth de la page /orsayn)
SUPABASE_URL=https://<operateur-ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_APP_URL=https://cockpit.orsayn.fr
```

> **Important :** ne pas mettre `OPERATOR_MODE=true` sur les instances clientes — ça activerait l'endpoint d'ingestion et la page cockpit chez le client.

**T-O3 — Domaine custom**
- Ajouter `cockpit.orsayn.fr` dans Cloudflare Workers → Domains & Routes
- C'est l'URL à renseigner dans `OPERATOR_INGEST_URL` sur toutes les instances clientes

### Accès au cockpit

URL : `https://cockpit.orsayn.fr/orsayn`
Connexion avec le compte Supabase opérateur dont l'email est dans `OPERATOR_ALLOWED_EMAILS`.

### Checklist cockpit

- [ ] `001_operator_usage.sql` + `002_operator_client_settings.sql` appliqués sur le Supabase opérateur
- [ ] 4 tables créées : `operator_clients`, `operator_usage_events`, `operator_whatsapp_cost_snapshots`, `operator_client_settings`
- [ ] Variables d'env cockpit injectées dans Cloudflare Workers
- [ ] Page `/orsayn` accessible (renvoie 404 sinon → `OPERATOR_MODE` non reconnu)
- [ ] Envoyer un appel IA de test depuis une instance cliente → vérifier que l'event apparaît dans le cockpit
- [ ] Renseigner un `monthly_fee_ht` dans le cockpit → vérifier le calcul de marge

---

## ─── FACTURATION ÉLECTRONIQUE 2026 ─────────────────────────────────────────────

> Obligatoire : réception sept. 2026 / émission sept. 2027 (TPE/PME/artisans).

**Stratégie Atelier :** SC connectée à B2Brouter (PA agréée). 1 clé API par client.

### Checklist par client (avant sept. 2026)

- [ ] Ouvrir compte sandbox B2Brouter (gratuit jusqu'au 31/08/2026)
- [ ] Renseigner IBAN/BIC dans Settings → Paiement & RIB
- [ ] Renseigner SIREN sur chaque fiche client

### Checklist de dev (non bloquant avant 2026)

- [ ] `src/lib/facturx/generator.ts` — génération Factur-X EN 16931
- [ ] SIREN dans fiche client (UI + PDF)
- [ ] Type opération + TVA débits dans éditeur facture
- [ ] `POST /api/webhooks/pa-reception` → `received_invoices`
- [ ] UI factures reçues dans Finances
- [ ] Émission via API B2Brouter

---

## ─── COÛTS & RENTABILITÉ ────────────────────────────────────────────────────────

### Infrastructure par client

| Service | Gratuit jusqu'à | Coût payant |
|---------|----------------|-------------|
| Supabase | 500MB DB, 1GB storage, 50k MAU | Pro $25/mois |
| Cloudflare Workers (app Next.js) | 100k req/jour **partagées sur tous les Workers** (~400 clients actifs) | $5/mois illimité |
| Cloudflare Worker (cron) | inclus dans les 100k req/jour | $5/mois illimité |
| Resend | 3 000 emails/mois | $20/mois |
| Domaine custom | — | ~€10/an |

### IA — Stratégie clés OpenRouter + Mistral

#### Clé partagée ou clé par client ?

**Court terme (< 10 clients) → clé Atelier partagée + logging en DB**

1 seule clé OpenRouter et 1 seule clé Mistral, injectées dans toutes les Edge Functions et Workers. Tu portes le coût IA et tu le répercutes dans ton abonnement.

Avantage : zéro gestion. Inconvénient : si la clé est compromise, tous les clients sont touchés.

**Suivi de consommation par client :** chaque appel IA logge dans `activity_log` avec `organization_id`. Tu peux donc requêter :
```sql
SELECT organization_id, count(*) as appels, sum(metadata->>'tokens') as tokens
FROM activity_log
WHERE action LIKE 'ai_%' AND created_at > now() - interval '30 days'
GROUP BY organization_id;
```

**Long terme (> 10 clients) → clé par client**

Chaque client crée son propre compte OpenRouter, tu injectes SA clé dans SON déploiement Cloudflare Workers et SON Edge Function. Il paye directement OpenRouter — tu n'es plus revendeur IA. Plus simple à facturer, risque isolé par client.

La migration est simple : changer `OPENROUTER_API_KEY` dans les variables Cloudflare Workers + redéployer l'Edge Function.

**Aujourd'hui :** clé Atelier partagée. Variable `OPENROUTER_API_KEY` marquée "Oui (partagée)" dans le tableau ci-dessous.

#### Inventaire complet des appels IA

| Fonctionnalité | Fichier | Modèle | Coût unitaire estimé |
|----------------|---------|--------|----------------------|
| Relances auto (cron) | `api/cron/auto-reminders` | Claude Haiku 4.5 | ~€0,001/relance |
| Brouillon email relance (modal) | `mutations/ai-summary` | Claude Haiku 4.5 | ~€0,001/brouillon |
| Intro email rapport chantier | `mutations/chantier-report-email` | Claude Haiku 4.5 | ~€0,001/email |
| Résumé "Ma semaine" | `mutations/ai-summary` | Claude Sonnet 4.5 | ~€0,02/résumé |
| Planification semaine IA | `mutations/planning` | Claude Sonnet 4.6 | ~€0,02/planning |
| Analyse devis (texte/image) | `api/ai/analyze-quote` | Gemini 2.5 Flash Lite | ~€0,001/devis |
| Estimation main d'oeuvre | `api/ai/estimate-labor` | Gemini 2.5 Flash Lite | ~€0,001/req |
| Suggestions tâches | `api/ai/suggest-tasks` | Gemini 2.5 Flash Lite | ~€0,001/req |
| WhatsApp agent (texte + outils) | `functions/whatsapp-webhook` | Gemini 2.5 Flash (OpenRouter) | ~€0,003/message |
| Transcription vocale WhatsApp | `functions/whatsapp-webhook` | Voxtral Mini (Mistral) | ~€0,003/min |

#### Coût IA total estimé par profil / mois

| Profil | Hypothèses clés | Coût IA/mois |
|--------|----------------|--------------|
| **Démarrage** (pas WhatsApp) | 3 devis IA, 5 relances, 4 résumés semaine | ~€0,10 |
| **Standard** (WhatsApp activé) | 10 devis, 15 relances, 50 messages WA | ~€0,25 |
| **Actif + agents** (WA intensif) | 20 devis, 30 relances, 150 msg WA, 20 min vocal | ~€0,70 |
| **Gros client** (équipe + WA quotidien) | 40 devis, 60 relances, 300 msg WA, 60 min vocal | ~€1,30 |

> WhatsApp agent migré de Sonnet 4.6 → Gemini 2.5 Flash (7× moins cher, ~€0,003/message). Sans WhatsApp, le coût IA est inférieur à €0,20/mois. Levier restant si les marges se compriment : passer les relances auto de Haiku 4.5 → Gemini Flash Lite (divisé encore par 3).

### Marges selon le tier facturation électronique

Trois situations possibles — le tier est piloté par le flag `facturation_b2brouter` dans `organization_modules`.

#### Tier 1 — Sans facturation électronique (ou export only inclus dans l'abonnement)

Export only ne coûte rien de plus : c'est du code qui génère un XML. Tu peux l'inclure dans tous les abonnements dès maintenant sans impact sur tes marges, et en faire un argument commercial ("conforme sept. 2026 dès aujourd'hui").

| Profil | Coût infra+IA | Prix vente | Marge |
|--------|--------------|------------|-------|
| Démarrage | ~€1 | €49 | **98%** |
| Standard | ~€8 | €99 | **92%** |
| Actif + agents | ~€15 | €149 | **90%** |
| Gros client | ~€53 | €199 | **73%** |

#### Tier 2 — Export only explicite (si tu veux en faire un palier tarifaire distinct)

Même coût que Tier 1 — zéro surcoût B2Brouter. Marge identique. Utile si tu veux afficher un prix légèrement supérieur pour "pack conformité 2026" sans rien débourser de plus.

#### Tier 3 — B2Brouter intégré (`facturation_b2brouter: true`)

B2Brouter te coûte €29/mois/client (M1) + €150 d'activation one-shot. C'est là que le prix vente doit monter.

| Profil | Coût infra+IA+B2Brouter | Prix vente | Marge |
|--------|------------------------|------------|-------|
| Démarrage | ~€36 | €79 min ⚠️ | **54%** |
| Standard | ~€43 | €99 | **57%** |
| Actif + agents | ~€50 | €149 | **66%** |
| Gros client | ~€124 | €199 | **38%** |

> ⚠️ Démarrage avec B2Brouter : repositionner à **€79/mois min** dès activation.
> Dès passage TVA : coûts passent en HT → marges s'améliorent d'environ +10% sans toucher les prix.

**Résumé de la logique tarifaire :**
- Export only → inclure dans l'abonnement de base, argument commercial gratuit
- B2Brouter → facturer le surcoût (~€30-40/mois de plus selon profil) + €190 d'activation one-shot

### B2Brouter — grille tarifaire (HT)

| Tranche | Trans./mois | Activation | Prix/mois HT | Trans. suppl. |
|---------|-------------|------------|--------------|--------------|
| M1 | 100 | €150 | €29 | €0,435 |
| M2 | 300 | €150 | €59 | €0,295 |
| M3 | 600 | €150 | €89 | €0,222 |
| M4 | 1 500 | €150 | €169 | €0,169 |
| M5 | 4 000 | €150 | €269 | €0,101 |

Facturation annuelle et à l'avance. Transactions non consommées perdues à l'échéance.

### Revente B2Brouter — stratégie

Atelier préfinance, refacture avec ~20% de marge :

| Poste | Coût franchise TVA (TTC) | Refacturé client | Marge |
|-------|--------------------------|-----------------|-------|
| Activation | €180 TTC | €190 | €10 |
| Abonnement M1 / an | €417,60 TTC | €480 (€40/mois) | €62,40 |
| Abonnement M2 / an | €849,60 TTC | €960 (€80/mois) | €110,40 |

### Frais one-shot à l'onboarding

| Poste | Montant |
|-------|---------|
| Setup & déploiement | €300–500 |
| Activation B2Brouter (si fact. élec.) | €190 |
| Abonnement B2Brouter an 1 (M1) | €480 |
| **Total avec fact. élec.** | **~€970** |
| **Total sans fact. élec.** | **€300–500** |

---

## ─── VARIABLES PAR PROJET ───────────────────────────────────────────────────────

| Variable | Source | Partagée ? |
|----------|--------|-----------|
| `SUPABASE_URL` | Supabase → Settings → API | Non |
| `SUPABASE_ANON_KEY` | Supabase → Settings → API | Non |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API | Non |
| `NEXT_PUBLIC_APP_URL` | URL production client | Non |
| `RESEND_API_KEY` | Compte Resend client | Non |
| `RESEND_FROM_ADDRESS` | Email vérifié Resend (injecté en Edge Function sous `RESEND_FROM_EMAIL`) | Non |
| `RESEND_FROM_NAME` | Nom affiché expéditeur | Non |
| `NEXT_PUBLIC_LEGAL_PUBLISHER_NAME` | Marque / éditeur public | Non |
| `NEXT_PUBLIC_LEGAL_COMPANY_NAME` | Dénomination légale publique | Non |
| `NEXT_PUBLIC_LEGAL_ADDRESS` | Adresse publique éditeur | Non |
| `NEXT_PUBLIC_LEGAL_PHONE` | Téléphone public | Non |
| `NEXT_PUBLIC_LEGAL_REGISTRATION` | SIREN/SIRET/RCS affiché publiquement | Non |
| `NEXT_PUBLIC_LEGAL_VAT_NUMBER` | TVA intracom si applicable | Non |
| `NEXT_PUBLIC_LEGAL_PUBLICATION_DIRECTOR` | Directeur de la publication | Non |
| `NEXT_PUBLIC_LEGAL_HOSTING_PROVIDER` | Hébergeur public | Non |
| `NEXT_PUBLIC_LEGAL_HOSTING_WEBSITE` | Site de l’hébergeur | Non |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | Email support public | Non |
| `NEXT_PUBLIC_PRIVACY_EMAIL` | Email confidentialité public | Non |
| `NEXT_PUBLIC_LEGAL_EMAIL` | Email juridique public | Non |
| `OPENROUTER_API_KEY` | openrouter.ai/keys | **Oui** (clé Atelier) |
| `MISTRAL_API_KEY` | console.mistral.ai | **Oui** (clé Atelier) |
| `CRON_SECRET` | `openssl rand -hex 32` | Non (unique par client) |
| `OPERATOR_INGEST_URL` | URL du cockpit Orsayn | **Oui** (même URL partout) |
| `OPERATOR_INGEST_SECRET` | `openssl rand -hex 32` (généré une fois) | **Oui** (même secret partout) |
| `OPERATOR_SOURCE_INSTANCE` | Nom court du client (ex: `weber-demo`) | Non (unique par client) |

---

## ─── MAINTENANCE ────────────────────────────────────────────────────────────────

### Nouvelle migration SQL

1. Ajouter la ligne dans la liste "Migrations SQL" ci-dessus
2. L'appliquer sur tous les projets clients existants via Supabase MCP
3. Tenir à jour le registre des projets actifs (ci-dessous)
4. **Si la migration ajoute une table ou un champ exploitable par l'IA** (chantiers, devis, factures, acomptes, catalogue…) → mettre à jour les fichiers suivants :
   - `supabase/functions/whatsapp-webhook/index.ts` — outils TOOLS + requêtes executeTool
   - `src/app/api/ai/analyze-quote/` — si ça touche l'analyse de devis
   - `src/app/api/ai/suggest-tasks/` — si ça touche les tâches chantier
   - `src/app/api/cron/auto-reminders/` — si ça touche la relance ou les acomptes

### Mise à jour code — tous les clients

Quand tu pousses un bugfix ou une nouvelle feature sur GitHub, tu veux que tous les Workers clients reçoivent la mise à jour.

```bash
# Met à jour tous les clients listés dans scripts/clients.txt
./scripts/deploy-all-clients.sh
```

Le registre `scripts/clients.txt` contient un worker-name par ligne. Exemple :
```
orsayn-cockpit
atelier-weber
atelier-dupont
```

Ordre recommandé pour une release avec migration SQL :
1. Appliquer la migration sur chaque Supabase client (`supabase link --project-ref <ref> && supabase db push`)
2. Lancer `./scripts/deploy-all-clients.sh` pour déployer le code

> **Note :** les déploiements sont séquentiels (pas en parallèle). Pour ~10 clients, compter 3-4 min au total (build unique partagé entre tous les déploiements).

### Mise à jour Edge Function

```bash
for ref in <tous les refs clients>; do ./scripts/deploy-edge-functions.sh $ref; done
```

### Supabase Free — anti-pause

Projets Free se mettent en pause après 7 jours d'inactivité.
Créer un cron-job.org gratuit → ping `https://<ref>.supabase.co/rest/v1/` toutes les 48h.
→ Inutile dès que le client utilise l'app quotidiennement.

---

## ─── REGISTRE DES CLIENTS DÉPLOYÉS ─────────────────────────────────────────────

> Mettre à jour à chaque nouveau client.

| Client | Project Ref | Domaine | Déployé le | Migrations | WhatsApp | Fact. élec. |
|--------|-------------|---------|------------|------------|---------|------------|
| Weber Tôlerie (**démo**) | `pyxnmohknxmbpbcuvudg` | localhost | 2024 | 001→055 | ❌ | ❌ |
