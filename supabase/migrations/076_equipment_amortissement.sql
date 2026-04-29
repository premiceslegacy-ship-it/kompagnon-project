-- 076_equipment_amortissement.sql
-- Ajoute la gestion du matériel amorti (aspirateurs, machines, etc.)
-- sur les labor_rates + ouvre le type 'equipment' dans les lignes de prestation

-- Nouveaux champs sur labor_rates pour l'amortissement
ALTER TABLE public.labor_rates
  ADD COLUMN IF NOT EXISTS purchase_price   DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS lifetime_uses    INTEGER;

-- Ouvrir le CHECK sur prestation_type_items pour accepter 'equipment'
ALTER TABLE public.prestation_type_items
  DROP CONSTRAINT IF EXISTS chk_prestation_item_type;

ALTER TABLE public.prestation_type_items
  ADD CONSTRAINT chk_prestation_item_type
  CHECK (item_type IN ('material', 'labor', 'transport', 'free', 'service', 'equipment'));

-- Ouvrir le CHECK sur catalog_prestation_items (migration 050) s'il existe
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'catalog_prestation_items'
  ) THEN
    ALTER TABLE public.catalog_prestation_items
      DROP CONSTRAINT IF EXISTS catalog_prestation_items_item_type_check;
    ALTER TABLE public.catalog_prestation_items
      ADD CONSTRAINT catalog_prestation_items_item_type_check
      CHECK (item_type IN ('material', 'service', 'labor', 'transport', 'free', 'equipment'));
  END IF;
END $$;
