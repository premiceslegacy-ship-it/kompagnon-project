-- Nouvelles mentions obligatoires au 1er sept. 2026 (réforme facturation électronique)

-- 1. SIREN du client sur la table clients
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS siren TEXT;

-- 2. Champs factures : type d'opération, TVA sur débits, adresse de livraison
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS operation_type TEXT CHECK (operation_type IN ('vente', 'prestation', 'mixte')) DEFAULT 'prestation',
  ADD COLUMN IF NOT EXISTS tva_sur_debits BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS delivery_address_line2 TEXT,
  ADD COLUMN IF NOT EXISTS delivery_city TEXT,
  ADD COLUMN IF NOT EXISTS delivery_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS delivery_country TEXT DEFAULT 'France';

COMMENT ON COLUMN public.clients.siren IS 'SIREN du client — obligatoire sur factures à partir du 01/09/2026';
COMMENT ON COLUMN public.invoices.operation_type IS 'Type d''opération (vente/prestation/mixte) — obligatoire 01/09/2026';
COMMENT ON COLUMN public.invoices.tva_sur_debits IS 'Option TVA sur les débits — obligatoire si applicable 01/09/2026';
COMMENT ON COLUMN public.invoices.delivery_address_line1 IS 'Adresse de livraison si différente de l''adresse de facturation — obligatoire 01/09/2026';
