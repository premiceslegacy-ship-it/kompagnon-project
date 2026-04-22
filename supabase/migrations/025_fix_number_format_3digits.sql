-- Migration 025 : Numérotation devis/factures sur 3 chiffres au lieu de 4
-- Format cible : DEV-2026-001 (au lieu de DEV-2026-0001)

CREATE OR REPLACE FUNCTION public.generate_quote_number(org_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  UPDATE public.organizations
  SET last_quote_number = last_quote_number + 1
  WHERE id = org_id
  RETURNING last_quote_number, quote_prefix INTO next_num, org_prefix;

  RETURN org_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_invoice_number(org_id UUID)
RETURNS TEXT
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

  RETURN org_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;
