-- ============================================================
-- 047_catalog_dimension_pricing.sql
-- Catalogue : distinction article/service + tarification dimensionnelle
-- ============================================================

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS item_kind TEXT NOT NULL DEFAULT 'article',
  ADD COLUMN IF NOT EXISTS dimension_pricing_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS base_length_m NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS base_width_m NUMERIC(10,3);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'materials_item_kind_check'
  ) THEN
    ALTER TABLE public.materials
      ADD CONSTRAINT materials_item_kind_check
      CHECK (item_kind IN ('article', 'service'));
  END IF;
END $$;

COMMENT ON COLUMN public.materials.item_kind IS
  'Profil catalogue : article/materiau ou service forfaitaire.';
COMMENT ON COLUMN public.materials.dimension_pricing_enabled IS
  'Si true, le prix est recalcule proportionnellement a la surface demandee.';
COMMENT ON COLUMN public.materials.base_length_m IS
  'Longueur de reference en metres pour la tarification dimensionnelle.';
COMMENT ON COLUMN public.materials.base_width_m IS
  'Largeur de reference en metres pour la tarification dimensionnelle.';

ALTER TABLE public.prestation_types
  ADD COLUMN IF NOT EXISTS profile_kind TEXT NOT NULL DEFAULT 'mixed';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'prestation_types_profile_kind_check'
  ) THEN
    ALTER TABLE public.prestation_types
      ADD CONSTRAINT prestation_types_profile_kind_check
      CHECK (profile_kind IN ('article', 'service', 'mixed'));
  END IF;
END $$;

COMMENT ON COLUMN public.prestation_types.profile_kind IS
  'Profil de prestation cible : article, service ou mixte.';
