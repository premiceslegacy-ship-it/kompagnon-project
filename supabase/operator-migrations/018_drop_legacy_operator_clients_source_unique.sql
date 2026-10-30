-- L'ancienne version du cockpit imposait un seul client par déploiement avec
-- UNIQUE(source_instance). Depuis l'instance mutualisée, l'identité correcte
-- est (source_instance, organization_id). Conserver l'ancienne contrainte fait
-- échouer l'ingestion IA de toute organisation créée après la première.

ALTER TABLE public.operator_clients
  DROP CONSTRAINT IF EXISTS operator_clients_source_instance_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'operator_clients_source_instance_org_unique'
  ) THEN
    ALTER TABLE public.operator_clients
      ADD CONSTRAINT operator_clients_source_instance_org_unique
      UNIQUE (source_instance, organization_id);
  END IF;
END $$;
