-- ============================================================
-- 040_prestation_type_items.sql
-- Lignes composant les prestations types : MO, transport, articles, lignes libres
-- Dépend de : 039_prestation_types.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.prestation_type_items (
  id                  UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  prestation_type_id  UUID           NOT NULL REFERENCES public.prestation_types(id) ON DELETE CASCADE,
  organization_id     UUID           NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  position            INT            NOT NULL DEFAULT 0,
  -- 'material' | 'labor' | 'transport' | 'free'
  item_type           TEXT           NOT NULL DEFAULT 'free',
  -- Liens optionnels vers le catalogue
  material_id         UUID           REFERENCES public.materials(id) ON DELETE SET NULL,
  labor_rate_id       UUID           REFERENCES public.labor_rates(id) ON DELETE SET NULL,
  designation         TEXT           NOT NULL,
  quantity            DECIMAL(10,3)  NOT NULL DEFAULT 1,
  unit                TEXT           NOT NULL DEFAULT 'u',
  unit_price_ht       DECIMAL(10,2)  NOT NULL DEFAULT 0,
  unit_cost_ht        DECIMAL(10,2)  NOT NULL DEFAULT 0,
  -- true = ligne interne (MO, transport) : contribue au coût mais pas au prix client
  is_internal         BOOLEAN        NOT NULL DEFAULT false,
  created_at          TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT chk_prestation_item_type CHECK (item_type IN ('material', 'labor', 'transport', 'free'))
);

CREATE INDEX IF NOT EXISTS idx_prestation_type_items_pt  ON public.prestation_type_items(prestation_type_id);
CREATE INDEX IF NOT EXISTS idx_prestation_type_items_org ON public.prestation_type_items(organization_id);

-- RLS via parent join (même pattern que quote_items)
ALTER TABLE public.prestation_type_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prestation_type_items_all" ON public.prestation_type_items
  FOR ALL TO authenticated
  USING (
    prestation_type_id IN (
      SELECT id FROM public.prestation_types
      WHERE organization_id = public.get_user_org_id()
    )
  );

-- ─── Trigger : sync totaux parent ────────────────────────────────────────────
-- base_price_ht = somme des lignes NON internes (prix client)
-- base_cost_ht  = somme de toutes les lignes (coût réel)
-- base_margin_pct est GENERATED STORED sur prestation_types, se met à jour auto

CREATE OR REPLACE FUNCTION public.sync_prestation_type_totals()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_pt_id UUID;
BEGIN
  v_pt_id := COALESCE(NEW.prestation_type_id, OLD.prestation_type_id);

  UPDATE public.prestation_types
  SET
    base_price_ht = (
      SELECT COALESCE(SUM(quantity * unit_price_ht), 0)
      FROM public.prestation_type_items
      WHERE prestation_type_id = v_pt_id
        AND NOT is_internal
    ),
    base_cost_ht = (
      SELECT COALESCE(SUM(quantity * unit_cost_ht), 0)
      FROM public.prestation_type_items
      WHERE prestation_type_id = v_pt_id
    )
  WHERE id = v_pt_id;

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_prestation_totals
AFTER INSERT OR UPDATE OR DELETE ON public.prestation_type_items
FOR EACH ROW EXECUTE FUNCTION public.sync_prestation_type_totals();
