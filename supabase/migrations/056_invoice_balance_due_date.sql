-- Échéance du solde restant après versement d'un acompte.
-- Permet de rappeler à l'utilisateur quand le reste du montant doit être réglé.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS balance_due_date DATE;

COMMENT ON COLUMN public.invoices.balance_due_date IS
  'Pour les factures d''acompte : date à laquelle le solde restant doit être versé';
