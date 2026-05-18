-- 003_operator_subscriptions_quotas.sql
-- Abonnements, quotas commerciaux et compteur idempotent pour le cockpit Orsayn.

ALTER TABLE public.operator_client_settings
  ADD COLUMN IF NOT EXISTS app_url TEXT,
  ADD COLUMN IF NOT EXISTS config_sync_status TEXT NOT NULL DEFAULT 'pending_manual',
  ADD COLUMN IF NOT EXISTS config_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS config_sync_error TEXT;

DO $$
BEGIN
  ALTER TABLE public.operator_client_settings
    ADD CONSTRAINT operator_client_settings_config_sync_status_check
    CHECK (config_sync_status IN ('pending_manual', 'pending', 'synced', 'failed', 'skipped'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.operator_usage_events
  ADD COLUMN IF NOT EXISTS quota_feature TEXT,
  ADD COLUMN IF NOT EXISTS quota_unit TEXT,
  ADD COLUMN IF NOT EXISTS quota_quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS overflow_mode TEXT,
  ADD COLUMN IF NOT EXISTS over_quota BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.operator_client_subscriptions (
  source_instance  TEXT PRIMARY KEY REFERENCES public.operator_client_settings(source_instance) ON DELETE CASCADE,
  tier             TEXT NOT NULL DEFAULT 'setup_only',
  mrr_ht           NUMERIC(12,2),
  billing_currency TEXT NOT NULL DEFAULT 'EUR',
  is_active        BOOLEAN NOT NULL DEFAULT true,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  renews_at        TIMESTAMPTZ,
  trial_tier       TEXT,
  trial_ends_at    TIMESTAMPTZ,
  b2brouter_active BOOLEAN NOT NULL DEFAULT false,
  overflow_mode    TEXT NOT NULL DEFAULT 'block',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_client_subscriptions_tier_check
    CHECK (tier IN ('setup_only', 'starter', 'pro', 'expert')),
  CONSTRAINT operator_client_subscriptions_trial_tier_check
    CHECK (trial_tier IS NULL OR trial_tier IN ('setup_only', 'starter', 'pro', 'expert')),
  CONSTRAINT operator_client_subscriptions_currency_check
    CHECK (billing_currency IN ('EUR', 'USD')),
  CONSTRAINT operator_client_subscriptions_overflow_check
    CHECK (overflow_mode IN ('block', 'upgrade_prompt', 'charge'))
);

CREATE INDEX IF NOT EXISTS idx_operator_client_subscriptions_active
  ON public.operator_client_subscriptions(is_active, tier, source_instance);

CREATE TABLE IF NOT EXISTS public.operator_client_quotas (
  id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_instance  TEXT NOT NULL REFERENCES public.operator_client_settings(source_instance) ON DELETE CASCADE,
  quota_feature    TEXT NOT NULL,
  quota_unit       TEXT NOT NULL DEFAULT 'call',
  quota_monthly    NUMERIC(12,2) NOT NULL DEFAULT -1,
  current_quantity NUMERIC(12,2) NOT NULL DEFAULT 0,
  current_cost_eur NUMERIC(12,4) NOT NULL DEFAULT 0,
  period_start     DATE NOT NULL DEFAULT date_trunc('month', now())::date,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_client_quotas_unit_check
    CHECK (quota_unit IN ('call', 'document', 'message', 'minute')),
  CONSTRAINT operator_client_quotas_unique
    UNIQUE (source_instance, quota_feature, period_start)
);

CREATE INDEX IF NOT EXISTS idx_operator_client_quotas_source_period
  ON public.operator_client_quotas(source_instance, period_start);

CREATE TABLE IF NOT EXISTS public.operator_quota_usage_events (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_instance    TEXT NOT NULL REFERENCES public.operator_client_settings(source_instance) ON DELETE CASCADE,
  local_usage_log_id UUID NOT NULL,
  quota_feature      TEXT NOT NULL,
  quota_unit         TEXT NOT NULL DEFAULT 'call',
  quantity           NUMERIC(12,2) NOT NULL DEFAULT 1,
  cost_eur           NUMERIC(12,4) NOT NULL DEFAULT 0,
  period_start       DATE NOT NULL,
  occurred_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_quota_usage_events_unit_check
    CHECK (quota_unit IN ('call', 'document', 'message', 'minute')),
  CONSTRAINT operator_quota_usage_events_unique
    UNIQUE (source_instance, local_usage_log_id, quota_feature)
);

CREATE INDEX IF NOT EXISTS idx_operator_quota_usage_events_source_period
  ON public.operator_quota_usage_events(source_instance, period_start);

CREATE OR REPLACE FUNCTION public.increment_quota_counter(
  p_source_instance TEXT,
  p_local_usage_log_id UUID,
  p_quota_feature TEXT,
  p_quota_unit TEXT,
  p_quantity NUMERIC,
  p_cost_eur NUMERIC,
  p_period_start DATE,
  p_occurred_at TIMESTAMPTZ DEFAULT NULL
) RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.operator_quota_usage_events (
    source_instance,
    local_usage_log_id,
    quota_feature,
    quota_unit,
    quantity,
    cost_eur,
    period_start,
    occurred_at
  )
  VALUES (
    p_source_instance,
    p_local_usage_log_id,
    p_quota_feature,
    COALESCE(p_quota_unit, 'call'),
    COALESCE(p_quantity, 1),
    COALESCE(p_cost_eur, 0),
    p_period_start,
    p_occurred_at
  )
  ON CONFLICT (source_instance, local_usage_log_id, quota_feature) DO NOTHING;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO public.operator_client_quotas (
    source_instance,
    quota_feature,
    quota_unit,
    quota_monthly,
    current_quantity,
    current_cost_eur,
    period_start,
    updated_at
  )
  VALUES (
    p_source_instance,
    p_quota_feature,
    COALESCE(p_quota_unit, 'call'),
    -1,
    COALESCE(p_quantity, 1),
    COALESCE(p_cost_eur, 0),
    p_period_start,
    now()
  )
  ON CONFLICT (source_instance, quota_feature, period_start)
  DO UPDATE SET
    quota_unit       = EXCLUDED.quota_unit,
    current_quantity = public.operator_client_quotas.current_quantity + EXCLUDED.current_quantity,
    current_cost_eur = public.operator_client_quotas.current_cost_eur + EXCLUDED.current_cost_eur,
    updated_at       = now();

  RETURN true;
END;
$$;
