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
  → Mode mutualisé (recommandé) : rien à fournir — routing automatique par numéro
  → Mode propre WABA : Phone Number ID + Access Token Meta (permanent)
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
| T4 | Injecter les variables d'env dans Cloudflare Workers (voir tableau §4) | dash.cloudflare.com → Workers & Pages → le projet → Settings → Variables and Secrets | 5 min | ⚡ Devient automatique si `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` fournis dans le protocole |
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

**Clés WABA mutualisées — à faire une seule fois avant le premier client WhatsApp :**
Une fois Meta approuvé, ajouter dans `.env.local` :
```
SHARED_WABA_PHONE_NUMBER_ID=<Phone Number ID du numéro bot Atelier>
SHARED_WABA_ACCESS_TOKEN=<Token permanent Meta>
NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER=+33...
```
→ `deploy-edge-functions.sh` les lit automatiquement pour tous les clients présents et futurs. Pas besoin d'y toucher à nouveau.

**Pour rendre T4 automatique (optionnel) :**
1. dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom Token
2. Scope : `Workers Scripts:Edit` (niveau Account)
3. Récupérer aussi ton `Account ID` (visible dans le sidebar Cloudflare → colonne droite)
4. Ajouter dans le protocole de session :
   ```
   CLOUDFLARE_API_TOKEN=<token>
   CLOUDFLARE_ACCOUNT_ID=<account_id>
   ```
5. Je prends en charge T4 entièrement via l'API Cloudflare — toutes les variables (secrets + texte) injectées sans navigateur.

---

### 🤖 CLAUDE — Étapes automatisées (~10 min)

Dès que tu m'as donné les infos du protocole de session, je fais tout ça sans intervention.

| # | Étape | Outil | Prérequis |
|---|-------|-------|-----------|
| C1 | Appliquer toutes les migrations SQL du repo dans l'ordre | `supabase db push` | `supabase login` ✅ |
| C2 | Créer les 4 buckets Storage + RLS (`logos`, `chantier-photos`, `quote-attachments`, `organization-exports`) | Supabase MCP | MCP connecté ✅ |
| C3 | Configurer Auth Supabase (Site URL + Redirect URLs + OTP) | Supabase MCP | MCP connecté ✅ |
| C4 | Générer un `CRON_SECRET` + un `MEMBER_SESSION_SECRET` uniques si non fournis | Terminal (`openssl rand -hex 32`) | — |
| C5 | Déployer la Edge Function `whatsapp-webhook` | `supabase functions deploy` | `supabase login` ✅ |
| C6 | Déployer la Edge Function + injecter les secrets (`OPENROUTER`, `MISTRAL`, `RESEND`, `APP_URL`, `SHARED_WABA_*`) | `./scripts/deploy-edge-functions.sh <ref> --resend-key ... --resend-from ... --app-url ...` | `supabase login` ✅ |
| C7 | Déployer le Cloudflare Worker relances + injecter `APP_URL` + `CRON_SECRET` | `wrangler deploy` | `wrangler login` ✅ |
| C8 | Peupler `company_memory` avec le contexte de l'entretien client | Supabase MCP | MCP connecté ✅ |
| C9 | Vérifier migrations, permissions, buckets | Supabase MCP | MCP connecté ✅ |
| C10 | Afficher récapitulatif final + URL webhook Meta | — | — |

