-- Run only against a disposable local Supabase database migrated through 225.
-- Exercises direct authenticated invoice DML and both receipt RPCs as real roles.
-- Fixtures roll back on success.
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
  v_client_id UUID := gen_random_uuid();
  v_foreign_client_id UUID := gen_random_uuid();
  v_draft_invoice_id UUID := gen_random_uuid();
  v_paid_rpc_invoice_id UUID := gen_random_uuid();
  v_schedule_invoice_id UUID := gen_random_uuid();
  v_viewer_invoice_id UUID := gen_random_uuid();
  v_lifecycle_invoice_id UUID := gen_random_uuid();
  v_cancel_invoice_id UUID := gen_random_uuid();
  v_seed_amount_invoice_id UUID := gen_random_uuid();
  v_seed_date_invoice_id UUID := gen_random_uuid();
  v_schedule_id UUID := gen_random_uuid();
  v_legacy_invoice_id UUID;
  v_result JSONB;
  v_attempt_status TEXT;
  v_blocked BOOLEAN;
  v_sqlstate TEXT;
  v_error_message TEXT;
  v_row_count BIGINT;
  v_legacy_before public.invoices%ROWTYPE;
  v_legacy_after public.invoices%ROWTYPE;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);

  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject)
  VALUES
    (v_org_id, 'Invoice write authority', 'invoice-write-' || v_org_id::TEXT,
     'invoice-write-' || v_org_id::TEXT || '@example.invalid', 'construction', true),
    (v_foreign_org_id, 'Foreign invoice write tenant', 'invoice-write-foreign-' || v_foreign_org_id::TEXT,
     'invoice-write-foreign-' || v_foreign_org_id::TEXT || '@example.invalid', 'construction', true);

  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES
    (v_client_id, v_org_id, 'company', 'Write authority buyer', 'write-buyer-' || v_client_id::TEXT || '@example.invalid'),
    (v_foreign_client_id, v_foreign_org_id, 'company', 'Foreign write buyer', 'foreign-write-buyer-' || v_foreign_client_id::TEXT || '@example.invalid');

  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_owner_role_id, v_org_id, 'Write authority owner', 'owner'),
    (v_viewer_role_id, v_org_id, 'Write authority viewer', 'write-viewer'),
    (v_foreign_role_id, v_foreign_org_id, 'Foreign write owner', 'foreign-write-owner');

  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_owner_id, 'authenticated', 'authenticated', 'write-owner-' || v_owner_id::TEXT || '@example.invalid', now()),
    (v_viewer_id, 'authenticated', 'authenticated', 'write-viewer-' || v_viewer_id::TEXT || '@example.invalid', now()),
    (v_foreign_owner_id, 'authenticated', 'authenticated', 'write-foreign-' || v_foreign_owner_id::TEXT || '@example.invalid', now());

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
    (v_owner_role_id, 'invoices.view', true),
    (v_owner_role_id, 'invoices.create', true),
    (v_owner_role_id, 'invoices.edit', true),
    (v_owner_role_id, 'invoices.send', true),
    (v_owner_role_id, 'invoices.delete', true),
    (v_owner_role_id, 'invoices.record_payment', true),
    (v_viewer_role_id, 'invoices.view', true),
    (v_viewer_role_id, 'invoices.edit', true),
    (v_viewer_role_id, 'invoices.record_payment', false),
    (v_foreign_role_id, 'invoices.view', true),
    (v_foreign_role_id, 'invoices.record_payment', true);

  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    total_ht, total_tva, total_ttc, currency
  ) VALUES
    (v_draft_invoice_id, v_org_id, v_client_id, v_owner_id,
     'FAC-WRITE-DRAFT-' || v_draft_invoice_id::TEXT, 'Ordinary draft', 'draft', 100, 20, 120, 'EUR'),
    (v_paid_rpc_invoice_id, v_org_id, v_client_id, v_owner_id,
     'FAC-WRITE-PAID-' || v_paid_rpc_invoice_id::TEXT, 'Full receipt RPC', 'draft', 100, 20, 120, 'EUR'),
    (v_schedule_invoice_id, v_org_id, v_client_id, v_owner_id,
     'FAC-WRITE-SCHEDULE-' || v_schedule_invoice_id::TEXT, 'Scheduled receipt RPC', 'draft', 100, 20, 120, 'EUR'),
    (v_viewer_invoice_id, v_org_id, v_client_id, v_owner_id,
     'FAC-WRITE-VIEWER-' || v_viewer_invoice_id::TEXT, 'Denied receipt target', 'draft', 100, 20, 120, 'EUR'),
    (v_lifecycle_invoice_id, v_org_id, v_client_id, v_owner_id,
     'FAC-WRITE-LIFECYCLE-' || v_lifecycle_invoice_id::TEXT, 'Status transition target', 'draft', 100, 20, 120, 'EUR'),
    (v_cancel_invoice_id, v_org_id, v_client_id, v_owner_id,
     'FAC-WRITE-CANCEL-' || v_cancel_invoice_id::TEXT, 'Draft cancellation target', 'draft', 0, 0, 0, 'EUR');

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, total_ht, position
  ) VALUES
    (v_paid_rpc_invoice_id, 'Paid RPC line', 1, 'u', 100, 20, 100, 0),
    (v_schedule_invoice_id, 'Schedule RPC line', 1, 'u', 100, 20, 100, 0),
    (v_viewer_invoice_id, 'Denied RPC line', 1, 'u', 100, 20, 100, 0),
    (v_lifecycle_invoice_id, 'Lifecycle line', 1, 'u', 100, 20, 100, 0);

  INSERT INTO public.invoice_payment_schedule (
    id, organization_id, invoice_id, label, due_date, amount, amount_type, percentage, position
  ) VALUES (
    v_schedule_id, v_org_id, v_schedule_invoice_id, 'First installment', DATE '2026-11-10',
    50, 'amount', NULL, 0
  );

  -- These are server-owned send claims, followed by the normal sent state.
  UPDATE public.invoices SET status = 'sending'
  WHERE id IN (v_paid_rpc_invoice_id, v_schedule_invoice_id, v_viewer_invoice_id, v_lifecycle_invoice_id);
  UPDATE public.invoices SET status = 'sent', sent_at = clock_timestamp()
  WHERE id IN (v_paid_rpc_invoice_id, v_schedule_invoice_id, v_viewer_invoice_id, v_lifecycle_invoice_id);

  -- Trusted CSV import keeps historical payment state without inventing a ledger
  -- receipt, paid date, or issuance snapshot.
  v_legacy_invoice_id := public.import_historical_document(
    'invoice', v_org_id, v_owner_id,
    pg_catalog.jsonb_build_object(
      'client_id', v_client_id,
      'number', 'FAC-WRITE-HIST-' || gen_random_uuid()::TEXT,
      'title', 'Historical paid invoice',
      'status', 'paid',
      'issue_date', '2023-01-15',
      'currency', 'EUR'
    ),
    pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'description', 'Historical imported line', 'quantity', 1, 'unit', 'u',
      'unit_price', 100, 'vat_rate', 20
    ))
  );

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- A legitimate owner can still edit ordinary draft headers.
  UPDATE public.invoices
  SET title = 'Edited ordinary draft'
  WHERE id = v_draft_invoice_id AND organization_id = v_org_id;
  IF NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_draft_invoice_id AND status = 'draft' AND title = 'Edited ordinary draft'
  ) THEN
    RAISE EXCEPTION 'Ordinary authenticated draft header editing was blocked';
  END IF;

  -- Draft INSERT cannot pre-seed either receipt counter or receipt date.
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    INSERT INTO public.invoices (
      id, organization_id, client_id, created_by, number, title, status,
      total_paid, total_ttc, currency
    ) VALUES (
      v_seed_amount_invoice_id, v_org_id, v_client_id, v_owner_id,
      'FAC-WRITE-SEED-AMOUNT-' || v_seed_amount_invoice_id::TEXT,
      'Forged draft balance', 'draft', 1, 120, 'EUR'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR EXISTS (SELECT 1 FROM public.invoices WHERE id = v_seed_amount_invoice_id) THEN
    RAISE EXCEPTION 'Authenticated draft INSERT seeded total_paid';
  END IF;

  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    INSERT INTO public.invoices (
      id, organization_id, client_id, created_by, number, title, status,
      paid_at, total_ttc, currency
    ) VALUES (
      v_seed_date_invoice_id, v_org_id, v_client_id, v_owner_id,
      'FAC-WRITE-SEED-DATE-' || v_seed_date_invoice_id::TEXT,
      'Forged draft payment date', 'draft', clock_timestamp(), 120, 'EUR'
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR EXISTS (SELECT 1 FROM public.invoices WHERE id = v_seed_date_invoice_id) THEN
    RAISE EXCEPTION 'Authenticated draft INSERT seeded paid_at';
  END IF;

  -- Permission to record payment is not permission to bypass either locked RPC.
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET total_paid = 1
    WHERE id = v_paid_rpc_invoice_id AND organization_id = v_org_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_paid_rpc_invoice_id AND total_paid = 0 AND paid_at IS NULL) THEN
    RAISE EXCEPTION 'Owner with invoices.record_payment rewrote total_paid directly';
  END IF;

  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET paid_at = clock_timestamp()
    WHERE id = v_paid_rpc_invoice_id AND organization_id = v_org_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_paid_rpc_invoice_id AND paid_at IS NULL) THEN
    RAISE EXCEPTION 'Owner with invoices.record_payment rewrote paid_at directly';
  END IF;

  FOREACH v_attempt_status IN ARRAY ARRAY['partial', 'paid']
  LOOP
    v_blocked := false;
    v_sqlstate := NULL;
    BEGIN
      UPDATE public.invoices SET status = v_attempt_status
      WHERE id = v_paid_rpc_invoice_id AND organization_id = v_org_id;
    EXCEPTION WHEN OTHERS THEN
      v_blocked := true;
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
    END;
    IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
       OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_paid_rpc_invoice_id AND status = 'sent') THEN
      RAISE EXCEPTION 'Owner with invoices.record_payment forged invoice receipt state %', v_attempt_status;
    END IF;
  END LOOP;

  -- Existing permitted non-receipt lifecycle transitions remain available.
  UPDATE public.invoices SET status = 'viewed'
  WHERE id = v_lifecycle_invoice_id AND organization_id = v_org_id;
  UPDATE public.invoices SET status = 'overdue'
  WHERE id = v_lifecycle_invoice_id AND organization_id = v_org_id;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_lifecycle_invoice_id AND status = 'overdue') THEN
    RAISE EXCEPTION 'Authenticated viewed/overdue lifecycle transitions were blocked';
  END IF;
  UPDATE public.invoices SET status = 'cancelled'
  WHERE id = v_cancel_invoice_id AND organization_id = v_org_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_cancel_invoice_id AND status = 'cancelled' AND unissued_cancelled_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Authenticated draft cancellation path was blocked';
  END IF;

  -- The exact full-payment RPC remains the receipt authority under authenticated.
  SELECT public.mark_invoice_paid(
    v_paid_rpc_invoice_id, DATE '2026-11-09', 'virement', 'VIR-WRITE-AUTHORITY'
  ) INTO v_result;
  IF v_result->>'changed' IS DISTINCT FROM 'true'
     OR (v_result->>'amount_recorded')::NUMERIC IS DISTINCT FROM 120
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 120
     OR (v_result->>'paid_at') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.payments
       WHERE invoice_id = v_paid_rpc_invoice_id AND organization_id = v_org_id
         AND amount = 120 AND payment_date = DATE '2026-11-09'
         AND method = 'virement' AND reference = 'VIR-WRITE-AUTHORITY'
         AND created_by = v_owner_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_paid_rpc_invoice_id AND status = 'paid' AND total_paid = 120
         AND paid_at = (v_result->>'paid_at')::TIMESTAMPTZ
     ) THEN
    RAISE EXCEPTION 'mark_invoice_paid did not record its receipt and metadata through authenticated RPC: %', v_result;
  END IF;

  -- The schedule RPC remains able to write a bounded positive receipt plus metadata.
  SELECT public.record_invoice_schedule_payment(
    v_schedule_invoice_id, v_schedule_id, 30, DATE '2026-11-08',
    'carte', 'SCHED-WRITE-AUTHORITY', 'Premier versement'
  ) INTO v_result;
  IF v_result->>'status' IS DISTINCT FROM 'partial'
     OR (v_result->>'total_paid')::NUMERIC IS DISTINCT FROM 30
     OR (v_result->>'schedule_paid')::NUMERIC IS DISTINCT FROM 30
     OR (v_result->>'schedule_remaining')::NUMERIC IS DISTINCT FROM 20
     OR (v_result->>'schedule_completed')::BOOLEAN IS DISTINCT FROM false
     OR NOT EXISTS (
       SELECT 1 FROM public.payments
       WHERE id = (v_result->>'payment_id')::UUID
         AND invoice_id = v_schedule_invoice_id AND organization_id = v_org_id
         AND payment_schedule_id = v_schedule_id AND amount = 30
         AND payment_date = DATE '2026-11-08' AND method = 'carte'
         AND reference = 'SCHED-WRITE-AUTHORITY' AND notes = 'Premier versement'
         AND created_by = v_owner_id
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_schedule_invoice_id AND status = 'partial' AND total_paid = 30 AND paid_at IS NULL
     ) THEN
    RAISE EXCEPTION 'record_invoice_schedule_payment did not record its receipt and metadata through authenticated RPC: %', v_result;
  END IF;

  -- Reads and no-op payment-state updates preserve historical imported facts.
  SELECT i.* INTO v_legacy_before
  FROM public.invoices AS i WHERE i.id = v_legacy_invoice_id AND i.organization_id = v_org_id;
  IF NOT FOUND OR v_legacy_before.status IS DISTINCT FROM 'paid'
     OR v_legacy_before.total_paid IS DISTINCT FROM 0
     OR v_legacy_before.paid_at IS NOT NULL
     OR v_legacy_before.issuance_snapshot IS NOT NULL
     OR v_legacy_before.historical_import IS NULL THEN
    RAISE EXCEPTION 'Historical paid fixture did not preserve its original unverified facts';
  END IF;
  UPDATE public.invoices
  SET status = status, total_paid = total_paid, paid_at = paid_at
  WHERE id = v_legacy_invoice_id AND organization_id = v_org_id;
  SELECT i.* INTO v_legacy_after
  FROM public.invoices AS i WHERE i.id = v_legacy_invoice_id AND i.organization_id = v_org_id;
  IF NOT FOUND
     OR v_legacy_after.status IS DISTINCT FROM v_legacy_before.status
     OR v_legacy_after.total_paid IS DISTINCT FROM v_legacy_before.total_paid
     OR v_legacy_after.paid_at IS DISTINCT FROM v_legacy_before.paid_at
     OR v_legacy_after.issuance_snapshot IS DISTINCT FROM v_legacy_before.issuance_snapshot
     OR v_legacy_after.historical_import IS DISTINCT FROM v_legacy_before.historical_import
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_legacy_invoice_id) THEN
    RAISE EXCEPTION 'Harmless read/no-op write changed or fabricated historical invoice receipt facts';
  END IF;
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET status = 'sent'
    WHERE id = v_legacy_invoice_id AND organization_id = v_org_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_legacy_invoice_id AND status = 'paid' AND total_paid = 0 AND paid_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Authenticated DML demoted a historical paid receipt state';
  END IF;


  -- The same-tenant editor without record_payment is denied by the established
  -- lifecycle permission convention and by both receipt RPCs.
  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::TEXT, true);
  v_blocked := false;
  v_sqlstate := NULL;
  v_error_message := NULL;
  BEGIN
    UPDATE public.invoices SET total_paid = 1
    WHERE id = v_viewer_invoice_id AND organization_id = v_org_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS
      v_sqlstate = RETURNED_SQLSTATE,
      v_error_message = MESSAGE_TEXT;
  END;
  IF NOT v_blocked
     OR NOT (
       v_sqlstate = '42501'
       OR (v_sqlstate = 'P0001'
           AND v_error_message IS NOT DISTINCT FROM 'invoices.record_payment requis pour modifier un paiement')
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_viewer_invoice_id AND total_paid = 0 AND paid_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Actor without invoices.record_payment rewrote payment state (blocked %, SQLSTATE %, message %)',
      v_blocked, v_sqlstate, v_error_message;
  END IF;
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.mark_invoice_paid(v_viewer_invoice_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_viewer_invoice_id) THEN
    RAISE EXCEPTION 'Actor without invoices.record_payment was not denied by mark_invoice_paid';
  END IF;
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.record_invoice_schedule_payment(
      v_schedule_invoice_id, v_schedule_id, 1, CURRENT_DATE, NULL, NULL, NULL
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501'
     OR (SELECT count(*) FROM public.payments WHERE invoice_id = v_schedule_invoice_id) <> 1 THEN
    RAISE EXCEPTION 'Actor without invoices.record_payment was not denied by the scheduled receipt RPC';
  END IF;

  -- A foreign tenant cannot mutate the target row or record against it by RPC.
  PERFORM set_config('request.jwt.claim.sub', v_foreign_owner_id::TEXT, true);
  UPDATE public.invoices SET title = 'Foreign write'
  WHERE id = v_paid_rpc_invoice_id AND organization_id = v_org_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 0 THEN
    RAISE EXCEPTION 'Foreign organization updated another tenant invoice';
  END IF;
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.mark_invoice_paid(v_paid_rpc_invoice_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM 'P0002' THEN
    RAISE EXCEPTION 'Foreign organization payment RPC did not preserve invoice isolation';
  END IF;

  EXECUTE 'RESET ROLE';
END;
$test$;

ROLLBACK;
