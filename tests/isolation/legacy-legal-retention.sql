-- Disposable LOCAL database migrated through 210. Legacy state is restored
-- explicitly with only the new capture triggers disabled inside this rollback.
BEGIN;
DO $test$
DECLARE
  v_org UUID := gen_random_uuid();
  v_client UUID := gen_random_uuid();
  v_legacy_invoice UUID := gen_random_uuid();
  v_verified_invoice UUID := gen_random_uuid();
  v_legacy_quote UUID := gen_random_uuid();
  v_legacy_cancelled_invoice UUID := gen_random_uuid();
  v_unissued_cancelled_invoice UUID := gen_random_uuid();
  v_legacy_fully_invoiced_quote UUID := gen_random_uuid();
  v_legacy_contract UUID := gen_random_uuid();
  v_blocked BOOLEAN;
  v_visible INT;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.organizations (id, name, slug, email, sector, address_line1, is_vat_subject)
  VALUES (v_org, 'Known legacy issuer', 'legacy-retention-' || v_org::TEXT,
          'legacy-issuer@example.invalid', 'construction', '10 Known Issuer Address', true);
  INSERT INTO public.clients (id, organization_id, type, company_name, email, address_line1)
  VALUES (v_client, v_org, 'company', 'Known legacy buyer', 'legacy-buyer@example.invalid', '20 Known Buyer Address');

  INSERT INTO public.invoices (id, organization_id, client_id, number, status, total_ht, total_tva, total_ttc)
  VALUES (v_verified_invoice, v_org, v_client, 'FAC-VERIFIED-CONTEXT', 'draft', 100, 20, 120);
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit_price, vat_rate, total_ht)
  VALUES (v_verified_invoice, 'Verified work', 1, 100, 20, 100);
  UPDATE public.invoices SET status = 'sent', sent_at = now() WHERE id = v_verified_invoice;

  INSERT INTO public.invoices (id, organization_id, client_id, number, status, total_ht, total_tva, total_ttc)
  VALUES (v_unissued_cancelled_invoice, v_org, v_client, 'FAC-UNISSUED-CANCELLED', 'draft', 100, 20, 120);
  UPDATE public.invoices SET status = 'cancelled' WHERE id = v_unissued_cancelled_invoice;

  -- Model records that existed before the new authority cutover. This does not
  -- manufacture snapshots or claim these live party values were the originals.
  EXECUTE 'ALTER TABLE public.invoices DISABLE TRIGGER trg_capture_invoice_issuance_snapshot';
  INSERT INTO public.invoices (id, organization_id, client_id, number, status, total_ht, total_tva, total_ttc)
  VALUES
    (v_legacy_invoice, v_org, v_client, 'FAC-LEGACY-CONTEXT', 'sent', 100, 20, 120),
    (v_legacy_cancelled_invoice, v_org, v_client, 'FAC-LEGACY-CANCELLED', 'cancelled', 100, 20, 120);
  EXECUTE 'ALTER TABLE public.invoices ENABLE TRIGGER trg_capture_invoice_issuance_snapshot';
  EXECUTE 'ALTER TABLE public.quotes DISABLE TRIGGER aaa_quote_document_authority';
  INSERT INTO public.quotes (id, organization_id, client_id, number, status, signed_at, total_ht, total_tva, total_ttc)
  VALUES
    (v_legacy_quote, v_org, v_client, 'DEV-LEGACY-CONTEXT', 'accepted', now(), 100, 20, 120),
    (v_legacy_fully_invoiced_quote, v_org, v_client, 'DEV-LEGACY-FULLY-INVOICED', 'fully_invoiced', NULL, 100, 20, 120);
  EXECUTE 'ALTER TABLE public.quotes ENABLE TRIGGER aaa_quote_document_authority';
  EXECUTE 'ALTER TABLE public.contracts DISABLE TRIGGER contract_document_authority_guard';
  INSERT INTO public.contracts (
    id, organization_id, client_id, contract_type, role, title, counterparty_name,
    counterparty_email, counterparty_address, template_key, template_title, status, signed_at
  ) VALUES (
    v_legacy_contract, v_org, v_client, 'sous_traitance', 'donneur_ordre', 'Legacy signed agreement',
    'Known signed counterparty', 'legacy-contract@example.invalid', '30 Known Counterparty Address',
    'sous_traitance_btp_generique', 'Legacy contract', 'signed', now()
  );
  EXECUTE 'ALTER TABLE public.contracts ENABLE TRIGGER contract_document_authority_guard';
  UPDATE public.organizations SET deletion_scheduled_at = now() - INTERVAL '1 minute' WHERE id = v_org;

  -- A caller with the service key may invoke erasure, not bypass its entrypoint
  -- to create a purported observation whenever it chooses.
  EXECUTE 'SET LOCAL ROLE service_role';
  v_blocked := false;
  BEGIN
    PERFORM public.retain_unverified_legal_context(v_org);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked THEN RAISE EXCEPTION 'The internal retention helper was directly executable'; END IF;

  PERFORM * FROM public.anonymize_organization_for_deletion(v_org);
  IF NOT EXISTS (SELECT 1 FROM public.clients WHERE id = v_client
                 AND company_name = 'Client anonymisé' AND address_line1 IS NULL) THEN
    RAISE EXCEPTION 'Legacy retention prevented the intended live-client anonymization';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.legacy_legal_retention_contexts
    WHERE document_kind = 'invoice' AND document_id = v_legacy_invoice
      AND provenance = 'unverified_live_records_at_erasure'
      AND seller_context->>'address_line1' = '10 Known Issuer Address'
      AND buyer_context->>'company_name' = 'Known legacy buyer'
      AND buyer_context->>'address_line1' = '20 Known Buyer Address'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.legacy_legal_retention_contexts
    WHERE document_kind = 'accepted_quote' AND document_id = v_legacy_quote
      AND provenance = 'unverified_live_records_at_erasure'
      AND seller_context->>'name' = 'Known legacy issuer'
      AND buyer_context->>'company_name' = 'Known legacy buyer'
  ) THEN
    RAISE EXCEPTION 'Erasure lost the last known legacy legal-party context';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.legacy_legal_retention_contexts
    WHERE document_kind = 'accepted_quote' AND document_id = v_legacy_fully_invoiced_quote
      AND buyer_context->>'company_name' = 'Known legacy buyer'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.legacy_legal_retention_contexts
    WHERE document_kind = 'signed_contract' AND document_id = v_legacy_contract
      AND seller_context->>'name' = 'Known legacy issuer'
      AND buyer_context->>'counterparty_name' = 'Known signed counterparty'
      AND buyer_context->>'counterparty_address' = '30 Known Counterparty Address'
      AND buyer_context->'client'->>'company_name' = 'Known legacy buyer'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.legacy_legal_retention_contexts
    WHERE document_kind = 'invoice' AND document_id = v_legacy_cancelled_invoice
  ) THEN
    RAISE EXCEPTION 'Legacy fully-invoiced quote, signed contract or ambiguous cancellation context was lost';
  END IF;
  IF EXISTS (SELECT 1 FROM public.legacy_legal_retention_contexts
             WHERE document_id IN (v_verified_invoice, v_unissued_cancelled_invoice)) THEN
    RAISE EXCEPTION 'Verified authority or a proven unissued cancellation acquired unnecessary legacy-party retention';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_legacy_invoice AND issuance_snapshot IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = v_legacy_quote AND document_snapshot IS NULL)
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_legacy_contract AND pdf_snapshot IS NULL) THEN
    RAISE EXCEPTION 'Current legacy context was falsely promoted into historical authority';
  END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  v_visible := 0;
  BEGIN
    SELECT count(*) INTO v_visible FROM public.legacy_legal_retention_contexts WHERE organization_id = v_org;
  EXCEPTION WHEN insufficient_privilege THEN v_visible := 0;
  END;
  EXECUTE 'RESET ROLE';
  IF v_visible <> 0 THEN RAISE EXCEPTION 'An ordinary session could read private legacy retention context'; END IF;

  EXECUTE 'SET LOCAL ROLE service_role';
  SELECT count(*) INTO v_visible FROM public.legacy_legal_retention_contexts WHERE organization_id = v_org;
  v_blocked := false;
  BEGIN
    INSERT INTO public.legacy_legal_retention_contexts (
      document_kind, document_id, organization_id, observed_at, seller_context
    ) VALUES ('invoice', gen_random_uuid(), v_org, now(), '{}'::jsonb);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF v_visible <> 5 OR NOT v_blocked THEN
    RAISE EXCEPTION 'Privileged reconciliation access could not read, or could forge, retained observations';
  END IF;
END;
$test$;
ROLLBACK;
