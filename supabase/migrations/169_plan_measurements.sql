-- Pré-métrés persistants et traçabilité des lignes transférées au devis.

CREATE TABLE IF NOT EXISTS public.plan_measurements (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_by      UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  quote_id        UUID        REFERENCES public.quotes(id) ON DELETE SET NULL,
  title           TEXT        NOT NULL,
  source_name     TEXT,
  status          TEXT        NOT NULL DEFAULT 'ready' CHECK (status IN ('processing', 'ready', 'failed', 'converted')),
  project_type    TEXT        NOT NULL CHECK (project_type IN ('new', 'renovation')),
  selected_trades TEXT[]      NOT NULL DEFAULT '{}',
  work_scopes     JSONB       NOT NULL DEFAULT '{}',
  settings        JSONB       NOT NULL DEFAULT '{}',
  result          JSONB       NOT NULL DEFAULT '{}',
  user_description TEXT,
  model           TEXT,
  processing_ms   INTEGER,
  rules_version   TEXT        NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_plan_measurements_org_updated
  ON public.plan_measurements (organization_id, updated_at DESC);

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS measurement_metadata JSONB;

COMMENT ON TABLE public.plan_measurements IS
  'Brouillons de pré-métré : périmètre choisi, faits extraits, règles et état de validation. Le plan source n’est pas conservé.';
COMMENT ON COLUMN public.quote_items.measurement_metadata IS
  'Traçabilité d’une ligne issue d’un pré-métré : formule, variables, preuves, confiance, source et version des règles.';

CREATE OR REPLACE FUNCTION public.touch_plan_measurements_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_plan_measurements_updated_at ON public.plan_measurements;
CREATE TRIGGER trg_plan_measurements_updated_at
  BEFORE UPDATE ON public.plan_measurements
  FOR EACH ROW EXECUTE FUNCTION public.touch_plan_measurements_updated_at();

ALTER TABLE public.plan_measurements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "plan_measurements_select" ON public.plan_measurements;
DROP POLICY IF EXISTS "plan_measurements_insert" ON public.plan_measurements;
DROP POLICY IF EXISTS "plan_measurements_update" ON public.plan_measurements;
DROP POLICY IF EXISTS "plan_measurements_delete" ON public.plan_measurements;

CREATE POLICY "plan_measurements_select" ON public.plan_measurements
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('quotes.view')
  );

CREATE POLICY "plan_measurements_insert" ON public.plan_measurements
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND created_by = auth.uid()
    AND public.user_has_permission('quotes.create')
    AND public.user_has_permission('ai.manage')
  );

CREATE POLICY "plan_measurements_update" ON public.plan_measurements
  FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('quotes.edit')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('quotes.edit')
  );

CREATE POLICY "plan_measurements_delete" ON public.plan_measurements
  FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('quotes.delete')
  );
