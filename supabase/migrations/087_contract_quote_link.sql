-- Lie un devis explicitement à un contrat (optionnel)
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS quote_id UUID REFERENCES quotes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_quote_id ON contracts(quote_id);
