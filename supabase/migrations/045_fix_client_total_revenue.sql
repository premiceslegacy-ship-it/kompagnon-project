-- total_revenue = CA encaissé (factures payées uniquement)
CREATE OR REPLACE FUNCTION public.update_client_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE public.clients SET
    total_revenue = (
      SELECT COALESCE(SUM(total_ttc), 0)
      FROM public.invoices
      WHERE client_id = NEW.client_id
        AND status = 'paid'
        AND is_archived = false
    ),
    total_paid = (
      SELECT COALESCE(SUM(p.amount), 0)
      FROM public.payments p
      JOIN public.invoices i ON p.invoice_id = i.id
      WHERE i.client_id = NEW.client_id
    )
  WHERE id = NEW.client_id;
  RETURN NEW;
END;
$$;

-- Recalcul de tous les clients existants
UPDATE public.clients c
SET total_revenue = (
  SELECT COALESCE(SUM(total_ttc), 0)
  FROM public.invoices
  WHERE client_id = c.id
    AND status = 'paid'
    AND is_archived = false
);
