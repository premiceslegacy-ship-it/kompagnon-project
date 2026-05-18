-- ============================================================
-- 085_contract_client_signature.sql
-- Signature manuscrite du client via un lien public sécurisé par
-- token. Le token est généré à la création du contrat et permet
-- au destinataire d'accéder à une page publique de signature.
-- ============================================================

ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS signature_token UUID UNIQUE DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS client_signature_image TEXT,
  ADD COLUMN IF NOT EXISTS client_signatory_name TEXT,
  ADD COLUMN IF NOT EXISTS client_signed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.contracts.signature_token IS 'Token UUID public permettant au destinataire d''accéder à la page de signature en ligne';
COMMENT ON COLUMN public.contracts.client_signature_image IS 'Signature manuscrite du destinataire (data URL PNG base64)';
COMMENT ON COLUMN public.contracts.client_signatory_name IS 'Nom déclaré par le destinataire lors de la signature en ligne';
COMMENT ON COLUMN public.contracts.client_signed_at IS 'Date de la signature électronique manuscrite du destinataire';

-- Backfill : génère un token pour les contrats existants qui n'en ont pas.
UPDATE public.contracts
   SET signature_token = gen_random_uuid()
 WHERE signature_token IS NULL;

CREATE INDEX IF NOT EXISTS idx_contracts_signature_token ON public.contracts(signature_token);

-- Politique RLS pour permettre la lecture/écriture publique uniquement via le
-- token. Les requêtes côté serveur utiliseront un client Supabase service-role
-- ou anon ; la sécurité est portée par la connaissance du token (UUID v4).
-- On expose une fonction RPC plutôt qu'une politique anon directe pour rester
-- explicite : la mutation passe par le code applicatif qui vérifie le token.
