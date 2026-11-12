BEGIN;

-- One statement snapshot: preserve every receipt and its prior paid amount,
-- including receipts before the requested accounting period. JSON avoids the
-- REST row cap silently truncating a fiscal export.
CREATE FUNCTION public.get_accounting_payment_ledger(
  p_from DATE,
  p_to DATE,
  p_credit_note_ids UUID[] DEFAULT ARRAY[]::UUID[],
  p_include_payments BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_org_id UUID := public.get_user_org_id();
  v_requested_credits INTEGER;
  v_visible_credits INTEGER;
  v_payments JSONB;
  v_credits JSONB;
BEGIN
  IF v_org_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.memberships AS m
    JOIN public.roles AS r ON r.id = m.role_id AND r.organization_id = m.organization_id
    WHERE m.organization_id = v_org_id AND m.user_id = auth.uid()
      AND m.is_active IS TRUE AND r.slug IN ('owner', 'admin')
  ) THEN
    RAISE EXCEPTION 'Accès réservé aux administrateurs' USING ERRCODE = '42501';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RAISE EXCEPTION 'Période comptable invalide' USING ERRCODE = '22023';
  END IF;

  SELECT COUNT(DISTINCT id) INTO v_requested_credits
  FROM unnest(COALESCE(p_credit_note_ids, ARRAY[]::UUID[])) AS requested(id);
  SELECT COUNT(*) INTO v_visible_credits
  FROM public.invoices AS i
  WHERE i.organization_id = v_org_id AND i.id = ANY(p_credit_note_ids)
    AND i.invoice_type = 'avoir' AND i.issuance_snapshot IS NOT NULL
    AND i.status NOT IN ('draft', 'sending');
  IF v_visible_credits <> v_requested_credits THEN
    RAISE EXCEPTION 'Avoirs introuvables ou non vérifiés' USING ERRCODE = '42501';
  END IF;

  IF p_include_payments THEN
    WITH ledger AS (
      SELECT p.id, p.invoice_id, p.amount, p.payment_date, p.reference, p.created_at,
        COALESCE(SUM(p.amount) OVER (
          PARTITION BY p.invoice_id
          ORDER BY p.payment_date, p.created_at, p.id
          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
        ), 0) AS prior_paid_amount
      FROM public.payments AS p
      WHERE p.organization_id = v_org_id
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', l.id, 'invoice_id', l.invoice_id, 'amount', l.amount,
      'payment_date', l.payment_date, 'reference', l.reference,
      'prior_paid_amount', l.prior_paid_amount
    ) ORDER BY l.payment_date, l.created_at, l.id), '[]'::JSONB)
    INTO v_payments
    FROM ledger AS l WHERE l.payment_date BETWEEN p_from AND p_to;
  ELSE
    v_payments := '[]'::JSONB;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'source_invoice_id', i.credit_note_for, 'issue_date', i.issue_date,
    'paid_amount_before_credit', (
      SELECT COALESCE(SUM(p.amount), 0)
      FROM public.payments AS p
      WHERE p.organization_id = v_org_id AND p.invoice_id = i.credit_note_for
        AND p.payment_date <= i.issue_date
    )
  ) ORDER BY i.id), '[]'::JSONB)
  INTO v_credits
  FROM public.invoices AS i
  WHERE i.organization_id = v_org_id AND i.id = ANY(p_credit_note_ids);

  RETURN jsonb_build_object('payments', v_payments, 'credit_notes', v_credits);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_accounting_payment_ledger(DATE, DATE, UUID[], BOOLEAN)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_accounting_payment_ledger(DATE, DATE, UUID[], BOOLEAN)
  TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
