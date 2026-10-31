-- Disposable LOCAL cockpit DB only, migrations 001-022. All fixtures roll back.
BEGIN;
SET LOCAL ROLE service_role;
DO $setup$
DECLARE
  a UUID := gen_random_uuid();
  b UUID := gen_random_uuid();
  c UUID := gen_random_uuid();
  receipt TEXT := 'local-setup-' || gen_random_uuid()::TEXT;
  before_b JSONB;
  after_b JSONB;
  row_a public.operator_client_subscriptions%ROWTYPE;
BEGIN
  INSERT INTO public.operator_client_settings (source_instance, organization_id, label, app_url)
    VALUES ('atelier-app', a, 'Fictional setup A', 'https://app.atelier-btp.fr'),
      ('atelier-app', b, 'Fictional setup B', 'https://app.atelier-btp.fr'),
      ('atelier-app', c, 'Fictional Stripe C', 'https://app.atelier-btp.fr');
  INSERT INTO public.operator_client_subscriptions (
    source_instance, organization_id, access_status, trial_tier, trial_started_at, trial_ends_at
  ) VALUES ('atelier-app', a, 'trialing', 'pro', now() - interval '8 days', now() - interval '1 day'),
    ('atelier-app', b, 'locked', NULL, NULL, NULL);
  INSERT INTO public.operator_client_subscriptions (source_instance, organization_id, stripe_subscription_id)
    VALUES ('atelier-app', c, 'sub_local_setup_conflict');
  SELECT to_jsonb(s) INTO before_b FROM public.operator_client_subscriptions s
    WHERE source_instance = 'atelier-app' AND organization_id = b;

  IF public.activate_operator_setup('atelier-app', a, receipt, 'operator@example.invalid') <> 'activated' THEN
    RAISE EXCEPTION 'Initial purchase was not activated';
  END IF;
  SELECT * INTO row_a FROM public.operator_client_subscriptions
    WHERE source_instance = 'atelier-app' AND organization_id = a;
  IF row_a.billing_model <> 'setup' OR row_a.access_status <> 'active'
    OR row_a.ai_billing_mode <> 'client_owned' OR row_a.mrr_ht <> 0
    OR row_a.trial_ends_at IS NOT NULL OR row_a.trial_tier IS NOT NULL
    OR row_a.access_ends_at IS NOT NULL OR row_a.renews_at IS NOT NULL
    OR NOT row_a.trial_converted THEN
    RAISE EXCEPTION 'Purchase retained an expiry, shared payer or monthly charge';
  END IF;
  IF public.activate_operator_setup('atelier-app', a, receipt, 'operator@example.invalid') <> 'duplicate' THEN
    RAISE EXCEPTION 'Same purchase was not idempotent';
  END IF;
  IF (SELECT count(*) FROM public.operator_client_events
      WHERE source_instance = 'atelier-app' AND organization_id = a AND event_type = 'setup_purchase_approved') <> 1 THEN
    RAISE EXCEPTION 'Replayed purchase created duplicate approvals';
  END IF;
  BEGIN
    PERFORM public.activate_operator_setup('atelier-app', a, receipt || '-different', 'operator@example.invalid');
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Conflicting approval was accepted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.activate_operator_setup('atelier-app', b, receipt, 'operator@example.invalid');
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Same payment granted a second organization';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;
  SELECT to_jsonb(s) INTO after_b FROM public.operator_client_subscriptions s
    WHERE source_instance = 'atelier-app' AND organization_id = b;
  IF before_b IS DISTINCT FROM after_b OR EXISTS (
    SELECT 1 FROM public.operator_setup_purchases WHERE source_instance = 'atelier-app' AND organization_id = b
  ) THEN RAISE EXCEPTION 'Failed purchase changed organization B'; END IF;
  BEGIN
    PERFORM public.activate_operator_setup('atelier-app', c, receipt || '-stripe', 'operator@example.invalid');
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Existing Stripe subscription was silently converted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    PERFORM public.activate_operator_setup('wrong-source', a, receipt, 'operator@example.invalid');
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Wrong source was accepted';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    UPDATE public.operator_client_subscriptions SET billing_model = 'subscription'
      WHERE source_instance = 'atelier-app' AND organization_id = a;
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Subscription response converted the purchase';
  EXCEPTION WHEN raise_exception THEN NULL;
  END;
  BEGIN
    UPDATE public.operator_client_subscriptions SET mrr_ht = 69
      WHERE source_instance = 'atelier-app' AND organization_id = a;
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Purchase gained a monthly charge';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    DELETE FROM public.operator_setup_purchases WHERE source_instance = 'atelier-app' AND organization_id = a;
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Service role deleted a payment approval';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$setup$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $unprivileged$
BEGIN
  BEGIN
    PERFORM public.activate_operator_setup('atelier-app', gen_random_uuid(), 'local-test', 'fake@example.invalid');
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Customer self-granted setup access';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.operator_setup_purchases;
    RAISE EXCEPTION USING ERRCODE = 'XX001', MESSAGE = 'Customer read another organization payment approvals';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END;
$unprivileged$;
ROLLBACK;
