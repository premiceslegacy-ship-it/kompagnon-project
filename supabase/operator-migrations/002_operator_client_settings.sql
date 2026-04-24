-- 002_operator_client_settings.sql
-- Configuration manuelle du cockpit Orsayn par client/source_instance

CREATE TABLE IF NOT EXISTS public.operator_client_settings (
  source_instance  TEXT PRIMARY KEY,
  label            TEXT,
  monthly_fee_ht   NUMERIC(12,2),
  billing_currency TEXT        NOT NULL DEFAULT 'EUR',
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_client_settings_currency_check
    CHECK (billing_currency IN ('EUR', 'USD'))
);

CREATE INDEX IF NOT EXISTS idx_operator_client_settings_active
  ON public.operator_client_settings(is_active, source_instance);
