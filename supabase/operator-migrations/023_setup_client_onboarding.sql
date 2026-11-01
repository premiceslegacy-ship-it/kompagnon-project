-- Internal setup-client intake metadata. It is not payment, import, or delivery evidence.
CREATE FUNCTION public.is_valid_setup_onboarding_materials(p_materials JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_item JSONB;
  v_count NUMERIC;
  v_key_count INTEGER;
BEGIN
  IF jsonb_typeof(p_materials) IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_materials) > 12 THEN
    RETURN false;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_materials) AS entries(value) LOOP
    IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
      RETURN false;
    END IF;
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(v_item);
    IF v_key_count <> 4
       OR jsonb_typeof(v_item -> 'label') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'category') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_item -> 'count') IS DISTINCT FROM 'number'
       OR jsonb_typeof(v_item -> 'reference') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;

    v_count := (v_item ->> 'count')::NUMERIC;
    IF length(btrim(v_item ->> 'label')) NOT BETWEEN 1 AND 100
       OR v_item ->> 'category' NOT IN ('document', 'tableur', 'photo', 'export', 'autre')
       OR v_count <> trunc(v_count) OR v_count NOT BETWEEN 1 AND 999
       OR length(v_item ->> 'reference') > 120
       OR (v_item ->> 'label') ~* '(https?://|ftp://|www[.])'
       OR (v_item ->> 'reference') ~* '(https?://|ftp://|www[.])'
       OR position('@' IN (v_item ->> 'label')) > 0
       OR position('@' IN (v_item ->> 'reference')) > 0
       OR position('/' IN (v_item ->> 'reference')) > 0
       OR position(chr(92) IN (v_item ->> 'reference')) > 0 THEN
      RETURN false;
    END IF;
  END LOOP;

  RETURN true;
END;
$$;

CREATE TABLE public.operator_setup_client_onboarding (
  source_instance TEXT NOT NULL DEFAULT 'atelier-app' CHECK (source_instance = 'atelier-app'),
  organization_id UUID NOT NULL CHECK (organization_id <> '00000000-0000-0000-0000-000000000000'::UUID),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision BETWEEN 1 AND 2147483646),
  first_value_goal TEXT NOT NULL DEFAULT '' CHECK (length(first_value_goal) <= 600),
  first_value_acceptance TEXT NOT NULL DEFAULT '' CHECK (length(first_value_acceptance) <= 600),
  scope_included TEXT NOT NULL DEFAULT '' CHECK (length(scope_included) <= 1200),
  scope_excluded TEXT NOT NULL DEFAULT '' CHECK (length(scope_excluded) <= 1200),
  decision_owner_role TEXT NOT NULL DEFAULT '' CHECK (length(decision_owner_role) <= 160),
  target_date DATE,
  expected_materials JSONB NOT NULL DEFAULT '[]'::JSONB
    CHECK (public.is_valid_setup_onboarding_materials(expected_materials)),
  blockers TEXT NOT NULL DEFAULT '' CHECK (length(blockers) <= 600),
  next_action TEXT NOT NULL DEFAULT '' CHECK (length(next_action) <= 600),
  scope_validated BOOLEAN NOT NULL DEFAULT false,
  scope_validated_at TIMESTAMPTZ,
  scope_validated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL CHECK (length(btrim(created_by)) BETWEEN 3 AND 320 AND position('@' IN created_by) > 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by TEXT NOT NULL CHECK (length(btrim(updated_by)) BETWEEN 3 AND 320 AND position('@' IN updated_by) > 1),
  CONSTRAINT operator_setup_client_onboarding_identity_fkey
    FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_clients (source_instance, organization_id) ON DELETE CASCADE,
  CONSTRAINT operator_setup_client_onboarding_settings_fkey
    FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_client_settings (source_instance, organization_id) ON DELETE CASCADE,
  CONSTRAINT operator_setup_client_onboarding_subscription_fkey
    FOREIGN KEY (source_instance, organization_id)
    REFERENCES public.operator_client_subscriptions (source_instance, organization_id) ON DELETE CASCADE,
  CONSTRAINT operator_setup_client_onboarding_scope_attestation_check CHECK (
    (scope_validated AND scope_validated_at IS NOT NULL AND scope_validated_by IS NOT NULL
      AND length(btrim(first_value_goal)) > 0 AND length(btrim(first_value_acceptance)) > 0
      AND length(btrim(scope_included)) > 0 AND length(btrim(scope_excluded)) > 0)
    OR (NOT scope_validated AND scope_validated_at IS NULL AND scope_validated_by IS NULL)
  ),
  CONSTRAINT operator_setup_client_onboarding_scope_actor_check CHECK (
    scope_validated_by IS NULL OR (length(btrim(scope_validated_by)) BETWEEN 3 AND 320 AND position('@' IN scope_validated_by) > 1)
  ),
  PRIMARY KEY (source_instance, organization_id)
);

