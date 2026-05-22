-- ============================================================
-- 102_pointage_rate_snapshot.sql
-- Snapshot du taux horaire au moment de la saisie du pointage
-- Depend de : 029_chantiers.sql, 067_chantier_costs.sql
-- ============================================================

ALTER TABLE public.chantier_pointages
  ADD COLUMN IF NOT EXISTS rate_snapshot NUMERIC(8,2) DEFAULT NULL;

COMMENT ON COLUMN public.chantier_pointages.rate_snapshot IS
  'Taux horaire (EUR/h) figé au moment de la saisie. NULL = pointage antérieur à cette migration (fallback sur taux membre/org au calcul).';
