-- Disposable LOCAL database, all migrations through 210. No provider calls.
BEGIN;
DO $test$
DECLARE
  v_org UUID := gen_random_uuid();
  v_client UUID := gen_random_uuid();
  v_quote UUID := gen_random_uuid();
  v_section UUID := gen_random_uuid();
  v_item UUID := gen_random_uuid();
  v_rejected_insert UUID := gen_random_uuid();
  v_pending_quote UUID := gen_random_uuid();
  v_pending_invoice UUID := gen_random_uuid();
  v_snapshot JSONB;
  v_accepted_snapshot JSONB;
  v_blocked BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.organizations (id, name, slug, email, sector, address_line1, is_vat_subject, public_form_enabled)
  VALUES (v_org, 'Original quote issuer', 'quote-authority-' || v_org::TEXT,
          'quote-issuer@example.invalid', 'construction', '10 Original Issuer Street', true, true);
  INSERT INTO public.clients (id, organization_id, type, company_name, email, address_line1)
  VALUES (v_client, v_org, 'company', 'Original quote buyer', 'quote-buyer@example.invalid', '20 Original Buyer Street');

  v_blocked := false;
  BEGIN
    INSERT INTO public.quotes (id, organization_id, number, status)
    VALUES (v_rejected_insert, v_org, 'FORGED-PUBLISHED', 'sent');
  EXCEPTION WHEN check_violation THEN v_blocked := true;
  END;
  IF NOT v_blocked OR EXISTS (SELECT 1 FROM public.quotes WHERE id = v_rejected_insert) THEN
    RAISE EXCEPTION 'A published quote was inserted before its document facts existed';
  END IF;

  INSERT INTO public.quotes (id, organization_id, client_id, number, title, status)
  VALUES (v_quote, v_org, v_client, 'DEV-AUTHORITY', 'Verified local publication', 'draft');
  INSERT INTO public.quote_sections (id, quote_id, title, position)
  VALUES (v_section, v_quote, 'Visible work', 0);
  INSERT INTO public.quote_items (id, quote_id, section_id, type, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_item, v_quote, v_section, 'custom', 'Stable quoted work', 1, 'u', 100, 20, 0);
  INSERT INTO public.quote_items (quote_id, type, description, quantity, unit_price, vat_rate, is_internal, position)
  VALUES (v_quote, 'custom', 'Internal resource', 1, 900, 20, true, 1);
  UPDATE public.quotes SET status = 'sent', sent_at = now(), signature_token = gen_random_uuid(),
    signature_token_expires_at = now() + INTERVAL '1 day' WHERE id = v_quote;
  SELECT document_snapshot INTO v_snapshot FROM public.quotes WHERE id = v_quote;
  IF v_snapshot->'organization'->>'name' <> 'Original quote issuer'
     OR v_snapshot->'quote'->'client'->>'company_name' <> 'Original quote buyer'
     OR (v_snapshot->'quote'->>'total_ttc')::numeric <> 120
     OR v_snapshot->'quote'->'sections'->0->'items'->0->>'description' <> 'Stable quoted work' THEN
    RAISE EXCEPTION 'Published quote did not capture its actual parties, section or visible total';
  END IF;
  IF v_snapshot->'organization' ? 'openrouter_api_key' THEN
    RAISE EXCEPTION 'Document facts included provider credentials';
  END IF;

  UPDATE public.organizations SET name = 'Current quote issuer', address_line1 = '30 Changed Issuer Street',
    is_vat_subject = false WHERE id = v_org;
  UPDATE public.clients SET company_name = 'Current quote buyer', address_line1 = '40 Changed Buyer Street'
  WHERE id = v_client;
  IF (SELECT document_snapshot FROM public.quotes WHERE id = v_quote) IS DISTINCT FROM v_snapshot THEN
    RAISE EXCEPTION 'Editing live parties rewrote a published quote';
  END IF;

  UPDATE public.quotes SET status = 'viewed' WHERE id = v_quote;
  UPDATE public.quote_items SET quantity = 2 WHERE id = v_item;
  IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote AND status = 'draft'
                 AND signature_token IS NULL AND signature_token_expires_at IS NULL
                 AND document_snapshot IS NULL) THEN
    RAISE EXCEPTION 'Editing a viewed published line did not withdraw its old signature capability';
  END IF;
  UPDATE public.quotes SET status = 'sent', sent_at = now(), signature_token = gen_random_uuid(),
    signature_token_expires_at = now() + INTERVAL '1 day' WHERE id = v_quote;
  IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote AND total_ht = 200
                 AND total_tva = 0 AND total_ttc = 200
                 AND document_snapshot->'organization'->>'name' = 'Current quote issuer'
                 AND document_snapshot->'quote'->'client'->>'company_name' = 'Current quote buyer') THEN
    RAISE EXCEPTION 'Explicit republication did not use its current verified facts and VAT regime';
  END IF;
  UPDATE public.quotes SET status = 'viewed' WHERE id = v_quote;
  UPDATE public.quotes SET title = 'A revised viewed proposal' WHERE id = v_quote;
  IF NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote AND status = 'draft'
                 AND signature_token IS NULL AND signature_token_expires_at IS NULL
                 AND document_snapshot IS NULL) THEN
    RAISE EXCEPTION 'Editing viewed quote material retained its old publication';
  END IF;
  UPDATE public.quotes SET status = 'sent', sent_at = now(), signature_token = gen_random_uuid(),
    signature_token_expires_at = now() + INTERVAL '1 day' WHERE id = v_quote;
  UPDATE public.quotes SET status = 'accepted', signed_at = now(),
    client_signature_image = 'data:image/png;base64,retained-local-signature',
    client_signatory_name = 'Local buyer' WHERE id = v_quote;
  SELECT document_snapshot INTO v_accepted_snapshot FROM public.quotes WHERE id = v_quote;

  v_blocked := false;
  BEGIN
    UPDATE public.quotes SET document_snapshot = jsonb_set(document_snapshot, '{organization,name}', '"Forged issuer"'::jsonb)
    WHERE id = v_quote;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'An accepted document authority was forgeable'; END IF;
  v_blocked := false;
  BEGIN
    UPDATE public.quote_items SET unit_price = 999 WHERE id = v_item;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Accepted line contents remained mutable'; END IF;

  INSERT INTO public.quotes (id, organization_id, number, status)
  VALUES (v_pending_quote, v_org, 'DEV-PENDING', 'draft');
  INSERT INTO public.invoices (id, organization_id, number, status)
  VALUES (v_pending_invoice, v_org, 'FAC-PENDING', 'draft');
  UPDATE public.organizations SET deletion_scheduled_at = now() - INTERVAL '1 minute' WHERE id = v_org;
  PERFORM * FROM public.anonymize_organization_for_deletion(v_org);
  IF (SELECT document_snapshot FROM public.quotes WHERE id = v_quote) IS DISTINCT FROM v_accepted_snapshot
     OR NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote AND status = 'accepted'
                    AND signature_token IS NULL AND client_signatory_name = 'Local buyer') THEN
    RAISE EXCEPTION 'Erasure changed accepted facts or preserved their public capability';
  END IF;

  v_blocked := false;
  BEGIN
    UPDATE public.quotes SET status = 'sent', signature_token = gen_random_uuid() WHERE id = v_pending_quote;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Erased organization published a pending quote'; END IF;
  v_blocked := false;
  BEGIN
    UPDATE public.invoices SET status = 'sending' WHERE id = v_pending_invoice;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'In-flight automation issued after organization erasure'; END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.quotes (organization_id, number, status) VALUES (v_org, 'DEV-AFTER-ERASURE', 'draft');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Erased organization created another quote'; END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.invoices (organization_id, number, status) VALUES (v_org, 'FAC-AFTER-ERASURE', 'draft');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Erased organization created another invoice'; END IF;
END;
$test$;
ROLLBACK;
