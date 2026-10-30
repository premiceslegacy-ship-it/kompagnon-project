-- Disposable LOCAL database migrated through 208. Every assertion rolls back.
BEGIN;
DO $test$
DECLARE
  v_org UUID := gen_random_uuid();
  v_other_org UUID := gen_random_uuid();
  v_actor UUID := gen_random_uuid();
  v_other_actor UUID := gen_random_uuid();
  v_role UUID := gen_random_uuid();
  v_other_role UUID := gen_random_uuid();
  v_client UUID := gen_random_uuid();
  v_other_client UUID := gen_random_uuid();
  v_invoice UUID;
  v_draft_invoice UUID;
  v_quote UUID;
  v_invoice_doc JSONB;
  v_quote_doc JSONB;
  v_items JSONB;
  v_blocked BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.organizations (id, name, slug, email, sector)
  VALUES
    (v_org, 'CSV import tenant', 'historical-import-' || v_org::TEXT,
     'historical-import-' || v_org::TEXT || '@example.invalid', 'construction'),
    (v_other_org, 'Other CSV tenant', 'historical-import-other-' || v_other_org::TEXT,
     'historical-import-other-' || v_other_org::TEXT || '@example.invalid', 'construction');
  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_role, v_org, 'Historical import actor', 'historical-import'),
    (v_other_role, v_other_org, 'Other import actor', 'historical-import-other');
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_actor, 'authenticated', 'authenticated', 'history-' || v_actor::TEXT || '@example.invalid', now()),
    (v_other_actor, 'authenticated', 'authenticated', 'history-' || v_other_actor::TEXT || '@example.invalid', now());
  INSERT INTO public.profiles (id, email)
  VALUES
    (v_actor, 'history-' || v_actor::TEXT || '@example.invalid'),
    (v_other_actor, 'history-' || v_other_actor::TEXT || '@example.invalid')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.memberships (organization_id, user_id, role_id, accepted_at, is_active)
  VALUES
    (v_org, v_actor, v_role, now(), true),
    (v_other_org, v_other_actor, v_other_role, now(), true);
  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES
    (v_client, v_org, 'company', 'CSV buyer', 'csv-buyer-' || v_client::TEXT || '@example.invalid'),
    (v_other_client, v_other_org, 'company', 'Other buyer', 'other-buyer-' || v_other_client::TEXT || '@example.invalid');
  v_invoice_doc := jsonb_build_object(
    'client_id', v_client, 'number', 'CSV-FAC-' || gen_random_uuid()::TEXT,
    'title', 'Imported paid invoice', 'status', 'paid', 'issue_date', '2023-01-15',
    'due_date', '2023-02-14', 'notes_client', 'Unverified CSV facts', 'currency', 'EUR'
  );
  v_items := jsonb_build_array(jsonb_build_object(
    'description', 'Imported invoice work', 'quantity', 2, 'unit', 'h',
    'unit_price', 123.45, 'vat_rate', 5.5
  ));
  EXECUTE 'SET LOCAL ROLE service_role';
  v_invoice := public.import_historical_document('invoice', v_org, v_actor, v_invoice_doc, v_items);
  EXECUTE 'RESET ROLE';

  IF NOT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = v_invoice AND i.organization_id = v_org AND i.client_id = v_client
      AND i.created_by = v_actor AND i.number = v_invoice_doc->>'number'
      AND i.status = 'paid' AND i.issue_date = DATE '2023-01-15'
      AND i.due_date = DATE '2023-02-14'
      AND i.total_ht = 246.90 AND i.total_tva = 13.58 AND i.total_ttc = 260.48
      AND i.issuance_snapshot IS NULL AND i.sent_at IS NULL AND i.paid_at IS NULL
      AND i.total_paid = 0
      AND i.historical_import->>'source' = 'csv'
      AND i.historical_import->>'verification' = 'unverified'
      AND i.historical_import->>'state' = 'finalized'
      AND i.historical_import->>'imported_at' IS NOT NULL
      AND i.historical_import->>'finalized_at' IS NOT NULL
      AND (SELECT count(*) FROM jsonb_object_keys(i.historical_import)) = 5
  ) THEN
    RAISE EXCEPTION 'Imported invoice state, dates, totals, or unverified provenance were not preserved';
  END IF;
  IF (SELECT count(*) FROM public.invoice_items WHERE invoice_id = v_invoice) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.invoice_items
       WHERE invoice_id = v_invoice AND description = 'Imported invoice work'
         AND quantity = 2 AND unit_price = 123.45 AND vat_rate = 5.5
         AND total_ht = 246.90 AND vat_amount = 13.58 AND position = 1
     ) OR EXISTS (SELECT 1 FROM public.payments WHERE invoice_id = v_invoice) THEN
    RAISE EXCEPTION 'Imported invoice lines were missing or a fake payment record was created';
  END IF;

  EXECUTE 'SET LOCAL ROLE service_role';
  v_draft_invoice := public.import_historical_document(
    'invoice', v_org, v_actor,
    jsonb_build_object('client_id', v_client, 'number', 'CSV-FAC-DRAFT-' || gen_random_uuid()::TEXT,
      'title', 'Imported draft invoice', 'status', 'draft', 'issue_date', '2024-02-03', 'currency', 'EUR'),
    jsonb_build_array(jsonb_build_object('description', 'Draft source line', 'quantity', 1,
      'unit', 'u', 'unit_price', 50, 'vat_rate', 20))
  );
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices i
    WHERE i.id = v_draft_invoice AND i.status = 'draft' AND i.issue_date = DATE '2024-02-03'
      AND i.issuance_snapshot IS NULL AND i.historical_import->>'state' = 'finalized'
      AND i.historical_import->>'source' = 'csv'
      AND i.historical_import->>'verification' = 'unverified'
      AND i.historical_import->>'finalized_at' IS NOT NULL
      AND (SELECT count(*) FROM jsonb_object_keys(i.historical_import)) = 5
  ) OR (SELECT count(*) FROM public.invoice_items WHERE invoice_id = v_draft_invoice) <> 1 THEN
    RAISE EXCEPTION 'An imported draft was not finalized with its source line and unverified marker';
  END IF;

  v_quote_doc := jsonb_build_object(
    'client_id', v_client, 'number', 'CSV-DEV-' || gen_random_uuid()::TEXT,
    'title', 'Imported accepted quote', 'status', 'accepted', 'issue_date', '2022-04-05',
    'valid_until', '2022-05-05', 'validity_days', 30,
    'notes_client', 'Unverified CSV offer', 'currency', 'EUR'
  );
  EXECUTE 'SET LOCAL ROLE service_role';
  v_quote := public.import_historical_document(
    'quote', v_org, v_actor, v_quote_doc,
    jsonb_build_array(jsonb_build_object(
      'description', 'Imported quote work', 'quantity', 3, 'unit', 'u',
      'unit_price', 100, 'vat_rate', 10
    ))
  );
  EXECUTE 'RESET ROLE';

  IF NOT EXISTS (
    SELECT 1 FROM public.quotes q
    WHERE q.id = v_quote AND q.organization_id = v_org AND q.client_id = v_client
      AND q.created_by = v_actor AND q.number = (v_quote_doc->>'number')
      AND q.status = 'accepted' AND (q.created_at AT TIME ZONE 'UTC')::DATE = DATE '2022-04-05'
      AND q.valid_until = DATE '2022-05-05' AND q.validity_days = 30
      AND q.total_ht = 300 AND q.total_tva = 30 AND q.total_ttc = 330
      AND q.document_snapshot IS NULL AND q.sent_at IS NULL AND q.accepted_at IS NULL
      AND q.signed_at IS NULL AND q.signature_token IS NULL
      AND q.signature_token_expires_at IS NULL
      AND q.historical_import->>'source' = 'csv'
      AND q.historical_import->>'verification' = 'unverified'
      AND q.historical_import->>'state' = 'finalized'
      AND q.historical_import->>'imported_at' IS NOT NULL
      AND q.historical_import->>'finalized_at' IS NOT NULL
      AND (SELECT count(*) FROM jsonb_object_keys(q.historical_import)) = 5
  ) THEN
    RAISE EXCEPTION 'Imported quote state, source date, totals, or unverified provenance were not preserved';
  END IF;
  IF (SELECT count(*) FROM public.quote_sections WHERE quote_id = v_quote) <> 1
     OR (SELECT count(*) FROM public.quote_items WHERE quote_id = v_quote) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM public.quote_items
       WHERE quote_id = v_quote AND description = 'Imported quote work'
         AND quantity = 3 AND unit_price = 100 AND vat_rate = 10
         AND total_ht = 300 AND position = 1
     ) THEN
    RAISE EXCEPTION 'Imported quote section or lines were not inserted before finalization';
  END IF;

  -- Failure on a later line must roll back the header and every earlier line.
  v_blocked := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.import_historical_document(
      'invoice', v_org, v_actor,
      jsonb_build_object('client_id', v_client, 'number', 'CSV-ROLLBACK-' || gen_random_uuid()::TEXT,
        'title', 'Must not remain', 'status', 'sent', 'issue_date', '2024-03-01', 'currency', 'EUR'),
      jsonb_build_array(
        jsonb_build_object('description', 'Valid first line', 'quantity', 1, 'unit', 'u', 'unit_price', 10, 'vat_rate', 20),
        jsonb_build_object('description', 'Invalid second line', 'quantity', 'not-a-number', 'unit', 'u', 'unit_price', 10, 'vat_rate', 20)
      )
    );
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR EXISTS (SELECT 1 FROM public.invoices WHERE number LIKE 'CSV-ROLLBACK-%')
     OR EXISTS (SELECT 1 FROM public.invoice_items WHERE description = 'Valid first line') THEN
    RAISE EXCEPTION 'A bad historical CSV line left a partial document or child';
  END IF;

  -- A target-tenant actor cannot attach a client owned by another tenant.
  v_blocked := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.import_historical_document(
      'quote', v_org, v_actor,
      jsonb_build_object('client_id', v_other_client, 'number', 'CSV-CROSS-CLIENT',
        'title', 'Must be denied', 'status', 'draft', 'issue_date', '2024-03-01'),
      jsonb_build_array(jsonb_build_object('description', 'Work', 'quantity', 1,
        'unit', 'u', 'unit_price', 10, 'vat_rate', 20))
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR EXISTS (SELECT 1 FROM public.quotes WHERE number = 'CSV-CROSS-CLIENT') THEN
    RAISE EXCEPTION 'Cross-organization client was accepted by historical import';
  END IF;

  -- An actor from a different tenant cannot import into this organization.
  v_blocked := false;
  EXECUTE 'SET LOCAL ROLE service_role';
  BEGIN
    PERFORM public.import_historical_document(
      'invoice', v_org, v_other_actor,
      jsonb_build_object('client_id', v_client, 'number', 'CSV-CROSS-ACTOR',
        'title', 'Must be denied', 'status', 'draft', 'issue_date', '2024-03-01', 'currency', 'EUR'),
      jsonb_build_array(jsonb_build_object('description', 'Work', 'quantity', 1,
        'unit', 'u', 'unit_price', 10, 'vat_rate', 20))
    );
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked OR EXISTS (SELECT 1 FROM public.invoices WHERE number = 'CSV-CROSS-ACTOR') THEN
    RAISE EXCEPTION 'Cross-organization actor was accepted by historical import';
  END IF;

  v_blocked := false;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN
    PERFORM public.import_historical_document('invoice', v_org, v_actor, v_invoice_doc, v_items);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked THEN RAISE EXCEPTION 'anon could execute historical document import'; END IF;

  v_blocked := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN
    PERFORM public.import_historical_document('invoice', v_org, v_actor, v_invoice_doc, v_items);
  EXCEPTION WHEN insufficient_privilege THEN
    v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked THEN RAISE EXCEPTION 'authenticated could execute historical document import'; END IF;
END;
$test$;
ROLLBACK;
