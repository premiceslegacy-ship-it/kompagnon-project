-- ============================================================
-- 005_advanced_tables.sql
-- Tables avancées : IA, facturation récurrente, facturation électronique, logs
-- Dépend de : 002_core_tables.sql, 004_business_tables.sql
-- ============================================================

-- ----------------------------------------------------------
-- company_memory
-- Mémoire vectorielle de l'entreprise (contexte pour l'IA)
-- Nécessite l'extension vector (001_extensions.sql)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.company_memory (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type            TEXT,       -- 'client_info' | 'product' | 'process' | 'preference' | ...
  content         TEXT        NOT NULL,
  embedding       public.vector(1536),  -- OpenAI text-embedding-3-small
  metadata        JSONB,
  source          TEXT,       -- 'manual' | 'import' | 'ai_extracted'
  confidence      DECIMAL(3,2) DEFAULT 1.0,
  is_active       BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- goals
-- Objectifs de CA par année / mois
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.goals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year            INT         NOT NULL,
  annual_target   DECIMAL(15,2),
  monthly_targets JSONB,      -- { "1": 80000, "2": 90000, ..., "12": 110000 }
  visibility      TEXT        DEFAULT 'all',  -- 'all' | 'managers_only' | 'owner_only'
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- email_templates
-- Modèles d'emails (relances, devis, invitations, notifications)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.email_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug            TEXT        NOT NULL,
  -- ex: 'quote_sent' | 'invoice_sent' | 'payment_reminder_1' | 'recurring_confirm'
  subject         TEXT,
  body_html       TEXT,
  body_text       TEXT,
  is_active       BOOLEAN     DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- import_jobs
-- Historique des imports CSV (clients, historique devis/factures)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.import_jobs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type            TEXT        NOT NULL,   -- 'clients' | 'quotes' | 'invoices'
  status          TEXT        DEFAULT 'pending',
  -- 'pending' | 'processing' | 'completed' | 'failed'
  file_name       TEXT,
  file_url        TEXT,
  total_rows      INT,
  imported_rows   INT         DEFAULT 0,
  skipped_rows    INT         DEFAULT 0,
  error_rows      INT         DEFAULT 0,
  error_details   JSONB,
  ai_mapping      JSONB,      -- mapping colonnes CSV → colonnes DB suggéré par l'IA
  result_summary  TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- activity_log
-- Journal d'activité (audit trail)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.activity_log (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID        REFERENCES auth.users(id),
  action          TEXT        NOT NULL,
  -- ex: 'quote.created' | 'invoice.sent' | 'member.role_changed'
  entity_type     TEXT,
  entity_id       UUID,
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- recurring_invoices
-- Modèles de facturation récurrente (abonnements, contrats)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_invoices (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id                 UUID        NOT NULL REFERENCES public.clients(id),
  title                     TEXT        NOT NULL,
  internal_note             TEXT,
  frequency                 TEXT        NOT NULL DEFAULT 'monthly',
  -- 'weekly' | 'monthly' | 'quarterly' | 'custom'
  send_day                  INT,        -- jour du mois (1-28) si frequency = 'monthly'
  custom_interval_days      INT,        -- si frequency = 'custom'
  next_send_date            DATE        NOT NULL,
  requires_confirmation     BOOLEAN     DEFAULT true,
  confirmation_delay_days   INT         DEFAULT 3,
  base_amount_ht            DECIMAL(10,2),
  currency                  TEXT        DEFAULT 'EUR',
  is_active                 BOOLEAN     DEFAULT true,
  paused_until              DATE,
  cancelled_at              TIMESTAMPTZ,
  cancelled_reason          TEXT,
  created_by                UUID        REFERENCES auth.users(id),
  created_at                TIMESTAMPTZ DEFAULT now(),
  updated_at                TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- recurring_invoice_items
-- Lignes du modèle de facturation récurrente
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recurring_invoice_items (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  recurring_invoice_id  UUID        NOT NULL REFERENCES public.recurring_invoices(id) ON DELETE CASCADE,
  description           TEXT        NOT NULL,
  quantity              DECIMAL(10,3) DEFAULT 1,
  unit                  TEXT,
  unit_price            DECIMAL(10,2) NOT NULL,
  vat_rate              DECIMAL(5,2) DEFAULT 20.00,
  position              INT         DEFAULT 0
);

-- ----------------------------------------------------------
-- invoice_schedules
-- Occurrences planifiées de facturation récurrente (audit trail)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_schedules (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  recurring_invoice_id  UUID        NOT NULL REFERENCES public.recurring_invoices(id),
  scheduled_date        DATE        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'pending_confirmation',
  -- 'pending_confirmation' | 'confirmed' | 'sent' | 'skipped' | 'overdue'
  confirmed_at          TIMESTAMPTZ,
  confirmed_by          UUID        REFERENCES auth.users(id),
  invoice_id            UUID        REFERENCES public.invoices(id) ON DELETE SET NULL,
  amount_ht             DECIMAL(10,2),
  modification_note     TEXT,
  notified_at           TIMESTAMPTZ,
  second_notif_at       TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- received_invoices
-- Factures fournisseurs reçues via webhook B2Brouter (PA)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.received_invoices (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  pa_message_id     TEXT        NOT NULL UNIQUE,
  pa_received_at    TIMESTAMPTZ NOT NULL,
  supplier_siren    TEXT        NOT NULL,
  supplier_siret    TEXT,
  supplier_name     TEXT        NOT NULL,
  supplier_vat      TEXT,
  invoice_number    TEXT        NOT NULL,
  invoice_date      DATE        NOT NULL,
  due_date          DATE,
  total_ht          DECIMAL(10,2) NOT NULL,
  total_tva         DECIMAL(10,2) NOT NULL,
  total_ttc         DECIMAL(10,2) NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'received',
  -- 'received' | 'verified' | 'accounted' | 'rejected'
  rejection_reason  TEXT,
  accounted_at      TIMESTAMPTZ,
  accounted_by      UUID        REFERENCES auth.users(id),
  facturx_url       TEXT,
  raw_xml           JSONB,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- pa_status_events
-- Historique des statuts PA — audit trail légal, immuable (pas de UPDATE)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pa_status_events (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id            UUID        REFERENCES public.invoices(id) ON DELETE SET NULL,
  received_invoice_id   UUID        REFERENCES public.received_invoices(id) ON DELETE SET NULL,
  pa_message_id         TEXT        NOT NULL,
  event_type            TEXT        NOT NULL,
  -- 'submitted' | 'delivered' | 'accepted' | 'rejected' | 'cancelled'
  previous_status       TEXT,
  new_status            TEXT        NOT NULL,
  pa_timestamp          TIMESTAMPTZ NOT NULL,
  payload               JSONB,
  created_at            TIMESTAMPTZ DEFAULT now()
  -- Pas de updated_at — table append-only
);
