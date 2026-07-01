-- Enrichissement des grilles matière métal : épaisseur, format, nuance/grade.
-- Permet de distinguer "Alu 2mm 1000x2000 5754" de "Alu 3mm bobine 5052".

ALTER TABLE public.metal_price_grids
  ADD COLUMN IF NOT EXISTS thickness_mm  NUMERIC(6, 2)  NULL,  -- ex: 2.00, 3.00, 0.80
  ADD COLUMN IF NOT EXISTS format_label  TEXT           NULL,  -- ex: "1000×2000", "barre 6m", "bobine"
  ADD COLUMN IF NOT EXISTS grade         TEXT           NULL;  -- ex: "S235", "304L", "5754", "Cu-ETP"

COMMENT ON COLUMN public.metal_price_grids.thickness_mm  IS 'Épaisseur en mm (tôle, profilé). Optionnel, affiché dans le libellé de la ligne devis.';
COMMENT ON COLUMN public.metal_price_grids.format_label  IS 'Format ou dimensions libres (ex: 1000×2000, barre 6m, bobine). Affiché dans le libellé.';
COMMENT ON COLUMN public.metal_price_grids.grade         IS 'Nuance ou grade matière (ex: S235, 304L, 5754, Cu-ETP). Affiché dans le libellé.';
