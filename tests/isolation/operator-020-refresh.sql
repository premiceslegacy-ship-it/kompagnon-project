-- Run against a disposable LOCAL operator database after migrations 001-020:
-- psql "$LOCAL_OPERATOR_DB_URL" -v ON_ERROR_STOP=1 -f tests/isolation/operator-020-refresh.sql
BEGIN;

SET LOCAL ROLE service_role;

DO $prepare$
DECLARE
  v_source_instance TEXT := 'operator-020-refresh-' || gen_random_uuid()::TEXT;
  v_organization_id UUID := gen_random_uuid();
BEGIN
  PERFORM public.store_super_pdp_oauth_grant(
    v_source_instance, v_organization_id,
    'encrypted-old-access', 'encrypted-single-use-refresh',
    clock_timestamp() + INTERVAL '1 hour', ARRAY['all'], 'sandbox'
  );
  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  UPDATE public.super_pdp_oauth_credentials
  SET token_expires_at = clock_timestamp() - INTERVAL '1 second'
  WHERE source_instance = v_source_instance AND organization_id = v_organization_id;
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);
  PERFORM set_config('app.operator_020_source', v_source_instance, true);
  PERFORM set_config('app.operator_020_organization', v_organization_id::TEXT, true);
END;
$prepare$;

DO $direct_write_guard$
BEGIN
  BEGIN
    UPDATE public.super_pdp_oauth_credentials
    SET token_expires_at = token_expires_at
    WHERE source_instance = current_setting('app.operator_020_source')
      AND organization_id = current_setting('app.operator_020_organization')::UUID;
    RAISE EXCEPTION 'service_role unexpectedly changed OAuth credentials directly';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$direct_write_guard$;

DO $transitions$
DECLARE
  v_source_instance TEXT := current_setting('app.operator_020_source');
  v_organization_id UUID := current_setting('app.operator_020_organization')::UUID;
  v_owner UUID := gen_random_uuid();
  v_other_owner UUID := gen_random_uuid();
  v_next_owner UUID := gen_random_uuid();
  v_claim RECORD;
  v_revision UUID;
  v_completed BOOLEAN;
