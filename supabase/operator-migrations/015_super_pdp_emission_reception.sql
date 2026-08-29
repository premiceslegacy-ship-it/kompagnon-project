-- 015_super_pdp_emission_reception.sql
-- Miroir de supabase/migrations/176_super_pdp_emission_reception.sql (instance cliente).
-- Ajoute aussi l'etat du polling de reception, qui n'a pas d'equivalent instance : le
-- curseur de pagination Super PDP est un detail d'implementation du cockpit, jamais
-- expose au client.

ALTER TABLE public.operator_client_subscriptions
  ADD COLUMN IF NOT EXISTS super_pdp_emission_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS super_pdp_reception_enabled BOOLEAN NOT NULL DEFAULT false;

-- Etat du polling de reception par organisation cliente. Cle identique au reste du
-- modele multi-instance (source_instance, organization_id), cf.
-- super_pdp_oauth_credentials (013_super_pdp_oauth_credentials.sql).
CREATE TABLE IF NOT EXISTS public.super_pdp_reception_state (
  source_instance         TEXT        NOT NULL,
  organization_id         UUID        NOT NULL,
  last_synced_invoice_id  TEXT,
  last_polled_at          TIMESTAMPTZ,
  last_success_at         TIMESTAMPTZ,
  last_error              TEXT,
  consecutive_errors      INTEGER     NOT NULL DEFAULT 0,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_instance, organization_id)
);

-- RLS activee sans aucune policy : bloque tout acces hors service_role
-- (createOperatorAdminClient()), meme principe que super_pdp_oauth_credentials.
ALTER TABLE public.super_pdp_reception_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.super_pdp_reception_state IS
  'Curseur et observabilite du polling de reception Super PDP (toutes les 15 min, workers/operator-cron). RLS sans policy : service_role uniquement.';
COMMENT ON COLUMN public.operator_client_subscriptions.super_pdp_emission_enabled IS
  'Miroir de organization_einvoicing_config.super_pdp_emission_enabled, pour affichage/pilotage cockpit.';
COMMENT ON COLUMN public.operator_client_subscriptions.super_pdp_reception_enabled IS
  'Miroir de organization_einvoicing_config.super_pdp_reception_enabled, pour affichage/pilotage cockpit.';
