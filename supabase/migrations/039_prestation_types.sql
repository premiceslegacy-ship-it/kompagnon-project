-- ============================================================
-- 039_prestation_types.sql
-- Prestations types avec marge configurable et règles distance
-- Dépend de : 002_core_tables.sql (organizations), 008_rls.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.prestation_types (
  id               UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             TEXT          NOT NULL,
  description      TEXT,
  unit             TEXT          NOT NULL DEFAULT 'm²',
  category         TEXT,
  base_price_ht    DECIMAL(10,2) NOT NULL DEFAULT 0,
  base_cost_ht     DECIMAL(10,2) NOT NULL DEFAULT 0,
  -- Marge calculée automatiquement : (prix - coût) / prix * 100
  base_margin_pct  DECIMAL(5,2)  GENERATED ALWAYS AS (
    CASE
      WHEN base_price_ht > 0
      THEN ROUND((base_price_ht - base_cost_ht) / base_price_ht * 100, 2)
      ELSE 0
    END
  ) STORED,
  -- Règles de majoration par distance (km)
  -- Exemple : [{"from":0,"to":20,"multiplier":1.0},{"from":20,"to":50,"multiplier":1.08}]
  distance_rules   JSONB         DEFAULT '[]'::jsonb,
  vat_rate         DECIMAL(5,2)  NOT NULL DEFAULT 20.00,
  is_active        BOOLEAN       NOT NULL DEFAULT true,
  created_by       UUID          REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- Index
CREATE INDEX IF NOT EXISTS idx_prestation_types_org       ON public.prestation_types(organization_id);
CREATE INDEX IF NOT EXISTS idx_prestation_types_org_active ON public.prestation_types(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_prestation_types_category   ON public.prestation_types(organization_id, category);

-- Trigger updated_at
SELECT create_updated_at_trigger('prestation_types');

-- RLS
ALTER TABLE public.prestation_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prestation_types_select" ON public.prestation_types
  FOR SELECT USING (
    organization_id = get_user_org_id()
    AND user_has_permission('catalog.view')
  );

CREATE POLICY "prestation_types_insert" ON public.prestation_types
  FOR INSERT WITH CHECK (
    organization_id = get_user_org_id()
    AND user_has_permission('catalog.edit')
  );

CREATE POLICY "prestation_types_update" ON public.prestation_types
  FOR UPDATE USING (
    organization_id = get_user_org_id()
    AND user_has_permission('catalog.edit')
  );

CREATE POLICY "prestation_types_delete" ON public.prestation_types
  FOR DELETE USING (
    organization_id = get_user_org_id()
    AND user_has_permission('catalog.delete')
  );
