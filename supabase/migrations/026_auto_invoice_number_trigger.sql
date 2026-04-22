-- Migration 026 : Trigger de génération automatique des numéros de factures
-- Identique au trigger 021 pour les devis.
-- Sans ce trigger, tout INSERT dans `invoices` échoue avec une erreur 400
-- car la colonne `number` est NOT NULL sans valeur par défaut.

-- 1. Fonction de génération du numéro (ex: FAC-2026-001)
CREATE OR REPLACE FUNCTION public.generate_invoice_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  UPDATE public.organizations
  SET last_invoice_number = last_invoice_number + 1
  WHERE id = org_id
  RETURNING last_invoice_number, invoice_prefix INTO next_num, org_prefix;

  RETURN COALESCE(org_prefix, 'FAC') || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;

-- 2. Fonction trigger
CREATE OR REPLACE FUNCTION public.auto_set_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF NEW.number IS NULL OR NEW.number = '' THEN
    NEW.number := public.generate_invoice_number(NEW.organization_id);
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Trigger BEFORE INSERT sur invoices
DROP TRIGGER IF EXISTS trigger_auto_invoice_number ON public.invoices;
CREATE TRIGGER trigger_auto_invoice_number
  BEFORE INSERT ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_set_invoice_number();

-- 4. Resynchroniser le compteur si des factures existent déjà
-- (évite les conflits UNIQUE sur number lors du premier INSERT après migration)
UPDATE organizations o
SET last_invoice_number = GREATEST(
  o.last_invoice_number,
  COALESCE((
    SELECT MAX(CAST(SPLIT_PART(i.number, '-', 3) AS INTEGER))
    FROM invoices i
    WHERE i.organization_id = o.id
      AND i.number ~ '^[A-Z]+-\d{4}-\d+$'
  ), 0)
);

