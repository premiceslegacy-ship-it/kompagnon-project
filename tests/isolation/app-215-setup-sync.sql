-- Run only against a disposable LOCAL Supabase database migrated through final 215:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/app-215-setup-sync.sql
-- Exercises atomic setup config sync, revision ordering, and trigger guards. All fixtures roll back.
BEGIN;
SET LOCAL ROLE service_role;

DO $test$
DECLARE
  v_org_a UUID := gen_random_uuid();
  v_org_b UUID := gen_random_uuid();
  v_modules_pro JSONB := '{"quote_ai":true,"voice_live":true}'::JSONB;
  v_quota_pro JSONB := '{"quote_ai":100,"voice_live_minutes":20}'::JSONB;
  v_modules_setup JSONB := '{"quote_ai":true,"voice_live":false}'::JSONB;
  v_quota_setup JSONB := '{"quote_ai":0,"voice_live_minutes":0}'::JSONB;
  v_entitlement_active_1 JSONB := jsonb_build_object(
    'billing_model', 'setup', 'access_status', 'active',
    'effective_tier', 'setup_only', 'preferred_tier', 'pro',
    'trial_started_at', NULL, 'trial_ends_at', NULL, 'access_ends_at', NULL,
    'revision', 1
  );
  v_entitlement_locked_2 JSONB := jsonb_build_object(
    'billing_model', 'setup', 'access_status', 'locked',
    'effective_tier', 'setup_only', 'preferred_tier', 'pro',
    'trial_started_at', NULL, 'trial_ends_at', NULL, 'access_ends_at', NULL,
    'revision', 2
  );
  v_entitlement_active_2 JSONB := jsonb_build_object(
    'billing_model', 'setup', 'access_status', 'active',
    'effective_tier', 'setup_only', 'preferred_tier', 'pro',
    'trial_started_at', NULL, 'trial_ends_at', NULL, 'access_ends_at', NULL,
    'revision', 2
  );
  v_entitlement_active_3 JSONB := jsonb_build_object(
    'billing_model', 'setup', 'access_status', 'active',
    'effective_tier', 'setup_only', 'preferred_tier', 'pro',
    'trial_started_at', NULL, 'trial_ends_at', NULL, 'access_ends_at', NULL,
    'revision', 3
  );
  v_entitlement_active_4 JSONB := jsonb_build_object(
    'billing_model', 'setup', 'access_status', 'active',
    'effective_tier', 'setup_only', 'preferred_tier', 'pro',
    'trial_started_at', NULL, 'trial_ends_at', NULL, 'access_ends_at', NULL,
    'revision', 4
  );
  v_entitlement_subscription JSONB := jsonb_build_object(
    'billing_model', 'subscription', 'access_status', 'active',
    'effective_tier', 'pro', 'preferred_tier', 'pro',
    'trial_started_at', NULL, 'trial_ends_at', NULL, 'access_ends_at', NULL
  );
  v_einvoicing_setup JSONB := jsonb_build_object(
    'mode', 'export_only', 'provider', 'external_pa', 'environment', 'production',
    'annuaire_status', 'not_started', 'oauth_status', 'not_connected',
    'oauth_connected_at', NULL, 'super_pdp_connection_id', NULL,
    'super_pdp_emission_enabled', false, 'super_pdp_reception_enabled', false
  );
  v_einvoicing_other JSONB := jsonb_build_object(
    'mode', 'super_pdp', 'provider', 'super_pdp', 'environment', 'sandbox',
    'annuaire_status', 'pending', 'oauth_status', 'pending',
    'oauth_connected_at', NULL, 'super_pdp_connection_id', NULL,
    'super_pdp_emission_enabled', false, 'super_pdp_reception_enabled', false
  );
  v_a_before JSONB;
  v_a_after JSONB;
  v_b_before JSONB;
  v_b_after JSONB;
  v_rejected BOOLEAN;
  v_sqlstate TEXT;
  v_case RECORD;
