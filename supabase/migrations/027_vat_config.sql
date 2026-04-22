-- ============================================================
-- 027_vat_config.sql
-- Ajout de la configuration TVA par organisation :
--   is_vat_subject : l'entreprise est-elle assujettie à la TVA ?
--   (default_vat_rate existe déjà dans 002_core_tables.sql)
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS is_vat_subject BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN public.organizations.is_vat_subject IS
  'false = franchise en base TVA (art. 293B CGI) — mention obligatoire sur les factures, taux forcé à 0%';
