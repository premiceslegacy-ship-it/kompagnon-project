-- 144_chantier_planning_pointages.sql
-- Relie un pointage au créneau chantier planifié qui l'a généré.

ALTER TABLE public.chantier_pointages
  ADD COLUMN IF NOT EXISTS chantier_planning_id UUID REFERENCES public.chantier_plannings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_pointages_planning
  ON public.chantier_pointages(chantier_planning_id)
  WHERE chantier_planning_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_chantier_pointages_planning_member
  ON public.chantier_pointages(chantier_planning_id, member_id)
  WHERE chantier_planning_id IS NOT NULL AND member_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_chantier_pointages_planning_user
  ON public.chantier_pointages(chantier_planning_id, user_id)
  WHERE chantier_planning_id IS NOT NULL AND user_id IS NOT NULL;

COMMENT ON COLUMN public.chantier_pointages.chantier_planning_id IS
  'Créneau chantier planifié utilisé pour générer le pointage depuis l''espace intervenant';
