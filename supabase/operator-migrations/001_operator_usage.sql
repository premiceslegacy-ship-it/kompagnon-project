-- 001_operator_usage.sql
-- Schema minimal pour le cockpit prive Orsayn (base operateur separee)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.operator_clients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance TEXT        NOT NULL,
  organization_id UUID        NOT NULL,
  label           TEXT,
  metadata        JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_clients_source_instance_org_unique
    UNIQUE (source_instance, organization_id)
);

CREATE TABLE IF NOT EXISTS public.operator_usage_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance    TEXT           NOT NULL,
  organization_id    UUID           NOT NULL,
  occurred_at        TIMESTAMPTZ    NOT NULL,
  provider           TEXT           NOT NULL,
  feature            TEXT           NOT NULL,
  model              TEXT           NOT NULL,
  provider_cost      NUMERIC(12,6),
  currency           TEXT           NOT NULL DEFAULT 'USD',
  total_tokens       INTEGER,
  status             TEXT           NOT NULL,
  local_usage_log_id UUID           NOT NULL,
  metadata           JSONB,
  ingested_at        TIMESTAMPTZ    NOT NULL DEFAULT now(),
  CONSTRAINT operator_usage_events_source_log_unique
    UNIQUE (source_instance, local_usage_log_id)
);

CREATE TABLE IF NOT EXISTS public.operator_whatsapp_cost_snapshots (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance TEXT           NOT NULL,
  waba_id        TEXT,
  period_start   DATE            NOT NULL,
  period_end     DATE            NOT NULL,
  currency       TEXT            NOT NULL DEFAULT 'USD',
  total_cost     NUMERIC(12,6),
  raw_payload    JSONB,
  created_at     TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operator_usage_events_occurred_at
  ON public.operator_usage_events(occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_usage_events_source_instance
  ON public.operator_usage_events(source_instance, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_usage_events_provider_feature
  ON public.operator_usage_events(provider, feature, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_whatsapp_cost_snapshots_period
  ON public.operator_whatsapp_cost_snapshots(period_start DESC, period_end DESC);
