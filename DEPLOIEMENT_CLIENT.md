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
RESEND_API_KEY : re_...        ← laisser vide si pas de domaine (emails via Atelier)
Domaine : [ex: weber-tolerie.fr ou "aucun" → URL workers.dev]
Nom affiché email : [ex: Weber Tôlerie]
Adresse email expéditeur : [ex: contact@weber-tolerie.fr ou "noreply@atelier.orsayn.fr"]
CRON_SECRET : [laisser vide = Claude génère]
Clé OpenRouter : Atelier (défaut) / Client (fournir sk-or-xxx)
  → Atelier : clé partagée depuis .env.local, Atelier porte le coût IA
  → Client : le client crée son compte openrouter.ai et fournit sa clé — il paye directement
Mode facturation IA cockpit : orsayn_shared / client_owned
  → orsayn_shared : coût IA soustrait de la marge dans le cockpit
  → client_owned : conso visible pour pricing, mais coût non porté par Orsayn
WhatsApp activé : oui / non
  → Mode mutualisé Twilio (recommandé) : rien à fournir côté client — routing via webhook central Orsayn
  → Mode propre WABA : Phone Number ID + Access Token Meta/Graph-compatible, permanent
Offre souscrite : [setup_only | starter | pro | expert]
  → Détermine modules + quota_config dans organization_modules au déploiement (étape C8)
  → setup_only : tous les modules IA à false — l'app tourne sans IA
  → starter : 39€/mois — IA web principale, WhatsApp à 0
  → pro : 89€/mois — + whatsapp_agent (120 msg/mois, 10 min vocal)
  → expert : 149€/mois — IA illimitée + 500 msg WhatsApp, 40 min vocal, 30 msgs proactifs, OCR WA
  → facturation électronique gérée séparément par le cockpit
Overflow mode : block (défaut) | upgrade_prompt | charge
  → block : fonctionnalité coupée en fin de quota jusqu'au 1er du mois
  → upgrade_prompt : la fonc continue, email upgrade envoyé, bascule block si non-upgrade 48h
  → charge : usage supplémentaire facturé (+0,50€/tranche 50 msg WA)
Essai IA offert : oui (30 jours Expert) / non
  → Si oui : active tous les modules Expert + note trial_ends_at = today + 30j dans operator_client_subscriptions
Facturation électronique : off | export_only (défaut) | b2brouter
  → export_only : Atelier génère PDF + XML Factur-X, envoi PDF/mail normal jusqu'au 31/08/2027 — aucun surcoût
  → b2brouter : réception UI 2026 côté app client + transmission automatique via B2Brouter — facturation annuelle séparée (250€-900€/an selon volume)
  → mode actuel Orsayn : eDocExchange. Le compte entreprise est créé/configuré dans l'UI B2Brouter, le cockpit stocke l'account_id et pousse la config.
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
| T6 | *(Si WhatsApp propre uniquement)* Créer l'app Meta, générer le token permanent | [developers.facebook.com](https://developers.facebook.com) | 20 min | Formulaire Meta, pas d'API publique |
| T7 | Onboarding owner : créer le compte, remplir les infos entreprise | App en production | 10 min | Action du client final |

**À faire une seule fois sur ta machine (déjà fait) :**
```bash
supabase login   # débloque C1, C5, C6
wrangler login   # débloque T3, C7
# @opennextjs/cloudflare est une dépendance locale du projet (npm install) — pas d'install globale nécessaire
```

**Gate technique avant T3 (obligatoire avant déploiement client) :**
```bash
npm run typecheck
npm test
npm run preflight:client -- atelier-nomclient
npm run preflight:client -- atelier-nomclient --strict-env
npm run build
npm run preflight:client -- atelier-nomclient --with-open-next-build
```

`--strict-env` transforme les secrets manquants en erreur. En production, `CRON_SECRET`, `MEMBER_SESSION_SECRET` et `RATE_LIMIT_SECRET` doivent être uniques par instance client. `RATE_LIMIT_SECRET` doit être distinct de `SUPABASE_SERVICE_ROLE_KEY` pour éviter de réutiliser une clé très sensible comme sel de hash.

**WhatsApp mutualisé Twilio — à faire une seule fois avant le premier client WhatsApp :**
Le numéro Twilio WhatsApp Atelier doit pointer vers un **webhook central Orsayn**. Les instances clientes ne sont pas appelées directement par Twilio.

```
Twilio WhatsApp Atelier
  → webhook central Orsayn
  → routing par numéro autorisé
  → instance/Supabase du client concerné
  → réponse via Twilio
```

Les credentials Twilio mutualisés vivent côté cockpit/routeur Orsayn, pas dans chaque Worker client. Les apps clientes ont seulement besoin du numéro public à afficher :

```
NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER=+33...
```

**Clés WABA Meta mutualisées — ancien mode / Graph-compatible :**
Si un fournisseur expose un `Phone Number ID` + `Access Token` compatibles Meta Cloud API, ajouter dans `.env.local` :
```
SHARED_WABA_PHONE_NUMBER_ID=<Phone Number ID du numéro bot Atelier>
SHARED_WABA_ACCESS_TOKEN=<Token permanent Meta>
NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER=+33...
```
→ `deploy-edge-functions.sh` les lit automatiquement pour tous les clients présents et futurs. Ce n'est pas le mode cible pour Twilio classique.

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
| C6 | Déployer la Edge Function + injecter les secrets (`OPENROUTER`, `MISTRAL`, `RESEND`, `APP_URL`; `SHARED_WABA_*` seulement en mode Meta/Graph-compatible) | `./scripts/deploy-edge-functions.sh <ref> --resend-key ... --resend-from ... --app-url ...` | `supabase login` ✅ |
| C7 | Déployer le Cloudflare Worker relances + injecter `APP_URL` + `CRON_SECRET` | `wrangler deploy` | `wrangler login` ✅ |
| C8 | Peupler `company_memory` avec le contexte de l'entretien client + configurer `organization_modules` selon l'offre souscrite | Supabase MCP | MCP connecté ✅ |
| C9 | Vérifier migrations, permissions, buckets, modules IA | Supabase MCP | MCP connecté ✅ |
| C10 | Afficher récapitulatif final + URL app client + modules actifs ; WhatsApp mutualisé passe par le webhook central Orsayn | — | — |

**Note C4 (variables Cloudflare Workers) :** si `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` sont fournis dans le protocole, j'injecte toutes les variables via l'API Cloudflare (`curl`) — secrets ET variables texte — et T4 disparaît de ta liste.

**Note C8 — Configuration modules IA selon l'offre souscrite :**

Après avoir peuplé `company_memory`, je configure `organization_modules.modules`, `organization_modules.quota_config` et `organization_modules.overflow_mode` via Supabase MCP selon le champ "Offre souscrite" du protocole :

| Offre | Modules / quotas |
|-------|----------------|
| `setup_only` | Tous modules à `false`, tous quotas à `0` |
| `starter` | IA web principale, WhatsApp à `0`, quotas starter |
| `pro` | Starter + `whatsapp_agent`, quotas Pro |
| `expert` | Tous modules, quotas Expert |

La facturation électronique est configurée séparément dans le cockpit après le tier : `off`, `export_only` ou `b2brouter`.

Si "Essai IA offert : oui" :
1. Activer tous les modules Expert côté instance cliente (config-sync)
2. Écrire dans `operator_client_subscriptions` : `trial_tier = 'expert'`, `trial_ends_at = now() + 30 days`, `trial_converted = false`
3. Insérer un event dans `operator_client_events` : `event_type = 'trial_started'`, `event_category = 'trial'`
4. Envoyer l'email `trial-start` via Resend cockpit au contact client

À l'expiration (géré automatiquement par le cron `trial-expiry-check`) : modules IA désactivés via config-sync + `trial_ends_at = null` remis à null + email `trial-expired` envoyé.

