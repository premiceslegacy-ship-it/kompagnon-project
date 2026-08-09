-- Cycle de vie SaaS mutualisé et prévention des essais répétés.

ALTER TABLE public.operator_client_settings
  ADD COLUMN IF NOT EXISTS contact_email TEXT,
  ADD COLUMN IF NOT EXISTS company_siret TEXT,
  ADD COLUMN IF NOT EXISTS signup_source TEXT;

ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN IF NOT EXISTS preferred_tier TEXT NOT NULL DEFAULT 'pro',
  ADD COLUMN IF NOT EXISTS access_status TEXT NOT NULL DEFAULT 'locked',
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS access_ends_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancel_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS stripe_status TEXT,
  ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_reminders_sent TEXT[] NOT NULL DEFAULT '{}';

-- Les lignes présentes avant cette migration sont des instances dédiées déjà
-- exploitées. Elles ne doivent pas apparaître comme verrouillées simplement à
-- cause de la valeur par défaut destinée aux futures inscriptions self-service.
UPDATE public.operator_client_subscriptions
SET
  preferred_tier = CASE WHEN tier = 'expert' THEN 'expert' ELSE 'pro' END,
  access_status = CASE
    WHEN trial_tier IS NOT NULL AND trial_ends_at > now() AND COALESCE(trial_converted, false) = false THEN 'trialing'
    WHEN is_active THEN 'active'
    ELSE 'expired'
  END
WHERE access_status = 'locked';

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_subscriptions_preferred_tier_check CHECK (preferred_tier IN ('pro','expert'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.operator_client_subscriptions
    ADD CONSTRAINT operator_subscriptions_access_status_check
    CHECK (access_status IN ('locked','trialing','active','past_due','canceling','expired','unpaid'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.operator_trial_claims (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_instance TEXT NOT NULL,
  organization_id UUID NOT NULL,
  email_fingerprint TEXT NOT NULL UNIQUE,
  siret_fingerprint TEXT NOT NULL UNIQUE,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB,
  UNIQUE (source_instance, organization_id)
);

ALTER TABLE public.operator_trial_claims ENABLE ROW LEVEL SECURITY;
