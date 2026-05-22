-- ============================================================
-- 105_setup_checklist_dismissed.sql
-- Permet à l'owner de masquer définitivement la quête de lancement
-- une fois toutes les missions complétées.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS setup_checklist_dismissed BOOLEAN NOT NULL DEFAULT false;
