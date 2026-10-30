-- Contract links are reachable through a public signature capability and are
-- read/written with service_role. Their organization must be enforced in the
-- database, not only in the authenticated form that originally creates them.
BEGIN;

-- Do not silently rewrite legal documents if an older writer has left an
-- inconsistent link. Reconcile ownership before releasing this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.contracts AS c
    LEFT JOIN public.clients AS cl ON cl.id = c.client_id
    LEFT JOIN public.chantiers AS ch ON ch.id = c.chantier_id
    LEFT JOIN public.quotes AS q ON q.id = c.quote_id
    WHERE (c.client_id IS NOT NULL AND cl.organization_id IS DISTINCT FROM c.organization_id)
       OR (c.chantier_id IS NOT NULL AND ch.organization_id IS DISTINCT FROM c.organization_id)
       OR (c.quote_id IS NOT NULL AND q.organization_id IS DISTINCT FROM c.organization_id)
  ) THEN
    RAISE EXCEPTION 'Contrats avec références inter-organisations : réconciliation requise avant déploiement';
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_same_org_refs ON public.contracts;
CREATE TRIGGER trg_same_org_refs
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.enforce_same_org_refs(
    'client_id', 'clients', 'chantier_id', 'chantiers', 'quote_id', 'quotes');

COMMIT;
