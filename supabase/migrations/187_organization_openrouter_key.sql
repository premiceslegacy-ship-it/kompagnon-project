-- 187_organization_openrouter_key.sql
-- Clé OpenRouter propre à une organisation (offre setup 3k en mutualisé,
-- ai_billing_mode = 'client_owned' sur organization_modules) — voir
-- DEPLOIEMENT_CLIENT.md, section "Clé OpenRouter par organisation".
--
-- Règle produit : pas de fallback entre les deux modes de facturation IA.
-- orsayn_shared utilise toujours OPENROUTER_API_KEY (Worker, clé Atelier
-- partagée) ; client_owned utilise toujours la clé de cette table, jamais un
-- repli sur la clé partagée.
--
-- Table séparée de organization_modules (pas une colonne dessus) : la policy
-- SELECT de organization_modules ("organization_modules_select") autorise
-- tout membre authentifié de l'organisation à lire toute la ligne, sans
-- permission particulière — inadapté à un secret, même chiffré (un membre
-- quelconque pourrait exfiltrer le ciphertext). Cette table n'a aucune
-- policy pour authenticated, sur le modèle de
-- supabase/operator-migrations/013_super_pdp_oauth_credentials.sql : seul
-- service_role (createAdminClient()) peut la lire, depuis callAI.ts.

CREATE TABLE IF NOT EXISTS public.organization_ai_credentials (
  organization_id       UUID        PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  openrouter_key_encrypted TEXT     NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

SELECT public.create_updated_at_trigger('organization_ai_credentials');

-- RLS activée sans aucune policy : bloque tout accès hors service_role
-- (createAdminClient()), y compris pour un rôle authenticated éventuel.
ALTER TABLE public.organization_ai_credentials ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.organization_ai_credentials IS
  'Clé OpenRouter chiffrée (AES-256-GCM, src/lib/crypto/secrets.ts) pour les organisations en ai_billing_mode = client_owned. Accessible uniquement via createAdminClient() côté serveur (callAI.ts). Jamais exposée au client anon, même pour le membre propriétaire.';

COMMENT ON COLUMN public.organization_ai_credentials.openrouter_key_encrypted IS
  'AES-256-GCM via src/lib/crypto/secrets.ts, clé de chiffrement = ORGANIZATION_AI_CREDENTIALS_ENCRYPTION_KEY (secret Worker, jamais en base).';