**Note C4 (variables Cloudflare Workers) :** si `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` sont fournis dans le protocole, j'injecte toutes les variables via l'API Cloudflare (`curl`) — secrets ET variables texte — et T4 disparaît de ta liste.

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
056_invoice_balance_due_date.sql           ← Échéance du solde restant sur factures d'acompte (balance_due_date)
057_embedding_qwen3.sql                    ← Migration colonne embedding company_memory : 1536 → 4096 dims (Qwen3-Embedding-8B)
058_rag_function.sql                       ← Fonction SQL match_company_memory pour la recherche vectorielle RAG
059_whatsapp_shared_waba.sql               ← WABA mutualisée : phone_number_id/access_token optionnels + use_shared_waba + authorized_contacts JSONB[]
060_organization_deletion_workflow.sql     ← Workflow suppression organisation + export/offboarding
061_organization_email_signature_cgv.sql   ← Signature email + texte CGV + délai première relance (email_signature, cgv_text, reminder_first_delay_days)
062_default_permissions_overhaul.sql       ← Refonte permissions par défaut + fix get_user_org_id ORDER BY + team.view séparé
063_fix_profiles_rls.sql                   ← Correctif RLS table profiles
064_organization_decennale.sql             ← Garantie décennale structurée (champs assureur, numéro police, dates) — remplace le champ texte libre
065_organization_default_quote_validity.sql ← Durée de validité par défaut des devis par organisation (default_quote_validity_days, défaut 30j)
066_quote_invoice_aid.sql                  ← Aide/subvention déductible sur devis et factures (MaPrimeRénov, CEE…) — aid_label + aid_amount
067_chantier_costs.sql                     ← Rentabilité chantiers : table chantier_expenses + taux horaire org/membre + FK received_invoices→chantier
068_photo_report_flags.sql                 ← Photos chantier : include_in_report + shared_with_client_at
069_equipe_membre_taux_horaire.sql         ← Taux horaire override par membre d'équipe (chantier_equipe_membres.taux_horaire)
070_invoices_chantier_link.sql             ← Lien factures → chantier (rattachement explicite à un chantier source)
071_chantier_jalons.sql                    ← Jalons chantier (planned_date + status)
072_photo_title.sql                        ← Titre éditable sur chaque photo chantier
073_member_planning_and_expenses.sql       ← Membres individuels (sans équipe) + planning par membre + espace membre /mon-espace + rentabilité chantier enrichie (location secteur / transport carburant / lien catalogue)
074_suppliers_and_catalog_ai.sql           ← IA Catalogue : table suppliers + FK materials.supplier_id + module catalog_ai
075_chantier_target_margin.sql             ← Marge cible par chantier : target_margin_pct DECIMAL(5,2) DEFAULT 30 sur chantiers
076_equipment_amortissement.sql            ← Amortissement équipement catalogue / rentabilité
077_rate_limits.sql                        ← Rate limiting DB atomique pour formulaires publics et routes IA
```

Note historique :
- l'ancien `035b_quote_item_internal.sql` a été renommé `015_quote_item_internal.sql` (Supabase CLI exige des versions purement numériques pour `migration repair`)
- ne **jamais** lancer `supabase db pull` sur ce repo : la source de vérité du schéma est cette séquence numérotée, pas le distant. Un pull génère un baseline timestampé et déplace ces fichiers dans `migrations_legacy/`, ce qui casse la procédure de déploiement per-client.
- si un client a déjà un historique Supabase ancien, relancer `supabase db push` pour obtenir une nouvelle proposition de `migration repair` alignée sur ces noms

**Vérification :** `SELECT count(*) FROM permissions` → retourner le count réel après `062_default_permissions_overhaul.sql` (la refonte a modifié le total, 48 n'est plus la valeur de référence — vérifier sur un projet à jour).

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
- `056_invoice_balance_due_date.sql`
- `057_embedding_qwen3.sql`
- `058_rag_function.sql`
- `059_whatsapp_shared_waba.sql`
- `060_organization_deletion_workflow.sql`
- `061_organization_email_signature_cgv.sql`
- `062_default_permissions_overhaul.sql`
- `063_fix_profiles_rls.sql`
- `064_organization_decennale.sql`
- `065_organization_default_quote_validity.sql`
- `066_quote_invoice_aid.sql`
- `067_chantier_costs.sql`
- `068_photo_report_flags.sql`
- `069_equipe_membre_taux_horaire.sql`
- `070_invoices_chantier_link.sql`
- `071_chantier_jalons.sql`
- `072_photo_title.sql`
- `073_member_planning_and_expenses.sql`
- `074_suppliers_and_catalog_ai.sql`
- `075_chantier_target_margin.sql`
- `076_equipment_amortissement.sql`
- `077_rate_limits.sql`

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
- `056` : ajout de `balance_due_date` sur `invoices` (échéance solde restant après acompte)
- `057` : migration colonne `embedding` de `company_memory` de 1536 → 4096 dims pour Qwen3-Embedding-8B (vide les embeddings existants — à re-générer via le cron)
- `058` : création de la fonction SQL `match_company_memory` pour la recherche vectorielle RAG
- `060` : workflow suppression organisation + export/offboarding pour éviter les suppressions accidentelles directes
- `061` :
  - `organizations.email_signature TEXT` — signature HTML/texte ajoutée en bas de tous les emails sortants
  - `organizations.cgv_text TEXT` — CGV affichées sur les PDFs devis/factures
  - `organizations.reminder_first_delay_days INT DEFAULT 2` — délai avant la première relance auto
- `062` :
  - refonte des permissions par défaut (ajout `team.view` comme permission distincte, renumérotation des rôles)
  - fix `get_user_org_id` : ORDER BY `accepted_at DESC NULLS LAST` pour éviter les collisions multi-orgs
  - **NOTICE :** le count `SELECT count(*) FROM permissions` n'est plus 48 après cette migration — vérifier le vrai total avec `SELECT count(*) FROM permissions` sur un projet à jour
- `063` : correctif RLS sur la table `profiles` (accès lecture self uniquement)
- `064` :
  - remplacement du champ texte libre `insurance_info` par des champs structurés décennale : assureur, numéro police, date début/fin, zone géographique
  - `insurance_info` conservé pour RC Pro et autres assurances
- `065` : `organizations.default_quote_validity_days INTEGER DEFAULT 30` — durée de validité par défaut des devis, configurable dans Settings
- `066` :
  - `quotes.aid_label TEXT` + `quotes.aid_amount NUMERIC` — aide/subvention déductible affichée sur le PDF devis (MaPrimeRénov, CEE…)
  - même champs sur `invoices`
- `059` :
  - `phone_number_id` et `access_token` rendus optionnels sur `whatsapp_configs`
  - ajout de `use_shared_waba BOOLEAN DEFAULT false`
  - ajout de `authorized_contacts JSONB[]` — remplace `authorized_numbers TEXT[]` (format `[{"number":"+33...","label":"Samuel"}]`)
  - migration automatique des `authorized_numbers` existants vers `authorized_contacts` sans label
  - agent WhatsApp : nouveau routing par `from_number → organization_id` en mode mutualisé
  - nouvel outil `update_chantier_planning` : déplacer un chantier dans le planning par WhatsApp
- `067` :
  - création de `chantier_expenses` (dépenses chantier : matériel, sous-traitance, location, transport, autre)
  - ajout de `received_invoices.chantier_id` (FK optionnel)
  - ajout de `organizations.default_labor_cost_per_hour` (taux horaire coût interne)
  - ajout de `memberships.labor_cost_per_hour` (override par membre)
  - RLS : accès via le chantier parent (même pattern que `chantier_taches`)
  - permissions : `chantiers.expenses.view/create/edit/delete` pour owner/admin/manager
- `068` :
  - `chantier_photos.include_in_report BOOLEAN DEFAULT false` — photo incluse dans le PDF rapport
  - `chantier_photos.shared_with_client_at TIMESTAMPTZ` — horodatage dernier envoi email client
  - index partiel sur `include_in_report = true`
- `076` : amortissement équipement pour enrichir les coûts internes et la rentabilité chantier
- `077` : table `rate_limits` + RPC `check_rate_limit` pour limiter formulaires publics et appels IA par instance client
- `069` :
  - `chantier_equipe_membres.taux_horaire NUMERIC(8,2)` — override par membre pour la valorisation des pointages au-dessus du taux org
- `070` :
  - `invoices.chantier_id UUID REFERENCES chantiers(id)` — rattachement explicite d'une facture à un chantier (utilisé par l'onglet Rentabilité pour le revenu)
- `071` :
  - création de `chantier_jalons` (id, chantier_id, title, planned_date, status, position) — étapes / livrables d'un chantier
- `072` :
  - `chantier_photos.title TEXT` — titre court éditable séparé de la `caption`
- `074` :
  - création de `suppliers` (id, organization_id, name, contact_name, email, phone, address, siret, payment_terms, notes, is_active) — table fournisseurs avec RLS org-scoped et trigger updated_at
  - ajout de `materials.supplier_id UUID NULL REFERENCES suppliers(id) ON DELETE SET NULL` — FK vers la table fournisseurs (le champ texte `materials.supplier` est conservé en legacy)
  - le module `catalog_ai` est géré côté TypeScript uniquement (pas de ligne SQL — `normalizeOrganizationModules` retourne false si la clé est absente)
- `075` :
  - `chantiers.target_margin_pct DECIMAL(5,2) NOT NULL DEFAULT 30` — marge cible en % par chantier
  - budget coûts max calculé = `budget_ht * (1 - target_margin_pct / 100)` — affiché dans l'onglet Rentabilité pour alerter si les dépenses dépassent le seuil

- `073` (membres individuels + espace membre + rentabilité enrichie) :
  - `chantier_equipe_membres` : `equipe_id` rendu nullable + ajout `organization_id NOT NULL` (backfill auto), `prenom`, `email` → autorise les membres "orphelins" sans équipe parente
  - nouvelle table `chantier_individual_members(chantier_id, member_id)` — assignation directe d'un membre à un chantier sans passer par une équipe
  - `chantier_plannings.member_id UUID NULL` — un créneau peut viser une équipe OU un membre individuel
  - `chantier_pointages.member_id UUID NULL` + `user_id` rendu nullable + check `(user_id OR member_id)` — autorise les pointages depuis l'espace membre sans compte auth
  - nouvelle table `member_space_tokens(token_hash, expires_at, last_used_at)` pour les magic-links `/mon-espace` (RLS deny-all, accédée uniquement via service role)
  - `organizations.auto_send_member_reports BOOLEAN DEFAULT false` — toggle pour le cron mensuel d'envoi des rapports d'heures aux membres
  - `chantier_expenses` enrichi : `quantity`, `unit`, `unit_price_ht`, `material_id` (FK → `materials`), `subcategory`, champs carburant (`transport_km`, `transport_consumption`, `transport_fuel_price`) et location (`rental_item_label`, `rental_start_date`, `rental_end_date`)
  - `amount_ht` reste source de vérité — recalculé côté UI quand `quantity × unit_price_ht` ou via le calculateur carburant `km × conso/100 × prix/L`

Impact déploiement :
- `059` : appliquer sur tous les clients existants avec WhatsApp avant de redéployer l'Edge Function — sans ça, le webhook ne peut pas lire `authorized_contacts` ni `use_shared_waba`
- `067` + `068` : appliquer avant d'utiliser l'onglet Rentabilité, l'assistant IA chantier, les photos rapport et les nouveaux outils WhatsApp — sans ça les inserts sur `chantier_expenses` et `chantier_photos` échoueront
- `073` :
  - obligatoire avant d'utiliser : l'onglet Équipe → "Membre individuel", la planification d'un membre seul, l'espace `/mon-espace`, le formulaire de dépense enrichi (location secteur / transport carburant / lien catalogue) et le toggle Settings "Rapport mensuel auto"
  - **NOTICE bénin attendu** au push : `constraint "chantier_pointages_who" does not exist, skipping` — c'est le `DROP CONSTRAINT IF EXISTS` qui n'a rien à supprimer la 1ère fois (idempotent)
  - **nouvelle variable d'env requise** : `MEMBER_SESSION_SECRET` (32 chars, signature HMAC du cookie `/mon-espace`) — voir §3
  - **nouveau cron à brancher** : `POST /api/cron/monthly-member-reports` (1er du mois 6h UTC) — voir §5.c
  - **redéployer l'app après migration** (`./scripts/deploy-client.sh atelier-<client>`) pour propager les nouveaux composants UI et endpoints
- obligatoire avant d'utiliser les nouveaux champs catalogue, les variantes tarifaires et le contexte par activité
- obligatoire avant d'utiliser l'export complet owner-only dans `Settings > Données & confidentialité`
- obligatoire avant tout appel IA en production (`callAI.ts` lit `organization_modules` — sans la table, toutes les features IA échouent)
- `057` vide les embeddings existants : déclencher le cron `/api/cron/embeddings` après migration pour re-générer
- ajouter les 3 variables opérateur dans Cloudflare Workers pour activer la sync vers le cockpit (voir §3)
- après migration, vérifier rapidement dans l'app :
  - Settings → activité métier bien sélectionnée
  - Catalogue → création/édition produit/service OK
  - Catalogue → variantes tarifaires enregistrables
  - Formulaire public → affichage correct des produits/services configurés
  - Settings → Données & confidentialité → génération d'un export complet OK
  - Settings → Modules → modules IA visibles et activables
- après migration `074`, vérifier dans l'app :
  - Catalogue → onglet "Fournisseurs" visible et opérationnel (CRUD + import CSV)
  - Catalogue → bouton "Ajouter avec l'IA" visible si module `catalog_ai` activé (via Cockpit ou SQL)
  - Matières/produits → champ fournisseur peut être lié à un fournisseur de la table `suppliers`

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
MEMBER_SESSION_SECRET=...              ← unique par client, signe le cookie de session /mon-espace (openssl rand -hex 32)
RATE_LIMIT_SECRET=...                   ← optionnel, unique par client ; fallback CRON_SECRET si absent
AI_RATE_LIMIT_PER_HOUR=120              ← optionnel, limite appels IA par org/feature
PUBLIC_FORM_RATE_LIMIT_PER_HOUR=5       ← optionnel, limite formulaire public par email+IP
SHARED_WABA_PHONE_NUMBER_ID=...        ← Phone Number ID du numéro bot Atelier mutualisé (partagé)
SHARED_WABA_ACCESS_TOKEN=...           ← Token permanent du numéro bot Atelier mutualisé (partagé)
NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER=+33700000000  ← Numéro affiché dans Settings → WhatsApp (format +33...)
OPERATOR_INGEST_URL=https://cockpit.orsayn.fr/api/operator/ingest  ← URL du cockpit Orsayn
OPERATOR_INGEST_SECRET=...             ← secret HMAC partagé (identique sur toutes les instances + cockpit)
# OPERATOR_SOURCE_INSTANCE=nom-client ← optionnel : si absent, utilise le host de NEXT_PUBLIC_APP_URL (ex: atelier-weber.workers.dev). Renommable dans le cockpit après.
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
# Préflight non destructif avant un déploiement client
npm run preflight:client -- atelier-weber

# Préflight avec build OpenNext Cloudflare
npm run preflight:client -- atelier-weber --with-open-next-build

# Déployer UN client (premier déploiement ou mise à jour)
./scripts/deploy-client.sh atelier-weber

# Mettre à jour TOUS les clients en une commande
./scripts/deploy-all-clients.sh
```

