-- Direct authenticated invoice writes cannot create or rewrite receipt facts.
-- The existing lifecycle trigger continues to own permission decisions; this
-- invoker trigger only reserves payment counters and receipt states for trusted
-- server/RPC execution (where current_user is the definer role).
BEGIN;

CREATE OR REPLACE FUNCTION public.guard_invoice_payment_write_authority_v225()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.total_paid, 0) <> 0
       OR NEW.paid_at IS NOT NULL
       OR NEW.status IN ('partial', 'paid') THEN
      RAISE EXCEPTION 'Invoice receipt state requires an authorized server operation'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.total_paid IS DISTINCT FROM OLD.total_paid
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at THEN
    RAISE EXCEPTION 'Invoice receipt facts require an authorized server operation'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     AND (
       NEW.status IN ('partial', 'paid')
       OR (
         (OLD.status = 'paid' AND NEW.status <> 'cancelled')
         OR (OLD.status = 'partial' AND NEW.status NOT IN ('overdue', 'cancelled'))
       )
     ) THEN
    RAISE EXCEPTION 'Invoice receipt state requires an authorized server operation'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_invoice_payment_write_authority_v225()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_invoice_payment_write_authority_v225 ON public.invoices;
CREATE TRIGGER trg_invoice_payment_write_authority_v225
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_invoice_payment_write_authority_v225();

NOTIFY pgrst, 'reload schema';
COMMIT;
