-- ============================================================
-- 049_catalog_business_profiles.sql
-- Configuration catalogue contextualisee par organisation
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_profile TEXT NOT NULL DEFAULT 'btp'
    CHECK (business_profile IN ('cleaning', 'btp', 'industry')),
  ADD COLUMN IF NOT EXISTS label_set JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS unit_set JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS default_categories JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS starter_presets JSONB NOT NULL DEFAULT '[]'::jsonb;
