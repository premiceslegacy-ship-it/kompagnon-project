-- Serialize single-use Super PDP refresh tokens across all cockpit Workers.
ALTER TABLE public.super_pdp_oauth_credentials
  ADD COLUMN IF NOT EXISTS refresh_state TEXT NOT NULL DEFAULT 'ready',
  ADD COLUMN IF NOT EXISTS refresh_claim_owner UUID,
  ADD COLUMN IF NOT EXISTS refresh_claimed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS credential_revision UUID NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  ALTER TABLE public.super_pdp_oauth_credentials
    ADD CONSTRAINT super_pdp_oauth_credentials_refresh_state_check
    CHECK (refresh_state IN ('ready', 'claimed', 'reconnect_required'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.super_pdp_oauth_credentials
    ADD CONSTRAINT super_pdp_oauth_credentials_refresh_claim_check
    CHECK (
      (refresh_state = 'claimed' AND refresh_claim_owner IS NOT NULL AND refresh_claimed_at IS NOT NULL)
      OR (refresh_state <> 'claimed' AND refresh_claim_owner IS NULL AND refresh_claimed_at IS NULL)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.super_pdp_oauth_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.super_pdp_oauth_credentials FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.super_pdp_oauth_credentials TO service_role;
CREATE OR REPLACE FUNCTION public.guard_super_pdp_oauth_credential_write()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF current_setting('app.super_pdp_refresh_write', TRUE) IS DISTINCT FROM 'trusted' THEN
    RAISE EXCEPTION 'Super PDP credentials must be written through the grant protocol'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_super_pdp_oauth_credential_write() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS guard_super_pdp_oauth_credentials_protocol ON public.super_pdp_oauth_credentials;
CREATE TRIGGER guard_super_pdp_oauth_credentials_protocol
  BEFORE INSERT OR UPDATE ON public.super_pdp_oauth_credentials
  FOR EACH ROW EXECUTE FUNCTION public.guard_super_pdp_oauth_credential_write();

CREATE OR REPLACE FUNCTION public.claim_super_pdp_oauth_refresh(
  p_source_instance TEXT,
  p_organization_id UUID,
  p_claim_owner UUID,
  p_environment TEXT
)
RETURNS TABLE (
  result_state TEXT,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  claim_owner UUID,
  credential_revision UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_credential public.super_pdp_oauth_credentials%ROWTYPE;
BEGIN
  IF p_claim_owner IS NULL THEN
    RAISE EXCEPTION 'refresh claim owner is required';
  END IF;
  IF p_environment IS NULL OR p_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'invalid Super PDP environment';
  END IF;

  SELECT c.* INTO v_credential
  FROM public.super_pdp_oauth_credentials AS c
  WHERE c.source_instance = p_source_instance
    AND c.organization_id = p_organization_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT 'missing'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_credential.environment IS DISTINCT FROM p_environment THEN
    RETURN QUERY SELECT 'environment_mismatch'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_credential.refresh_state = 'reconnect_required' THEN
    RETURN QUERY SELECT 'reconnect_required'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_credential.refresh_state = 'claimed' THEN
    IF v_credential.refresh_claimed_at > clock_timestamp() - INTERVAL '30 seconds' THEN
      RETURN QUERY SELECT 'busy'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID;
      RETURN;
    END IF;

    -- The provider may have consumed the old single-use token before its
    -- response was lost. Never replay it after the bounded claim expires.
    PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
    UPDATE public.super_pdp_oauth_credentials AS c
    SET refresh_state = 'reconnect_required',
        refresh_claim_owner = NULL,
        refresh_claimed_at = NULL,
        updated_at = clock_timestamp()
    WHERE c.source_instance = p_source_instance
      AND c.organization_id = p_organization_id;
    PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);
    RETURN QUERY SELECT 'reconnect_required'::TEXT, NULL::TEXT, NULL::TEXT, NULL::UUID, NULL::UUID;
    RETURN;
  END IF;

  IF v_credential.token_expires_at > clock_timestamp() + INTERVAL '2 minutes' THEN
    RETURN QUERY SELECT
      'fresh'::TEXT,
      v_credential.access_token_encrypted,
      NULL::TEXT,
      NULL::UUID,
      v_credential.credential_revision;
    RETURN;
  END IF;

  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  UPDATE public.super_pdp_oauth_credentials AS c
  SET refresh_state = 'claimed',
      refresh_claim_owner = p_claim_owner,
      refresh_claimed_at = clock_timestamp(),
      updated_at = clock_timestamp()
  WHERE c.source_instance = p_source_instance
    AND c.organization_id = p_organization_id;
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);

  RETURN QUERY SELECT
    'claimed'::TEXT,
    NULL::TEXT,
    v_credential.refresh_token_encrypted,
    p_claim_owner,
    v_credential.credential_revision;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_super_pdp_oauth_refresh(
  p_source_instance TEXT,
  p_organization_id UUID,
  p_claim_owner UUID,
  p_expected_revision UUID,
  p_access_token_encrypted TEXT,
  p_refresh_token_encrypted TEXT,
  p_token_expires_at TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  IF p_access_token_encrypted IS NULL OR p_access_token_encrypted = ''
     OR p_refresh_token_encrypted IS NULL OR p_refresh_token_encrypted = ''
     OR p_token_expires_at IS NULL OR p_token_expires_at <= clock_timestamp() THEN
    RETURN FALSE;
  END IF;

  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  UPDATE public.super_pdp_oauth_credentials AS c
  SET access_token_encrypted = p_access_token_encrypted,
      refresh_token_encrypted = p_refresh_token_encrypted,
      token_expires_at = p_token_expires_at,
      refresh_state = 'ready',
      refresh_claim_owner = NULL,
      refresh_claimed_at = NULL,
      credential_revision = gen_random_uuid(),
      updated_at = clock_timestamp()
  WHERE c.source_instance = p_source_instance
    AND c.organization_id = p_organization_id
    AND c.refresh_state = 'claimed'
    AND c.refresh_claim_owner = p_claim_owner
    AND c.credential_revision = p_expected_revision
    AND c.refresh_claimed_at > clock_timestamp() - INTERVAL '30 seconds';

  v_updated := FOUND;
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);
  RETURN v_updated;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_super_pdp_oauth_refresh(
  p_source_instance TEXT,
  p_organization_id UUID,
  p_claim_owner UUID,
  p_expected_revision UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_updated BOOLEAN;
BEGIN
  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  UPDATE public.super_pdp_oauth_credentials AS c
  SET refresh_state = 'reconnect_required',
      refresh_claim_owner = NULL,
      refresh_claimed_at = NULL,
      updated_at = clock_timestamp()
  WHERE c.source_instance = p_source_instance
    AND c.organization_id = p_organization_id
    AND c.refresh_state = 'claimed'
    AND c.refresh_claim_owner = p_claim_owner
    AND c.credential_revision = p_expected_revision;
  v_updated := FOUND;
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);

  RETURN v_updated;
END;
$$;

-- The OAuth callback replaces the grant and clears any in-flight refresh claim
-- in the same database statement. A changed revision invalidates stale results.
CREATE OR REPLACE FUNCTION public.store_super_pdp_oauth_grant(
  p_source_instance TEXT,
  p_organization_id UUID,
  p_access_token_encrypted TEXT,
  p_refresh_token_encrypted TEXT,
  p_token_expires_at TIMESTAMPTZ,
  p_scopes TEXT[],
  p_environment TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF p_source_instance IS NULL OR p_source_instance = ''
     OR p_organization_id IS NULL
     OR p_access_token_encrypted IS NULL OR p_access_token_encrypted = ''
     OR p_refresh_token_encrypted IS NULL OR p_refresh_token_encrypted = ''
     OR p_token_expires_at IS NULL OR p_token_expires_at <= clock_timestamp()
     OR p_environment IS NULL OR p_environment NOT IN ('sandbox', 'production') THEN
    RAISE EXCEPTION 'invalid Super PDP OAuth grant';
  END IF;

  PERFORM set_config('app.super_pdp_refresh_write', 'trusted', TRUE);
  INSERT INTO public.super_pdp_oauth_credentials (
    source_instance,
    organization_id,
    access_token_encrypted,
    refresh_token_encrypted,
    token_expires_at,
    scopes,
    environment,
    refresh_state,
    refresh_claim_owner,
    refresh_claimed_at,
    credential_revision,
    updated_at
  ) VALUES (
    p_source_instance,
    p_organization_id,
    p_access_token_encrypted,
    p_refresh_token_encrypted,
    p_token_expires_at,
    p_scopes,
    p_environment,
    'ready',
    NULL,
    NULL,
    gen_random_uuid(),
    clock_timestamp()
  )
  ON CONFLICT (source_instance, organization_id) DO UPDATE
  SET access_token_encrypted = EXCLUDED.access_token_encrypted,
      refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
      token_expires_at = EXCLUDED.token_expires_at,
      scopes = EXCLUDED.scopes,
      environment = EXCLUDED.environment,
      refresh_state = 'ready',
      refresh_claim_owner = NULL,
      refresh_claimed_at = NULL,
      credential_revision = gen_random_uuid(),
      updated_at = clock_timestamp();
  PERFORM set_config('app.super_pdp_refresh_write', '', TRUE);
END;
$$;

REVOKE ALL ON FUNCTION public.claim_super_pdp_oauth_refresh(TEXT, UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_super_pdp_oauth_refresh(TEXT, UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_super_pdp_oauth_refresh(TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.store_super_pdp_oauth_grant(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT[], TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_super_pdp_oauth_refresh(TEXT, UUID, UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_super_pdp_oauth_refresh(TEXT, UUID, UUID, UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_super_pdp_oauth_refresh(TEXT, UUID, UUID, UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.store_super_pdp_oauth_grant(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT[], TEXT) TO service_role;
DROP FUNCTION IF EXISTS public.reset_super_pdp_oauth_credentials(TEXT, UUID, TEXT, TEXT, TIMESTAMPTZ, TEXT[], TEXT);

CREATE OR REPLACE FUNCTION public.assert_super_pdp_refresh_schema()
RETURNS TABLE (ok BOOLEAN, failures TEXT[])
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_failures TEXT[] := ARRAY[]::TEXT[];
  v_missing TEXT[];
  v_table TEXT;
  v_role TEXT;
  v_privilege TEXT;
  v_signature TEXT;
  v_is_rls_enabled BOOLEAN;
  v_check_ok BOOLEAN;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'super_pdp_oauth_credentials',
    'operator_einvoicing_submissions',
    'operator_clients'
  ] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      v_failures := array_append(v_failures, format('missing_table:%s', v_table));
    END IF;
  END LOOP;

  IF to_regclass('public.super_pdp_oauth_credentials') IS NOT NULL THEN
    SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO v_missing
    FROM unnest(ARRAY[
      'source_instance',
      'organization_id',
      'access_token_encrypted',
      'refresh_token_encrypted',
      'token_expires_at',
      'refresh_state',
      'refresh_claim_owner',
      'refresh_claimed_at',
      'credential_revision',
      'environment'
    ]) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'super_pdp_oauth_credentials'
        AND c.column_name = required.column_name
    );
    IF cardinality(v_missing) > 0 THEN
      v_failures := array_append(v_failures, 'missing_refresh_columns:' || array_to_string(v_missing, ','));
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS c
      WHERE c.conrelid = to_regclass('public.super_pdp_oauth_credentials')
        AND c.conname = 'super_pdp_oauth_credentials_refresh_state_check'
        AND c.contype = 'c'
    ) THEN
      v_failures := array_append(v_failures, 'missing_refresh_state_check');
    END IF;
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint AS c
      WHERE c.conrelid = to_regclass('public.super_pdp_oauth_credentials')
        AND c.conname = 'super_pdp_oauth_credentials_refresh_claim_check'
        AND c.contype = 'c'
    ) THEN
      v_failures := array_append(v_failures, 'missing_refresh_claim_check');
    END IF;

  END IF;

  IF to_regclass('public.operator_einvoicing_submissions') IS NOT NULL THEN
    SELECT array_agg(required.column_name ORDER BY required.column_name)
    INTO v_missing
    FROM unnest(ARRAY[
      'source_instance',
      'organization_id',
      'invoice_id',
      'request_sha256',
      'status'
    ]) AS required(column_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM information_schema.columns AS c
      WHERE c.table_schema = 'public'
        AND c.table_name = 'operator_einvoicing_submissions'
        AND c.column_name = required.column_name
    );
    IF cardinality(v_missing) > 0 THEN
      v_failures := array_append(v_failures, 'missing_submission_columns:' || array_to_string(v_missing, ','));
    END IF;
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_super_pdp_oauth_refresh(text,uuid,uuid,text)',
    'public.complete_super_pdp_oauth_refresh(text,uuid,uuid,uuid,text,text,timestamp with time zone)',
    'public.fail_super_pdp_oauth_refresh(text,uuid,uuid,uuid)',
    'public.store_super_pdp_oauth_grant(text,uuid,text,text,timestamp with time zone,text[],text)'
  ] LOOP
    IF to_regprocedure(v_signature) IS NULL THEN
      v_failures := array_append(v_failures, 'missing_rpc:' || split_part(v_signature, '(', 1));
    ELSIF to_regrole('service_role') IS NULL
       OR NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      v_failures := array_append(v_failures, 'service_role_rpc_denied:' || split_part(v_signature, '(', 1));
    ELSIF NOT EXISTS (
      SELECT 1
      FROM pg_proc AS p
      WHERE p.oid = to_regprocedure(v_signature)
        AND p.prosecdef
        AND COALESCE(p.proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=pg_catalog, public']::TEXT[]
    ) THEN
      v_failures := array_append(v_failures, 'rpc_security_definer_or_search_path:' || split_part(v_signature, '(', 1));
    ELSE
      FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF to_regrole(v_role) IS NULL
           OR has_function_privilege(v_role, v_signature, 'EXECUTE') THEN
          v_failures := array_append(v_failures, format('rpc_role_restriction:%s:%s', v_role, split_part(v_signature, '(', 1)));
        END IF;
      END LOOP;
    END IF;
  END LOOP;
  IF to_regrole('service_role') IS NULL
     OR NOT has_function_privilege('service_role', 'public.assert_super_pdp_refresh_schema()', 'EXECUTE') THEN
    v_failures := array_append(v_failures, 'service_role_schema_gate_denied');
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF to_regrole(v_role) IS NULL
       OR has_function_privilege(v_role, 'public.assert_super_pdp_refresh_schema()', 'EXECUTE') THEN
      v_failures := array_append(v_failures, 'schema_gate_role_restriction:' || v_role);
    END IF;
  END LOOP;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc AS p
    WHERE p.oid = to_regprocedure('public.assert_super_pdp_refresh_schema()')
      AND p.prosecdef
      AND COALESCE(p.proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=pg_catalog, public']::TEXT[]
      AND p.provolatile = 's'
  ) THEN
    v_failures := array_append(v_failures, 'schema_gate_security_definer_or_search_path');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger AS t
    JOIN pg_class AS c ON c.oid = t.tgrelid
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    JOIN pg_proc AS p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'super_pdp_oauth_credentials'
      AND t.tgname = 'guard_super_pdp_oauth_credentials_protocol'
      AND NOT t.tgisinternal
      AND t.tgtype = 23
      AND t.tgenabled IN ('O', 'A')
      AND p.proname = 'guard_super_pdp_oauth_credential_write'
      AND p.prosecdef
      AND COALESCE(p.proconfig, ARRAY[]::TEXT[]) @> ARRAY['search_path=pg_catalog, public']::TEXT[]
  ) THEN
    v_failures := array_append(v_failures, 'missing_credential_write_guard');
  END IF;

  FOREACH v_table IN ARRAY ARRAY['super_pdp_oauth_credentials', 'operator_einvoicing_submissions'] LOOP
    IF to_regclass(format('public.%I', v_table)) IS NOT NULL THEN
      SELECT c.relrowsecurity INTO v_is_rls_enabled
      FROM pg_class AS c
      WHERE c.oid = to_regclass(format('public.%I', v_table));
      IF v_is_rls_enabled IS DISTINCT FROM TRUE THEN
        v_failures := array_append(v_failures, format('rls_disabled:%s', v_table));
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_policies AS p
        WHERE p.schemaname = 'public' AND p.tablename = v_table
      ) THEN
        v_failures := array_append(v_failures, format('unexpected_policy:%s', v_table));
      END IF;

      FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
        IF has_table_privilege('service_role', format('public.%I', v_table), v_privilege) IS DISTINCT FROM TRUE THEN
          v_failures := array_append(v_failures, format('service_role_table_denied:%s:%s', v_table, v_privilege));
        END IF;
      END LOOP;
      FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
        IF to_regrole(v_role) IS NULL THEN
          v_failures := array_append(v_failures, 'missing_role:' || v_role);
        ELSE
          FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
            IF has_table_privilege(v_role, format('public.%I', v_table), v_privilege) THEN
              v_failures := array_append(v_failures, format('table_role_restriction:%s:%s:%s', v_role, v_table, v_privilege));
            END IF;
          END LOOP;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  IF to_regclass('public.operator_clients') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_index AS i
      JOIN pg_class AS t ON t.oid = i.indrelid
      JOIN pg_namespace AS n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL (
        SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality) AS names
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
        WHERE key.ordinality <= i.indnkeyatts
      ) AS index_columns
      WHERE n.nspname = 'public'
        AND t.relname = 'operator_clients'
        AND i.indisunique
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND i.indnkeyatts = 2
        AND index_columns.names = ARRAY['source_instance', 'organization_id']::TEXT[]
    ) INTO v_check_ok;
    IF v_check_ok IS DISTINCT FROM TRUE THEN
      v_failures := array_append(v_failures, 'missing_operator_client_composite_key');
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM pg_index AS i
      JOIN pg_class AS t ON t.oid = i.indrelid
      JOIN pg_namespace AS n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL (
        SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality) AS names
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
        WHERE key.ordinality <= i.indnkeyatts
      ) AS index_columns
      WHERE n.nspname = 'public'
        AND t.relname = 'operator_clients'
        AND i.indisunique
        AND i.indexprs IS NULL
        AND i.indnkeyatts = 1
        AND index_columns.names = ARRAY['source_instance']::TEXT[]
    ) INTO v_check_ok;
    IF v_check_ok THEN
      v_failures := array_append(v_failures, 'legacy_operator_client_source_unique');
    END IF;
  END IF;

  IF to_regclass('public.operator_einvoicing_submissions') IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM pg_index AS i
      JOIN pg_class AS t ON t.oid = i.indrelid
      JOIN pg_namespace AS n ON n.oid = t.relnamespace
      CROSS JOIN LATERAL (
        SELECT array_agg(a.attname::TEXT ORDER BY key.ordinality) AS names
        FROM unnest(i.indkey) WITH ORDINALITY AS key(attnum, ordinality)
        JOIN pg_attribute AS a ON a.attrelid = i.indrelid AND a.attnum = key.attnum
        WHERE key.ordinality <= i.indnkeyatts
      ) AS index_columns
      WHERE n.nspname = 'public'
        AND t.relname = 'operator_einvoicing_submissions'
        AND i.indisunique
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND i.indnkeyatts = 3
        AND index_columns.names = ARRAY['source_instance', 'organization_id', 'invoice_id']::TEXT[]
    ) INTO v_check_ok;
    IF v_check_ok IS DISTINCT FROM TRUE THEN
      v_failures := array_append(v_failures, 'missing_submission_composite_key');
    END IF;
  END IF;

  RETURN QUERY SELECT cardinality(v_failures) = 0, v_failures;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_super_pdp_refresh_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_super_pdp_refresh_schema() TO service_role;

COMMENT ON FUNCTION public.assert_super_pdp_refresh_schema() IS
  'Read-only service_role deployment gate for Super PDP refresh state, operator submission ledger, tenant keys, and privilege restrictions.';
COMMENT ON COLUMN public.super_pdp_oauth_credentials.refresh_state IS
  'Durable single-use refresh-token state: ready, claimed, or reconnect_required; expired claims are never replayed.';
COMMENT ON COLUMN public.super_pdp_oauth_credentials.credential_revision IS
  'CAS revision changed on OAuth reconnect or successful refresh to prevent stale refresh responses replacing newer credentials.';
