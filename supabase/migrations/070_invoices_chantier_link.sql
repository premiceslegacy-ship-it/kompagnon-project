-- ============================================================
-- 070_invoices_chantier_link.sql
-- Lien direct facture → chantier (en plus du quote_id existant)
-- Permet au calcul de rentabilité de capter aussi les factures
-- créées sans devis ou hors du chemin "situation".
-- Dépend de : 029_chantiers.sql, 004_business_tables.sql
-- ============================================================

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS chantier_id UUID REFERENCES public.chantiers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_chantier_id ON public.invoices(chantier_id);

COMMENT ON COLUMN public.invoices.chantier_id IS
  'Chantier rattaché — permet d''agréger le facturé d''un chantier même sans devis associé.';
