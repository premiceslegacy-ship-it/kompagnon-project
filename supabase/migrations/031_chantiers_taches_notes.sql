-- 031_chantiers_taches_notes.sql
-- Note d'avancement sur chantier_taches
-- Dépend de : 029_chantiers.sql

ALTER TABLE public.chantier_taches
  ADD COLUMN IF NOT EXISTS progress_note TEXT;

COMMENT ON COLUMN public.chantier_taches.progress_note IS
  'Note libre sur l''avancement, visible quand la tâche est en cours';
