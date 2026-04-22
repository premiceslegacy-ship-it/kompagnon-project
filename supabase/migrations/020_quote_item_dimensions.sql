-- Dimensions optionnelles sur les lignes de devis / facture
-- Permet le calcul auto de quantité via longueur × largeur (mode surface)
ALTER TABLE quote_items
  ADD COLUMN IF NOT EXISTS length_m  NUMERIC(10,3) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS width_m   NUMERIC(10,3) DEFAULT NULL;

-- Même chose sur invoice_items pour cohérence lors de la conversion devis→facture
ALTER TABLE invoice_items
  ADD COLUMN IF NOT EXISTS length_m  NUMERIC(10,3) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS width_m   NUMERIC(10,3) DEFAULT NULL;

COMMENT ON COLUMN quote_items.length_m   IS 'Longueur en mètres (mode surface)';
COMMENT ON COLUMN quote_items.width_m    IS 'Largeur en mètres (mode surface)';
COMMENT ON COLUMN invoice_items.length_m IS 'Longueur en mètres (mode surface)';
COMMENT ON COLUMN invoice_items.width_m  IS 'Largeur en mètres (mode surface)';
