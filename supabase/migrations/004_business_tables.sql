-- ============================================================
-- 004_business_tables.sql
-- Tables métier : clients, devis, factures, paiements, relances
-- Dépend de : 002_core_tables.sql, 003_catalog_tables.sql
-- ============================================================

-- ----------------------------------------------------------
-- clients
-- Annuaire clients / prospects de l'organisation
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clients (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  type                TEXT        NOT NULL DEFAULT 'company',  -- 'company' | 'individual'
  company_name        TEXT,
  first_name          TEXT,
  last_name           TEXT,
  email               TEXT,
  phone               TEXT,
  mobile              TEXT,
  siret               TEXT,
  vat_number          TEXT,
  address_line1       TEXT,
  address_line2       TEXT,
  city                TEXT,
  postal_code         TEXT,
  country             TEXT        DEFAULT 'FR',
  notes               TEXT,
  tags                TEXT[],
  source              TEXT,       -- 'direct' | 'referral' | 'web' | ...
  status              TEXT        DEFAULT 'active',  -- 'active' | 'lead_hot' | 'lead_cold' | 'inactive'
  payment_terms_days  INT         DEFAULT 30,
  total_revenue       DECIMAL(15,2) DEFAULT 0,  -- mis à jour par trigger
  total_paid          DECIMAL(15,2) DEFAULT 0,  -- mis à jour par trigger
  custom_fields       JSONB,
  is_archived         BOOLEAN     DEFAULT false,
  created_by          UUID        REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- quotes
-- Devis (brouillon → envoyé → accepté/refusé → converti)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quotes (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id           UUID        REFERENCES public.clients(id),
  number              TEXT,       -- ex: DEV-2024-0001 (généré par generate_quote_number)
  title               TEXT,
  status              TEXT        DEFAULT 'draft',
  -- 'draft' | 'sent' | 'viewed' | 'accepted' | 'refused' | 'expired' | 'converted'
  brief_notes         TEXT,       -- cahier des charges interne (jamais affiché au client)
  ai_generated        BOOLEAN     DEFAULT false,
  ai_validated        BOOLEAN     DEFAULT false,
  total_ht            DECIMAL(10,2) DEFAULT 0,
  total_tva           DECIMAL(10,2) DEFAULT 0,
  total_ttc           DECIMAL(10,2) DEFAULT 0,
  discount_rate       DECIMAL(5,2) DEFAULT 0,
  discount_amount     DECIMAL(10,2) DEFAULT 0,
  deposit_rate        DECIMAL(5,2) DEFAULT 0,
  deposit_amount      DECIMAL(10,2) DEFAULT 0,
  validity_days       INT         DEFAULT 30,
  valid_until         DATE,
  sent_at             TIMESTAMPTZ,
  viewed_at           TIMESTAMPTZ,
  accepted_at         TIMESTAMPTZ,
  refused_at          TIMESTAMPTZ,
  converted_at        TIMESTAMPTZ,
  invoice_id          UUID,       -- FK ajoutée après création de invoices (voir bas de fichier)
  pdf_url             TEXT,
  notes_client        TEXT,       -- mentions visibles sur le PDF
  payment_conditions  TEXT,
  is_archived         BOOLEAN     DEFAULT false,
  created_by          UUID        REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- quote_sections
-- Sections d'un devis (regroupement visuel de lignes)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quote_sections (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id    UUID    NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  title       TEXT,
  position    INT     DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- quote_items
-- Lignes d'un devis (matériau ou main-d'œuvre)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quote_items (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id        UUID        NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  section_id      UUID        REFERENCES public.quote_sections(id) ON DELETE SET NULL,
  type            TEXT        DEFAULT 'material',  -- 'material' | 'labor' | 'custom'
  material_id     UUID        REFERENCES public.materials(id) ON DELETE SET NULL,
  labor_rate_id   UUID        REFERENCES public.labor_rates(id) ON DELETE SET NULL,
  description     TEXT,
  quantity        DECIMAL(10,3) DEFAULT 1,
  unit            TEXT,
  unit_price      DECIMAL(10,2),
  vat_rate        DECIMAL(5,2) DEFAULT 20.00,
  total_ht        DECIMAL(10,2),
  position        INT         DEFAULT 0,
  ai_generated    BOOLEAN     DEFAULT false,
  ai_validated    BOOLEAN     DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- invoices
-- Factures (brouillon → envoyée → payée / en retard)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoices (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id             UUID        REFERENCES public.clients(id),
  quote_id              UUID        REFERENCES public.quotes(id) ON DELETE SET NULL,
  number                TEXT,       -- ex: FAC-2024-0001
  title                 TEXT,
  status                TEXT        DEFAULT 'draft',
  -- 'draft' | 'sent' | 'viewed' | 'paid' | 'partial' | 'overdue' | 'cancelled' | 'refunded'
  brief_notes           TEXT,       -- cahier des charges interne
  total_ht              DECIMAL(10,2) DEFAULT 0,
  total_tva             DECIMAL(10,2) DEFAULT 0,
  total_ttc             DECIMAL(10,2) DEFAULT 0,
  total_paid            DECIMAL(10,2) DEFAULT 0,
  discount_rate         DECIMAL(5,2) DEFAULT 0,
  discount_amount       DECIMAL(10,2) DEFAULT 0,
  deposit_rate          DECIMAL(5,2) DEFAULT 0,
  deposit_amount        DECIMAL(10,2) DEFAULT 0,
  issue_date            DATE        DEFAULT CURRENT_DATE,
  due_date              DATE,
  payment_terms_days    INT         DEFAULT 30,
  sent_at               TIMESTAMPTZ,
  viewed_at             TIMESTAMPTZ,
  paid_at               TIMESTAMPTZ,
  pdf_url               TEXT,
  notes_client          TEXT,
  payment_conditions    TEXT,
  -- Facturation électronique (Factur-X / B2Brouter)
  facturx_xml           TEXT,
  facturx_level         TEXT        DEFAULT 'EN_16931',
  pa_message_id         TEXT,
  pa_status             TEXT        DEFAULT 'not_submitted',
  pa_status_updated_at  TIMESTAMPTZ,
  pa_rejection_reason   TEXT,
  recipient_siren       TEXT,
  recipient_siret       TEXT,
  einvoicing_mandatory  BOOLEAN     DEFAULT false,
  -- Avoir
  is_credit_note        BOOLEAN     DEFAULT false,
  credit_note_for       UUID        REFERENCES public.invoices(id) ON DELETE SET NULL,
  is_archived           BOOLEAN     DEFAULT false,
  created_by            UUID        REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now()
);

-- FK croisée : quotes.invoice_id → invoices (dépendance circulaire résolue après création)
ALTER TABLE public.quotes
  ADD CONSTRAINT IF NOT EXISTS fk_quotes_invoice_id
  FOREIGN KEY (invoice_id) REFERENCES public.invoices(id) ON DELETE SET NULL;

-- ----------------------------------------------------------
-- invoice_items
-- Lignes de facturation (avec TVA ventilée — Factur-X)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_items (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id          UUID        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  description         TEXT,
  quantity            DECIMAL(10,3) DEFAULT 1,
  unit                TEXT,
  unit_price          DECIMAL(10,2) NOT NULL,
  vat_rate            DECIMAL(5,2)  DEFAULT 20.00,
  vat_amount          DECIMAL(10,2),  -- calculé par trigger compute_vat_amount
  vat_exemption_code  TEXT,           -- 'AE', 'E' si vat_rate = 0
  total_ht            DECIMAL(10,2),
  position            INT         DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- payments
-- Paiements enregistrés sur une facture
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  invoice_id      UUID        NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  client_id       UUID        REFERENCES public.clients(id),
  amount          DECIMAL(10,2) NOT NULL,
  payment_date    DATE        DEFAULT CURRENT_DATE,
  method          TEXT,       -- 'virement' | 'cheque' | 'cb' | 'especes' | ...
  reference       TEXT,
  notes           TEXT,
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- reminders
-- Relances émises (manuelles ou automatiques)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.reminders (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id        UUID        REFERENCES public.quotes(id) ON DELETE SET NULL,
  invoice_id      UUID        REFERENCES public.invoices(id) ON DELETE SET NULL,
  client_id       UUID        REFERENCES public.clients(id),
  type            TEXT,       -- 'quote_followup' | 'payment_reminder' | 'overdue_notice'
  rank            INT         DEFAULT 1,  -- 1ère, 2ème, 3ème relance...
  sent_at         TIMESTAMPTZ,
  sent_by         UUID        REFERENCES auth.users(id),
  is_auto         BOOLEAN     DEFAULT false,
  email_subject   TEXT,
  email_body      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now()
);
