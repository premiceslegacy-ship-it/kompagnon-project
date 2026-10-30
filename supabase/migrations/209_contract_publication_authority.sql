-- A public contract-signature capability is bound to one immutable published
-- document and (when present) the exact quote publication attached to it.
BEGIN;

ALTER TABLE public.contracts
  ALTER COLUMN signature_token DROP DEFAULT,
  ADD COLUMN IF NOT EXISTS signature_document_hash TEXT,
  ADD COLUMN IF NOT EXISTS linked_quote_document JSONB;

ALTER TABLE public.contracts
  ADD CONSTRAINT contracts_signature_document_hash_format
  CHECK (signature_document_hash IS NULL OR signature_document_hash ~ '^[0-9a-f]{64}$');

COMMENT ON COLUMN public.contracts.signature_document_hash IS
  'SHA-256 binding the immutable published PDF facts and linked quote publication; NULL means no verified public signing authority.';
COMMENT ON COLUMN public.contracts.linked_quote_document IS
  'Frozen quote row and document_snapshot attached at contract publication; signature metadata may be decorated without changing its document_snapshot.';
COMMENT ON COLUMN public.contracts.pdf_snapshot IS
  'Immutable facts of one prepared or published contract document. Public signing overlays its signature from row metadata without rebuilding the archive.';

-- Pre-existing unsigned links have no verifiable binding to the PDF that was
-- presented. Revoke them and require an explicit fresh publication. Signed
-- contracts, signatures and their already stored snapshots are retained.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
UPDATE public.contracts
SET status = 'draft',
    sent_at = NULL,
    signature_token = NULL,
    signature_token_expires_at = NULL,
    signature_document_hash = NULL,
    linked_quote_document = NULL,
    pdf_reference = NULL,
    pdf_generated_at = NULL,
    pdf_snapshot = NULL
WHERE status <> 'signed'
  AND client_signed_at IS NULL
  AND (signature_token IS NOT NULL OR status = 'sent');

CREATE OR REPLACE FUNCTION public.contract_document_hash(
  p_pdf_snapshot JSONB,
  p_linked_quote_document JSONB
)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT CASE WHEN p_pdf_snapshot IS NULL THEN NULL ELSE
    encode(extensions.digest(
      convert_to(jsonb_build_object(
        'contract', p_pdf_snapshot,
        'linked_quote_document', p_linked_quote_document -> 'document_snapshot'
      )::TEXT, 'UTF8'),
      'sha256'
    ), 'hex')
  END;
$$;

