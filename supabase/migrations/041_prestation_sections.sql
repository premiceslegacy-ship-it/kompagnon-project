-- ============================================================
-- 041_prestation_sections.sql
-- Ajout du champ section_title sur prestation_type_items
-- Permet d'organiser les items d'une prestation type en sections
-- (même structure que les quote_sections dans un devis)
-- ============================================================

ALTER TABLE public.prestation_type_items
  ADD COLUMN IF NOT EXISTS section_title TEXT NOT NULL DEFAULT '';
