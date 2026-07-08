-- Coordonnées GPS des chantiers, pour la carte multi-points de tournée.
-- Géocodage à la volée (pas de script batch) : renseigné au fil de l'affichage
-- de la carte via api-adresse.data.gouv.fr, jamais recalculé une fois rempli.
-- Nullable : chantiers sans adresse exploitable ou jamais affichés sur une
-- carte de tournée restent NULL indéfiniment, sans impact.

ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS latitude  NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS longitude NUMERIC(9,6);

COMMENT ON COLUMN public.chantiers.latitude IS
  'Latitude géocodée à la volée depuis address_line1/postal_code/city — NULL tant que non géocodé ou non géocodable';
COMMENT ON COLUMN public.chantiers.longitude IS
  'Longitude géocodée à la volée — voir latitude';
