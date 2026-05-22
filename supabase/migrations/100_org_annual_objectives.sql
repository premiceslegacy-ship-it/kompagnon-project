-- ============================================================
-- 100_org_annual_objectives.sql
-- Objectifs annuels de l'organisation (CA, marge, chantiers, heures, clients, customs)
-- Dépend de : 001_organizations.sql
-- ============================================================


CREATE TABLE IF NOT EXISTS public.org_annual_objectives (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year                  INT           NOT NULL,
  revenue_ht_target     DECIMAL(14,2),   -- CA HT cible
  margin_eur_target     DECIMAL(14,2),   -- Marge EUR cible
  margin_pct_target     DECIMAL(5,2),    -- Marge % cible (ex: 35.00 = 35%)
  chantiers_count_target INT,            -- Nombre de chantiers terminés cible
  new_clients_target    INT,             -- Nouveaux clients cible
  hours_target          DECIMAL(10,2),   -- Heures travaillées totales cible
  created_by            UUID          REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (organization_id, year)
);

CREATE INDEX IF NOT EXISTS idx_org_annual_objectives_org_year
  ON public.org_annual_objectives(organization_id, year);

ALTER TABLE public.org_annual_objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_annual_objectives_select"
  ON public.org_annual_objectives FOR SELECT
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "org_annual_objectives_write"
  ON public.org_annual_objectives FOR ALL
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

COMMENT ON TABLE public.org_annual_objectives IS
  'Objectifs annuels de l''organisation : CA, marge, chantiers, heures, nouveaux clients. Un enregistrement par année.';


CREATE TABLE IF NOT EXISTS public.org_annual_objective_customs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id    UUID          NOT NULL REFERENCES public.org_annual_objectives(id) ON DELETE CASCADE,
  organization_id UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label           TEXT          NOT NULL,
  target          DECIMAL(14,2) NOT NULL,
  unit            TEXT          DEFAULT '',
  sort_order      INT           NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_annual_objective_customs_obj
  ON public.org_annual_objective_customs(objective_id);

ALTER TABLE public.org_annual_objective_customs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_annual_objective_customs_select"
  ON public.org_annual_objective_customs FOR SELECT
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "org_annual_objective_customs_write"
  ON public.org_annual_objective_customs FOR ALL
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

COMMENT ON TABLE public.org_annual_objective_customs IS
  'Objectifs annuels custom libres (1→N par org_annual_objectives).';