BEGIN
  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_owner, 'production'
  );
  IF v_claim.result_state <> 'environment_mismatch'
     OR v_claim.access_token_encrypted IS NOT NULL
     OR v_claim.refresh_token_encrypted IS NOT NULL THEN
    RAISE EXCEPTION 'sandbox grant crossed into production';
  END IF;

  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_owner, 'sandbox'
  );
  IF v_claim.result_state <> 'claimed'
     OR v_claim.claim_owner <> v_owner
     OR v_claim.refresh_token_encrypted <> 'encrypted-single-use-refresh'
     OR v_claim.credential_revision IS NULL THEN
    RAISE EXCEPTION 'expired credentials were not atomically claimed';
  END IF;
  v_revision := v_claim.credential_revision;

  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_other_owner, 'sandbox'
  );
  IF v_claim.result_state <> 'busy' OR v_claim.refresh_token_encrypted IS NOT NULL THEN
    RAISE EXCEPTION 'second Worker received a single-use refresh token';
  END IF;

  SELECT public.complete_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_other_owner, v_revision,
    'encrypted-wrong-access', 'encrypted-wrong-refresh', clock_timestamp() + INTERVAL '1 hour'
  ) INTO v_completed;
  IF v_completed THEN RAISE EXCEPTION 'wrong claim owner completed a refresh'; END IF;

  SELECT public.complete_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_owner, gen_random_uuid(),
    'encrypted-wrong-access', 'encrypted-wrong-refresh', clock_timestamp() + INTERVAL '1 hour'
  ) INTO v_completed;
  IF v_completed THEN RAISE EXCEPTION 'stale credential revision completed a refresh'; END IF;

  SELECT public.complete_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_owner, v_revision,
    'encrypted-rotated-access', 'encrypted-rotated-refresh', clock_timestamp() + INTERVAL '1 hour'
  ) INTO v_completed;
  IF NOT v_completed THEN RAISE EXCEPTION 'valid refresh completion did not persist'; END IF;

  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_other_owner, 'sandbox'
  );
  IF v_claim.result_state <> 'fresh'
     OR v_claim.access_token_encrypted <> 'encrypted-rotated-access'
     OR v_claim.refresh_token_encrypted IS NOT NULL THEN
    RAISE EXCEPTION 'fresh encrypted access token was not returned after atomic persistence';
  END IF;

  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  UPDATE public.super_pdp_oauth_credentials
  SET token_expires_at = clock_timestamp() - INTERVAL '1 second'
  WHERE source_instance = v_source_instance AND organization_id = v_organization_id;
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);
  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_next_owner, 'sandbox'
  );
  v_revision := v_claim.credential_revision;
  IF v_claim.result_state <> 'claimed' THEN RAISE EXCEPTION 'expected second refresh claim'; END IF;

  SELECT public.fail_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_other_owner, v_revision
  ) INTO v_completed;
  IF v_completed THEN RAISE EXCEPTION 'wrong claim owner failed a refresh'; END IF;
  SELECT public.fail_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_next_owner, v_revision
  ) INTO v_completed;
  IF NOT v_completed THEN RAISE EXCEPTION 'valid failure did not require reconnection'; END IF;
  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_owner, 'sandbox'
  );
  IF v_claim.result_state <> 'reconnect_required'
     OR v_claim.refresh_token_encrypted IS NOT NULL THEN
    RAISE EXCEPTION 'failed refresh made the old token reusable';
  END IF;

  -- A callback grant resets state/claim/revision atomically and defeats an
  -- already in-flight refresh result.
  PERFORM public.store_super_pdp_oauth_grant(
    v_source_instance, v_organization_id,
    'encrypted-reconnected-access', 'encrypted-reconnected-refresh',
    clock_timestamp() + INTERVAL '1 hour', ARRAY['all'], 'sandbox'
  );
  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  UPDATE public.super_pdp_oauth_credentials
  SET token_expires_at = clock_timestamp() - INTERVAL '1 second'
  WHERE source_instance = v_source_instance AND organization_id = v_organization_id;
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);
  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_next_owner, 'sandbox'
  );
  v_revision := v_claim.credential_revision;
  IF v_claim.result_state <> 'claimed' THEN RAISE EXCEPTION 'reconnected grant was not refreshable'; END IF;

  PERFORM public.store_super_pdp_oauth_grant(
    v_source_instance, v_organization_id,
    'encrypted-new-grant-access', 'encrypted-new-grant-refresh',
    clock_timestamp() + INTERVAL '1 hour', ARRAY['all'], 'production'
  );
  SELECT public.complete_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_next_owner, v_revision,
    'encrypted-stale-access', 'encrypted-stale-refresh', clock_timestamp() + INTERVAL '1 hour'
  ) INTO v_completed;
  IF v_completed THEN RAISE EXCEPTION 'stale in-flight refresh overwrote a callback grant'; END IF;
  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_owner, 'sandbox'
  );
  IF v_claim.result_state <> 'environment_mismatch'
     OR v_claim.access_token_encrypted IS NOT NULL THEN
    RAISE EXCEPTION 'new production grant leaked to a sandbox Worker';
  END IF;
  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_owner, 'production'
  );
  IF v_claim.result_state <> 'fresh'
     OR v_claim.access_token_encrypted <> 'encrypted-new-grant-access' THEN
    RAISE EXCEPTION 'callback grant did not win over stale refresh';
  END IF;

  -- An expired owner is ambiguous, not reclaimable: the old one-use token
  -- must not be handed to another Worker for replay.
  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  UPDATE public.super_pdp_oauth_credentials
  SET token_expires_at = clock_timestamp() - INTERVAL '1 second'
  WHERE source_instance = v_source_instance AND organization_id = v_organization_id;
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);
  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_next_owner, 'production'
  );
  IF v_claim.result_state <> 'claimed' THEN RAISE EXCEPTION 'expected final refresh claim'; END IF;
  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  UPDATE public.super_pdp_oauth_credentials
  SET refresh_claimed_at = clock_timestamp() - INTERVAL '31 seconds'
  WHERE source_instance = v_source_instance AND organization_id = v_organization_id;
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);
  SELECT * INTO v_claim FROM public.claim_super_pdp_oauth_refresh(
    v_source_instance, v_organization_id, v_owner, 'production'
  );
  IF v_claim.result_state <> 'reconnect_required'
     OR v_claim.refresh_token_encrypted IS NOT NULL THEN
    RAISE EXCEPTION 'expired ambiguous claim was replayed';
  END IF;
