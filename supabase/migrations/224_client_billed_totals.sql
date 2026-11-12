-- 224 — Keep client invoiced TTC independent of receipt activity.
BEGIN;

CREATE OR REPLACE FUNCTION public.client_billed_ttc_v224(
  p_organization_id UUID,
  p_client_id UUID
)
RETURNS NUMERIC
LANGUAGE SQL
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT COALESCE(SUM(
    CASE
      WHEN i.invoice_type = 'avoir' OR i.is_credit_note IS TRUE
        THEN -ABS(COALESCE(i.total_ttc, 0))
      ELSE COALESCE(i.total_ttc, 0)
    END
  ), 0)
  FROM public.invoices AS i
  WHERE i.organization_id = p_organization_id
    AND i.client_id = p_client_id
    AND (
      i.status IN ('sent', 'viewed', 'partial', 'paid', 'overdue')
      OR (i.status = 'cancelled' AND i.unissued_cancelled_at IS NULL)
    );
$function$;

-- This private, invoker-rights helper is called only while one of the
-- SECURITY DEFINER trigger functions is executing. Its ACL grants execution
-- only to those functions' actual definer owners; it does not grant clients a
-- direct path to the cross-tenant aggregate.
REVOKE ALL ON FUNCTION public.client_billed_ttc_v224(UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_client_totals()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  -- If a payment is reassigned, repair the former cache as well as the new one.
  IF TG_OP = 'UPDATE' THEN
    IF OLD.client_id IS DISTINCT FROM NEW.client_id
       OR OLD.organization_id IS DISTINCT FROM NEW.organization_id THEN
      UPDATE public.clients AS c
      SET total_revenue = public.client_billed_ttc_v224(OLD.organization_id, OLD.client_id),
          total_paid = (
            SELECT COALESCE(SUM(p.amount), 0)
            FROM public.payments AS p
            JOIN public.invoices AS i
              ON i.id = p.invoice_id
             AND i.organization_id = p.organization_id
            WHERE p.organization_id = OLD.organization_id
              AND i.client_id = OLD.client_id
          )
      WHERE c.id = OLD.client_id
        AND c.organization_id = OLD.organization_id;
    END IF;
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    UPDATE public.clients AS c
    SET total_revenue = public.client_billed_ttc_v224(NEW.organization_id, NEW.client_id),
        total_paid = (
          SELECT COALESCE(SUM(p.amount), 0)
          FROM public.payments AS p
          JOIN public.invoices AS i
            ON i.id = p.invoice_id
           AND i.organization_id = p.organization_id
          WHERE p.organization_id = NEW.organization_id
            AND i.client_id = NEW.client_id
        )
    WHERE c.id = NEW.client_id
      AND c.organization_id = NEW.organization_id;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_client_totals_from_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.client_id IS NOT NULL THEN
      UPDATE public.clients AS c
      SET total_revenue = public.client_billed_ttc_v224(OLD.organization_id, OLD.client_id)
      WHERE c.id = OLD.client_id
        AND c.organization_id = OLD.organization_id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.client_id IS DISTINCT FROM NEW.client_id
        OR OLD.organization_id IS DISTINCT FROM NEW.organization_id)
       AND OLD.client_id IS NOT NULL THEN
      UPDATE public.clients AS c
      SET total_revenue = public.client_billed_ttc_v224(OLD.organization_id, OLD.client_id)
      WHERE c.id = OLD.client_id
        AND c.organization_id = OLD.organization_id;
    END IF;
  END IF;

  IF NEW.client_id IS NOT NULL THEN
    UPDATE public.clients AS c
    SET total_revenue = public.client_billed_ttc_v224(NEW.organization_id, NEW.client_id)
    WHERE c.id = NEW.client_id
      AND c.organization_id = NEW.organization_id;
  END IF;

  RETURN NEW;
END;
$function$;

-- SECURITY INVOKER preserves each trigger's established SECURITY DEFINER
-- authority. Grant the helper only to those exact definer owners.
DO $helper_acl$
DECLARE
  v_function_count INTEGER;
  v_definer_count INTEGER;
  v_owner NAME;
BEGIN
  SELECT COUNT(*), COUNT(*) FILTER (WHERE p.prosecdef)
  INTO v_function_count, v_definer_count
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid IN (
    'public.update_client_totals()'::pg_catalog.regprocedure,
    'public.update_client_totals_from_invoice()'::pg_catalog.regprocedure
  );

  IF v_function_count <> 2 OR v_definer_count <> 2 THEN
    RAISE EXCEPTION 'Expected both client total trigger functions to be SECURITY DEFINER';
  END IF;

  FOR v_owner IN
    SELECT DISTINCT r.rolname
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
    WHERE p.oid IN (
      'public.update_client_totals()'::pg_catalog.regprocedure,
      'public.update_client_totals_from_invoice()'::pg_catalog.regprocedure
    )
      AND p.prosecdef
  LOOP
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION public.client_billed_ttc_v224(UUID, UUID) TO %I',
      v_owner
    );
  END LOOP;
END;
$helper_acl$;

DROP TRIGGER IF EXISTS trigger_update_client_totals_from_invoice ON public.invoices;
CREATE TRIGGER trigger_update_client_totals_from_invoice
  AFTER INSERT OR UPDATE OF organization_id, client_id, status, total_ttc,
    invoice_type, is_credit_note, unissued_cancelled_at
  OR DELETE
  ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_client_totals_from_invoice();

COMMENT ON FUNCTION public.client_billed_ttc_v224(UUID, UUID) IS
  'Private invoiced-TTC projection shared by both client cache triggers. Includes emitted statuses and legacy cancellations whose unissued provenance is absent; excludes sending/drafts and marked unissued cancellations; subtracts Avoirs. NULL issuance snapshots remain explicitly unverified historical inputs and are never synthesized here. Archived documents remain included.';

-- Repair existing cache values using the same convention as both triggers.
UPDATE public.clients AS c
SET total_revenue = public.client_billed_ttc_v224(c.organization_id, c.id);

NOTIFY pgrst, 'reload schema';
COMMIT;