CREATE FUNCTION public.guard_setup_client_onboarding()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.operator_clients AS client
    JOIN public.operator_client_settings AS settings
      ON settings.source_instance = client.source_instance
      AND settings.organization_id = client.organization_id
    JOIN public.operator_client_subscriptions AS subscription
      ON subscription.source_instance = client.source_instance
      AND subscription.organization_id = client.organization_id
    WHERE client.source_instance = 'atelier-app'
      AND client.organization_id = NEW.organization_id
      AND rtrim(settings.app_url, '/') = 'https://app.atelier-btp.fr'
      AND subscription.billing_model = 'setup'
  ) THEN
    RAISE EXCEPTION 'Setup onboarding requires the exact registered Atelier organization';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.created_by IS DISTINCT FROM NEW.updated_by THEN
      RAISE EXCEPTION 'Setup onboarding creation attribution must match';
    END IF;
    NEW.revision := 1;
    NEW.created_at := now();
    NEW.updated_at := NEW.created_at;
  ELSE
    IF NEW.source_instance IS DISTINCT FROM OLD.source_instance
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Setup onboarding identity and creation attribution are immutable';
    END IF;
    NEW.revision := OLD.revision + 1;
    NEW.updated_at := now();
  END IF;

  IF NEW.scope_validated THEN
    IF length(btrim(NEW.first_value_goal)) = 0
       OR length(btrim(NEW.first_value_acceptance)) = 0
       OR length(btrim(NEW.scope_included)) = 0
       OR length(btrim(NEW.scope_excluded)) = 0 THEN
      RAISE EXCEPTION 'A complete scope is required for human attestation';
    END IF;
    IF TG_OP = 'INSERT' THEN
      NEW.scope_validated_at := now();
      NEW.scope_validated_by := NEW.updated_by;
    ELSIF NOT OLD.scope_validated
       OR NEW.first_value_goal IS DISTINCT FROM OLD.first_value_goal
       OR NEW.first_value_acceptance IS DISTINCT FROM OLD.first_value_acceptance
       OR NEW.scope_included IS DISTINCT FROM OLD.scope_included
       OR NEW.scope_excluded IS DISTINCT FROM OLD.scope_excluded
       OR NEW.decision_owner_role IS DISTINCT FROM OLD.decision_owner_role
       OR NEW.expected_materials IS DISTINCT FROM OLD.expected_materials THEN
      NEW.scope_validated_at := now();
      NEW.scope_validated_by := NEW.updated_by;
    ELSE
      NEW.scope_validated_at := OLD.scope_validated_at;
      NEW.scope_validated_by := OLD.scope_validated_by;
    END IF;
  ELSE
    NEW.scope_validated_at := NULL;
    NEW.scope_validated_by := NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER guard_setup_client_onboarding
  BEFORE INSERT OR UPDATE ON public.operator_setup_client_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.guard_setup_client_onboarding();

ALTER TABLE public.operator_setup_client_onboarding ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.operator_setup_client_onboarding FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.operator_setup_client_onboarding TO service_role;
REVOKE ALL ON FUNCTION public.is_valid_setup_onboarding_materials(JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_valid_setup_onboarding_materials(JSONB) TO service_role;
REVOKE ALL ON FUNCTION public.guard_setup_client_onboarding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_setup_client_onboarding() TO service_role;

COMMENT ON TABLE public.operator_setup_client_onboarding IS
  'Operator-only setup intake metadata. Contains no customer files, payment evidence, credentials, payroll data, NIR, or health records.';
