-- 179_einvoicing_consent_timestamps.sql
-- Horodatage du consentement client sur emission_enabled / reception_enabled, pour
-- tracer une decision explicite (notamment la desactivation de la reception, qui reste
-- obligatoire par la loi depuis le 01/09/2026 sans derogation -- voir
-- docs/atelier-facturation-electronique.md). Le client garde le controle total sur ces
-- deux reglages ; le cockpit conserve sa capacite d'ecriture directe pour intervenir sur
-- un compte precis, mais n'est plus le chemin principal d'activation de la reception.

ALTER TABLE public.organization_einvoicing_config
  ADD COLUMN IF NOT EXISTS emission_consent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reception_consent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.organization_einvoicing_config.emission_consent_at IS
  'Horodatage du dernier changement explicite du client sur super_pdp_emission_enabled (onboarding ou Settings).';
COMMENT ON COLUMN public.organization_einvoicing_config.reception_consent_at IS
  'Horodatage du dernier changement explicite du client sur super_pdp_reception_enabled -- preuve de consentement eclaire, notamment en cas de desactivation malgre l''obligation legale de reception (01/09/2026, aucune derogation).';