- `deploy-client.sh` : patche temporairement `wrangler.jsonc` avec le bon `name`, lance `npm run deploy`, puis restaure. Pas besoin de modifier le fichier à la main.
- `deploy-all-clients.sh` : lit `scripts/clients.txt` (un worker-name par ligne) et déploie chacun séquentiellement. Affiche un résumé succès/échec à la fin.
- `preflight-client.mjs` : vérifie worker-name, scripts, migrations, variables attendues et peut lancer le build OpenNext.
- `prepare-cloudflare-env.mjs` : prépare les variables Cloudflare en dry-run ; `--apply-secrets` injecte uniquement les secrets via Wrangler, les variables texte restent affichées pour contrôle.
- Ajouter chaque nouveau client dans `scripts/clients.txt` pour l'inclure dans les mises à jour futures.

#### Automatisation contrôlée des variables Cloudflare

```bash
# Dry-run : affiche ce qui sera configuré
npm run cf:env -- atelier-weber --env-file=.env.client-weber

# Application contrôlée : injecte les secrets via wrangler secret put
npm run cf:env -- atelier-weber --env-file=.env.client-weber --apply-secrets
```

Les variables texte (`SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`, mentions légales, etc.) sont listées par le script et restent à poser manuellement ou via une future automatisation API Cloudflare avec token.

