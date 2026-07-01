-- Ajout du support acier (saisie manuelle) dans le module prix matières.
-- L'acier n'est pas coté LME : le prix est saisi manuellement par l'artisan
-- et stocké dans la grille elle-même (manual_price_eur_kg).

-- Nouvelles colonnes sur metal_price_grids
ALTER TABLE public.metal_price_grids
  ADD COLUMN IF NOT EXISTS source_type TEXT DEFAULT 'lme',
  ADD COLUMN IF NOT EXISTS manual_price_eur_kg NUMERIC(10, 4);

UPDATE public.metal_price_grids
SET source_type = 'lme'
WHERE source_type IS NULL;

ALTER TABLE public.metal_price_grids
  ALTER COLUMN source_type SET DEFAULT 'lme',
  ALTER COLUMN source_type SET NOT NULL;

ALTER TABLE public.metal_price_grids
  DROP CONSTRAINT IF EXISTS metal_price_grids_source_type_check,
  DROP CONSTRAINT IF EXISTS metal_price_grids_manual_price_check,
  ADD CONSTRAINT metal_price_grids_source_type_check
    CHECK (source_type IN ('lme', 'manual')),
  ADD CONSTRAINT metal_price_grids_manual_price_check
    CHECK (
      (source_type = 'manual' AND manual_price_eur_kg IS NOT NULL AND manual_price_eur_kg > 0)
      OR
      (source_type = 'lme' AND manual_price_eur_kg IS NULL)
    );

-- Étendre la contrainte metal_code pour accepter STEEL
ALTER TABLE public.metal_price_grids
  DROP CONSTRAINT IF EXISTS metal_price_grids_metal_code_check,
  ADD CONSTRAINT metal_price_grids_metal_code_check
    CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB', 'STEEL'));

-- Les grilles STEEL sont forcément en saisie manuelle
ALTER TABLE public.metal_price_grids
  DROP CONSTRAINT IF EXISTS metal_price_grids_steel_manual_check,
  ADD CONSTRAINT metal_price_grids_steel_manual_check
    CHECK (
      metal_code != 'STEEL'
      OR (metal_code = 'STEEL' AND source_type = 'manual')
    );

-- Étendre la contrainte metal_code sur les snapshots pour tracer l'acier
ALTER TABLE public.metal_price_snapshots
  DROP CONSTRAINT IF EXISTS metal_price_snapshots_metal_code_check,
  ADD CONSTRAINT metal_price_snapshots_metal_code_check
    CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB', 'STEEL'));

-- La colonne lme_price_eur_kg devient nullable pour les snapshots acier (prix manuel)
ALTER TABLE public.metal_price_snapshots
  ALTER COLUMN lme_price_eur_kg DROP NOT NULL;

-- Étendre la colonne source des snapshots pour tracer l'origine
-- (valeurs existantes : 'atelier_market_data', nouvelle valeur : 'manual')
-- Pas de contrainte CHECK sur source : la colonne est déjà TEXT sans contrainte.
