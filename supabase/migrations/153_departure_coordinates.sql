-- Coordonnées GPS du point de départ des tournées (carte interactive settings)
-- Colonnes texte existantes conservées (affichage utilisateur / PDF), coordonnées ajoutées
-- pour la carte. Les deux doivent être tenues synchronisées côté application.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS departure_latitude  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS departure_longitude NUMERIC(9,6);

ALTER TABLE public.tournee_routes
  ADD COLUMN IF NOT EXISTS departure_latitude  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS departure_longitude NUMERIC(9,6);
