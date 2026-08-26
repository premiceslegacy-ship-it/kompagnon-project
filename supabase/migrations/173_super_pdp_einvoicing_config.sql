-- 173_super_pdp_einvoicing_config.sql
-- Remplace B2Brouter par Super PDP comme fournisseur de facturation electronique.
-- Aucun client actif sur b2brouter a ce jour : retrait complet, pas de backward-compat.

ALTER TABLE public.organization_einvoicing_config
  DROP CONSTRAINT IF EXISTS organization_einvoicing_config_mode_check,
  DROP CONSTRAINT IF EXISTS organization_einvoicing_config_provider_check,
  DROP CONSTRAINT IF EXISTS organization_einvoicing_config_onboarding_check,
  DROP CONSTRAINT IF EXISTS organization_einvoicing_config_oauth_status_check;

ALTER TABLE public.organization_einvoicing_config
  DROP COLUMN IF EXISTS onboarding_model,
  DROP COLUMN IF EXISTS b2brouter_account_id;

ALTER TABLE public.organization_einvoicing_config
  ADD COLUMN IF NOT EXISTS oauth_status TEXT NOT NULL DEFAULT 'not_connected',
  ADD COLUMN IF NOT EXISTS oauth_connected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS super_pdp_connection_id TEXT;

DO $$
BEGIN
  ALTER TABLE public.organization_einvoicing_config
    ADD CONSTRAINT organization_einvoicing_config_mode_check
    CHECK (mode IN ('off', 'export_only', 'super_pdp'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.organization_einvoicing_config
    ADD CONSTRAINT organization_einvoicing_config_provider_check
    CHECK (provider IS NULL OR provider IN ('external_pa', 'super_pdp'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.organization_einvoicing_config
    ADD CONSTRAINT organization_einvoicing_config_oauth_status_check
    CHECK (oauth_status IN ('not_connected', 'pending', 'connected', 'error', 'revoked'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.organization_einvoicing_config.super_pdp_connection_id IS
  'Identifiant de compte client retourne par Super PDP apres le flux OAuth. Pas un secret.';
COMMENT ON COLUMN public.organization_einvoicing_config.oauth_status IS
  'Statut de connexion OAuth Super PDP. Les tokens eux-memes vivent uniquement cote cockpit (table super_pdp_oauth_credentials, DB operateur).';
