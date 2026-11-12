-- Keep invoice payment recording atomic while preserving payment-form metadata,
-- and bound every scheduled payment by both its schedule and invoice balances.

BEGIN;

-- Nominal line VAT uses the same cent-rounded basis as document totals.
-- Invoice-level franchise/reverse-charge treatment is frozen at issuance.
CREATE OR REPLACE FUNCTION public.compute_vat_amount()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $function$
BEGIN
  NEW.vat_amount := ROUND(
    ROUND(COALESCE(NEW.unit_price, 0) * COALESCE(NEW.quantity, 0), 2)
      * COALESCE(NEW.vat_rate, 0) / 100,
    2
  );
  RETURN NEW;
END;
$function$;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'invoice_payment_schedule_id_invoice_org_key'
      AND conrelid = 'public.invoice_payment_schedule'::pg_catalog.regclass
  ) THEN
    ALTER TABLE public.invoice_payment_schedule
      ADD CONSTRAINT invoice_payment_schedule_id_invoice_org_key
      UNIQUE (id, invoice_id, organization_id);
  END IF;
END;
$constraint$;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS payment_schedule_id UUID;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conname = 'payments_schedule_invoice_org_fkey'
      AND conrelid = 'public.payments'::pg_catalog.regclass
  ) THEN
    ALTER TABLE public.payments
      ADD CONSTRAINT payments_schedule_invoice_org_fkey
      FOREIGN KEY (payment_schedule_id, invoice_id, organization_id)
      REFERENCES public.invoice_payment_schedule (id, invoice_id, organization_id)
      ON DELETE NO ACTION;
  END IF;
END;
$constraint$;

CREATE INDEX IF NOT EXISTS idx_payments_schedule_invoice_org
  ON public.payments (payment_schedule_id, invoice_id, organization_id)
  WHERE payment_schedule_id IS NOT NULL;

-- Preserve only previously explicit, same-invoice/same-organization schedule links.
UPDATE public.payments AS p
SET payment_schedule_id = s.id
FROM public.invoice_payment_schedule AS s
WHERE s.paid_payment_id = p.id
  AND p.payment_schedule_id IS NULL
  AND p.invoice_id = s.invoice_id
  AND p.organization_id = s.organization_id;

-- Payment writes are owned by the locked server-side RPCs; direct table DML
-- must not bypass their balance and schedule-ledger invariants.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payments FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS payments_org_member ON public.payments;
DROP POLICY IF EXISTS payments_insert ON public.payments;
DROP POLICY IF EXISTS payments_update ON public.payments;
DROP POLICY IF EXISTS payments_delete ON public.payments;


