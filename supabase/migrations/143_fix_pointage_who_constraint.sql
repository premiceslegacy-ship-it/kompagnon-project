-- Migration 143 : correction de la contrainte chantier_pointages_who
--
-- La contrainte existante en prod peut être plus restrictive que prévu,
-- bloquant les inserts depuis l'espace membres (admin client, service_role).
-- On la recrée pour couvrir tous les cas légitimes :
-- - user_id  : utilisateur app authentifié
-- - member_id : intervenant sans compte (chantier_equipe_membres)
-- - maintenance_intervention_id : pointage lié à une intervention entretien

ALTER TABLE public.chantier_pointages
  DROP CONSTRAINT IF EXISTS chantier_pointages_who;

ALTER TABLE public.chantier_pointages
  ADD CONSTRAINT chantier_pointages_who
  CHECK (
    user_id IS NOT NULL
    OR member_id IS NOT NULL
    OR maintenance_intervention_id IS NOT NULL
  );
