-- Record a full invoice payment atomically with the invoice lifecycle update.
CREATE OR REPLACE FUNCTION public.mark_invoice_paid(p_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID;
  v_active_membership_count BIGINT;
  v_organization_id UUID;
  v_role_id UUID;
  v_invoice RECORD;
  v_payments_total NUMERIC(10, 2);
  v_already_paid NUMERIC(10, 2);
  v_amount_to_record NUMERIC(10, 2);
  v_total_paid NUMERIC(10, 2);
  v_paid_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Non authentifié.' USING ERRCODE = '42501';
  END IF;

  -- Match the app's single-current-membership contract; ambiguity fails closed.
  SELECT count(*), (array_agg(m.organization_id ORDER BY m.created_at, m.id))[1]
  INTO v_active_membership_count, v_organization_id
  FROM public.memberships AS m
  WHERE m.user_id = v_user_id
    AND m.is_active IS TRUE;

  IF v_active_membership_count <> 1 OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organisation active introuvable.' USING ERRCODE = '42501';
  END IF;

  -- Keep this lock before the invoice row lock; organization erasure takes the
  -- organization lock first as well.
  PERFORM 1
  FROM public.organizations AS o
  WHERE o.id = v_organization_id
    AND o.anonymized_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation indisponible.' USING ERRCODE = '42501';
  END IF;

  -- Re-check and stabilize this exact active organization membership after
  -- acquiring the organization lock. Reject a role inherited from another org.
  SELECT m.role_id
  INTO v_role_id
  FROM public.memberships AS m
  JOIN public.roles AS r
    ON r.id = m.role_id
   AND r.organization_id = m.organization_id
  WHERE m.user_id = v_user_id
    AND m.organization_id = v_organization_id
    AND m.is_active IS TRUE
  FOR SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appartenance active introuvable.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.role_permissions AS rp
    WHERE rp.role_id = v_role_id
      AND rp.permission_key = 'invoices.record_payment'
      AND rp.is_allowed IS TRUE
  ) THEN
    RAISE EXCEPTION 'Permission refusée.' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.number, i.title, i.currency, i.client_id, i.total_ttc,
         i.total_paid, i.paid_at, i.status
  INTO v_invoice
  FROM public.invoices AS i
  WHERE i.id = p_invoice_id
    AND i.organization_id = v_organization_id
  FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE = 'P0002';
  END IF;

  -- A paid row may be a trusted historical import. Preserve its stored date,
  -- including NULL, and never create a new payment or legal snapshot on retry.
  IF v_invoice.status = 'paid' THEN
    RETURN pg_catalog.jsonb_build_object(
      'changed', false,
      'amount_recorded', 0,
      'total_paid', COALESCE(v_invoice.total_paid, 0),
      'paid_at', v_invoice.paid_at,
      'invoice', pg_catalog.jsonb_build_object(
        'id', v_invoice.id,
        'number', v_invoice.number,
        'title', v_invoice.title,
        'currency', v_invoice.currency,
        'client_id', v_invoice.client_id,
        'total_ttc', v_invoice.total_ttc
      )
    );
  END IF;

  IF v_invoice.status IS DISTINCT FROM 'sent'
     AND v_invoice.status IS DISTINCT FROM 'partial' THEN
    RAISE EXCEPTION 'Cette facture ne peut pas être marquée comme payée.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(ROUND(SUM(p.amount), 2), 0)
  INTO v_payments_total
  FROM public.payments AS p
  WHERE p.invoice_id = v_invoice.id
    AND p.organization_id = v_organization_id;

  v_already_paid := GREATEST(
    v_payments_total,
    ROUND(COALESCE(v_invoice.total_paid, 0), 2)
  );
  v_amount_to_record := ROUND(
    GREATEST(0, COALESCE(v_invoice.total_ttc, 0) - v_already_paid),
    2
  );
  v_total_paid := ROUND(v_already_paid + v_amount_to_record, 2);
  v_paid_at := pg_catalog.clock_timestamp();

  IF v_amount_to_record > 0 THEN
    INSERT INTO public.payments (
      organization_id,
      invoice_id,
      client_id,
      amount,
      payment_date,
      method,
      notes,
      created_by
    ) VALUES (
      v_organization_id,
      v_invoice.id,
      v_invoice.client_id,
      v_amount_to_record,
      (v_paid_at AT TIME ZONE 'UTC')::DATE,
      'manual',
      'Paiement total enregistré depuis la liste des factures',
      v_user_id
    );
  END IF;

  UPDATE public.invoices AS i
  SET status = 'paid',
      total_paid = v_total_paid,
      paid_at = v_paid_at
  WHERE i.id = v_invoice.id
    AND i.organization_id = v_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La facture n''a pas pu être mise à jour.' USING ERRCODE = 'P0001';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'changed', true,
    'amount_recorded', v_amount_to_record,
    'total_paid', v_total_paid,
    'paid_at', v_paid_at,
    'invoice', pg_catalog.jsonb_build_object(
      'id', v_invoice.id,
      'number', v_invoice.number,
      'title', v_invoice.title,
      'currency', v_invoice.currency,
      'client_id', v_invoice.client_id,
      'total_ttc', v_invoice.total_ttc
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.mark_invoice_paid(UUID) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_invoice_paid(UUID) TO authenticated;
