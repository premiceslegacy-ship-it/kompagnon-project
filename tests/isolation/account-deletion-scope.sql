-- Run only against a disposable LOCAL Supabase database migrated through 212:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/account-deletion-scope.sql
-- All fixtures are inside a transaction and are rolled back on success.
BEGIN;

DO $test$
DECLARE
  v_target_org UUID := gen_random_uuid();
  v_other_org UUID := gen_random_uuid();
  v_actor UUID := gen_random_uuid();
  v_shared_user UUID := gen_random_uuid();
  v_private_user UUID := gen_random_uuid();
  v_target_role UUID := gen_random_uuid();
  v_other_role UUID := gen_random_uuid();
  v_shared_request UUID := gen_random_uuid();
  v_other_request UUID := gen_random_uuid();
  v_internal_request UUID := gen_random_uuid();
  v_quote_id UUID := gen_random_uuid();
  v_contract_id UUID := gen_random_uuid();
  v_quote_token UUID := gen_random_uuid();
  v_contract_token UUID := gen_random_uuid();
  v_shared_email TEXT := 'shared-' || gen_random_uuid()::TEXT || '@example.invalid';
  v_private_email TEXT := 'private-' || gen_random_uuid()::TEXT || '@example.invalid';
  v_logo_url TEXT;
  v_blocked BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  v_logo_url := 'https://supabase.local/storage/v1/object/public/logos/'
    || v_private_user::TEXT || '/logo.png';
  INSERT INTO public.organizations (id, name, slug, email, sector, logo_url)
  VALUES
    (v_target_org, 'Deletion scope target', 'delete-scope-' || v_target_org::TEXT,
     'target-' || v_target_org::TEXT || '@example.invalid', 'construction', v_logo_url),
    (v_other_org, 'Deletion scope active organization', 'delete-scope-other-' || v_other_org::TEXT,
     'other-' || v_other_org::TEXT || '@example.invalid', 'construction', v_logo_url);
  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_target_role, v_target_org, 'Deletion scope', 'deletion-scope'),
    (v_other_role, v_other_org, 'Deletion scope', 'deletion-scope');

  -- The inviter's signup creates its ordinary local fixture organization;
  -- invitee signups below are held by pending target-org invitations.
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES (v_actor, 'authenticated', 'authenticated',
          'actor-' || v_actor::TEXT || '@example.invalid', now());
  INSERT INTO public.profiles (id, email)
  VALUES (v_actor, 'actor-' || v_actor::TEXT || '@example.invalid')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.invitations (organization_id, invited_by, email, role_id)
  VALUES
    (v_target_org, v_actor, v_shared_email, v_target_role),
    (v_target_org, v_actor, v_private_email, v_target_role);
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_shared_user, 'authenticated', 'authenticated', v_shared_email, now()),
    (v_private_user, 'authenticated', 'authenticated', v_private_email, now());
  UPDATE public.invitations SET accepted_at = now()
  WHERE organization_id = v_target_org AND email IN (v_shared_email, v_private_email);

  INSERT INTO public.profiles (id, email, full_name, phone, avatar_url, job_title)
  VALUES
    (v_shared_user, v_shared_email, 'Shared member', '+33123456789',
     'https://example.invalid/shared-avatar.png', 'Shared role'),
    (v_private_user, v_private_email, 'Private member', '+33987654321',
     'https://example.invalid/private-avatar.png', 'Private role')
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    avatar_url = EXCLUDED.avatar_url,
    job_title = EXCLUDED.job_title;

  INSERT INTO public.memberships (organization_id, user_id, role_id, invited_by, is_active)
  VALUES
    (v_target_org, v_shared_user, v_target_role, v_actor, true),
    (v_other_org, v_shared_user, v_other_role, v_actor, true),
    (v_target_org, v_private_user, v_target_role, v_actor, true);

  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES
    ('quote-attachments', 'quote-requests/' || v_target_org::TEXT || '/scope-target.pdf', '{"mimetype":"application/pdf","size":12}'::JSONB),
    ('quote-attachments', 'quote-requests/' || v_other_org::TEXT || '/scope-other.pdf', '{"mimetype":"application/pdf","size":12}'::JSONB);

  INSERT INTO public.quote_requests (
    id, organization_id, name, email, phone, company_name, subject, description,
    prestation_type, dimensions, attachment_url, chantier_address_line1,
    chantier_postal_code, chantier_city, freeform_notes, catalog_items, attachments, type
  ) VALUES
    (
      v_shared_request, v_target_org, 'Request person', 'request@example.invalid',
      '+33111111111', 'Request company', 'Private subject', 'Private description',
      'Boiler replacement', '120x80 cm', NULL,
      '12 Rue du Test', '75001', 'Paris', 'Private freeform notes',
      '[{"id":"catalog-secret","description":"Private selection","quantity":2}]'::JSONB,
      jsonb_build_array(jsonb_build_object('storage_path', 'quote-requests/' || v_target_org::TEXT || '/scope-target.pdf', 'filename', 'request.pdf')),
      'catalog'
    ),
    (
      v_other_request, v_other_org, 'Other request person', 'other-request@example.invalid',
      '+33222222222', 'Other company', 'Other subject', 'Other description',
      'Other service', '3x4 m', NULL,
      '99 Rue Autre', '69001', 'Lyon', 'Other freeform notes',
      '[{"id":"other-catalog-secret"}]'::JSONB,
      jsonb_build_array(jsonb_build_object('storage_path', 'quote-requests/' || v_other_org::TEXT || '/scope-other.pdf')),
      'catalog'
    );

  INSERT INTO public.quotes (
    id, organization_id, created_by, number, status, signature_token, signature_token_expires_at
  ) VALUES (
    v_quote_id, v_target_org, v_private_user, 'SCOPE-' || v_quote_id::TEXT,
    'draft', v_quote_token, now() + INTERVAL '1 day'
  );
  UPDATE public.quotes SET
    status = 'accepted', signed_at = now(), signed_ip = '198.51.100.42',
    signed_user_agent = 'deletion-scope-fixture',
    client_signature_image = 'data:image/png;base64,retained-quote-signature',
    client_signatory_name = 'Retained quote signer', client_signatory_role = 'Director'
  WHERE id = v_quote_id;
  -- Restore a pre-cutover signed archive, without forging a new publication.
  EXECUTE 'ALTER TABLE public.contracts DISABLE TRIGGER contract_document_authority_guard';
  INSERT INTO public.contracts (
    id, organization_id, contract_type, role, status, title,
    counterparty_name, template_key, template_title, created_by,
    pdf_reference, pdf_snapshot, signed_at, client_signature_image,
    client_signatory_name, client_signed_at, signature_token, signature_token_expires_at
  ) VALUES (
    v_contract_id, v_target_org, 'maintenance', 'donneur_ordre', 'signed',
    'Retained signed contract', 'Retained counterparty', 'deletion-scope',
    'Deletion scope contract', v_private_user, 'local://deletion-scope/contract.pdf',
    '{"retained":"signed contract snapshot"}'::JSONB, now(),
    'data:image/png;base64,retained-contract-signature', 'Retained contract signer',
    now(), v_contract_token, now() + INTERVAL '1 day'
  );
  EXECUTE 'ALTER TABLE public.contracts ENABLE TRIGGER contract_document_authority_guard';

  UPDATE public.organizations
  SET deletion_scheduled_at = now() - INTERVAL '1 day', public_form_enabled = true
  WHERE id = v_target_org;

  PERFORM * FROM public.anonymize_organization_for_deletion(v_target_org);

  v_blocked := false;
  BEGIN
    UPDATE public.memberships SET is_active = true
    WHERE organization_id = v_target_org AND user_id = v_shared_user;
  EXCEPTION WHEN raise_exception THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'An erased organization regained an active membership'; END IF;
  v_blocked := false;
  BEGIN
    INSERT INTO public.memberships (organization_id, user_id, role_id, is_active)
    VALUES (v_target_org, v_actor, v_target_role, true);
  EXCEPTION WHEN raise_exception THEN v_blocked := true;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'An erased organization accepted a new member'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_storage_manifests
    WHERE organization_id = v_target_org AND logo_url = v_logo_url
  ) THEN
    RAISE EXCEPTION 'Original organization logo was not captured durably';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = v_target_org AND logo_url IS NULL
      AND public_form_enabled = false AND anonymized_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Organization public form and logo were not disabled/cleared';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = v_other_org AND logo_url = v_logo_url AND anonymized_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Logo pointer still used by another live organization was changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.quotes
    WHERE id = v_quote_id AND number = 'SCOPE-' || v_quote_id::TEXT
      AND status = 'accepted' AND signature_token IS NULL
      AND signature_token_expires_at IS NULL AND signed_at IS NOT NULL
      AND signed_ip = '198.51.100.42' AND signed_user_agent = 'deletion-scope-fixture'
      AND client_signature_image = 'data:image/png;base64,retained-quote-signature'
      AND client_signatory_name = 'Retained quote signer'
      AND client_signatory_role = 'Director'
  ) THEN
    RAISE EXCEPTION 'Quote public capability was not revoked without changing signed content';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contracts
    WHERE id = v_contract_id AND status = 'signed'
      AND signature_token IS NULL AND signature_token_expires_at IS NULL
      AND pdf_reference = 'local://deletion-scope/contract.pdf'
      AND pdf_snapshot = '{"retained":"signed contract snapshot"}'::JSONB
      AND signed_at IS NOT NULL
      AND client_signature_image = 'data:image/png;base64,retained-contract-signature'
      AND client_signatory_name = 'Retained contract signer' AND client_signed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Contract public capability was not revoked without changing signed content';
  END IF;

  -- Internal request insertion remains possible even when public intake is off.
  INSERT INTO public.quote_requests (id, organization_id, name, email, description)
  VALUES (v_internal_request, v_other_org, 'Internal lead', 'internal@example.invalid', 'Internal request');
  BEGIN
    INSERT INTO public.quote_requests (organization_id, name, email, description)
    VALUES (v_target_org, 'Late request', 'late@example.invalid', 'Must be rejected');
    RAISE EXCEPTION 'Anonymized organization accepted a quote request' USING ERRCODE = 'ZX001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    NULL;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_shared_user AND email = v_shared_email
      AND full_name = 'Shared member' AND phone = '+33123456789'
      AND avatar_url = 'https://example.invalid/shared-avatar.png'
      AND job_title = 'Shared role'
  ) THEN
    RAISE EXCEPTION 'Profile for an identity active in another organization was anonymized';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE organization_id = v_other_org AND user_id = v_shared_user AND is_active = true
  ) THEN
    RAISE EXCEPTION 'Shared identity membership in the other organization was changed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE organization_id = v_target_org AND user_id = v_shared_user AND is_active = false
  ) THEN
    RAISE EXCEPTION 'Target-organization shared membership was not deactivated';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = v_private_user
      AND email = 'deleted-' || v_private_user || '@anonymized.invalid'
      AND full_name = 'Compte supprimé' AND phone IS NULL
      AND avatar_url IS NULL AND job_title IS NULL
  ) THEN
    RAISE EXCEPTION 'Private profile was not anonymized';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.quote_requests
    WHERE id = v_shared_request
      AND name = 'Demandeur anonymisé'
      AND email = 'deleted-' || v_shared_request || '@anonymized.invalid'
      AND phone IS NULL AND company_name IS NULL AND subject IS NULL
      AND description = 'Demande anonymisée'
      AND prestation_type IS NULL AND dimensions IS NULL AND attachment_url IS NULL
      AND chantier_address_line1 IS NULL AND chantier_postal_code IS NULL AND chantier_city IS NULL
      AND freeform_notes IS NULL AND catalog_items IS NULL AND attachments IS NULL
      AND type = 'custom'
  ) THEN
    RAISE EXCEPTION 'Target quote-request personal payload was not erased';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.quote_requests
    WHERE id = v_other_request
      AND name = 'Other request person' AND email = 'other-request@example.invalid'
      AND phone = '+33222222222' AND company_name = 'Other company'
      AND subject = 'Other subject' AND description = 'Other description'
      AND prestation_type = 'Other service' AND dimensions = '3x4 m'
      AND attachment_url IS NULL
      AND chantier_address_line1 = '99 Rue Autre'
      AND chantier_postal_code = '69001' AND chantier_city = 'Lyon'
      AND freeform_notes = 'Other freeform notes'
      AND catalog_items = '[{"id":"other-catalog-secret"}]'::JSONB
      AND attachments = jsonb_build_array(jsonb_build_object('storage_path', 'quote-requests/' || v_other_org::TEXT || '/scope-other.pdf'))
      AND type = 'catalog'
  ) THEN
    RAISE EXCEPTION 'Quote-request data in another organization was changed';
  END IF;
  -- Exercise the policies as real authenticated identities, not policy text.
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_private_user::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name)
    VALUES ('logos', v_private_user::TEXT || '/after-erasure.png');
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true;
  END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked THEN RAISE EXCEPTION 'Deactivated identity repopulated its logo folder'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_shared_user::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  INSERT INTO storage.objects (bucket_id, name)
  VALUES ('logos', v_shared_user::TEXT || '/shared-active.png');
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
    WHERE bucket_id = 'logos' AND name = v_shared_user::TEXT || '/shared-active.png'
  ) THEN
    RAISE EXCEPTION 'Active shared identity could not persist its legitimate logo';
  END IF;
  EXECUTE 'RESET ROLE';
END;
$test$;

ROLLBACK;
