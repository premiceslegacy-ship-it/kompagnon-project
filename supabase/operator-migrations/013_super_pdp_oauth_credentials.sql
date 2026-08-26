-- 013_super_pdp_oauth_credentials.sql
-- Tokens OAuth Super PDP par organisation cliente, detenus uniquement cote cockpit.
-- L'application OAuth est portee par une seule "Entreprise" (Orsayn) chez Super PDP :
-- c'est donc le cockpit, pas chaque instance cliente, qui detient et rafraichit les tokens.
-- Aucune replication de token brut ou chiffre vers les instances clientes.

-- organization_id est un UUID genere independamment sur chaque instance Supabase
-- cliente (pas un identifiant global coordonne) : la PK est donc (source_instance,
-- organization_id), comme le reste du modele multi-instance depuis
-- 009_multi_org_per_instance.sql (operator_client_settings/operator_client_subscriptions).
CREATE TABLE IF NOT EXISTS public.super_pdp_oauth_credentials (
  source_instance          TEXT        NOT NULL,
  organization_id          UUID        NOT NULL,
  access_token_encrypted   TEXT        NOT NULL,
  refresh_token_encrypted  TEXT        NOT NULL,
  token_expires_at         TIMESTAMPTZ NOT NULL,
  scopes                   TEXT[],
  environment              TEXT        NOT NULL DEFAULT 'sandbox',
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_instance, organization_id)
);

DO $$
BEGIN
  ALTER TABLE public.super_pdp_oauth_credentials
    ADD CONSTRAINT super_pdp_oauth_credentials_environment_check
    CHECK (environment IN ('sandbox', 'production'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- RLS activee sans aucune policy : bloque tout acces hors service_role
-- (createOperatorAdminClient()), y compris pour un role authenticated eventuel.
ALTER TABLE public.super_pdp_oauth_credentials ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.super_pdp_oauth_credentials IS
  'Tokens OAuth Super PDP chiffres (AES-256-GCM, src/lib/crypto/secrets.ts), accessibles uniquement via createOperatorAdminClient() cote cockpit. Jamais lus par les instances clientes.';