Le cockpit Orsayn reste la source de vérité pour modifier tier, modules, quotas et configuration e-facturation après déploiement. Le bouton "Appliquer tier" pousse la configuration vers `https://<app-client>/api/operator/config-sync` avec signature HMAC.

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
078_invoice_payment_schedule.sql           ← Échéancier de paiement sur facture (versements en plusieurs fois + encaissement atomique)
079_fix_invoice_payment_schedule_columns.sql ← Correctif colonnes amount_type + percentage manquantes sur invoice_payment_schedule
080_contracts_mvp.sql                      ← Module contrats MVP : table contracts, RLS, permissions contracts.*
081_contract_templates.sql                 ← Templates de contrats personnalisés par organisation (table contract_templates)
082_contract_custom_sections.sql           ← Sections libres (custom_sections JSONB) sur contracts et contract_templates
083_organization_quota_config.sql          ← Quotas commerciaux locaux : quota_config/overflow_mode + colonnes quota sur usage_logs
084_contracts_signature_duration.sql       ← Durée optionnelle des contrats + informations de durée
085_contract_client_signature.sql          ← Signature manuscrite du client via lien public sécurisé
086_contract_client_signatory_role.sql     ← Fonction du signataire côté client (ex : Gérant, Directeur technique)
087_contract_quote_link.sql                ← Lien optionnel entre un devis et un contrat
088_invalidate_broken_snapshots.sql        ← Invalide les snapshots PDF contrats dont organization_id est nul
089_auto_reminders_72h_after_invoice_sent.sql ← Première relance 72h après envoi facture (pas après échéance)
090_planning_tournee.sql                   ← Planification par tournée : regroupement, durée sur site, trajet, ordre
091_quote_invoice_items_dim_quantity.sql   ← Nombre d'unités dimensionnelles (multiplicateur : nb × surface/longueur/volume)
092_manage_pointages_permission.sql        ← Nouvelle permission chantiers.manage_pointages (ajuster/supprimer pointages équipe)
093_planning_and_profitability_permissions.sql ← Permissions dédiées chantiers.planning + chantiers.profitability.view
094_restrict_collaborateur_permissions.sql ← Retire chantiers.edit et invoices.create des rôles collaborateur/employee
095_member_goals.sql                       ← Objectifs individuels par membre (heures, tâches, chantiers, custom) + RLS
096_member_goals_membership.sql            ← Étend member_goals pour accepter membership_id (membres org sans fiche intervenant)
097_situations_de_travaux.sql              ← Module situations de travaux : colonnes invoices + table invoice_situations + RPC generateSituation
098_tournee_departure_address.sql          ← Point de départ tournée : organizations.departure_* + table tournee_routes
099_quote_invoice_items_unit_cost.sql      ← Coût interne unitaire sur lignes devis/facture (unit_cost_ht) — jamais affiché au client, alimente la marge ligne par ligne
100_org_annual_objectives.sql             ← Objectifs annuels organisation : CA HT, marge €/%, chantiers, heures, clients — table org_annual_objectives
101_org_tva_sur_debits.sql                ← TVA sur débits vs encaissements : organizations.tva_sur_debits BOOLEAN — impacte les rapports et l'export FEC
102_pointage_rate_snapshot.sql            ← Snapshot taux horaire au moment du pointage : chantier_pointages.rate_snapshot — fige le taux au moment de la saisie
103_organization_einvoicing_config.sql    ← Config locale e-facturation sync cockpit : off/export_only/b2brouter, sandbox/prod, account id, annuaire
104_quote_client_signature.sql            ← Signature manuscrite du client sur devis : nom, fonction, image dans le PDF signé
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
- `078_invoice_payment_schedule.sql`
- `079_fix_invoice_payment_schedule_columns.sql`
- `080_contracts_mvp.sql`
- `081_contract_templates.sql`
- `082_contract_custom_sections.sql`
- `083_organization_quota_config.sql`
- `084_contracts_signature_duration.sql`
- `085_contract_client_signature.sql`
- `086_contract_client_signatory_role.sql`
- `087_contract_quote_link.sql`
- `088_invalidate_broken_snapshots.sql`
- `089_auto_reminders_72h_after_invoice_sent.sql`
- `090_planning_tournee.sql`
- `091_quote_invoice_items_dim_quantity.sql`
- `092_manage_pointages_permission.sql`
- `093_planning_and_profitability_permissions.sql`
- `094_restrict_collaborateur_permissions.sql`
- `095_member_goals.sql`
- `096_member_goals_membership.sql`
- `097_situations_de_travaux.sql`
- `098_tournee_departure_address.sql`
- `099_quote_invoice_items_unit_cost.sql`
- `100_org_annual_objectives.sql`
- `101_org_tva_sur_debits.sql`
- `102_pointage_rate_snapshot.sql`
- `103_organization_einvoicing_config.sql`

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
  - création de `organization_modules` (config modules IA par org ; les clés canoniques actuelles sont pilotées par `src/lib/quota-catalog.ts`)
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

- `092` : nouvelle permission `chantiers.manage_pointages` — attribuée owner/admin/manager ; permet d'ajuster ou supprimer les pointages de n'importe quel membre (pas seulement les siens)
- `093` :
  - `chantiers.planning` — gérer le planning et les tournées (owner/admin/manager)
  - `chantiers.profitability.view` — voir la rentabilité des chantiers (owner/admin/manager)
  - ces permissions remplacent l'usage générique de `chantiers.edit` pour ces deux fonctions
- `094` :
  - retire `chantiers.edit` et `invoices.create` des rôles `collaborateur` et `employee`
  - met à jour `initialize_organization_for_user` pour les nouvelles orgs créées après cette migration
- `095` :
  - nouvelle table `member_goals` (objectifs par membre/période : heures terrain, tâches complétées, chantiers traités, custom)
  - RLS via l'organization_id du membre
- `096` :
  - `member_goals.member_id` rendu nullable
  - ajout `membership_id` (FK → `memberships`) — autorise les objectifs pour les membres org sans fiche intervenant
  - contrainte `member_xor_membership` : exactement l'un des deux doit être non null
- `097` (situations de travaux) :
  - colonnes sur `invoices` : `situation_number`, `cumulative_pct`, `period_from`, `period_to`, `retention_pct`, `retention_amount`, `market_reference`
  - nouvelle table `invoice_situations` (lien situation → devis de référence, cumul, retenue, numéro)
  - RPC `generate_situation_invoice` — crée la situation et calcule les montants en transaction atomique
  - **obligatoire avant d'utiliser** : l'onglet Situations de travaux dans l'éditeur de facture et via WhatsApp (Phase 8)
- `098` :
  - colonnes sur `organizations` : `departure_address`, `departure_postal_code`, `departure_city` — point de départ par défaut des tournées, distinct de l'adresse de domiciliation
  - nouvelle table `tournee_routes` — métadonnées par tournée (date, point de départ spécifique, timestamps)
  - **obligatoire avant d'utiliser** : le champ "Adresse de départ" dans Settings et la saisie d'un point de départ par tournée dans le module Planning → Tournées

- `099` :
  - `quote_items.unit_cost_ht NUMERIC DEFAULT NULL` — coût interne unitaire HT sur chaque ligne de devis
  - `invoice_items.unit_cost_ht NUMERIC DEFAULT NULL` — idem sur factures, copié depuis la ligne de devis lors de la conversion
  - alimenté automatiquement depuis le catalogue (`purchase_price` matériaux, `cost_rate` MO, `unit_cost_ht` prestations types)
  - jamais transmis au client (invisible sur les PDFs) — sert à calculer la marge ligne par ligne dans la rentabilité chantier
  - **NOTICE :** migration additive, aucun effet de bord. Les lignes existantes restent `NULL` (fallback sur le taux org/membre au calcul).

- `100` :
  - nouvelle table `org_annual_objectives` — objectifs annuels par organisation et par année : `revenue_ht_target`, `margin_eur_target`, `margin_pct_target`, `chantiers_count_target`, `hours_target`, `clients_count_target`, plus champs custom JSON
  - RLS via `organization_id` — lecture/écriture owner uniquement
  - **obligatoire avant d'utiliser** : la section Objectifs annuels dans le dashboard et les rapports