#### Variables d'environnement

À injecter dans Cloudflare Dashboard → Workers & Pages → le projet → Settings → Variables and Secrets :

| Type | Variables |
|------|-----------|
| **Secret** | `OPERATOR_INGEST_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `CRON_SECRET`, `MEMBER_SESSION_SECRET`, `RATE_LIMIT_SECRET`, `SHARED_WABA_ACCESS_TOKEN` |
| **Text** | `OPERATOR_MODE`, `OPERATOR_ALLOWED_EMAILS`, `OPERATOR_SUPABASE_URL`, `OPERATOR_USD_TO_EUR_RATE`, `SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`, `AI_RATE_LIMIT_PER_HOUR`, `PUBLIC_FORM_RATE_LIMIT_PER_HOUR`, `OPERATOR_INGEST_URL`, `OPERATOR_SOURCE_INSTANCE`, `SHARED_WABA_PHONE_NUMBER_ID` et toutes les `NEXT_PUBLIC_LEGAL_*` |

**Mapping Edge Functions Supabase :** l'app Worker utilise `RESEND_FROM_ADDRESS` et `NEXT_PUBLIC_APP_URL`; la fonction Supabase `whatsapp-webhook` reçoit les mêmes valeurs sous `RESEND_FROM_EMAIL` et `APP_URL` via `scripts/deploy-edge-functions.sh`.

> **Important :** déconnecter le repo GitHub du projet Cloudflare Pages après le premier déploiement manuel — sinon chaque push GitHub déclenche un build automatique qui échoue (next-on-pages n'est plus utilisé).

### 5. Cloudflare Worker — crons automatiques

Script de déploiement (lancé par Claude via terminal) :
```bash
cd workers/auto-reminder
wrangler secret put APP_URL          # → https://domaine-du-client.fr
wrangler secret put CRON_SECRET      # → même valeur que dans l'app Workers
wrangler deploy
```

Cron : `0 7 * * *` (8h Paris hiver, 9h été) — défini dans `wrangler.toml`.

Le Worker déclenche **séquentiellement deux routes** à chaque exécution :

| Route | Rôle |
|---|---|
| `POST /api/cron/auto-reminders` | Relances devis/factures en retard — génère les emails via IA (Claude Haiku) |
| `POST /api/cron/recurring-invoices` | **Passe 1** : crée les brouillons récurrents dont `next_send_date` est atteinte + notifie l'artisan. **Passe 2** : envoie automatiquement avec PDF les brouillons non validés dont le délai `auto_send_delay_days` est expiré |
| `POST /api/cron/monthly-member-reports` | **Mensuel (1er du mois)** : pour chaque org avec `auto_send_member_reports=true`, génère et envoie par email à chaque membre individuel ayant un email son rapport PDF des heures pointées le mois précédent. À planifier séparément (cron-job.org ou ajout au Worker auto-reminder, voir §5.c) |

> **Prérequis critique :** `OPENROUTER_API_KEY` doit être injectée dans les variables Cloudflare Workers de l'app (voir §3). Le Worker appelle `/api/cron/auto-reminders` sur l'app, qui génère chaque email via l'IA. Si cette clé est absente ou invalide, **aucune relance ne part** (échec silencieux côté cron). C'est la clé Atelier partagée — elle est déjà dans ton `.env.local`.

**Mise à jour code** (quand le Worker relances évolue) :

> ⚠️ `deploy-all-clients.sh` **ne couvre pas** ce Worker — il déploie uniquement l'app Next.js principale. Le Worker relances doit être redéployé séparément si son code change.

```bash
# Redéployer le Worker relances pour un client
cd workers/auto-reminder
# Les secrets APP_URL et CRON_SECRET sont déjà injectés — pas besoin de les re-saisir
wrangler deploy --name auto-reminder-<nomclient>

