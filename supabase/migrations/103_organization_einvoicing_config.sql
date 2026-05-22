-- 103_organization_einvoicing_config.sql
-- Copie locale de la configuration facturation electronique pilotee par le cockpit.

CREATE TABLE IF NOT EXISTS public.organization_einvoicing_config (
  organization_id          UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  mode                     TEXT NOT NULL DEFAULT 'off',
  provider                 TEXT,
  environment              TEXT NOT NULL DEFAULT 'sandbox',
  onboarding_model         TEXT,
  b2brouter_account_id     TEXT,
  annuaire_status          TEXT NOT NULL DEFAULT 'not_started',
  last_directory_check_at  TIMESTAMPTZ,
  last_error               TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organization_einvoicing_config_mode_check
    CHECK (mode IN ('off', 'export_only', 'b2brouter')),
  CONSTRAINT organization_einvoicing_config_provider_check
    CHECK (provider IS NULL OR provider IN ('external_pa', 'b2brouter')),
  CONSTRAINT organization_einvoicing_config_environment_check
    CHECK (environment IN ('sandbox', 'production')),
  CONSTRAINT organization_einvoicing_config_onboarding_check
    CHECK (onboarding_model IS NULL OR onboarding_model IN ('edoc_exchange', 'edoc_sync')),
  CONSTRAINT organization_einvoicing_config_annuaire_check
    CHECK (annuaire_status IN ('not_started', 'pending', 'active', 'error'))
);

COMMENT ON TABLE public.organization_einvoicing_config IS
  'Configuration locale de facturation electronique synchronisee depuis le cockpit Orsayn.';

CREATE INDEX IF NOT EXISTS idx_organization_einvoicing_config_mode
  ON public.organization_einvoicing_config(mode, environment);

SELECT public.create_updated_at_trigger('organization_einvoicing_config');

ALTER TABLE public.organization_einvoicing_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_einvoicing_config_select"
  ON public.organization_einvoicing_config FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "organization_einvoicing_config_insert"
  ON public.organization_einvoicing_config FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('settings.edit_org')
  );

CREATE POLICY "organization_einvoicing_config_update"
  ON public.organization_einvoicing_config FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('settings.edit_org')
  );
