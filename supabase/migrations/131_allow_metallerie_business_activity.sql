-- Autorise l'activité Métallerie dans la contrainte historique organizations.business_activity_id.
-- La migration 050 listait les activités initiales avant l'ajout de metallerie.

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_business_activity_id_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_business_activity_id_check
  CHECK (business_activity_id IN (
    'nettoyage_bureaux',
    'vitrerie',
    'desinfection',
    'remise_en_etat',
    'renovation',
    'electricite',
    'plomberie',
    'menuiserie',
    'maconnerie',
    'peinture',
    'carrelage',
    'facade',
    'charpente',
    'depannage_multitechnique',
    'metallerie',
    'tolerie',
    'chaudronnerie',
    'decoupe_laser',
    'pliage',
    'soudure',
    'fabrication_atelier'
  ));
