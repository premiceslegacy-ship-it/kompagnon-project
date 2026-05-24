-- ============================================================
-- 107_org_monthly_objectives.sql
-- Objectifs mensuels de l'organisation (CA, marge, chantiers, heures, customs)
-- Dissociés des objectifs annuels (100_org_annual_objectives.sql)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.org_monthly_objectives (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  year                  INT           NOT NULL,
  month                 INT           NOT NULL CHECK (month BETWEEN 1 AND 12),
  revenue_ht_target     DECIMAL(14,2),
  margin_eur_target     DECIMAL(14,2),
  margin_pct_target     DECIMAL(5,2),
  chantiers_count_target INT,
  hours_target          DECIMAL(10,2),
  created_by            UUID          REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  UNIQUE (organization_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_org_monthly_objectives_org_year_month
  ON public.org_monthly_objectives(organization_id, year, month);

ALTER TABLE public.org_monthly_objectives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_monthly_objectives_select"
  ON public.org_monthly_objectives FOR SELECT
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "org_monthly_objectives_write"
  ON public.org_monthly_objectives FOR ALL
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

COMMENT ON TABLE public.org_monthly_objectives IS
  'Objectifs mensuels de l''organisation, dissociés des objectifs annuels. Un enregistrement par mois.';


CREATE TABLE IF NOT EXISTS public.org_monthly_objective_customs (
  id              UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id    UUID          NOT NULL REFERENCES public.org_monthly_objectives(id) ON DELETE CASCADE,
  organization_id UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label           TEXT          NOT NULL,
  target          DECIMAL(14,2) NOT NULL,
  unit            TEXT          DEFAULT '',
  sort_order      INT           NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_org_monthly_objective_customs_obj
  ON public.org_monthly_objective_customs(objective_id);

ALTER TABLE public.org_monthly_objective_customs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_monthly_objective_customs_select"
  ON public.org_monthly_objective_customs FOR SELECT
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "org_monthly_objective_customs_write"
  ON public.org_monthly_objective_customs FOR ALL
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

COMMENT ON TABLE public.org_monthly_objective_customs IS
  'Objectifs mensuels custom libres (1→N par org_monthly_objectives).';
