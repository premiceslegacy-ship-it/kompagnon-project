-- ============================================================
-- 008 (operator) — Idempotence des webhooks entrants (correctif audit C5)
-- ------------------------------------------------------------
-- Faille : le webhook Stripe traitait chaque événement sans dédup. Stripe
-- redélivre (at-least-once, retries jusqu'à 3 jours) => un même
-- checkout.session.completed rejoué provoquait un double reset de quotas
-- cockpit et un double config-sync vers l'instance cliente.
--
-- Table append-only d'idempotence : (provider, source_id) UNIQUE.
-- Le handler insère l'event.id AVANT traitement ; si conflit => déjà traité.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.webhook_events (
  id            BIGSERIAL   PRIMARY KEY,
  provider      TEXT        NOT NULL,
  source_id     TEXT        NOT NULL,
  event_type    TEXT,
  status        TEXT        NOT NULL DEFAULT 'received',  -- received | success | failed
  error_msg     TEXT,
  received_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at  TIMESTAMPTZ,
  UNIQUE (provider, source_id)
);

-- Accès service_role uniquement (cockpit) : aucune policy pour authenticated.
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