# Pour tous les clients (adapter la liste)
for name in weber dupont; do
  cd workers/auto-reminder
  wrangler deploy --name auto-reminder-$name
done
```

### 5.c Cron — rapport mensuel d'heures aux membres individuels

`POST /api/cron/monthly-member-reports` est un endpoint Next.js (pas un Cloudflare Cron Trigger). Il envoie à chaque intervenant ayant un email son rapport PDF des heures du mois précédent — uniquement pour les orgs ayant activé le toggle dans **Settings → Rapport mensuel d'heures** (`organizations.auto_send_member_reports = true`).

**Planification recommandée — cron-job.org (gratuit) :**

1. Aller sur [cron-job.org](https://cron-job.org) → créer un job par client
2. URL : `https://<domaine-du-client.fr>/api/cron/monthly-member-reports`
3. Méthode : `POST`
4. Header : `x-cron-secret: <CRON_SECRET du client>`
5. Fréquence : **1er du mois à 06:00 UTC** (soit 07h Paris hiver / 08h été)

```bash
# Déclencher manuellement via curl (utile pour tester)
curl -X POST https://<domaine-du-client.fr>/api/cron/monthly-member-reports \
  -H "x-cron-secret: <CRON_SECRET>"
# Réponse attendue :
# { "period": { "dateFrom": "2026-03-01", "dateTo": "2026-03-31" },
#   "orgs": 1, "totalMembers": 4, "sent": 4, "errors": [] }
```

