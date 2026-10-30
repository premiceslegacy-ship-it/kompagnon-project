-- Run only against a disposable LOCAL operator database after migrations 001-021:
-- psql "$LOCAL_OPERATOR_DB_URL" -v ON_ERROR_STOP=1 -f tests/isolation/operator-021-security.sql
-- Temporary policy/RLS changes and all fictitious rows are enclosed in this transaction.
BEGIN;

DO $baseline_gate$
DECLARE
  v_ok BOOLEAN;
  v_failures TEXT[];
BEGIN
  SELECT result.ok, result.failures
  INTO v_ok, v_failures
  FROM public.assert_operator_table_security() AS result;
  IF v_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'operator table security baseline failed: %', array_to_string(v_failures, ',');
  END IF;
END;
$baseline_gate$;

-- Prove the gate refuses a disabled table without leaving the test state behind.
ALTER TABLE public.operator_clients DISABLE ROW LEVEL SECURITY;
DO $rls_negative$
DECLARE
  v_ok BOOLEAN;
  v_failures TEXT[];
BEGIN
  SELECT result.ok, result.failures
  INTO v_ok, v_failures
  FROM public.assert_operator_table_security() AS result;
  IF v_ok IS DISTINCT FROM FALSE
     OR NOT (v_failures @> ARRAY['rls_disabled:operator_clients']::TEXT[]) THEN
    RAISE EXCEPTION 'schema gate did not reject disabled RLS: %', array_to_string(v_failures, ',');
  END IF;
END;
$rls_negative$;
ALTER TABLE public.operator_clients ENABLE ROW LEVEL SECURITY;

-- An unexpected policy is not dropped by the migration or hidden by the gate.
CREATE POLICY operator_021_fixture_open_read
  ON public.operator_clients
  FOR SELECT TO anon
  USING (true);
DO $policy_negative$
DECLARE
  v_ok BOOLEAN;
  v_failures TEXT[];
BEGIN
  SELECT result.ok, result.failures
  INTO v_ok, v_failures
  FROM public.assert_operator_table_security() AS result;
  IF v_ok IS DISTINCT FROM FALSE
     OR NOT (v_failures @> ARRAY['unexpected_policy:operator_clients']::TEXT[]) THEN
    RAISE EXCEPTION 'schema gate did not reject an unexpected open policy: %', array_to_string(v_failures, ',');
  END IF;
END;
$policy_negative$;
DROP POLICY operator_021_fixture_open_read ON public.operator_clients;

SET LOCAL ROLE service_role;
DO $prepare$
DECLARE
  v_source_instance TEXT := 'operator-021-security-' || gen_random_uuid()::TEXT;
  v_organization_id UUID := gen_random_uuid();
BEGIN
  PERFORM set_config('app.operator_021_source', v_source_instance, TRUE);
  PERFORM set_config('app.operator_021_organization', v_organization_id::TEXT, TRUE);

  INSERT INTO public.operator_client_settings (source_instance, organization_id, label)
  VALUES (v_source_instance, v_organization_id, 'Fictional operator security fixture');
  INSERT INTO public.operator_clients (source_instance, organization_id, label)
  VALUES (v_source_instance, v_organization_id, 'Fictional operator security fixture');
  INSERT INTO public.operator_client_subscriptions (source_instance, organization_id)
  VALUES (v_source_instance, v_organization_id);
  INSERT INTO public.operator_client_quotas (id, source_instance, organization_id, quota_feature)
  OVERRIDING SYSTEM VALUE
  VALUES (-210000021, v_source_instance, v_organization_id, 'operator_security_fixture');
  INSERT INTO public.operator_quota_usage_events (
    id, source_instance, local_usage_log_id, quota_feature, period_start
  ) OVERRIDING SYSTEM VALUE
  VALUES (-210000022, v_source_instance, gen_random_uuid(), 'operator_security_fixture', current_date);
  INSERT INTO public.operator_client_events (source_instance, event_category, event_type)
  VALUES (v_source_instance, 'note', 'operator_security_fixture');
  INSERT INTO public.operator_commercial_events (source_instance, event_type)
  VALUES (v_source_instance, 'operator_security_fixture');
  INSERT INTO public.operator_usage_events (
    source_instance, organization_id, occurred_at, provider, feature, model, status, local_usage_log_id
  ) VALUES (
    v_source_instance, v_organization_id, clock_timestamp(), 'fixture',
    'operator_security_fixture', 'fixture', 'ok', gen_random_uuid()
  );
