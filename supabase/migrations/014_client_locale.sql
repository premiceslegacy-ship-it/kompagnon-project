-- Migration 014 : locale sur les clients
-- Permet de stocker la langue préférée d'un client (fr/en) pour adapter les documents et emails.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'fr'
    CHECK (locale IN ('fr', 'en'));

COMMENT ON COLUMN clients.locale IS 'Langue préférée du client : fr (défaut) ou en. Utilisée pour les PDFs et emails envoyés à ce client.';
