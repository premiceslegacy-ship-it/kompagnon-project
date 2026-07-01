-- Lie les grilles de prix metal au catalogue et aux fournisseurs existants.
-- catalog_item_id existait deja ; supplier_id ajoute un lien direct vers l'onglet Fournisseurs.

ALTER TABLE public.metal_price_grids
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_metal_price_grids_supplier
  ON public.metal_price_grids(supplier_id)
  WHERE supplier_id IS NOT NULL;

COMMENT ON COLUMN public.metal_price_grids.supplier_id IS
  'Fournisseur associe a la grille metal. Alimente depuis l''onglet Fournisseurs du catalogue.';