- `101` :
  - `organizations.tva_sur_debits BOOLEAN NOT NULL DEFAULT false` — active la TVA sur les débits (vs sur les encaissements par défaut)
  - impacte le calcul de la TVA collectée dans les rapports mensuels et l'export FEC : en mode débits, la TVA est imputée à la date de facturation ; en mode encaissements, à la date du paiement
  - configurable dans Settings → Organisation → TVA
  - **NOTICE :** migration additive. Tous les clients existants restent en mode encaissements (`false`) jusqu'à modification manuelle.

- `102` :
  - `chantier_pointages.rate_snapshot NUMERIC(8,2) DEFAULT NULL` — snapshot du taux horaire (€/h) figé au moment de la saisie du pointage
  - permet à la rentabilité chantier d'utiliser le taux historique même si le taux org/membre a changé depuis
  - `NULL` sur les pointages antérieurs à cette migration : le calcul de rentabilité tombe en fallback sur le taux actuel du membre ou de l'org
  - **NOTICE :** migration additive. Les pointages futurs seront automatiquement snapshotés.

- `103` :
  - nouvelle table `organization_einvoicing_config` — copie locale de la configuration e-facturation pilotée par le cockpit
  - modes supportés : `off`, `export_only`, `b2brouter`
  - `export_only` prépare/télécharge le Factur-X sans transmission PA par Atelier
  - `b2brouter` active la réception UI 2026 et prépare l'orchestration B2Brouter via `b2brouter_account_id`
  - **NOTICE :** migration additive. Le défaut est `off`; appliquer une offre depuis `/orsayn` pour pousser la config réelle.

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
- `083` : obligatoire avant le nouveau cockpit quotas ; après push, appliquer un tier depuis `/orsayn` pour peupler `organization_modules.quota_config`
- `103` : obligatoire avant que le cockpit puisse pousser `einvoicing_config` vers une instance client ; après push, utiliser `/orsayn` → Facturation électronique → mode `off` / `export_only` / `b2brouter`
- après migration, vérifier rapidement dans l'app :
  - Settings → activité métier bien sélectionnée
  - Catalogue → création/édition produit/service OK
  - Catalogue → variantes tarifaires enregistrables
  - Formulaire public → affichage correct des produits/services configurés
  - Settings → Données & confidentialité → génération d'un export complet OK
  - Settings → Modules → modules IA visibles et activables
  - Cockpit Orsayn → quotas visibles pour le client, config sync `synced`, un appel IA remonte dans `operator_client_quotas`
- après migration `074`, vérifier dans l'app :
  - Catalogue → onglet "Fournisseurs" visible et opérationnel (CRUD + import CSV)
  - Catalogue → bouton "Ajouter avec l'IA" visible si module `catalog_ai` activé (via Cockpit ou SQL)
  - Matières/produits → champ fournisseur peut être lié à un fournisseur de la table `suppliers`
- `078` :
  - création de `invoice_payment_schedule` (versements prévisionnels avec `label`, `due_date`, `amount`, `amount_type`, `percentage`, `paid_payment_id`)
  - RLS via `invoices.view` / `invoices.edit` / `invoices.record_payment`
  - fonction atomique `record_invoice_schedule_payment` : crée le `payment`, lie l'échéance, met à jour `total_paid` + `status` de la facture en une seule transaction
- `079` : correctif idempotent des colonnes `amount_type` et `percentage` sur `invoice_payment_schedule` (table créée sans elles sur certains clients avant 078 complet)
- `080` :
  - création de `contracts` (sous-traitance / maintenance ; rôles donneur_ordre / sous_traitant ; statuts draft / sent / signed / archived)
  - RLS via les nouvelles permissions `contracts.*` (view / create / edit / delete)
  - permissions insérées automatiquement pour owner / admin / manager
- `081` : création de `contract_templates` — templates de clauses personnalisés par organisation, liés à un type de contrat
- `082` : ajout de `custom_sections JSONB DEFAULT '[]'` sur `contracts` et `contract_templates` — sections libres ordonnées pour le PDF

Impact déploiement 078–082 :
- `078` + `079` : appliquer avant d'utiliser l'échéancier de paiement dans l'éditeur de facture — sans ça les inserts sur `invoice_payment_schedule` échouent
- `080` + `081` + `082` : appliquer avant d'utiliser le module Contrats — sans `contracts` la page `/contracts` plante au chargement ; sans `082` les sections libres ne sont pas sauvegardées
- après migration `080`, vérifier dans l'app :
  - Menu latéral → onglet "Contrats" visible
  - Contrats → créer un brouillon → PDF généré OK
  - Settings → Rôles → permissions `contracts.*` visibles

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
NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER=+33700000000  ← Numéro affiché dans Settings → WhatsApp (format +33...)
# Mode Twilio mutualisé : TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN et TWILIO_WHATSAPP_FROM restent côté cockpit/routeur Orsayn, pas dans le Worker client.
# Mode Meta/Graph-compatible uniquement :
# SHARED_WABA_PHONE_NUMBER_ID=...      ← Phone Number ID du numéro bot Atelier
# SHARED_WABA_ACCESS_TOKEN=...         ← Token permanent du numéro bot Atelier
OPERATOR_INGEST_URL=https://orsayn-cockpit.mbebourasam.workers.dev/api/operator/ingest  ← URL du cockpit Orsayn
OPERATOR_INGEST_SECRET=...             ← secret HMAC partagé (identique sur toutes les instances + cockpit)
OPERATOR_CONFIG_SYNC_SECRET=...        ← optionnel ; si absent, /api/operator/config-sync utilise OPERATOR_INGEST_SECRET
# OPERATOR_SOURCE_INSTANCE=nom-client ← optionnel : si absent, utilise le host de NEXT_PUBLIC_APP_URL (ex: atelier-weber.workers.dev). Renommable dans le cockpit après.

# B2Brouter — uniquement si einvoicing_config.mode = b2brouter
B2BROUTER_ENV=sandbox                   ← sandbox | production
B2BROUTER_API_VERSION=2026-03-02        ← version minimum DGFiP
B2BROUTER_API_KEY=...                   ← secret API B2Brouter eDocExchange
B2BROUTER_ACCOUNT_ID=...                ← account id B2Brouter du compte client (sandbox/prod distincts)
B2BROUTER_WEBHOOK_SECRET=...            ← signing secret webhook B2Brouter, quand les webhooks seront activés
```

> **Note :** les variables `OPERATOR_*` sont optionnelles. Sans `OPERATOR_INGEST_URL/SECRET`, les appels IA fonctionnent normalement mais les coûts ne remontent pas au cockpit (`operator_sync_status = 'skipped'` dans `usage_logs`). Sans secret de config sync, le cockpit garde la configuration client en `skipped` et il faut peupler `organization_modules` / `organization_einvoicing_config` manuellement.

#### Variables cockpit à mettre sur chaque Worker client

Pour qu'un client remonte ses consos IA au cockpit et reçoive les configs poussées depuis `/orsayn`, il suffit de mettre ces variables sur son Worker :

| Variable | Obligatoire | Valeur |
|---|---:|---|
| `OPERATOR_INGEST_URL` | Oui pour la remontée conso | `https://<cockpit>/api/operator/ingest` |
| `OPERATOR_INGEST_SECRET` | Oui pour la remontée conso | Ton secret HMAC partagé |
| `OPERATOR_CONFIG_SYNC_SECRET` | Recommandé | Même valeur que `OPERATOR_INGEST_SECRET` en V1 |
| `OPERATOR_SOURCE_INSTANCE` | Optionnel | Nom court stable du client, sinon fallback sur `NEXT_PUBLIC_APP_URL` |

Tu peux garder le même `OPERATOR_INGEST_SECRET` HMAC pour tous les clients : c'est le modèle V1 le plus simple. Il doit être identique côté cockpit et côté clients. Trade-off connu : si ce secret fuit sur une instance, il faut le faire tourner partout. Plus tard, on pourra passer à un secret par client si tu veux isoler davantage.

Ne mets jamais ces variables cockpit opérateur sur un Worker client :

```env
OPERATOR_MODE=true
OPERATOR_SUPABASE_URL=...
OPERATOR_SUPABASE_SERVICE_ROLE_KEY=...
OPERATOR_ALLOWED_EMAILS=...
```

Elles sont réservées au Worker `orsayn-cockpit`.