> **Pourquoi pas dans le Worker `auto-reminder` ?** Le Worker existant tourne tous les jours à 08h Paris (`0 7 * * *`). Pour ce cron mensuel on a besoin d'un schedule différent (1er du mois). Soit créer un nouveau Cloudflare Worker dédié, soit utiliser cron-job.org (recommandé — gratuit, plus simple). Le déclenchement reste idempotent : le mois courant est calculé côté serveur, pas de risque d'envoi en double.

### 5.b Cron — génération des embeddings Qwen (mémoire entreprise)

`POST /api/cron/embeddings` est un endpoint Next.js (pas un Cloudflare Cron Trigger). Il vectorise les lignes `company_memory` dont `embedding IS NULL`. Il doit être appelé par un planificateur externe.

**Planification recommandée — cron-job.org (gratuit) :**

1. Aller sur [cron-job.org](https://cron-job.org) → créer un job par client
2. URL : `https://<domaine-du-client.fr>/api/cron/embeddings`
3. Méthode : `POST`
4. Header : `x-cron-secret: <CRON_SECRET du client>`
5. Fréquence : toutes les heures (ou toutes les 15 min si la mémoire est alimentée souvent)

**Quand déclencher manuellement :**
- Après la migration `057_embedding_qwen3.sql` (vide les embeddings existants — à re-générer)
- Après avoir peuplé `company_memory` (étape C8) pour que le RAG soit opérationnel immédiatement

```bash
# Déclencher manuellement via curl
curl -X POST https://<domaine-du-client.fr>/api/cron/embeddings \
  -H "x-cron-secret: <CRON_SECRET>"
# Réponse attendue : { "processed": N, "updated": N, "errors": 0 }
```

> **Note :** sans ce cron planifié, le RAG (mémoire entreprise injectée dans les prompts IA) ne fonctionne pas — les embeddings restent `NULL` et `match_company_memory` renvoie 0 résultats.

### 6. Edge Function WhatsApp

Script automatisé (lancé par Claude via terminal) :
```bash
./scripts/deploy-edge-functions.sh <PROJECT_REF> \
  --resend-key re_xxx \
  --resend-from contact@client.fr \
  --app-url https://client.fr
```

**Séparation clés partagées / clés par client :**
- **Depuis `.env.local`** (clés Atelier identiques partout) : `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `SHARED_WABA_PHONE_NUMBER_ID`, `SHARED_WABA_ACCESS_TOKEN`
- **En argument** (clés propres au client) : `--resend-key`, `--resend-from`, `--app-url`

Cela évite de modifier `.env.local` entre chaque déploiement client.

`APP_URL` est requis pour les liens PDF dans les emails envoyés depuis WhatsApp (`send_quote`, `send_invoice`).

URL webhook (mode propre WABA uniquement) :
```
https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook
```

Le Verify Token est généré automatiquement dans **Settings → Agent WhatsApp** de l'app.

**Mise à jour code** (quand la Edge Function évolue) :
```bash
# Un client
./scripts/deploy-edge-functions.sh <ref> --resend-key re_xxx --resend-from contact@client.fr --app-url https://client.fr

# Tous les clients (adapter les valeurs par client)
for ref in ref1 ref2 ref3; do ./scripts/deploy-edge-functions.sh $ref --resend-key re_xxx --resend-from contact@client.fr --app-url https://client.fr; done
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

- [ ] `SELECT count(*) FROM permissions` → count cohérent avec le projet de référence (voir note §1 — plus 48 depuis 062)
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
- [ ] **Membre individuel** : Chantier → onglet Équipe → "Ajouter un membre" → renseigner email → vérifier réception du lien d'accès `/mon-espace?token=...`
- [ ] **Espace membre** : ouvrir le lien → voir ses créneaux + pointer 4h → vérifier que le pointage apparaît dans l'onglet Heures du chantier (avec `member_id` rempli côté DB)
- [ ] **Rapport heures à la demande** : depuis `/mon-espace/dashboard`, cliquer "M'envoyer le rapport" → vérifier réception PDF
- [ ] **Rentabilité — location** : ajouter dépense location → dropdown propose équipements selon le secteur de l'org (BTP / Nettoyage / Paysagiste / Industrie) ; option "Autre" bascule en saisie libre ; dates → quantité auto
- [ ] **Rentabilité — transport carburant** : km × conso/100 × €/L → montant calculé automatiquement
- [ ] **Rentabilité — matériau catalogue** : dropdown "Lier au catalogue" pré-remplit unité et prix d'achat
- [ ] **Settings → Rapport mensuel** : toggle visible pour les owners/admins (`canEditOrg`), bascule sauvegardée
- [ ] **Permissions FR** : Settings → Rôles & permissions → tous les libellés en français (plus de `catalog.delete` brut)

### Checklist onboarding WhatsApp client (mode mutualisé)

> Le client n'a **aucun compte Meta à créer**. Tout passe par le numéro bot Atelier.

**Toi (une fois le Worker déployé) :**
- [ ] Activer le module WhatsApp dans Cockpit Orsayn ou directement en DB : `UPDATE organization_modules SET whatsapp_agent = true WHERE organization_id = '<id>'`

**Le client (dans son app → Settings → Agent WhatsApp) :**
- [ ] Cocher "Utiliser le numéro Atelier mutualisé"
- [ ] Ajouter ses numéros autorisés (lui + son équipe) au format +33...
- [ ] Envoyer "bonjour" depuis un numéro autorisé → l'agent répond avec le contexte de son entreprise

> Le numéro bot affiché dans Settings est `NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER` injecté au déploiement.

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
| Relances auto (cron) | `api/cron/auto-reminders` | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | ~€0,001/relance |
| Brouillon email relance (modal) | `mutations/ai-summary` | Claude Haiku 4.5 (`anthropic/claude-haiku-4-5`) | ~€0,001/brouillon |
| Intro email rapport chantier | `mutations/chantier-report-email` | Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) | ~€0,001/email |
| Résumé "Ma semaine" | `mutations/ai-summary` | Gemini 2.5 Flash Lite (`google/gemini-2.5-flash-lite`) | ~€0,001/résumé |
| Planification semaine IA | `mutations/planning` | DeepSeek V4 Flash (`deepseek/deepseek-v4-flash`) | ~€0,001/planning |
| Analyse devis (texte/image) | `api/ai/analyze-quote` | Gemini 2.5 Flash Lite (`google/gemini-2.5-flash-lite`) | ~€0,001/devis |
| Estimation main d'oeuvre | `api/ai/estimate-labor` | Gemini 2.5 Flash Lite (`google/gemini-2.5-flash-lite`) | ~€0,001/req |
| Suggestions tâches | `api/ai/suggest-tasks` | Gemini 2.5 Flash Lite (`google/gemini-2.5-flash-lite`) | ~€0,001/req |
| Suggestions jalons | `api/ai/suggest-jalons` | Gemini 2.5 Flash Lite (`google/gemini-2.5-flash-lite`) | ~€0,001/req |
| Assistant chantier | `api/ai/chantier-assistant` | Claude Haiku 4.5 (`anthropic/claude-haiku-4-5`) | ~€0,002/req |
| Import document PDF/image (finances) | `api/ai/parse-document-pdf` | Gemini 2.5 Flash Lite vision (`google/gemini-2.5-flash-lite`) + fallback Sonnet 4.6 | ~€0,002/doc |
| Transcription vocale | `api/ai/transcribe-audio` | Voxtral Mini (Mistral direct) | ~€0,003/min |
| WhatsApp agent (texte + outils) | `functions/whatsapp-webhook` | Gemini 2.5 Flash (`google/gemini-2.5-flash`) | ~€0,003/message |
| Transcription vocale WhatsApp | `functions/whatsapp-webhook` | Voxtral Mini (Mistral direct) | ~€0,003/min |
| IA Catalogue (saisie naturelle) | `api/ai/catalog-extract` | Gemini 2.5 Flash (`google/gemini-2.5-flash`) | ~€0,001/saisie |
| Embeddings mémoire entreprise | `api/cron/embeddings` | Qwen3-Embedding-8B (OpenRouter, 4096 dims) | ~€0,0001/ligne |

