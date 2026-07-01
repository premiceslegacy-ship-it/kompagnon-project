-- Durcissement du module prix matières métaux.
-- À appliquer après 120_metal_pricing.sql et 121_quote_items_metal_grid_id.sql.

-- Le cache des cours est une donnée serveur partagée : pas d'accès direct client.
ALTER TABLE public.cached_metal_prices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.cached_metal_prices FROM anon;
REVOKE ALL ON TABLE public.cached_metal_prices FROM authenticated;

-- Contraintes métier côté base pour éviter les valeurs hors catalogue.
ALTER TABLE public.cached_metal_prices
  DROP CONSTRAINT IF EXISTS cached_metal_prices_metal_code_check,
  ADD CONSTRAINT cached_metal_prices_metal_code_check
    CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB'));

ALTER TABLE public.metal_price_grids
  DROP CONSTRAINT IF EXISTS metal_price_grids_metal_code_check,
  ADD CONSTRAINT metal_price_grids_metal_code_check
    CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB')),
  DROP CONSTRAINT IF EXISTS metal_price_grids_coefficient_check,
  ADD CONSTRAINT metal_price_grids_coefficient_check
    CHECK (coefficient > 0 AND coefficient <= 100),
  DROP CONSTRAINT IF EXISTS metal_price_grids_unit_check,
  ADD CONSTRAINT metal_price_grids_unit_check
    CHECK (unit IN ('kg', 'm²', 'ml', 'pièce', 'tonne'));

ALTER TABLE public.metal_price_snapshots
  DROP CONSTRAINT IF EXISTS metal_price_snapshots_metal_code_check,
  ADD CONSTRAINT metal_price_snapshots_metal_code_check
    CHECK (metal_code IN ('ALU', 'XCU', 'ZNC', 'PB')),
  DROP CONSTRAINT IF EXISTS metal_price_snapshots_coefficient_check,
  ADD CONSTRAINT metal_price_snapshots_coefficient_check
    CHECK (coefficient > 0 AND coefficient <= 100);

-- Une ligne de devis ne doit avoir qu'un snapshot courant.
WITH ranked AS (
  SELECT
    id,
    row_number() OVER (PARTITION BY quote_item_id ORDER BY created_at DESC, id DESC) AS rn
  FROM public.metal_price_snapshots
)
DELETE FROM public.metal_price_snapshots s
USING ranked r
WHERE s.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_metal_price_snapshots_quote_item
  ON public.metal_price_snapshots(quote_item_id);

-- Les mentions client PDF sont désactivées : la traçabilité reste interne.
UPDATE public.metal_price_snapshots
SET show_on_pdf = false
WHERE show_on_pdf = true;

-- RLS : accès uniquement aux memberships actifs, et écriture dans sa propre org.
DROP POLICY IF EXISTS "metal_price_grids_org_access" ON public.metal_price_grids;
CREATE POLICY "metal_price_grids_org_access" ON public.metal_price_grids
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.memberships
      WHERE user_id = auth.uid()
        AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM public.memberships
      WHERE user_id = auth.uid()
        AND is_active = true
    )
  );

DROP POLICY IF EXISTS "metal_price_snapshots_org_access" ON public.metal_price_snapshots;
CREATE POLICY "metal_price_snapshots_org_access" ON public.metal_price_snapshots
  FOR ALL TO authenticated
  USING (
    organization_id IN (
      SELECT organization_id
      FROM public.memberships
      WHERE user_id = auth.uid()
        AND is_active = true
    )
  )
  WITH CHECK (
    organization_id IN (
      SELECT organization_id
      FROM public.memberships
      WHERE user_id = auth.uid()
        AND is_active = true
    )
  );
