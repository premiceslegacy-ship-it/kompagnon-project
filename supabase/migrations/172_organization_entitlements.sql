-- Entitlement local de l'instance SaaS mutualisée.
-- Les organisations historiques sans ligne restent en mode legacy : les
-- politiques restrictives ci-dessous ne changent donc pas les instances dédiées.

CREATE TABLE IF NOT EXISTS public.organization_entitlements (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  access_status TEXT NOT NULL DEFAULT 'locked'
    CHECK (access_status IN ('locked','trialing','active','past_due','canceling','expired','unpaid')),
  effective_tier TEXT NOT NULL DEFAULT 'setup_only'
    CHECK (effective_tier IN ('setup_only','starter','pro','expert')),
  preferred_tier TEXT NOT NULL DEFAULT 'pro'
    CHECK (preferred_tier IN ('pro','expert')),
  trial_started_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ,
  access_ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_entitlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_entitlements_select
  ON public.organization_entitlements FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE OR REPLACE FUNCTION public.organization_write_access_allowed(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.organization_entitlements e
    WHERE e.organization_id = p_organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.organization_entitlements e
    WHERE e.organization_id = p_organization_id
      AND (
        e.access_status IN ('active', 'past_due')
        OR (e.access_status = 'trialing' AND e.trial_ends_at > now())
        OR (e.access_status = 'canceling' AND e.access_ends_at > now())
      )
  );
$$;

REVOKE ALL ON FUNCTION public.organization_write_access_allowed(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_write_access_allowed(UUID) TO authenticated, service_role;

-- Deuxième barrière contre un appel Supabase direct qui contournerait Next.js.
-- Elle s'applique à toutes les tables RLS portant organization_id, sauf la table
-- d'entitlement elle-même qui reste modifiable uniquement par service_role.
DO $$
DECLARE
  table_row RECORD;
BEGIN
  FOR table_row IN
    SELECT c.table_name
    FROM information_schema.columns c
    JOIN pg_tables t ON t.schemaname = c.table_schema AND t.tablename = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'organization_id'
      AND c.table_name <> 'organization_entitlements'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS entitlement_insert_guard ON public.%I', table_row.table_name);
    EXECUTE format('DROP POLICY IF EXISTS entitlement_update_guard ON public.%I', table_row.table_name);
    EXECUTE format('DROP POLICY IF EXISTS entitlement_delete_guard ON public.%I', table_row.table_name);
    EXECUTE format(
      'CREATE POLICY entitlement_insert_guard ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.organization_write_access_allowed(organization_id))',
      table_row.table_name
    );
    EXECUTE format(
      'CREATE POLICY entitlement_update_guard ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (public.organization_write_access_allowed(organization_id)) WITH CHECK (public.organization_write_access_allowed(organization_id))',
      table_row.table_name
    );
    EXECUTE format(
      'CREATE POLICY entitlement_delete_guard ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (public.organization_write_access_allowed(organization_id))',
      table_row.table_name
    );
  END LOOP;
END $$;
