-- Disposable LOCAL Supabase database migrated through 225.
-- Exercises the quote-bounded balance and immutable Avoir lifecycle end to end.
-- All fixture rows are rolled back on success.
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
  v_quote_id UUID := gen_random_uuid();
  v_deposit_id UUID := gen_random_uuid();
  v_balance_credit_id UUID;
  v_balance_id UUID;
  v_overflow_id UUID := gen_random_uuid();
  v_credit_source_id UUID := gen_random_uuid();
  v_credit_id UUID;
  v_credit_retry_id UUID;
  v_payment JSONB;
  v_source_snapshot JSONB;
  v_source_snapshot_after JSONB;
  v_blocked BOOLEAN;
  v_sqlstate TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);

  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject)
  VALUES
    (v_org_id, 'Invoice adjustment tenant', 'invoice-adjustment-' || v_org_id::TEXT,
     'invoice-adjustment-' || v_org_id::TEXT || '@example.invalid', 'construction', true),
    (v_foreign_org_id, 'Foreign adjustment tenant', 'invoice-adjustment-foreign-' || v_foreign_org_id::TEXT,
     'invoice-adjustment-foreign-' || v_foreign_org_id::TEXT || '@example.invalid', 'construction', true);

  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES
    (v_client_id, v_org_id, 'company', 'Adjustment test buyer', 'adjustment-buyer-' || v_client_id::TEXT || '@example.invalid'),
    (v_foreign_client_id, v_foreign_org_id, 'company', 'Foreign adjustment buyer', 'foreign-adjustment-' || v_foreign_client_id::TEXT || '@example.invalid');

  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_owner_role_id, v_org_id, 'Adjustment owner', 'adjustment-owner-' || v_org_id::TEXT),
    (v_viewer_role_id, v_org_id, 'Adjustment viewer', 'adjustment-viewer-' || v_org_id::TEXT),
    (v_foreign_role_id, v_foreign_org_id, 'Foreign adjustment owner', 'foreign-adjustment-owner-' || v_foreign_org_id::TEXT);

  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_owner_id, 'authenticated', 'authenticated', 'adjustment-owner-' || v_owner_id::TEXT || '@example.invalid', now()),
    (v_viewer_id, 'authenticated', 'authenticated', 'adjustment-viewer-' || v_viewer_id::TEXT || '@example.invalid', now()),
    (v_foreign_owner_id, 'authenticated', 'authenticated', 'foreign-adjustment-' || v_foreign_owner_id::TEXT || '@example.invalid', now());

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
    (v_owner_role_id, 'invoices.create', true),
    (v_owner_role_id, 'invoices.edit', true),
    (v_owner_role_id, 'invoices.send', true),
    (v_owner_role_id, 'invoices.view', true),
    (v_owner_role_id, 'invoices.record_payment', true),
    (v_owner_role_id, 'invoices.create_solde', true),
    (v_owner_role_id, 'invoices.create_credit', true),
    (v_foreign_role_id, 'invoices.create_solde', true),
    (v_foreign_role_id, 'invoices.create_credit', true);

  INSERT INTO public.quotes (
    id, organization_id, client_id, number, title, status, total_ht, total_tva, total_ttc
  ) VALUES (
    v_quote_id, v_org_id, v_client_id, 'DEV-ADJUSTMENT-1', 'Travaux acceptés', 'draft',
    503.03, 100.61, 603.64
  );
  INSERT INTO public.quote_items (quote_id, description, quantity, unit, unit_price, vat_rate, total_ht, position)
  VALUES
    (v_quote_id, 'Ligne principale', 8, 'u', 62.80, 20, 502.40, 0),
    (v_quote_id, 'Ligne fractionnaire', 0.001, 'u', 625.50, 20, 0.63, 1);
  UPDATE public.quotes SET status = 'sent' WHERE id = v_quote_id;
  UPDATE public.quotes SET status = 'accepted' WHERE id = v_quote_id;
  INSERT INTO public.invoices (
    id, organization_id, client_id, quote_id, created_by, invoice_type, title, status,
    currency, issue_date, due_date, total_ht, total_tva, total_ttc, is_reverse_charge
  ) VALUES (
    v_deposit_id, v_org_id, v_client_id, v_quote_id, v_owner_id, 'acompte', 'Acompte payé', 'draft',
    'EUR', CURRENT_DATE, CURRENT_DATE + 30, 150.91, 30.18, 181.09, false
  );
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_deposit_id, 'Acompte sur devis', 1, 'forfait', 150.91, 20, 0);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_deposit_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_deposit_id;

  -- A paid deposit is counted by its authoritative issued invoice, not by a UI
  -- estimate or by mutating the accepted quote's deposit fields.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_payment := public.mark_invoice_paid(v_deposit_id, CURRENT_DATE, 'virement', 'ACOMPTE-TEST');
  v_balance_id := public.create_quote_balance_invoice(v_quote_id);
  EXECUTE 'RESET ROLE';

  IF v_payment->>'changed' IS DISTINCT FROM 'true'
     OR (v_payment->>'amount_recorded')::NUMERIC IS DISTINCT FROM 181.09
     OR NOT EXISTS (
       SELECT 1 FROM public.payments
       WHERE invoice_id = v_deposit_id AND payment_date = CURRENT_DATE
         AND method = 'virement' AND reference = 'ACOMPTE-TEST'
     ) THEN
    RAISE EXCEPTION 'The deposit was not recorded as paid with the requested payment details';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_balance_id AND invoice_type = 'solde' AND status = 'draft'
      AND number IS NOT NULL AND quote_id = v_quote_id
      AND total_ht = 352.12 AND total_tva = 70.43 AND total_ttc = 422.55
      AND applied_acompte_ht = 150.91
      AND vat_breakdown = '[{"rate":20,"taxable_basis":352.12,"tax_amount":70.43}]'::JSONB
      AND is_reverse_charge IS FALSE
  ) OR NOT EXISTS (
    SELECT 1 FROM public.invoice_items
    WHERE invoice_id = v_balance_id AND is_internal IS NOT TRUE
      AND ROUND(quantity * unit_price, 2) = 352.12
  ) THEN
    RAISE EXCEPTION 'The balance draft did not use cumulative accepted VAT less its issued deposit';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET total_tva = 70.42 WHERE id = v_balance_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '23514'
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_balance_id AND total_tva = 70.43) THEN
    RAISE EXCEPTION 'A caller could mutate the quote-derived balance tax authority';
  END IF;


  -- A duplicate balance is rejected by the authority, independently of UI state.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.create_quote_balance_invoice(v_quote_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'A second balance draft was not rejected as a duplicate';
  END IF;

  -- The exact residual is issuable, but an extra cent cannot exceed the quote.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_balance_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_balance_id;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_balance_credit_id := public.create_invoice_credit_note(v_balance_id, 'Avoir intégral du solde');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_balance_credit_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_balance_credit_id;
  IF NOT EXISTS (
    SELECT 1
    FROM public.invoices AS credit
    JOIN public.invoices AS source ON source.id = v_balance_id
    WHERE credit.id = v_balance_credit_id
      AND credit.status = 'sent'
      AND credit.issuance_snapshot->'invoice'->>'applied_acompte_ht' = '150.91'
      AND credit.issuance_snapshot->'invoice'->'vat_breakdown' =
          source.issuance_snapshot->'invoice'->'vat_breakdown'
      AND source.status = 'sent'
  ) THEN
    RAISE EXCEPTION 'The Avoir of a balance did not preserve its frozen VAT and applied-deposit authorities';
  END IF;
  -- The Avoir restores the residual to the quote ledger only as a credit;
  -- it does not mutate or cancel the issued source invoice.
  INSERT INTO public.invoices (
    id, organization_id, client_id, quote_id, created_by, title, status,
    currency, issue_date, due_date, total_ht, total_tva, total_ttc
  ) VALUES (
    v_overflow_id, v_org_id, v_client_id, v_quote_id, v_owner_id, 'Facture au-delà du devis', 'draft',
    'EUR', CURRENT_DATE, CURRENT_DATE + 30, 352.13, 70.43, 422.56
  );
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_overflow_id, 'Ligne excédentaire', 1, 'forfait', 352.13, 20, 0);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET status = 'sending' WHERE id = v_overflow_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '23514'
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_overflow_id AND status = 'draft' AND issuance_snapshot IS NULL) THEN
    RAISE EXCEPTION 'Issuance above the accepted quote was not rejected without changing the draft';
  END IF;

  -- Avoirs are issued with positive source-derived lines, a legal 381 code and
  -- the original invoice reference; source issuance authority remains immutable.
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, title, status, currency,
    issue_date, due_date, total_ht, total_tva, total_ttc
  ) VALUES (
    v_credit_source_id, v_org_id, v_client_id, v_owner_id, 'Facture source', 'draft', 'EUR',
    CURRENT_DATE, CURRENT_DATE + 30, 100, 20, 120
  );
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES
    (v_credit_source_id, 'Travail TVA 20', 1, 'forfait', 100, 20, 0);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_credit_source_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_credit_source_id;
  SELECT issuance_snapshot INTO v_source_snapshot FROM public.invoices WHERE id = v_credit_source_id;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_credit_id := public.create_invoice_credit_note(v_credit_source_id, 'Correction de la facture');
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET total_tva = 19.99 WHERE id = v_credit_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '23514'
     OR NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_credit_id AND total_tva = 20) THEN
    RAISE EXCEPTION 'A caller could mutate the issued-invoice credit-note authority';
  END IF;

  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.create_invoice_credit_note(v_credit_source_id, 'Second brouillon interdit');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '23505' THEN
    RAISE EXCEPTION 'A duplicate Avoir draft was not rejected';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_credit_id AND invoice_type = 'avoir' AND invoice_type_code = '381'
      AND credit_note_for = v_credit_source_id AND preceding_invoice_ref IS NOT NULL
      AND preceding_invoice_date = CURRENT_DATE AND number IS NOT NULL
      AND status = 'draft' AND total_ht = 100 AND total_tva = 20 AND total_ttc = 120
  ) OR NOT EXISTS (
    SELECT 1 FROM public.invoice_items
    WHERE invoice_id = v_credit_id AND unit_price > 0 AND is_internal IS NOT TRUE
  ) THEN
    RAISE EXCEPTION 'The credit-note draft lacks its legal reference, type or positive source-derived lines';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_credit_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_credit_id;
  SELECT issuance_snapshot INTO v_source_snapshot_after FROM public.invoices WHERE id = v_credit_source_id;
  IF v_source_snapshot_after IS DISTINCT FROM v_source_snapshot OR NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_credit_id
      AND issuance_snapshot->'invoice'->>'invoice_type_code' = '381'
      AND issuance_snapshot->'invoice'->>'preceding_invoice_ref' =
        (SELECT number FROM public.invoices WHERE id = v_credit_source_id)
  ) THEN
    RAISE EXCEPTION 'Avoir issuance authority changed the source or failed to preserve its 381 reference';
  END IF;

  -- A fully credited invoice must never acquire a manual/cron reminder claim.
  EXECUTE 'SET LOCAL ROLE service_role';
  v_blocked := false;
  BEGIN
    PERFORM public.claim_document_reminder(v_org_id, v_credit_source_id, NULL);
  EXCEPTION WHEN SQLSTATE 'P2001' THEN
    v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR EXISTS (
    SELECT 1 FROM public.document_reminder_dispatches
    WHERE invoice_id = v_credit_source_id
  ) THEN
    RAISE EXCEPTION 'A fully credited source remained eligible for reminder delivery';
  END IF;

  -- The fully credited source cannot be credited a second time.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    v_credit_retry_id := public.create_invoice_credit_note(v_credit_source_id, 'Crédit intégral déjà émis');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '23514'
     OR EXISTS (
       SELECT 1 FROM public.invoices
       WHERE credit_note_for = v_credit_source_id AND invoice_type = 'avoir' AND status = 'draft'
     ) THEN
    RAISE EXCEPTION 'A second full Avoir was not prevented after the source was fully credited';
  END IF;

  -- Same-tenant viewer is denied; a different tenant cannot target source IDs.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.create_quote_balance_invoice(v_quote_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM '42501' THEN
    RAISE EXCEPTION 'A same-organization member without solde permission was not denied';
  END IF;

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_foreign_owner_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_sqlstate := NULL;
  BEGIN
    PERFORM public.create_invoice_credit_note(v_credit_source_id, 'Cross-tenant attempt');
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR v_sqlstate IS DISTINCT FROM 'P0002' THEN
    RAISE EXCEPTION 'A permitted user from another organization was not denied access to the source invoice';
  END IF;
END;
$test$;

ROLLBACK;
