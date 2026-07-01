-- Lie une ligne de devis à la grille matière métal utilisée pour le pré-remplissage.
-- Null si la ligne n'a pas été créée depuis une grille métal.
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS metal_grid_id UUID REFERENCES public.metal_price_grids(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.quote_items.metal_grid_id IS
  'Grille matière métal utilisée pour pré-remplir le prix de la ligne. Null si non issue du module prix matières.';
