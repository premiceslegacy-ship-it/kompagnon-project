-- Run only against a disposable LOCAL Supabase database migrated through 212:
-- Requires LOCAL_DATABASE_URL for the disposable local supabase_admin role, only
-- to restore pre-cutover Storage metadata under temporarily disabled guards.
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/quote-attachment-identity.sql
-- Exercises UUID ownership, reviewed migration, legacy-reference normalization,
-- slug reuse, late-write denial, and erasure reference cleanup. Rolls back all rows.
BEGIN;
-- Metadata-only rows have no blobs: allow their rolled-back fixture deletion.
-- Physical move/delete behavior must also be exercised through the Storage API.
SET LOCAL storage.allow_delete_query = 'true';

DO $test$
DECLARE
  v_org_a UUID := gen_random_uuid();
  v_org_b UUID := gen_random_uuid();
  v_org_erased UUID := gen_random_uuid();
  v_org_multi UUID := gen_random_uuid();
  v_org_missing UUID := gen_random_uuid();
  v_request_a UUID := gen_random_uuid();
  v_request_b UUID := gen_random_uuid();
  v_request_erased UUID := gen_random_uuid();
  v_request_multi UUID := gen_random_uuid();
  v_request_conflict UUID := gen_random_uuid();
  v_request_missing UUID := gen_random_uuid();
  v_former_slug TEXT;
  v_source_path TEXT;
  v_uuid_looking_path TEXT;
  v_erased_source_path TEXT;
  v_multi_source_a TEXT;
  v_multi_source_b TEXT;
  v_multi_source_c TEXT;
  v_conflict_source TEXT;
  v_fresh_path TEXT;
  v_missing_source TEXT;
  v_destination_path TEXT;
  v_uuid_destination_path TEXT;
  v_job_id UUID;
  v_multi_destination_a TEXT;
  v_multi_destination_b TEXT;
  v_multi_destination_c TEXT;
  v_conflict_destination TEXT;
  v_uuid_job_id UUID;
  v_erased_job_id UUID;
  v_multi_job_id UUID;
  v_conflict_job_id UUID;
  v_source_sha TEXT := repeat('a', 64);
  v_uuid_sha TEXT := repeat('b', 64);
  v_erased_sha TEXT := repeat('c', 64);
  v_multi_sha_a TEXT := repeat('d', 64);
  v_multi_sha_b TEXT := repeat('e', 64);
  v_multi_sha_c TEXT := repeat('f', 64);
  v_conflict_sha TEXT := repeat('9', 64);
  v_url TEXT;
  v_multi_url_c TEXT;
  v_conflict_url TEXT;
  v_result JSONB;
  v_request_row RECORD;
  v_rows BIGINT;
  v_rejected BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  v_former_slug := 'attachment-reuse-' || v_org_a::TEXT;
  v_source_path := 'quote-requests/' || v_former_slug || '/lead-plan.pdf';
  v_uuid_looking_path := 'quote-requests/' || v_org_a::TEXT || '/historical-plan.pdf';
  v_erased_source_path := 'quote-requests/old-erased-slug-' || v_org_erased::TEXT || '/private-lead.pdf';
  v_fresh_path := 'quote-requests/' || v_org_b::TEXT || '/fresh-plan.pdf';
  v_url := 'https://attachment-test.supabase.co/storage/v1/object/public/quote-attachments/' || v_source_path;
  v_multi_source_a := 'quote-requests/multi-' || v_org_multi::TEXT || '/attachment-a.pdf';
  v_multi_source_b := 'quote-requests/multi-' || v_org_multi::TEXT || '/attachment-b.pdf';
  v_multi_source_c := 'quote-requests/multi-' || v_org_multi::TEXT || '/attachment-c.pdf';
  v_conflict_source := 'quote-requests/multi-' || v_org_multi::TEXT || '/legacy-without-extension';
  v_multi_url_c := 'https://attachment-test.supabase.co/storage/v1/object/public/quote-attachments/' || v_multi_source_c;
  v_conflict_url := 'https://attachment-test.supabase.co/storage/v1/object/public/quote-attachments/' || v_multi_source_b;

  INSERT INTO public.organizations (id, name, slug, email, sector)
  VALUES
    (v_org_a, 'Attachment owner A', v_former_slug, 'attachment-a-' || v_org_a::TEXT || '@example.invalid', 'construction'),
    (v_org_b, 'Attachment owner B', 'attachment-b-' || v_org_b::TEXT, 'attachment-b-' || v_org_b::TEXT || '@example.invalid', 'construction'),
    (v_org_erased, 'Erased attachment owner', 'attachment-erased-' || v_org_erased::TEXT,
     'attachment-erased-' || v_org_erased::TEXT || '@example.invalid', 'construction'),
    (v_org_multi, 'Multi attachment owner', 'attachment-multi-' || v_org_multi::TEXT,
     'attachment-multi-' || v_org_multi::TEXT || '@example.invalid', 'construction');
  UPDATE public.organizations
  SET deletion_scheduled_at = now() - INTERVAL '1 day', anonymized_at = now()
  WHERE id = v_org_erased;

  -- These Storage rows and request references represent pre-212 state. They are
  -- deliberately inserted without ownership; UUID-looking paths are no more
  -- trusted than slug paths until the reviewed RPC assigns an owner.
  ALTER TABLE storage.objects DISABLE TRIGGER trg_guard_quote_attachment_storage_object;
  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES
    ('quote-attachments', v_source_path, '{"mimetype":"application/pdf","size":12}'::JSONB),
    ('quote-attachments', v_uuid_looking_path, '{"mimetype":"application/pdf","size":13}'::JSONB),
    ('quote-attachments', v_erased_source_path, '{"mimetype":"application/pdf","size":14}'::JSONB),
    ('quote-attachments', v_multi_source_a, '{"mimetype":"application/pdf","size":21}'::JSONB),
    ('quote-attachments', v_multi_source_b, '{"mimetype":"application/pdf","size":22}'::JSONB),
    ('quote-attachments', v_multi_source_c, '{"mimetype":"application/pdf","size":23}'::JSONB),
    ('quote-attachments', v_conflict_source, '{"mimetype":"application/pdf","size":24}'::JSONB);
  ALTER TABLE storage.objects ENABLE TRIGGER trg_guard_quote_attachment_storage_object;

  ALTER TABLE public.quote_requests DISABLE TRIGGER trg_guard_quote_request_attachment_ownership;
  ALTER TABLE public.quote_requests DISABLE TRIGGER trg_block_quote_request_for_anonymized_organization;
  INSERT INTO public.quote_requests (
    id, organization_id, name, email, description, attachments, attachment_url
  ) VALUES
    (v_request_a, v_org_a, 'Lead A', 'lead-a@example.invalid', 'A reviewed historical request',
     jsonb_build_array(jsonb_build_object(
       'storage_path', v_source_path,
       'public_url', v_url,
       'filename', 'lead-plan.pdf',
       'size', 12,
       'content_type', 'application/pdf'
     )), v_url),
    (v_request_b, v_org_b, 'Lead B', 'lead-b@example.invalid', 'Contradictory foreign request',
     jsonb_build_array(jsonb_build_object('storage_path', v_source_path, 'filename', 'foreign.pdf')), NULL),
    (v_request_erased, v_org_erased, 'Erased lead', 'erased-lead@example.invalid', 'Erased legacy request',
     jsonb_build_array(jsonb_build_object('public_url', 'https://attachment-test.supabase.co/storage/v1/object/public/quote-attachments/' || v_erased_source_path,
       'filename', 'private-lead.pdf')), 'https://attachment-test.supabase.co/storage/v1/object/public/quote-attachments/' || v_erased_source_path),
    (v_request_multi, v_org_multi, 'Multi lead', 'multi-lead@example.invalid', 'Several reviewed legacy references',
     jsonb_build_array(
       jsonb_build_object('storage_path', v_multi_source_a, 'filename', 'attachment-a.pdf'),
       jsonb_build_object('storage_path', v_multi_source_b, 'filename', 'attachment-b.pdf')
     ), v_multi_url_c),
    (v_request_conflict, v_org_multi, 'Alias conflict', 'alias@example.invalid', 'Contradictory aliases in one item',
     jsonb_build_array(jsonb_build_object('storage_path', v_conflict_source, 'public_url', v_conflict_url)), NULL);
  ALTER TABLE public.quote_requests ENABLE TRIGGER trg_guard_quote_request_attachment_ownership;
  ALTER TABLE public.quote_requests ENABLE TRIGGER trg_block_quote_request_for_anonymized_organization;

  v_rejected := false;
  BEGIN
    PERFORM public.assert_quote_attachment_cutover_complete();
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Cutover accepted unregistered slug and UUID-looking Storage objects';
  END IF;

  -- The database enforces the same cutover before any caller can anonymize and
  -- erase the legacy evidence, not only through the cron route.
  v_rejected := false;
  BEGIN
    UPDATE public.organizations SET anonymized_at = now() WHERE id = v_org_a;
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected OR (SELECT anonymized_at FROM public.organizations WHERE id = v_org_a) IS NOT NULL THEN
    RAISE EXCEPTION 'Anonymization did not fail closed while attachment evidence was unresolved';
  END IF;

  -- Lookup-first is read-only when no durable job exists; it must not invent a
  -- source or claim an owner before the CLI has observed and hashed the object.
  v_result := public.prepare_quote_attachment_migration(
    'quote-requests/not-present/missing.pdf', v_org_a, NULL, 'move'
  );
  IF v_result ->> 'state' <> 'unprepared' OR v_result ->> 'job_id' IS NOT NULL THEN
    RAISE EXCEPTION 'An absent source unexpectedly created a migration job';
  END IF;

  -- A foreign request reference blocks the reviewed source map even though the
  -- operator named organization A explicitly.
  v_rejected := false;
  BEGIN
    PERFORM public.prepare_quote_attachment_migration(v_source_path, v_org_a, v_source_sha, 'move');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Migration accepted a source referenced by another tenant';
  END IF;
  DELETE FROM public.quote_requests WHERE id = v_request_b;
  -- A contradictory alias in the same attachment item remains blocked, while
  -- aliases belonging to other attachment items are handled independently.
  v_rejected := false;
  BEGIN
    PERFORM public.prepare_quote_attachment_migration(v_conflict_source, v_org_multi, v_conflict_sha, 'move');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Migration accepted contradictory aliases within one attachment item';
  END IF;
  ALTER TABLE public.quote_requests DISABLE TRIGGER trg_guard_quote_request_attachment_ownership;
  UPDATE public.quote_requests
  SET attachments = jsonb_build_array(jsonb_build_object(
    'storage_path', v_conflict_source,
    'filename', 'legacy-source-without-extension'
  ))
  WHERE id = v_request_conflict;
  ALTER TABLE public.quote_requests ENABLE TRIGGER trg_guard_quote_request_attachment_ownership;

  v_result := public.prepare_quote_attachment_migration(v_conflict_source, v_org_multi, v_conflict_sha, 'move');
  v_conflict_job_id := (v_result ->> 'job_id')::UUID;
  v_conflict_destination := v_result ->> 'destination_path';
  IF v_result ->> 'state' <> 'prepared'
     OR v_conflict_destination !~ ('^quote-requests/' || v_org_multi::TEXT || '/migrated-[0-9a-f]{64}\.bin$') THEN
    RAISE EXCEPTION 'Extensionless historical object did not receive its opaque canonical destination: %', v_result;
  END IF;
  UPDATE storage.objects
  SET name = v_conflict_destination
  WHERE bucket_id = 'quote-attachments' AND name = v_conflict_source;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Opaque historical object move did not update exactly one source';
  END IF;
  v_result := public.finalize_quote_attachment_migration(v_conflict_job_id, v_conflict_sha);
  SELECT request.attachments, request.attachment_url
  INTO v_request_row
  FROM public.quote_requests AS request WHERE request.id = v_request_conflict;
  IF v_result ->> 'state' <> 'completed'
     OR v_request_row.attachment_url IS NOT NULL
     OR v_request_row.attachments -> 0 ->> 'storage_path' IS DISTINCT FROM v_conflict_destination
     OR v_request_row.attachments -> 0 ->> 'filename' IS DISTINCT FROM 'legacy-source-without-extension' THEN
    RAISE EXCEPTION 'Opaque migration did not canonicalize storage while preserving the original display name';
  END IF;

  v_result := public.prepare_quote_attachment_migration(v_source_path, v_org_a, v_source_sha, 'move');
  v_job_id := (v_result ->> 'job_id')::UUID;
  v_destination_path := v_result ->> 'destination_path';
  IF v_result ->> 'state' <> 'prepared'
     OR v_destination_path !~ ('^quote-requests/' || v_org_a::TEXT || '/migrated-[0-9a-f]{64}\.pdf$') THEN
    RAISE EXCEPTION 'Reviewed move did not return the canonical DB-generated destination: %', v_result;
  END IF;

  -- This update is the Storage metadata effect used by the native move API.
  UPDATE storage.objects
  SET name = v_destination_path
  WHERE bucket_id = 'quote-attachments' AND name = v_source_path;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Prepared Storage move did not update exactly one source object';
  END IF;
  v_result := public.finalize_quote_attachment_migration(v_job_id, v_source_sha);
  IF v_result ->> 'state' <> 'completed' OR (v_result ->> 'updated_references')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'Move did not finalize both observed legacy references: %', v_result;
  END IF;

  SELECT request.attachments, request.attachment_url
  INTO v_request_row
  FROM public.quote_requests AS request WHERE request.id = v_request_a;
  IF v_request_row.attachment_url IS NOT NULL
     OR v_request_row.attachments -> 0 ->> 'storage_path' IS DISTINCT FROM v_destination_path
     OR v_request_row.attachments -> 0 ? 'public_url'
     OR v_request_row.attachments -> 0 ->> 'filename' IS DISTINCT FROM 'lead-plan.pdf'
     OR (v_request_row.attachments -> 0 ->> 'size')::INTEGER <> 12
     OR v_request_row.attachments -> 0 ->> 'content_type' IS DISTINCT FROM 'application/pdf' THEN
    RAISE EXCEPTION 'Finalization failed to canonicalize references or preserve display metadata';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
    WHERE ownership.object_path = v_source_path
  ) OR NOT EXISTS (
    SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
    WHERE ownership.object_path = v_destination_path AND ownership.organization_id = v_org_a
  ) THEN
    RAISE EXCEPTION 'Move did not replace source ownership with exact destination ownership';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.quote_attachment_migration_jobs AS job
    WHERE job.id = v_job_id AND (job.source_path IS NOT NULL OR job.source_sha256 IS NOT NULL OR job.state <> 'completed')
  ) THEN
    RAISE EXCEPTION 'Completed migration retained legacy filename or content hash';
  END IF;

  -- Completed lookup uses only the non-content path-hash tombstone and supplies
  -- the path ephemerally in RPC output; it does not retain the legacy filename.
  v_result := public.prepare_quote_attachment_migration(v_source_path, v_org_a, NULL, 'move');
  IF v_result ->> 'state' <> 'completed'
     OR v_result ->> 'source_path' IS DISTINCT FROM v_source_path
     OR v_result ->> 'source_sha256' IS NOT NULL
     OR v_result ->> 'destination_path' IS DISTINCT FROM v_destination_path THEN
    RAISE EXCEPTION 'Completed migration lookup did not resolve from its privacy-preserving tombstone';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.prepare_quote_attachment_migration(v_source_path, v_org_b, NULL, 'move');
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Completed source tombstone could be reassigned to another organization';
  END IF;

  -- A UUID-looking legacy path is still unregistered. Its explicit review is
  -- required, then the same trusted Storage move/finalize path applies.
  v_result := public.prepare_quote_attachment_migration(v_uuid_looking_path, v_org_a, v_uuid_sha, 'move');
  v_uuid_job_id := (v_result ->> 'job_id')::UUID;
  v_uuid_destination_path := v_result ->> 'destination_path';
  UPDATE storage.objects
  SET name = v_uuid_destination_path
  WHERE bucket_id = 'quote-attachments' AND name = v_uuid_looking_path;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Explicit mapping did not move the UUID-looking legacy source';
  END IF;
  PERFORM public.finalize_quote_attachment_migration(v_uuid_job_id, v_uuid_sha);

  -- An erased organization may explicitly delete a mapped legacy object. The
  -- Storage delete leaves the prepared registry claim for finalize to reconcile.
  v_result := public.prepare_quote_attachment_migration(v_erased_source_path, v_org_erased, v_erased_sha, 'delete');
  v_erased_job_id := (v_result ->> 'job_id')::UUID;
  DELETE FROM storage.objects
  WHERE bucket_id = 'quote-attachments' AND name = v_erased_source_path;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Prepared erasure delete did not remove exactly one source object';
  END IF;
  v_result := public.finalize_quote_attachment_migration(v_erased_job_id, v_erased_sha);
  IF v_result ->> 'state' <> 'completed' THEN
    RAISE EXCEPTION 'Erased-organization delete did not finalize';
  END IF;
  SELECT request.attachments, request.attachment_url
  INTO v_request_row
  FROM public.quote_requests AS request WHERE request.id = v_request_erased;
  IF v_request_row.attachment_url IS NOT NULL OR jsonb_array_length(v_request_row.attachments) <> 0 THEN
    RAISE EXCEPTION 'Delete finalization retained legacy request URL or attachment metadata';
  END IF;

  -- A durable job rewrites only its own entry. Other legacy array entries and
  -- an independent direct attachment_url survive until their own jobs finish.
  v_result := public.prepare_quote_attachment_migration(v_multi_source_a, v_org_multi, v_multi_sha_a, 'move');
  v_multi_job_id := (v_result ->> 'job_id')::UUID;
  v_multi_destination_a := v_result ->> 'destination_path';
  UPDATE storage.objects
  SET name = v_multi_destination_a
  WHERE bucket_id = 'quote-attachments' AND name = v_multi_source_a;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'First multi-item move did not update exactly one Storage source';
  END IF;
  v_result := public.finalize_quote_attachment_migration(v_multi_job_id, v_multi_sha_a);
  SELECT request.attachments, request.attachment_url
  INTO v_request_row
  FROM public.quote_requests AS request WHERE request.id = v_request_multi;
  IF v_result ->> 'state' <> 'completed'
     OR (v_result ->> 'updated_references')::INTEGER <> 1
     OR v_request_row.attachments -> 0 ->> 'storage_path' IS DISTINCT FROM v_multi_destination_a
     OR v_request_row.attachments -> 1 ->> 'storage_path' IS DISTINCT FROM v_multi_source_b
     OR v_request_row.attachment_url IS DISTINCT FROM v_multi_url_c THEN
    RAISE EXCEPTION 'First finalization did not preserve the exact legacy remainder';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.assert_quote_attachment_cutover_complete();
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Global cutover gate passed with remaining multi-item legacy references';
  END IF;

  v_result := public.prepare_quote_attachment_migration(v_multi_source_b, v_org_multi, v_multi_sha_b, 'move');
  v_multi_job_id := (v_result ->> 'job_id')::UUID;
  v_multi_destination_b := v_result ->> 'destination_path';
  UPDATE storage.objects
  SET name = v_multi_destination_b
  WHERE bucket_id = 'quote-attachments' AND name = v_multi_source_b;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Second multi-item move did not update exactly one Storage source';
  END IF;
  v_result := public.finalize_quote_attachment_migration(v_multi_job_id, v_multi_sha_b);
  SELECT request.attachments, request.attachment_url
  INTO v_request_row
  FROM public.quote_requests AS request WHERE request.id = v_request_multi;
  IF v_result ->> 'state' <> 'completed'
     OR (v_result ->> 'updated_references')::INTEGER <> 1
     OR v_request_row.attachments -> 0 ->> 'storage_path' IS DISTINCT FROM v_multi_destination_a
     OR v_request_row.attachments -> 1 ->> 'storage_path' IS DISTINCT FROM v_multi_destination_b
     OR v_request_row.attachment_url IS DISTINCT FROM v_multi_url_c THEN
    RAISE EXCEPTION 'Second finalization did not preserve the direct legacy URL remainder';
  END IF;
  v_rejected := false;
  BEGIN
    PERFORM public.assert_quote_attachment_cutover_complete();
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Global cutover gate passed while the direct legacy URL remained';
  END IF;

  v_result := public.prepare_quote_attachment_migration(v_multi_source_c, v_org_multi, v_multi_sha_c, 'move');
  v_multi_job_id := (v_result ->> 'job_id')::UUID;
  v_multi_destination_c := v_result ->> 'destination_path';
  UPDATE storage.objects
  SET name = v_multi_destination_c
  WHERE bucket_id = 'quote-attachments' AND name = v_multi_source_c;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Direct URL move did not update exactly one Storage source';
  END IF;
  v_result := public.finalize_quote_attachment_migration(v_multi_job_id, v_multi_sha_c);
  SELECT request.attachments, request.attachment_url
  INTO v_request_row
  FROM public.quote_requests AS request WHERE request.id = v_request_multi;
  IF v_result ->> 'state' <> 'completed'
     OR (v_result ->> 'updated_references')::INTEGER <> 1
     OR v_request_row.attachment_url IS NOT NULL
     OR jsonb_array_length(v_request_row.attachments) <> 3
     OR v_request_row.attachments -> 0 ->> 'storage_path' IS DISTINCT FROM v_multi_destination_a
     OR v_request_row.attachments -> 1 ->> 'storage_path' IS DISTINCT FROM v_multi_destination_b
     OR v_request_row.attachments -> 2 ->> 'storage_path' IS DISTINCT FROM v_multi_destination_c THEN
    RAISE EXCEPTION 'Final direct URL migration did not leave every reference canonical';
  END IF;
  PERFORM public.assert_quote_attachment_cutover_complete();

  -- A missing legacy object must block the direct erasure RPC before it clears
  -- the request that retains both private metadata and requester identity.
  v_missing_source := 'quote-requests/missing-legacy-' || v_org_missing::TEXT || '/private-request.pdf';
  INSERT INTO public.organizations (id, name, slug, email, sector, deletion_scheduled_at)
  VALUES (
    v_org_missing, 'Missing attachment owner', 'missing-attachment-owner-' || v_org_missing::TEXT,
    'missing-attachment-' || v_org_missing::TEXT || '@example.invalid',
    'construction', now() - INTERVAL '1 minute'
  );
  ALTER TABLE public.quote_requests DISABLE TRIGGER trg_guard_quote_request_attachment_ownership;
  INSERT INTO public.quote_requests (
    id, organization_id, name, email, description, attachments, attachment_url
  ) VALUES (
    v_request_missing, v_org_missing, 'Private requester', 'private-requester@example.invalid',
    'Do not erase before attachment evidence is resolved',
    jsonb_build_array(jsonb_build_object('storage_path', v_missing_source, 'filename', 'private-request.pdf')),
    NULL
  );
  ALTER TABLE public.quote_requests ENABLE TRIGGER trg_guard_quote_request_attachment_ownership;

  v_rejected := false;
  BEGIN
    PERFORM * FROM public.anonymize_organization_for_deletion(v_org_missing);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected
     OR NOT EXISTS (
       SELECT 1 FROM public.quote_requests AS request
       WHERE request.id = v_request_missing
         AND request.name = 'Private requester'
         AND request.email = 'private-requester@example.invalid'
         AND request.description = 'Do not erase before attachment evidence is resolved'
         AND request.attachments = jsonb_build_array(jsonb_build_object(
           'storage_path', v_missing_source, 'filename', 'private-request.pdf'
         ))
         AND request.attachment_url IS NULL
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.organizations AS organization
       WHERE organization.id = v_org_missing
         AND organization.email = 'missing-attachment-' || v_org_missing::TEXT || '@example.invalid'
         AND organization.anonymized_at IS NULL
     ) THEN
    RAISE EXCEPTION 'Direct erasure did not reject a missing attachment before clearing private metadata';
  END IF;
  DELETE FROM public.quote_requests WHERE id = v_request_missing;
  PERFORM public.assert_quote_attachment_cutover_complete();
  -- A new canonical upload is registered from its UUID namespace; request
  -- metadata accepts that exact owner and rejects a foreign tenant's path.
  INSERT INTO storage.objects (bucket_id, name, metadata)
  VALUES ('quote-attachments', v_fresh_path, '{"mimetype":"application/pdf","size":15}'::JSONB);
  INSERT INTO public.quote_requests (organization_id, name, email, description, attachments)
  VALUES (v_org_b, 'Fresh lead', 'fresh@example.invalid', 'Legitimate registered attachment',
    jsonb_build_array(jsonb_build_object('storage_path', v_fresh_path, 'filename', 'fresh-plan.pdf', 'size', 15, 'content_type', 'application/pdf')));

  v_rejected := false;
  BEGIN
    INSERT INTO public.quote_requests (organization_id, name, email, description, attachments)
    VALUES (v_org_b, 'Foreign path', 'foreign@example.invalid', 'Misowned attachment',
      jsonb_build_array(jsonb_build_object('storage_path', v_destination_path, 'filename', 'lead-plan.pdf')));
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Quote request accepted another tenant''s registered object path';
  END IF;

  -- Slug reuse cannot transfer authoritative identity. Storage names and owner
  -- rows remain bound to A's UUID after B takes A's former public slug.
  UPDATE public.organizations SET slug = 'attachment-renamed-' || v_org_a::TEXT WHERE id = v_org_a;
  UPDATE public.organizations SET slug = v_former_slug WHERE id = v_org_b;
  IF NOT EXISTS (
    SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
    WHERE ownership.object_path = v_destination_path AND ownership.organization_id = v_org_a
  ) OR EXISTS (
    SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
    WHERE ownership.object_path = v_destination_path AND ownership.organization_id = v_org_b
  ) THEN
    RAISE EXCEPTION 'Changing or reusing a public slug changed immutable object ownership';
  END IF;
  PERFORM public.assert_quote_attachment_cutover_complete();

  -- Once anonymization wins the shared organization row lock, no late Storage
  -- write can recreate the namespace. Erasure removes references and registry
  -- rows atomically with each physical Storage object deletion.
  UPDATE public.organizations
  SET deletion_scheduled_at = now() - INTERVAL '1 day', anonymized_at = now()
  WHERE id = v_org_a;
  v_rejected := false;
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, metadata)
    VALUES ('quote-attachments', 'quote-requests/' || v_org_a::TEXT || '/too-late.pdf', '{"mimetype":"application/pdf","size":1}'::JSONB);
  EXCEPTION WHEN OTHERS THEN
    v_rejected := true;
  END;
  IF NOT v_rejected THEN
    RAISE EXCEPTION 'Erased organization accepted a late canonical Storage upload';
  END IF;

  DELETE FROM storage.objects
  WHERE bucket_id = 'quote-attachments' AND name = v_destination_path;
  IF EXISTS (
    SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
    WHERE ownership.object_path = v_destination_path
  ) THEN
    RAISE EXCEPTION 'Erasure left a stale ownership registry row';
  END IF;
  SELECT request.attachments, request.attachment_url
  INTO v_request_row
  FROM public.quote_requests AS request WHERE request.id = v_request_a;
  IF v_request_row.attachment_url IS NOT NULL OR jsonb_array_length(v_request_row.attachments) <> 0 THEN
    RAISE EXCEPTION 'Erasure left an obsolete attachment reference that would block retry';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects AS object
    JOIN public.quote_attachment_object_ownership AS ownership ON ownership.object_path = object.name
    WHERE object.bucket_id = 'quote-attachments'
      AND object.name = v_fresh_path
      AND ownership.organization_id = v_org_b
  ) THEN
    RAISE EXCEPTION 'Erasing organization A removed tenant B''s registered attachment';
  END IF;
  PERFORM public.assert_quote_attachment_cutover_complete();
END;
$test$;

ROLLBACK;