BEGIN
  INSERT INTO public.organizations (id, name, slug, email, sector)
  VALUES
    (v_org_a, 'Setup sync fixture A', 'app-215-setup-a-' || replace(v_org_a::TEXT, '-', ''),
     'app-215-setup-a-' || v_org_a::TEXT || '@example.invalid', 'construction'),
    (v_org_b, 'Setup sync fixture B', 'app-215-setup-b-' || replace(v_org_b::TEXT, '-', ''),
     'app-215-setup-b-' || v_org_b::TEXT || '@example.invalid', 'construction');

  -- Omit billing_model and setup_revision so the schema defaults prove the fixture starts as subscription v0.
  INSERT INTO public.organization_entitlements (
    organization_id, access_status, effective_tier, preferred_tier
  ) VALUES
    (v_org_a, 'active', 'pro', 'pro'),
    (v_org_b, 'active', 'pro', 'pro');

  INSERT INTO public.organization_modules (
    organization_id, modules, quota_config, overflow_mode, ai_billing_mode
  ) VALUES
    (v_org_a, v_modules_pro, v_quota_pro, 'charge', 'orsayn_shared'),
    (v_org_b, '{"quote_ai":false,"voice_live":false}'::JSONB,
      '{"quote_ai":7,"voice_live_minutes":0}'::JSONB, 'block', 'orsayn_shared');

  INSERT INTO public.organization_einvoicing_config (
    organization_id, mode, provider, environment, onboarding_intent
  ) VALUES
    (v_org_a, 'off', NULL, 'sandbox', 'later'),
    (v_org_b, 'off', NULL, 'sandbox', 'later');

  IF (SELECT billing_model FROM public.organization_entitlements WHERE organization_id = v_org_a) <> 'subscription'
     OR (SELECT setup_revision FROM public.organization_entitlements WHERE organization_id = v_org_a) <> 0 THEN
    RAISE EXCEPTION 'Fixture did not start with default subscription entitlement revision zero';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_ai_credentials WHERE organization_id = v_org_a) THEN
    RAISE EXCEPTION 'Setup fixture unexpectedly depends on a client OpenRouter key';
  END IF;

  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_b),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_b),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_b)
  ) INTO v_b_before;

  -- A Pro subscription becomes a paid setup atomically, without an AI key or shared payer.
  IF public.apply_operator_config(
    v_org_a, v_modules_setup, v_quota_setup, 'block', 'client_owned',
    v_einvoicing_setup, v_entitlement_active_1
  ) IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'Initial setup revision was not applied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_entitlements
    WHERE organization_id = v_org_a AND billing_model = 'setup' AND access_status = 'active'
      AND effective_tier = 'setup_only' AND preferred_tier = 'pro'
      AND trial_started_at IS NULL AND trial_ends_at IS NULL AND access_ends_at IS NULL
      AND setup_revision = 1
  ) OR NOT EXISTS (
    SELECT 1 FROM public.organization_modules
    WHERE organization_id = v_org_a AND modules = v_modules_setup AND quota_config = v_quota_setup
      AND overflow_mode = 'block' AND ai_billing_mode = 'client_owned'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.organization_einvoicing_config
    WHERE organization_id = v_org_a AND mode = 'export_only' AND provider = 'external_pa'
      AND environment = 'production' AND onboarding_intent = 'later'
  ) THEN
    RAISE EXCEPTION 'Setup entitlement, module payer/quotas, and e-invoicing were not synchronized atomically';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organization_ai_credentials WHERE organization_id = v_org_a) THEN
    RAISE EXCEPTION 'Applying setup unexpectedly required or created a client key';
  END IF;

  -- A newer operator lock replaces the active state; NULL e-invoicing preserves the current mirror.
  IF public.apply_operator_config(
    v_org_a, v_modules_setup, v_quota_setup, 'block', 'client_owned',
    NULL, v_entitlement_locked_2
  ) IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'Newer setup lock revision was not applied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_entitlements
    WHERE organization_id = v_org_a AND billing_model = 'setup' AND access_status = 'locked'
      AND effective_tier = 'setup_only' AND setup_revision = 2
  ) OR NOT EXISTS (
    SELECT 1 FROM public.organization_einvoicing_config
    WHERE organization_id = v_org_a AND mode = 'export_only' AND provider = 'external_pa'
      AND environment = 'production' AND onboarding_intent = 'later'
  ) THEN
    RAISE EXCEPTION 'Setup lock revision was not applied or NULL e-invoicing did not preserve its existing config';
  END IF;

  -- A delayed active revision cannot reopen the newer lock or touch any synchronized column.
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_before;
  BEGIN
    PERFORM public.apply_operator_config(
      v_org_a, jsonb_set(v_modules_setup, '{quote_ai}', 'false'), v_quota_setup, 'block', 'client_owned',
      v_einvoicing_other, v_entitlement_active_1
    );
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Stale setup active revision was accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_after;
  IF v_a_after IS DISTINCT FROM v_a_before THEN
    RAISE EXCEPTION 'Rejected stale active revision changed entitlement/access, modules, e-invoicing, or updated_at';
  END IF;

  -- Subscription-shaped or missing-entitlement syncs have no authority over an existing setup.
  v_rejected := false;
  BEGIN
    PERFORM public.apply_operator_config(
      v_org_a, v_modules_pro, v_quota_pro, 'charge', 'orsayn_shared',
      v_einvoicing_other, v_entitlement_subscription
    );
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Subscription config replaced setup';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate = 'XX001' THEN RAISE; END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Subscription config was not rejected for an existing setup'; END IF;
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_after;
  IF v_a_after IS DISTINCT FROM v_a_before THEN
    RAISE EXCEPTION 'Rejected subscription config modified setup columns';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM public.apply_operator_config(
      v_org_a, v_modules_pro, v_quota_pro, 'charge', 'orsayn_shared',
      v_einvoicing_other, NULL
    );
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Unversioned config replaced existing setup';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate = 'XX001' THEN RAISE; END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Config without a versioned setup entitlement was not rejected'; END IF;
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_after;
  IF v_a_after IS DISTINCT FROM v_a_before THEN
    RAISE EXCEPTION 'Rejected unversioned config modified setup columns';
  END IF;

  -- A same-revision but different status is a conflict, not a permissible retry.
  BEGIN
    PERFORM public.apply_operator_config(
      v_org_a, v_modules_setup, v_quota_setup, 'block', 'client_owned',
      NULL, v_entitlement_active_2
    );
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Conflicting status at the same setup revision was accepted';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL;
  END;
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_after;
  IF v_a_after IS DISTINCT FROM v_a_before THEN
    RAISE EXCEPTION 'Rejected same-revision conflict changed setup state';
  END IF;

  -- Retrying the exact locked revision succeeds without changing its durable state.
  IF public.apply_operator_config(
    v_org_a, v_modules_setup, v_quota_setup, 'block', 'client_owned',
    NULL, v_entitlement_locked_2
  ) IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'Identical setup lock retry was not accepted';
  END IF;
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_after;
  IF NOT EXISTS (SELECT 1 FROM public.organization_entitlements
    WHERE organization_id = v_org_a AND access_status = 'locked' AND setup_revision = 2)
    OR NOT EXISTS (SELECT 1 FROM public.organization_modules
      WHERE organization_id = v_org_a AND ai_billing_mode = 'client_owned' AND modules = v_modules_setup) THEN
    RAISE EXCEPTION 'Identical setup lock retry changed the access or payer';
  END IF;

  -- A later operator revision explicitly unlocks; this is the only valid reopening path exercised here.
  IF public.apply_operator_config(
    v_org_a, v_modules_setup, v_quota_setup, 'block', 'client_owned',
    NULL, v_entitlement_active_3
  ) IS DISTINCT FROM 'applied' THEN
    RAISE EXCEPTION 'Higher setup unlock revision was not applied';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_entitlements
    WHERE organization_id = v_org_a AND billing_model = 'setup' AND access_status = 'active'
      AND effective_tier = 'setup_only' AND setup_revision = 3
  ) THEN
    RAISE EXCEPTION 'Higher setup revision did not unlock the organization';
  END IF;

  -- Direct database writes remain guarded independently of the RPC. Do not test
  -- reopening a setup entitlement by direct UPDATE: HTTP authority is not in this SQL fixture.
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_before;
  v_rejected := false;
  BEGIN
    UPDATE public.organization_entitlements SET billing_model = 'subscription'
    WHERE organization_id = v_org_a;
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Direct entitlement update converted setup to subscription';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate = 'XX001' THEN RAISE; END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Direct setup-to-subscription entitlement update was not guarded'; END IF;
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_after;
  IF v_a_after IS DISTINCT FROM v_a_before THEN
    RAISE EXCEPTION 'Direct entitlement guard failure changed setup state';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.organization_modules SET ai_billing_mode = 'orsayn_shared'
    WHERE organization_id = v_org_a;
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Direct module update assigned setup to shared AI payer';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    IF v_sqlstate = 'XX001' THEN RAISE; END IF;
    v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'Direct setup shared-payer module update was not guarded'; END IF;
  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
  ) INTO v_a_after;
  IF v_a_after IS DISTINCT FROM v_a_before THEN
    RAISE EXCEPTION 'Direct AI payer guard failure changed setup state';
  END IF;

  -- Invalid higher-version setup payloads fail as one unit; module, entitlement,
  -- e-invoicing, and updated_at snapshots must all remain byte-for-byte unchanged.
  FOR v_case IN
    SELECT * FROM (VALUES
      ('shared payer', 'orsayn_shared'::TEXT, v_modules_setup, v_quota_setup, 'block'::TEXT),
      ('live voice module', 'client_owned'::TEXT, '{"quote_ai":true,"voice_live":true}'::JSONB, v_quota_setup, 'block'::TEXT),
      ('nonzero voice quota', 'client_owned'::TEXT, v_modules_setup, '{"quote_ai":0,"voice_live_minutes":1}'::JSONB, 'block'::TEXT),
      ('nonblocking overflow', 'client_owned'::TEXT, v_modules_setup, v_quota_setup, 'charge'::TEXT)
    ) AS invalid_setup(case_name, ai_mode, modules, quota_config, overflow_mode)
  LOOP
    SELECT jsonb_build_object(
      'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
      'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
      'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
    ) INTO v_a_before;
    v_rejected := false;
    BEGIN
      PERFORM public.apply_operator_config(
        v_org_a, v_case.modules, v_case.quota_config, v_case.overflow_mode,
        v_case.ai_mode, v_einvoicing_other, v_entitlement_active_4
      );
      RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Invalid setup payload accepted: ' || v_case.case_name;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate = 'XX001' THEN RAISE; END IF;
      v_rejected := true;
    END;
    IF NOT v_rejected THEN RAISE EXCEPTION 'Invalid setup payload was not rejected: %', v_case.case_name; END IF;
    SELECT jsonb_build_object(
      'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_a),
      'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_a),
      'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_a)
    ) INTO v_a_after;
    IF v_a_after IS DISTINCT FROM v_a_before THEN
      RAISE EXCEPTION 'Invalid setup payload changed synchronized state: %', v_case.case_name;
    END IF;
  END LOOP;

  SELECT jsonb_build_object(
    'entitlement', (SELECT to_jsonb(e) FROM public.organization_entitlements e WHERE e.organization_id = v_org_b),
    'modules', (SELECT to_jsonb(m) FROM public.organization_modules m WHERE m.organization_id = v_org_b),
    'einvoicing', (SELECT to_jsonb(i) FROM public.organization_einvoicing_config i WHERE i.organization_id = v_org_b)
  ) INTO v_b_after;
  IF v_b_after IS DISTINCT FROM v_b_before THEN
    RAISE EXCEPTION 'Config sync or rejection changed the other tenant';
  END IF;
END;
$test$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $unprivileged$
BEGIN
  BEGIN
    PERFORM public.apply_operator_config(
      gen_random_uuid(), '{}'::JSONB, '{}'::JSONB, 'block', 'orsayn_shared', NULL, NULL
    );
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'authenticated executed apply_operator_config';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$unprivileged$;
RESET ROLE;
ROLLBACK;
