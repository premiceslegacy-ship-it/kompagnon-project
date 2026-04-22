-- ============================================================
-- 015_quote_item_internal.sql
-- Marque une ligne de devis comme interne (non affichée dans le PDF client)
-- Utilisé principalement pour les lignes de main d'oeuvre
-- ============================================================

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.quote_items.is_internal IS
  'Si true, la ligne est masquée du PDF client (usage interne uniquement)';
