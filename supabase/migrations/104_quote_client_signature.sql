-- ============================================================
-- 104_quote_client_signature.sql
-- Signature manuscrite du client sur les devis via lien public.
-- Complète l'acceptation par clic existante avec nom/fonction/image.
-- ============================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS client_signature_image TEXT,
  ADD COLUMN IF NOT EXISTS client_signatory_name TEXT,
  ADD COLUMN IF NOT EXISTS client_signatory_role TEXT;

COMMENT ON COLUMN public.quotes.client_signature_image IS 'Signature manuscrite du client (data URL PNG base64) collectée depuis la page publique de signature du devis';
COMMENT ON COLUMN public.quotes.client_signatory_name IS 'Nom déclaré par le client lors de la signature du devis';
COMMENT ON COLUMN public.quotes.client_signatory_role IS 'Fonction déclarée par le client lors de la signature du devis';
