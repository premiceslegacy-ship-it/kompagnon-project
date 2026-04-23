-- ============================================================
-- 048_catalog_dimension_modes.sql
-- Modes de tarification dimensionnelle : linear, area, volume
-- ============================================================

-- Mode dimensionnel sur les matériaux (remplace progressivement dimension_pricing_enabled)
ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS dimension_pricing_mode TEXT NOT NULL DEFAULT 'none'
    CHECK (dimension_pricing_mode IN ('none', 'linear', 'area', 'volume')),
  ADD COLUMN IF NOT EXISTS base_height_m NUMERIC(10,3);

-- Backfill : articles déjà marqués dimension_pricing_enabled passent en mode 'area'
UPDATE public.materials
SET dimension_pricing_mode = 'area'
WHERE dimension_pricing_enabled = true AND dimension_pricing_mode = 'none';

-- 3e dimension sur les lignes de devis
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS height_m NUMERIC(10,3);

-- invoice_items a déjà length_m et width_m — juste ajouter height_m
ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS height_m NUMERIC(10,3);

COMMENT ON COLUMN public.materials.dimension_pricing_mode IS
  'Mode de tarification dimensionnelle : none (aucune), linear (au ml), area (au m²), volume (au m³)';
COMMENT ON COLUMN public.materials.base_height_m IS
  'Hauteur/épaisseur de référence en mètres pour le mode volume';
COMMENT ON COLUMN public.quote_items.height_m IS
  'Hauteur demandée pour tarification volumique';
COMMENT ON COLUMN public.invoice_items.height_m IS
  'Hauteur demandée pour tarification volumique';
