-- Revoke legacy public signature capabilities that have no recorded expiry.
-- Legal signature fields and generated document snapshots remain untouched.

BEGIN;
-- Trusted one-off migration path for the signed-quote token metadata guard.
SELECT set_config('request.jwt.claim.role', 'service_role', true);


UPDATE public.quotes
SET signature_token = NULL,
    signature_token_expires_at = NULL
WHERE signature_token IS NOT NULL
  AND signature_token_expires_at IS NULL;

UPDATE public.contracts
SET signature_token = NULL,
    signature_token_expires_at = NULL
WHERE signature_token IS NOT NULL
  AND signature_token_expires_at IS NULL;

COMMENT ON COLUMN public.quotes.signature_token_expires_at IS
  'Fin de validité du lien public. NULL = aucun lien actif; les anciens tokens sans borne ont été révoqués.';
COMMENT ON COLUMN public.contracts.signature_token_expires_at IS
  'Fin de validité du lien public. NULL = aucun lien actif; les anciens tokens sans borne ont été révoqués.';

COMMIT;
