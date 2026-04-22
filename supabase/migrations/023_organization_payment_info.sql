-- Informations bancaires et mentions légales de paiement obligatoires
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS iban              TEXT,
  ADD COLUMN IF NOT EXISTS bic              TEXT,
  ADD COLUMN IF NOT EXISTS bank_name        TEXT,
  ADD COLUMN IF NOT EXISTS recovery_indemnity_text TEXT DEFAULT 'Toute facture non réglée à son échéance entraîne l''application de pénalités de retard et d''une indemnité forfaitaire de recouvrement de 40 €.';
