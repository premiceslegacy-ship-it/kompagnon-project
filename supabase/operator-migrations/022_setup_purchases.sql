-- Achat ponctuel : preuve opérateur et activation atomiques, jamais déduits du tier.
ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN billing_model TEXT NOT NULL DEFAULT 'subscription'
    CHECK (billing_model IN ('subscription', 'setup'));

ALTER TABLE public.operator_client_subscriptions
  ADD CONSTRAINT operator_subscriptions_setup_check CHECK (
    billing_model <> 'setup' OR (
      tier = 'setup_only' AND ai_billing_mode = 'client_owned' AND mrr_ht IS NOT NULL AND mrr_ht = 0
      AND renews_at IS NULL AND trial_tier IS NULL AND trial_started_at IS NULL
      AND trial_ends_at IS NULL AND trial_converted = true AND access_ends_at IS NULL
      AND access_status IN ('active', 'locked') AND cancel_at IS NULL
      AND stripe_subscription_id IS NULL
    )
  );


CREATE FUNCTION public.protect_setup_billing_model()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.billing_model = 'setup' AND NEW.billing_model <> 'setup' THEN
    RAISE EXCEPTION 'Setup purchase cannot be converted by subscription updates';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_setup_billing_model
  BEFORE UPDATE ON public.operator_client_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.protect_setup_billing_model();
CREATE TABLE public.operator_setup_purchases (
  source_instance TEXT NOT NULL,
  organization_id UUID NOT NULL,
  payment_reference TEXT NOT NULL UNIQUE CHECK (length(btrim(payment_reference)) BETWEEN 3 AND 200),
  offer_key TEXT NOT NULL DEFAULT 'setup_3000' CHECK (offer_key = 'setup_3000'),
  approved_by TEXT NOT NULL CHECK (length(btrim(approved_by)) > 0),
  approved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_instance, organization_id),
  FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_client_subscriptions(source_instance, organization_id)
);
ALTER TABLE public.operator_setup_purchases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.operator_setup_purchases FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT ON TABLE public.operator_setup_purchases TO service_role;

CREATE FUNCTION public.protect_setup_purchase()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Setup payment approval is immutable';
END;
$$;
CREATE TRIGGER protect_setup_purchase
  BEFORE UPDATE OR DELETE ON public.operator_setup_purchases
  FOR EACH ROW EXECUTE FUNCTION public.protect_setup_purchase();

CREATE FUNCTION public.activate_operator_setup(
  p_source_instance TEXT, p_organization_id UUID,
  p_payment_reference TEXT, p_actor_email TEXT
) RETURNS TEXT LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_subscription public.operator_client_subscriptions%ROWTYPE;
  v_payment_reference TEXT;
BEGIN
  IF p_source_instance <> 'atelier-app' OR p_organization_id IS NULL
     OR length(btrim(p_payment_reference)) NOT BETWEEN 3 AND 200
     OR p_payment_reference IS NULL OR NULLIF(btrim(p_actor_email), '') IS NULL THEN
    RAISE EXCEPTION 'Explicit setup target and payment approval required';
  END IF;
  -- Même verrou que la ligne d'abonnement ; relecture après attente, pas d'upsert partiel.
  SELECT * INTO v_subscription FROM public.operator_client_subscriptions
    WHERE source_instance = p_source_instance AND organization_id = p_organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Registered organization required'; END IF;
  IF v_subscription.stripe_subscription_id IS NOT NULL THEN
    RAISE EXCEPTION 'Existing Stripe subscription must be reconciled before setup activation';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.operator_client_settings
    WHERE source_instance = p_source_instance AND organization_id = p_organization_id
      AND rtrim(app_url, '/') = 'https://app.atelier-btp.fr') THEN
    RAISE EXCEPTION 'Setup organization must belong to the shared Atelier application';
  END IF;

  SELECT payment_reference INTO v_payment_reference FROM public.operator_setup_purchases
    WHERE source_instance = p_source_instance AND organization_id = p_organization_id;
  IF FOUND THEN
    IF v_payment_reference <> btrim(p_payment_reference) THEN
      RAISE EXCEPTION 'Conflicting setup payment approval';
    END IF;
    IF v_subscription.billing_model <> 'setup' OR v_subscription.access_status <> 'active' THEN
      RAISE EXCEPTION 'Setup purchase requires operator reconciliation';
    END IF;
    RETURN 'duplicate';
  END IF;

  UPDATE public.operator_client_subscriptions SET
    billing_model = 'setup', tier = 'setup_only', preferred_tier = 'pro',
    access_status = 'active', access_ends_at = NULL, ai_billing_mode = 'client_owned',
    mrr_ht = 0, billing_currency = 'EUR', is_active = true, renews_at = NULL,
    trial_tier = NULL, trial_started_at = NULL, trial_ends_at = NULL,
    trial_converted = true, trial_reminders_sent = '{}',
    cancel_at = NULL, cancel_requested_at = NULL, payment_failed_at = NULL,
    overflow_mode = 'block', updated_at = now()
    WHERE source_instance = p_source_instance AND organization_id = p_organization_id;
  INSERT INTO public.operator_setup_purchases (
    source_instance, organization_id, payment_reference, approved_by
  ) VALUES (p_source_instance, p_organization_id, btrim(p_payment_reference), btrim(p_actor_email));
  UPDATE public.operator_client_settings SET
    monthly_fee_ht = 0, billing_currency = 'EUR', is_active = true,
    config_sync_status = 'pending', config_sync_error = NULL, updated_at = now()
    WHERE source_instance = p_source_instance AND organization_id = p_organization_id;
  INSERT INTO public.operator_client_events (
    source_instance, organization_id, event_category, event_type, actor_email, metadata
  ) VALUES (
    p_source_instance, p_organization_id, 'subscription', 'setup_purchase_approved', btrim(p_actor_email),
    jsonb_build_object('offer_key', 'setup_3000', 'billing_model', 'setup', 'mrr_ht', 0)
  );
  RETURN 'activated';
