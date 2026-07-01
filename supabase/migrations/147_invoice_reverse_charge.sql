-- Migration 147 : autoliquidation TVA sous-traitant BTP (art. 283-2 nonies CGI)
--
-- Quand is_reverse_charge = true :
--   - la TVA est à 0 % sur la facture émise par le sous-traitant
--   - la mention légale obligatoire doit apparaître sur le PDF
--   - l'entreprise générale qui reçoit cette facture déclare la TVA à sa place

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS is_reverse_charge BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN invoices.is_reverse_charge IS
  'Autoliquidation TVA sous-traitance BTP — art. 283-2 nonies CGI. Quand TRUE : mention obligatoire sur facture, TVA portée par le donneur d''ordre.';
