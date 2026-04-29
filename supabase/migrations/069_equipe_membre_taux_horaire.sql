-- Taux horaire spécifique par membre d'équipe (chantier-specific)
-- Fallback : si NULL, on utilise le taux du membership (labor_cost_per_hour)
ALTER TABLE chantier_equipe_membres
  ADD COLUMN IF NOT EXISTS taux_horaire NUMERIC(8,2) DEFAULT NULL;
