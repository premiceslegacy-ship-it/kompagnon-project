-- 083_organization_quota_config.sql
-- Copie locale des quotas commerciaux appliques avant les appels IA.

ALTER TABLE public.organization_modules
  ADD COLUMN IF NOT EXISTS quota_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS overflow_mode TEXT NOT NULL DEFAULT 'block',
  ADD COLUMN IF NOT EXISTS quota_synced_at TIMESTAMPTZ;

DO $$
BEGIN
  ALTER TABLE public.organization_modules
    ADD CONSTRAINT organization_modules_quota_config_object
    CHECK (jsonb_typeof(quota_config) = 'object');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.organization_modules
    ADD CONSTRAINT organization_modules_overflow_mode_check
    CHECK (overflow_mode IN ('block', 'upgrade_prompt', 'charge'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.usage_logs
  ADD COLUMN IF NOT EXISTS quota_feature TEXT,
  ADD COLUMN IF NOT EXISTS quota_unit TEXT,
  ADD COLUMN IF NOT EXISTS quota_quantity NUMERIC(12,2) NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS overflow_mode TEXT,
  ADD COLUMN IF NOT EXISTS over_quota BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  ALTER TABLE public.usage_logs
    ADD CONSTRAINT usage_logs_quota_unit_check
    CHECK (quota_unit IS NULL OR quota_unit IN ('call', 'document', 'message', 'minute'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.usage_logs
    ADD CONSTRAINT usage_logs_overflow_mode_check
    CHECK (overflow_mode IS NULL OR overflow_mode IN ('block', 'upgrade_prompt', 'charge'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_usage_logs_org_quota_created
  ON public.usage_logs(organization_id, quota_feature, created_at DESC)
  WHERE quota_feature IS NOT NULL;
