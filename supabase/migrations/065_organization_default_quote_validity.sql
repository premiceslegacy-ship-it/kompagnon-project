-- Migration 065 : Durée de validité par défaut des devis au niveau organisation
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS default_quote_validity_days integer DEFAULT 30;
