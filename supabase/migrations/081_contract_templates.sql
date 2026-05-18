-- ============================================================
-- 081_contract_templates.sql
-- Templates de contrats personnalisés par organisation
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contract_templates (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID       NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contract_type   TEXT       NOT NULL CHECK (contract_type IN ('sous_traitance', 'maintenance')),
  title           TEXT       NOT NULL,
  trade           TEXT       NOT NULL DEFAULT 'personnalise',
  clauses         JSONB      NOT NULL DEFAULT '{}'::jsonb,
  is_active       BOOLEAN    NOT NULL DEFAULT true,
  created_by      UUID       REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contract_templates IS 'Templates de contrats personnalisés par organisation';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_contract_templates'
  ) THEN
    CREATE TRIGGER set_updated_at_contract_templates
      BEFORE UPDATE ON public.contract_templates
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contract_templates_org ON public.contract_templates(organization_id);
CREATE INDEX IF NOT EXISTS idx_contract_templates_type ON public.contract_templates(organization_id, contract_type, is_active);

ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contract_templates_select"
  ON public.contract_templates FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('contracts.view')
  );

CREATE POLICY "contract_templates_insert"
  ON public.contract_templates FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('contracts.create')
  );

CREATE POLICY "contract_templates_update"
  ON public.contract_templates FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('contracts.edit')
  );

CREATE POLICY "contract_templates_delete"
  ON public.contract_templates FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('contracts.delete')
  );

