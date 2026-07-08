-- ============================================================
-- 158 — Immutabilité des factures émises (correctif audit C3 / C7)
-- ------------------------------------------------------------
-- Faille : une facture status != 'draft' pouvait être réécrite (montants,
-- client, numéro) car invoices_update ne filtrait que organization_id et
-- saveInvoiceItems supprimait/réinsérait les lignes sans vérifier le statut.
-- Violation de l'intangibilité des factures (CGI art. 289, NF203).
--
-- Correctif :
--  1. Trigger : une fois émise (status != 'draft'), les colonnes légales/
--     financières d'une facture sont gelées. Le statut, le paiement et les
--     champs de facturation électronique restent modifiables (cycle de vie).
--  2. Trigger : les lignes d'une facture émise ne peuvent plus être
--     insérées / modifiées / supprimées.
--  3. DELETE physique restreint aux brouillons. Une facture émise se corrige
--     par un avoir (contre-document), jamais par suppression.
--     Les devis restent plus souples (documents commerciaux, non probants).
-- ============================================================

-- 1. Gel des colonnes financières après émission
CREATE OR REPLACE FUNCTION public.enforce_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    IF (NEW.number, NEW.client_id, NEW.total_ht, NEW.total_tva, NEW.total_ttc, NEW.issue_date)
       IS DISTINCT FROM
       (OLD.number, OLD.client_id, OLD.total_ht, OLD.total_tva, OLD.total_ttc, OLD.issue_date)
    THEN
      RAISE EXCEPTION 'Facture émise immuable (statut %) : corriger par un avoir, pas par modification', OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoice_immutability ON public.invoices;
CREATE TRIGGER trg_enforce_invoice_immutability
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invoice_immutability();

-- 2. Gel des lignes après émission (couvre le DELETE+INSERT de saveInvoiceItems)
CREATE OR REPLACE FUNCTION public.enforce_invoice_items_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM public.invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  -- v_status NULL => facture inexistante ou en cours de suppression cascade (brouillon) : autorisé
  IF v_status IS NOT NULL AND v_status <> 'draft' THEN
    RAISE EXCEPTION 'Lignes de facture immuables : la facture n''est plus en brouillon (statut %)', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoice_items_immutability ON public.invoice_items;
CREATE TRIGGER trg_enforce_invoice_items_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invoice_items_immutability();

REVOKE ALL ON FUNCTION public.enforce_invoice_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_invoice_items_immutability() FROM PUBLIC;

-- 3. DELETE physique des factures restreint aux brouillons
DROP POLICY IF EXISTS "invoices_delete" ON public.invoices;
CREATE POLICY "invoices_delete"
  ON public.invoices FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.delete')
    AND status = 'draft'
  );
