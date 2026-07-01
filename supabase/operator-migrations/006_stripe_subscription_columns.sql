-- ============================================================
-- 006_stripe_subscription_columns.sql
--
-- Ajoute les colonnes Stripe dans operator_client_subscriptions
-- pour relier les événements webhook au bon client.
-- ============================================================

ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN IF NOT EXISTS stripe_customer_id      TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id  TEXT;

CREATE INDEX IF NOT EXISTS operator_client_subscriptions_stripe_sub_idx
  ON public.operator_client_subscriptions (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;
