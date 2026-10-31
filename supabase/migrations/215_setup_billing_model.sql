-- Un achat setup n'est ni un abonnement ni un essai expiré de tier setup_only.
ALTER TABLE public.organization_entitlements
  ADD COLUMN billing_model TEXT NOT NULL DEFAULT 'subscription'
    CHECK (billing_model IN ('subscription', 'setup'));

ALTER TABLE public.organization_entitlements
  ADD CONSTRAINT organization_entitlements_setup_check CHECK (
    billing_model <> 'setup' OR (
      access_status IN ('active', 'locked')
      AND effective_tier = 'setup_only'
      AND trial_started_at IS NULL AND trial_ends_at IS NULL AND access_ends_at IS NULL
    )
  );

ALTER TABLE public.organization_entitlements
  ADD COLUMN setup_revision BIGINT NOT NULL DEFAULT 0
    CHECK (setup_revision >= 0);

CREATE OR REPLACE FUNCTION public.protect_setup_entitlement()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('atelier-operator-config:' || NEW.organization_id::text, 0)
  ) THEN
    RAISE EXCEPTION 'Organization config is being synchronized'
      USING ERRCODE = '40001';
  END IF;

  IF OLD.billing_model = 'setup' AND NEW.billing_model <> 'setup' THEN
    RAISE EXCEPTION 'Setup access cannot be converted by a subscription response';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_setup_entitlement
  BEFORE UPDATE ON public.organization_entitlements
  FOR EACH ROW EXECUTE FUNCTION public.protect_setup_entitlement();

CREATE OR REPLACE FUNCTION public.protect_setup_ai_payer()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended('atelier-operator-config:' || NEW.organization_id::text, 0)
  ) THEN
    RAISE EXCEPTION 'Organization config is being synchronized'
      USING ERRCODE = '40001';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organization_entitlements
    WHERE organization_id = NEW.organization_id AND billing_model = 'setup'
  )
  AND (NEW.ai_billing_mode IS DISTINCT FROM 'client_owned'
    OR COALESCE((NEW.modules->>'voice_live')::BOOLEAN, false)) THEN
    RAISE EXCEPTION 'Setup AI must use the organization key without central live voice';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_setup_ai_payer
  BEFORE INSERT OR UPDATE ON public.organization_modules
  FOR EACH ROW EXECUTE FUNCTION public.protect_setup_ai_payer();
