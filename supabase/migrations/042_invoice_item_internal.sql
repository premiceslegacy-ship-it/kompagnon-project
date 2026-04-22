-- Ligne interne sur invoice_items et recurring_invoice_items
-- Permet de masquer les lignes de coût (MO, transport interne) du PDF client
-- et d'afficher la marge dans l'éditeur.

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoice_items.is_internal IS
  'Si true, la ligne est masquée du PDF client (marge interne)';

ALTER TABLE public.recurring_invoice_items
  ADD COLUMN IF NOT EXISTS is_internal BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.recurring_invoice_items.is_internal IS
  'Si true, la ligne est masquée du PDF client (marge interne)';
