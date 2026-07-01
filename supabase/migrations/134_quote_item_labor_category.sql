-- Catégorie de main-d'oeuvre sur les lignes de devis
-- Permet de distinguer MO atelier (débit, pliage, soudure, meulage) vs MO pose (installation, mise en place)
-- NULL = non qualifié (matière, custom sans MO)

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS labor_category text NULL
  CHECK (labor_category IN ('atelier', 'pose', 'autre'));

COMMENT ON COLUMN public.quote_items.labor_category IS
  'Catégorie MO : atelier (fabrication) | pose (installation) | autre. NULL pour les lignes non-MO.';
