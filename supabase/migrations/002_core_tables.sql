-- ============================================================
-- 002_core_tables.sql
-- Tables système : organizations, profiles, rôles, permissions, memberships
-- Ordre : respecte les dépendances FK (auth.users est géré par Supabase)
-- ============================================================

-- ----------------------------------------------------------
-- organizations
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.organizations (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT        NOT NULL,
  slug                  TEXT        NOT NULL UNIQUE,
  siret                 TEXT,
  siren                 TEXT,
  vat_number            TEXT,
  naf_code              TEXT,
  rcs                   TEXT,
  rcs_ville             TEXT,
  forme_juridique       TEXT,
  capital_social        DECIMAL(15,2),
  email                 TEXT        NOT NULL,
  phone                 TEXT,
  website               TEXT,
  address_line1         TEXT,
  address_line2         TEXT,
  city                  TEXT,
  postal_code           TEXT,
  country               TEXT        DEFAULT 'FR',
  sector                TEXT        NOT NULL,
  -- Facturation électronique (B2Brouter / PPF)
  pa_provider           TEXT        DEFAULT 'b2brouter',
  pa_api_key_encrypted  TEXT,
  pa_webhook_secret     TEXT,
  pa_siren_declared     BOOLEAN     DEFAULT false,
  pa_activated_at       TIMESTAMPTZ,
  -- Branding
  primary_color         TEXT        DEFAULT '#f59e0b',
  logo_url              TEXT,
  brand_name            TEXT,
  -- Paramètres comptables
  default_vat_rate      DECIMAL(5,2)  DEFAULT 20.00,
  default_hourly_rate   DECIMAL(10,2),
  currency              TEXT          DEFAULT 'EUR',
  invoice_prefix        TEXT          DEFAULT 'FAC',
  quote_prefix          TEXT          DEFAULT 'DEV',
  payment_terms_days    INT           DEFAULT 30,
  late_penalty_rate     DECIMAL(5,2)  DEFAULT 12.00,
  court_competent       TEXT,
  insurance_info        TEXT,
  certifications        TEXT[],
  last_quote_number     INT           DEFAULT 0,
  last_invoice_number   INT           DEFAULT 0,
  -- Code d'invitation équipe (format : XXX-XXXX)
  join_code             TEXT          UNIQUE,
  created_at            TIMESTAMPTZ   DEFAULT now(),
  updated_at            TIMESTAMPTZ   DEFAULT now()
);

-- ----------------------------------------------------------
-- profiles
-- Miroir de auth.users — créé automatiquement par trigger
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.profiles (
  id              UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           TEXT        NOT NULL,
  full_name       TEXT,
  avatar_url      TEXT,
  phone           TEXT,
  job_title       TEXT,
  onboarding_done BOOLEAN     DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- permissions
-- Table de référence globale — peuplée au déploiement (010_seed_permissions.sql)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.permissions (
  key         TEXT    PRIMARY KEY,
  label       TEXT    NOT NULL,
  description TEXT,
  category    TEXT    NOT NULL,
  position    INT     DEFAULT 0
);

-- ----------------------------------------------------------
-- roles
-- Rôles de chaque organisation — créés automatiquement à l'inscription
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.roles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  slug            TEXT        NOT NULL,
  description     TEXT,
  color           TEXT        DEFAULT '#9494a8',
  position        INT         DEFAULT 0,
  is_system       BOOLEAN     DEFAULT false,
  is_active       BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, slug)
);

-- ----------------------------------------------------------
-- role_permissions
-- Matrice rôle ↔ permissions — configurable par l'owner depuis l'UI
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.role_permissions (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id         UUID    NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_key  TEXT    NOT NULL REFERENCES public.permissions(key) ON DELETE CASCADE,
  is_allowed      BOOLEAN NOT NULL DEFAULT false,
  updated_by      UUID    REFERENCES auth.users(id),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (role_id, permission_key)
);

-- ----------------------------------------------------------
-- memberships
-- Appartenance d'un utilisateur à une organisation
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.memberships (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id         UUID        NOT NULL REFERENCES public.roles(id),
  invited_by      UUID        REFERENCES auth.users(id),
  accepted_at     TIMESTAMPTZ,
  is_active       BOOLEAN     DEFAULT true,
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (organization_id, user_id)
);

-- ----------------------------------------------------------
-- invitations
-- Invitations email envoyées aux futurs collaborateurs
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invitations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invited_by      UUID        NOT NULL REFERENCES auth.users(id),
  email           TEXT        NOT NULL,
  role_id         UUID        NOT NULL REFERENCES public.roles(id),
  token           TEXT        NOT NULL UNIQUE DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  expires_at      TIMESTAMPTZ DEFAULT (now() + INTERVAL '7 days'),
  accepted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT now()
);
