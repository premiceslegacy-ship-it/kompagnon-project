-- Migration 066 : Aide/subvention déductible sur devis et factures
-- Permet d'afficher MaPrimeRénov, CEE, etc. avec le reste à charge client

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS aid_label  text,
  ADD COLUMN IF NOT EXISTS aid_amount numeric(12,2);

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS aid_label  text,
  ADD COLUMN IF NOT EXISTS aid_amount numeric(12,2);
