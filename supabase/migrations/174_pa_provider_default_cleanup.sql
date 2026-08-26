-- 174_pa_provider_default_cleanup.sql
-- organizations.pa_provider est un residu du modele B2Brouter d'origine, jamais
-- lu par le code applicatif (le pilotage reel passe par organization_einvoicing_config,
-- voir 173_super_pdp_einvoicing_config.sql). Corrige le defaut trompeur pour toute
-- nouvelle organisation, et les lignes existantes qui le portent encore.

ALTER TABLE public.organizations
  ALTER COLUMN pa_provider DROP DEFAULT;

UPDATE public.organizations
  SET pa_provider = NULL
  WHERE pa_provider = 'b2brouter';

COMMENT ON COLUMN public.organizations.pa_provider IS
  'Residu historique, non lu par le code applicatif. Le mode/fournisseur reel est organization_einvoicing_config.mode/provider.';
