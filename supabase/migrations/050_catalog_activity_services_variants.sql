-- ============================================================
-- 050_catalog_activity_services_variants.sql
-- Activité métier explicite, lignes service et variantes tarifaires
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS business_activity_id TEXT;

UPDATE public.organizations
SET business_activity_id = CASE
  WHEN business_activity_id IS NOT NULL THEN business_activity_id
  WHEN LOWER(COALESCE(sector, '')) LIKE '%vitrerie%' THEN 'vitrerie'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%désinfection%' OR LOWER(COALESCE(sector, '')) LIKE '%desinfection%' THEN 'desinfection'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%remise en état%' OR LOWER(COALESCE(sector, '')) LIKE '%remise en etat%' THEN 'remise_en_etat'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%nettoyage%' THEN 'nettoyage_bureaux'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%électric%' OR LOWER(COALESCE(sector, '')) LIKE '%electric%' THEN 'electricite'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%plomberie%' THEN 'plomberie'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%menuiserie%' THEN 'menuiserie'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%maçonnerie%' OR LOWER(COALESCE(sector, '')) LIKE '%maconnerie%' THEN 'maconnerie'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%peinture%' THEN 'peinture'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%carrelage%' THEN 'carrelage'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%façade%' OR LOWER(COALESCE(sector, '')) LIKE '%facade%' THEN 'facade'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%charpente%' THEN 'charpente'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%dépannage%' OR LOWER(COALESCE(sector, '')) LIKE '%depannage%' THEN 'depannage_multitechnique'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%chaudron%' THEN 'chaudronnerie'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%laser%' THEN 'decoupe_laser'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%pliage%' THEN 'pliage'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%soudure%' THEN 'soudure'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%atelier%' THEN 'fabrication_atelier'
  WHEN LOWER(COALESCE(sector, '')) LIKE '%tôlerie%' OR LOWER(COALESCE(sector, '')) LIKE '%tolerie%' THEN 'tolerie'
  WHEN business_profile = 'cleaning' THEN 'nettoyage_bureaux'
  WHEN business_profile = 'industry' THEN 'tolerie'
  ELSE 'renovation'
END
WHERE business_activity_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'organizations_business_activity_id_check'
  ) THEN
    ALTER TABLE public.organizations
      ADD CONSTRAINT organizations_business_activity_id_check
      CHECK (business_activity_id IN (
        'nettoyage_bureaux',
        'vitrerie',
        'desinfection',
        'remise_en_etat',
        'renovation',
        'electricite',
        'plomberie',
        'menuiserie',
        'maconnerie',
        'peinture',
        'carrelage',
        'facade',
        'charpente',
        'depannage_multitechnique',
        'tolerie',
        'chaudronnerie',
        'decoupe_laser',
        'pliage',
        'soudure',
        'fabrication_atelier'
      ));
  END IF;
END $$;

COMMENT ON COLUMN public.organizations.business_activity_id IS
  'Activité métier de référence de l’organisation pour contextualiser le catalogue.';

ALTER TABLE public.materials
  ADD COLUMN IF NOT EXISTS dimension_schema JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.materials.dimension_schema IS
  'Définition optionnelle des dimensions métier: libellés, unités, rôles et ordre d''affichage.';

CREATE TABLE IF NOT EXISTS public.material_price_variants (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id       UUID          NOT NULL REFERENCES public.materials(id) ON DELETE CASCADE,
  organization_id   UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  position          INT           NOT NULL DEFAULT 0,
  label             TEXT,
  reference_suffix  TEXT,
  dimension_values  JSONB         NOT NULL DEFAULT '{}'::jsonb,
  sale_price        DECIMAL(10,2),
  purchase_price    DECIMAL(10,2),
  is_default        BOOLEAN       NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_material_price_variants_material
  ON public.material_price_variants(material_id, position);

CREATE INDEX IF NOT EXISTS idx_material_price_variants_org
  ON public.material_price_variants(organization_id);

SELECT create_updated_at_trigger('material_price_variants');

ALTER TABLE public.material_price_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "material_price_variants_all" ON public.material_price_variants
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND user_has_permission('catalog.view')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND user_has_permission('catalog.edit')
  );

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_prestation_item_type'
  ) THEN
    ALTER TABLE public.prestation_type_items
      DROP CONSTRAINT chk_prestation_item_type;
  END IF;
END $$;

ALTER TABLE public.prestation_type_items
  ADD CONSTRAINT chk_prestation_item_type
  CHECK (item_type IN ('material', 'service', 'labor', 'transport', 'free'));

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS dimension_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS variant_label TEXT,
  ADD COLUMN IF NOT EXISTS catalog_variant_id UUID REFERENCES public.material_price_variants(id) ON DELETE SET NULL;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS dimension_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS variant_label TEXT,
  ADD COLUMN IF NOT EXISTS catalog_variant_id UUID REFERENCES public.material_price_variants(id) ON DELETE SET NULL;

ALTER TABLE public.recurring_invoice_items
  ADD COLUMN IF NOT EXISTS dimension_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS variant_label TEXT,
  ADD COLUMN IF NOT EXISTS catalog_variant_id UUID REFERENCES public.material_price_variants(id) ON DELETE SET NULL;

ALTER TABLE public.prestation_type_items
  ADD COLUMN IF NOT EXISTS dimension_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS variant_label TEXT,
  ADD COLUMN IF NOT EXISTS catalog_variant_id UUID REFERENCES public.material_price_variants(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.quote_items.dimension_values IS
  'Valeurs métier additionnelles des dimensions/variantes saisies sur la ligne.';
COMMENT ON COLUMN public.quote_items.variant_label IS
  'Libellé de variante catalogue résolu au moment du chiffrage.';
