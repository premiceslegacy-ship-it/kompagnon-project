-- 138_organization_ai_billing_mode.sql
-- Mode de facturation IA local: clé Orsayn partagée ou clé OpenRouter propre au client.

ALTER TABLE public.organization_modules
  ADD COLUMN IF NOT EXISTS ai_billing_mode TEXT NOT NULL DEFAULT 'orsayn_shared';

DO $$
BEGIN
  ALTER TABLE public.organization_modules
    ADD CONSTRAINT organization_modules_ai_billing_mode_check
    CHECK (ai_billing_mode IN ('orsayn_shared', 'client_owned'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON COLUMN public.organization_modules.ai_billing_mode IS
  'orsayn_shared: quotas commerciaux Stripe/Orsayn. client_owned: clé OpenRouter client, quotas non bloquants.';
