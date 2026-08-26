-- 014_super_pdp_einvoicing_config.sql
-- Remplace B2Brouter par Super PDP dans la config e-facturation affichee au cockpit.
-- Miroir de supabase/migrations/173_super_pdp_einvoicing_config.sql (instance cliente).
-- Ces colonnes ne portent que des metadonnees d'affichage : les tokens OAuth vivent
-- dans super_pdp_oauth_credentials (013_super_pdp_oauth_credentials.sql).

ALTER TABLE public.operator_client_subscriptions
  DROP CONSTRAINT IF EXISTS operator_client_subscriptions_einvoicing_mode_check,
  DROP CONSTRAINT IF EXISTS operator_client_subscriptions_einvoicing_provider_check,
  DROP CONSTRAINT IF EXISTS operator_client_subscriptions_einvoicing_onboarding_check;

ALTER TABLE public.operator_client_subscriptions
  DROP COLUMN IF EXISTS einvoicing_onboarding_model,
  DROP COLUMN IF EXISTS b2brouter_account_id,
  DROP COLUMN IF EXISTS b2brouter_active;

ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN IF NOT EXISTS oauth_status TEXT NOT NULL DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS oauth_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS super_pdp_connection_id TEXT;

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_einvoicing_mode_check
    CHECK (einvoicing_mode IN ('off', 'export_only', 'super_pdp'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_einvoicing_provider_check
    CHECK (einvoicing_provider IS NULL OR einvoicing_provider IN ('external_pa', 'super_pdp'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_oauth_status_check
    CHECK (oauth_status IN ('not_connected', 'pending', 'connected', 'error', 'revoked'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
