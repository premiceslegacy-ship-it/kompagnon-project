-- ============================================================
-- 084_contracts_signature_duration.sql
-- Ajoute la durée optionnelle des contrats et les informations
-- de signataire pré-remplies côté organisation.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS signatory_name TEXT,
  ADD COLUMN IF NOT EXISTS signatory_role TEXT,
  ADD COLUMN IF NOT EXISTS signature_image TEXT;

COMMENT ON COLUMN public.organizations.signatory_name IS 'Nom du signataire par défaut pour les contrats émis';
COMMENT ON COLUMN public.organizations.signatory_role IS 'Qualité ou fonction du signataire (ex. Gérant)';
COMMENT ON COLUMN public.organizations.signature_image IS 'Signature manuscrite dessinée (data URL PNG base64) injectée dans les PDF contrats';

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS duration_text TEXT;

COMMENT ON COLUMN public.contracts.duration_text IS 'Durée du contrat saisie librement (optionnel). Si renseignée, remplace la clause durée générique dans le PDF.';
