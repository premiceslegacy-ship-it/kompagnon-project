-- 099_quote_invoice_items_unit_cost.sql
-- Ajoute le coût interne unitaire sur les lignes de devis et de facture.
-- Ce champ est renseigné automatiquement depuis le catalogue (purchase_price sur
-- les matériaux, cost_rate sur les taux MO, unit_cost_ht sur les prestations types)
-- et permet de calculer la marge réelle ligne par ligne sans impacter les PDF client.

ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS unit_cost_ht numeric DEFAULT NULL;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS unit_cost_ht numeric DEFAULT NULL;

COMMENT ON COLUMN public.quote_items.unit_cost_ht  IS 'Coût interne unitaire HT (jamais affiché au client). Alimenté depuis le catalogue : purchase_price (matériaux), cost_rate (MO), unit_cost_ht (prestations).';
COMMENT ON COLUMN public.invoice_items.unit_cost_ht IS 'Coût interne unitaire HT (jamais affiché au client). Copié depuis la ligne de devis lors de la génération de facture.';