END;
$prepare$;

DO $service_access$
DECLARE
  v_source_instance TEXT := current_setting('app.operator_021_source');
  v_table TEXT;
  v_count BIGINT;
  v_updated BIGINT;
  v_ok BOOLEAN;
  v_failures TEXT[];
BEGIN
  SELECT result.ok, result.failures
  INTO v_ok, v_failures
  FROM public.assert_operator_table_security() AS result;
  IF v_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'operator table security gate failed: %', array_to_string(v_failures, ',');
  END IF;

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
    EXECUTE format('SELECT count(*) FROM public.%I WHERE source_instance = $1', v_table)
      INTO v_count USING v_source_instance;
    IF v_count <> 1 THEN
      RAISE EXCEPTION 'service_role could not read exactly one fixture row from %', v_table;
    END IF;

    EXECUTE format('UPDATE public.%I SET source_instance = source_instance WHERE source_instance = $1', v_table)
      USING v_source_instance;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated <> 1 THEN
      RAISE EXCEPTION 'service_role could not update the fixture row in %', v_table;
    END IF;
  END LOOP;
END;
$service_access$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $deny_anon$
DECLARE
  v_source_instance TEXT := current_setting('app.operator_021_source');
  v_table TEXT;
  v_value INTEGER;
BEGIN
  BEGIN
    PERFORM public.assert_operator_table_security();
    RAISE EXCEPTION 'anon unexpectedly executed the operator security assertion';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
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
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I WHERE source_instance = $1', v_table)
        INTO v_value USING v_source_instance;
      RAISE EXCEPTION 'anon unexpectedly read %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('INSERT INTO public.%I DEFAULT VALUES', v_table);
      RAISE EXCEPTION 'anon unexpectedly inserted into %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('UPDATE public.%I SET source_instance = source_instance WHERE source_instance = $1', v_table)
        USING v_source_instance;
      RAISE EXCEPTION 'anon unexpectedly updated %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE source_instance = $1', v_table)
        USING v_source_instance;
      RAISE EXCEPTION 'anon unexpectedly deleted from %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('TRUNCATE TABLE public.%I', v_table);
      RAISE EXCEPTION 'anon unexpectedly truncated %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END;
$deny_anon$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $deny_authenticated$
DECLARE
  v_source_instance TEXT := current_setting('app.operator_021_source');
  v_table TEXT;
  v_value INTEGER;
BEGIN
  BEGIN
    PERFORM public.assert_operator_table_security();
    RAISE EXCEPTION 'authenticated unexpectedly executed the operator security assertion';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
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
    BEGIN
      EXECUTE format('SELECT 1 FROM public.%I WHERE source_instance = $1', v_table)
        INTO v_value USING v_source_instance;
      RAISE EXCEPTION 'authenticated unexpectedly read %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('INSERT INTO public.%I DEFAULT VALUES', v_table);
      RAISE EXCEPTION 'authenticated unexpectedly inserted into %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('UPDATE public.%I SET source_instance = source_instance WHERE source_instance = $1', v_table)
        USING v_source_instance;
      RAISE EXCEPTION 'authenticated unexpectedly updated %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('DELETE FROM public.%I WHERE source_instance = $1', v_table)
        USING v_source_instance;
      RAISE EXCEPTION 'authenticated unexpectedly deleted from %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE format('TRUNCATE TABLE public.%I', v_table);
      RAISE EXCEPTION 'authenticated unexpectedly truncated %', v_table;
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END;
$deny_authenticated$;

RESET ROLE;
SET LOCAL ROLE service_role;
DO $service_delete$
DECLARE
  v_source_instance TEXT := current_setting('app.operator_021_source');
  v_table TEXT;
  v_deleted BIGINT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'operator_client_events',
    'operator_commercial_events',
    'operator_client_subscriptions',
    'operator_client_quotas',
    'operator_quota_usage_events',
    'operator_usage_events',
    'operator_clients',
    'operator_client_settings'
  ] LOOP
    EXECUTE format('DELETE FROM public.%I WHERE source_instance = $1', v_table)
      USING v_source_instance;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted <> 1 THEN
      RAISE EXCEPTION 'service_role could not delete the fixture row from %', v_table;
    END IF;
  END LOOP;
END;
$service_delete$;

RESET ROLE;
ROLLBACK;
