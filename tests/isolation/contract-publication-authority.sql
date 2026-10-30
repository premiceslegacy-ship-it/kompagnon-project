-- Disposable LOCAL database, all migrations through 214. Rollback-safe; no provider calls.
BEGIN;
CREATE FUNCTION public.test_contract_expiry_race_hook_209()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $hook$
BEGIN
  IF current_setting('app.contract_expiry_race_quote_id', true) = NEW.id::TEXT
     AND OLD.status IN ('sent', 'viewed')
     AND NEW.status = 'accepted' THEN
    UPDATE public.contracts
    SET signature_token_expires_at = clock_timestamp() - INTERVAL '1 minute'
    WHERE quote_id = NEW.id AND status = 'sent';
  END IF;
  RETURN NEW;
END;
$hook$;
CREATE TRIGGER test_contract_expiry_race_hook_209
  AFTER UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.test_contract_expiry_race_hook_209();
DO $test$
DECLARE
  v_org UUID := gen_random_uuid();
  v_actor UUID := gen_random_uuid();
  v_client UUID := gen_random_uuid();
  v_quote UUID := gen_random_uuid();
  v_contract UUID := gen_random_uuid();
  v_quote_changed UUID := gen_random_uuid();
  v_contract_changed UUID := gen_random_uuid();
  v_quote_archived UUID := gen_random_uuid();
  v_contract_archived UUID := gen_random_uuid();
  v_quote_race UUID := gen_random_uuid();
  v_contract_race UUID := gen_random_uuid();
  v_snapshot JSONB;
  v_contract_snapshot JSONB;
  v_linked_quote JSONB;
  v_linked_quote_signed JSONB;
  v_linked_quote_roundtrip JSONB;
  v_hash TEXT;
  v_token TEXT;
  v_result JSONB;
  v_updated_at TIMESTAMPTZ;
  v_signed_at TIMESTAMPTZ;
  v_blocked BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject, public_form_enabled, capital_social)
  VALUES (v_org, 'Published original issuer', 'contract-authority-' || v_org::TEXT,
          'contract-issuer@example.invalid', 'construction', true, true, 1000.00);
  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES (v_client, v_org, 'company', 'Published original buyer', 'contract-buyer@example.invalid');
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES (v_actor, 'authenticated', 'authenticated',
          'contract-actor-' || v_actor::TEXT || '@example.invalid', now());

  INSERT INTO public.quotes (id, organization_id, client_id, number, title, status)
  VALUES (v_quote, v_org, v_client, 'DEV-CONTRACT-AUTHORITY', 'Original offer', 'draft');
  INSERT INTO public.contracts (id, organization_id, client_id, quote_id, contract_type, role,
    status, title, counterparty_name, template_key, template_title, clauses, created_by)
  VALUES (v_contract, v_org, v_client, v_quote, 'maintenance', 'donneur_ordre', 'draft',
    'Original contract', 'Published original buyer', 'builtin:maintenance', 'Maintenance', '{}'::jsonb, v_actor);
  INSERT INTO public.quote_items (quote_id, type, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_quote, 'custom', 'Published numeric total', 1, 'u', 100.00, 20.00, 0);

  SELECT updated_at INTO v_updated_at FROM public.contracts WHERE id = v_contract;
  v_snapshot := jsonb_build_object(
    'organizationId', v_org,
    'generatedAt', clock_timestamp()::TEXT,
    'reference', 'CTR-AUTHORITY-001',
    'contract', jsonb_build_object('id', v_contract, 'title', 'Original contract', 'status', 'draft'),
    'organization', jsonb_build_object('name', 'Published original issuer'),
    'counterparty', jsonb_build_object('name', 'Published original buyer'),
    'chantier', NULL
  );
  v_result := public.publish_contract_document(v_contract, v_org, v_updated_at, v_snapshot, true);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Initial contract publication failed: %', v_result;
  END IF;
  v_token := v_result ->> 'signature_token';
  SELECT pdf_snapshot, linked_quote_document, signature_document_hash
  INTO v_contract_snapshot, v_linked_quote, v_hash
  FROM public.contracts WHERE id = v_contract;
  v_linked_quote_roundtrip := jsonb_set(
    jsonb_set(v_linked_quote, '{document_snapshot,quote,total_ttc}', '120'::JSONB),
    '{document_snapshot,organization,capital_social}', '1000'::JSONB
  );
  IF (v_linked_quote -> 'document_snapshot' -> 'quote' -> 'total_ttc')::TEXT IS DISTINCT FROM '120.00'
     OR (v_linked_quote -> 'document_snapshot' -> 'organization' -> 'capital_social')::TEXT IS DISTINCT FROM '1000.00'
     OR (v_linked_quote_roundtrip -> 'document_snapshot' -> 'quote' -> 'total_ttc')::TEXT IS DISTINCT FROM '120'
     OR (v_linked_quote_roundtrip -> 'document_snapshot' -> 'organization' -> 'capital_social')::TEXT IS DISTINCT FROM '1000'
     OR v_linked_quote_roundtrip IS DISTINCT FROM v_linked_quote
     OR v_linked_quote_roundtrip::TEXT IS NOT DISTINCT FROM v_linked_quote::TEXT
     OR public.contract_document_hash(v_contract_snapshot, v_linked_quote_roundtrip) IS NOT DISTINCT FROM v_hash
     OR NOT public.verify_contract_document_publication(
       v_contract, v_org, v_hash, v_contract_snapshot, v_linked_quote_roundtrip
     ) THEN
    RAISE EXCEPTION 'Equivalent serialized numeric publication failed persisted-row verification';
  END IF;
  IF public.verify_contract_document_publication(
       v_contract, v_org, v_hash,
       jsonb_set(v_contract_snapshot, '{reference}', '"ALTERED-REFERENCE"'::JSONB),
       v_linked_quote_roundtrip
     )
     OR public.verify_contract_document_publication(
       v_contract, v_org, v_hash, v_contract_snapshot,
       jsonb_set(v_linked_quote_roundtrip,
         '{document_snapshot,quote,title}', '"Altered offer"'::JSONB)
     )
     OR public.verify_contract_document_publication(
       v_contract, v_org,
       CASE WHEN v_hash = repeat('0', 64) THEN repeat('1', 64) ELSE repeat('0', 64) END,
       v_contract_snapshot, v_linked_quote_roundtrip
     )
     OR public.verify_contract_document_publication(
       gen_random_uuid(), v_org, v_hash, v_contract_snapshot, v_linked_quote_roundtrip
     )
     OR public.verify_contract_document_publication(
       v_contract, gen_random_uuid(), v_hash, v_contract_snapshot, v_linked_quote_roundtrip
     ) THEN
    RAISE EXCEPTION 'Altered facts, hash, contract id, or organization verified against a publication';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.verify_contract_document_publication(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('anon',
       'public.verify_contract_document_publication(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE')
     OR has_function_privilege('authenticated',
       'public.verify_contract_document_publication(uuid,uuid,text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Publication verifier grants are not service-role-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contracts
    WHERE id = v_contract
      AND pdf_snapshot IS NOT DISTINCT FROM v_contract_snapshot
      AND linked_quote_document IS NOT DISTINCT FROM v_linked_quote
      AND signature_document_hash IS NOT DISTINCT FROM v_hash
  ) THEN
    RAISE EXCEPTION 'Verifier fixture changed the persisted publication facts or hash';
  END IF;
  IF v_result -> 'publication_record' ->> 'id' IS DISTINCT FROM v_contract::TEXT
     OR v_result -> 'publication_record' ->> 'status' IS DISTINCT FROM 'sent'
     OR v_result -> 'publication_record' -> 'pdf_snapshot' IS DISTINCT FROM v_contract_snapshot
     OR v_result -> 'publication_record' -> 'signature_document_hash' IS DISTINCT FROM to_jsonb(v_hash)
     OR public.contract_document_hash(v_contract_snapshot, v_linked_quote) IS DISTINCT FROM v_hash
     OR v_linked_quote ->> 'id' IS DISTINCT FROM v_quote::TEXT
     OR v_linked_quote -> 'document_snapshot' -> 'quote' ->> 'id' IS DISTINCT FROM v_quote::TEXT
     OR v_linked_quote -> 'document_snapshot' -> 'organization' ->> 'name' IS DISTINCT FROM 'Published original issuer'
     OR v_linked_quote -> 'document_snapshot' -> 'quote' -> 'client' ->> 'company_name' IS DISTINCT FROM 'Published original buyer'
     OR (SELECT status FROM public.quotes WHERE id = v_quote) IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'Publication response or saved linked quote facts were incomplete';
  END IF;

  UPDATE public.organizations SET name = 'Current issuer' WHERE id = v_org;
  UPDATE public.clients SET company_name = 'Current buyer' WHERE id = v_client;
  IF (SELECT pdf_snapshot FROM public.contracts WHERE id = v_contract) IS DISTINCT FROM v_contract_snapshot
     OR (SELECT linked_quote_document FROM public.contracts WHERE id = v_contract) IS DISTINCT FROM v_linked_quote THEN
    RAISE EXCEPTION 'Live party changes rewrote a published contract or linked quote copy';
  END IF;

  UPDATE public.contracts SET title = 'Revised contract' WHERE id = v_contract;
  IF NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract AND status = 'draft'
                 AND signature_token IS NULL AND signature_token_expires_at IS NULL
                 AND signature_document_hash IS NULL AND linked_quote_document IS NULL
                 AND pdf_snapshot IS NULL) THEN
    RAISE EXCEPTION 'Unsigned contract material edit did not withdraw its publication';
  END IF;

  SELECT updated_at INTO v_updated_at FROM public.contracts WHERE id = v_contract;
  v_snapshot := jsonb_set(v_snapshot, '{contract,title}', '"Revised contract"'::JSONB);
  v_snapshot := jsonb_set(v_snapshot, '{generatedAt}', to_jsonb(clock_timestamp()::TEXT));
  v_snapshot := jsonb_set(v_snapshot, '{reference}', '"CTR-AUTHORITY-002"'::JSONB);
  v_result := public.publish_contract_document(v_contract, v_org, v_updated_at, v_snapshot, false);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Republication failed: %', v_result;
  END IF;
  v_token := v_result ->> 'signature_token';
  SELECT pdf_snapshot, linked_quote_document, signature_document_hash
  INTO v_contract_snapshot, v_linked_quote, v_hash
  FROM public.contracts WHERE id = v_contract;

  UPDATE public.contracts SET signature_token_expires_at = clock_timestamp() - INTERVAL '1 minute'
  WHERE id = v_contract;
  v_result := public.sign_contract_with_quote(v_token, 'Local Signer', 'Dirigeant',
    'data:image/png;base64,signature-fixture', '127.0.0.1', 'isolation-fixture', true);
  IF v_result ->> 'code' IS DISTINCT FROM 'expired'
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract AND status = 'sent'
                    AND client_signed_at IS NULL AND signature_token = v_token::UUID)
     OR (SELECT status FROM public.quotes WHERE id = v_quote) IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'Expired token mutated contract or linked quote: %', v_result;
  END IF;

  UPDATE public.contracts SET signature_token_expires_at = clock_timestamp() + INTERVAL '1 day'
  WHERE id = v_contract;
  v_result := public.sign_contract_with_quote(v_token, 'Local Signer', 'Dirigeant',
    'data:image/png;base64,signature-fixture', '127.0.0.1', 'isolation-fixture', true);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE
     OR COALESCE((v_result ->> 'already_signed')::BOOLEAN, true) IS NOT FALSE
     OR (SELECT status FROM public.quotes WHERE id = v_quote) IS DISTINCT FROM 'accepted'
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract AND status = 'signed'
                    AND client_signed_at IS NOT NULL AND pdf_snapshot = v_contract_snapshot
                    AND linked_quote_document ->> 'status' = 'accepted'
                    AND linked_quote_document -> 'document_snapshot' = v_linked_quote -> 'document_snapshot'
                    AND signature_document_hash = v_hash) THEN
    RAISE EXCEPTION 'Fresh paired consent failed or changed its published material: %', v_result;
  END IF;
  SELECT linked_quote_document INTO v_linked_quote_signed FROM public.contracts WHERE id = v_contract;
  SELECT client_signed_at INTO v_signed_at FROM public.contracts WHERE id = v_contract;
  v_result := public.sign_contract_with_quote(v_token, 'Replay Signer', 'Autre rôle',
    'data:image/png;base64,replay-fixture', '127.0.0.2', 'replay-fixture', true);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE
     OR COALESCE((v_result ->> 'already_signed')::BOOLEAN, false) IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract AND status = 'signed'
                    AND client_signed_at = v_signed_at
                    AND client_signatory_name = 'Local Signer'
                    AND client_signatory_role = 'Dirigeant'
                    AND client_signature_image = 'data:image/png;base64,signature-fixture')
     OR (SELECT status FROM public.quotes WHERE id = v_quote) IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'A replay changed single-use signature or quote evidence: %', v_result;
  END IF;
  ALTER TABLE public.contracts DISABLE TRIGGER contract_document_authority_guard;
  UPDATE public.contracts SET signature_token_expires_at = clock_timestamp() - INTERVAL '1 minute'
  WHERE id = v_contract;
  ALTER TABLE public.contracts ENABLE TRIGGER contract_document_authority_guard;
  v_result := public.sign_contract_with_quote(v_token, 'Expired Replay', NULL,
    'data:image/png;base64,expired-replay-fixture', '127.0.0.3', 'expired-replay', true);
  IF v_result ->> 'code' IS DISTINCT FROM 'expired'
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract AND status = 'signed'
                    AND client_signed_at = v_signed_at
                    AND client_signatory_name = 'Local Signer'
                    AND client_signature_image = 'data:image/png;base64,signature-fixture')
     OR (SELECT status FROM public.quotes WHERE id = v_quote) IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'Expired signed replay disclosed or changed legal evidence: %', v_result;
  END IF;

  v_blocked := false;
  BEGIN
    UPDATE public.contracts SET title = 'Forged signed title' WHERE id = v_contract;
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  IF NOT v_blocked OR (SELECT title FROM public.contracts WHERE id = v_contract) <> 'Revised contract' THEN
    RAISE EXCEPTION 'Signed contract terms remained mutable';
  END IF;
  UPDATE public.contracts SET signature_token = NULL, signature_token_expires_at = NULL WHERE id = v_contract;
  IF NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract AND client_signed_at IS NOT NULL
                 AND client_signature_image = 'data:image/png;base64,signature-fixture'
                 AND pdf_snapshot = v_contract_snapshot AND signature_document_hash = v_hash) THEN
    RAISE EXCEPTION 'Trusted capability revocation changed signed legal evidence';
  END IF;
  UPDATE public.quotes SET status = 'fully_invoiced' WHERE id = v_quote;
  IF NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract AND status = 'signed'
                 AND client_signed_at IS NOT NULL
                 AND client_signature_image = 'data:image/png;base64,signature-fixture'
                 AND pdf_snapshot = v_contract_snapshot
                 AND linked_quote_document = v_linked_quote_signed
                 AND linked_quote_document -> 'document_snapshot' = v_linked_quote -> 'document_snapshot') THEN
    RAISE EXCEPTION 'A later quote lifecycle transition erased the signed contract evidence';
  END IF;
  DELETE FROM auth.users WHERE id = v_actor;
  IF NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract AND status = 'signed'
                 AND created_by IS NULL AND client_signed_at IS NOT NULL
                 AND client_signature_image = 'data:image/png;base64,signature-fixture'
                 AND pdf_snapshot = v_contract_snapshot
                 AND linked_quote_document = v_linked_quote_signed) THEN
    RAISE EXCEPTION 'Auth-user FK erasure changed signed contract evidence';
  END IF;

  INSERT INTO public.quotes (id, organization_id, client_id, number, title, status)
  VALUES (v_quote_changed, v_org, v_client, 'DEV-CONTRACT-CHANGE', 'Offer before revision', 'draft');
  INSERT INTO public.contracts (id, organization_id, client_id, quote_id, contract_type, role,
    status, title, counterparty_name, template_key, template_title, clauses)
  VALUES (v_contract_changed, v_org, v_client, v_quote_changed, 'maintenance', 'donneur_ordre', 'draft',
    'Contract before offer revision', 'Current buyer', 'builtin:maintenance', 'Maintenance', '{}'::jsonb);
  SELECT updated_at INTO v_updated_at FROM public.contracts WHERE id = v_contract_changed;
  v_snapshot := jsonb_build_object('organizationId', v_org, 'generatedAt', clock_timestamp()::TEXT,
    'reference', 'CTR-AUTHORITY-003', 'contract', jsonb_build_object('id', v_contract_changed),
    'organization', jsonb_build_object('name', 'Current issuer'),
    'counterparty', jsonb_build_object('name', 'Current buyer'), 'chantier', NULL);
  v_result := public.publish_contract_document(v_contract_changed, v_org, v_updated_at, v_snapshot, true);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Changed-offer fixture publication failed: %', v_result;
  END IF;
  UPDATE public.quotes SET title = 'Revised offer' WHERE id = v_quote_changed;
  IF NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract_changed AND status = 'draft'
                 AND signature_token IS NULL AND signature_document_hash IS NULL
                 AND linked_quote_document IS NULL AND pdf_snapshot IS NULL) THEN
    RAISE EXCEPTION 'Revised linked offer did not invalidate its unsigned contract';
  END IF;

  SELECT updated_at INTO v_updated_at FROM public.contracts WHERE id = v_contract_changed;
  v_snapshot := jsonb_build_object('organizationId', v_org, 'generatedAt', clock_timestamp()::TEXT,
    'reference', 'CTR-AUTHORITY-003B', 'contract', jsonb_build_object('id', v_contract_changed),
    'organization', jsonb_build_object('name', 'Current issuer'),
    'counterparty', jsonb_build_object('name', 'Current buyer'), 'chantier', NULL);
  v_result := public.publish_contract_document(v_contract_changed, v_org, v_updated_at, v_snapshot, true);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Expired-offer fixture publication failed: %', v_result;
  END IF;
  v_token := v_result ->> 'signature_token';
  UPDATE public.contracts SET pdf_snapshot = jsonb_set(
    pdf_snapshot, '{reference}', '"FORGED-PDF-REFERENCE"'::JSONB
  ) WHERE id = v_contract_changed;
  IF NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract_changed AND status = 'draft'
                 AND signature_token IS NULL AND signature_document_hash IS NULL
                 AND linked_quote_document IS NULL AND pdf_reference IS NULL AND pdf_snapshot IS NULL) THEN
    RAISE EXCEPTION 'PDF snapshot mutation did not withdraw the active token';
  END IF;
  SELECT updated_at INTO v_updated_at FROM public.contracts WHERE id = v_contract_changed;
  v_snapshot := jsonb_set(v_snapshot, '{reference}', '"CTR-AUTHORITY-003C"'::JSONB);
  v_snapshot := jsonb_set(v_snapshot, '{generatedAt}', to_jsonb(clock_timestamp()::TEXT));
  v_result := public.publish_contract_document(v_contract_changed, v_org, v_updated_at, v_snapshot, true);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'PDF replacement publication failed: %', v_result;
  END IF;
  v_token := v_result ->> 'signature_token';
  UPDATE public.contracts SET signature_token_expires_at = NULL WHERE id = v_contract_changed;
  v_result := public.sign_contract_with_quote(v_token, 'Local Signer', NULL,
    'data:image/png;base64,signature-fixture', '127.0.0.1', 'null-expiry-fixture', true);
  IF v_result ->> 'code' IS DISTINCT FROM 'expired'
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract_changed AND status = 'sent'
                    AND client_signed_at IS NULL AND signature_token = v_token::UUID
                    AND signature_token_expires_at IS NULL)
     OR (SELECT status FROM public.quotes WHERE id = v_quote_changed) IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'NULL expiry token mutated a contract or linked quote: %', v_result;
  END IF;
  UPDATE public.contracts SET signature_token_expires_at = clock_timestamp() + INTERVAL '1 day'
  WHERE id = v_contract_changed;
  UPDATE public.quotes SET status = 'expired' WHERE id = v_quote_changed;
  v_result := public.sign_contract_with_quote(v_token, 'Local Signer', NULL,
    'data:image/png;base64,signature-fixture', '127.0.0.1', 'isolation-fixture', true);
  IF v_result ->> 'code' IS DISTINCT FROM 'not_found'
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract_changed AND status = 'draft'
                    AND client_signed_at IS NULL AND signature_token IS NULL)
     OR (SELECT status FROM public.quotes WHERE id = v_quote_changed) IS DISTINCT FROM 'expired' THEN
    RAISE EXCEPTION 'Expired linked offer permitted a partial signature: %', v_result;
  END IF;

  INSERT INTO public.quotes (id, organization_id, client_id, number, title, status)
  VALUES (v_quote_archived, v_org, v_client, 'DEV-CONTRACT-ARCHIVED', 'Offer to archive', 'draft');
  INSERT INTO public.contracts (id, organization_id, client_id, quote_id, contract_type, role,
    status, title, counterparty_name, template_key, template_title, clauses)
  VALUES (v_contract_archived, v_org, v_client, v_quote_archived, 'maintenance', 'donneur_ordre', 'draft',
    'Contract with archived offer', 'Current buyer', 'builtin:maintenance', 'Maintenance', '{}'::jsonb);
  SELECT updated_at INTO v_updated_at FROM public.contracts WHERE id = v_contract_archived;
  v_snapshot := jsonb_build_object('organizationId', v_org, 'generatedAt', clock_timestamp()::TEXT,
    'reference', 'CTR-AUTHORITY-004', 'contract', jsonb_build_object('id', v_contract_archived),
    'organization', jsonb_build_object('name', 'Current issuer'),
    'counterparty', jsonb_build_object('name', 'Current buyer'), 'chantier', NULL);
  v_result := public.publish_contract_document(v_contract_archived, v_org, v_updated_at, v_snapshot, true);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Archived-offer fixture publication failed: %', v_result;
  END IF;
  v_token := v_result ->> 'signature_token';
  UPDATE public.quotes SET is_archived = true WHERE id = v_quote_archived;
  v_result := public.sign_contract_with_quote(v_token, 'Local Signer', NULL,
    'data:image/png;base64,signature-fixture', '127.0.0.1', 'isolation-fixture', true);
  IF v_result ->> 'code' IS DISTINCT FROM 'quote_changed'
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract_archived AND status = 'sent'
                    AND client_signed_at IS NULL)
     OR (SELECT status FROM public.quotes WHERE id = v_quote_archived) IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'Archived linked offer permitted a partial signature: %', v_result;
  END IF;
  INSERT INTO public.quotes (id, organization_id, client_id, number, title, status)
  VALUES (v_quote_race, v_org, v_client, 'DEV-CONTRACT-RACE', 'Offer for expiry race', 'draft');
  INSERT INTO public.contracts (id, organization_id, client_id, quote_id, contract_type, role,
    status, title, counterparty_name, template_key, template_title, clauses)
  VALUES (v_contract_race, v_org, v_client, v_quote_race, 'maintenance', 'donneur_ordre', 'draft',
    'Contract for expiry race', 'Current buyer', 'builtin:maintenance', 'Maintenance', '{}'::jsonb);
  SELECT updated_at INTO v_updated_at FROM public.contracts WHERE id = v_contract_race;
  v_snapshot := jsonb_build_object('organizationId', v_org, 'generatedAt', clock_timestamp()::TEXT,
    'reference', 'CTR-AUTHORITY-RACE', 'contract', jsonb_build_object('id', v_contract_race),
    'organization', jsonb_build_object('name', 'Current issuer'),
    'counterparty', jsonb_build_object('name', 'Current buyer'), 'chantier', NULL);
  v_result := public.publish_contract_document(v_contract_race, v_org, v_updated_at, v_snapshot, true);
  IF COALESCE((v_result ->> 'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Expiry-race fixture publication failed: %', v_result;
  END IF;
  v_token := v_result ->> 'signature_token';
  PERFORM set_config('app.contract_expiry_race_quote_id', v_quote_race::TEXT, true);
  v_blocked := false;
  BEGIN
    PERFORM public.sign_contract_with_quote(v_token, 'Race Signer', NULL,
      'data:image/png;base64,race-fixture', '127.0.0.4', 'race-fixture', true);
  EXCEPTION WHEN serialization_failure THEN v_blocked := true;
  END;
  PERFORM set_config('app.contract_expiry_race_quote_id', '', true);
  IF NOT v_blocked
     OR NOT EXISTS (SELECT 1 FROM public.contracts WHERE id = v_contract_race AND status = 'sent'
                    AND client_signed_at IS NULL AND signature_token = v_token::UUID
                    AND signature_token_expires_at > clock_timestamp())
     OR NOT EXISTS (SELECT 1 FROM public.quotes WHERE id = v_quote_race AND status = 'sent'
                    AND signed_at IS NULL AND client_signature_image IS NULL) THEN
    RAISE EXCEPTION 'Expiry race wrote a partial contract/quote signature';
  END IF;
  DROP TRIGGER test_contract_expiry_race_hook_209 ON public.quotes;
  DROP FUNCTION public.test_contract_expiry_race_hook_209();

  IF has_function_privilege('authenticated',
       'public.sign_contract_with_quote(text,text,text,text,text,text,boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Authenticated JWT can invoke the service-only signature authority RPC';
  END IF;
END;
$test$;
ROLLBACK;
