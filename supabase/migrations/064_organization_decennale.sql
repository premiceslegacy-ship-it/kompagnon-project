-- Migration 064 : Garantie décennale structurée sur les organisations
-- Remplace le champ texte libre insurance_info pour les informations décennales
-- insurance_info reste en place pour les autres assurances (RC Pro, etc.)

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS decennale_enabled       boolean     DEFAULT false,
  ADD COLUMN IF NOT EXISTS decennale_assureur       text,
  ADD COLUMN IF NOT EXISTS decennale_police         text,
  ADD COLUMN IF NOT EXISTS decennale_couverture     text,
  ADD COLUMN IF NOT EXISTS decennale_date_debut     date,
  ADD COLUMN IF NOT EXISTS decennale_date_fin       date;
