-- Run only against a disposable LOCAL Supabase database (full schema through 210):
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/account-deletion-fk-erasure.sql
-- Before migration 200 this is expected to fail at the first auth.users DELETE
-- with invoices_created_by_fkey. After migration 200 the full script must pass.
-- All fixtures are inside a transaction and are rolled back on success.
BEGIN;

DO $test$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_actor UUID := gen_random_uuid();
  v_user_invoice UUID := gen_random_uuid();
  v_user_references UUID := gen_random_uuid();
  v_role_id UUID := gen_random_uuid();
  v_chantier_id UUID := gen_random_uuid();
  v_invoice_id UUID := gen_random_uuid();
  v_quote_id UUID := gen_random_uuid();
  v_contract_id UUID := gen_random_uuid();
  v_invitation_id UUID := gen_random_uuid();
  v_signup_invitation_invoice UUID := gen_random_uuid();
  v_signup_invitation_references UUID := gen_random_uuid();
  v_note_id UUID := gen_random_uuid();
  v_pointage_id UUID := gen_random_uuid();
  v_photo_id UUID := gen_random_uuid();
  v_audit_id UUID := gen_random_uuid();
  v_quote_token UUID := gen_random_uuid();
  v_invoice_number TEXT := 'ERASURE-' || gen_random_uuid()::TEXT;
  v_contract_snapshot JSONB := jsonb_build_object('retained', 'signed contract snapshot');
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.organizations (id, name, slug, email, sector)
  VALUES (v_org_id, 'Erasure FK regression', 'erasure-fk-' || v_org_id::TEXT,
          'erasure-' || v_org_id::TEXT || '@example.invalid', 'construction');
  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES (v_role_id, v_org_id, 'Erasure test', 'erasure-test');

  -- This inviter is only a fixture actor. Pending invitations prevent the Auth
  -- signup trigger from creating a second, unrelated organization for invitees.
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES (v_actor, 'authenticated', 'authenticated',
          'actor-' || v_actor::TEXT || '@example.invalid', now());
  INSERT INTO public.profiles (id, email)
  VALUES (v_actor, 'actor-' || v_actor::TEXT || '@example.invalid')
  ON CONFLICT (id) DO NOTHING;

  -- Isolated before-case: the invoice is the only NO ACTION application FK
  -- referring to this member, so pre-200 failure identifies the retained invoice.
  INSERT INTO public.invitations (id, organization_id, invited_by, email, role_id)
  VALUES (v_signup_invitation_invoice, v_org_id, v_actor,
          'invoice-' || v_user_invoice::TEXT || '@example.invalid', v_role_id);
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES (v_user_invoice, 'authenticated', 'authenticated',
          'invoice-' || v_user_invoice::TEXT || '@example.invalid', now());
  INSERT INTO public.profiles (id, email)
  VALUES (v_user_invoice, 'invoice-' || v_user_invoice::TEXT || '@example.invalid')
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.invitations SET accepted_at = now()
  WHERE id = v_signup_invitation_invoice;
  INSERT INTO public.memberships (organization_id, user_id, role_id, invited_by)
  VALUES (v_org_id, v_user_invoice, v_role_id, v_actor);
  INSERT INTO public.invoices (
    id, organization_id, created_by, number, status, total_ht, total_tva, total_ttc,
    pdf_url, facturx_xml
  ) VALUES (
    v_invoice_id, v_org_id, v_user_invoice, v_invoice_number, 'draft', 100, 20, 120,
    'local://erasure-regression/invoice.pdf', '<invoice>retained fiscal document</invoice>'
  );
  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, position
  ) VALUES (
    v_invoice_id, 'Retained fiscal line', 1, 'u', 100, 20, 0
  );
  UPDATE public.invoices SET status = 'sent', sent_at = now() WHERE id = v_invoice_id;

  DELETE FROM auth.users WHERE id = v_user_invoice;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_invoice)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_invoice) THEN
    RAISE EXCEPTION 'Auth user/profile deletion did not complete';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_invoice_id
      AND created_by IS NULL
      AND number = v_invoice_number
      AND status = 'sent'
      AND total_ht = 100
      AND total_tva = 20
      AND total_ttc = 120
      AND pdf_url = 'local://erasure-regression/invoice.pdf'
      AND facturx_xml = '<invoice>retained fiscal document</invoice>'
  ) THEN
    RAISE EXCEPTION 'Invoice did not retain its fiscal content after creator erasure';
  END IF;

  -- A second invitee exercises other auth.users and cascaded profiles blockers.
  INSERT INTO public.invitations (id, organization_id, invited_by, email, role_id)
  VALUES (v_signup_invitation_references, v_org_id, v_actor,
          'references-' || v_user_references::TEXT || '@example.invalid', v_role_id);
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES (v_user_references, 'authenticated', 'authenticated',
          'references-' || v_user_references::TEXT || '@example.invalid', now());
  INSERT INTO public.profiles (id, email)
  VALUES (v_user_references, 'references-' || v_user_references::TEXT || '@example.invalid')
  ON CONFLICT (id) DO NOTHING;
  UPDATE public.invitations SET accepted_at = now()
  WHERE id = v_signup_invitation_references;
  INSERT INTO public.memberships (organization_id, user_id, role_id, invited_by)
  VALUES (v_org_id, v_user_references, v_role_id, v_actor);

  INSERT INTO public.invitations (id, organization_id, invited_by, email, role_id)
  VALUES (v_invitation_id, v_org_id, v_user_references,
          'invitee-' || v_invitation_id::TEXT || '@example.invalid', v_role_id);
  INSERT INTO public.quotes (id, organization_id, created_by, number, status, signature_token)
  VALUES (v_quote_id, v_org_id, v_user_references, 'ERASURE-QUOTE-' || v_quote_id::TEXT, 'draft', v_quote_token);
  UPDATE public.quotes SET
    status = 'accepted', signed_at = now(), signed_ip = '192.0.2.42',
    signed_user_agent = 'erasure-regression',
    client_signature_image = 'data:image/png;base64,synthetic-signature',
    client_signatory_name = 'Retained Signatory', client_signatory_role = 'Client'
  WHERE id = v_quote_id;
  -- Restore a pre-cutover signed archive; new publications use the 209 RPC.
  EXECUTE 'ALTER TABLE public.contracts DISABLE TRIGGER contract_document_authority_guard';
  INSERT INTO public.contracts (
    id, organization_id, contract_type, role, status, title,
    counterparty_name, template_key, template_title, created_by,
    pdf_reference, pdf_snapshot, signed_at,
    client_signature_image, client_signatory_name, client_signed_at
  ) VALUES (
    v_contract_id, v_org_id, 'maintenance', 'donneur_ordre', 'signed',
    'Retained signed contract', 'Retained counterparty', 'erasure-test',
    'Erasure test template', v_user_references, 'local://erasure-regression/contract.pdf',
    v_contract_snapshot, now(), 'data:image/png;base64,synthetic-contract-signature',
    'Retained Contract Signatory', now()
  );
  EXECUTE 'ALTER TABLE public.contracts ENABLE TRIGGER contract_document_authority_guard';
  INSERT INTO public.chantiers (id, organization_id, title, created_by)
  VALUES (v_chantier_id, v_org_id, 'Erasure FK chantier', v_user_references);
  INSERT INTO public.chantier_notes (id, chantier_id, author_id, content)
  VALUES (v_note_id, v_chantier_id, v_user_references, 'Retained chantier note');
  INSERT INTO public.chantier_pointages (
    id, chantier_id, user_id, date, hours, description, rate_snapshot
  ) VALUES (
    v_pointage_id, v_chantier_id, v_user_references, CURRENT_DATE, 7.5,
    'Retained work record', 42.50
  );
  INSERT INTO public.chantier_photos (
    id, chantier_id, uploaded_by, storage_path, caption
  ) VALUES (
    v_photo_id, v_chantier_id, v_user_references,
    'erasure-regression/retained-photo.png', 'Retained proof photo'
  );
  INSERT INTO public.activity_log (id, organization_id, user_id, action, entity_type, entity_id, metadata, created_at)
  VALUES (v_audit_id, v_org_id, v_user_references, 'audit.erasure.fixture', 'invoice', v_invoice_id,
          '{"retained":true}'::JSONB, '2026-01-01T00:00:00Z');

  DELETE FROM auth.users WHERE id = v_user_references;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_references)
     OR EXISTS (SELECT 1 FROM public.profiles WHERE id = v_user_references) THEN
    RAISE EXCEPTION 'Representative Auth user/profile deletion did not complete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.memberships
    WHERE organization_id = v_org_id AND user_id = v_user_references
  ) THEN
    RAISE EXCEPTION 'Membership did not follow its existing ON DELETE CASCADE contract';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invitations
    WHERE id = v_invitation_id AND invited_by IS NULL
      AND email = 'invitee-' || v_invitation_id::TEXT || '@example.invalid'
  ) THEN
    RAISE EXCEPTION 'Invitation record was not retained with its erased inviter cleared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.quotes
    WHERE id = v_quote_id AND created_by IS NULL AND signature_token = v_quote_token
      AND signed_at IS NOT NULL AND signed_ip = '192.0.2.42'
      AND signed_user_agent = 'erasure-regression'
      AND client_signature_image = 'data:image/png;base64,synthetic-signature'
      AND client_signatory_name = 'Retained Signatory'
      AND client_signatory_role = 'Client'
  ) THEN
    RAISE EXCEPTION 'Signed quote/signature fields were not retained after creator erasure';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contracts
    WHERE id = v_contract_id AND created_by IS NULL
      AND status = 'signed' AND pdf_reference = 'local://erasure-regression/contract.pdf'
      AND pdf_snapshot = v_contract_snapshot AND signed_at IS NOT NULL
      AND client_signature_image = 'data:image/png;base64,synthetic-contract-signature'
      AND client_signatory_name = 'Retained Contract Signatory'
      AND client_signed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Signed contract/signature snapshot was not retained after creator erasure';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chantiers
    WHERE id = v_chantier_id AND created_by IS NULL
  ) THEN
    RAISE EXCEPTION 'Chantier was not retained with its erased creator cleared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chantier_notes
    WHERE id = v_note_id AND author_id IS NULL AND content = 'Retained chantier note'
  ) THEN
    RAISE EXCEPTION 'Chantier note was not retained with its erased author cleared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chantier_pointages
    WHERE id = v_pointage_id AND user_id IS NULL AND hours = 7.5
      AND rate_snapshot = 42.50 AND description = 'Retained work record'
      AND author_erased_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Pointage/rate snapshot was not retained after profile erasure';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.chantier_photos
    WHERE id = v_photo_id AND uploaded_by IS NULL
      AND storage_path = 'erasure-regression/retained-photo.png'
      AND caption = 'Retained proof photo'
      AND author_erased_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Photo record was not retained with its erased uploader cleared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.activity_log
    WHERE id = v_audit_id AND user_id IS NULL
      AND action = 'audit.erasure.fixture' AND entity_type = 'invoice'
      AND entity_id = v_invoice_id AND metadata = '{"retained":true}'::JSONB
      AND created_at = '2026-01-01T00:00:00Z'
  ) THEN
    RAISE EXCEPTION 'Append-only audit event was not retained after actor erasure';
  END IF;

  BEGIN
    INSERT INTO public.chantier_pointages (chantier_id, date, hours)
    VALUES (v_chantier_id, CURRENT_DATE, 1);
    RAISE EXCEPTION 'A new pointage without an author was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.chantier_photos (chantier_id, storage_path)
    VALUES (v_chantier_id, 'erasure-regression/anonymous.png');
    RAISE EXCEPTION 'A new photo without an author was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
  BEGIN
    INSERT INTO public.chantier_pointages (chantier_id, user_id, date, hours, author_erased_at)
    VALUES (v_chantier_id, v_actor, CURRENT_DATE, 1, now());
    RAISE EXCEPTION 'A forged erased-author marker was accepted';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_class AS child_table ON child_table.oid = c.conrelid
    JOIN pg_catalog.pg_namespace AS child_schema ON child_schema.oid = child_table.relnamespace
    WHERE c.contype = 'f'
      AND child_schema.nspname = 'public'
      AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
      AND c.confdeltype IN ('a', 'r')
  ) THEN
    RAISE EXCEPTION 'A public NO ACTION/RESTRICT FK still blocks Auth/profile deletion';
  END IF;
END;
$test$;

ROLLBACK;