END;
$transitions$;

DO $schema_gate$
DECLARE
  v_ok BOOLEAN;
  v_failures TEXT[];
BEGIN
  SELECT result.ok, result.failures
  INTO v_ok, v_failures
  FROM public.assert_super_pdp_refresh_schema() AS result;
  IF v_ok IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'operator schema gate failed: %', array_to_string(v_failures, ',');
  END IF;
END;
$schema_gate$;

DO $privileges$
DECLARE
  v_role TEXT;
  v_function TEXT;
BEGIN
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF has_table_privilege(v_role, 'public.super_pdp_oauth_credentials', 'SELECT') THEN
      RAISE EXCEPTION '% unexpectedly has direct credential-table access', v_role;
    END IF;
    FOREACH v_function IN ARRAY ARRAY[
      'public.claim_super_pdp_oauth_refresh(text,uuid,uuid,text)',
      'public.complete_super_pdp_oauth_refresh(text,uuid,uuid,uuid,text,text,timestamp with time zone)',
      'public.fail_super_pdp_oauth_refresh(text,uuid,uuid,uuid)',
      'public.store_super_pdp_oauth_grant(text,uuid,text,text,timestamp with time zone,text[],text)',
      'public.assert_super_pdp_refresh_schema()'
    ] LOOP
      IF has_function_privilege(v_role, v_function, 'EXECUTE') THEN
        RAISE EXCEPTION '% unexpectedly can execute %', v_role, v_function;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('service_role', 'public.super_pdp_oauth_credentials', 'SELECT') THEN
    RAISE EXCEPTION 'service_role is missing credential table access';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.claim_super_pdp_oauth_refresh(text,uuid,uuid,text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.complete_super_pdp_oauth_refresh(text,uuid,uuid,uuid,text,text,timestamp with time zone)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.fail_super_pdp_oauth_refresh(text,uuid,uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.store_super_pdp_oauth_grant(text,uuid,text,text,timestamp with time zone,text[],text)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.assert_super_pdp_refresh_schema()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role is missing refresh RPC access';
  END IF;
END;
$privileges$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $deny_anon$
BEGIN
  BEGIN
    PERFORM public.claim_super_pdp_oauth_refresh('forbidden', gen_random_uuid(), gen_random_uuid(), 'sandbox');
    RAISE EXCEPTION 'anon unexpectedly executed refresh claim';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM 1 FROM public.super_pdp_oauth_credentials;
    RAISE EXCEPTION 'anon unexpectedly read OAuth credentials';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$deny_anon$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $deny_authenticated$
BEGIN
  BEGIN
    PERFORM public.store_super_pdp_oauth_grant(
      'forbidden', gen_random_uuid(), 'a', 'r', clock_timestamp() + INTERVAL '1 hour', ARRAY[]::TEXT[], 'sandbox'
    );
    RAISE EXCEPTION 'authenticated unexpectedly stored OAuth credentials';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$deny_authenticated$;

ROLLBACK;