> **Note B2Brouter :** en `export_only`, ne pas renseigner les variables `B2BROUTER_*`. En `b2brouter`, le compte est créé/configuré dans l'UI B2Brouter (eDocExchange), puis `B2BROUTER_ACCOUNT_ID` est reporté dans Cloudflare et dans le cockpit. Les environnements sandbox et production ont des clés et account ids distincts.

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
wrangler login   # authentifie vers ton compte Cloudflare
# @opennextjs/cloudflare est une dépendance locale du projet — npm install suffit
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
| **Secret** | `OPERATOR_INGEST_SECRET`, `OPERATOR_CONFIG_SYNC_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`, `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`, `CRON_SECRET`, `MEMBER_SESSION_SECRET`, `RATE_LIMIT_SECRET`; `B2BROUTER_API_KEY` et `B2BROUTER_WEBHOOK_SECRET` seulement en mode B2Brouter ; `SHARED_WABA_ACCESS_TOKEN` seulement en mode Meta/Graph-compatible |
| **Text** | `OPERATOR_MODE`, `OPERATOR_ALLOWED_EMAILS`, `OPERATOR_SUPABASE_URL`, `OPERATOR_USD_TO_EUR_RATE`, `SUPABASE_URL`, `NEXT_PUBLIC_APP_URL`, `AI_RATE_LIMIT_PER_HOUR`, `PUBLIC_FORM_RATE_LIMIT_PER_HOUR`, `OPERATOR_INGEST_URL`, `OPERATOR_SOURCE_INSTANCE`, `B2BROUTER_ENV`, `B2BROUTER_API_VERSION`, `B2BROUTER_ACCOUNT_ID`, `NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER`; `SHARED_WABA_PHONE_NUMBER_ID` seulement en mode Meta/Graph-compatible; et toutes les `NEXT_PUBLIC_LEGAL_*` |

**Mapping Edge Functions Supabase :** l'app Worker utilise `RESEND_FROM_ADDRESS` et `NEXT_PUBLIC_APP_URL`; la fonction Supabase `whatsapp-webhook` reçoit les mêmes valeurs sous `RESEND_FROM_EMAIL` et `APP_URL` via `scripts/deploy-edge-functions.sh`. En mode Twilio mutualisé, le webhook entrant public reste centralisé côté Orsayn.

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
- **Depuis `.env.local`** (clés Atelier identiques partout) : `OPENROUTER_API_KEY`, `MISTRAL_API_KEY`
- **Depuis `.env.local` si mode Meta/Graph-compatible** : `SHARED_WABA_PHONE_NUMBER_ID`, `SHARED_WABA_ACCESS_TOKEN`
- **En argument** (clés propres au client) : `--resend-key`, `--resend-from`, `--app-url`

Cela évite de modifier `.env.local` entre chaque déploiement client.

`APP_URL` est requis pour les liens PDF dans les emails envoyés depuis WhatsApp (`send_quote`, `send_invoice`).

**Architecture WhatsApp mutualisée Twilio :**

Le mode cible est un webhook central côté Orsayn. Twilio ne doit pas être configuré avec une URL Supabase par client.

```
Twilio WhatsApp Atelier
  → https://<cockpit-orsayn>/api/whatsapp/twilio
  → routeur central Orsayn
  → résolution du client via le numéro WhatsApp autorisé
  → traitement sur l'instance client concernée
  → réponse sortante via Twilio
```

Dans ce mode, `whatsapp-webhook` côté Supabase client reste utile comme brique de traitement si le routeur central l'appelle, mais il n'est pas l'URL webhook configurée dans Twilio.

URL webhook client (mode propre WABA Meta/Graph-compatible uniquement) :
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

### 9. PWA / icône d'app client

Chaque instance client expose un manifest dynamique :

```
https://domaine-du-client.fr/api/manifest
```

Comportement :
- `src/app/layout.tsx` injecte automatiquement `<link rel="manifest" href="/api/manifest">`
- `/api/manifest` lit `organizations.name` et `organizations.logo_url`
- si un logo est uploadé dans **Settings → Organisation**, l'app utilise ce logo
- si aucun logo n'est présent, l'app utilise le fallback Atelier
- `/api/app-icon?size=180|192|512` génère des PNG carrés pour favicon, Apple touch icon et manifest PWA
- `display: standalone` + `appleWebApp.capable` permettent l'ouverture sans barre navigateur quand l'app est ajoutée à l'écran d'accueil
- cache navigateur/CDN : `Cache-Control: public, max-age=3600` sur le manifest et les icônes

Impact support appareils :
- iPhone/iPad : icône via `apple-touch-icon` (`/api/app-icon?size=180`)
- Android/Chrome : icônes `192x192` et `512x512` via manifest
- Desktop/browser : favicon dynamique via `/api/app-icon?size=192`

À savoir :
- après upload ou remplacement du logo, l'icône peut rester en cache jusqu'à 1h
- pour un rendu propre, conseiller au client un logo lisible en carré, idéalement PNG/SVG avec fond transparent ou fond clair
- le bucket `logos` doit rester public en lecture, car l'icône est générée côté serveur à partir de `logo_url`

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
- [ ] **PWA/icône** : uploader un logo dans Settings → ouvrir `/api/manifest` et `/api/app-icon?size=180` → vérifier nom entreprise + icône PNG, puis ajouter l'app à l'écran d'accueil sur iPhone/Android
- [ ] **Échéancier facture** : éditeur facture → ajouter des échéances de paiement → encaisser une échéance → vérifier `total_paid` + statut `partial`/`paid` mis à jour
- [ ] **Contrats** : Contrats → nouveau brouillon sous-traitance → remplir les clauses → générer PDF → envoyer → signer → vérifier statuts et PDF archivé
- [ ] **Templates contrats** : Contrats → nouveau template → sauvegarder → créer un contrat depuis ce template → clauses pré-remplies
- [ ] **Permissions granulaires** : Settings → Rôles → vérifier que `chantiers.planning`, `chantiers.profitability.view`, `chantiers.manage_pointages` apparaissent correctement ; vérifier que les rôles `collaborateur` et `employee` ne voient pas "Modifier chantier" ni "Créer facture"
- [ ] **Objectifs membres** : Chantier → Équipe → fiche membre → onglet Objectifs → créer un objectif mensuel → vérifier sauvegarde
- [ ] **Situations de travaux** : Finances → sélectionner un devis signé → onglet Situations → créer situation 1 à 30% → vérifier `situation_number`, `cumulative_pct`, `retention_amount` en DB
- [ ] **Adresse de départ tournée** : Settings → Organisation → renseigner l'adresse de départ → Planning → Tournées → vérifier que le point de départ est pré-rempli
- [ ] **Rapports** : Menu → Rapports → vérifier rapport mensuel (CA HT/TTC, encaissé, TVA, bénéfice estimé), rapport annuel (courbes), top clients, top chantiers
- [ ] **Export FEC** : Rapports → Export → sélectionner une période → télécharger le FEC → vérifier format DGFiP (colonnes JournalCode, EcritureDate, Debit, Credit…)
- [ ] **Export CSV comptable** : même parcours → CSV → ouvrir dans tableur → colonnes normalisées présentes
- [ ] **Objectifs annuels** : Settings → Objectifs → saisir CA cible → Dashboard → vérifier barre de progression visible
- [ ] **TVA sur débits** : Settings → Organisation → activer "TVA sur débits" → vérifier que le rapport mensuel impute la TVA à la date de facturation
- [ ] **Coût unitaire catalogue** : créer un article avec prix d'achat → générer un devis avec cet article → vérifier que `unit_cost_ht` est renseigné sur la ligne (via Supabase ou onglet Rentabilité si visible)
- [ ] **Factures reçues** *(si `einvoicing_config.mode = 'b2brouter'`)* : Finances → Factures reçues → vérifier réception/statuts (reçue / à payer / payée)

### Checklist onboarding WhatsApp client (mode mutualisé)

> Le client n'a **aucun compte Meta à créer**. Tout passe par le numéro bot Atelier sur Twilio et par le webhook central Orsayn.

