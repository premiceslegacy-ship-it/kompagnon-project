-- Module Prix Matières Métaux
-- Activé par client via flag hasMetalPricing (cockpit Orsayn).
-- Couvre : grilles matière client, cache cours LME, snapshot par ligne de devis.

-- ----------------------------------------------------------
-- Flag activation sur l'organisation
-- ----------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS has_metal_pricing BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.has_metal_pricing IS
  'Activé depuis le cockpit Orsayn. Conditionne l''accès au module prix matières métaux (tôliers, métalliers).';

-- ----------------------------------------------------------
-- cached_metal_prices
-- Cache serveur des cours LME — mis à jour toutes les 10 min max.
-- Une seule ligne par métal (upsert sur metal_code).
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cached_metal_prices (
  metal_code    TEXT        PRIMARY KEY,  -- 'ALU' | 'XCU' | 'ZNC' | 'PB'
  price_eur_kg  DECIMAL(10, 4) NOT NULL,  -- cours en EUR/kg
  source        TEXT        NOT NULL DEFAULT 'atelier_market_data', -- source de la donnée
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cached_metal_prices IS
  'Cache serveur des cours LME. Une ligne par métal, mise à jour toutes les 10 min maximum. Fallback : conserver la dernière valeur connue si l''API est indisponible.';

-- ----------------------------------------------------------
-- metal_price_grids
-- Grilles matière configurées par l'artisan dans ses paramètres.
-- Métal source + coefficient fournisseur = prix proposé dans le devis.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metal_price_grids (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  label           TEXT        NOT NULL,           -- libellé personnalisé (ex: "Alu 2mm fournisseur habituel")
  metal_code      TEXT        NOT NULL,           -- 'ALU' | 'XCU' | 'ZNC' | 'PB'
  coefficient     DECIMAL(6, 4) NOT NULL DEFAULT 1.0, -- ex: 1.35
  unit            TEXT        NOT NULL DEFAULT 'kg',  -- unité de vente (kg, m², ml...)
  catalog_item_id UUID        REFERENCES public.materials(id) ON DELETE SET NULL, -- article catalogue lié (optionnel)
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  position        INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.metal_price_grids IS
  'Grilles matière client : métal source + coefficient fournisseur. Pré-remplissent les lignes devis. Visibles uniquement si has_metal_pricing = true.';
COMMENT ON COLUMN public.metal_price_grids.coefficient IS
  'Coefficient appliqué au cours LME pour obtenir le prix de vente suggéré. Ex: 1.35 = cours × 1,35.';
COMMENT ON COLUMN public.metal_price_grids.catalog_item_id IS
  'Lien optionnel vers un article du catalogue (materials). Permet de pré-remplir la description et l''unité de la ligne devis.';

-- ----------------------------------------------------------
-- metal_price_snapshots
-- Audit immuable : cours, coefficient, prix validé par ligne de devis.
-- Enregistré à la validation du devis. Ne change pas si les cours bougent.
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.metal_price_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_item_id   UUID        NOT NULL REFERENCES public.quote_items(id) ON DELETE CASCADE,
  quote_id        UUID        NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  grid_id         UUID        REFERENCES public.metal_price_grids(id) ON DELETE SET NULL,
  metal_code      TEXT        NOT NULL,           -- 'ALU' | 'XCU' | 'ZNC' | 'PB'
  lme_price_eur_kg DECIMAL(10, 4) NOT NULL,       -- cours LME au moment de la validation
  coefficient     DECIMAL(6, 4) NOT NULL,
  computed_price  DECIMAL(10, 2) NOT NULL,        -- prix calculé = LME × coefficient
  validated_price DECIMAL(10, 2) NOT NULL,        -- prix final saisi par l'artisan
  source          TEXT        NOT NULL DEFAULT 'atelier_market_data',
  price_date      TIMESTAMPTZ NOT NULL,           -- horodatage du cours LME utilisé
  show_on_pdf     BOOLEAN     NOT NULL DEFAULT false, -- afficher mention textuelle sur le PDF client
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.metal_price_snapshots IS
  'Snapshot immuable des données cours/coefficient/prix au moment de la validation du devis. Sert de traçabilité réglementaire (art. L. 112-1 CMF).';
COMMENT ON COLUMN public.metal_price_snapshots.show_on_pdf IS
  'Si true, ajoute la mention textuelle du cours sur le PDF client (sans afficher le cours brut LME).';

-- ----------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_metal_price_grids_org
  ON public.metal_price_grids(organization_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_metal_price_snapshots_quote
  ON public.metal_price_snapshots(quote_id);

CREATE INDEX IF NOT EXISTS idx_metal_price_snapshots_quote_item
  ON public.metal_price_snapshots(quote_item_id);

-- ----------------------------------------------------------
-- RLS
-- ----------------------------------------------------------
ALTER TABLE public.metal_price_grids ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.metal_price_snapshots ENABLE ROW LEVEL SECURITY;
-- cached_metal_prices est partagé entre tous les clients — pas de RLS, lecture publique en interne.

-- metal_price_grids : accès limité aux membres de l'organisation
CREATE POLICY "metal_price_grids_org_access" ON public.metal_price_grids
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

-- metal_price_snapshots : accès limité aux membres de l'organisation
CREATE POLICY "metal_price_snapshots_org_access" ON public.metal_price_snapshots
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );
