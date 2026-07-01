-- 007_commercial_events_v2.sql
-- Étend operator_commercial_events pour le module emails cockpit :
-- alertes quota automatiques avec validation manuelle avant envoi auto.

ALTER TABLE public.operator_commercial_events
  ADD COLUMN IF NOT EXISTS delivery_status  TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS auto_send_after  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS body_text        TEXT,
  ADD COLUMN IF NOT EXISTS recipient_email  TEXT;

DO $$
BEGIN
  ALTER TABLE public.operator_commercial_events
    ADD CONSTRAINT operator_commercial_events_delivery_status_check
    CHECK (delivery_status IN ('sent', 'draft', 'pending_review', 'ignored', 'failed'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Backfill : les lignes existantes sans statut explicite = envoyées manuellement
UPDATE public.operator_commercial_events
  SET delivery_status = 'sent'
  WHERE delivery_status IS NULL OR delivery_status = '';

CREATE INDEX IF NOT EXISTS idx_operator_commercial_events_status_auto
  ON public.operator_commercial_events(delivery_status, auto_send_after)
  WHERE delivery_status = 'pending_review';
