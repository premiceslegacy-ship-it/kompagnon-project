-- 055_organization_modules_usage_logs.sql
-- Modules produit par organisation + journal d'usage IA / opérateur

-- ─── Modules produit par organisation ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.organization_modules (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  modules         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organization_modules_modules_object
    CHECK (jsonb_typeof(modules) = 'object')
);

COMMENT ON TABLE public.organization_modules IS
  'Activation des modules produit par organisation (flags applicatifs, separes des donnees metier).';

COMMENT ON COLUMN public.organization_modules.modules IS
  'Objet JSONB de flags applicatifs, ex: {"quote_ai": true, "planning_ai": false}.';

CREATE INDEX IF NOT EXISTS idx_organization_modules_updated_at
  ON public.organization_modules(updated_at DESC);

SELECT public.create_updated_at_trigger('organization_modules');

ALTER TABLE public.organization_modules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_modules_select"
  ON public.organization_modules FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "organization_modules_insert"
  ON public.organization_modules FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('settings.edit_org')
  );

CREATE POLICY "organization_modules_update"
  ON public.organization_modules FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('settings.edit_org')
  );

-- ─── Journal d'usage IA / synchro operateur ─────────────────────────────────

CREATE TABLE IF NOT EXISTS public.usage_logs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID           NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider             TEXT           NOT NULL,
  feature              TEXT           NOT NULL,
  model                TEXT           NOT NULL,
  input_kind           TEXT           NOT NULL,
  status               TEXT           NOT NULL,
  prompt_tokens        INTEGER,
  completion_tokens    INTEGER,
  total_tokens         INTEGER,
  provider_cost        NUMERIC(12,6),
  currency             TEXT           NOT NULL DEFAULT 'USD',
  external_request_id  TEXT,
  metadata             JSONB,
  operator_sync_status TEXT           NOT NULL DEFAULT 'pending'
    CHECK (operator_sync_status IN ('pending', 'synced', 'failed', 'skipped')),
  operator_sync_error  TEXT,
  operator_synced_at   TIMESTAMPTZ,
  created_at           TIMESTAMPTZ    NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.usage_logs IS
  'Journal technique d usage des providers IA par organisation. Non expose a l application cliente.';

COMMENT ON COLUMN public.usage_logs.operator_sync_status IS
  'Etat de synchronisation vers le cockpit prive Orsayn.';

CREATE INDEX IF NOT EXISTS idx_usage_logs_org_created
  ON public.usage_logs(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_logs_provider_feature_created
  ON public.usage_logs(provider, feature, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_usage_logs_operator_sync_status
  ON public.usage_logs(operator_sync_status, created_at DESC);

ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;