CREATE FUNCTION public.invoice_credited_ttc_v218(
  p_organization_id UUID,
  p_invoice_id UUID
)
RETURNS NUMERIC(10,2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_total NUMERIC(10,2);
BEGIN
  IF p_organization_id IS NULL OR p_invoice_id IS NULL THEN
    RAISE EXCEPTION 'Une facture et une organisation sont requises pour vérifier les avoirs émis.' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.invoices AS cn
    WHERE cn.organization_id = p_organization_id
      AND cn.credit_note_for = p_invoice_id
      AND cn.invoice_type = 'avoir'
      AND (
        cn.status IN ('sent', 'viewed', 'partial', 'paid', 'overdue')
        OR (cn.status = 'cancelled' AND cn.unissued_cancelled_at IS NULL)
      )
      AND (
        cn.issuance_snapshot IS NULL
        OR cn.issuance_snapshot->>'schema_version' IS DISTINCT FROM '1'
        OR cn.issuance_snapshot #>> '{invoice,id}' IS DISTINCT FROM cn.id::TEXT
        OR cn.issuance_snapshot #>> '{invoice,invoice_type}' IS DISTINCT FROM 'avoir'
        OR cn.issuance_snapshot #>> '{invoice,credit_note_for}' IS DISTINCT FROM p_invoice_id::TEXT
        OR cn.issuance_snapshot #>> '{invoice,number}' IS DISTINCT FROM cn.number
        OR cn.issuance_snapshot #>> '{invoice,issue_date}' IS DISTINCT FROM cn.issue_date::TEXT
        OR NULLIF(cn.issuance_snapshot #>> '{invoice,total_ht}', '') IS NULL
        OR NULLIF(cn.issuance_snapshot #>> '{invoice,total_tva}', '') IS NULL
        OR NULLIF(cn.issuance_snapshot #>> '{invoice,total_ttc}', '') IS NULL
        OR ROUND(NULLIF(cn.issuance_snapshot #>> '{invoice,total_ht}', '')::NUMERIC, 2)
             IS DISTINCT FROM ROUND(COALESCE(cn.total_ht, 0), 2)
        OR ROUND(NULLIF(cn.issuance_snapshot #>> '{invoice,total_tva}', '')::NUMERIC, 2)
             IS DISTINCT FROM ROUND(COALESCE(cn.total_tva, 0), 2)
        OR ROUND(NULLIF(cn.issuance_snapshot #>> '{invoice,total_ttc}', '')::NUMERIC, 2)
             IS DISTINCT FROM ROUND(COALESCE(cn.total_ttc, 0), 2)
      )
  ) THEN
    RAISE EXCEPTION 'Un avoir émis ne possède pas d’autorité vérifiable.' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(
    ROUND(SUM(NULLIF(cn.issuance_snapshot #>> '{invoice,total_ttc}', '')::NUMERIC), 2),
    0
  )
  INTO v_total
  FROM public.invoices AS cn
  WHERE cn.organization_id = p_organization_id
    AND cn.credit_note_for = p_invoice_id
    AND cn.invoice_type = 'avoir'
    AND (
      cn.status IN ('sent', 'viewed', 'partial', 'paid', 'overdue')
      OR (cn.status = 'cancelled' AND cn.unissued_cancelled_at IS NULL)
    );

  RETURN v_total;
END;
$function$;
REVOKE ALL ON FUNCTION public.invoice_credited_ttc_v218(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;


DROP FUNCTION IF EXISTS public.mark_invoice_paid(UUID);

CREATE FUNCTION public.mark_invoice_paid(
  p_invoice_id UUID,
  p_payment_date DATE DEFAULT NULL,
  p_method TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID;
  v_active_membership_count BIGINT;
  v_organization_id UUID;
  v_invoice RECORD;
  v_payments_total NUMERIC(10, 2);
  v_credited_ttc NUMERIC(10, 2);
  v_already_paid NUMERIC(10, 2);
  v_amount_to_record NUMERIC(10, 2);
  v_total_paid NUMERIC(10, 2);
  v_paid_at TIMESTAMPTZ;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Non authentifié.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), (array_agg(m.organization_id ORDER BY m.created_at, m.id))[1]
  INTO v_active_membership_count, v_organization_id
  FROM public.memberships AS m
  WHERE m.user_id = v_user_id
    AND m.is_active IS TRUE;

  IF v_active_membership_count <> 1 OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organisation active introuvable.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.organizations AS o
  WHERE o.id = v_organization_id
    AND o.anonymized_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation indisponible.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
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

  IF NOT public.user_has_permission('invoices.record_payment') THEN
    RAISE EXCEPTION 'Permission refusée.' USING ERRCODE = '42501';
  END IF;

  SELECT i.id, i.number, i.title, i.currency, i.client_id, i.total_ttc,
         i.total_paid, i.paid_at, i.status, i.invoice_type
  INTO v_invoice
  FROM public.invoices AS i
  WHERE i.id = p_invoice_id
    AND i.organization_id = v_organization_id
  FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.invoice_type = 'avoir' THEN
    RAISE EXCEPTION 'Un avoir ne peut pas recevoir de paiement.' USING ERRCODE = '22023';
  END IF;

  v_credited_ttc := public.invoice_credited_ttc_v218(v_organization_id, v_invoice.id);
  IF v_invoice.status IS DISTINCT FROM 'paid'
     AND COALESCE(v_invoice.total_ttc, 0) > 0
     AND v_credited_ttc >= ROUND(v_invoice.total_ttc, 2) THEN
    RAISE EXCEPTION 'Cette facture est entièrement compensée par des avoirs émis.' USING ERRCODE = '22023';
  END IF;


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
     AND v_invoice.status IS DISTINCT FROM 'viewed'
     AND v_invoice.status IS DISTINCT FROM 'overdue'
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
    GREATEST(0, COALESCE(v_invoice.total_ttc, 0) - v_already_paid - v_credited_ttc),
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
      reference,
      notes,
      created_by
    ) VALUES (
      v_organization_id,
      v_invoice.id,
      v_invoice.client_id,
      v_amount_to_record,
      COALESCE(p_payment_date, (v_paid_at AT TIME ZONE 'Europe/Paris')::DATE),
      COALESCE(NULLIF(BTRIM(p_method), ''), 'manual'),
      NULLIF(BTRIM(p_reference), ''),
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

REVOKE ALL ON FUNCTION public.mark_invoice_paid(UUID, DATE, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_invoice_paid(UUID, DATE, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_invoice_schedule_payment(
  p_invoice_id UUID,
  p_schedule_item_id UUID,
  p_amount NUMERIC,
  p_payment_date DATE,
  p_method TEXT DEFAULT NULL,
  p_reference TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID;
  v_active_membership_count BIGINT;
  v_organization_id UUID;
  v_invoice RECORD;
  v_schedule RECORD;
  v_payment_id UUID;
  v_payments_total NUMERIC(10, 2);
  v_already_paid NUMERIC(10, 2);
  v_credited_ttc NUMERIC(10, 2);
  v_schedule_amount NUMERIC(10, 2);
  v_schedule_paid NUMERIC(10, 2);
  v_schedule_remaining NUMERIC(10, 2);
  v_schedule_completed BOOLEAN;
  v_invoice_outstanding NUMERIC(10, 2);
  v_total_paid NUMERIC(10, 2);
  v_status TEXT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Non authentifié.' USING ERRCODE = '42501';
  END IF;

  SELECT count(*), (array_agg(m.organization_id ORDER BY m.created_at, m.id))[1]
  INTO v_active_membership_count, v_organization_id
  FROM public.memberships AS m
  WHERE m.user_id = v_user_id
    AND m.is_active IS TRUE;

  IF v_active_membership_count <> 1 OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organisation active introuvable.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
  FROM public.organizations AS o
  WHERE o.id = v_organization_id
    AND o.anonymized_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation indisponible.' USING ERRCODE = '42501';
  END IF;

  PERFORM 1
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

  IF NOT public.user_has_permission('invoices.record_payment') THEN
    RAISE EXCEPTION 'Permission refusée.' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 OR p_amount <> ROUND(p_amount, 2) THEN
    RAISE EXCEPTION 'Le montant encaissé doit être positif et exprimé au centime.' USING ERRCODE = '22023';
  END IF;

  -- Lock the invoice first. All scheduled-payment calls for one invoice then
  -- serialize before reading either outstanding balance.
  SELECT i.id, i.organization_id, i.client_id, i.total_ttc, i.total_paid, i.status, i.invoice_type
  INTO v_invoice
  FROM public.invoices AS i
  WHERE i.id = p_invoice_id
    AND i.organization_id = v_organization_id
  FOR UPDATE OF i;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice.invoice_type = 'avoir' THEN
    RAISE EXCEPTION 'Un avoir ne peut pas recevoir de paiement.' USING ERRCODE = '22023';
  END IF;

  v_credited_ttc := public.invoice_credited_ttc_v218(v_organization_id, v_invoice.id);
  IF COALESCE(v_invoice.total_ttc, 0) > 0
     AND v_credited_ttc >= ROUND(v_invoice.total_ttc, 2) THEN
    RAISE EXCEPTION 'Cette facture est entièrement compensée par des avoirs émis.' USING ERRCODE = '22023';
  END IF;


  IF v_invoice.status IS DISTINCT FROM 'sent'
     AND v_invoice.status IS DISTINCT FROM 'viewed'
     AND v_invoice.status IS DISTINCT FROM 'overdue'
     AND v_invoice.status IS DISTINCT FROM 'partial' THEN
    RAISE EXCEPTION 'Cette facture ne peut pas recevoir de versement échéancé.' USING ERRCODE = '22023';
  END IF;

  SELECT s.id, s.invoice_id, s.organization_id, s.amount, s.amount_type,
         s.percentage, s.paid_payment_id
  INTO v_schedule
  FROM public.invoice_payment_schedule AS s
  WHERE s.id = p_schedule_item_id
    AND s.invoice_id = p_invoice_id
    AND s.organization_id = v_organization_id
  FOR UPDATE OF s;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Échéance introuvable.' USING ERRCODE = 'P0002';
  END IF;

  IF v_schedule.paid_payment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cette échéance est déjà soldée.' USING ERRCODE = '22023';
  END IF;

  v_schedule_amount := CASE
    WHEN v_schedule.amount_type = 'percentage'
      THEN ROUND(COALESCE(v_invoice.total_ttc, 0) * COALESCE(v_schedule.percentage, 0) / 100, 2)
    ELSE ROUND(COALESCE(v_schedule.amount, 0), 2)
  END;
  IF v_schedule_amount <= 0 THEN
    RAISE EXCEPTION 'Le montant restant de cette échéance est nul.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(ROUND(SUM(p.amount), 2), 0)
  INTO v_schedule_paid
  FROM public.payments AS p
  WHERE p.payment_schedule_id = v_schedule.id
    AND p.invoice_id = p_invoice_id
    AND p.organization_id = v_organization_id;

  v_schedule_remaining := ROUND(v_schedule_amount - v_schedule_paid, 2);
  IF v_schedule_remaining <= 0 THEN
    RAISE EXCEPTION 'Cette échéance ne présente plus de solde à encaisser.' USING ERRCODE = '22023';
  END IF;
  IF p_amount > v_schedule_remaining THEN
    RAISE EXCEPTION 'Le montant encaissé dépasse le montant restant de l''échéance.' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(ROUND(SUM(p.amount), 2), 0)
  INTO v_payments_total
  FROM public.payments AS p
  WHERE p.invoice_id = p_invoice_id
    AND p.organization_id = v_organization_id;

  v_already_paid := GREATEST(v_payments_total, ROUND(COALESCE(v_invoice.total_paid, 0), 2));
  v_invoice_outstanding := ROUND(COALESCE(v_invoice.total_ttc, 0) - v_already_paid - v_credited_ttc, 2);
  IF v_invoice_outstanding <= 0 THEN
    RAISE EXCEPTION 'La facture ne présente plus de solde à encaisser.' USING ERRCODE = '22023';
  END IF;
  IF p_amount > v_invoice_outstanding THEN
    RAISE EXCEPTION 'Le montant encaissé dépasse le solde restant de la facture.' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.payments (
    organization_id,
    invoice_id,
    payment_schedule_id,
    client_id,
    amount,
    payment_date,
    method,
    reference,
    notes,
    created_by
  ) VALUES (
    v_organization_id,
    p_invoice_id,
    p_schedule_item_id,
    v_invoice.client_id,
    p_amount,
    COALESCE(p_payment_date, CURRENT_DATE),
    NULLIF(BTRIM(p_method), ''),
    NULLIF(BTRIM(p_reference), ''),
    NULLIF(BTRIM(p_notes), ''),
    v_user_id
  )
  RETURNING id INTO v_payment_id;

  v_schedule_paid := ROUND(v_schedule_paid + p_amount, 2);
  v_schedule_remaining := GREATEST(0, ROUND(v_schedule_amount - v_schedule_paid, 2));
  v_schedule_completed := v_schedule_remaining = 0;

  IF v_schedule_completed THEN
    UPDATE public.invoice_payment_schedule AS s
    SET paid_payment_id = v_payment_id
    WHERE s.id = p_schedule_item_id
      AND s.invoice_id = p_invoice_id
      AND s.organization_id = v_organization_id
      AND s.paid_payment_id IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cette échéance est déjà soldée.' USING ERRCODE = '22023';
    END IF;
  END IF;

  v_total_paid := ROUND(v_already_paid + p_amount, 2);
  v_status := CASE
    WHEN ROUND(v_total_paid + v_credited_ttc, 2) >= COALESCE(v_invoice.total_ttc, 0) THEN 'paid'
    ELSE 'partial'
  END;

  UPDATE public.invoices AS i
  SET total_paid = v_total_paid,
      status = v_status,
      paid_at = CASE WHEN v_status = 'paid' THEN pg_catalog.clock_timestamp() ELSE i.paid_at END
  WHERE i.id = p_invoice_id
    AND i.organization_id = v_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La facture n''a pas pu être mise à jour.' USING ERRCODE = 'P0001';
  END IF;
  v_invoice_outstanding := GREATEST(0, ROUND(v_invoice_outstanding - p_amount, 2));

  RETURN pg_catalog.jsonb_build_object(
    'payment_id', v_payment_id,
    'status', v_status,
    'total_paid', v_total_paid,
    'schedule_amount', v_schedule_amount,
    'schedule_paid', v_schedule_paid,
    'schedule_remaining', v_schedule_remaining,
    'schedule_completed', v_schedule_completed,
    'invoice_outstanding', v_invoice_outstanding
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.record_invoice_schedule_payment(UUID, UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_invoice_schedule_payment(UUID, UUID, NUMERIC, DATE, TEXT, TEXT, TEXT) TO authenticated;
-- Replace root authority calculations so contradictory invoice headers are
-- refused before immutable snapshots are captured.
CREATE OR REPLACE FUNCTION public.capture_invoice_issuance_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller JSONB;
  v_buyer JSONB;
  v_quote JSONB;
  v_chantier JSONB;
  v_items JSONB;
  v_payment_schedule JSONB;
  v_issued_at TIMESTAMPTZ := clock_timestamp();
  v_is_vat_subject BOOLEAN;
  v_total_ht NUMERIC;
  v_total_tva NUMERIC;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.unissued_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Unissued-cancellation provenance is created exclusively by the database';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.historical_import IS NOT NULL THEN
      IF auth.role() IS DISTINCT FROM 'service_role'
         OR NEW.historical_import->>'source' IS DISTINCT FROM 'csv'
         OR NEW.status IS DISTINCT FROM 'draft'
         OR NEW.issuance_snapshot IS NOT NULL THEN
        RAISE EXCEPTION 'Historical invoice imports require trusted CSV staging';
      END IF;
      NEW.historical_import := jsonb_build_object(
        'source', 'csv',
        'verification', 'unverified',
        'state', 'staging',
        'imported_at', clock_timestamp()
      );
    END IF;
    IF NEW.issuance_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Invoice issuance authority is created exclusively by the database';
    END IF;
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Invoices must be inserted as drafts before issuance';
    END IF;
    PERFORM 1 FROM public.organizations
    WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An erased organization cannot create an invoice' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.unissued_cancelled_at IS DISTINCT FROM OLD.unissued_cancelled_at THEN
    RAISE EXCEPTION 'Unissued-cancellation provenance is immutable';
  END IF;
  IF OLD.unissued_cancelled_at IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'An unissued cancelled invoice cannot be reopened';
  END IF;

  IF NEW.historical_import IS DISTINCT FROM OLD.historical_import THEN
    IF OLD.status = 'draft'
       AND OLD.historical_import->>'state' = 'staging'
       AND NEW.historical_import IS NOT DISTINCT FROM
         (OLD.historical_import || jsonb_build_object('state', 'finalized'))
       AND OLD.issuance_snapshot IS NULL
       AND NEW.issuance_snapshot IS NULL
       AND auth.role() = 'service_role'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by THEN
      PERFORM 1 FROM public.organizations
      WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'An erased organization cannot finalize a historical invoice import' USING ERRCODE = '42501';
      END IF;
      NEW.historical_import := NEW.historical_import || jsonb_build_object('finalized_at', clock_timestamp());
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Historical invoice import provenance is immutable';
  END IF;

  IF OLD.historical_import->>'state' = 'staging'
     AND OLD.status = 'draft'
     AND NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A historical invoice import must be finalized before changing its status';
  END IF;
  IF OLD.status = 'sending'
     AND NEW.status = 'draft'
     AND OLD.sent_at IS NULL
     AND NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at
     AND auth.role() = 'service_role' THEN
    -- A definite pre-dispatch rollback returns to an editable draft. Discard
    -- its provisional authority automatically; the next claim recaptures it.
    NEW.issuance_snapshot := NULL;
    RETURN NEW;
  END IF;

  IF NEW.issuance_snapshot IS DISTINCT FROM OLD.issuance_snapshot THEN
    RAISE EXCEPTION 'L''autorité d''émission d''une facture est immuable';
  END IF;
  IF OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft' THEN
    IF OLD.issuance_snapshot IS NOT NULL OR NEW.issuance_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Un brouillon ne peut pas réutiliser une autorité d''émission antérieure';
    END IF;
    -- Parent invoice row is already locked by UPDATE. These key-share locks
    -- serialize party/quote edits with the capture and are held to transaction end.
    PERFORM 1 FROM public.organizations
    WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Organisation émettrice indisponible pendant l''émission' USING ERRCODE = '42501';
    END IF;

    -- Cancellation retires an unissued draft without validating VAT or creating
    -- original issuance authority. This DB-owned marker records that fact.
    IF NEW.status = 'cancelled' THEN
      NEW.unissued_cancelled_at := clock_timestamp();
      RETURN NEW;
    END IF;
    SELECT COALESCE(is_vat_subject, true) INTO v_is_vat_subject
    FROM public.organizations
    WHERE id = NEW.organization_id;

    IF NOT v_is_vat_subject AND NEW.is_reverse_charge IS TRUE THEN
      RAISE EXCEPTION 'L’autoliquidation n’est pas compatible avec la franchise de TVA.' USING ERRCODE = '23514';
    END IF;

    WITH invoice_lines AS (
      SELECT COALESCE(i.vat_rate, 0) AS vat_rate,
             ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2) AS line_ht
      FROM public.invoice_items AS i
      WHERE i.invoice_id = NEW.id
        AND i.is_internal IS DISTINCT FROM TRUE
        AND i.unit IS DISTINCT FROM '__section__'
    ),
    vat_buckets AS (
      SELECT vat_rate, ROUND(SUM(line_ht), 2) AS taxable_basis
      FROM invoice_lines
      GROUP BY vat_rate
    )
    SELECT COALESCE(SUM(b.taxable_basis), 0),
           CASE
             WHEN v_is_vat_subject AND NEW.is_reverse_charge IS NOT TRUE
               THEN COALESCE(SUM(ROUND(b.taxable_basis * b.vat_rate / 100, 2)), 0)
             ELSE 0
           END
    INTO v_total_ht, v_total_tva
    FROM vat_buckets AS b;

    IF ROUND(COALESCE(NEW.total_ht, 0), 2) IS DISTINCT FROM ROUND(v_total_ht, 2)
       OR ROUND(COALESCE(NEW.total_tva, 0), 2) IS DISTINCT FROM ROUND(v_total_tva, 2)
       OR ROUND(COALESCE(NEW.total_ttc, 0), 2) IS DISTINCT FROM ROUND(v_total_ht + v_total_tva, 2) THEN
      RAISE EXCEPTION 'Invoice totals do not match current issuance VAT treatment' USING ERRCODE = '23514';
    END IF;
    -- Nullable stored line totals are normal; snapshot their canonical value.
    -- A present subtotal must agree with the amount rendered from quantity and
    -- unit price, or a header-valid invoice could archive contradictory lines.
    IF EXISTS (
      SELECT 1
      FROM public.invoice_items AS i
      WHERE i.invoice_id = NEW.id
        AND i.is_internal IS DISTINCT FROM TRUE
        AND i.unit IS DISTINCT FROM '__section__'
        AND (
          (i.total_ht IS NOT NULL
           AND i.total_ht IS DISTINCT FROM ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2))
          OR (i.vat_amount IS NOT NULL
              AND i.vat_amount IS DISTINCT FROM ROUND(
                ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2) * COALESCE(i.vat_rate, 0) / 100,
                2
              ))
        )
    ) THEN
      RAISE EXCEPTION 'Invoice line subtotals do not match their quantity, price and VAT rate'
        USING ERRCODE = '23514';
    END IF;
    SELECT jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'siret', o.siret,
      'siren', o.siren,
      'vat_number', o.vat_number,
      'email', o.email,
      'email_from_name', o.email_from_name,
      'email_from_address', o.email_from_address,
      'phone', o.phone,
      'address_line1', o.address_line1,
      'address_line2', o.address_line2,
      'city', o.city,
      'postal_code', o.postal_code,
      'country', o.country,
      'logo_url', o.logo_url,
      'primary_color', o.primary_color,
      'forme_juridique', o.forme_juridique,
      'capital_social', o.capital_social,
      'rcs', o.rcs,
      'rcs_ville', o.rcs_ville,
      'insurance_info', o.insurance_info,
      'certifications', o.certifications,
      'decennale_enabled', o.decennale_enabled,
      'decennale_assureur', o.decennale_assureur,
      'decennale_police', o.decennale_police,
      'decennale_couverture', o.decennale_couverture,
      'decennale_date_debut', o.decennale_date_debut,
      'decennale_date_fin', o.decennale_date_fin,
      'payment_terms_days', o.payment_terms_days,
      'late_penalty_rate', o.late_penalty_rate,
      'court_competent', o.court_competent,
      'iban', o.iban,
      'bic', o.bic,
      'bank_name', o.bank_name,
      'recovery_indemnity_text', o.recovery_indemnity_text,
      'is_vat_subject', o.is_vat_subject,
      'tva_sur_debits', o.tva_sur_debits,
      'business_profile', o.business_profile,
      'default_vat_rate', o.default_vat_rate
    ) INTO v_seller
    FROM public.organizations AS o
    WHERE o.id = NEW.organization_id;

    IF NEW.client_id IS NOT NULL THEN
      PERFORM 1 FROM public.clients
      WHERE id = NEW.client_id AND organization_id = NEW.organization_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Client de la facture introuvable dans son organisation';
      END IF;
      SELECT jsonb_build_object(
        'id', c.id,
        'type', c.type,
        'company_name', c.company_name,
        'contact_name', c.contact_name,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'email', c.email,
        'phone', c.phone,
        'address_line1', c.address_line1,
        'address_line2', c.address_line2,
        'postal_code', c.postal_code,
        'city', c.city,
        'country', c.country,
        'siret', c.siret,
        'siren', c.siren,
        'vat_number', c.vat_number
      ) INTO v_buyer
      FROM public.clients AS c
      WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id;
    END IF;

    IF NEW.quote_id IS NOT NULL THEN
      PERFORM 1 FROM public.quotes
      WHERE id = NEW.quote_id AND organization_id = NEW.organization_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Devis lié introuvable dans son organisation';
      END IF;
      SELECT jsonb_build_object('id', q.id, 'number', q.number, 'title', q.title)
      INTO v_quote
      FROM public.quotes AS q
      WHERE q.id = NEW.quote_id AND q.organization_id = NEW.organization_id;
    END IF;
    IF NEW.chantier_id IS NOT NULL THEN
      PERFORM 1 FROM public.chantiers
      WHERE id = NEW.chantier_id AND organization_id = NEW.organization_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Chantier lié introuvable dans son organisation';
      END IF;
      SELECT jsonb_build_object('id', ch.id, 'title', ch.title)
      INTO v_chantier
      FROM public.chantiers AS ch
      WHERE ch.id = NEW.chantier_id AND ch.organization_id = NEW.organization_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'description', i.description,
      'quantity', i.quantity,
      'unit', i.unit,
      'unit_price', i.unit_price,
      'unit_cost_ht', i.unit_cost_ht,
      'vat_rate', i.vat_rate,
      'vat_amount', CASE
        WHEN NOT v_is_vat_subject OR NEW.is_reverse_charge IS TRUE THEN 0
        ELSE COALESCE(i.vat_amount, ROUND(
          ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2) * COALESCE(i.vat_rate, 0) / 100,
          2
        ))
      END,
      'vat_exemption_code', i.vat_exemption_code,
      'total_ht', COALESCE(i.total_ht, ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2)),
      'position', i.position,
      'length_m', i.length_m,
      'width_m', i.width_m,
      'height_m', i.height_m,
      'dim_quantity', i.dim_quantity,
      'is_internal', i.is_internal,
      'dimension_values', i.dimension_values,
      'variant_label', i.variant_label
    ) ORDER BY i.position, i.id), '[]'::jsonb)
    INTO v_items
    FROM public.invoice_items AS i
    WHERE i.invoice_id = NEW.id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'label', s.label,
      'due_date', s.due_date,
      'amount', s.amount,
      'amount_type', s.amount_type,
      'percentage', s.percentage,
      'position', s.position,
      'paid_payment_id', s.paid_payment_id
    ) ORDER BY s.position, s.id), '[]'::jsonb)
    INTO v_payment_schedule
    FROM public.invoice_payment_schedule AS s
    WHERE s.invoice_id = NEW.id AND s.organization_id = NEW.organization_id;

    NEW.issuance_snapshot := jsonb_build_object(
      'schema_version', 1,
      'issued_at', v_issued_at,
      'invoice', jsonb_build_object(
        'id', NEW.id,
        'number', NEW.number,
        'title', NEW.title,
        'invoice_type', NEW.invoice_type,
        'credit_note_for', NEW.credit_note_for,
        'total_ht', NEW.total_ht,
        'total_tva', NEW.total_tva,
        'total_ttc', NEW.total_ttc,
        'currency', NEW.currency,
        'issue_date', NEW.issue_date,
        'due_date', NEW.due_date,
        'balance_due_date', NEW.balance_due_date,
        'payment_terms_days', NEW.payment_terms_days,
        'notes_client', NEW.notes_client,
        'payment_conditions', NEW.payment_conditions,
        'discount_rate', NEW.discount_rate,
        'discount_amount', NEW.discount_amount,
        'deposit_rate', NEW.deposit_rate,
        'deposit_amount', NEW.deposit_amount,
        'aid_label', NEW.aid_label,
        'aid_amount', NEW.aid_amount,
        'quote_id', NEW.quote_id,
        'client_id', NEW.client_id,
        'chantier_id', NEW.chantier_id,
        'situation_number', NEW.situation_number,
        'cumulative_pct', NEW.cumulative_pct,
        'period_from', NEW.period_from,
        'period_to', NEW.period_to,
        'retention_pct', NEW.retention_pct,
        'retention_amount', NEW.retention_amount,
        'market_reference', NEW.market_reference,
        'is_reverse_charge', NEW.is_reverse_charge,
        'recipient_siren', NEW.recipient_siren,
        'recipient_siret', NEW.recipient_siret,
        'einvoicing_mandatory', NEW.einvoicing_mandatory,
        'buyer_reference', NEW.buyer_reference,
        'purchase_order_ref', NEW.purchase_order_ref,
        'invoice_type_code', NEW.invoice_type_code,
        'preceding_invoice_ref', NEW.preceding_invoice_ref,
        'preceding_invoice_date', NEW.preceding_invoice_date,
        'facturx_level', NEW.facturx_level,
        'operation_type', NEW.operation_type,
        'tva_sur_debits', NEW.tva_sur_debits,
        'delivery_address_line1', NEW.delivery_address_line1,
        'delivery_address_line2', NEW.delivery_address_line2,
        'delivery_city', NEW.delivery_city,
        'delivery_postal_code', NEW.delivery_postal_code,
        'delivery_country', NEW.delivery_country,
        'created_at', NEW.created_at
      ),
      'seller', v_seller,
      'buyer', v_buyer,
      'chantier', v_chantier,
      'quote', v_quote,
      'items', v_items,
      'payment_schedule', v_payment_schedule
    );
  END IF;

  RETURN NEW;
END;
$$;
CREATE OR REPLACE FUNCTION public.capture_quote_document_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller JSONB;
  v_buyer JSONB;
  v_items JSONB;
  v_sections JSONB;
  v_total_ht NUMERIC;
  v_total_tva NUMERIC;
  v_publish BOOLEAN := false;
  v_metadata TEXT[] := ARRAY[
    'document_snapshot', 'status', 'signature_token', 'signature_token_expires_at',
    'sent_at', 'signed_at', 'accepted_at', 'signed_ip', 'signed_user_agent',
    'client_signature_image', 'client_signatory_name', 'client_signatory_role',
    'refused_at', 'refusal_reason', 'rejection_reason', 'last_viewed_at',
    'view_count', 'is_archived', 'archived_at', 'archived_by', 'created_by', 'updated_at'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.historical_import IS NOT NULL THEN
      IF auth.role() IS DISTINCT FROM 'service_role'
         OR NEW.historical_import->>'source' IS DISTINCT FROM 'csv'
         OR NEW.status IS DISTINCT FROM 'draft'
         OR NEW.document_snapshot IS NOT NULL THEN
        RAISE EXCEPTION 'Import historique CSV réservé au serveur en phase brouillon' USING ERRCODE = '42501';
      END IF;
      NEW.historical_import := jsonb_build_object(
        'source', 'csv', 'verification', 'unverified', 'state', 'staging',
        'imported_at', clock_timestamp()
      );
    END IF;
    IF NEW.document_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'L''autorité documentaire est créée exclusivement par la base' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Un devis doit être créé en brouillon avant sa publication' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.organizations
    WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Une organisation effacée ne peut plus créer de devis' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.historical_import IS DISTINCT FROM OLD.historical_import THEN
    IF OLD.status = 'draft'
       AND OLD.historical_import->>'state' = 'staging'
       AND NEW.historical_import IS NOT DISTINCT FROM
         (OLD.historical_import || jsonb_build_object('state', 'finalized'))
       AND OLD.document_snapshot IS NULL AND NEW.document_snapshot IS NULL
       AND auth.role() = 'service_role'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by THEN
      PERFORM 1 FROM public.organizations
      WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Organisation effacée : import historique impossible' USING ERRCODE = '42501';
      END IF;
      NEW.historical_import := NEW.historical_import || jsonb_build_object('finalized_at', clock_timestamp());
      NEW.signature_token := NULL;
      NEW.signature_token_expires_at := NULL;
      NEW.sent_at := NULL;
      NEW.signed_at := NULL;
      NEW.accepted_at := NULL;
      NEW.signed_ip := NULL;
      NEW.signed_user_agent := NULL;
      NEW.client_signature_image := NULL;
      NEW.client_signatory_name := NULL;
      NEW.client_signatory_role := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La provenance d''un import historique est immuable' USING ERRCODE = '42501';
  END IF;
  IF OLD.historical_import->>'state' = 'staging' AND OLD.status = 'draft'
     AND NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Finalisez l''import historique avant de changer son statut' USING ERRCODE = '42501';
  END IF;

  IF NEW.document_snapshot IS DISTINCT FROM OLD.document_snapshot THEN
    RAISE EXCEPTION 'L''autorité documentaire du devis est protégée' USING ERRCODE = '42501';
  END IF;

  -- Existing immutable guards retain responsibility for accepted legal content,
  -- including their narrow Auth-erasure and public-capability revocation cases.
  IF OLD.status IN ('accepted', 'converted', 'fully_invoiced') OR OLD.signed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('sent', 'viewed')
     AND (to_jsonb(NEW) - v_metadata) IS DISTINCT FROM (to_jsonb(OLD) - v_metadata) THEN
    IF NEW.status = 'accepted' OR NEW.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Le devis a changé avant son acceptation ; republiez la proposition' USING ERRCODE = '40001';
    END IF;
    -- Editing a published offer invalidates already loaded signature forms.
    NEW.status := 'draft';
  END IF;

  IF OLD.status IS DISTINCT FROM 'draft' AND NEW.status = 'draft' THEN
    NEW.document_snapshot := NULL;
    NEW.signature_token := NULL;
    NEW.signature_token_expires_at := NULL;
    NEW.sent_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status = 'sent' THEN
    v_publish := OLD.status = 'draft'
      OR (NEW.signature_token IS NOT NULL
          AND NEW.signature_token IS DISTINCT FROM OLD.signature_token);
  ELSIF NEW.status = 'accepted' THEN
    IF OLD.status = 'draft' THEN
      v_publish := true; -- explicit manual acceptance of the current draft
    ELSIF OLD.document_snapshot IS NULL THEN
      RAISE EXCEPTION 'Autorité historique du devis indisponible ; une nouvelle proposition doit être publiée' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT v_publish THEN
    RETURN NEW;
  END IF;

  -- The quote row is locked by UPDATE. Child guards below acquire the same
  -- parent lock before changing lines or sections. Party edits serialize here.
  PERFORM 1 FROM public.organizations
  WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation émettrice indisponible' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'id', o.id, 'name', o.name, 'siret', o.siret, 'siren', o.siren,
    'vat_number', o.vat_number, 'email', o.email,
    'email_from_name', o.email_from_name, 'email_from_address', o.email_from_address,
    'phone', o.phone, 'address_line1', o.address_line1, 'address_line2', o.address_line2,
    'city', o.city, 'postal_code', o.postal_code, 'country', o.country,
    'logo_url', o.logo_url, 'primary_color', o.primary_color,
    'forme_juridique', o.forme_juridique, 'capital_social', o.capital_social,
    'rcs', o.rcs, 'rcs_ville', o.rcs_ville, 'insurance_info', o.insurance_info,
    'certifications', o.certifications, 'decennale_enabled', o.decennale_enabled,
    'decennale_assureur', o.decennale_assureur, 'decennale_police', o.decennale_police,
    'decennale_couverture', o.decennale_couverture,
    'decennale_date_debut', o.decennale_date_debut, 'decennale_date_fin', o.decennale_date_fin,
    'payment_terms_days', o.payment_terms_days, 'late_penalty_rate', o.late_penalty_rate,
    'court_competent', o.court_competent, 'iban', o.iban, 'bic', o.bic,
    'bank_name', o.bank_name, 'recovery_indemnity_text', o.recovery_indemnity_text,
    'is_vat_subject', o.is_vat_subject, 'tva_sur_debits', o.tva_sur_debits,
    'business_profile', o.business_profile, 'default_vat_rate', o.default_vat_rate
  ) INTO v_seller
  FROM public.organizations o WHERE o.id = NEW.organization_id;

  IF NEW.client_id IS NOT NULL THEN
    PERFORM 1 FROM public.clients
    WHERE id = NEW.client_id AND organization_id = NEW.organization_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Client du devis introuvable dans son organisation' USING ERRCODE = '23503';
    END IF;
    SELECT jsonb_build_object(
      'id', c.id, 'type', c.type, 'company_name', c.company_name,
      'contact_name', c.contact_name, 'first_name', c.first_name, 'last_name', c.last_name,
      'email', c.email, 'phone', c.phone, 'address_line1', c.address_line1,
      'address_line2', c.address_line2, 'postal_code', c.postal_code,
      'city', c.city, 'country', c.country, 'siret', c.siret,
      'siren', c.siren, 'vat_number', c.vat_number
    ) INTO v_buyer FROM public.clients c
    WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.quote_items WHERE quote_id = NEW.id AND quantity IS NULL) THEN
    RAISE EXCEPTION 'Une quantité de ligne est manquante ; corrigez le brouillon avant publication' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'quote_id', i.quote_id, 'section_id', i.section_id, 'type', i.type,
    'material_id', i.material_id, 'labor_rate_id', i.labor_rate_id,
    'designation', i.designation, 'details', i.details, 'description', i.description,
    'quantity', i.quantity, 'unit', i.unit, 'unit_price', i.unit_price,
    'unit_cost_ht', i.unit_cost_ht, 'vat_rate', COALESCE(i.vat_rate, 20),
    'total_ht', i.total_ht, 'position', i.position,
    'length_m', i.length_m, 'width_m', i.width_m, 'height_m', i.height_m,
    'dim_quantity', COALESCE(i.dim_quantity, 1), 'is_internal', COALESCE(i.is_internal, false),
    'metal_grid_id', i.metal_grid_id, 'dimension_values', i.dimension_values,
    'variant_label', i.variant_label, 'catalog_variant_id', i.catalog_variant_id,
    'price_pending', COALESCE(i.price_pending, false), 'labor_category', i.labor_category
  ) ORDER BY i.position, i.id), '[]'::jsonb)
  INTO v_items FROM public.quote_items i WHERE i.quote_id = NEW.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'quote_id', s.quote_id, 'title', s.title, 'position', s.position,
    'items', COALESCE((SELECT jsonb_agg(item ORDER BY (item->>'position')::int, item->>'id')
                      FROM jsonb_array_elements(v_items) item
                      WHERE item->>'section_id' = s.id::text), '[]'::jsonb)
  ) ORDER BY s.position, s.id), '[]'::jsonb)
  INTO v_sections FROM public.quote_sections s WHERE s.quote_id = NEW.id;

  -- Canonical quote totals use visible, cent-rounded lines and VAT by bucket.
  WITH quote_lines AS (
    SELECT COALESCE((item->>'vat_rate')::NUMERIC, 20) AS vat_rate,
           ROUND(
             COALESCE((item->>'quantity')::NUMERIC, 0)
             * COALESCE((item->>'unit_price')::NUMERIC, 0),
             2
           ) AS line_ht
    FROM jsonb_array_elements(v_items) AS item
    WHERE (item->>'is_internal')::BOOLEAN IS NOT TRUE
  ),
  vat_buckets AS (
    SELECT vat_rate, ROUND(SUM(line_ht), 2) AS taxable_basis
    FROM quote_lines
    GROUP BY vat_rate
  )
  SELECT COALESCE(SUM(b.taxable_basis), 0),
         CASE
           WHEN (v_seller->>'is_vat_subject')::BOOLEAN IS FALSE THEN 0
           ELSE COALESCE(SUM(ROUND(b.taxable_basis * b.vat_rate / 100, 2)), 0)
         END
  INTO v_total_ht, v_total_tva
  FROM vat_buckets AS b;
  NEW.total_ht := v_total_ht;
  NEW.total_tva := v_total_tva;
  NEW.total_ttc := v_total_ht + v_total_tva;

  NEW.document_snapshot := jsonb_build_object(
    'version', 1, 'captured_at', clock_timestamp(), 'organization', v_seller,
    'quote', jsonb_build_object(
      'id', NEW.id, 'organization_id', NEW.organization_id, 'number', NEW.number,
      'title', NEW.title, 'status', NEW.status, 'total_ht', NEW.total_ht,
      'total_tva', NEW.total_tva, 'total_ttc', NEW.total_ttc, 'currency', NEW.currency,
      'validity_days', NEW.validity_days, 'valid_until', NEW.valid_until,
      'sent_at', NEW.sent_at, 'created_at', NEW.created_at,
      'notes_client', NEW.notes_client, 'payment_conditions', NEW.payment_conditions,
      'discount_rate', NEW.discount_rate, 'deposit_rate', NEW.deposit_rate,
      'aid_label', NEW.aid_label, 'aid_amount', NEW.aid_amount,
      'show_section_subtotals', NEW.show_section_subtotals,
      'client_request_description', CASE WHEN NEW.client_request_visible_on_pdf THEN NEW.client_request_description ELSE NULL END,
      'client_request_visible_on_pdf', NEW.client_request_visible_on_pdf,
      'client', v_buyer, 'items', v_items, 'sections', v_sections,
      'unsectionedItems', COALESCE((SELECT jsonb_agg(item ORDER BY (item->>'position')::int, item->>'id')
                                  FROM jsonb_array_elements(v_items) item
                                  WHERE item->>'section_id' IS NULL), '[]'::jsonb)
    )
  );
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.capture_invoice_issuance_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_quote_document_snapshot() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
COMMIT;
