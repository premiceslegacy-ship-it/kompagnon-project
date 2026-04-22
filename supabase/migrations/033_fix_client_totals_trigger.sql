-- ============================================================
-- 033_fix_client_totals_trigger.sql
-- Correctif : mise à jour de total_revenue sur les clients
-- déclenchée par les changements de statut de factures
-- (en plus du trigger existant sur payments)
-- ============================================================

-- ----------------------------------------------------------
-- Nouvelle fonction déclenchée par les changements sur invoices
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_client_totals_from_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_client_id UUID;
BEGIN
  -- Utiliser NEW pour INSERT/UPDATE, OLD pour DELETE
  v_client_id := COALESCE(NEW.client_id, OLD.client_id);
  IF v_client_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  UPDATE public.clients SET
    total_revenue = (
      SELECT COALESCE(SUM(total_ttc), 0)
      FROM public.invoices
      WHERE client_id = v_client_id
        AND status NOT IN ('cancelled', 'refunded')
        AND is_archived = false
    )
  WHERE id = v_client_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ----------------------------------------------------------
-- Trigger sur invoices : déclenché après tout changement de statut
-- ou d'archivage (les deux champs qui influencent total_revenue)
-- ----------------------------------------------------------

DROP TRIGGER IF EXISTS trigger_update_client_totals_from_invoice ON public.invoices;

CREATE TRIGGER trigger_update_client_totals_from_invoice
  AFTER INSERT OR UPDATE OF status, is_archived, total_ttc, client_id OR DELETE
  ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_client_totals_from_invoice();

-- ----------------------------------------------------------
-- Correction des données existantes (one-shot)
-- Recalcule total_revenue pour tous les clients de l'org
-- ----------------------------------------------------------

UPDATE public.clients c
SET total_revenue = (
  SELECT COALESCE(SUM(i.total_ttc), 0)
  FROM public.invoices i
  WHERE i.client_id = c.id
    AND i.status NOT IN ('cancelled', 'refunded')
    AND i.is_archived = false
);