REVOKE ALL ON FUNCTION public.protect_setup_ai_payer() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.apply_operator_config(
  p_organization_id UUID,
  p_modules JSONB,
  p_quota_config JSONB,
  p_overflow_mode TEXT,
  p_ai_billing_mode TEXT,
  p_einvoicing_config JSONB DEFAULT NULL,
  p_entitlement JSONB DEFAULT NULL
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_billing_model TEXT;
  v_access_status TEXT;
  v_effective_tier TEXT;
  v_preferred_tier TEXT;
  v_setup_revision BIGINT;
  v_trial_started_at TIMESTAMPTZ;
  v_trial_ends_at TIMESTAMPTZ;
  v_access_ends_at TIMESTAMPTZ;
  v_current_billing_model TEXT;
  v_current_access_status TEXT;
  v_current_setup_revision BIGINT;
  v_einvoicing_mode TEXT;
  v_einvoicing_provider TEXT;
  v_einvoicing_environment TEXT;
  v_annuaire_status TEXT;
  v_oauth_status TEXT;
  v_oauth_connected_at TIMESTAMPTZ;
  v_super_pdp_connection_id TEXT;
  v_emission_enabled BOOLEAN;
  v_reception_enabled BOOLEAN;
BEGIN
  IF p_organization_id IS NULL
    OR p_modules IS NULL OR pg_catalog.jsonb_typeof(p_modules) IS DISTINCT FROM 'object'
    OR p_quota_config IS NULL OR pg_catalog.jsonb_typeof(p_quota_config) IS DISTINCT FROM 'object'
    OR p_overflow_mode IS NULL OR p_overflow_mode NOT IN ('block', 'upgrade_prompt', 'charge')
    OR p_ai_billing_mode IS NULL OR p_ai_billing_mode NOT IN ('orsayn_shared', 'client_owned') THEN
    RAISE EXCEPTION 'Invalid operator config'
      USING ERRCODE = 'PT400';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations WHERE id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'Organization not found'
      USING ERRCODE = 'PT404';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(p_modules) AS module(key, value)
    WHERE key NOT IN (
      'relances_ai', 'weekly_summary', 'quote_ai', 'planning_ai',
      'chantier_assistant', 'sarah_assistant', 'suggest_tasks', 'catalog_ai',
      'document_import_ai', 'chantier_report_ai', 'labor_estimate_ai',
      'receipt_ocr', 'voice_input', 'voice_live'
    )
      OR pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'boolean'
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_each(p_quota_config) AS quota(key, value)
    WHERE key NOT IN (
      'relances_ai', 'weekly_summary', 'quote_ai', 'planning_ai',
      'chantier_assistant', 'sarah_assistant', 'suggest_tasks', 'catalog_ai',
      'document_import_ai', 'chantier_report_ai', 'labor_estimate_ai',
      'receipt_ocr', 'voice_input', 'voice_live_minutes'
    )
      OR pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'number'
  ) THEN
    RAISE EXCEPTION 'Invalid operator config shape'
      USING ERRCODE = 'PT400';
  END IF;

  IF p_entitlement IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_entitlement) IS DISTINCT FROM 'object'
      OR NOT (p_entitlement ?& ARRAY[
        'billing_model', 'access_status', 'effective_tier', 'preferred_tier',
        'trial_started_at', 'trial_ends_at', 'access_ends_at'
      ])
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(p_entitlement) AS field(key)
        WHERE key NOT IN (
          'billing_model', 'access_status', 'effective_tier', 'preferred_tier',
          'trial_started_at', 'trial_ends_at', 'access_ends_at', 'revision'
        )
      ) THEN
      RAISE EXCEPTION 'Invalid entitlement shape'
        USING ERRCODE = 'PT400';
    END IF;

    v_billing_model := p_entitlement->>'billing_model';
    v_access_status := p_entitlement->>'access_status';
    v_effective_tier := p_entitlement->>'effective_tier';
    v_preferred_tier := p_entitlement->>'preferred_tier';
    IF v_billing_model IS NULL OR v_billing_model NOT IN ('subscription', 'setup')
      OR v_access_status IS NULL OR v_access_status NOT IN (
        'locked', 'trialing', 'active', 'past_due', 'canceling', 'expired', 'unpaid'
      )
      OR v_effective_tier IS NULL OR v_effective_tier NOT IN ('setup_only', 'pro', 'expert')
      OR v_preferred_tier IS NULL OR v_preferred_tier NOT IN ('pro', 'expert')
      OR pg_catalog.jsonb_typeof(p_entitlement->'trial_started_at') NOT IN ('null', 'string')
      OR pg_catalog.jsonb_typeof(p_entitlement->'trial_ends_at') NOT IN ('null', 'string')
      OR pg_catalog.jsonb_typeof(p_entitlement->'access_ends_at') NOT IN ('null', 'string') THEN
      RAISE EXCEPTION 'Invalid entitlement values'
        USING ERRCODE = 'PT400';
    END IF;

    IF v_billing_model = 'setup' THEN
      IF NOT (p_entitlement ? 'revision')
        OR pg_catalog.jsonb_typeof(p_entitlement->'revision') IS DISTINCT FROM 'number'
        OR (p_entitlement->>'revision')::NUMERIC < 0
        OR (p_entitlement->>'revision')::NUMERIC > 9007199254740991
        OR pg_catalog.trunc((p_entitlement->>'revision')::NUMERIC)
          <> (p_entitlement->>'revision')::NUMERIC
        OR v_access_status NOT IN ('active', 'locked')
        OR v_effective_tier <> 'setup_only'
        OR p_entitlement->'trial_started_at' IS DISTINCT FROM 'null'::JSONB
        OR p_entitlement->'trial_ends_at' IS DISTINCT FROM 'null'::JSONB
        OR p_entitlement->'access_ends_at' IS DISTINCT FROM 'null'::JSONB
        OR p_ai_billing_mode <> 'client_owned'
        OR p_modules->'voice_live' IS DISTINCT FROM 'false'::JSONB
        OR p_quota_config->'voice_live_minutes' IS DISTINCT FROM '0'::JSONB
        OR p_overflow_mode <> 'block' THEN
        RAISE EXCEPTION 'Invalid setup entitlement'
          USING ERRCODE = 'PT400';
      END IF;
      v_setup_revision := (p_entitlement->>'revision')::NUMERIC::BIGINT;
    ELSIF p_entitlement ? 'revision' THEN
      RAISE EXCEPTION 'Subscription entitlement cannot carry a setup revision'
        USING ERRCODE = 'PT400';
    END IF;

    BEGIN
      v_trial_started_at := CASE
        WHEN p_entitlement->'trial_started_at' = 'null'::JSONB THEN NULL
        ELSE (p_entitlement->>'trial_started_at')::TIMESTAMPTZ
      END;
      v_trial_ends_at := CASE
        WHEN p_entitlement->'trial_ends_at' = 'null'::JSONB THEN NULL
        ELSE (p_entitlement->>'trial_ends_at')::TIMESTAMPTZ
      END;
      v_access_ends_at := CASE
        WHEN p_entitlement->'access_ends_at' = 'null'::JSONB THEN NULL
        ELSE (p_entitlement->>'access_ends_at')::TIMESTAMPTZ
      END;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Invalid entitlement timestamp'
          USING ERRCODE = 'PT400';
    END;
  END IF;

  IF p_einvoicing_config IS NOT NULL THEN
    IF pg_catalog.jsonb_typeof(p_einvoicing_config) IS DISTINCT FROM 'object'
      OR NOT (p_einvoicing_config ?& ARRAY[
        'mode', 'provider', 'environment', 'annuaire_status', 'oauth_status',
        'oauth_connected_at', 'super_pdp_connection_id',
        'super_pdp_emission_enabled', 'super_pdp_reception_enabled'
      ])
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(p_einvoicing_config) AS field(key)
        WHERE key NOT IN (
          'mode', 'provider', 'environment', 'annuaire_status', 'oauth_status',
          'oauth_connected_at', 'super_pdp_connection_id',
          'super_pdp_emission_enabled', 'super_pdp_reception_enabled'
        )
      ) THEN
      RAISE EXCEPTION 'Invalid einvoicing config shape'
        USING ERRCODE = 'PT400';
    END IF;

    v_einvoicing_mode := p_einvoicing_config->>'mode';
    v_einvoicing_provider := p_einvoicing_config->>'provider';
    v_einvoicing_environment := p_einvoicing_config->>'environment';
    v_annuaire_status := p_einvoicing_config->>'annuaire_status';
    v_oauth_status := p_einvoicing_config->>'oauth_status';
    v_super_pdp_connection_id := p_einvoicing_config->>'super_pdp_connection_id';
    IF v_einvoicing_mode IS NULL OR v_einvoicing_mode NOT IN ('off', 'export_only', 'super_pdp')
      OR (p_einvoicing_config->'provider' IS DISTINCT FROM 'null'::JSONB
        AND (v_einvoicing_provider IS NULL OR v_einvoicing_provider NOT IN ('external_pa', 'super_pdp')))
      OR v_einvoicing_environment IS NULL OR v_einvoicing_environment NOT IN ('sandbox', 'production')
      OR v_annuaire_status IS NULL OR v_annuaire_status NOT IN ('not_started', 'pending', 'active', 'error')
      OR v_oauth_status IS NULL OR v_oauth_status NOT IN ('not_connected', 'pending', 'connected', 'error', 'revoked')
      OR (v_einvoicing_mode = 'off' AND p_einvoicing_config->'provider' IS DISTINCT FROM 'null'::JSONB)
      OR (v_einvoicing_mode = 'export_only' AND v_einvoicing_provider IS DISTINCT FROM 'external_pa')
      OR (v_einvoicing_mode = 'super_pdp' AND v_einvoicing_provider IS DISTINCT FROM 'super_pdp')
      OR pg_catalog.jsonb_typeof(p_einvoicing_config->'oauth_connected_at') NOT IN ('null', 'string')
      OR pg_catalog.jsonb_typeof(p_einvoicing_config->'super_pdp_connection_id') NOT IN ('null', 'string')
      OR pg_catalog.jsonb_typeof(p_einvoicing_config->'super_pdp_emission_enabled') IS DISTINCT FROM 'boolean'
      OR pg_catalog.jsonb_typeof(p_einvoicing_config->'super_pdp_reception_enabled') IS DISTINCT FROM 'boolean' THEN
      RAISE EXCEPTION 'Invalid einvoicing config values'
        USING ERRCODE = 'PT400';
    END IF;

    BEGIN
      v_oauth_connected_at := CASE
        WHEN p_einvoicing_config->'oauth_connected_at' = 'null'::JSONB THEN NULL
        ELSE (p_einvoicing_config->>'oauth_connected_at')::TIMESTAMPTZ
      END;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'Invalid einvoicing timestamp'
          USING ERRCODE = 'PT400';
    END;
    v_emission_enabled := (p_einvoicing_config->>'super_pdp_emission_enabled')::BOOLEAN;
    v_reception_enabled := (p_einvoicing_config->>'super_pdp_reception_enabled')::BOOLEAN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('atelier-operator-config:' || p_organization_id::TEXT, 0)
  );

  SELECT billing_model, access_status, setup_revision
  INTO v_current_billing_model, v_current_access_status, v_current_setup_revision
  FROM public.organization_entitlements
  WHERE organization_id = p_organization_id
  FOR UPDATE;

  IF v_current_billing_model = 'setup' THEN
    IF p_entitlement IS NULL
      OR v_billing_model <> 'setup'
      OR v_setup_revision < v_current_setup_revision
      OR (v_setup_revision = v_current_setup_revision
        AND v_access_status IS DISTINCT FROM v_current_access_status) THEN
      RAISE EXCEPTION 'A newer setup entitlement is already applied'
        USING ERRCODE = 'PT409';
    END IF;
  END IF;

  INSERT INTO public.organization_modules (
    organization_id, modules, quota_config, overflow_mode, ai_billing_mode,
    quota_synced_at, updated_at
  ) VALUES (
    p_organization_id, p_modules, p_quota_config, p_overflow_mode, p_ai_billing_mode,
    pg_catalog.now(), pg_catalog.now()
  )
  ON CONFLICT (organization_id) DO UPDATE SET
    modules = EXCLUDED.modules,
    quota_config = EXCLUDED.quota_config,
    overflow_mode = EXCLUDED.overflow_mode,
    ai_billing_mode = EXCLUDED.ai_billing_mode,
    quota_synced_at = EXCLUDED.quota_synced_at,
    updated_at = EXCLUDED.updated_at;

  IF p_einvoicing_config IS NOT NULL THEN
    INSERT INTO public.organization_einvoicing_config (
      organization_id, mode, provider, environment, annuaire_status,
      oauth_status, oauth_connected_at, super_pdp_connection_id,
      super_pdp_emission_enabled, super_pdp_reception_enabled, updated_at
    ) VALUES (
      p_organization_id, v_einvoicing_mode, v_einvoicing_provider,
      v_einvoicing_environment, v_annuaire_status, v_oauth_status,
      v_oauth_connected_at, v_super_pdp_connection_id,
      v_emission_enabled, v_reception_enabled, pg_catalog.now()
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      mode = EXCLUDED.mode,
      provider = EXCLUDED.provider,
      environment = EXCLUDED.environment,
      annuaire_status = EXCLUDED.annuaire_status,
      oauth_status = EXCLUDED.oauth_status,
      oauth_connected_at = EXCLUDED.oauth_connected_at,
      super_pdp_connection_id = EXCLUDED.super_pdp_connection_id,
      super_pdp_emission_enabled = EXCLUDED.super_pdp_emission_enabled,
      super_pdp_reception_enabled = EXCLUDED.super_pdp_reception_enabled,
      updated_at = EXCLUDED.updated_at;
  END IF;

  IF p_entitlement IS NOT NULL THEN
    INSERT INTO public.organization_entitlements (
      organization_id, billing_model, access_status, effective_tier, preferred_tier,
      trial_started_at, trial_ends_at, access_ends_at, setup_revision, updated_at
    ) VALUES (
      p_organization_id, v_billing_model, v_access_status, v_effective_tier,
      v_preferred_tier, v_trial_started_at, v_trial_ends_at, v_access_ends_at,
      CASE WHEN v_billing_model = 'setup' THEN v_setup_revision ELSE 0 END,
      pg_catalog.now()
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      billing_model = EXCLUDED.billing_model,
      access_status = EXCLUDED.access_status,
      effective_tier = EXCLUDED.effective_tier,
      preferred_tier = EXCLUDED.preferred_tier,
      trial_started_at = EXCLUDED.trial_started_at,
      trial_ends_at = EXCLUDED.trial_ends_at,
      access_ends_at = EXCLUDED.access_ends_at,
      setup_revision = CASE
        WHEN EXCLUDED.billing_model = 'setup' THEN EXCLUDED.setup_revision
        ELSE public.organization_entitlements.setup_revision
      END,
      updated_at = EXCLUDED.updated_at;
  END IF;

  RETURN 'applied';
END;
$$;

REVOKE ALL ON FUNCTION public.apply_operator_config(UUID, JSONB, JSONB, TEXT, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_operator_config(UUID, JSONB, JSONB, TEXT, TEXT, JSONB, JSONB)
  TO service_role;

NOTIFY pgrst, 'reload schema';
