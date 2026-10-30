-- Run only against a disposable LOCAL operator database after migrations 001-019:
-- psql "$LOCAL_OPERATOR_DB_URL" -v ON_ERROR_STOP=1 -f tests/isolation/operator-019-smoke.sql
-- The outer transaction rolls back the temporary settings row and every ledger write.
BEGIN;

DO $prepare$
DECLARE
  v_source_instance TEXT := 'operator-019-smoke-' || gen_random_uuid()::TEXT;
  v_organization_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO public.operator_client_settings (source_instance, organization_id, label)
  VALUES (v_source_instance, v_organization_id, 'Local migration smoke test');
  PERFORM set_config('app.operator_019_smoke_source', v_source_instance, true);
  PERFORM set_config('app.operator_019_smoke_organization', v_organization_id::TEXT, true);
END;
$prepare$;

SET LOCAL ROLE service_role;

DO $smoke$
DECLARE
  v_source_instance TEXT := current_setting('app.operator_019_smoke_source');
  v_organization_id UUID := current_setting('app.operator_019_smoke_organization')::UUID;
  v_invoice_id UUID := gen_random_uuid();
  v_privilege TEXT;
  v_rls_enabled BOOLEAN;
BEGIN
  SELECT c.relrowsecurity INTO v_rls_enabled
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.operator_einvoicing_submissions'::regclass;
  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'operator_einvoicing_submissions must have RLS enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'operator_einvoicing_submissions'
  ) THEN
    RAISE EXCEPTION 'operator_einvoicing_submissions must not expose any RLS policy';
  END IF;

  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.operator_einvoicing_submissions', v_privilege) THEN
      RAISE EXCEPTION 'service_role is missing % privilege', v_privilege;
    END IF;
    IF has_table_privilege('anon', 'public.operator_einvoicing_submissions', v_privilege)
       OR has_table_privilege('authenticated', 'public.operator_einvoicing_submissions', v_privilege) THEN
      RAISE EXCEPTION 'anon/authenticated must not have % privilege', v_privilege;
    END IF;
  END LOOP;

  INSERT INTO public.operator_einvoicing_submissions (
    source_instance, organization_id, invoice_id, request_sha256
  ) VALUES (
    v_source_instance, v_organization_id, v_invoice_id, repeat('a', 64)
  );

  BEGIN
    INSERT INTO public.operator_einvoicing_submissions (
      source_instance, organization_id, invoice_id, request_sha256
    ) VALUES (
      v_source_instance, v_organization_id, v_invoice_id, repeat('a', 64)
    );
    RAISE EXCEPTION 'duplicate submission key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.operator_einvoicing_submissions (
      source_instance, organization_id, invoice_id, request_sha256
    ) VALUES (
      v_source_instance, v_organization_id, gen_random_uuid(), 'not-a-sha256'
    );
    RAISE EXCEPTION 'invalid request hash unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.operator_einvoicing_submissions (
      source_instance, organization_id, invoice_id, request_sha256, status
    ) VALUES (
      v_source_instance, v_organization_id, gen_random_uuid(), repeat('b', 64), 'failed'
    );
    RAISE EXCEPTION 'invalid submission status unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  UPDATE public.operator_einvoicing_submissions
  SET status = 'submitted',
      provider_message_id = 'local-smoke-message',
      provider_status = 'accepted',
      submitted_at = now()
  WHERE source_instance = v_source_instance
    AND organization_id = v_organization_id
    AND invoice_id = v_invoice_id
    AND status = 'processing';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'legitimate processing-to-submitted update did not affect the claim';
  END IF;
END;
$smoke$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $deny$
BEGIN
  BEGIN
    PERFORM 1 FROM public.operator_einvoicing_submissions;
    RAISE EXCEPTION 'anonymous ledger read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$deny$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  BEGIN
    PERFORM 1 FROM public.operator_einvoicing_submissions;
    RAISE EXCEPTION 'authenticated ledger read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$deny$;
RESET ROLE;

ROLLBACK;