#### Coût IA total estimé par profil / mois

| Profil | Hypothèses clés | Coût IA/mois |
|--------|----------------|--------------|
| **Démarrage** (pas WhatsApp) | 3 devis IA, 5 relances, 4 résumés semaine | ~€0,10 |
| **Standard** (WhatsApp activé) | 10 devis, 15 relances, 50 messages WA | ~€0,25 |
| **Actif + agents** (WA intensif) | 20 devis, 30 relances, 150 msg WA, 20 min vocal | ~€0,70 |
| **Gros client** (équipe + WA quotidien) | 40 devis, 60 relances, 300 msg WA, 60 min vocal | ~€1,30 |

> WhatsApp agent : Gemini 2.5 Flash (~€0,003/message). Résumé semaine et planning migres vers Gemini 2.5 Flash Lite / DeepSeek V4 Flash (coût divisé par 5-10 vs Sonnet). Sans WhatsApp, le coût IA est inférieur à €0,10/mois. Levier restant si les marges se compriment : passer les relances auto de Haiku 4.5 → Gemini Flash Lite (divisé encore par 3).

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

**Principe :** B2Brouter se paie à l'année et à l'avance. Le coût annuel complet (activation + abonnement) est inclus dans le setup one-shot facturé au client à l'onboarding. Ensuite, le client ne paie que les coûts IA mensuels (avec marge). La deuxième année, Atelier a la trésorerie pour avancer l'abonnement — le client peut alors renouveler annuellement ou passer en mensuel selon sa préférence.

