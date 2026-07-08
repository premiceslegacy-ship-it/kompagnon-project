-- ============================================================
-- 165_quote_requests_freeform_notes.sql
-- Précisions libres du formulaire public, séparées de la description
-- fusionnée : permet de générer des lignes de devis IA complémentaires
-- au catalogue sélectionné (demande mixte catalogue + texte libre).
-- ============================================================

ALTER TABLE public.quote_requests
  ADD COLUMN IF NOT EXISTS freeform_notes TEXT;
