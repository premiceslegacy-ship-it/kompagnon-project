-- 004_operator_einvoicing_config.sql
-- Configuration facturation electronique orchestree depuis le cockpit.

ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN IF NOT EXISTS einvoicing_mode TEXT NOT NULL DEFAULT 'off',
  ADD COLUMN IF NOT EXISTS einvoicing_provider TEXT,
  ADD COLUMN IF NOT EXISTS einvoicing_environment TEXT NOT NULL DEFAULT 'sandbox',
  ADD COLUMN IF NOT EXISTS einvoicing_onboarding_model TEXT,
  ADD COLUMN IF NOT EXISTS b2brouter_account_id TEXT,
  ADD COLUMN IF NOT EXISTS einvoicing_annuaire_status TEXT NOT NULL DEFAULT 'not_started';

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_einvoicing_mode_check
    CHECK (einvoicing_mode IN ('off', 'export_only', 'b2brouter'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_einvoicing_provider_check
    CHECK (einvoicing_provider IS NULL OR einvoicing_provider IN ('external_pa', 'b2brouter'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_einvoicing_environment_check
    CHECK (einvoicing_environment IN ('sandbox', 'production'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_einvoicing_onboarding_check
    CHECK (einvoicing_onboarding_model IS NULL OR einvoicing_onboarding_model IN ('edoc_exchange', 'edoc_sync'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_einvoicing_annuaire_check
    CHECK (einvoicing_annuaire_status IN ('not_started', 'pending', 'active', 'error'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_operator_client_subscriptions_einvoicing
  ON public.operator_client_subscriptions(einvoicing_mode, einvoicing_environment, source_instance);
