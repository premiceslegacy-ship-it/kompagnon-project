# Atelier — Déploiement Supabase

Ce dossier contient toutes les migrations SQL pour déployer Atelier sur un nouveau projet Supabase.

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
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public key` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
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
NEXT_PUBLIC_SUPABASE_URL=https://[ref].supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
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

Chaque client = 1 projet Supabase + 1 déploiement Next.js.

```
Client A : project-ref-aaa → app-a.vercel.app
Client B : project-ref-bbb → app-b.vercel.app
Client C : project-ref-ccc → app-c.vercel.app
```

Les migrations sont identiques pour tous les clients. Les données sont totalement isolées.

---

## Notes importantes

- **`010_seed_permissions.sql` est critique** : doit être exécuté avant le 1er signup, sinon `initialize_organization_for_user` ne peut pas assigner les permissions aux rôles.
- **Triggers auth** (`007_triggers.sql`) : nécessitent les droits `service_role`. Via Supabase CLI ou l'éditeur SQL du dashboard uniquement.
- **RLS** : toutes les tables sont protégées. Les mutations admin (webhooks B2Brouter, invitations) utilisent le `service_role` key côté serveur.
- **join_code** : généré automatiquement à la création de chaque organisation. Permet à un salarié de rejoindre l'équipe sans invitation email individuelle.
