-- Migration 037 : Adresse du chantier dans les demandes de devis
-- Nécessaire pour le calcul de distance → marge distancielle (prestations types)

ALTER TABLE quote_requests
  ADD COLUMN IF NOT EXISTS chantier_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS chantier_postal_code   TEXT,
  ADD COLUMN IF NOT EXISTS chantier_city          TEXT;
