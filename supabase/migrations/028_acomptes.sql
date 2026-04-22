-- ============================================================
-- 028_acomptes.sql
-- Système d'acomptes et de soldes sur devis acceptés
-- ============================================================

-- Type de facture : standard (classique), acompte (avance sur devis),
-- situation (facturation partielle sur avancement), solde (déduit les acomptes)
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_type TEXT NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN public.invoices.invoice_type IS
  'standard = facture classique | acompte = avance sur devis accepté | situation = avancement partiel | solde = solde final avec déduction des acomptes versés';

-- Index pour retrouver rapidement toutes les factures d'acompte liées à un devis
CREATE INDEX IF NOT EXISTS idx_invoices_quote_type
  ON public.invoices(quote_id, invoice_type)
  WHERE quote_id IS NOT NULL;
