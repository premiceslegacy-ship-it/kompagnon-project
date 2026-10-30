-- Establish the intended service_role-only boundary for cockpit operator data.
-- This migration intentionally creates no policies: an unexpected policy is
-- left visible for the schema gate to reject rather than silently replaced.
DO $$
DECLARE
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'operator_client_events',
    'operator_client_quotas',
    'operator_client_settings',
    'operator_client_subscriptions',
    'operator_clients',
    'operator_commercial_events',
    'operator_quota_usage_events',
    'operator_usage_events'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'operator security migration requires public.%', v_table;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', v_table);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role', v_table);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_operator_table_security()
RETURNS TABLE (ok BOOLEAN, failures TEXT[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_failures TEXT[] := ARRAY[]::TEXT[];
  v_table TEXT;
  v_relation TEXT;
  v_role TEXT;
  v_privilege TEXT;
  v_rls_enabled BOOLEAN;
BEGIN
  IF to_regrole('service_role') IS NULL THEN
    v_failures := array_append(v_failures, 'missing_role:service_role');
  ELSIF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS r
    WHERE r.rolname = 'service_role'
      AND r.rolbypassrls
  ) THEN
    v_failures := array_append(v_failures, 'service_role_rls_bypass_missing');
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF to_regrole(v_role) IS NULL THEN
      v_failures := array_append(v_failures, 'missing_role:' || v_role);
    END IF;
  END LOOP;

  FOREACH v_table IN ARRAY ARRAY[
    'operator_client_events',
    'operator_client_quotas',
    'operator_client_settings',
    'operator_client_subscriptions',
    'operator_clients',
    'operator_commercial_events',
    'operator_quota_usage_events',
    'operator_usage_events'
  ] LOOP
    v_relation := format('public.%I', v_table);
    IF to_regclass(v_relation) IS NULL THEN
      v_failures := array_append(v_failures, format('missing_table:%s', v_table));
      CONTINUE;
    END IF;

    SELECT c.relrowsecurity
    INTO v_rls_enabled
    FROM pg_catalog.pg_class AS c
    WHERE c.oid = to_regclass(v_relation);
    IF v_rls_enabled IS DISTINCT FROM TRUE THEN
      v_failures := array_append(v_failures, format('rls_disabled:%s', v_table));
    END IF;

    -- The verified boundary has no policies at all. Reject (but never drop)
    -- any divergence, including a newly added policy for anon/authenticated.
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_policy AS p
      WHERE p.polrelid = to_regclass(v_relation)
    ) THEN
      v_failures := array_append(v_failures, format('unexpected_policy:%s', v_table));
    END IF;

    IF to_regrole('service_role') IS NOT NULL THEN
      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege('service_role', v_relation, v_privilege) IS DISTINCT FROM TRUE THEN
          v_failures := array_append(v_failures, format('service_role_table_denied:%s:%s', v_table, v_privilege));
        END IF;
      END LOOP;
    END IF;

    FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF to_regrole(v_role) IS NOT NULL THEN
        FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] LOOP
          IF has_table_privilege(v_role, v_relation, v_privilege) THEN
            v_failures := array_append(v_failures, format('table_role_restriction:%s:%s:%s', v_role, v_table, v_privilege));
          END IF;
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS p
    WHERE p.oid = to_regprocedure('public.assert_operator_table_security()')
      AND p.prosecdef
      AND p.provolatile = 's'
      AND COALESCE(p.proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=pg_catalog, public']::TEXT[]
  ) THEN
    v_failures := array_append(v_failures, 'security_gate_definer_stable_or_search_path');
  END IF;

  IF to_regrole('service_role') IS NOT NULL
     AND NOT has_function_privilege('service_role', 'public.assert_operator_table_security()', 'EXECUTE') THEN
    v_failures := array_append(v_failures, 'service_role_security_gate_denied');
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF to_regrole(v_role) IS NOT NULL
       AND has_function_privilege(v_role, 'public.assert_operator_table_security()', 'EXECUTE') THEN
      v_failures := array_append(v_failures, format('security_gate_role_restriction:%s', v_role));
    END IF;
  END LOOP;

  RETURN QUERY SELECT cardinality(v_failures) = 0, v_failures;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_operator_table_security() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_operator_table_security() TO service_role;

COMMENT ON FUNCTION public.assert_operator_table_security() IS
  'Read-only service_role deployment gate for RLS-enabled, policy-free service_role-only access on cockpit operator tables.';
