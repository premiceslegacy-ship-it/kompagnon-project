-- Run only against a disposable LOCAL Supabase database migrated through 208:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/invoice-issuance-authority.sql
-- All fixture rows and trigger changes are rolled back on success.
BEGIN;

DO $test$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_client_id UUID := gen_random_uuid();
  v_quote_id UUID := gen_random_uuid();
  v_invoice_id UUID := gen_random_uuid();
  v_cancelled_invoice_id UUID := gen_random_uuid();
  v_non_draft_id UUID := gen_random_uuid();
  v_import_invoice_id UUID := gen_random_uuid();
  v_reissue_invoice_id UUID := gen_random_uuid();
  v_item_id UUID := gen_random_uuid();
  v_schedule_id UUID := gen_random_uuid();
  v_snapshot JSONB;
  v_marker JSONB;
  v_rejected BOOLEAN;
  v_sqlstate TEXT;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.organizations (
    id, name, slug, email, sector, siret, siren, vat_number,
    address_line1, address_line2, postal_code, city, country,
    email_from_name, email_from_address, iban, bic, bank_name,
    court_competent, pa_api_key_encrypted, pa_webhook_secret,
    is_vat_subject, tva_sur_debits, business_profile
  ) VALUES (
    v_org_id, 'Issuance seller original', 'issuance-' || v_org_id::TEXT,
    'seller-' || v_org_id::TEXT || '@example.invalid', 'construction',
    '12345678901234', '123456789', 'FR99123456789',
    '10 rue Originale', 'Bâtiment A', '75001', 'Paris', 'FR',
    'Société Originale', 'factures@example.invalid', 'FR7612345678901234567890123',
    'ABCDFFXX', 'Banque Originale', 'Paris', 'test-api-secret', 'test-webhook-secret',
    true, false, 'btp'
  );

  INSERT INTO public.clients (
    id, organization_id, type, company_name, contact_name, email, phone,
    address_line1, address_line2, postal_code, city, country, siret, siren, vat_number
  ) VALUES (
    v_client_id, v_org_id, 'company', 'Acheteur Original', 'Camille Acheteur',
    'buyer@example.invalid', '+33123456789', '20 avenue Acheteur', 'Étage 2',
    '69001', 'Lyon', 'FR', '98765432109876', '987654321', 'FR11987654321'
  );

  INSERT INTO public.quotes (id, organization_id, client_id, number, title)
  VALUES (v_quote_id, v_org_id, v_client_id, 'DEV-ORIGINAL-7', 'Travaux originaux');

  INSERT INTO public.invoices (
    id, organization_id, client_id, quote_id, number, title, status,
    total_ht, total_tva, total_ttc, issue_date, due_date, payment_terms_days,
    notes_client, payment_conditions, aid_label, aid_amount, retention_pct,
    retention_amount, is_reverse_charge, recipient_siren, recipient_siret,
    buyer_reference, purchase_order_ref, invoice_type_code, facturx_level
  ) VALUES (
    v_invoice_id, v_org_id, v_client_id, v_quote_id, 'FAC-ORIGINAL-7',
    'Facture originale', 'draft', 100, 20, 120, DATE '2025-01-10', DATE '2025-02-09', 30,
    'Mention client originale', 'Virement sous 30 jours', 'Aide originale', 15,
    5, 6, false, '987654321', '98765432109876',
    'Acheteur-REF-7', 'BC-2025-7', '380', 'EN_16931'
  );

  INSERT INTO public.invoice_items (
    id, invoice_id, description, quantity, unit, unit_price, vat_rate, position
  ) VALUES (
    v_item_id, v_invoice_id, 'Ligne originale', 2, 'h', 50, 20, 0
  );

  INSERT INTO public.invoice_payment_schedule (
    id, organization_id, invoice_id, label, due_date, amount, amount_type, position
  ) VALUES (
    v_schedule_id, v_org_id, v_invoice_id, 'Acompte original', DATE '2025-01-20',
    30, 'amount', 0
  );


  -- Non-draft INSERTs cannot bypass child capture.
  v_rejected := false;
  BEGIN
    INSERT INTO public.invoices (id, organization_id, number, status)
    VALUES (v_non_draft_id, v_org_id, 'FAC-FORGED-STATUS', 'sent');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'non-draft invoice INSERT unexpectedly succeeded';
  END IF;
  v_rejected := false;
  BEGIN
    INSERT INTO public.invoices (
      id, organization_id, number, status, unissued_cancelled_at
    ) VALUES (
      v_non_draft_id, v_org_id, 'FAC-FORGED-CANCELLATION', 'draft', clock_timestamp()
    );
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'caller-supplied unissued-cancellation provenance unexpectedly succeeded';
  END IF;


  -- A session with ordinary authenticated authority cannot forge import provenance.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  v_rejected := false;
  BEGIN
    INSERT INTO public.invoices (id, organization_id, number, status, historical_import)
    VALUES (v_import_invoice_id, v_org_id, 'FAC-FORGED-IMPORT', 'draft', '{"source":"csv"}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'ordinary invoice INSERT unexpectedly forged import provenance';
  END IF;

  -- Callers cannot seed an authority on either a new or existing draft.
  v_rejected := false;
  BEGIN
    INSERT INTO public.invoices (id, organization_id, number, status, issuance_snapshot)
    VALUES (v_non_draft_id, v_org_id, 'FAC-FORGED-SNAPSHOT', 'draft', '{"schema_version":1}'::jsonb);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'caller-supplied issuance snapshot unexpectedly succeeded';
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.invoices
    SET issuance_snapshot = '{"schema_version":1}'::jsonb
    WHERE id = v_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'caller-forged draft authority unexpectedly succeeded';
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.invoices
    SET unissued_cancelled_at = clock_timestamp()
    WHERE id = v_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'caller-forged unissued-cancellation provenance unexpectedly succeeded';
  END IF;


  -- Contradictory current drafts fail before issuance rather than having their
  -- displayed or delivered totals silently changed.
  -- A nullable subtotal is normalized for authority; a conflicting stored
  -- subtotal cannot be archived even when the invoice header still balances.
  UPDATE public.invoice_items SET total_ht = 99 WHERE id = v_item_id;
  v_rejected := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET status = 'sending' WHERE id = v_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_rejected OR v_sqlstate IS DISTINCT FROM '23514' OR EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_invoice_id AND (status <> 'draft' OR issuance_snapshot IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'inconsistent stored line subtotal was accepted into issuance authority';
  END IF;
  UPDATE public.invoice_items SET total_ht = NULL WHERE id = v_item_id;

  UPDATE public.invoices SET total_tva = 0, total_ttc = 100 WHERE id = v_invoice_id;
  v_rejected := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET status = 'sending' WHERE id = v_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_rejected OR v_sqlstate IS DISTINCT FROM '23514' OR EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_invoice_id AND (status <> 'draft' OR issuance_snapshot IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'taxable zero-tax mismatch was not rejected before authority capture';
  END IF;

  UPDATE public.invoices
  SET is_reverse_charge = true, total_tva = 20, total_ttc = 120
  WHERE id = v_invoice_id;
  v_rejected := false;
  v_sqlstate := NULL;
  BEGIN
    UPDATE public.invoices SET status = 'sending' WHERE id = v_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
    GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
  END;
  IF NOT v_rejected OR v_sqlstate IS DISTINCT FROM '23514' OR EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_invoice_id AND (status <> 'draft' OR issuance_snapshot IS NOT NULL)
  ) THEN
    RAISE EXCEPTION 'reverse-charge VAT mismatch was not rejected before authority capture';
  END IF;
  UPDATE public.invoices
  SET is_reverse_charge = false, total_tva = 20, total_ttc = 120
  WHERE id = v_invoice_id;

  -- Cancelling a draft is not issuance: changing the organization's VAT regime
  -- must not validate or fabricate original authority for an unissued invoice.
  INSERT INTO public.invoices (
    id, organization_id, number, title, status, total_ht, total_tva, total_ttc
  ) VALUES (
    v_cancelled_invoice_id, v_org_id, 'FAC-CANCELLED-DRAFT', 'Cancelled draft',
    'draft', 100, 20, 120
  );
  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, position
  ) VALUES (
    v_cancelled_invoice_id, 'Unissued draft line', 1, 'u', 100, 20, 0
  );
  UPDATE public.organizations SET is_vat_subject = false WHERE id = v_org_id;
  UPDATE public.invoices SET status = 'cancelled' WHERE id = v_cancelled_invoice_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_cancelled_invoice_id
      AND status = 'cancelled'
      AND issuance_snapshot IS NULL
      AND unissued_cancelled_at IS NOT NULL
      AND total_ht = 100
      AND total_tva = 20
      AND total_ttc = 120
  ) THEN
    RAISE EXCEPTION 'a VAT-inconsistent cancelled draft gained authority or lost its unissued marker or fiscal totals';
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.invoices
    SET unissued_cancelled_at = NULL
    WHERE id = v_cancelled_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'unissued-cancellation provenance was cleared';
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.invoices SET status = 'sent'
    WHERE id = v_cancelled_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_cancelled_invoice_id AND (status <> 'cancelled' OR unissued_cancelled_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'an unissued cancellation was reopened or lost its database-owned provenance';
  END IF;
  UPDATE public.organizations SET is_vat_subject = true WHERE id = v_org_id;
  -- Initial issuance atomically captures the linked, complete legal facts.
  UPDATE public.invoices SET status = 'sending' WHERE id = v_invoice_id;
  SELECT issuance_snapshot INTO v_snapshot FROM public.invoices WHERE id = v_invoice_id;
  IF v_snapshot IS NULL
     OR v_snapshot->>'schema_version' IS DISTINCT FROM '1'
     OR v_snapshot->'invoice'->>'number' IS DISTINCT FROM 'FAC-ORIGINAL-7'
     OR v_snapshot->'invoice'->>'issue_date' IS DISTINCT FROM '2025-01-10'
     OR v_snapshot->'invoice'->>'aid_label' IS DISTINCT FROM 'Aide originale'
     OR (v_snapshot->'invoice'->>'retention_amount')::NUMERIC IS DISTINCT FROM 6::NUMERIC
     OR v_snapshot->'invoice'->>'recipient_siret' IS DISTINCT FROM '98765432109876'
     OR v_snapshot->'seller'->>'address_line1' IS DISTINCT FROM '10 rue Originale'
     OR v_snapshot->'seller'->>'is_vat_subject' IS DISTINCT FROM 'true'
     OR v_snapshot->'buyer'->>'company_name' IS DISTINCT FROM 'Acheteur Original'
     OR v_snapshot->'buyer'->>'address_line1' IS DISTINCT FROM '20 avenue Acheteur'
     OR v_snapshot->'quote'->>'number' IS DISTINCT FROM 'DEV-ORIGINAL-7'
     OR jsonb_array_length(v_snapshot->'items') IS DISTINCT FROM 1
     OR v_snapshot->'items'->0->>'description' IS DISTINCT FROM 'Ligne originale'
     OR (v_snapshot->'items'->0->>'total_ht')::NUMERIC IS DISTINCT FROM 100::NUMERIC
     OR (v_snapshot->'items'->0->>'vat_amount')::NUMERIC IS DISTINCT FROM 20::NUMERIC
     OR (v_snapshot->'invoice'->>'total_ht')::NUMERIC IS DISTINCT FROM 100::NUMERIC
     OR (v_snapshot->'invoice'->>'total_tva')::NUMERIC IS DISTINCT FROM 20::NUMERIC
     OR (v_snapshot->'invoice'->>'total_ttc')::NUMERIC IS DISTINCT FROM 120::NUMERIC
     OR jsonb_array_length(v_snapshot->'payment_schedule') IS DISTINCT FROM 1
     OR v_snapshot->'payment_schedule'->0->>'label' IS DISTINCT FROM 'Acompte original' THEN
    RAISE EXCEPTION 'issuance snapshot omitted or changed one or more source facts: %', v_snapshot;
  END IF;
  IF v_snapshot->'seller' ? 'pa_api_key_encrypted'
     OR v_snapshot->'seller' ? 'pa_webhook_secret' THEN
    RAISE EXCEPTION 'issuance snapshot must not contain organization credentials';
  END IF;

  -- Issued authority and legal facts cannot be replaced or edited.
  v_rejected := false;
  BEGIN
    UPDATE public.invoices
    SET issuance_snapshot = jsonb_set(issuance_snapshot, '{seller,name}', '"forged"'::jsonb)
    WHERE id = v_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'issued authority replacement unexpectedly succeeded';
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.invoices SET number = 'FAC-FORGED' WHERE id = v_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'issued invoice edit unexpectedly succeeded';
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.invoice_items SET description = 'Ligne forgée' WHERE id = v_item_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'issued invoice item edit unexpectedly succeeded';
  END IF;
  v_rejected := false;
  BEGIN
    UPDATE public.invoice_payment_schedule SET label = 'Échéance forgée' WHERE id = v_schedule_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'issued payment schedule edit unexpectedly succeeded';
  END IF;

  -- Definite pre-dispatch failure releases only the provisional snapshot.
  UPDATE public.invoices SET status = 'draft' WHERE id = v_invoice_id;
  IF EXISTS (SELECT 1 FROM public.invoices WHERE id = v_invoice_id AND issuance_snapshot IS NOT NULL) THEN
    RAISE EXCEPTION 'sending->draft rollback did not clear provisional authority';
  END IF;
  UPDATE public.clients SET company_name = 'Acheteur Révisé', address_line1 = '21 avenue Acheteur'
  WHERE id = v_client_id;
  UPDATE public.organizations SET name = 'Société Révisée', address_line1 = '11 rue Révisée'
  WHERE id = v_org_id;
  UPDATE public.invoice_items SET description = 'Ligne révisée' WHERE id = v_item_id;
  UPDATE public.invoice_payment_schedule SET label = 'Acompte révisé' WHERE id = v_schedule_id;
  UPDATE public.invoices SET status = 'sent', sent_at = now() WHERE id = v_invoice_id;

  SELECT issuance_snapshot INTO v_snapshot FROM public.invoices WHERE id = v_invoice_id;
  IF v_snapshot->'seller'->>'name' <> 'Société Révisée'
     OR v_snapshot->'seller'->>'address_line1' <> '11 rue Révisée'
     OR v_snapshot->'buyer'->>'company_name' <> 'Acheteur Révisé'
     OR v_snapshot->'buyer'->>'address_line1' <> '21 avenue Acheteur'
     OR v_snapshot->'items'->0->>'description' <> 'Ligne révisée'
     OR v_snapshot->'payment_schedule'->0->>'label' <> 'Acompte révisé' THEN
    RAISE EXCEPTION 'reissued authority did not capture current pre-issue facts: %', v_snapshot;
  END IF;

  -- Live organization/client anonymization leaves the same retained authority.
  UPDATE public.organizations SET
    name = 'Société anonymisée', email = 'deleted-' || v_org_id::TEXT || '@anonymized.invalid',
    address_line1 = NULL, address_line2 = NULL, city = NULL, postal_code = NULL,
    iban = NULL, bic = NULL, logo_url = NULL
  WHERE id = v_org_id;
  UPDATE public.clients SET
    company_name = 'Client anonymisé', contact_name = NULL, email = 'deleted@example.invalid',
    phone = NULL, address_line1 = NULL, address_line2 = NULL, postal_code = NULL,
    city = NULL, siret = NULL, siren = NULL, vat_number = NULL
  WHERE id = v_client_id;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_invoice_id
      AND issuance_snapshot->'seller'->>'name' = 'Société Révisée'
      AND issuance_snapshot->'seller'->>'address_line1' = '11 rue Révisée'
      AND issuance_snapshot->'seller'->>'iban' = 'FR7612345678901234567890123'
      AND issuance_snapshot->'buyer'->>'company_name' = 'Acheteur Révisé'
      AND issuance_snapshot->'buyer'->>'address_line1' = '21 avenue Acheteur'
      AND issuance_snapshot->'buyer'->>'siret' = '98765432109876'
  ) THEN
    RAISE EXCEPTION 'issued seller/buyer facts did not survive live party anonymization';
  END IF;

  -- Historical CSV finalization retains unverified values without minting
  -- authority from the organization's current VAT regime.
  UPDATE public.organizations SET is_vat_subject = false WHERE id = v_org_id;
  INSERT INTO public.invoices (
    id, organization_id, number, status, total_ht, total_tva, total_ttc, historical_import
  ) VALUES (
    v_import_invoice_id, v_org_id, 'FAC-HISTORICAL-IMPORT', 'draft', 100, 20, 120,
    '{"source":"csv","verification":"verified","state":"finalized","imported_at":"2000-01-01T00:00:00Z","finalized_at":"2000-01-02T00:00:00Z"}'::jsonb
  );
  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, position
  ) VALUES (
    v_import_invoice_id, 'Historical CSV line', 1, 'u', 100, 20, 0
  );
  SELECT historical_import INTO v_marker
  FROM public.invoices WHERE id = v_import_invoice_id;
  IF v_marker->>'source' <> 'csv'
     OR v_marker->>'verification' <> 'unverified'
     OR v_marker->>'state' <> 'staging'
     OR v_marker->>'imported_at' IS NULL
     OR v_marker->>'imported_at' = '2000-01-01T00:00:00Z'
     OR v_marker ? 'finalized_at' THEN
    RAISE EXCEPTION 'historical import insert was not canonicalized to staging';
  END IF;

  UPDATE public.invoices
  SET status = 'sent', historical_import = historical_import || '{"state":"finalized"}'::jsonb
  WHERE id = v_import_invoice_id;
  SELECT historical_import INTO v_marker
  FROM public.invoices WHERE id = v_import_invoice_id;
  IF v_marker->>'source' <> 'csv'
     OR v_marker->>'verification' <> 'unverified'
     OR v_marker->>'state' <> 'finalized'
     OR v_marker->>'imported_at' IS NULL
     OR v_marker->>'finalized_at' IS NULL
     OR v_marker->>'finalized_at' = '2000-01-02T00:00:00Z'
     OR EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_import_invoice_id
         AND (issuance_snapshot IS NOT NULL OR total_tva <> 20 OR total_ttc <> 120 OR sent_at IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'historical import finalization changed inputs or created original authority';
  END IF;

  v_rejected := false;
  BEGIN
    UPDATE public.invoices
    SET historical_import = historical_import || '{"verification":"verified"}'::jsonb
    WHERE id = v_import_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'historical import marker edit unexpectedly succeeded';
  END IF;
  -- A finalized historical draft gets a new, genuine snapshot only when it is
  -- subsequently issued under the current regime.
  INSERT INTO public.invoices (
    id, organization_id, number, status, total_ht, total_tva, total_ttc, historical_import
  ) VALUES (
    v_reissue_invoice_id, v_org_id, 'FAC-HISTORICAL-DRAFT', 'draft', 100, 0, 100,
    '{"source":"csv"}'::jsonb
  );
  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, position
  ) VALUES (
    v_reissue_invoice_id, 'Draft to issue now', 1, 'u', 100, 0, 0
  );
  UPDATE public.invoices
  SET historical_import = historical_import || '{"state":"finalized"}'::jsonb
  WHERE id = v_reissue_invoice_id;
  IF EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_reissue_invoice_id AND issuance_snapshot IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'historical draft finalization created original authority';
  END IF;
  UPDATE public.invoices SET status = 'sending' WHERE id = v_reissue_invoice_id;
  SELECT issuance_snapshot INTO v_snapshot
  FROM public.invoices WHERE id = v_reissue_invoice_id;
  IF v_snapshot->'invoice'->>'id' <> v_reissue_invoice_id::TEXT
     OR v_snapshot->'seller'->>'is_vat_subject' <> 'false'
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_reissue_invoice_id AND historical_import->>'state' = 'finalized'
     ) THEN
    RAISE EXCEPTION 'new issuance did not capture genuine authority for finalized historical draft';
  END IF;
END;
$test$;

ROLLBACK;
