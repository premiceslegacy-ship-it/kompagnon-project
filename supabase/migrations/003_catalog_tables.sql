-- ============================================================
-- 003_catalog_tables.sql
-- Catalogue produits/services et modèles de devis
-- Dépend de : 002_core_tables.sql (organizations)
-- Doit précéder 004_business_tables.sql (quote_items référence materials et labor_rates)
-- ============================================================

-- ----------------------------------------------------------
-- materials
-- Catalogue matériaux / fournitures
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.materials (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  reference       TEXT,
  unit            TEXT        DEFAULT 'u',
  purchase_price  DECIMAL(10,2),
  margin_rate     DECIMAL(5,2) DEFAULT 0,
  sale_price      DECIMAL(10,2),
  vat_rate        DECIMAL(5,2) DEFAULT 20.00,
  supplier        TEXT,
  category        TEXT,
  description     TEXT,
  custom_fields   JSONB,
  is_active       BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- labor_rates
-- Catalogue main-d'œuvre / opérations
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.labor_rates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  designation     TEXT        NOT NULL,
  unit            TEXT        DEFAULT 'h',
  rate            DECIMAL(10,2),
  vat_rate        DECIMAL(5,2) DEFAULT 20.00,
  category        TEXT,
  description     TEXT,
  custom_fields   JSONB,
  is_active       BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- saved_templates
-- Modèles de devis réutilisables
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.saved_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  type            TEXT        DEFAULT 'quote',
  sections        JSONB,
  tags            TEXT[],
  use_count       INT         DEFAULT 0,
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