Architecture retenue :
```
Twilio WhatsApp Atelier
  → webhook central Orsayn
  → routing par numéro autorisé
  → instance client concernée
```

**Toi (une fois le Worker déployé) :**
- [ ] Activer le module WhatsApp dans Cockpit Orsayn ou directement en DB : `UPDATE organization_modules SET whatsapp_agent = true WHERE organization_id = '<id>'`
- [ ] Ajouter/valider la route WhatsApp du client dans le cockpit Orsayn : numéro autorisé → `source_instance` / `organization_id`

**Le client (dans son app → Settings → Agent WhatsApp) :**
- [ ] Cocher "Utiliser le numéro Atelier mutualisé"
- [ ] Ajouter ses numéros autorisés (lui + son équipe) au format +33...
- [ ] Envoyer "bonjour" depuis un numéro autorisé → l'agent répond avec le contexte de son entreprise

> Le numéro bot affiché dans Settings est `NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER` injecté au déploiement.

---

### Activation WhatsApp mutualisé Twilio une fois la vérification Atelier terminée

> Cette section s'applique quand le numéro WhatsApp Atelier est validé chez Twilio. En attente au 2026-05-13.

**Décision d'architecture : webhook central Orsayn obligatoire**

Pour le mode mutualisé Twilio, ne pas configurer Twilio vers les Edge Functions Supabase des clients. Twilio appelle une seule URL, côté cockpit Orsayn.

```
Twilio
  → https://<cockpit-orsayn>/api/whatsapp/twilio
  → table de routes opérateur
  → client Supabase/Worker concerné
```

Le routeur central doit gérer :
- parsing du webhook Twilio entrant (`From`, `To`, `Body`, médias)
- résolution du client via le numéro autorisé
- appel du traitement IA/métier de l'instance client
- envoi de la réponse via Twilio
- journalisation usage IA dans le cockpit Orsayn

**Étape 1 — Récupérer les credentials Twilio du numéro bot**

| Fournisseur | Ce qu'il faut récupérer |
|-------------|------------------------|
| **Twilio mutualisé** | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, WhatsApp Sender number (`whatsapp:+33...`) |
| **Meta direct / WABA propre client** | `Phone Number ID` + token permanent Graph API |

**Étape 2 — Renseigner les variables centralisées du cockpit Orsayn**

```bash
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_WHATSAPP_FROM=whatsapp:+33700000000
NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER=+33700000000
```

Ces variables sont partagées entre tous les clients, mais les secrets Twilio doivent rester côté cockpit/routeur Orsayn. Les Workers clients n'ont besoin que de `NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER` pour afficher le numéro dans Settings.

**Étape 3 — Déployer ou mettre à jour le routeur central Orsayn**

Le routeur central reçoit les messages Twilio et route vers le bon client. Prévoir une table opérateur dédiée, par exemple :

```sql
operator_whatsapp_routes (
  id,
  source_instance,
  organization_id,
  authorized_number,
  label,
  is_active,
  created_at,
  updated_at
)
```

**Étape 4 — Configurer le webhook Twilio entrant**

Dans Twilio, configurer le WhatsApp Sender pour appeler uniquement :

```
https://<cockpit-orsayn>/api/whatsapp/twilio
```

**Étape 5 — Redéployer l'app client si le numéro affiché change**

Injecter/mettre à jour `NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER` dans les variables Cloudflare Workers clients, puis redéployer si nécessaire.

```bash
./scripts/deploy-all-clients.sh
```

**Étape 6 — Activer les clients**

Pour chaque client prêt à utiliser WhatsApp :
```sql
UPDATE organization_modules SET whatsapp_agent = true WHERE organization_id = '<id>';
```
Puis créer/mettre à jour la route centrale Orsayn pour chaque numéro autorisé. Le client peut aussi gérer ses numéros dans Settings → Agent WhatsApp, mais la source de vérité opérationnelle du routage Twilio mutualisé doit être disponible dans le cockpit central.

**Cas séparé — WABA propre client**

Si un client utilise son propre Meta/WABA Graph-compatible, il peut conserver le webhook Supabase client :

```
https://<PROJECT_REF>.supabase.co/functions/v1/whatsapp-webhook
```

Ce mode n'utilise pas le numéro Twilio mutualisé Atelier.

---

## ─── COCKPIT ORSAYN (déploiement unique, une seule fois) ────────────────────────

> Le cockpit est **ton** tableau de bord privé. Il tourne sur un déploiement Cloudflare Workers séparé, connecté à son propre projet Supabase. Il n'a rien à voir avec les instances clientes.
> Si le cockpit est déjà déployé, ne recrée pas de projet : applique seulement les nouvelles migrations opérateur sur le Supabase du cockpit, puis redéploie le Worker cockpit.

### Ce qu'il faut faire une fois

**T-O1 — Créer le projet Supabase opérateur**
- Nouveau projet Supabase (ex: `orsayn-operator`) dans la même région
- Appliquer `supabase/operator-migrations/001_operator_usage.sql`
- Puis appliquer `supabase/operator-migrations/002_operator_client_settings.sql`
- Puis appliquer `supabase/operator-migrations/003_operator_subscriptions_quotas.sql`
- Puis appliquer `supabase/operator-migrations/004_operator_einvoicing_config.sql`
- Puis appliquer `supabase/operator-migrations/005_operator_cockpit_actions.sql`
- Récupérer l'URL et la service role key

**Pour un cockpit déjà existant :**
- Ne pas appliquer ces migrations sur le Supabase d'un client.
- Appliquer uniquement les nouvelles migrations manquantes sur le Supabase opérateur du cockpit.
- Pour la release actuelle, appliquer au minimum `supabase/operator-migrations/005_operator_cockpit_actions.sql`.

**T-O2 — Déployer le cockpit sur Cloudflare Workers**
- Même repo GitHub, nouveau projet Cloudflare Workers (ex: `atelier-orsayn`)
- Même `wrangler.jsonc` que les instances clientes : seule la variable d'environnement change
- Déploiement dédié :

```bash
./scripts/deploy-cockpit.sh orsayn-cockpit
```

- Variables d'environnement spécifiques au cockpit :

```env
OPERATOR_MODE=true
OPERATOR_INGEST_SECRET=...                   ← même secret que sur les instances clientes
OPERATOR_CONFIG_SYNC_SECRET=...              ← recommandé : même valeur que OPERATOR_INGEST_SECRET en V1
OPERATOR_ALLOWED_EMAILS=mbebourasam@gmail.com
OPERATOR_SUPABASE_URL=https://<operateur-ref>.supabase.co
OPERATOR_SUPABASE_SERVICE_ROLE_KEY=eyJ...    ← service role du Supabase opérateur
OPERATOR_USD_TO_EUR_RATE=0.92                ← taux fixe V1 pour marge et synthèse globale
RESEND_API_KEY=re_...                        ← clé Resend Orsayn pour les emails commerciaux (relances, upgrades, essais)
RESEND_FROM_ADDRESS=no-reply@orsayn.fr       ← expéditeur des emails cockpit

# Variables Supabase standard (pour l'auth de la page /orsayn)
SUPABASE_URL=https://<operateur-ref>.supabase.co
SUPABASE_ANON_KEY=eyJ...
NEXT_PUBLIC_APP_URL=https://orsayn-cockpit.mbebourasam.workers.dev
```

> **Important :** ne pas mettre `OPERATOR_MODE=true` sur les instances clientes — ça activerait l'endpoint d'ingestion et la page cockpit chez le client.
> **Important :** ne pas mettre `orsayn-cockpit` dans `scripts/clients.txt`. `deploy-all-clients.sh` ne doit déployer que les Workers clients.

**T-O3 — URL cockpit**
- URL native Cloudflare Workers : `https://orsayn-cockpit.mbebourasam.workers.dev` (pas de domaine custom à configurer)
- C'est cette URL qui doit être renseignée dans `OPERATOR_INGEST_URL` sur toutes les instances clientes

### Accès au cockpit

URL : `https://orsayn-cockpit.mbebourasam.workers.dev/orsayn`
Connexion avec le compte Supabase opérateur dont l'email est dans `OPERATOR_ALLOWED_EMAILS`.

