-- Run only against a disposable LOCAL Supabase database migrated through 224.
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/client-billed-totals.sql
-- All fixture rows are rolled back on success.
BEGIN;

DO $test$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_foreign_org_id UUID := gen_random_uuid();
  v_owner_id UUID := gen_random_uuid();
  v_role_id UUID := gen_random_uuid();
  v_client_id UUID := gen_random_uuid();
  v_second_client_id UUID := gen_random_uuid();
  v_legacy_client_id UUID := gen_random_uuid();
  v_foreign_client_id UUID := gen_random_uuid();
  v_source_invoice_id UUID := gen_random_uuid();
  v_credit_note_id UUID := gen_random_uuid();
  v_receipt_invoice_id UUID := gen_random_uuid();
  v_movable_draft_id UUID := gen_random_uuid();
  v_second_invoice_id UUID := gen_random_uuid();
  v_foreign_invoice_id UUID := gen_random_uuid();
  v_cancelled_draft_id UUID := gen_random_uuid();
  v_legacy_invoice_id UUID;
  v_legacy_cancelled_invoice_id UUID;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner_id::TEXT, true);

  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject)
  VALUES
    (v_org_id, 'Client billed totals', 'client-billed-' || v_org_id::TEXT,
     'client-billed-' || v_org_id::TEXT || '@example.invalid', 'construction', true),
    (v_foreign_org_id, 'Foreign billed totals', 'client-billed-foreign-' || v_foreign_org_id::TEXT,
     'client-billed-foreign-' || v_foreign_org_id::TEXT || '@example.invalid', 'construction', true);

  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES
    (v_client_id, v_org_id, 'company', 'Billed buyer', 'billed-' || v_client_id::TEXT || '@example.invalid'),
    (v_second_client_id, v_org_id, 'company', 'Second buyer', 'billed-' || v_second_client_id::TEXT || '@example.invalid'),
    (v_legacy_client_id, v_org_id, 'company', 'Legacy buyer', 'billed-' || v_legacy_client_id::TEXT || '@example.invalid'),
    (v_foreign_client_id, v_foreign_org_id, 'company', 'Foreign buyer', 'billed-' || v_foreign_client_id::TEXT || '@example.invalid');

  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES (v_role_id, v_org_id, 'Historical import actor', 'client-billed-' || v_org_id::TEXT);
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES (v_owner_id, 'authenticated', 'authenticated', 'client-billed-owner-' || v_owner_id::TEXT || '@example.invalid', now());
  UPDATE public.memberships SET is_active = false WHERE user_id = v_owner_id;
  INSERT INTO public.memberships (organization_id, user_id, role_id, accepted_at, is_active)
  VALUES (v_org_id, v_owner_id, v_role_id, now(), true);

  -- A draft has money on its row but is not invoiced TTC.
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    total_ht, total_tva, total_ttc
  ) VALUES (
    gen_random_uuid(), v_org_id, v_client_id, v_owner_id, 'CBT-DRAFT-' || v_client_id::TEXT,
    'Unissued draft', 'draft', 30, 6, 36
  );
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 0::NUMERIC THEN
    RAISE EXCEPTION 'A draft increased the client invoiced-TTC cache';
  END IF;

  -- New, explicitly unissued cancellations are excluded; the DB marker is the
  -- positive provenance, unlike an absent marker on a legacy cancellation.
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    total_ht, total_tva, total_ttc
  ) VALUES (
    v_cancelled_draft_id, v_org_id, v_client_id, v_owner_id,
    'CBT-CANCELLED-' || v_client_id::TEXT, 'Unissued cancelled draft', 'draft', 20, 4, 24
  );
  UPDATE public.invoices SET status = 'cancelled' WHERE id = v_cancelled_draft_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_cancelled_draft_id AND unissued_cancelled_at IS NOT NULL
  ) OR (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 0::NUMERIC THEN
    RAISE EXCEPTION 'A genuinely unissued cancellation was included in billed TTC';
  END IF;

  -- A genuinely emitted invoice becomes billed TTC only on sent, not while
  -- issuance is provisionally claimed as sending.
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    issue_date, due_date, total_ht, total_tva, total_ttc
  ) VALUES (
    v_source_invoice_id, v_org_id, v_client_id, v_owner_id,
    'CBT-SOURCE-' || v_source_invoice_id::TEXT, 'Source invoice', 'draft',
    CURRENT_DATE, CURRENT_DATE + 30, 100, 20, 120
  );
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_source_invoice_id, 'Issued work', 1, 'forfait', 100, 20, 0);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_source_invoice_id;
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 0::NUMERIC THEN
    RAISE EXCEPTION 'A provisional sending claim was counted as an emitted invoice';
  END IF;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_source_invoice_id;
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 120::NUMERIC
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_source_invoice_id AND issuance_snapshot IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'An emitted invoice did not add its TTC to the client projection';
  END IF;

  -- A full positive-valued Avoir must reverse, not add, the issued amount.
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status, currency,
    issue_date, due_date, total_ht, total_tva, total_ttc, invoice_type,
    is_credit_note, credit_note_for, invoice_type_code, preceding_invoice_ref,
    preceding_invoice_date, is_reverse_charge, vat_breakdown
  ) VALUES (
    v_credit_note_id, v_org_id, v_client_id, v_owner_id,
    'CBT-CREDIT-' || v_credit_note_id::TEXT, 'Full credit note', 'draft', 'EUR',
    CURRENT_DATE, CURRENT_DATE, 100, 20, 120, 'avoir', true, v_source_invoice_id,
    '381', 'CBT-SOURCE-' || v_source_invoice_id::TEXT, CURRENT_DATE, false,
    '[{"rate":20,"taxable_basis":100,"tax_amount":20}]'::JSONB
  );
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_credit_note_id, 'Credited work', 1, 'forfait', 100, 20, 0);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_credit_note_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_credit_note_id;
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 0::NUMERIC
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_credit_note_id AND invoice_type = 'avoir'
         AND total_ttc = 120 AND issuance_snapshot IS NOT NULL
     ) THEN
    RAISE EXCEPTION 'A full issued Avoir was added instead of reversing the source TTC';
  END IF;

  -- A separate emitted invoice exercises payment-trigger and invoice-trigger
  -- updates: receipts change total_paid, never the invoiced-TTC measure.
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    issue_date, due_date, total_ht, total_tva, total_ttc
  ) VALUES (
    v_receipt_invoice_id, v_org_id, v_client_id, v_owner_id,
    'CBT-RECEIPT-' || v_receipt_invoice_id::TEXT, 'Receipt test invoice', 'draft',
    CURRENT_DATE, CURRENT_DATE + 30, 62.50, 12.50, 75
  );
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_receipt_invoice_id, 'Receipt-test work', 1, 'forfait', 62.50, 20, 0);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_receipt_invoice_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_receipt_invoice_id;
  UPDATE public.invoices SET status = 'partial', total_paid = 25 WHERE id = v_receipt_invoice_id;
  INSERT INTO public.payments (organization_id, invoice_id, client_id, amount, payment_date, method)
  VALUES (v_org_id, v_receipt_invoice_id, v_client_id, 25, CURRENT_DATE, 'virement');
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 75::NUMERIC
     OR (SELECT total_paid FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 25::NUMERIC THEN
    RAISE EXCEPTION 'A partial receipt changed billed TTC or failed to update the separate paid cache';
  END IF;
  INSERT INTO public.payments (organization_id, invoice_id, client_id, amount, payment_date, method)
  VALUES (v_org_id, v_receipt_invoice_id, v_client_id, 50, CURRENT_DATE, 'virement');
  UPDATE public.invoices SET status = 'paid', total_paid = 75 WHERE id = v_receipt_invoice_id;
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 75::NUMERIC
     OR (SELECT total_paid FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 75::NUMERIC THEN
    RAISE EXCEPTION 'A full receipt changed billed TTC or failed to update the separate paid cache';
  END IF;

  -- Archival is not cancellation and must not erase issued document history.
  UPDATE public.invoices SET is_archived = true WHERE id = v_receipt_invoice_id;
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 75::NUMERIC THEN
    RAISE EXCEPTION 'Archiving an emitted invoice erased its billed TTC';
  END IF;

  -- An issued invoice on another organization cannot affect this cache.
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    issue_date, due_date, total_ht, total_tva, total_ttc
  ) VALUES (
    v_foreign_invoice_id, v_foreign_org_id, v_foreign_client_id, v_owner_id,
    'CBT-FOREIGN-' || v_foreign_invoice_id::TEXT, 'Foreign invoice', 'draft',
    CURRENT_DATE, CURRENT_DATE + 30, 500, 100, 600
  );
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_foreign_invoice_id, 'Foreign work', 1, 'forfait', 500, 20, 0);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_foreign_invoice_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_foreign_invoice_id;
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 75::NUMERIC
     OR (SELECT total_revenue FROM public.clients WHERE id = v_foreign_client_id) IS DISTINCT FROM 600::NUMERIC THEN
    RAISE EXCEPTION 'An issued invoice crossed organization/client billed-TTC boundaries';
  END IF;

  -- Keep one real invoice on the destination client, then prove a draft
  -- linkage change refreshes both old and new client caches independently.
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    issue_date, due_date, total_ht, total_tva, total_ttc
  ) VALUES (
    v_second_invoice_id, v_org_id, v_second_client_id, v_owner_id,
    'CBT-SECOND-' || v_second_invoice_id::TEXT, 'Second-client invoice', 'draft',
    CURRENT_DATE, CURRENT_DATE + 30, 25, 5, 30
  );
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_second_invoice_id, 'Second-client work', 1, 'forfait', 25, 20, 0);
  UPDATE public.invoices SET status = 'sending' WHERE id = v_second_invoice_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_second_invoice_id;
  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    total_ht, total_tva, total_ttc
  ) VALUES (
    v_movable_draft_id, v_org_id, v_client_id, v_owner_id,
    'CBT-MOVABLE-' || v_movable_draft_id::TEXT, 'Movable unissued draft', 'draft', 10, 2, 12
  );
  UPDATE public.clients SET total_revenue = 999 WHERE id = v_client_id;
  UPDATE public.clients SET total_revenue = 888 WHERE id = v_second_client_id;
  UPDATE public.invoices SET client_id = v_second_client_id WHERE id = v_movable_draft_id;
  IF (SELECT total_revenue FROM public.clients WHERE id = v_client_id) IS DISTINCT FROM 75::NUMERIC
     OR (SELECT total_revenue FROM public.clients WHERE id = v_second_client_id) IS DISTINCT FROM 30::NUMERIC THEN
    RAISE EXCEPTION 'Changing invoice client linkage failed to refresh both prior and new clients';
  END IF;

  -- Imported historical invoices are explicitly unverified. Their supplied
  -- TTC remains visible in this operational projection without inventing an
  -- issuance snapshot; consumers must not treat it as verified issuance proof.
  v_legacy_invoice_id := public.import_historical_document(
    'invoice', v_org_id, v_owner_id,
    jsonb_build_object(
      'client_id', v_legacy_client_id,
      'number', 'CBT-LEGACY-' || v_legacy_client_id::TEXT,
      'title', 'Unverified historical invoice',
      'status', 'sent',
      'issue_date', '2025-01-15',
      'currency', 'EUR'
    ),
    '[{"description":"Imported work","quantity":1,"unit":"forfait","unit_price":50,"vat_rate":0}]'::JSONB
  );
  IF (SELECT total_revenue FROM public.clients WHERE id = v_legacy_client_id) IS DISTINCT FROM 50::NUMERIC
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_legacy_invoice_id
         AND issuance_snapshot IS NULL
         AND historical_import->>'verification' = 'unverified'
     ) THEN
    RAISE EXCEPTION 'A legacy unverified invoice was omitted or given fabricated issuance authority';
  END IF;

  -- A legacy cancellation with no unissued marker is ambiguous. Preserve its
  -- historical TTC rather than claiming that it was certainly unissued.
  v_legacy_cancelled_invoice_id := public.import_historical_document(
    'invoice', v_org_id, v_owner_id,
    jsonb_build_object(
      'client_id', v_legacy_client_id,
      'number', 'CBT-LEGACY-CANCELLED-' || v_legacy_client_id::TEXT,
      'title', 'Legacy cancellation without issuance proof',
      'status', 'sent',
      'issue_date', '2025-02-15',
      'currency', 'EUR'
    ),
    '[{"description":"Legacy cancelled work","quantity":1,"unit":"forfait","unit_price":20,"vat_rate":0}]'::JSONB
  );
  UPDATE public.invoices
  SET status = 'cancelled'
  WHERE id = v_legacy_cancelled_invoice_id;
  IF (SELECT total_revenue FROM public.clients WHERE id = v_legacy_client_id) IS DISTINCT FROM 70::NUMERIC
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_legacy_cancelled_invoice_id
         AND status = 'cancelled'
         AND unissued_cancelled_at IS NULL
         AND issuance_snapshot IS NULL
     ) THEN
    RAISE EXCEPTION 'An ambiguous legacy cancellation lost its historical TTC or gained fabricated issuance proof';
  END IF;
END;
$test$;

ROLLBACK;
