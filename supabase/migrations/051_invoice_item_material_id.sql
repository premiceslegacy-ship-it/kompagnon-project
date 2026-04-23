-- 051_invoice_item_material_id.sql
-- Ajoute la référence au matériau catalogue sur les lignes de facture.
-- Permet de retrouver le bon article pour recalculer le prix dimensionnel
-- quand l'utilisateur modifie une dimension dans l'éditeur de facture.
-- (quote_items possède déjà material_id depuis la migration initiale.)

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS material_id UUID REFERENCES public.materials(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoice_items.material_id IS
  'Référence vers le matériau catalogue source. Permet le recalcul dimensionnel dans l''éditeur.';