END;
$$;
REVOKE ALL ON FUNCTION public.activate_operator_setup(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_operator_setup(TEXT, UUID, TEXT, TEXT) TO service_role;

COMMENT ON TABLE public.operator_setup_purchases IS
  'Immutable manual payment approval. No payment collection; no automatic conversion of historical setup_only rows.';

CREATE OR REPLACE FUNCTION public.assert_setup_billing_schema()
RETURNS TABLE (ok BOOLEAN, failures TEXT[])
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH checks(label, valid) AS (VALUES
    ('billing_model_column', EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'operator_client_subscriptions'
        AND column_name = 'billing_model' AND is_nullable = 'NO')),
    ('entitlement_revision_column', EXISTS (SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'operator_client_subscriptions'
        AND column_name = 'entitlement_revision' AND is_nullable = 'NO')),
    ('entitlement_revision_trigger', EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.operator_client_subscriptions'::regclass
        AND tgname = 'advance_operator_entitlement_revision' AND tgenabled <> 'D')),
    ('setup_constraints', EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.operator_client_subscriptions'::regclass
        AND conname = 'operator_subscriptions_setup_check' AND convalidated)),
    ('purchase_rls', (SELECT relrowsecurity FROM pg_catalog.pg_class
      WHERE oid = 'public.operator_setup_purchases'::regclass)),
    ('purchase_no_policies', NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy
      WHERE polrelid = 'public.operator_setup_purchases'::regclass)),
    ('purchase_immutable', EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.operator_setup_purchases'::regclass
        AND tgname = 'protect_setup_purchase' AND tgenabled <> 'D')),
    ('setup_model_protected', EXISTS (SELECT 1 FROM pg_catalog.pg_trigger
      WHERE tgrelid = 'public.operator_client_subscriptions'::regclass
        AND tgname = 'protect_setup_billing_model' AND tgenabled <> 'D')),
    ('purchase_roles', NOT EXISTS (
      SELECT 1 FROM unnest(ARRAY['anon','authenticated']) role_name
      CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE']) privilege_name
      WHERE has_table_privilege(role_name, 'public.operator_setup_purchases', privilege_name))),
    ('purchase_service_append_only',
      has_table_privilege('service_role', 'public.operator_setup_purchases', 'SELECT')
      AND has_table_privilege('service_role', 'public.operator_setup_purchases', 'INSERT')
      AND NOT has_table_privilege('service_role', 'public.operator_setup_purchases', 'UPDATE')
      AND NOT has_table_privilege('service_role', 'public.operator_setup_purchases', 'DELETE')
      AND NOT has_table_privilege('service_role', 'public.operator_setup_purchases', 'TRUNCATE')),
    ('activation_rpc_roles',
      has_function_privilege('service_role', 'public.activate_operator_setup(text,uuid,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('anon', 'public.activate_operator_setup(text,uuid,text,text)', 'EXECUTE')
      AND NOT has_function_privilege('authenticated', 'public.activate_operator_setup(text,uuid,text,text)', 'EXECUTE'))
  )
  SELECT COALESCE(bool_and(valid), false),
    COALESCE(array_agg(label) FILTER (WHERE valid IS DISTINCT FROM true), '{}'::TEXT[]) FROM checks;
$$;
REVOKE ALL ON FUNCTION public.assert_setup_billing_schema() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_setup_billing_schema() TO service_role;

-- Révision autoritaire monotone ; indépendante de l'horloge et des timestamps HTTP.
ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN entitlement_revision BIGINT NOT NULL DEFAULT 0 CHECK (entitlement_revision >= 0);
CREATE FUNCTION public.advance_operator_entitlement_revision()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.entitlement_revision := OLD.entitlement_revision + 1;
  RETURN NEW;
END;
$$;
CREATE TRIGGER advance_operator_entitlement_revision
  BEFORE UPDATE ON public.operator_client_subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.advance_operator_entitlement_revision();
NOTIFY pgrst, 'reload schema';
