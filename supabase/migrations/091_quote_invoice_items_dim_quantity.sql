-- 091_quote_invoice_items_dim_quantity.sql
-- Nombre d'unités dimensionnelles (multiplicateur : nb × surface/longueur/volume calculée)
ALTER TABLE public.quote_items
  ADD COLUMN IF NOT EXISTS dim_quantity NUMERIC(10,3) NOT NULL DEFAULT 1;

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS dim_quantity NUMERIC(10,3) NOT NULL DEFAULT 1;

COMMENT ON COLUMN public.quote_items.dim_quantity IS 'Multiplicateur dimensionnel : quantité totale = dim_quantity × (L×l ou L ou L×l×h)';
COMMENT ON COLUMN public.invoice_items.dim_quantity IS 'Multiplicateur dimensionnel : quantité totale = dim_quantity × (L×l ou L ou L×l×h)';