### Checklist cockpit

- [ ] `001_operator_usage.sql` + `002_operator_client_settings.sql` + `003_operator_subscriptions_quotas.sql` + `004_operator_einvoicing_config.sql` + `005_operator_cockpit_actions.sql` appliqués sur le Supabase opérateur
- [ ] Tables opérateur créées : `operator_clients`, `operator_usage_events`, `operator_whatsapp_cost_snapshots`, `operator_client_settings`, `operator_client_subscriptions`, `operator_client_quotas`, `operator_quota_usage_events`, `operator_client_events`, `operator_commercial_events`
- [ ] Colonnes e-facturation présentes sur `operator_client_subscriptions` : `einvoicing_mode`, `einvoicing_environment`, `b2brouter_account_id`, `einvoicing_annuaire_status`
- [ ] Colonne essai présente : `operator_client_subscriptions.trial_converted`
- [ ] Colonne pricing IA présente : `operator_client_subscriptions.ai_billing_mode`
- [ ] Variables d'env cockpit injectées dans Cloudflare Workers (y compris `RESEND_API_KEY` + `RESEND_FROM_ADDRESS` pour les emails commerciaux)
- [ ] Page `/orsayn` accessible (renvoie 404 sinon → `OPERATOR_MODE` non reconnu)
- [ ] Envoyer un appel IA de test depuis une instance cliente → vérifier que l'event apparaît dans le cockpit
- [ ] Renseigner un `monthly_fee_ht` dans le cockpit → vérifier le calcul de marge
- [ ] Choisir un mode e-facturation dans le cockpit → vérifier `organization_einvoicing_config` côté instance client après config-sync
- [ ] Activer un essai 30j Expert sur un client test → vérifier `trial_tier` + `trial_ends_at` dans `operator_client_subscriptions`
- [ ] Vérifier le journal cockpit : une ligne `trial_started` doit apparaître dans `operator_client_events`
- [ ] Cron trial-expiry configuré sur cron-job.org (voir §Crons cockpit ci-dessous) → laisser expirer l'essai test → vérifier désactivation modules + email `trial-expired`

### Crons cockpit — essais et relances commerciales

Ces crons tournent sur le **cockpit Orsayn** (pas sur les instances clientes). À configurer sur cron-job.org en pointant sur `https://orsayn-cockpit.mbebourasam.workers.dev`.

| Route | Fréquence | Rôle |
|-------|-----------|------|
| `POST /api/cron/trial-expiry-check` | Tous les jours à 02:00 UTC | Vérifie les essais expirés → désactive modules côté instance + envoie `trial-expired` |
| `POST /api/cron/trial-reminder` | Tous les jours à 08:00 UTC | Envoie `trial-expiry-7d` à J-7 et `trial-expiry-2d` à J-2 |
| `POST /api/cron/trial-lapsed-followup` | Tous les jours à 09:00 UTC | Envoie `trial-expired-14d` aux essais expirés sans conversion depuis 14 jours |
| `POST /api/cron/quota-alerts` | Tous les jours à 10:00 UTC | Envoie `upgrade-prompt-quota` et `upgrade-prompt-wa` aux clients proches ou dépassant leur quota |

**Authentification :** header `x-operator-secret: <OPERATOR_INGEST_SECRET>` sur chaque cron.

**Idempotence :** chaque cron vérifie `operator_commercial_events` avant d'envoyer — si l'event du même type pour le même client existe déjà dans la fenêtre de cooldown attendue, l'email ne repart pas.

```bash
# Tester manuellement (remplacer le secret)
curl -X POST https://orsayn-cockpit.mbebourasam.workers.dev/api/cron/trial-expiry-check \
  -H "x-operator-secret: <OPERATOR_INGEST_SECRET>"

curl -X POST https://orsayn-cockpit.mbebourasam.workers.dev/api/cron/quota-alerts \
  -H "x-operator-secret: <OPERATOR_INGEST_SECRET>"
```

---

## ─── MODULES & UPGRADES PAR CLIENT ─────────────────────────────────────────────

> Règle d'or : **même code pour tous les clients, configuration différente par client**.

Un client peut avoir B2Brouter, un autre non. Un client peut utiliser ta clé OpenRouter, un autre sa propre clé. Un client peut avoir seulement Devis IA, un autre Planning IA + Documents IA + WhatsApp. On ne crée pas de branche, pas de fork, pas de version spéciale.

### Les 3 niveaux de configuration

| Niveau | Sert à quoi | Exemples | Où ça vit |
|--------|-------------|----------|-----------|
| **Flags produit** | Afficher/autoriser une fonctionnalité | `quote_ai`, `planning_ai`, `document_import_ai`, `catalog_ai`, `whatsapp_agent` | Table `organization_modules`, pilotée depuis Cockpit Orsayn |
| **Configuration orchestrée** | Appliquer un mode produit hors IA | `einvoicing_config.mode`, `einvoicing_config.provider`, `einvoicing_config.environment` | Cockpit Orsayn puis copie locale `organization_einvoicing_config` |
| **Secrets infra** | Donner accès à un provider externe | `OPENROUTER_API_KEY`, `B2BROUTER_API_KEY`, `RESEND_API_KEY` | Variables/secrets du Worker client ou Edge Function |
| **Paramètres métier** | Adapter l'usage client | tarifs, SIREN, IBAN, modules, numéros WhatsApp autorisés | Base Supabase client + cockpit |

Un flag sans secret ne suffit pas : la fonctionnalité apparaît peut-être, mais l'appel provider échoue. Un secret sans flag ne suffit pas non plus : le provider est configuré, mais la fonctionnalité reste désactivée côté produit.

### V1 core livrée par défaut

Chaque nouveau client est livré en V1 core :
- app web complète
- devis/factures/PDF
- chantiers/catalogue/planning
- emails
- IA selon le pack vendu
- facturation électronique en mode `export_only`
- B2Brouter désactivé par défaut
- WhatsApp désactivé tant que le module n'est pas activé

Le mode `export_only` est inclus comme socle conformité : PDF + XML/Factur-X téléchargeable, avec envoi PDF/email normal tant que l'obligation d'émission n'est pas active. L'app ne marque pas une facture comme déposée sur une PA tant que ce flux n'est pas réellement connecté.

### Upgrades activables après livraison

#### Upgrade B2Brouter

B2Brouter est un upgrade client par client.

```text
Client A → export_only
Client B → export_only
Client C → b2brouter intégré
```

Activation :
1. Valider le flux sandbox / compte B2Brouter du client
2. Ajouter les secrets du client dans son Worker :
   - `B2BROUTER_API_KEY`
   - `B2BROUTER_ACCOUNT_ID`
   - `B2BROUTER_WEBHOOK_SECRET`
3. Passer `einvoicing_config.mode` à `b2brouter` dans le cockpit, renseigner environnement, modèle `edoc_exchange`, `account_id` et statut annuaire
4. Tester une facture sandbox ou pilote
5. Passer prod quand le client est prêt

Le client qui ne prend pas l'upgrade reste en `export_only`. Rien ne change pour lui.

#### Upgrade IA par module

Les modules IA sont indépendants :

```text
Client A → Devis IA uniquement
Client B → Devis IA + Planning IA
Client C → Documents IA + Catalogue IA + Assistant chantier
```

Flags existants :
- `quote_ai`
- `planning_ai`
- `document_import_ai`
- `relances_ai`
- `weekly_summary`
- `chantier_assistant`
- `suggest_tasks`
- `catalog_ai`
- `chantier_report_ai`
- `labor_estimate_ai`
- `receipt_ocr`
- `voice_input`
- `whatsapp_agent`
- `whatsapp_ocr`
- `whatsapp_proactive`

Activation :
1. Cockpit Orsayn → appliquer le tier ou cocher/décocher les modules du client
2. Vérifier que `OPENROUTER_API_KEY` est bien configurée sur son Worker
3. Vérifier que `organization_modules.quota_config` est peuplé et que `/orsayn` affiche les quotas du mois courant
3. Tester un appel IA de chaque module vendu
4. Vérifier la remontée dans `usage_logs` puis cockpit Orsayn

#### Clés IA Atelier ou client

