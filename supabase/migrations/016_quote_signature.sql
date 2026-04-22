-- Migration 016 — Signature électronique des devis
-- Ajoute les champs nécessaires pour la signature client par lien sécurisé

ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS signature_token UUID UNIQUE,
  ADD COLUMN IF NOT EXISTS signed_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signed_ip        TEXT,
  ADD COLUMN IF NOT EXISTS signed_user_agent TEXT;

-- Index pour la recherche par token (lookup rapide)
CREATE UNIQUE INDEX IF NOT EXISTS quotes_signature_token_idx ON quotes (signature_token) WHERE signature_token IS NOT NULL;
