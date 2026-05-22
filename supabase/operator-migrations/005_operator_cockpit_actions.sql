-- 005_operator_cockpit_actions.sql
-- Journal d'actions operateur et fondations CRM cockpit.

ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN IF NOT EXISTS trial_converted BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_billing_mode TEXT NOT NULL DEFAULT 'orsayn_shared';

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_client_subscriptions_ai_billing_mode_check
    CHECK (ai_billing_mode IN ('orsayn_shared', 'client_owned'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.operator_client_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance TEXT NOT NULL REFERENCES public.operator_client_settings(source_instance) ON DELETE CASCADE,
  event_category  TEXT NOT NULL,
  event_type      TEXT NOT NULL,
  actor_email     TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT operator_client_events_category_check
    CHECK (event_category IN ('subscription', 'trial', 'config_sync', 'einvoicing', 'module', 'crm', 'note'))
);

CREATE INDEX IF NOT EXISTS idx_operator_client_events_source_created
  ON public.operator_client_events(source_instance, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_operator_client_events_type_created
  ON public.operator_client_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.operator_commercial_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_instance TEXT NOT NULL REFERENCES public.operator_client_settings(source_instance) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  tier_context    TEXT,
  sent_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_by         TEXT NOT NULL DEFAULT 'operator_manual',
  actor_email     TEXT,
  email_template  TEXT,
  subject_preview TEXT,
  notes           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_operator_commercial_events_source_sent
  ON public.operator_commercial_events(source_instance, event_type, sent_at DESC);
