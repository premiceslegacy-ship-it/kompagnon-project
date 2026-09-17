-- ============================================================
-- 190_planning_free_events.sql
-- Permet des créneaux de planning sans chantier (RDV commercial,
-- visite technique, RDV personnel...). Jusqu'ici chantier_id était
-- NOT NULL et la RLS dérivait l'organisation uniquement via le
-- chantier lié — impossible de créer un créneau libre.
-- ============================================================

-- organization_id dénormalisé : source de vérité pour la RLS,
-- indépendante de la présence d'un chantier.
ALTER TABLE public.chantier_plannings
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

UPDATE public.chantier_plannings cp
SET organization_id = c.organization_id
FROM public.chantiers c
WHERE cp.chantier_id = c.id
  AND cp.organization_id IS NULL;

ALTER TABLE public.chantier_plannings
  ALTER COLUMN organization_id SET NOT NULL;

-- chantier_id devient optionnel : un créneau libre n'en a pas.
ALTER TABLE public.chantier_plannings
  ALTER COLUMN chantier_id DROP NOT NULL;

-- Discriminant de type d'événement + titre libre pour les RDV
-- sans chantier (label existant reste le "qui", title est le "quoi").
ALTER TABLE public.chantier_plannings
  ADD COLUMN IF NOT EXISTS event_type TEXT NOT NULL DEFAULT 'chantier'
    CHECK (event_type IN ('chantier', 'rdv_commercial', 'visite_technique', 'personnel', 'autre')),
  ADD COLUMN IF NOT EXISTS title TEXT;

ALTER TABLE public.chantier_plannings
  ADD CONSTRAINT chantier_plannings_chantier_or_free_event
  CHECK (
    (event_type = 'chantier' AND chantier_id IS NOT NULL)
    OR (event_type <> 'chantier' AND chantier_id IS NULL AND title IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS idx_chantier_plannings_org
  ON public.chantier_plannings(organization_id, planned_date);

-- Trigger : maintient organization_id synchronisé avec chantier_id
-- quand un chantier est renseigné (insert/update), pour ne jamais
-- laisser les deux se désynchroniser.
CREATE OR REPLACE FUNCTION public.sync_chantier_planning_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.chantier_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.chantiers WHERE id = NEW.chantier_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER trigger_sync_chantier_planning_org
  BEFORE INSERT OR UPDATE OF chantier_id ON public.chantier_plannings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_chantier_planning_org();

-- RLS : dérive désormais l'organisation directement, plus besoin
-- de remonter par le chantier (qui peut être absent).
DROP POLICY IF EXISTS "chantier_plannings_all" ON public.chantier_plannings;

CREATE POLICY "chantier_plannings_all"
  ON public.chantier_plannings FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

COMMENT ON COLUMN public.chantier_plannings.organization_id IS
  'Organisation propriétaire, dénormalisée depuis chantiers pour supporter les créneaux sans chantier';
COMMENT ON COLUMN public.chantier_plannings.event_type IS
  'chantier (défaut, lié à chantier_id) | rdv_commercial | visite_technique | personnel | autre';
COMMENT ON COLUMN public.chantier_plannings.title IS
  'Titre libre pour un événement sans chantier (ex: "RDV client Dupont")';
