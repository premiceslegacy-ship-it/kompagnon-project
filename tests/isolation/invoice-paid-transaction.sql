-- Disposable LOCAL Supabase database migrated through 213. Every fixture row
-- and the injected failure trigger are rolled back on success.
BEGIN;

CREATE OR REPLACE FUNCTION public.fixture_reject_invoice_paid_213()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.number LIKE 'FAC-PAID-FAIL-%' AND NEW.status = 'paid' THEN
    RAISE EXCEPTION 'Injected invoice update failure after payment insert'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER fixture_reject_invoice_paid_213
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.fixture_reject_invoice_paid_213();

DO $test$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_foreign_org_id UUID := gen_random_uuid();
  v_owner_id UUID := gen_random_uuid();
  v_viewer_id UUID := gen_random_uuid();
  v_foreign_owner_id UUID := gen_random_uuid();
  v_owner_role_id UUID := gen_random_uuid();
  v_viewer_role_id UUID := gen_random_uuid();
  v_foreign_role_id UUID := gen_random_uuid();
  v_client_id UUID := gen_random_uuid();
  v_foreign_client_id UUID := gen_random_uuid();
  v_paid_invoice_id UUID := gen_random_uuid();
  v_failed_invoice_id UUID := gen_random_uuid();
  v_partial_invoice_id UUID := gen_random_uuid();
  v_historical_invoice_id UUID;
  v_result JSONB;
  v_retry JSONB;
  v_first_paid_at TIMESTAMPTZ;
  v_paid_snapshot JSONB;
  v_failed_snapshot JSONB;
  v_partial_snapshot JSONB;
  v_historical_import JSONB;
  v_blocked BOOLEAN;
  v_sqlstate TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);

  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject)
  VALUES
    (v_org_id, 'Invoice payment transaction', 'invoice-paid-' || v_org_id::TEXT,
     'invoice-paid-' || v_org_id::TEXT || '@example.invalid', 'construction', true),
    (v_foreign_org_id, 'Foreign payment tenant', 'invoice-paid-foreign-' || v_foreign_org_id::TEXT,
     'invoice-paid-foreign-' || v_foreign_org_id::TEXT || '@example.invalid', 'construction', true);

  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES
    (v_client_id, v_org_id, 'company', 'Payment test buyer', 'payment-buyer-' || v_client_id::TEXT || '@example.invalid'),
    (v_foreign_client_id, v_foreign_org_id, 'company', 'Foreign payment buyer', 'foreign-buyer-' || v_foreign_client_id::TEXT || '@example.invalid');

  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_owner_role_id, v_org_id, 'Payment owner', 'payment-owner'),
    (v_viewer_role_id, v_org_id, 'Payment viewer', 'payment-viewer'),
    (v_foreign_role_id, v_foreign_org_id, 'Foreign payment owner', 'foreign-payment-owner');

  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_owner_id, 'authenticated', 'authenticated', 'paid-owner-' || v_owner_id::TEXT || '@example.invalid', now()),
    (v_viewer_id, 'authenticated', 'authenticated', 'paid-viewer-' || v_viewer_id::TEXT || '@example.invalid', now()),
    (v_foreign_owner_id, 'authenticated', 'authenticated', 'paid-foreign-' || v_foreign_owner_id::TEXT || '@example.invalid', now());

  -- The auth signup trigger creates each user's ordinary fixture organization;
  -- deactivate those memberships and place each actor in the scenario tenant.
  UPDATE public.memberships
  SET is_active = false
  WHERE user_id IN (v_owner_id, v_viewer_id, v_foreign_owner_id);

  INSERT INTO public.memberships (organization_id, user_id, role_id, accepted_at, is_active)
  VALUES
    (v_org_id, v_owner_id, v_owner_role_id, now(), true),
    (v_org_id, v_viewer_id, v_viewer_role_id, now(), true),
    (v_foreign_org_id, v_foreign_owner_id, v_foreign_role_id, now(), true);

  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  VALUES
    (v_owner_role_id, 'invoices.record_payment', true),
    (v_viewer_role_id, 'invoices.record_payment', false),
    (v_foreign_role_id, 'invoices.record_payment', true);

  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    total_ht, total_tva, total_ttc, currency
  ) VALUES
    (v_paid_invoice_id, v_org_id, v_client_id, v_owner_id, 'FAC-PAID-OK-' || v_paid_invoice_id::TEXT,
     'Successful payment', 'draft', 100, 20, 120, 'EUR'),
    (v_failed_invoice_id, v_org_id, v_client_id, v_owner_id, 'FAC-PAID-FAIL-' || v_failed_invoice_id::TEXT,
     'Payment rollback', 'draft', 100, 20, 120, 'EUR'),
    (v_partial_invoice_id, v_org_id, v_client_id, v_owner_id, 'FAC-PAID-PARTIAL-' || v_partial_invoice_id::TEXT,
     'Partial balance payment', 'draft', 100, 20, 120, 'EUR');

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, total_ht, position
  ) VALUES
    (v_paid_invoice_id, 'Issued payment line', 1, 'u', 100, 20, 100, 0),
    (v_failed_invoice_id, 'Failed payment line', 1, 'u', 100, 20, 100, 0),
    (v_partial_invoice_id, 'Partial payment line', 1, 'u', 100, 20, 100, 0);

  UPDATE public.invoices
  SET status = 'sending'
  WHERE id IN (v_paid_invoice_id, v_failed_invoice_id, v_partial_invoice_id);
  UPDATE public.invoices
  SET status = 'sent', sent_at = clock_timestamp()
  WHERE id IN (v_paid_invoice_id, v_failed_invoice_id, v_partial_invoice_id);

  UPDATE public.invoices
  SET status = 'partial', total_paid = 20
  WHERE id = v_partial_invoice_id;
  INSERT INTO public.payments (
    organization_id, invoice_id, client_id, amount, payment_date, method, notes, created_by
  ) VALUES (
    v_org_id, v_partial_invoice_id, v_client_id, 30, CURRENT_DATE, 'manual', 'Existing actual payment', v_owner_id
  );

  -- Use the authoritative import RPC to create a paid historical row with no
  -- payment record, no issuance snapshot, and no recorded paid_at date.
  v_historical_invoice_id := public.import_historical_document(
    'invoice',
    v_org_id,
    v_owner_id,
    pg_catalog.jsonb_build_object(
      'client_id', v_client_id,
      'number', 'FAC-PAID-HIST-' || gen_random_uuid()::TEXT,
      'title', 'Historical paid import',
      'status', 'paid',
      'issue_date', '2023-01-15',
      'currency', 'EUR'
    ),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'description', 'Historical imported line',
      'quantity', 1,
      'unit', 'u',
      'unit_price', 100,
      'vat_rate', 20
    ))
  );

  SELECT issuance_snapshot INTO v_paid_snapshot FROM public.invoices WHERE id = v_paid_invoice_id;
  SELECT issuance_snapshot INTO v_failed_snapshot FROM public.invoices WHERE id = v_failed_invoice_id;
  SELECT issuance_snapshot INTO v_partial_snapshot FROM public.invoices WHERE id = v_partial_invoice_id;
  SELECT historical_import INTO v_historical_import FROM public.invoices WHERE id = v_historical_invoice_id;

  IF v_paid_snapshot IS NULL OR v_failed_snapshot IS NULL OR v_partial_snapshot IS NULL
     OR v_historical_import IS NULL
     OR EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_historical_invoice_id
         AND (issuance_snapshot IS NOT NULL OR paid_at IS NOT NULL OR total_paid <> 0)
     )
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_historical_invoice_id) THEN
    RAISE EXCEPTION 'Payment fixture did not preserve the expected issued and historical baseline';
  END IF;

  IF has_function_privilege('anon', 'public.mark_invoice_paid(uuid)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.mark_invoice_paid(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'mark_invoice_paid must not be executable by anon or service_role';
  END IF;

  -- Authorized owner: one payment is inserted and the invoice is updated in the
  -- same transaction; metadata and the original issuance snapshot are stable.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'RESET ROLE';
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.mark_invoice_paid(v_paid_invoice_id) INTO v_result;
  EXECUTE 'RESET ROLE';

  IF v_result->>'changed' IS DISTINCT FROM 'true'
     OR (v_result->>'amount_recorded')::NUMERIC IS DISTINCT FROM 120
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 120
     OR (v_result->'invoice'->>'id')::UUID IS DISTINCT FROM v_paid_invoice_id
     OR v_result->'invoice'->>'number' IS DISTINCT FROM 'FAC-PAID-OK-' || v_paid_invoice_id::TEXT
     OR v_result->'invoice'->>'title' IS DISTINCT FROM 'Successful payment'
     OR v_result->'invoice'->>'currency' IS DISTINCT FROM 'EUR'
     OR (v_result->'invoice'->>'client_id')::UUID IS DISTINCT FROM v_client_id
     OR (v_result->'invoice'->>'total_ttc')::NUMERIC IS DISTINCT FROM 120 THEN
    RAISE EXCEPTION 'Authorized owner did not receive the expected atomic payment result: %', v_result;
  END IF;
  v_first_paid_at := (v_result->>'paid_at')::TIMESTAMPTZ;

  IF v_first_paid_at IS NULL
     OR (SELECT count(*) FROM public.payments WHERE invoice_id = v_paid_invoice_id AND organization_id = v_org_id) <> 1
     OR (SELECT amount FROM public.payments WHERE invoice_id = v_paid_invoice_id AND organization_id = v_org_id) <> 120
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_paid_invoice_id AND status = 'paid' AND total_paid = 120 AND paid_at = v_first_paid_at
         AND issuance_snapshot = v_paid_snapshot AND historical_import IS NULL
     ) THEN
    RAISE EXCEPTION 'Owner payment, paid timestamp, or issuance authority was not committed together';
  END IF;

  -- Retry returns the stored timestamp and total without inserting another row.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.mark_invoice_paid(v_paid_invoice_id) INTO v_retry;
  EXECUTE 'RESET ROLE';
  IF v_retry->>'changed' IS DISTINCT FROM 'false'
     OR v_retry->>'paid_at' IS DISTINCT FROM v_result->>'paid_at'
     OR (v_retry->>'total_paid')::NUMERIC IS DISTINCT FROM 120
     OR (SELECT count(*) FROM public.payments WHERE invoice_id = v_paid_invoice_id AND organization_id = v_org_id) <> 1
     OR (SELECT issuance_snapshot FROM public.invoices WHERE id = v_paid_invoice_id) IS DISTINCT FROM v_paid_snapshot THEN
    RAISE EXCEPTION 'Repeated payment call was not idempotent or changed original issuance facts';
  END IF;

  -- A same-organization viewer without the payment permission is rejected.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.mark_invoice_paid(v_failed_invoice_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_failed_invoice_id) THEN
    RAISE EXCEPTION 'Viewer without invoices.record_payment was not denied cleanly';
  END IF;

  -- A permitted user from another organization cannot target this invoice.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_foreign_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.mark_invoice_paid(v_failed_invoice_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM 'P0002'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_failed_invoice_id) THEN
    RAISE EXCEPTION 'Foreign organization actor was not denied without a write';
  END IF;

  -- Anonymous callers have neither function EXECUTE nor an authenticated claim.
  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE anon';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.mark_invoice_paid(v_failed_invoice_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_failed_invoice_id) THEN
    RAISE EXCEPTION 'Anonymous caller was not denied without a write';
  END IF;

  -- Fail after the payment INSERT but before invoice UPDATE. The RPC statement
  -- must roll back the payment and all trigger-side writes as one transaction.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.mark_invoice_paid(v_failed_invoice_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM 'P0001'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_failed_invoice_id)
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_failed_invoice_id AND status = 'sent' AND total_paid = 0 AND paid_at IS NULL
         AND issuance_snapshot = v_failed_snapshot
     ) THEN
    RAISE EXCEPTION 'Invoice update failure did not roll back its payment insert and invoice state';
  END IF;

  -- Existing actual payments dominate the stale recorded total; add only the
  -- remaining 90.00 balance and preserve the issued snapshot.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.mark_invoice_paid(v_partial_invoice_id) INTO v_result;
  EXECUTE 'RESET ROLE';
  IF v_result->>'changed' IS DISTINCT FROM 'true'
     OR (v_result->>'amount_recorded')::NUMERIC IS DISTINCT FROM 90
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 120
     OR (SELECT count(*) FROM public.payments WHERE invoice_id = v_partial_invoice_id AND organization_id = v_org_id) <> 2
     OR (SELECT sum(amount) FROM public.payments WHERE invoice_id = v_partial_invoice_id AND organization_id = v_org_id) <> 120
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_partial_invoice_id AND status = 'paid' AND total_paid = 120
         AND issuance_snapshot = v_partial_snapshot
     ) THEN
    RAISE EXCEPTION 'Partial payment did not record only the remaining balance';
  END IF;

  -- A historical paid import with no source date is returned unchanged; it
  -- does not gain a synthetic payment, timestamp, or issuance authority.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.mark_invoice_paid(v_historical_invoice_id) INTO v_result;
  EXECUTE 'RESET ROLE';
  IF v_result->>'changed' IS DISTINCT FROM 'false'
     OR v_result->>'paid_at' IS NOT NULL
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 0
     OR (SELECT count(*) FROM public.payments WHERE invoice_id = v_historical_invoice_id) <> 0
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_historical_invoice_id AND status = 'paid' AND paid_at IS NULL
         AND total_paid = 0 AND issuance_snapshot IS NULL
         AND historical_import = v_historical_import
     ) THEN
    RAISE EXCEPTION 'Historical paid invoice acquired a synthetic payment/date or changed its provenance';
  END IF;
END;
$test$;

ROLLBACK;
