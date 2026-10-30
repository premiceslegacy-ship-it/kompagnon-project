-- 208 — Stage historical CSV documents and their children atomically before
-- applying their imported lifecycle status. These rows are explicitly
-- unverified historical data, never current issuance/publication authority.
CREATE OR REPLACE FUNCTION public.import_historical_document(
  p_kind TEXT,
  p_organization_id UUID,
  p_created_by UUID,
  p_document JSONB,
  p_items JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_document_id UUID;
  v_client_id UUID;
  v_status TEXT;
  v_number TEXT;
  v_title TEXT;
  v_issue_date DATE;
  v_due_date DATE;
  v_valid_until DATE;
  v_validity_days INTEGER;
  v_notes TEXT;
  v_currency TEXT;
  v_item JSONB;
  v_position INTEGER := 0;
  v_description TEXT;
  v_unit TEXT;
  v_quantity NUMERIC(10,3);
  v_unit_price NUMERIC(10,2);
  v_vat_rate NUMERIC(5,2);
  v_total_ht NUMERIC;
  v_total_tva NUMERIC;
  v_section_id UUID;
BEGIN
  IF COALESCE(auth.role() = 'service_role', false) IS NOT TRUE THEN
    RAISE EXCEPTION 'Historical document import requires the service role'
      USING ERRCODE = '42501';
  END IF;
  IF p_kind NOT IN ('invoice', 'quote') OR p_kind IS NULL THEN
    RAISE EXCEPTION 'Unsupported historical document kind' USING ERRCODE = '22023';
  END IF;
  IF p_organization_id IS NULL OR p_created_by IS NULL THEN
    RAISE EXCEPTION 'Historical document organization and actor are required' USING ERRCODE = '22023';
  END IF;
  IF p_document IS NULL OR pg_catalog.jsonb_typeof(p_document) <> 'object'
     OR p_items IS NULL OR pg_catalog.jsonb_typeof(p_items) <> 'array'
     OR pg_catalog.jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Historical document header and at least one line are required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize with organization erasure and require a live tenant.
  PERFORM 1
  FROM public.organizations AS o
  WHERE o.id = p_organization_id AND o.anonymized_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Historical document organization is unavailable'
      USING ERRCODE = '42501';
  END IF;

  -- The actor must still be an active member of this same organization.
  PERFORM 1
  FROM public.memberships AS m
  WHERE m.organization_id = p_organization_id
    AND m.user_id = p_created_by
    AND m.is_active IS TRUE
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Historical document actor is not an active organization member'
      USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.jsonb_object_keys(p_document) AS fields(field_key)
    WHERE field_key NOT IN (
      'client_id', 'number', 'title', 'status', 'issue_date', 'due_date',
      'valid_until', 'validity_days', 'notes_client', 'currency'
    )
  ) THEN
    RAISE EXCEPTION 'Historical document contains unsupported header fields'
      USING ERRCODE = '22023';
  END IF;
  IF NOT (p_document ?& ARRAY['client_id', 'number', 'title', 'status', 'issue_date']) THEN
    RAISE EXCEPTION 'Historical document is missing a required header field'
      USING ERRCODE = '22023';
  END IF;

  v_client_id := NULLIF(p_document->>'client_id', '')::UUID;
  v_number := NULLIF(pg_catalog.btrim(p_document->>'number'), '');
  v_title := NULLIF(pg_catalog.btrim(p_document->>'title'), '');
  v_status := p_document->>'status';
  v_issue_date := (p_document->>'issue_date')::DATE;
  v_notes := p_document->>'notes_client';
  v_currency := COALESCE(NULLIF(p_document->>'currency', ''), 'EUR');
  IF v_client_id IS NULL OR v_number IS NULL OR v_title IS NULL THEN
    RAISE EXCEPTION 'Historical document client, number, and title are required'
      USING ERRCODE = '22023';
  END IF;

  -- Lock and scope the referenced party before any document row is written.
  PERFORM 1
  FROM public.clients AS c
  WHERE c.id = v_client_id AND c.organization_id = p_organization_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Historical document client is outside the organization'
      USING ERRCODE = '42501';
  END IF;

  IF p_kind = 'invoice' THEN
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_object_keys(p_document) AS fields(field_key)
      WHERE field_key NOT IN (
        'client_id', 'number', 'title', 'status', 'issue_date', 'due_date',
        'notes_client', 'currency'
      )
    ) THEN
      RAISE EXCEPTION 'Historical invoice contains unsupported header fields'
        USING ERRCODE = '22023';
    END IF;
    IF v_status IS NULL OR v_status NOT IN ('draft', 'sent', 'paid') THEN
      RAISE EXCEPTION 'Unsupported historical invoice status' USING ERRCODE = '22023';
    END IF;
    v_due_date := NULLIF(p_document->>'due_date', '')::DATE;

    INSERT INTO public.invoices (
      organization_id, client_id, created_by, number, title, status,
      issue_date, due_date, notes_client, currency, historical_import
    ) VALUES (
      p_organization_id, v_client_id, p_created_by, v_number, v_title, 'draft',
      v_issue_date, v_due_date, v_notes, v_currency, '{"source":"csv"}'::JSONB
    ) RETURNING id INTO v_document_id;

    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) AS lines(value)
    LOOP
      v_position := v_position + 1;
      IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Historical invoice line % has an invalid shape', v_position
          USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(v_item) AS fields(field_key)
        WHERE field_key NOT IN ('description', 'quantity', 'unit', 'unit_price', 'vat_rate')
      ) OR NOT (v_item ?& ARRAY['description', 'quantity', 'unit', 'unit_price', 'vat_rate']) THEN
        RAISE EXCEPTION 'Historical invoice line % has an invalid shape', v_position
          USING ERRCODE = '22023';
      END IF;
      v_description := NULLIF(pg_catalog.btrim(v_item->>'description'), '');
      v_unit := NULLIF(pg_catalog.btrim(v_item->>'unit'), '');
      IF v_description IS NULL OR v_unit IS NULL
         OR v_item->>'quantity' IS NULL OR v_item->>'unit_price' IS NULL OR v_item->>'vat_rate' IS NULL THEN
        RAISE EXCEPTION 'Historical invoice line % is missing a required value', v_position
          USING ERRCODE = '22023';
      END IF;
      v_quantity := (v_item->>'quantity')::NUMERIC(10,3);
      v_unit_price := (v_item->>'unit_price')::NUMERIC(10,2);
      v_vat_rate := (v_item->>'vat_rate')::NUMERIC(5,2);
      IF v_quantity = 'NaN'::NUMERIC OR v_unit_price = 'NaN'::NUMERIC OR v_vat_rate = 'NaN'::NUMERIC THEN
        RAISE EXCEPTION 'Historical invoice line % has a non-finite numeric value', v_position
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.invoice_items (
        invoice_id, description, quantity, unit, unit_price, vat_rate, total_ht, position
      ) VALUES (
        v_document_id, v_description, v_quantity, v_unit, v_unit_price, v_vat_rate,
        pg_catalog.round(v_quantity * v_unit_price, 2), v_position
      );
    END LOOP;

    SELECT COALESCE(pg_catalog.sum(i.total_ht), 0), COALESCE(pg_catalog.sum(i.vat_amount), 0)
    INTO v_total_ht, v_total_tva
    FROM public.invoice_items AS i
    WHERE i.invoice_id = v_document_id;

    UPDATE public.invoices
    SET total_ht = v_total_ht, total_tva = v_total_tva, total_ttc = v_total_ht + v_total_tva
    WHERE id = v_document_id;

    -- The authority trigger recognizes only this exact staging -> finalized
    -- marker transition and leaves issuance_snapshot NULL.
    UPDATE public.invoices
    SET status = v_status,
        historical_import = historical_import || pg_catalog.jsonb_build_object('state', 'finalized')
    WHERE id = v_document_id;
  ELSE
    IF EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_object_keys(p_document) AS fields(field_key)
      WHERE field_key NOT IN (
        'client_id', 'number', 'title', 'status', 'issue_date', 'valid_until',
        'validity_days', 'notes_client', 'currency'
      )
    ) THEN
      RAISE EXCEPTION 'Historical quote contains unsupported header fields'
        USING ERRCODE = '22023';
    END IF;
    IF v_status IS NULL OR v_status NOT IN ('draft', 'sent', 'accepted', 'refused') THEN
      RAISE EXCEPTION 'Unsupported historical quote status' USING ERRCODE = '22023';
    END IF;
    v_valid_until := NULLIF(p_document->>'valid_until', '')::DATE;
    v_validity_days := COALESCE(NULLIF(p_document->>'validity_days', '')::INTEGER, 30);

    INSERT INTO public.quotes (
      organization_id, client_id, created_by, number, title, status,
      created_at, valid_until, validity_days, notes_client, currency, historical_import
    ) VALUES (
      p_organization_id, v_client_id, p_created_by, v_number, v_title, 'draft',
      (v_issue_date::TIMESTAMP WITHOUT TIME ZONE) AT TIME ZONE 'UTC',
      v_valid_until, v_validity_days, v_notes, v_currency, '{"source":"csv"}'::JSONB
    ) RETURNING id INTO v_document_id;

    INSERT INTO public.quote_sections (quote_id, title, position)
    VALUES (v_document_id, v_title, 1)
    RETURNING id INTO v_section_id;

    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(p_items) AS lines(value)
    LOOP
      v_position := v_position + 1;
      IF pg_catalog.jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'Historical quote line % has an invalid shape', v_position
          USING ERRCODE = '22023';
      END IF;
      IF EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_object_keys(v_item) AS fields(field_key)
        WHERE field_key NOT IN ('description', 'quantity', 'unit', 'unit_price', 'vat_rate')
      ) OR NOT (v_item ?& ARRAY['description', 'quantity', 'unit', 'unit_price', 'vat_rate']) THEN
        RAISE EXCEPTION 'Historical quote line % has an invalid shape', v_position
          USING ERRCODE = '22023';
      END IF;
      v_description := NULLIF(pg_catalog.btrim(v_item->>'description'), '');
      v_unit := NULLIF(pg_catalog.btrim(v_item->>'unit'), '');
      IF v_description IS NULL OR v_unit IS NULL
         OR v_item->>'quantity' IS NULL OR v_item->>'unit_price' IS NULL OR v_item->>'vat_rate' IS NULL THEN
        RAISE EXCEPTION 'Historical quote line % is missing a required value', v_position
          USING ERRCODE = '22023';
      END IF;
      v_quantity := (v_item->>'quantity')::NUMERIC(10,3);
      v_unit_price := (v_item->>'unit_price')::NUMERIC(10,2);
      v_vat_rate := (v_item->>'vat_rate')::NUMERIC(5,2);
      IF v_quantity = 'NaN'::NUMERIC OR v_unit_price = 'NaN'::NUMERIC OR v_vat_rate = 'NaN'::NUMERIC THEN
        RAISE EXCEPTION 'Historical quote line % has a non-finite numeric value', v_position
          USING ERRCODE = '22023';
      END IF;

      INSERT INTO public.quote_items (
        quote_id, section_id, type, description, quantity, unit, unit_price, vat_rate, total_ht, position
      ) VALUES (
        v_document_id, v_section_id, 'custom', v_description, v_quantity, v_unit,
        v_unit_price, v_vat_rate, pg_catalog.round(v_quantity * v_unit_price, 2), v_position
      );
    END LOOP;

    SELECT COALESCE(pg_catalog.sum(i.total_ht), 0),
           COALESCE(pg_catalog.sum(pg_catalog.round(i.quantity * i.unit_price * i.vat_rate / 100, 2)), 0)
    INTO v_total_ht, v_total_tva
    FROM public.quote_items AS i
    WHERE i.quote_id = v_document_id;

    UPDATE public.quotes
    SET total_ht = v_total_ht, total_tva = v_total_tva, total_ttc = v_total_ht + v_total_tva
    WHERE id = v_document_id;

    -- Do not supply finalized_at; the quote authority guard adds it on the
    -- single permitted staging -> finalized marker transition.
    UPDATE public.quotes
    SET status = v_status,
        historical_import = historical_import || pg_catalog.jsonb_build_object('state', 'finalized')
    WHERE id = v_document_id;
  END IF;

  RETURN v_document_id;
END;
$$;

REVOKE ALL ON FUNCTION public.import_historical_document(TEXT, UUID, UUID, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.import_historical_document(TEXT, UUID, UUID, JSONB, JSONB)
  TO service_role;

COMMENT ON FUNCTION public.import_historical_document(TEXT, UUID, UUID, JSONB, JSONB) IS
  'Atomically imports one CSV historical invoice or quote with unverified provenance. It stages a draft, inserts all lines, calculates line totals, and performs one marker finalization to the imported status; it never creates issuance/publication snapshots, sent/accepted timestamps, or payment records.';

NOTIFY pgrst, 'reload schema';