| Poste | Coût Atelier (franchise TVA) | Refacturé client | Marge |
|-------|------------------------------|-----------------|-------|
| Activation one-shot | €180 TTC | €190 | €10 |
| Abonnement M1 an 1 (payé d'avance) | €348 TTC | €480 | €132 |
| Abonnement M2 an 1 (payé d'avance) | €708 TTC | €960 | €252 |

**An 1 :** activation + abonnement annuel inclus dans le setup → client paie tout au départ, Atelier préfinance puis encaisse.
**An 2+ :** Atelier a la trésorerie pour avancer. Client incité à renouveler annuellement, mensuel possible si préférence.
**IA mensuelle :** facturée séparément chaque mois avec marge (voir tableau coûts IA).

### Frais one-shot à l'onboarding

| Poste | Montant |
|-------|---------|
| Setup & déploiement | €300–500 |
| Activation B2Brouter (si fact. élec.) | €190 |
| Abonnement B2Brouter an 1 (M1, annuel d'avance) | €480 |
| **Total avec fact. élec.** | **~€970–1 170** |
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
| `MEMBER_SESSION_SECRET` | `openssl rand -hex 32` — signe le cookie de session de l'espace membre `/mon-espace` (HMAC SHA-256) | Non (unique par client) |
| `RATE_LIMIT_SECRET` | `openssl rand -hex 32` — salt de hash rate limit, optionnel si `CRON_SECRET` est présent | Non (unique par client) |
| `AI_RATE_LIMIT_PER_HOUR` | Défaut conseillé `120` | Non |
| `PUBLIC_FORM_RATE_LIMIT_PER_HOUR` | Défaut conseillé `5` | Non |
| `SHARED_WABA_PHONE_NUMBER_ID` | Phone Number ID du numéro bot Atelier | **Oui** (partagé, injecté en Edge Function) |
| `SHARED_WABA_ACCESS_TOKEN` | Token permanent du numéro bot Atelier | **Oui** (partagé, injecté en Edge Function) |
| `NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER` | Numéro bot affiché dans Settings → WhatsApp (format +33...) | **Oui** (même valeur partout) |
| `OPERATOR_INGEST_URL` | URL du cockpit Orsayn | **Oui** (même URL partout) |
| `OPERATOR_INGEST_SECRET` | `openssl rand -hex 32` (généré une fois) | **Oui** (même secret partout) |
| `OPERATOR_SOURCE_INSTANCE` | Nom court du client (ex: `weber-demo`) — **optionnel**, fallback sur le host de `NEXT_PUBLIC_APP_URL` | Non (unique par client) |

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

> **Périmètre de `deploy-all-clients.sh` :** couvre uniquement l'app Next.js principale. Le Worker relances (`workers/auto-reminder`) et les Edge Functions Supabase doivent être redéployés séparément si leur code a changé (voir §5 et §6).

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
| Weber Tôlerie (**démo**) | `pyxnmohknxmbpbcuvudg` | localhost | 2024 | 001→074 | ❌ | ❌ |
