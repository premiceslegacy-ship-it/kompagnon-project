-- Ajout du nickel (NI) comme 5ème métal coté LME dans le module prix matières.
-- Sert de proxy de cours pour l'inox : MetalPriceAPI ne fournit pas de code
-- dédié "stainless steel", le nickel étant son composant d'alliage dominant.

ALTER TABLE public.cached_metal_prices
  DROP CONSTRAINT IF EXISTS cached_metal_prices_metal_code_check,
  ADD CONSTRAINT cached_metal_prices_metal_code_check
    CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB', 'NI'));

ALTER TABLE public.metal_price_grids
  DROP CONSTRAINT IF EXISTS metal_price_grids_metal_code_check,
  ADD CONSTRAINT metal_price_grids_metal_code_check
    CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB', 'STEEL', 'NI'));

ALTER TABLE public.metal_price_snapshots
  DROP CONSTRAINT IF EXISTS metal_price_snapshots_metal_code_check,
  ADD CONSTRAINT metal_price_snapshots_metal_code_check
    CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB', 'STEEL', 'NI'));
