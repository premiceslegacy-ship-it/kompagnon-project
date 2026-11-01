# Atelier — Déploiement Supabase

Ce dossier contient toutes les migrations SQL pour déployer Atelier sur un nouveau projet Supabase.

**Offre setup 3 000 € :** ne pas créer de projet par client. Les nouveaux setups et les abonnés partagent `atelier-app` ; le tenant est l’organisation. Les étapes de création d’un projet ci-dessous concernent une nouvelle infrastructure explicitement décidée, pas l’onboarding standard. Parcours actuel : [DEPLOIEMENT_CLIENT.md](../DEPLOIEMENT_CLIENT.md), section « Achat setup : droits et livraison ».

**Évolution setup hors abonnement :** appliquer `migrations/215_setup_billing_model.sql` sur la base application et `operator-migrations/022_setup_purchases.sql` sur la base cockpit avant le code correspondant. Ne pas convertir les anciennes lignes `setup_only` par inférence : un paiement validé et une organisation exacte sont requis. Régressions locales transactionnelles : `tests/isolation/app-215-setup-sync.sql` et `tests/isolation/operator-022-setup.sql`. Publier le cockpit avant l’application, en gelant les activations setup jusqu’à la mise en service des deux versions ; ordre et contrôles détaillés dans le guide de livraison.

**Publication réelle vérifiée le 31/10/2026 :** migrations application `215` et cockpit `022` appliquées et journaux comparés à leurs fichiers source ; cockpit puis application publiés depuis le main validé par CI. Les versions actives, workflows, refus d’autorisation et limites de qualification sont consignés dans la section « Qualification et publication de l’évolution setup » du guide de livraison.

**Dossier interne setup, évolution 023 :** `operator-migrations/023_setup_client_onboarding.sql` ajoute les métadonnées de préparation dans le cockpit, pas dans la base application. Appliquer sur une base cockpit 001–022 identifiée, puis publier le code compatible. Recette locale du 01/11/2026 : sauvegarde/relecture, validation humaine, brief Hermes, conflits de révision et refus d’accès ; régression transactionnelle `tests/isolation/operator-023-onboarding.sql`. Cette évolution n’a pas été appliquée en production dans ce passage. Le détail du formulaire et le statut paie figurent dans le guide de livraison.

Les migrations opérateur sont appliquées fichier par fichier dans une transaction unique (`psql --single-transaction -v ON_ERROR_STOP=1 -f ...` dans la CI). Conserver cette atomicité à la publication : création, trigger, RLS et droits ne doivent pas laisser une table intermédiaire exposée.

---

## Ordre des migrations

```
001_extensions.sql        — Extensions PostgreSQL (pgcrypto, uuid-ossp, vector)
002_core_tables.sql       — organizations, profiles, permissions, roles, role_permissions, memberships, invitations
003_catalog_tables.sql    — materials, labor_rates, saved_templates
004_business_tables.sql   — clients, quotes, quote_sections, quote_items, invoices, invoice_items, payments, reminders
005_advanced_tables.sql   — company_memory, goals, email_templates, import_jobs, activity_log, recurring_*, received_invoices, pa_status_events
006_functions.sql         — Fonctions SQL (RLS helpers, numérotation, triggers, init org)
007_triggers.sql          — Triggers (auth → profiles/org, updated_at, métier)
008_rls.sql               — Row Level Security (activation + politiques)
009_indexes.sql           — Index de performance
010_seed_permissions.sql  — Permissions référence (OBLIGATOIRE avant le 1er signup)
```

---

## Déploiement sur un nouveau client

### Étape 1 — Créer le projet Supabase

1. Aller sur [supabase.com](https://supabase.com) → New Project
2. Choisir la région EU (ex: `eu-west-3` Paris)
3. Noter les variables :
   - `Project URL` → `SUPABASE_URL`
   - `anon public key` → `SUPABASE_ANON_KEY`
   - `service_role secret key` → `SUPABASE_SERVICE_ROLE_KEY`

### Étape 2 — Appliquer les migrations

**Option A — Via Supabase CLI (recommandé)**

```bash
# Installer la CLI si besoin
npm install -g supabase

# Se connecter
supabase login

# Lier le projet
supabase link --project-ref <project-ref>

# Appliquer toutes les migrations
supabase db push
```

**Option B — Via l'éditeur SQL du dashboard**

Copier-coller chaque fichier dans l'ordre dans :
Dashboard → SQL Editor → New query → Run

### Étape 3 — Configurer les variables d'environnement

Créer le fichier `.env.local` à la racine du projet Next.js :

```bash
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_APP_URL=https://[votre-domaine.com]

# Optionnel : personnalisation marque
NEXT_PUBLIC_APP_NAME=Atelier
```

### Étape 4 — Vérifier l'activation de l'extension vector

Dans Dashboard → Database → Extensions, vérifier que `vector` est activé.
Si non : activer depuis l'interface ou exécuter `SELECT create_extension('vector')`.

### Étape 5 — Déployer l'application Next.js

```bash
# Vercel
vercel --prod

# ou
npm run build && npm start
```

---

## Ajouter une migration

Quand le schéma évolue, créer un nouveau fichier numéroté :

```
011_add_feature_xyz.sql
```

Convention de nommage : `NNN_description_courte.sql`

Exemple :
```sql
-- 011_add_feature_xyz.sql
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS xyz TEXT;
```

---

## Architecture multi-clients

Les clients de l’offre standard partagent une application et un projet Supabase, avec isolation par organisation et politiques RLS. Le cockpit reste un projet distinct réservé à l’opérateur. Les instances dédiées historiques utilisent le même schéma applicatif ; elles ne constituent pas le parcours par défaut des nouveaux setups.

---

## Notes importantes

- **`010_seed_permissions.sql` est critique** : doit être exécuté avant le 1er signup, sinon `initialize_organization_for_user` ne peut pas assigner les permissions aux rôles.
- **Triggers auth** (`007_triggers.sql`) : nécessitent les droits `service_role`. Via Supabase CLI ou l'éditeur SQL du dashboard uniquement.
- **RLS** : toutes les tables sont protégées. Les mutations admin (webhook Stripe, invitations) utilisent le `service_role` key côté serveur.
- **join_code** : généré automatiquement à la création de chaque organisation. Permet à un salarié de rejoindre l'équipe sans invitation email individuelle.