Deux clients peuvent avoir deux modes différents :

```text
Client A → clés IA Atelier, coût porté par Orsayn
Client B → clés IA du client, coût porté par le client
```

Pour OpenRouter, le code lit toujours `OPENROUTER_API_KEY`. La différence vient seulement de la valeur injectée dans le Worker et les Edge Functions du client.

Pour Mistral/Voxtral, même principe avec `MISTRAL_API_KEY`, surtout pour la transcription vocale. Par défaut, on utilise la clé Mistral Orsayn car le coût vocal est faible. Un client autonome ou à gros usage vocal peut fournir sa propre clé Mistral.

Mode Atelier :
- `OPENROUTER_API_KEY` = clé Orsayn
- `MISTRAL_API_KEY` = clé Orsayn
- Orsayn porte le coût IA
- usage visible dans OpenRouter Orsayn + cockpit Orsayn

Mode client :
- `OPENROUTER_API_KEY` = clé fournie par le client
- `MISTRAL_API_KEY` = clé fournie par le client si le client veut aussi porter le coût vocal
- le client paye OpenRouter, et éventuellement Mistral, directement
- Orsayn voit quand même l'usage passé par Atelier via `usage_logs` et le cockpit
- Orsayn ne voit pas les usages faits par le client hors Atelier

#### Upgrade WhatsApp

WhatsApp mutualisé Twilio est aussi activable client par client :
1. Activer `whatsapp_agent`
2. Ajouter les numéros autorisés dans le cockpit/routeur central
3. Afficher le numéro bot Atelier via `NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER`
4. Tester "bonjour" depuis un numéro autorisé

Un client sans WhatsApp garde l'app web inchangée.

### Matrice d'exemples

| Client | IA | OpenRouter | Fact. élec. | WhatsApp |
|--------|----|------------|-------------|----------|
| Artisan Starter | Devis IA | Clé Atelier | `export_only` | Non |
| Client autonome IA | Devis + Documents | Clé client | `export_only` | Non |
| Client conformité | Devis IA | Clé Atelier | B2Brouter | Non |
| Client premium terrain | Tous modules IA | Clé Atelier ou client | B2Brouter | Oui |

### Procédure en cas de demande client spécifique

Ne jamais modifier le code pour répondre à une demande individuelle tant que la demande peut être couverte par :
1. un flag `organization_modules`
2. une variable/secrète par Worker
3. un paramètre métier en base
4. une ligne de configuration cockpit

Créer du code spécifique client uniquement si la fonctionnalité a vocation à devenir un module réutilisable.

---

## ─── FACTURATION ÉLECTRONIQUE 2026 ─────────────────────────────────────────────

> Obligatoire : réception sept. 2026 / émission sept. 2027 (TPE/PME/artisans).

**Stratégie Atelier :** `export_only` pour tous les clients par défaut, puis B2Brouter comme upgrade intégré pour les clients qui le veulent. En mode B2Brouter, prévoir une clé/API ou un compte B2Brouter propre au client.

### Checklist par client en `export_only` (socle par défaut)

- [ ] Renseigner IBAN/BIC dans Settings → Paiement & RIB
- [ ] Renseigner SIREN sur chaque fiche client
- [ ] Vérifier téléchargement PDF + XML/Factur-X
- [ ] Conserver l'envoi normal PDF/email tant que l'émission obligatoire n'est pas active

### Checklist upgrade B2Brouter

- [ ] Ouvrir compte sandbox B2Brouter
- [ ] Récupérer `B2BROUTER_API_KEY` + `B2BROUTER_ACCOUNT_ID`
- [ ] Injecter les secrets dans le Worker client
- [ ] Configurer `einvoicing_config.mode = 'b2brouter'` dans le cockpit
- [ ] Tester réception sandbox 2026, puis émission sandbox avant passage prod quand le flux émission est activé

### Checklist de dev (non bloquant avant 2026)

- [ ] Validation du Factur-X EN 16931 Comfort existant dans le flux réel
- [ ] SIREN dans fiche client (UI + PDF)
- [ ] Type opération + TVA débits dans éditeur facture
- [ ] App client : réception 2026 uniquement si `einvoicing_config.mode = 'b2brouter'`
- [ ] `POST /api/webhooks/b2brouter-reception` → stockage factures reçues
- [ ] App client : UI factures reçues dans Finances
- [ ] Émission via API B2Brouter pour l'échéance 2027

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

Deux modes disponibles, choisissables client par client au moment du déploiement.

**Mode A — Clé Atelier partagée (défaut)**

1 clé OpenRouter Atelier et 1 clé Mistral Atelier injectées dans les Edge Functions et Workers depuis `.env.local`. Tu portes le coût IA et tu le répercutes dans l'abonnement mensuel.

Dans le cockpit : `ai_billing_mode = 'orsayn_shared'`.

Avantage : zéro gestion côté client. Inconvénient : si la clé est compromise, tous les clients sont touchés.

Déploiement Edge Function :
```bash
./scripts/deploy-edge-functions.sh <PROJECT_REF> \
  --resend-key re_xxx --resend-from contact@client.fr --app-url https://client.fr
# OPENROUTER_API_KEY et MISTRAL_API_KEY lues automatiquement depuis .env.local
```

Déploiement Worker Cloudflare : injecter `OPENROUTER_API_KEY` et `MISTRAL_API_KEY` (clés Atelier) dans les variables du Worker.

**Mode B — Clé propre au client**

