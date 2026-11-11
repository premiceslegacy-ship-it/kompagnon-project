-- Run only against a disposable LOCAL Supabase database migrated through 218:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/invoice-schedule-payment.sql
-- Exercises authorization, repeated partial receipts, and invoice/schedule bounds.
-- All fixtures roll back on success.
BEGIN;

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
  v_invoice_id UUID := gen_random_uuid();
  v_permission_invoice_id UUID := gen_random_uuid();
  v_foreign_invoice_id UUID := gen_random_uuid();
  v_percentage_invoice_id UUID := gen_random_uuid();
  v_schedule_one UUID := gen_random_uuid();
  v_schedule_two UUID := gen_random_uuid();
  v_schedule_competitor UUID := gen_random_uuid();
  v_permission_schedule UUID := gen_random_uuid();
  v_foreign_schedule UUID := gen_random_uuid();
  v_percentage_schedule UUID := gen_random_uuid();
  v_payment_id UUID;
  v_result JSONB;
  v_invalid_amount NUMERIC;
  v_blocked BOOLEAN;
  v_sqlstate TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);

  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject)
  VALUES
    (v_org_id, 'Invoice schedule payment', 'invoice-schedule-' || v_org_id::TEXT,
     'invoice-schedule-' || v_org_id::TEXT || '@example.invalid', 'construction', true),
    (v_foreign_org_id, 'Foreign schedule payment', 'invoice-schedule-foreign-' || v_foreign_org_id::TEXT,
     'invoice-schedule-foreign-' || v_foreign_org_id::TEXT || '@example.invalid', 'construction', true);

  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_owner_role_id, v_org_id, 'Schedule owner', 'owner'),
    (v_viewer_role_id, v_org_id, 'Schedule viewer', 'schedule-viewer'),
    (v_foreign_role_id, v_foreign_org_id, 'Foreign schedule owner', 'foreign-schedule-owner');

  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_owner_id, 'authenticated', 'authenticated', 'schedule-owner-' || v_owner_id::TEXT || '@example.invalid', now()),
    (v_viewer_id, 'authenticated', 'authenticated', 'schedule-viewer-' || v_viewer_id::TEXT || '@example.invalid', now()),
    (v_foreign_owner_id, 'authenticated', 'authenticated', 'schedule-foreign-' || v_foreign_owner_id::TEXT || '@example.invalid', now());

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
    (v_viewer_role_id, 'invoices.record_payment', false),
    (v_foreign_role_id, 'invoices.record_payment', true);

  INSERT INTO public.invoices (
    id, organization_id, created_by, number, title, status,
    total_ht, total_tva, total_ttc, currency
  ) VALUES
    (v_invoice_id, v_org_id, v_owner_id, 'FAC-SCHEDULE-' || v_invoice_id::TEXT,
     'Bounded schedule', 'draft', 1000, 200, 1200, 'EUR'),
    (v_permission_invoice_id, v_org_id, v_owner_id, 'FAC-SCHEDULE-PERM-' || v_permission_invoice_id::TEXT,
     'Permission target', 'draft', 100, 20, 120, 'EUR'),
    (v_foreign_invoice_id, v_foreign_org_id, v_foreign_owner_id, 'FAC-SCHEDULE-FOREIGN-' || v_foreign_invoice_id::TEXT,
     'Foreign target', 'draft', 100, 20, 120, 'EUR'),
    (v_percentage_invoice_id, v_org_id, v_owner_id, 'FAC-SCHEDULE-PERCENT-' || v_percentage_invoice_id::TEXT,
     'Percentage schedule', 'draft', 1000, 200, 1200, 'EUR');

  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES
    (v_invoice_id, 'Schedule basis', 1, 'u', 1000, 20, 0),
    (v_permission_invoice_id, 'Permission basis', 1, 'u', 100, 20, 0),
    (v_foreign_invoice_id, 'Foreign basis', 1, 'u', 100, 20, 0),
    (v_percentage_invoice_id, 'Percentage basis', 1, 'u', 1000, 20, 0);
  INSERT INTO public.invoice_payment_schedule (
    id, organization_id, invoice_id, label, due_date, amount, amount_type, percentage, position
  ) VALUES
    (v_schedule_one, v_org_id, v_invoice_id, 'Acompte 1', CURRENT_DATE, 600, 'amount', NULL, 0),
    (v_schedule_two, v_org_id, v_invoice_id, 'Acompte 2', CURRENT_DATE, 600, 'amount', NULL, 1),
    (v_schedule_competitor, v_org_id, v_invoice_id, 'Solde concurrent', CURRENT_DATE, 1200, 'amount', NULL, 2),
    (v_permission_schedule, v_org_id, v_permission_invoice_id, 'Permission', CURRENT_DATE, 120, 'amount', NULL, 0),
    (v_foreign_schedule, v_foreign_org_id, v_foreign_invoice_id, 'Foreign', CURRENT_DATE, 120, 'amount', NULL, 0),
    (v_percentage_schedule, v_org_id, v_percentage_invoice_id, '25%', CURRENT_DATE, 300, 'percentage', 25, 0);
  UPDATE public.invoices
  SET status = 'sending'
  WHERE id IN (v_invoice_id, v_permission_invoice_id, v_foreign_invoice_id, v_percentage_invoice_id);
  UPDATE public.invoices
  SET status = 'sent', sent_at = clock_timestamp()
  WHERE id IN (v_invoice_id, v_permission_invoice_id, v_foreign_invoice_id, v_percentage_invoice_id);

  UPDATE public.invoices SET status = 'viewed' WHERE id = v_invoice_id;
  UPDATE public.invoices SET status = 'overdue' WHERE id = v_percentage_invoice_id;

  IF has_function_privilege('anon', 'public.record_invoice_schedule_payment(uuid,uuid,numeric,date,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.record_invoice_schedule_payment(uuid,uuid,numeric,date,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_invoice_schedule_payment must not be executable by anon or service_role';
  END IF;

  -- The payment-to-schedule FK binds all three identity columns.
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    INSERT INTO public.payments (
      organization_id, invoice_id, payment_schedule_id, amount, payment_date, method, created_by
    ) VALUES (
      v_org_id, v_invoice_id, v_foreign_schedule, 1, CURRENT_DATE, 'test', v_owner_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '23503'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_invoice_id) THEN
    RAISE EXCEPTION 'A payment could reference a schedule from another invoice/organization';
  END IF;


  -- Raw authenticated INSERT cannot bypass the receipt RPC.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    INSERT INTO public.payments (
      organization_id, invoice_id, payment_schedule_id, amount, payment_date, method, created_by
    ) VALUES (
      v_org_id, v_invoice_id, v_schedule_one, 1, CURRENT_DATE, 'manual', v_owner_id
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_invoice_id) THEN
    RAISE EXCEPTION 'Authenticated raw payment INSERT bypassed receipt authority';
  END IF;


  -- A payment above the schedule amount is rejected without creating a payment.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.record_invoice_schedule_payment(
      v_invoice_id, v_schedule_one, 600.01, CURRENT_DATE, 'virement', 'OVERSHOOT', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '22023'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_invoice_id) THEN
    RAISE EXCEPTION 'Schedule overpayment was not rejected atomically';
  END IF;
  -- Zero and negative amounts are also refused before any write.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOREACH v_invalid_amount IN ARRAY ARRAY[0::NUMERIC, -0.01::NUMERIC] LOOP
    v_blocked := false;
    v_sqlstate := NULL;
    BEGIN
      PERFORM public.record_invoice_schedule_payment(
        v_invoice_id, v_schedule_one, v_invalid_amount, CURRENT_DATE, NULL, NULL, NULL
      );
    EXCEPTION WHEN OTHERS THEN
      v_blocked := true;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    END;
    IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '22023'
       OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_invoice_id) THEN
      RAISE EXCEPTION 'A non-positive schedule amount was not refused atomically';
    END IF;
  END LOOP;
  EXECUTE 'RESET ROLE';

  -- A partial receipt leaves its schedule open with an exact remaining balance.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.record_invoice_schedule_payment(
    v_invoice_id, v_schedule_one, 400, CURRENT_DATE, 'virement', 'PART-1', NULL
  ) INTO v_result;
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' IS DISTINCT FROM 'partial'
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 400
     OR (v_result->>'schedule_paid')::NUMERIC IS DISTINCT FROM 400
     OR (v_result->>'schedule_remaining')::NUMERIC IS DISTINCT FROM 200
     OR (v_result->>'schedule_completed')::BOOLEAN IS DISTINCT FROM false
     OR (SELECT amount FROM public.payments WHERE invoice_id = v_invoice_id) <> 400
     OR NOT EXISTS (
       SELECT 1 FROM public.payments
       WHERE invoice_id = v_invoice_id AND payment_schedule_id = v_schedule_one
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.invoice_payment_schedule
       WHERE id = v_schedule_one AND paid_payment_id IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices WHERE id = v_invoice_id AND status = 'partial' AND total_paid = 400
     ) THEN
    RAISE EXCEPTION 'A valid partial payment did not leave its schedule open with the remaining balance';
  END IF;


  -- Authenticated direct edits cannot rewrite or erase the RPC ledger.
  SELECT id INTO v_payment_id FROM public.payments
  WHERE invoice_id = v_invoice_id AND payment_schedule_id = v_schedule_one;
  IF v_payment_id IS NULL THEN
    RAISE EXCEPTION 'The valid receipt RPC did not create a payment row';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.payments SET amount = 399 WHERE id = v_payment_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501' THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'Authenticated raw payment UPDATE bypassed receipt authority';
  END IF;
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    DELETE FROM public.payments WHERE id = v_payment_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR NOT EXISTS (SELECT 1 FROM public.payments WHERE id = v_payment_id AND amount = 400) THEN
    RAISE EXCEPTION 'Authenticated raw payment DELETE bypassed receipt authority';
  END IF;


  -- A second receipt cannot exceed the schedule remainder.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.record_invoice_schedule_payment(
      v_invoice_id, v_schedule_one, 200.01, CURRENT_DATE, 'virement', 'REMAINDER-OVERSHOOT', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '22023'
     OR (SELECT count(*) FROM public.payments WHERE payment_schedule_id = v_schedule_one) <> 1
     OR (SELECT paid_payment_id FROM public.invoice_payment_schedule WHERE id = v_schedule_one) IS NOT NULL THEN
    RAISE EXCEPTION 'A receipt exceeded the remaining amount of its partially paid schedule';
  END IF;

  -- The exact remaining amount completes the schedule without exceeding invoice balance.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.record_invoice_schedule_payment(
    v_invoice_id, v_schedule_one, 200, CURRENT_DATE, 'virement', 'PART-1-CLOSE', NULL
  ) INTO v_result;
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' IS DISTINCT FROM 'partial'
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 600
     OR (v_result->>'schedule_paid')::NUMERIC IS DISTINCT FROM 600
     OR (v_result->>'schedule_remaining')::NUMERIC IS DISTINCT FROM 0
     OR (v_result->>'schedule_completed')::BOOLEAN IS DISTINCT FROM true
     OR (SELECT sum(amount) FROM public.payments WHERE payment_schedule_id = v_schedule_one) <> 600
     OR (SELECT paid_payment_id FROM public.invoice_payment_schedule WHERE id = v_schedule_one)
        IS DISTINCT FROM (v_result->>'payment_id')::UUID THEN
    RAISE EXCEPTION 'The schedule was not marked paid after its exact remainder was received';
  END IF;
  v_payment_id := (v_result->>'payment_id')::UUID;

  -- Completed schedules refuse another receipt.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.record_invoice_schedule_payment(
      v_invoice_id, v_schedule_one, 1, CURRENT_DATE, 'virement', 'DUPLICATE', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '22023'
     OR (SELECT count(*) FROM public.payments WHERE payment_schedule_id = v_schedule_one) <> 2
     OR (SELECT paid_payment_id FROM public.invoice_payment_schedule WHERE id = v_schedule_one)
        IS DISTINCT FROM v_payment_id THEN
    RAISE EXCEPTION 'A completed schedule item accepted another payment';
  END IF;

  -- Another schedule receipt remains valid when it is below invoice outstanding.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.record_invoice_schedule_payment(
    v_invoice_id, v_schedule_two, 400, CURRENT_DATE, 'virement', 'PART-2', NULL
  ) INTO v_result;
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' IS DISTINCT FROM 'partial'
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 1000
     OR (v_result->>'schedule_paid')::NUMERIC IS DISTINCT FROM 400
     OR (v_result->>'schedule_remaining')::NUMERIC IS DISTINCT FROM 200
     OR (v_result->>'schedule_completed')::BOOLEAN IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'A valid partial receipt below invoice outstanding was not accepted';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.record_invoice_schedule_payment(
      v_invoice_id, v_schedule_competitor, 200.01, CURRENT_DATE, 'virement', 'RACE-OVERSHOOT', NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '22023'
     OR (SELECT sum(amount) FROM public.payments WHERE invoice_id = v_invoice_id) <> 1000
     OR (SELECT paid_payment_id FROM public.invoice_payment_schedule WHERE id = v_schedule_competitor) IS NOT NULL THEN
    RAISE EXCEPTION 'Competing schedule payment exceeded the remaining invoice balance';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.record_invoice_schedule_payment(
    v_invoice_id, v_schedule_competitor, 200, CURRENT_DATE, 'virement', 'PART-3', NULL
  ) INTO v_result;
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' IS DISTINCT FROM 'paid'
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 1200
     OR (v_result->>'invoice_outstanding')::NUMERIC IS DISTINCT FROM 0
     OR (SELECT sum(amount) FROM public.payments WHERE invoice_id = v_invoice_id) <> 1200
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_invoice_id AND status = 'paid' AND total_paid = 1200) THEN
    RAISE EXCEPTION 'The exact remaining invoice balance was not accepted as a full payment';
  END IF;


  -- Percentage schedules use the invoice TTC as their authoritative base.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.record_invoice_schedule_payment(
      v_percentage_invoice_id, v_percentage_schedule, 300.01, CURRENT_DATE, NULL, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '22023'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_percentage_invoice_id) THEN
    RAISE EXCEPTION 'A percentage schedule allowed more than 25 percent of invoice TTC';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  SELECT public.record_invoice_schedule_payment(
    v_percentage_invoice_id, v_percentage_schedule, 300, CURRENT_DATE, NULL, NULL, NULL
  ) INTO v_result;
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' IS DISTINCT FROM 'partial'
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 300 THEN
    RAISE EXCEPTION 'A correctly bounded percentage schedule was not accepted';
  END IF;

  -- Same-organization users without permission and foreign-organization users are refused.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.record_invoice_schedule_payment(
      v_permission_invoice_id, v_permission_schedule, 10, CURRENT_DATE, NULL, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_permission_invoice_id) THEN
    RAISE EXCEPTION 'A user without payment permission was not refused';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_foreign_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.record_invoice_schedule_payment(
      v_permission_invoice_id, v_permission_schedule, 10, CURRENT_DATE, NULL, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM 'P0002'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_permission_invoice_id) THEN
    RAISE EXCEPTION 'A foreign organization caller was not refused without a write';
  END IF;
END;
$test$;

ROLLBACK;
