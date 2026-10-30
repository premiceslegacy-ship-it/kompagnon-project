-- Run only against a disposable LOCAL Supabase database migrated through 210:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/account-deletion-identity-claim.sql
-- Exercises both identity-erasure race orderings and rolls all fixture rows back.
BEGIN;

DO $test$
DECLARE
  v_target_preserve UUID := gen_random_uuid();
  v_live_preserve UUID := gen_random_uuid();
  v_target_claim UUID := gen_random_uuid();
  v_live_update UUID := gen_random_uuid();
  v_live_insert UUID := gen_random_uuid();
  v_retry_org UUID := gen_random_uuid();
  v_preserved_user UUID := gen_random_uuid();
  v_claimed_user UUID := gen_random_uuid();
  v_absent_user UUID := gen_random_uuid();
  v_actor UUID := gen_random_uuid();
  v_role_target_preserve UUID := gen_random_uuid();
  v_role_live_preserve UUID := gen_random_uuid();
  v_role_target_claim UUID := gen_random_uuid();
  v_role_live_update UUID := gen_random_uuid();
  v_role_live_insert UUID := gen_random_uuid();
  v_role_retry UUID := gen_random_uuid();
  v_preserved_email TEXT := 'claim-preserved-' || gen_random_uuid()::TEXT || '@example.invalid';
  v_claimed_email TEXT := 'claim-claimed-' || gen_random_uuid()::TEXT || '@example.invalid';
  v_role_denied BOOLEAN := false;
  v_activation_denied BOOLEAN := false;
  v_rls_enabled BOOLEAN;
  v_outcome TEXT;
  v_rows BIGINT;
  v_retry_eligible BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.organizations (id, name, slug, email, sector, deletion_scheduled_at, anonymized_at)
  VALUES
    (v_target_preserve, 'Erasure claim preserve target', 'claim-preserve-' || v_target_preserve::TEXT,
     'target-preserve-' || v_target_preserve::TEXT || '@example.invalid', 'construction', now() - INTERVAL '1 day', now()),
    (v_live_preserve, 'Erasure claim preserve survivor', 'claim-preserve-live-' || v_live_preserve::TEXT,
     'live-preserve-' || v_live_preserve::TEXT || '@example.invalid', 'construction', NULL, NULL),
    (v_target_claim, 'Erasure claim target', 'claim-target-' || v_target_claim::TEXT,
     'target-claimed-' || v_target_claim::TEXT || '@example.invalid', 'construction', now() - INTERVAL '1 day', now()),
    (v_live_update, 'Erasure claim update survivor', 'claim-update-' || v_live_update::TEXT,
     'live-update-' || v_live_update::TEXT || '@example.invalid', 'construction', NULL, NULL),
    (v_live_insert, 'Erasure claim insert survivor', 'claim-insert-' || v_live_insert::TEXT,
     'live-insert-' || v_live_insert::TEXT || '@example.invalid', 'construction', NULL, NULL),
    (v_retry_org, 'Erasure cleanup retry', 'claim-retry-' || v_retry_org::TEXT,
     'retry-' || v_retry_org::TEXT || '@example.invalid', 'construction', NULL, now());

  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_role_target_preserve, v_target_preserve, 'Claim preserve', 'claim-preserve'),
    (v_role_live_preserve, v_live_preserve, 'Claim preserve survivor', 'claim-preserve-live'),
    (v_role_target_claim, v_target_claim, 'Claim target', 'claim-target'),
    (v_role_live_update, v_live_update, 'Claim update survivor', 'claim-update'),
    (v_role_live_insert, v_live_insert, 'Claim insert survivor', 'claim-insert'),
    (v_role_retry, v_retry_org, 'Claim retry', 'claim-retry');

  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES (v_actor, 'authenticated', 'authenticated', 'claim-actor-' || v_actor::TEXT || '@example.invalid', now());
  INSERT INTO public.profiles (id, email)
  VALUES (v_actor, 'claim-actor-' || v_actor::TEXT || '@example.invalid')
  ON CONFLICT (id) DO NOTHING;

  -- Pending invitations keep fixture invitees from acquiring their ordinary
  -- signup organization before the memberships below are assembled.
  INSERT INTO public.invitations (organization_id, invited_by, email, role_id)
  VALUES
    (v_target_preserve, v_actor, v_preserved_email, v_role_target_preserve),
    (v_target_claim, v_actor, v_claimed_email, v_role_target_claim);
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_preserved_user, 'authenticated', 'authenticated', v_preserved_email, now()),
    (v_claimed_user, 'authenticated', 'authenticated', v_claimed_email, now());
  UPDATE public.invitations SET accepted_at = now()
  WHERE email IN (v_preserved_email, v_claimed_email);
  INSERT INTO public.profiles (id, email)
  VALUES
    (v_preserved_user, v_preserved_email),
    (v_claimed_user, v_claimed_email)
  ON CONFLICT (id) DO NOTHING;

  -- The survivor activation commits before the erasure claim: that identity
  -- must be preserved, even though its target-org membership is terminal.
  INSERT INTO public.memberships (organization_id, user_id, role_id, invited_by, is_active)
  VALUES
    (v_target_preserve, v_preserved_user, v_role_target_preserve, v_actor, false),
    (v_live_preserve, v_preserved_user, v_role_live_preserve, v_actor, false),
    (v_target_claim, v_claimed_user, v_role_target_claim, v_actor, false),
    (v_live_update, v_claimed_user, v_role_live_update, v_actor, false);
  UPDATE public.memberships SET is_active = true
  WHERE organization_id = v_live_preserve AND user_id = v_preserved_user;


  IF public.claim_account_deletion_identity(v_target_preserve, v_preserved_user) <> 'preserve' THEN
    RAISE EXCEPTION 'A membership activated before claim did not preserve its Auth identity';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_identity_claims WHERE auth_user_id = v_preserved_user
  ) THEN
    RAISE EXCEPTION 'An identity with a surviving active organization was claimed';
  END IF;

  IF public.claim_account_deletion_identity(v_live_update, v_claimed_user) <> 'ineligible' THEN
    RAISE EXCEPTION 'An identity was claimable for a non-terminal target organization';
  END IF;
  IF public.claim_account_deletion_identity(v_retry_org, v_claimed_user) <> 'ineligible' THEN
    RAISE EXCEPTION 'An identity was claimable without a target-organization membership';
  END IF;

  -- The opposite order: once a durable claim exists, both reactivation of an
  -- existing membership and insertion of a new active membership are denied.
  v_outcome := public.claim_account_deletion_identity(v_target_claim, v_claimed_user);
  IF v_outcome <> 'claimed' THEN
    RAISE EXCEPTION 'Expected claim for an anonymized target identity, received %', v_outcome;
  END IF;
  IF public.claim_account_deletion_identity(v_target_claim, v_claimed_user) <> 'claimed' THEN
    RAISE EXCEPTION 'A retry for the same target did not return the durable claim';
  END IF;

  v_activation_denied := false;
  BEGIN
    UPDATE public.memberships SET is_active = true
    WHERE organization_id = v_live_update AND user_id = v_claimed_user;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_activation_denied := true;
  END;
  IF NOT v_activation_denied THEN
    RAISE EXCEPTION 'An existing membership was reactivated after the erasure claim';
  END IF;

  v_activation_denied := false;
  BEGIN
    INSERT INTO public.memberships (organization_id, user_id, role_id, invited_by, is_active)
    VALUES (v_live_insert, v_claimed_user, v_role_live_insert, v_actor, true);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_activation_denied := true;
  END;
  IF NOT v_activation_denied THEN
    RAISE EXCEPTION 'A new active membership was inserted after the erasure claim';
  END IF;

  IF public.claim_account_deletion_identity(v_target_claim, v_absent_user) <> 'absent' THEN
    RAISE EXCEPTION 'An already-absent Auth identity was not handled safely';
  END IF;

  -- Scheduling and cancellation are compare-and-set operations. Neither may
  -- alter a terminal organization after anonymization has begun.
  UPDATE public.organizations
  SET deletion_requested_at = now(), deletion_scheduled_at = now() + INTERVAL '30 days'
  WHERE id = v_target_claim AND anonymized_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Deletion scheduling updated an already anonymized organization';
  END IF;

  UPDATE public.organizations
  SET deletion_requested_at = NULL, deletion_scheduled_at = NULL
  WHERE id = v_target_claim AND anonymized_at IS NULL;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 0 THEN
    RAISE EXCEPTION 'Deletion cancellation updated an already anonymized organization';
  END IF;

  -- A legacy/incomplete anonymization remains eligible even if cancellation
  -- cleared deletion_scheduled_at before the old cleanup cron completed.
  SELECT EXISTS (
    SELECT 1 FROM public.organizations AS o
    WHERE o.id = v_retry_org
      AND o.deletion_cleanup_completed_at IS NULL
      AND (
        o.anonymized_at IS NOT NULL
        OR (o.deletion_scheduled_at IS NOT NULL AND o.deletion_scheduled_at <= now())
      )
  ) INTO v_retry_eligible;
  IF NOT v_retry_eligible THEN
    RAISE EXCEPTION 'An unfinished anonymized organization with no schedule was not cleanup-eligible';
  END IF;

  SELECT c.relrowsecurity INTO v_rls_enabled
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = 'public.account_deletion_identity_claims'::regclass;
  IF NOT v_rls_enabled
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS p
       WHERE p.polrelid = 'public.account_deletion_identity_claims'::regclass
     ) THEN
    RAISE EXCEPTION 'Identity claim storage is not private under RLS';
  END IF;
  IF has_table_privilege('service_role', 'public.account_deletion_identity_claims', 'SELECT')
     OR has_table_privilege('service_role', 'public.account_deletion_identity_claims', 'INSERT')
     OR has_table_privilege('service_role', 'public.account_deletion_identity_claims', 'UPDATE')
     OR has_table_privilege('service_role', 'public.account_deletion_identity_claims', 'DELETE') THEN
    RAISE EXCEPTION 'service_role can forge or read durable identity claim rows directly';
  END IF;
  IF NOT has_function_privilege(
       'service_role', 'public.claim_account_deletion_identity(uuid,uuid)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.claim_account_deletion_identity(uuid,uuid)', 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.claim_account_deletion_identity(uuid,uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Identity claim RPC execute grants are not service-only';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_role_denied := false;
  BEGIN
    PERFORM public.claim_account_deletion_identity(v_target_claim, v_claimed_user);
  EXCEPTION WHEN insufficient_privilege THEN
    v_role_denied := true;
  END;
  IF NOT v_role_denied THEN
    RAISE EXCEPTION 'An authenticated caller invoked the service-only identity claim RPC';
  END IF;
END;
$test$;

ROLLBACK;