Le client crée son compte sur [openrouter.ai](https://openrouter.ai), génère une clé API, et te la fournit dans le protocole de session. Il paye directement OpenRouter — tu n'es plus revendeur IA pour ce client. Risque isolé, facturation simplifiée.

Dans le cockpit : `ai_billing_mode = 'client_owned'`. La consommation reste visible pour le pricing, mais elle n'est pas soustraite de la marge Orsayn.

Pour Mistral, deux choix :
- par défaut : garder `MISTRAL_API_KEY` Orsayn, même si OpenRouter est côté client
- autonomie complète : injecter aussi une `MISTRAL_API_KEY` fournie par le client, notamment si gros usage vocal

Déploiement Edge Function :
```bash
./scripts/deploy-edge-functions.sh <PROJECT_REF> \
  --openrouter-key sk-or-clientxxx \
  --resend-key re_xxx --resend-from contact@client.fr --app-url https://client.fr
# La clé Atelier dans .env.local est ignorée pour ce client
```

Déploiement Worker Cloudflare : injecter la clé client à la place de la clé Atelier dans `OPENROUTER_API_KEY` du Worker. Pour Mistral, injecter `MISTRAL_API_KEY` Orsayn ou client selon le mode choisi.

**Cas sans domaine custom :** le client utilise l'URL `atelier-nomclient.workers.dev`. T2 (Resend + domaine) disparaît. Les emails sortants (devis, factures, invitations) partent depuis `noreply@atelier.orsayn.fr` (Resend Atelier mutualisé) — à configurer en injectant les variables Resend Atelier dans le Worker du client.

**Suivi de consommation par client (mode A) :** chaque appel IA logge dans `usage_logs` avec `organization_id`. Tu peux requêter via le cockpit Orsayn ou directement :
```sql
SELECT organization_id, feature, sum(tokens_input + tokens_output) as tokens, sum(cost_usd) as cout_usd
FROM usage_logs
WHERE created_at > now() - interval '30 days'
GROUP BY organization_id, feature;
```

**Aujourd'hui :** clés Atelier partagées par défaut. `OPENROUTER_API_KEY` peut être remplacée par une clé client via `--openrouter-key`. `MISTRAL_API_KEY` reste Atelier par défaut, sauf client autonome vocal.

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

Trois situations possibles — le mode est piloté par `einvoicing_config.mode` dans le cockpit, puis copié localement dans `organization_einvoicing_config`.

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

#### Tier 3 — B2Brouter intégré (`einvoicing_config.mode = 'b2brouter'`)

B2Brouter est facturé annuellement en prestation séparée du MRR — il ne rentre pas dans les marges mensuelles. Coût Atelier type M0 : 15€/mois (180€/an) + activation 150€ an 1. Refacturé client : 250€/an + activation 200€.

La marge sur le MRR reste identique aux tiers précédents. B2Brouter est une ligne séparée dans le devis setup/annuel, pas dans le MRR.

**Résumé de la logique tarifaire :**
- Export only → inclus dans tous les setups, argument commercial gratuit, coût Atelier 0€
- B2Brouter → prestation annuelle séparée (~250€-900€/an selon volume) + activation 200€ an 1 — ne pas intégrer dans le MRR mensuel

### B2Brouter — grille tarifaire officielle (HT)

Source : tarifs B2Brouter mai 2026. Facturation mensuelle, engagement annuel, payé d'avance. Frais d'activation 150€ HT one-shot la première année.

| Tranche | Transactions incluses/mois | Prix/mois HT | Trans. suppl. HT | Coût annuel HT (hors activation) | Coût an 1 (avec activation) |
|---------|---------------------------|--------------|-----------------|----------------------------------|----------------------------|
| M0 | 1-50 | 15€ | 0,435€ | 180€ | 330€ |
| M1 | 51-100 | 29€ | 0,435€ | 348€ | 498€ |
| M2 | 101-300 | 59€ | 0,295€ | 708€ | 858€ |
| M3 | 301-600 | 89€ | 0,222€ | 1 068€ | 1 218€ |
| M4 | 601-1 500 | 169€ | 0,169€ | 2 028€ | 2 178€ |
| M5 | 1 501-4 000 | 520€ | 0,130€ | 6 240€ | 6 390€ |
| M6 | 4 001-10 000 | 1 100€ | 0,110€ | 13 200€ | Sur devis |
| M7+ | > 10 000 | Sur devis | — | — | Sur devis |

> Une transaction = tout eDocument émis, reçu, ou importé et téléchargé. Transactions non consommées perdues à l'échéance. Changement de tier possible une fois par période contractuelle (réduction : tier inférieur suivant uniquement).

### Profils client Atelier et tranche recommandée

La majorité des artisans BTP (1-5 personnes) émet 10-50 factures/mois et reçoit quelques bons de commande. Le profil type est M0 ou M1.

| Profil client | Volume estimé | Tranche | Coût annuel Atelier |
|---------------|---------------|---------|---------------------|
| Artisan seul, faible volume | < 30 tx/mois | M0 | 180€/an |
| Artisan actif ou petite équipe | 30-80 tx/mois | M0-M1 | 180-348€/an |
| PME BTP, plusieurs chantiers simultanés | 80-250 tx/mois | M1-M2 | 348-708€/an |
| Structure avec achats fournisseurs intenses | 250-500 tx/mois | M2-M3 | 708-1 068€/an |
| Fort volume (promoteur, négoce) | > 500 tx/mois | M3+ | Sur devis |

### Revente B2Brouter — stratégie de facturation client

**Principe :** le coût B2Brouter est annuel et payé d'avance. Il est refacturé au client en prestation annuelle séparée du MRR. Ne pas intégrer B2Brouter dans le MRR mensuel — ça rendrait la grille MRR illisible et crée une confusion entre coût fixe et coût d'usage.

**Marge appliquée :** environ 20-40% sur le coût Atelier selon le profil. L'activation 150€ est refacturée 200€ HT (frais de mise en service).

| Poste | Coût Atelier HT | Refacturé client HT | Marge brute |
|-------|----------------|---------------------|-------------|
| Activation one-shot (an 1 uniquement) | 150€ | 200€ | 50€ |
| Abonnement M0 an 1 | 180€ | 250€/an | 70€ |
| Abonnement M1 an 1 | 348€ | 450€/an | 102€ |
| Abonnement M2 an 1 | 708€ | 900€/an | 192€ |
| Abonnement M3 an 1 | 1 068€ | 1 350€/an | 282€ |

**An 1 :** activation 200€ + abonnement annuel = facturé au client en une ligne dans le devis setup ou en devis séparé.
**An 2+ :** renouvellement annuel uniquement, Atelier préfinance et refacture.

### Frais one-shot à l'onboarding (référence)

| Poste | Montant HT |
|-------|-----------|
| Setup & déploiement | 800€-2 800€ (selon offre) |
| Activation B2Brouter (si fact. élec.) | 200€ |
| Abonnement B2Brouter an 1 selon profil | 250€-1 350€/an |
| **Total avec fact. élec. (profil M0)** | **~1 250€ minimum** |
| **Total sans fact. élec.** | **800€-2 800€** |

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
| `OPENROUTER_API_KEY` | Clé Atelier depuis `.env.local` (défaut) **ou** clé propre au client via `--openrouter-key` | **Selon client** (voir §IA) |
| `MISTRAL_API_KEY` | Clé Atelier Mistral par défaut **ou** clé propre au client si autonomie vocale/IA complète | **Selon client** (Atelier par défaut) |
| `CRON_SECRET` | `openssl rand -hex 32` | Non (unique par client) |
| `MEMBER_SESSION_SECRET` | `openssl rand -hex 32` — signe le cookie de session de l'espace membre `/mon-espace` (HMAC SHA-256) | Non (unique par client) |
| `RATE_LIMIT_SECRET` | `openssl rand -hex 32` — salt de hash rate limit, optionnel si `CRON_SECRET` est présent | Non (unique par client) |
| `AI_RATE_LIMIT_PER_HOUR` | Défaut conseillé `120` | Non |
| `PUBLIC_FORM_RATE_LIMIT_PER_HOUR` | Défaut conseillé `5` | Non |
| `SHARED_WABA_PHONE_NUMBER_ID` | Ancien mode Meta/Graph-compatible : Phone Number ID du numéro bot Atelier | **Seulement si fournisseur Graph-compatible** |
| `SHARED_WABA_ACCESS_TOKEN` | Ancien mode Meta/Graph-compatible : token permanent du numéro bot Atelier | **Seulement si fournisseur Graph-compatible** |
| `NEXT_PUBLIC_SHARED_WABA_DISPLAY_NUMBER` | Numéro bot affiché dans Settings → WhatsApp (format +33...) | **Oui** (même valeur partout, non secret) |
| `TWILIO_ACCOUNT_SID` | Compte Twilio du numéro WhatsApp mutualisé Atelier | **Oui, mais cockpit/routeur Orsayn uniquement** |
| `TWILIO_AUTH_TOKEN` | Auth Token Twilio | **Oui, mais cockpit/routeur Orsayn uniquement** |
| `TWILIO_WHATSAPP_FROM` | Sender WhatsApp Twilio (`whatsapp:+33...`) | **Oui, mais cockpit/routeur Orsayn uniquement** |
| `OPERATOR_INGEST_URL` | URL du cockpit Orsayn | **Oui** (même URL partout) |
| `OPERATOR_INGEST_SECRET` | `openssl rand -hex 32` (généré une fois) | **Oui** (même secret partout) |
| `OPERATOR_CONFIG_SYNC_SECRET` | Secret HMAC pour `/api/operator/config-sync`; en V1 utiliser la même valeur que `OPERATOR_INGEST_SECRET` | **Oui** (même secret partout recommandé) |
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

Le registre `scripts/clients.txt` contient un worker-name client par ligne. Exemple :
```
atelier-weber
atelier-dupont
```

Le cockpit se met à jour séparément :

```bash
./scripts/deploy-cockpit.sh orsayn-cockpit
```

Ordre recommandé pour une release avec migration SQL :
1. Appliquer la migration sur chaque Supabase client (`supabase link --project-ref <ref> && supabase db push`)
2. Lancer `./scripts/deploy-all-clients.sh` pour déployer le code

> **Note :** les déploiements sont séquentiels (pas en parallèle). Pour ~10 clients, compter 3-4 min au total (build unique partagé entre tous les déploiements).

> **Périmètre de `deploy-all-clients.sh` :** couvre uniquement les apps Next.js clientes. Le cockpit, le Worker relances (`workers/auto-reminder`) et les Edge Functions Supabase doivent être redéployés séparément si leur code a changé (voir §Cockpit, §5 et §6).

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
| Weber Tôlerie (**démo**) | `pyxnmohknxmbpbcuvudg` | localhost | 2024 | 001→082 | ❌ | ❌ |
