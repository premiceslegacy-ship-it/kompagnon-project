-- ============================================================
-- 082_contract_custom_sections.sql
-- Sections libres pour contrats et templates de contrats
-- ============================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS custom_sections JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.contract_templates
  ADD COLUMN IF NOT EXISTS custom_sections JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.contracts.custom_sections IS 'Sections libres ajoutées au contrat, ordonnées pour le PDF';
COMMENT ON COLUMN public.contract_templates.custom_sections IS 'Sections libres ajoutées au template personnalisé';

