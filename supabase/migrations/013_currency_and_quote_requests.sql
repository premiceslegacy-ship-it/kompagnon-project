-- ============================================================
-- 013_currency_and_quote_requests.sql
-- Multi-devises + demandes de devis publiques + améliorations labor_rates
-- Dépend de : 004_business_tables.sql, 003_catalog_tables.sql
-- ============================================================

-- ----------------------------------------------------------
-- Multi-devises : ajout de la colonne currency
-- ----------------------------------------------------------
ALTER TABLE public.clients    ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE public.quotes     ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';
ALTER TABLE public.invoices   ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'EUR';

-- ----------------------------------------------------------
-- Améliorer labor_rates pour aligner avec l'UI catalogue
-- (coût horaire, marge, type humain/machine, référence interne)
-- ----------------------------------------------------------
ALTER TABLE public.labor_rates ADD COLUMN IF NOT EXISTS reference   TEXT;
ALTER TABLE public.labor_rates ADD COLUMN IF NOT EXISTS cost_rate   DECIMAL(10,2);
ALTER TABLE public.labor_rates ADD COLUMN IF NOT EXISTS margin_rate DECIMAL(5,2) DEFAULT 0;
ALTER TABLE public.labor_rates ADD COLUMN IF NOT EXISTS type        TEXT         DEFAULT 'human'; -- 'human' | 'machine'

-- ----------------------------------------------------------
-- quote_requests
-- Demandes de devis reçues via le formulaire public de l'organisation
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.quote_requests (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Informations du demandeur
  name            TEXT        NOT NULL,
  email           TEXT        NOT NULL,
  phone           TEXT,
  company_name    TEXT,
  -- Contenu de la demande
  subject         TEXT,
  description     TEXT        NOT NULL,
  -- Suivi
  status          TEXT        NOT NULL DEFAULT 'new', -- 'new' | 'read' | 'converted' | 'archived'
  -- Liens vers client/devis créés depuis cette demande
  client_id       UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  quote_id        UUID        REFERENCES public.quotes(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_requests_org_id ON public.quote_requests(organization_id);
CREATE INDEX IF NOT EXISTS idx_quote_requests_status  ON public.quote_requests(status);
CREATE INDEX IF NOT EXISTS idx_quote_requests_created ON public.quote_requests(created_at DESC);

-- RLS
ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;

-- INSERT public : tout le monde peut soumettre (server action valide l'org côté serveur)
CREATE POLICY "public_insert_quote_requests" ON public.quote_requests
  FOR INSERT WITH CHECK (true);

-- SELECT / UPDATE : membres de l'organisation uniquement
CREATE POLICY "org_members_select_quote_requests" ON public.quote_requests
  FOR SELECT USING (get_user_org_id() = organization_id);

CREATE POLICY "org_members_update_quote_requests" ON public.quote_requests
  FOR UPDATE USING (get_user_org_id() = organization_id);

-- Trigger updated_at
CREATE TRIGGER set_updated_at_quote_requests
  BEFORE UPDATE ON public.quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
