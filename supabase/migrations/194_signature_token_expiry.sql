-- ============================================================
-- 194 — Expiration des tokens de signature publics (audit 26/10/2026)
-- ------------------------------------------------------------
-- `quotes.signature_token` et `contracts.signature_token` sont des UUID sans
-- date d'expiration : un lien retrouvé dans une boîte mail ou un historique
-- de proxy donnait un accès permanent au PDF complet (IBAN, adresse,
-- signature manuscrite, nom du signataire), y compris après annulation.
--
-- Les tokens existants restent valides (colonne NULL = pas d'expiration
-- connue) ; tout nouveau token est borné à 60 jours.
-- ============================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS signature_token_expires_at TIMESTAMPTZ;
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS signature_token_expires_at TIMESTAMPTZ;

COMMENT ON COLUMN public.quotes.signature_token_expires_at IS
  'Fin de validité du lien public de signature/PDF. NULL = token historique sans borne.';
COMMENT ON COLUMN public.contracts.signature_token_expires_at IS
  'Fin de validité du lien public de signature/PDF. NULL = token historique sans borne.';
