-- 090_planning_tournee.sql
-- Planification par tournée : regroupement, durée sur site, trajet, ordre
-- Dépend de : 032_chantier_planning.sql, 073_member_planning_and_expenses.sql

ALTER TABLE public.chantier_plannings
  ADD COLUMN IF NOT EXISTS route_order          INTEGER,
  ADD COLUMN IF NOT EXISTS duration_min         INTEGER CHECK (duration_min IS NULL OR duration_min > 0),
  ADD COLUMN IF NOT EXISTS travel_from_prev_min INTEGER CHECK (travel_from_prev_min IS NULL OR travel_from_prev_min >= 0),
  ADD COLUMN IF NOT EXISTS route_id             UUID;

COMMENT ON COLUMN public.chantier_plannings.route_order          IS 'Position du site dans la tournée (1-based, NULL si hors tournée)';
COMMENT ON COLUMN public.chantier_plannings.duration_min         IS 'Durée prévue sur site en minutes';
COMMENT ON COLUMN public.chantier_plannings.travel_from_prev_min IS 'Trajet depuis le site précédent en minutes (NULL pour le 1er site)';
COMMENT ON COLUMN public.chantier_plannings.route_id             IS 'UUID partagé par tous les slots d''une même tournée journalière';

CREATE INDEX IF NOT EXISTS chantier_plannings_route_idx
  ON public.chantier_plannings (route_id, route_order)
  WHERE route_id IS NOT NULL;