CREATE OR REPLACE FUNCTION public.guard_contract_document_authority()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_authorized BOOLEAN := COALESCE(auth.role() = 'service_role', false)
    OR COALESCE(current_setting('app.contract_document_mutation', true) = 'on', false);
  v_material_exclusions TEXT[] := ARRAY[
    'updated_at', 'status', 'sent_at', 'signed_at', 'archived_at',
    'signature_token', 'signature_token_expires_at', 'signature_document_hash',
    'linked_quote_document', 'pdf_reference', 'pdf_generated_at', 'pdf_snapshot',
    'client_signature_image', 'client_signatory_name', 'client_signatory_role',
    'client_signed_at'
  ];
  v_authority_fields TEXT[] := ARRAY[
    'signature_token', 'signature_token_expires_at', 'signature_document_hash',
    'linked_quote_document', 'pdf_reference', 'pdf_generated_at', 'pdf_snapshot',
    'client_signature_image', 'client_signatory_name', 'client_signatory_role',
    'client_signed_at'
  ];
  v_material_changed BOOLEAN;
  v_authority_changed BOOLEAN;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_authorized AND (
      NEW.status IS DISTINCT FROM 'draft'
      OR NEW.sent_at IS NOT NULL
      OR NEW.signed_at IS NOT NULL
      OR NEW.archived_at IS NOT NULL
      OR NEW.signature_token IS NOT NULL
      OR NEW.signature_token_expires_at IS NOT NULL
      OR NEW.signature_document_hash IS NOT NULL
      OR NEW.linked_quote_document IS NOT NULL
      OR NEW.pdf_reference IS NOT NULL
      OR NEW.pdf_generated_at IS NOT NULL
      OR NEW.pdf_snapshot IS NOT NULL
      OR NEW.client_signature_image IS NOT NULL
      OR NEW.client_signatory_name IS NOT NULL
      OR NEW.client_signatory_role IS NOT NULL
      OR NEW.client_signed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'L''autorité documentaire et la signature du contrat sont réservées au serveur'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  v_material_changed :=
    (to_jsonb(NEW) - v_material_exclusions)
      IS DISTINCT FROM (to_jsonb(OLD) - v_material_exclusions)
    OR (
      OLD.status = 'sent'
      AND NEW.status = 'sent'
      AND current_setting('app.contract_document_mutation', true) IS DISTINCT FROM 'on'
      AND (
        NEW.pdf_snapshot IS DISTINCT FROM OLD.pdf_snapshot
        OR NEW.signature_document_hash IS DISTINCT FROM OLD.signature_document_hash
        OR NEW.pdf_reference IS DISTINCT FROM OLD.pdf_reference
        OR (NEW.linked_quote_document -> 'document_snapshot')
          IS DISTINCT FROM (OLD.linked_quote_document -> 'document_snapshot')
      )
    );
  v_authority_changed := EXISTS (
    SELECT 1
    FROM unnest(v_authority_fields) AS fields(field_name)
    WHERE (to_jsonb(NEW) -> field_name) IS DISTINCT FROM (to_jsonb(OLD) -> field_name)
  );

  -- Signed legal content and collected signatures are never rewritten. The
  -- trusted account-erasure path may only revoke the public capability.
  IF OLD.status = 'signed' OR OLD.client_signed_at IS NOT NULL THEN
    IF NEW.created_by IS DISTINCT FROM OLD.created_by
       AND NOT (
         OLD.created_by IS NOT NULL
         AND NEW.created_by IS NULL
         AND session_user IN ('postgres', 'supabase_auth_admin')
       ) THEN
      RAISE EXCEPTION 'created_by ne peut être effacé que par la suppression Auth de son auteur';
    END IF;
    IF (to_jsonb(NEW) - ARRAY['updated_at', 'status', 'archived_at', 'signature_token', 'signature_token_expires_at'] - 'created_by')
       IS DISTINCT FROM
       (to_jsonb(OLD) - ARRAY['updated_at', 'status', 'archived_at', 'signature_token', 'signature_token_expires_at'] - 'created_by') THEN
      RAISE EXCEPTION 'Un contrat signé et ses preuves légales sont immuables' USING ERRCODE = '42501';
    END IF;
    IF v_authority_changed AND NOT v_authorized THEN
      RAISE EXCEPTION 'La révocation du lien public est réservée au serveur' USING ERRCODE = '42501';
    END IF;
    IF NEW.signature_token IS DISTINCT FROM OLD.signature_token AND NEW.signature_token IS NOT NULL THEN
      RAISE EXCEPTION 'Un lien public révoqué ne peut pas être remplacé sur un contrat signé' USING ERRCODE = '42501';
    END IF;
    IF NEW.signature_token_expires_at IS DISTINCT FROM OLD.signature_token_expires_at
       AND NEW.signature_token_expires_at IS NOT NULL THEN
      RAISE EXCEPTION 'La durée d''un lien signé ne peut pas être prolongée' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF v_authority_changed AND NOT v_authorized THEN
    RAISE EXCEPTION 'L''autorité documentaire du contrat est réservée au serveur' USING ERRCODE = '42501';
  END IF;

  IF v_material_changed THEN
    IF NEW.status = 'signed' OR NEW.client_signed_at IS NOT NULL OR NEW.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Un contrat ne peut pas être signé dans la même modification que ses conditions' USING ERRCODE = '40001';
    END IF;
    -- Any change to unsigned material withdraws the old capability and PDF.
    NEW.status := 'draft';
    NEW.sent_at := NULL;
    NEW.signature_token := NULL;
    NEW.signature_token_expires_at := NULL;
    NEW.signature_document_hash := NULL;
    NEW.linked_quote_document := NULL;
    NEW.pdf_reference := NULL;
    NEW.pdf_generated_at := NULL;
    NEW.pdf_snapshot := NULL;
  ELSIF NEW.status = 'signed' AND OLD.status IS DISTINCT FROM 'signed' AND NOT v_authorized THEN
    -- A manually recorded signature is not a public token signature.
    NEW.signature_token := NULL;
    NEW.signature_token_expires_at := NULL;
    NEW.signature_document_hash := NULL;
  ELSIF NEW.status = 'archived' AND OLD.status <> 'archived' THEN
    NEW.signature_token := NULL;
    NEW.signature_token_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_document_authority_guard ON public.contracts;
CREATE TRIGGER contract_document_authority_guard
  BEFORE INSERT OR UPDATE ON public.contracts
  FOR EACH ROW EXECUTE FUNCTION public.guard_contract_document_authority();

CREATE OR REPLACE FUNCTION public.invalidate_contracts_for_quote_document_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_previous_setting TEXT := current_setting('app.contract_document_mutation', true);
  v_invalidated BOOLEAN := false;
BEGIN
  IF OLD.document_snapshot IS NOT NULL AND (
    NEW.document_snapshot IS DISTINCT FROM OLD.document_snapshot
    OR (NEW.status IN ('refused', 'expired', 'cancelled')
        AND NEW.status IS DISTINCT FROM OLD.status)
  ) THEN
    PERFORM set_config('app.contract_document_mutation', 'on', true);
    UPDATE public.contracts
    SET status = 'draft',
        sent_at = NULL,
        signature_token = NULL,
        signature_token_expires_at = NULL,
        signature_document_hash = NULL,
        linked_quote_document = NULL,
        pdf_reference = NULL,
        pdf_generated_at = NULL,
        pdf_snapshot = NULL
    WHERE quote_id = NEW.id
      AND status NOT IN ('signed', 'archived')
      AND client_signed_at IS NULL
      AND linked_quote_document ->> 'id' = NEW.id::TEXT
      AND linked_quote_document -> 'document_snapshot' = OLD.document_snapshot;
    v_invalidated := true;
  END IF;

  IF v_invalidated THEN
    PERFORM set_config('app.contract_document_mutation', COALESCE(v_previous_setting, ''), true);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_quote_document_invalidation ON public.quotes;
CREATE TRIGGER contract_quote_document_invalidation
  AFTER UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.invalidate_contracts_for_quote_document_change();

CREATE OR REPLACE FUNCTION public.save_contract_draft_pdf_snapshot(
  p_contract_id UUID,
  p_organization_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_pdf_snapshot JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_contract public.contracts%ROWTYPE;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    RAISE EXCEPTION 'Action réservée au serveur' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_contract FROM public.contracts
  WHERE id = p_contract_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR v_contract.updated_at IS DISTINCT FROM p_expected_updated_at
     OR v_contract.status <> 'draft' OR v_contract.client_signed_at IS NOT NULL
     OR v_contract.signature_token IS NOT NULL OR v_contract.signature_document_hash IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_or_published');
  END IF;
  IF p_pdf_snapshot ->> 'organizationId' IS DISTINCT FROM p_organization_id::TEXT
     OR p_pdf_snapshot -> 'contract' ->> 'id' IS DISTINCT FROM p_contract_id::TEXT
     OR NULLIF(p_pdf_snapshot ->> 'reference', '') IS NULL
     OR NULLIF(p_pdf_snapshot ->> 'generatedAt', '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_snapshot');
  END IF;
  UPDATE public.contracts SET
    pdf_reference = p_pdf_snapshot ->> 'reference',
    pdf_generated_at = (p_pdf_snapshot ->> 'generatedAt')::TIMESTAMPTZ,
    pdf_snapshot = p_pdf_snapshot
  WHERE id = p_contract_id AND organization_id = p_organization_id
    AND updated_at = p_expected_updated_at AND status = 'draft'
    AND signature_token IS NULL AND signature_document_hash IS NULL
  RETURNING * INTO v_contract;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'stale_or_published'); END IF;
  RETURN jsonb_build_object('ok', true, 'pdf_reference', v_contract.pdf_reference,
    'pdf_generated_at', v_contract.pdf_generated_at);
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_contract_document(
  p_contract_id UUID,
  p_organization_id UUID,
  p_expected_updated_at TIMESTAMPTZ,
  p_pdf_snapshot JSONB,
  p_publish_linked_quote BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions, pg_temp
AS $$
DECLARE
  v_seed public.contracts%ROWTYPE;
  v_contract public.contracts%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_has_quote BOOLEAN := false;
  v_linked_quote_document JSONB := NULL;
  v_now TIMESTAMPTZ;
  v_token UUID;
  v_expiry TIMESTAMPTZ;
  v_hash TEXT;
  v_previous_mutation_setting TEXT := current_setting('app.contract_document_mutation', true);
  v_publication_updated BOOLEAN := false;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    RAISE EXCEPTION 'Action réservée au serveur' USING ERRCODE = '42501';
  END IF;
  IF p_pdf_snapshot ->> 'organizationId' IS DISTINCT FROM p_organization_id::TEXT
     OR p_pdf_snapshot -> 'contract' ->> 'id' IS DISTINCT FROM p_contract_id::TEXT
     OR NULLIF(p_pdf_snapshot ->> 'reference', '') IS NULL
     OR NULLIF(p_pdf_snapshot ->> 'generatedAt', '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_snapshot');
  END IF;

  -- Quote mutations acquire the quote lock before invalidating linked contracts.
  -- Use that same lock order, then revalidate the contract row after locking it.
  SELECT * INTO v_seed FROM public.contracts
  WHERE id = p_contract_id AND organization_id = p_organization_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;
  IF v_seed.quote_id IS NOT NULL THEN
    SELECT * INTO v_quote FROM public.quotes
    WHERE id = v_seed.quote_id AND organization_id = p_organization_id
    FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'linked_quote_unavailable'); END IF;
    v_has_quote := true;
  END IF;
  SELECT * INTO v_contract FROM public.contracts
  WHERE id = p_contract_id AND organization_id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND OR v_contract.updated_at IS DISTINCT FROM p_expected_updated_at
     OR v_contract.quote_id IS DISTINCT FROM v_seed.quote_id THEN
    RETURN jsonb_build_object('ok', false, 'code', 'stale_contract');
  END IF;
  IF v_contract.status IN ('signed', 'archived') OR v_contract.archived_at IS NOT NULL
     OR v_contract.client_signed_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_publishable');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_organization_id AND anonymized_at IS NULL
    FOR SHARE
  ) THEN RETURN jsonb_build_object('ok', false, 'code', 'organization_unavailable'); END IF;

  IF v_has_quote THEN
    IF COALESCE(v_quote.is_archived, false)
       OR v_quote.status IN ('refused', 'expired', 'cancelled')
       OR (v_quote.status IN ('draft', 'sent', 'viewed') AND v_quote.valid_until IS NOT NULL
           AND v_quote.valid_until < CURRENT_DATE) THEN
      RETURN jsonb_build_object('ok', false, 'code', 'linked_quote_unavailable');
    END IF;
    IF v_quote.client_id IS DISTINCT FROM v_contract.client_id THEN
      RETURN jsonb_build_object('ok', false, 'code', 'linked_quote_client_mismatch');
    END IF;
    IF v_quote.status IN ('draft', 'sent', 'viewed') AND v_quote.document_snapshot IS NULL THEN
      IF NOT p_publish_linked_quote THEN
        RETURN jsonb_build_object('ok', false, 'code', 'quote_send_permission_required');
      END IF;
      IF v_quote.status <> 'draft' THEN
        UPDATE public.quotes SET status = 'draft' WHERE id = v_quote.id;
      END IF;
      v_now := clock_timestamp();
      UPDATE public.quotes SET status = 'sent', sent_at = v_now
      WHERE id = v_quote.id AND organization_id = p_organization_id AND status = 'draft';
      SELECT * INTO v_quote FROM public.quotes WHERE id = v_quote.id;
    ELSIF v_quote.status = 'draft' THEN
      IF NOT p_publish_linked_quote THEN
        RETURN jsonb_build_object('ok', false, 'code', 'quote_send_permission_required');
      END IF;
      v_now := clock_timestamp();
      UPDATE public.quotes SET status = 'sent', sent_at = v_now
      WHERE id = v_quote.id AND organization_id = p_organization_id AND status = 'draft';
      SELECT * INTO v_quote FROM public.quotes WHERE id = v_quote.id;
    END IF;
    IF v_quote.status IN ('refused', 'expired', 'cancelled') OR COALESCE(v_quote.is_archived, false)
       OR v_quote.document_snapshot IS NULL
       OR v_quote.organization_id IS DISTINCT FROM p_organization_id
       OR v_quote.client_id IS DISTINCT FROM v_contract.client_id THEN
      RAISE EXCEPTION 'Le devis associé ne possède pas de publication valide' USING ERRCODE = '23514';
    END IF;
    IF v_quote.status NOT IN ('sent', 'viewed', 'accepted', 'converted', 'fully_invoiced') THEN
      RAISE EXCEPTION 'Le devis associé n''est pas disponible' USING ERRCODE = '23514';
    END IF;
    v_linked_quote_document := jsonb_build_object(
      'id', v_quote.id,
      'status', v_quote.status,
      'signed_at', v_quote.signed_at,
      'client_signature_image', v_quote.client_signature_image,
      'client_signatory_name', v_quote.client_signatory_name,
      'client_signatory_role', v_quote.client_signatory_role,
      'document_snapshot', v_quote.document_snapshot
    );
  END IF;

  v_now := clock_timestamp();
  v_token := gen_random_uuid();
  v_expiry := v_now + INTERVAL '60 days';
  v_hash := public.contract_document_hash(p_pdf_snapshot, v_linked_quote_document);
  PERFORM set_config('app.contract_document_mutation', 'on', true);
  UPDATE public.contracts SET
    status = 'sent',
    sent_at = v_now,
    pdf_reference = p_pdf_snapshot ->> 'reference',
    pdf_generated_at = (p_pdf_snapshot ->> 'generatedAt')::TIMESTAMPTZ,
    pdf_snapshot = p_pdf_snapshot,
    signature_token = v_token,
    signature_token_expires_at = v_expiry,
    linked_quote_document = v_linked_quote_document,
    signature_document_hash = v_hash
  WHERE id = p_contract_id AND organization_id = p_organization_id
    AND updated_at = p_expected_updated_at
    AND status NOT IN ('signed', 'archived')
    AND client_signed_at IS NULL
  RETURNING * INTO v_contract;
  v_publication_updated := FOUND;
  PERFORM set_config('app.contract_document_mutation', COALESCE(v_previous_mutation_setting, ''), true);
  IF NOT v_publication_updated THEN
    RAISE EXCEPTION 'Contrat modifié pendant la publication' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'signature_token', v_contract.signature_token,
    'signature_token_expires_at', v_contract.signature_token_expires_at,
    'pdf_reference', v_contract.pdf_reference,
    'pdf_generated_at', v_contract.pdf_generated_at,
    'sent_at', v_contract.sent_at,
    'linked_quote_document', v_contract.linked_quote_document,
    'publication_record', to_jsonb(v_contract)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sign_contract_with_quote(
  p_token TEXT,
  p_signatory_name TEXT,
  p_signatory_role TEXT,
  p_signature_image TEXT,
  p_signed_ip TEXT,
  p_signed_user_agent TEXT,
  p_accept_quote BOOLEAN
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_seed public.contracts%ROWTYPE;
  v_contract public.contracts%ROWTYPE;
  v_quote public.quotes%ROWTYPE;
  v_quote_id UUID;
  v_now TIMESTAMPTZ;
  v_signed_at TIMESTAMPTZ;
  v_linked_quote_document JSONB;
  v_quote_changed BOOLEAN := false;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    RAISE EXCEPTION 'Action réservée au serveur' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_seed FROM public.contracts WHERE signature_token::TEXT = p_token;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'not_found'); END IF;

  IF p_accept_quote THEN
    BEGIN
      v_quote_id := NULLIF(v_seed.linked_quote_document ->> 'id', '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('ok', false, 'code', 'quote_unavailable');
    END;
    IF v_quote_id IS NULL THEN RETURN jsonb_build_object('ok', false, 'code', 'quote_unavailable'); END IF;
    SELECT * INTO v_quote FROM public.quotes WHERE id = v_quote_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'quote_unavailable'); END IF;
  END IF;

  SELECT * INTO v_contract FROM public.contracts
  WHERE id = v_seed.id
  FOR UPDATE;
  IF NOT FOUND OR v_contract.signature_token::TEXT IS DISTINCT FROM p_token THEN
    RETURN jsonb_build_object('ok', false, 'code', 'not_found');
  END IF;
  IF v_contract.status = 'archived' OR v_contract.archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'archived');
  END IF;

  -- Check expiry after all relevant row locks, before either idempotence or write.
  v_now := clock_timestamp();
  IF v_contract.signature_token_expires_at IS NULL OR v_contract.signature_token_expires_at <= v_now THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  IF v_contract.client_signed_at IS NOT NULL OR v_contract.status = 'signed' THEN
    IF v_contract.client_signed_at IS NULL OR v_contract.pdf_snapshot IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'archive_unavailable');
    END IF;
    RETURN jsonb_build_object('ok', true, 'already_signed', true,
      'contract_id', v_contract.id, 'organization_id', v_contract.organization_id,
      'title', v_contract.title, 'signed_at', v_contract.client_signed_at,
      'quote_id', NULLIF(v_contract.linked_quote_document ->> 'id', '')::UUID,
      'quote_status', v_contract.linked_quote_document ->> 'status');
  END IF;

  IF v_contract.status <> 'sent' OR v_contract.signature_document_hash IS NULL
     OR v_contract.pdf_snapshot IS NULL OR v_contract.pdf_reference IS NULL
     OR v_contract.signature_document_hash IS DISTINCT FROM
        public.contract_document_hash(v_contract.pdf_snapshot, v_contract.linked_quote_document) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'publication_unavailable');
  END IF;
  IF v_contract.pdf_snapshot ->> 'organizationId' IS DISTINCT FROM v_contract.organization_id::TEXT
     OR v_contract.pdf_snapshot -> 'contract' ->> 'id' IS DISTINCT FROM v_contract.id::TEXT THEN
    RETURN jsonb_build_object('ok', false, 'code', 'publication_unavailable');
  END IF;
  v_signed_at := clock_timestamp();
  IF v_contract.signature_token_expires_at IS NULL OR v_contract.signature_token_expires_at <= v_signed_at THEN
    RETURN jsonb_build_object('ok', false, 'code', 'expired');
  END IF;

  IF p_accept_quote THEN
    IF v_contract.quote_id IS DISTINCT FROM v_quote_id
       OR v_quote.organization_id IS DISTINCT FROM v_contract.organization_id
       OR v_quote.client_id IS DISTINCT FROM v_contract.client_id
       OR COALESCE(v_quote.is_archived, false)
       OR v_quote.document_snapshot IS DISTINCT FROM v_contract.linked_quote_document -> 'document_snapshot' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'quote_changed');
    END IF;
    IF v_quote.status IN ('sent', 'viewed') THEN
      IF v_quote.valid_until IS NOT NULL AND v_quote.valid_until < CURRENT_DATE THEN
        RETURN jsonb_build_object('ok', false, 'code', 'quote_expired');
      END IF;
      IF v_quote.signed_at IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'code', 'quote_changed');
      END IF;
      -- The contract and optional quote writes share this signature time.
      UPDATE public.quotes SET
        status = 'accepted',
        accepted_at = v_signed_at,
        signed_at = v_signed_at,
        signed_ip = p_signed_ip,
        signed_user_agent = p_signed_user_agent,
        client_signatory_name = p_signatory_name,
        client_signatory_role = p_signatory_role,
        client_signature_image = p_signature_image
      WHERE id = v_quote.id AND organization_id = v_contract.organization_id
        AND document_snapshot = v_contract.linked_quote_document -> 'document_snapshot'
        AND status IN ('sent', 'viewed') AND signed_at IS NULL AND COALESCE(is_archived, false) = false
      RETURNING * INTO v_quote;
      IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'code', 'quote_changed'); END IF;
      v_quote_changed := true;
    ELSIF v_quote.status NOT IN ('accepted', 'converted', 'fully_invoiced') THEN
      RETURN jsonb_build_object('ok', false, 'code', 'quote_unavailable');
    END IF;
    v_linked_quote_document := jsonb_build_object(
      'id', v_quote.id,
      'status', v_quote.status,
      'signed_at', v_quote.signed_at,
      'client_signature_image', v_quote.client_signature_image,
      'client_signatory_name', v_quote.client_signatory_name,
      'client_signatory_role', v_quote.client_signatory_role,
      'document_snapshot', v_quote.document_snapshot
    );
  ELSE
    v_linked_quote_document := v_contract.linked_quote_document;
  END IF;

  UPDATE public.contracts SET
    status = 'signed',
    signed_at = v_signed_at,
    client_signed_at = v_signed_at,
    client_signatory_name = p_signatory_name,
    client_signatory_role = p_signatory_role,
    client_signature_image = p_signature_image,
    linked_quote_document = v_linked_quote_document
  WHERE id = v_contract.id AND signature_token::TEXT = p_token
    AND status = 'sent' AND client_signed_at IS NULL
    AND signature_token_expires_at > clock_timestamp()
    AND signature_document_hash = public.contract_document_hash(pdf_snapshot, linked_quote_document)
  RETURNING * INTO v_contract;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Contrat modifié pendant la signature' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object('ok', true, 'already_signed', false,
    'contract_id', v_contract.id, 'organization_id', v_contract.organization_id,
    'title', v_contract.title, 'signed_at', v_contract.client_signed_at,
    'quote_id', CASE WHEN p_accept_quote THEN v_quote.id ELSE NULL END,
    'quote_status', CASE WHEN p_accept_quote THEN v_quote.status ELSE NULL END,
    'quote_changed', v_quote_changed);
END;
$$;

REVOKE ALL ON FUNCTION public.contract_document_hash(JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_contract_document_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidate_contracts_for_quote_document_change() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.save_contract_draft_pdf_snapshot(UUID, UUID, TIMESTAMPTZ, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_contract_document(UUID, UUID, TIMESTAMPTZ, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sign_contract_with_quote(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_document_hash(JSONB, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_contract_draft_pdf_snapshot(UUID, UUID, TIMESTAMPTZ, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_contract_document(UUID, UUID, TIMESTAMPTZ, JSONB, BOOLEAN) TO service_role;
GRANT EXECUTE ON FUNCTION public.sign_contract_with_quote(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO service_role;

COMMIT;
