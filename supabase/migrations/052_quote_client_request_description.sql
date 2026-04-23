-- ============================================================
-- 052_quote_client_request_description.sql
-- Stocke la description originale du client (formulaire public)
-- sur le devis, séparément des lignes de devis.
-- ============================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS client_request_description TEXT,
  ADD COLUMN IF NOT EXISTS client_request_visible_on_pdf BOOLEAN NOT NULL DEFAULT true;
