-- Activités secondaires déclarées par l'organisation.
-- L'activité principale reste business_activity_id (pilote les labels, unités, templates).
-- Les activités secondaires sont injectées dans le contexte IA uniquement.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS secondary_activity_ids JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.organizations.secondary_activity_ids IS
  'IDs des activités secondaires (BusinessActivityId[]). N''impacte pas les labels ni les templates — injectées dans le contexte IA.';
