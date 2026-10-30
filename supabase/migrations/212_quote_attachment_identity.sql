BEGIN;

-- Storage names and public slugs are not ownership evidence. Every object is
-- trusted only when an immutable organization UUID owner was recorded by the
-- Storage guard or an explicit reviewed migration RPC.
CREATE TABLE public.quote_attachment_object_ownership (
  object_path TEXT PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  verified_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.quote_attachment_object_ownership IS
  'Private authoritative ownership for quote-attachments Storage objects; historical objects require explicit reviewed migration.';
ALTER TABLE public.quote_attachment_object_ownership ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quote_attachment_object_ownership FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.quote_attachment_object_ownership TO service_role;

CREATE TABLE public.quote_attachment_migration_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_path TEXT UNIQUE,
  source_path_hash TEXT NOT NULL UNIQUE CHECK (source_path_hash ~ '^[0-9a-f]{64}$'),
  destination_path TEXT UNIQUE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  source_sha256 TEXT,
  action TEXT NOT NULL CHECK (action IN ('move', 'delete')),
  state TEXT NOT NULL DEFAULT 'prepared' CHECK (state IN ('prepared', 'completed')),
  updated_references INTEGER NOT NULL DEFAULT 0 CHECK (updated_references >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  CHECK (
    (action = 'move' AND destination_path IS NOT NULL)
    OR (action = 'delete' AND destination_path IS NULL)
  ),
  CHECK (
    (state = 'prepared' AND source_path IS NOT NULL AND source_sha256 IS NOT NULL AND source_sha256 ~ '^[0-9a-f]{64}$' AND completed_at IS NULL)
    OR (state = 'completed' AND source_path IS NULL AND source_sha256 IS NULL AND completed_at IS NOT NULL)
  )
);

COMMENT ON TABLE public.quote_attachment_migration_jobs IS
  'Private durable reviewed Storage migration state; completed jobs erase source paths and content hashes, retaining only a source-path hash tombstone.';
ALTER TABLE public.quote_attachment_migration_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quote_attachment_migration_jobs FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.quote_attachment_migration_jobs TO service_role;
-- This transaction-scoped, exact-row context is writable only by the definer
-- finalizer. It lets one prepared job rewrite its source while preserving
-- unrelated legacy references in that same request for later reviewed jobs.
CREATE TABLE public.quote_attachment_migration_rewrite_context (
  transaction_id BIGINT NOT NULL,
  request_id UUID NOT NULL REFERENCES public.quote_requests(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES public.quote_attachment_migration_jobs(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  old_attachments JSONB,
  old_attachment_url TEXT,
  new_attachments JSONB,
  new_attachment_url TEXT,
  PRIMARY KEY (transaction_id, request_id)
);
ALTER TABLE public.quote_attachment_migration_rewrite_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.quote_attachment_migration_rewrite_context
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON TABLE public.quote_attachment_migration_rewrite_context IS
  'Private transaction-scoped exact-row authorization for one prepared finalizer rewrite; callers cannot set a generic internal bypass.';

CREATE OR REPLACE FUNCTION public.quote_attachment_safe_path(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  RETURN p_path IS NOT NULL
    AND octet_length(p_path) <= 1024
    AND p_path ~ '^quote-requests/[^/]+/.+$'
    AND p_path !~ '/$'
    AND p_path !~ '(^|/)\.{1,2}(/|$)'
    AND position('//' IN p_path) = 0
    AND position(chr(92) IN p_path) = 0
    AND p_path !~ '[[:cntrl:]]';
END;
$$;
REVOKE ALL ON FUNCTION public.quote_attachment_safe_path(TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_attachment_owner_id(p_path TEXT)
RETURNS UUID
LANGUAGE plpgsql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_parts TEXT[];
BEGIN
  v_parts := regexp_match(
    p_path,
    '^quote-requests/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/([A-Za-z0-9_-]{1,128}\.(pdf|jpe?g|png|webp|dwg|dxf)|migrated-[0-9a-f]{64}\.bin)$'
  );
  IF v_parts IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_parts[1]::UUID;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.quote_attachment_owner_id(TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_attachment_is_canonical(p_path TEXT, p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    p_organization_id IS NOT NULL
      AND public.quote_attachment_owner_id(p_path) = p_organization_id
      AND public.quote_attachment_safe_path(p_path),
    false
  )
$$;
REVOKE ALL ON FUNCTION public.quote_attachment_is_canonical(TEXT, UUID) FROM PUBLIC, anon, authenticated, service_role;

-- Historical metadata is limited to the observed forms: a plain storage_path,
-- nested public_url, or the legacy quote_requests.attachment_url URL column.
-- URL aliases are parsed strictly; unsupported/ambiguous URLs stay unresolved.
CREATE OR REPLACE FUNCTION public.quote_attachment_reference_path(p_reference TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_parts TEXT[];
  v_path TEXT;
BEGIN
  IF p_reference IS NULL THEN
    RETURN NULL;
  END IF;
  IF public.quote_attachment_safe_path(p_reference) THEN
    RETURN p_reference;
  END IF;
  v_parts := regexp_match(
    p_reference,
    '^https?://[^/?#@|]+/storage/v1/object/(public|sign|authenticated)/quote-attachments/([^?#]+)$',
    'i'
  );
  IF v_parts IS NULL THEN
    RETURN NULL;
  END IF;
  v_path := public.decode_managed_storage_url_path(v_parts[2]);
  IF NOT public.quote_attachment_safe_path(v_path) THEN
    RETURN NULL;
  END IF;
  RETURN v_path;
END;
$$;
REVOKE ALL ON FUNCTION public.quote_attachment_reference_path(TEXT) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.quote_attachment_reference_may_match(p_reference TEXT, p_source_path TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_parts TEXT[];
  v_path TEXT;
BEGIN
  IF p_reference IS NULL OR p_source_path IS NULL THEN
    RETURN false;
  END IF;
  IF public.quote_attachment_reference_path(p_reference) = p_source_path
     OR strpos(p_reference, p_source_path) > 0 THEN
    RETURN true;
  END IF;
  v_parts := regexp_match(
    p_reference,
    '^https?://[^/?#@|]+/storage/v1/object/(public|sign|authenticated)/quote-attachments/([^?#]+)([?#].*)?$',
    'i'
  );
  IF v_parts IS NULL THEN
    RETURN false;
  END IF;
  v_path := public.decode_managed_storage_url_path(v_parts[2]);
  RETURN v_path = p_source_path;
END;
$$;
REVOKE ALL ON FUNCTION public.quote_attachment_reference_may_match(TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_attachment_request_references(
  p_attachments JSONB,
  p_attachment_url TEXT,
  p_source_path TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_item JSONB;
BEGIN
  IF public.quote_attachment_reference_may_match(p_attachment_url, p_source_path) THEN
    RETURN true;
  END IF;
  IF jsonb_typeof(p_attachments) <> 'array' THEN
    RETURN false;
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments) AS entries(value) LOOP
    IF jsonb_typeof(v_item) = 'object'
       AND (
         public.quote_attachment_reference_may_match(v_item ->> 'storage_path', p_source_path)
         OR public.quote_attachment_reference_may_match(v_item ->> 'public_url', p_source_path)
       ) THEN
      RETURN true;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION public.quote_attachment_request_references(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_attachment_reference_count(
  p_attachments JSONB,
  p_attachment_url TEXT,
  p_source_path TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_count INTEGER := 0;
  v_item JSONB;
BEGIN
  IF public.quote_attachment_reference_path(p_attachment_url) = p_source_path THEN
    v_count := v_count + 1;
  END IF;
  IF jsonb_typeof(p_attachments) = 'array' THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments) AS entries(value) LOOP
      IF jsonb_typeof(v_item) = 'object'
         AND (
           public.quote_attachment_reference_path(v_item ->> 'storage_path') = p_source_path
           OR public.quote_attachment_reference_path(v_item ->> 'public_url') = p_source_path
         ) THEN
        v_count := v_count + 1;
      END IF;
    END LOOP;
  END IF;
  RETURN v_count;
END;
$$;
REVOKE ALL ON FUNCTION public.quote_attachment_reference_count(JSONB, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_attachment_rewrite_metadata(
  p_attachments JSONB,
  p_source_path TEXT,
  p_destination_path TEXT,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_item JSONB;
  v_storage_path TEXT;
  v_public_path TEXT;
  v_references_source BOOLEAN;
  v_result JSONB := '[]'::JSONB;
BEGIN
  IF p_attachments IS NULL THEN
    RETURN NULL;
  END IF;
  IF jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'Quote attachment metadata is not an array; reviewed reconciliation is required';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments) AS entries(value) LOOP
    v_references_source := false;
    IF jsonb_typeof(v_item) = 'object' THEN
      v_storage_path := public.quote_attachment_reference_path(v_item ->> 'storage_path');
      v_public_path := public.quote_attachment_reference_path(v_item ->> 'public_url');
      v_references_source := v_storage_path = p_source_path OR v_public_path = p_source_path;
    END IF;

    IF v_references_source IS NOT TRUE THEN
      v_result := v_result || jsonb_build_array(v_item);
      CONTINUE;
    END IF;

    IF (v_item ? 'storage_path' AND v_storage_path IS DISTINCT FROM p_source_path)
       OR (v_item ? 'public_url' AND v_public_path IS DISTINCT FROM p_source_path) THEN
      RAISE EXCEPTION 'Conflicting quote attachment path aliases require reviewed reconciliation';
    END IF;

    IF p_action = 'move' THEN
      v_result := v_result || jsonb_build_array(
        (v_item - 'public_url') || jsonb_build_object('storage_path', p_destination_path)
      );
    ELSIF p_action <> 'delete' THEN
      RAISE EXCEPTION 'Unsupported quote attachment migration action';
    END IF;
  END LOOP;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.quote_attachment_rewrite_metadata(JSONB, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.guard_quote_attachment_storage_object()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_organization_id UUID;
  v_source_path TEXT;
  v_anonymized_at TIMESTAMPTZ;
  v_cleanup_completed_at TIMESTAMPTZ;
  v_deletion_scheduled_at TIMESTAMPTZ;
  v_job_action TEXT;
  v_job_state TEXT;
  v_request RECORD;
  v_rewritten_attachments JSONB;
  v_rewritten_url TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.bucket_id <> 'quote-attachments' THEN
      RETURN OLD;
    END IF;
    IF NOT COALESCE(auth.role() = 'service_role', false) THEN
      RAISE EXCEPTION 'Quote attachment Storage mutation is service-only' USING ERRCODE = '42501';
    END IF;

    SELECT ownership.organization_id INTO v_organization_id
    FROM public.quote_attachment_object_ownership AS ownership
    WHERE ownership.object_path = OLD.name;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unregistered quote attachment object cannot be removed';
    END IF;

    SELECT o.anonymized_at, o.deletion_cleanup_completed_at, o.deletion_scheduled_at
      INTO v_anonymized_at, v_cleanup_completed_at, v_deletion_scheduled_at
    FROM public.organizations AS o
    WHERE o.id = v_organization_id
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quote attachment owner organization is missing';
    END IF;

    SELECT j.action, j.state INTO v_job_action, v_job_state
    FROM public.quote_attachment_migration_jobs AS j
    WHERE j.source_path = OLD.name
      AND j.organization_id = v_organization_id
    FOR UPDATE;
    IF FOUND AND v_job_state = 'prepared' AND v_job_action IN ('move', 'delete') THEN
      IF v_job_action = 'delete' AND v_anonymized_at IS NULL THEN
        RAISE EXCEPTION 'Quote attachment migration delete requires an erased organization';
      END IF;
      RETURN OLD;
    END IF;

    IF v_anonymized_at IS NULL OR v_cleanup_completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Quote attachment object may be removed only during account erasure';
    END IF;
    FOR v_request IN
      SELECT request.id, request.attachments, request.attachment_url
      FROM public.quote_requests AS request
      WHERE request.organization_id = v_organization_id
        AND public.quote_attachment_request_references(request.attachments, request.attachment_url, OLD.name)
      FOR UPDATE
    LOOP
      v_rewritten_attachments := public.quote_attachment_rewrite_metadata(
        v_request.attachments, OLD.name, NULL, 'delete'
      );
      v_rewritten_url := v_request.attachment_url;
      IF public.quote_attachment_reference_path(v_rewritten_url) = OLD.name THEN
        v_rewritten_url := NULL;
      END IF;
      UPDATE public.quote_requests AS request
      SET attachments = v_rewritten_attachments,
          attachment_url = v_rewritten_url
      WHERE request.id = v_request.id;
    END LOOP;
    DELETE FROM public.quote_attachment_object_ownership AS ownership
    WHERE ownership.object_path = OLD.name
      AND ownership.organization_id = v_organization_id;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.bucket_id <> 'quote-attachments' AND NEW.bucket_id <> 'quote-attachments' THEN
      RETURN NEW;
    END IF;
    IF OLD.bucket_id <> 'quote-attachments' OR NEW.bucket_id <> 'quote-attachments' THEN
      RAISE EXCEPTION 'Quote attachment objects cannot change buckets';
    END IF;
    IF NOT COALESCE(auth.role() = 'service_role', false) THEN
      RAISE EXCEPTION 'Quote attachment Storage mutation is service-only' USING ERRCODE = '42501';
    END IF;

    IF NEW.name = OLD.name THEN
      SELECT ownership.organization_id INTO v_organization_id
      FROM public.quote_attachment_object_ownership AS ownership
      WHERE ownership.object_path = OLD.name;
      IF NOT FOUND OR NOT public.quote_attachment_is_canonical(OLD.name, v_organization_id) THEN
        RAISE EXCEPTION 'Unregistered or noncanonical quote attachment object cannot be updated';
      END IF;
      SELECT o.anonymized_at, o.deletion_cleanup_completed_at, o.deletion_scheduled_at
        INTO v_anonymized_at, v_cleanup_completed_at, v_deletion_scheduled_at
      FROM public.organizations AS o
      WHERE o.id = v_organization_id
      FOR UPDATE;
      IF NOT FOUND OR v_anonymized_at IS NOT NULL OR v_cleanup_completed_at IS NOT NULL OR v_deletion_scheduled_at IS NOT NULL THEN
        RAISE EXCEPTION 'Quote attachment owner organization is not active';
      END IF;
      RETURN NEW;
    END IF;

    SELECT j.organization_id, j.source_path INTO v_organization_id, v_source_path
    FROM public.quote_attachment_migration_jobs AS j
    WHERE j.source_path = OLD.name
      AND j.destination_path = NEW.name
      AND j.action = 'move'
      AND j.state = 'prepared'
    FOR UPDATE;
    IF NOT FOUND OR v_source_path IS DISTINCT FROM OLD.name
       OR NOT public.quote_attachment_is_canonical(NEW.name, v_organization_id) THEN
      RAISE EXCEPTION 'Quote attachment move requires a matching prepared migration job';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
      WHERE ownership.object_path = OLD.name
        AND ownership.organization_id = v_organization_id
    ) THEN
      RAISE EXCEPTION 'Prepared quote attachment source has no authoritative owner';
    END IF;
    SELECT o.anonymized_at, o.deletion_cleanup_completed_at, o.deletion_scheduled_at
      INTO v_anonymized_at, v_cleanup_completed_at, v_deletion_scheduled_at
    FROM public.organizations AS o
    WHERE o.id = v_organization_id
    FOR UPDATE;
    IF NOT FOUND OR v_anonymized_at IS NOT NULL OR v_cleanup_completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Quote attachment migration owner organization is not active';
    END IF;
    IF EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = 'quote-attachments'
        AND object.name = NEW.name
        AND object.name <> OLD.name
    ) OR EXISTS (
      SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
      WHERE ownership.object_path = NEW.name
    ) THEN
      RAISE EXCEPTION 'Quote attachment migration destination already exists';
    END IF;
    INSERT INTO public.quote_attachment_object_ownership (object_path, organization_id)
    VALUES (NEW.name, v_organization_id);
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.bucket_id <> 'quote-attachments' THEN
      RETURN NEW;
    END IF;
    IF NOT COALESCE(auth.role() = 'service_role', false) THEN
      RAISE EXCEPTION 'Quote attachment Storage mutation is service-only' USING ERRCODE = '42501';
    END IF;

    SELECT j.organization_id, j.source_path INTO v_organization_id, v_source_path
    FROM public.quote_attachment_migration_jobs AS j
    WHERE j.destination_path = NEW.name
      AND j.action = 'move'
      AND j.state = 'prepared'
    FOR UPDATE;
    IF FOUND THEN
      IF NOT public.quote_attachment_is_canonical(NEW.name, v_organization_id)
         OR NOT EXISTS (
           SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
           WHERE ownership.object_path = v_source_path
             AND ownership.organization_id = v_organization_id
         ) THEN
        RAISE EXCEPTION 'Prepared quote attachment source has no authoritative owner';
      END IF;
    ELSE
      v_organization_id := public.quote_attachment_owner_id(NEW.name);
      IF v_organization_id IS NULL OR NOT public.quote_attachment_is_canonical(NEW.name, v_organization_id) THEN
        RAISE EXCEPTION 'Quote attachment upload path must use its canonical organization UUID namespace';
      END IF;
    END IF;

    SELECT o.anonymized_at, o.deletion_cleanup_completed_at, o.deletion_scheduled_at
      INTO v_anonymized_at, v_cleanup_completed_at, v_deletion_scheduled_at
    FROM public.organizations AS o
    WHERE o.id = v_organization_id
    FOR UPDATE;
    IF NOT FOUND OR v_anonymized_at IS NOT NULL OR v_cleanup_completed_at IS NOT NULL
       OR (v_deletion_scheduled_at IS NOT NULL AND v_source_path IS NULL) THEN
      RAISE EXCEPTION 'Quote attachment owner organization is not active';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
      WHERE ownership.object_path = NEW.name
    ) THEN
      RAISE EXCEPTION 'Quote attachment object path already has an owner';
    END IF;
    INSERT INTO public.quote_attachment_object_ownership (object_path, organization_id)
    VALUES (NEW.name, v_organization_id);
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_quote_attachment_storage_object() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_quote_attachment_storage_object ON storage.objects;
CREATE TRIGGER trg_guard_quote_attachment_storage_object
  BEFORE INSERT OR UPDATE OR DELETE ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.guard_quote_attachment_storage_object();

CREATE OR REPLACE FUNCTION public.guard_quote_request_attachment_ownership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_context RECORD;
  v_item JSONB;
  v_path TEXT;
BEGIN
  -- The definer finalizer may make only its exact prepared-job rewrite. The
  -- transaction-scoped row is private to this function; no caller-controlled
  -- GUC or service-role table write can authorize a legacy remainder.
  IF TG_OP = 'UPDATE' THEN
    SELECT context.organization_id,
           context.old_attachments,
           context.old_attachment_url,
           context.new_attachments,
           context.new_attachment_url,
           job.state AS job_state,
           job.organization_id AS job_organization_id,
           job.source_path AS job_source_path,
           job.destination_path AS job_destination_path,
           job.action AS job_action
    INTO v_context
    FROM public.quote_attachment_migration_rewrite_context AS context
    JOIN public.quote_attachment_migration_jobs AS job
      ON job.id = context.job_id
    WHERE context.transaction_id = txid_current()
      AND context.request_id = OLD.id;
    IF FOUND THEN
      IF NOT COALESCE(auth.role() = 'service_role', false)
         OR v_context.organization_id IS DISTINCT FROM OLD.organization_id
         OR v_context.organization_id IS DISTINCT FROM NEW.organization_id
         OR v_context.old_attachments IS DISTINCT FROM OLD.attachments
         OR v_context.old_attachment_url IS DISTINCT FROM OLD.attachment_url
         OR v_context.new_attachments IS DISTINCT FROM NEW.attachments
         OR v_context.new_attachment_url IS DISTINCT FROM NEW.attachment_url
         OR v_context.job_state <> 'prepared'
         OR v_context.job_organization_id IS DISTINCT FROM v_context.organization_id
         OR v_context.job_source_path IS NULL
         OR v_context.job_action NOT IN ('move', 'delete')
         OR EXISTS (
           SELECT 1 FROM storage.objects AS object
           WHERE object.bucket_id = 'quote-attachments'
             AND object.name = v_context.job_source_path
         )
         OR NOT EXISTS (
           SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
           WHERE ownership.object_path = v_context.job_source_path
             AND ownership.organization_id = v_context.organization_id
         )
         OR (v_context.job_action = 'move' AND (
           NOT public.quote_attachment_is_canonical(
             v_context.job_destination_path, v_context.organization_id
           )
           OR NOT EXISTS (
             SELECT 1 FROM storage.objects AS object
             WHERE object.bucket_id = 'quote-attachments'
               AND object.name = v_context.job_destination_path
           )
           OR NOT EXISTS (
             SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
             WHERE ownership.object_path = v_context.job_destination_path
               AND ownership.organization_id = v_context.organization_id
           )
         ))
         OR (v_context.job_action = 'delete' AND v_context.job_destination_path IS NOT NULL) THEN
        RAISE EXCEPTION 'Invalid prepared quote attachment finalization rewrite context';
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.attachment_url IS NOT NULL THEN
    RAISE EXCEPTION 'Legacy quote attachment URLs require reviewed migration before they can be written';
  END IF;
  IF NEW.attachments IS NULL THEN
    RETURN NEW;
  END IF;
  IF jsonb_typeof(NEW.attachments) <> 'array' THEN
    RAISE EXCEPTION 'Quote attachment metadata must be an array';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(NEW.attachments) AS entries(value) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR jsonb_typeof(v_item -> 'storage_path') <> 'string'
       OR v_item ? 'public_url' THEN
      RAISE EXCEPTION 'Quote attachment metadata must contain only a registered storage_path';
    END IF;
    v_path := v_item ->> 'storage_path';
    IF NOT public.quote_attachment_is_canonical(v_path, NEW.organization_id)
       OR NOT EXISTS (
         SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
         WHERE ownership.object_path = v_path
           AND ownership.organization_id = NEW.organization_id
       ) THEN
      RAISE EXCEPTION 'Quote request attachment is not owned by its organization';
    END IF;
    -- Serialize reference creation with Storage deletion/erasure. A concurrent
    -- DELETE either clears this committed reference or wins and makes this fail.
    PERFORM 1 FROM storage.objects AS object
    WHERE object.bucket_id = 'quote-attachments'
      AND object.name = v_path
    FOR KEY SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Quote request attachment object is absent from Storage';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_quote_request_attachment_ownership() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_quote_request_attachment_ownership ON public.quote_requests;
CREATE TRIGGER trg_guard_quote_request_attachment_ownership
  BEFORE INSERT OR UPDATE OF organization_id, attachments, attachment_url ON public.quote_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_quote_request_attachment_ownership();

CREATE OR REPLACE FUNCTION public.prepare_quote_attachment_migration(
  p_source_path TEXT,
  p_organization_id UUID,
  p_source_sha256 TEXT,
  p_action TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_job public.quote_attachment_migration_jobs%ROWTYPE;
  v_source_hash TEXT;
  v_destination_path TEXT;
  v_extension TEXT;
  v_anonymized_at TIMESTAMPTZ;
  v_cleanup_completed_at TIMESTAMPTZ;
  v_deletion_scheduled_at TIMESTAMPTZ;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    RAISE EXCEPTION 'Action réservée au serveur' USING ERRCODE = '42501';
  END IF;
  IF NOT public.quote_attachment_safe_path(p_source_path)
     OR p_organization_id IS NULL
     OR p_action IS NULL
     OR p_action NOT IN ('move', 'delete') THEN
    RAISE EXCEPTION 'Invalid reviewed quote attachment migration entry';
  END IF;
  v_source_hash := encode(extensions.digest(convert_to(p_source_path, 'UTF8'), 'sha256'), 'hex');

  SELECT * INTO v_job
  FROM public.quote_attachment_migration_jobs AS j
  WHERE j.source_path_hash = v_source_hash
  FOR UPDATE;
  IF FOUND THEN
    IF v_job.organization_id <> p_organization_id OR v_job.action <> p_action
       OR (v_job.state = 'prepared' AND (
         v_job.source_path IS DISTINCT FROM p_source_path
         OR (p_source_sha256 IS NOT NULL AND (
           p_source_sha256 !~* '^[0-9a-f]{64}$'
           OR v_job.source_sha256 IS DISTINCT FROM lower(p_source_sha256)
         ))
       ))
       OR (v_job.source_path IS NOT NULL AND v_job.source_path IS DISTINCT FROM p_source_path) THEN
      RAISE EXCEPTION 'Incompatible quote attachment migration entry for existing source tombstone';
    END IF;
    RETURN jsonb_build_object(
      'job_id', v_job.id,
      'source_path', p_source_path,
      'organization_id', v_job.organization_id,
      'source_sha256', v_job.source_sha256,
      'action', v_job.action,
      'state', v_job.state,
      'destination_path', v_job.destination_path
    );
  END IF;

  IF p_source_sha256 IS NULL THEN
    RETURN jsonb_build_object(
      'job_id', NULL,
      'source_path', p_source_path,
      'organization_id', p_organization_id,
      'source_sha256', NULL,
      'action', p_action,
      'state', 'unprepared',
      'destination_path', NULL
    );
  END IF;
  IF p_source_sha256 !~* '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid reviewed quote attachment SHA-256';
  END IF;
  p_source_sha256 := lower(p_source_sha256);

  -- Match Storage's row-lock ordering: source object first, then the same
  -- organization row serialized by account anonymization and new uploads.
  PERFORM 1 FROM storage.objects AS object
  WHERE object.bucket_id = 'quote-attachments'
    AND object.name = p_source_path
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote attachment migration source object is missing';
  END IF;

  SELECT o.anonymized_at, o.deletion_cleanup_completed_at, o.deletion_scheduled_at
    INTO v_anonymized_at, v_cleanup_completed_at, v_deletion_scheduled_at
  FROM public.organizations AS o
  WHERE o.id = p_organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote attachment migration organization is missing';
  END IF;
  IF p_action = 'move' AND (v_anonymized_at IS NOT NULL OR v_cleanup_completed_at IS NOT NULL) THEN
    RAISE EXCEPTION 'Quote attachment move requires an active organization';
  END IF;
  IF p_action = 'delete' AND v_anonymized_at IS NULL THEN
    RAISE EXCEPTION 'Quote attachment delete migration requires an erased organization';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
    WHERE ownership.object_path = p_source_path
  ) THEN
    RAISE EXCEPTION 'Quote attachment source is already registered; it is not an unverified legacy object';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.quote_requests AS request
    WHERE public.quote_attachment_request_references(request.attachments, request.attachment_url, p_source_path)
      AND request.organization_id <> p_organization_id
  ) THEN
    RAISE EXCEPTION 'Quote attachment source is referenced by another organization';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.quote_requests AS request
    WHERE public.quote_attachment_reference_may_match(request.attachment_url, p_source_path)
      AND public.quote_attachment_reference_path(request.attachment_url) IS DISTINCT FROM p_source_path
  ) OR EXISTS (
    SELECT 1
    FROM public.quote_requests AS request
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE WHEN jsonb_typeof(request.attachments) = 'array' THEN request.attachments ELSE '[]'::jsonb END
    ) AS entries(item)
    WHERE jsonb_typeof(entries.item) = 'object'
      AND (
        public.quote_attachment_reference_may_match(entries.item ->> 'storage_path', p_source_path)
        OR public.quote_attachment_reference_may_match(entries.item ->> 'public_url', p_source_path)
      )
      AND (
        (entries.item ? 'storage_path'
          AND public.quote_attachment_reference_path(entries.item ->> 'storage_path') IS DISTINCT FROM p_source_path)
        OR (entries.item ? 'public_url'
          AND public.quote_attachment_reference_path(entries.item ->> 'public_url') IS DISTINCT FROM p_source_path)
      )
  ) THEN
    RAISE EXCEPTION 'Conflicting quote attachment path aliases require reviewed reconciliation';
  END IF;

  IF p_action = 'move' THEN
    v_extension := lower((regexp_match(p_source_path, '\.([A-Za-z0-9]{1,8})$'))[1]);
    IF v_extension IS NULL OR v_extension NOT IN ('pdf', 'jpg', 'jpeg', 'png', 'webp', 'dwg', 'dxf') THEN
      v_extension := 'bin';
    END IF;
    v_destination_path := 'quote-requests/' || p_organization_id::TEXT || '/migrated-'
      || v_source_hash || '.' || v_extension;
    IF NOT public.quote_attachment_is_canonical(v_destination_path, p_organization_id) THEN
      RAISE EXCEPTION 'Generated quote attachment migration destination is not canonical';
    END IF;
    IF EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = 'quote-attachments'
        AND object.name = v_destination_path
    ) OR EXISTS (
      SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
      WHERE ownership.object_path = v_destination_path
    ) OR EXISTS (
      SELECT 1 FROM public.quote_attachment_migration_jobs AS job
      WHERE job.destination_path = v_destination_path
    ) THEN
      RAISE EXCEPTION 'Quote attachment migration destination already exists';
    END IF;
  END IF;

  INSERT INTO public.quote_attachment_object_ownership (object_path, organization_id)
  VALUES (p_source_path, p_organization_id);
  INSERT INTO public.quote_attachment_migration_jobs (
    source_path, source_path_hash, destination_path, organization_id, source_sha256, action, state
  ) VALUES (
    p_source_path, v_source_hash, v_destination_path, p_organization_id, p_source_sha256, p_action, 'prepared'
  )
  RETURNING * INTO v_job;

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'source_path', v_job.source_path,
    'organization_id', v_job.organization_id,
    'source_sha256', v_job.source_sha256,
    'action', v_job.action,
    'state', v_job.state,
    'destination_path', v_job.destination_path
  );
END;
$$;
REVOKE ALL ON FUNCTION public.prepare_quote_attachment_migration(TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_quote_attachment_migration(TEXT, UUID, TEXT, TEXT)
  TO service_role;
COMMENT ON FUNCTION public.prepare_quote_attachment_migration(TEXT, UUID, TEXT, TEXT) IS
  'Service-only. Creates or resumes a reviewed unverified source mapping. Returns {job_id,source_path,organization_id,source_sha256,action,state,destination_path}; canonical move destinations are deterministic and database-generated.';

CREATE OR REPLACE FUNCTION public.finalize_quote_attachment_migration(
  p_job_id UUID,
  p_observed_sha256 TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_job public.quote_attachment_migration_jobs%ROWTYPE;
  v_source_path TEXT;
  v_reference_count INTEGER := 0;
  v_row_count INTEGER := 0;
  v_request RECORD;
  v_new_attachments JSONB;
  v_new_attachment_url TEXT;
  v_has_nested_reference BOOLEAN;
  v_anonymized_at TIMESTAMPTZ;
  v_cleanup_completed_at TIMESTAMPTZ;
  v_context_rows INTEGER;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    RAISE EXCEPTION 'Action réservée au serveur' USING ERRCODE = '42501';
  END IF;
  IF p_observed_sha256 !~* '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Observed quote attachment SHA-256 is invalid';
  END IF;

  SELECT * INTO v_job
  FROM public.quote_attachment_migration_jobs AS j
  WHERE j.id = p_job_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote attachment migration job not found';
  END IF;
  IF v_job.state = 'completed' THEN
    RETURN jsonb_build_object(
      'job_id', v_job.id,
      'source_path', NULL,
      'destination_path', v_job.destination_path,
      'organization_id', v_job.organization_id,
      'action', v_job.action,
      'state', v_job.state,
      'updated_references', v_job.updated_references
    );
  END IF;
  IF lower(p_observed_sha256) IS DISTINCT FROM v_job.source_sha256 THEN
    RAISE EXCEPTION 'Observed source SHA-256 does not match the prepared quote attachment';
  END IF;
  v_source_path := v_job.source_path;
  SELECT o.anonymized_at, o.deletion_cleanup_completed_at
    INTO v_anonymized_at, v_cleanup_completed_at
  FROM public.organizations AS o
  WHERE o.id = v_job.organization_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quote attachment migration organization is missing';
  END IF;
  IF v_job.action = 'delete' AND v_anonymized_at IS NULL THEN
    RAISE EXCEPTION 'Quote attachment delete migration requires an erased organization';
  END IF;

  IF EXISTS (
    SELECT 1 FROM storage.objects AS object
    WHERE object.bucket_id = 'quote-attachments'
      AND object.name = v_source_path
  ) THEN
    RAISE EXCEPTION 'Quote attachment migration source object is still present';
  END IF;
  IF v_job.action = 'move' AND (
    NOT EXISTS (
      SELECT 1 FROM storage.objects AS object
      WHERE object.bucket_id = 'quote-attachments'
        AND object.name = v_job.destination_path
    ) OR NOT EXISTS (
      SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
      WHERE ownership.object_path = v_job.destination_path
        AND ownership.organization_id = v_job.organization_id
    )
  ) THEN
    RAISE EXCEPTION 'Quote attachment migration destination is missing or misowned';
  END IF;
  IF v_job.action = 'delete' AND v_job.destination_path IS NOT NULL THEN
    RAISE EXCEPTION 'Quote attachment delete migration cannot have a destination';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.quote_requests AS request
    WHERE public.quote_attachment_request_references(request.attachments, request.attachment_url, v_source_path)
      AND request.organization_id <> v_job.organization_id
  ) THEN
    RAISE EXCEPTION 'Quote attachment source acquired a conflicting foreign reference';
  END IF;

  FOR v_request IN
    SELECT request.id, request.attachments, request.attachment_url
    FROM public.quote_requests AS request
    WHERE request.organization_id = v_job.organization_id
      AND public.quote_attachment_request_references(request.attachments, request.attachment_url, v_source_path)
    FOR UPDATE
  LOOP
    v_reference_count := v_reference_count + public.quote_attachment_reference_count(
      v_request.attachments, v_request.attachment_url, v_source_path
    );
    v_new_attachments := public.quote_attachment_rewrite_metadata(
      v_request.attachments, v_source_path, v_job.destination_path, v_job.action
    );
    v_new_attachment_url := v_request.attachment_url;
    IF public.quote_attachment_reference_path(v_request.attachment_url) = v_source_path THEN
      IF v_job.action = 'move' THEN
        v_has_nested_reference := public.quote_attachment_request_references(
          v_request.attachments, NULL, v_source_path
        );
        IF NOT v_has_nested_reference THEN
          IF v_new_attachments IS NULL THEN
            v_new_attachments := '[]'::JSONB;
          END IF;
          v_new_attachments := v_new_attachments || jsonb_build_array(
            jsonb_build_object('storage_path', v_job.destination_path)
          );
        END IF;
      END IF;
      v_new_attachment_url := NULL;
    END IF;

    INSERT INTO public.quote_attachment_migration_rewrite_context (
      transaction_id, request_id, job_id, organization_id,
      old_attachments, old_attachment_url, new_attachments, new_attachment_url
    ) VALUES (
      txid_current(), v_request.id, v_job.id, v_job.organization_id,
      v_request.attachments, v_request.attachment_url,
      v_new_attachments, v_new_attachment_url
    );

    UPDATE public.quote_requests AS request
    SET attachments = v_new_attachments,
        attachment_url = v_new_attachment_url
    WHERE request.id = v_request.id;
    GET DIAGNOSTICS v_context_rows = ROW_COUNT;
    IF v_context_rows <> 1 THEN
      RAISE EXCEPTION 'Quote attachment finalization did not update exactly one request row';
    END IF;
    DELETE FROM public.quote_attachment_migration_rewrite_context AS context
    WHERE context.transaction_id = txid_current()
      AND context.request_id = v_request.id
      AND context.job_id = v_job.id;
    GET DIAGNOSTICS v_context_rows = ROW_COUNT;
    IF v_context_rows <> 1 THEN
      RAISE EXCEPTION 'Quote attachment finalization rewrite context was not consumed';
    END IF;
    v_row_count := v_row_count + 1;
  END LOOP;

  DELETE FROM public.quote_attachment_object_ownership AS ownership
  WHERE ownership.object_path = v_source_path
    AND ownership.organization_id = v_job.organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prepared quote attachment source ownership record is missing';
  END IF;

  UPDATE public.quote_attachment_migration_jobs AS job
  SET source_path = NULL,
      source_sha256 = NULL,
      state = 'completed',
      updated_references = v_reference_count,
      completed_at = now()
  WHERE job.id = v_job.id;

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'source_path', v_source_path,
    'destination_path', v_job.destination_path,
    'organization_id', v_job.organization_id,
    'action', v_job.action,
    'state', 'completed',
    'updated_references', v_reference_count,
    'updated_request_rows', v_row_count
  );
END;
$$;
REVOKE ALL ON FUNCTION public.finalize_quote_attachment_migration(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_quote_attachment_migration(UUID, TEXT)
  TO service_role;
COMMENT ON FUNCTION public.finalize_quote_attachment_migration(UUID, TEXT) IS
  'Service-only. Completes a prepared move/delete after Storage confirms source absence and matching SHA-256. Returns {job_id,source_path,destination_path,organization_id,action,state,updated_references,updated_request_rows}; completed jobs erase source paths and source content hashes.';

CREATE OR REPLACE FUNCTION public.assert_quote_attachment_cutover_complete()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, pg_temp
AS $$
DECLARE
  v_request RECORD;
  v_item JSONB;
  v_path TEXT;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    RAISE EXCEPTION 'Action réservée au serveur' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.quote_attachment_migration_jobs AS job
    WHERE job.state = 'prepared'
  ) THEN
    RAISE EXCEPTION 'Quote attachment cutover has an unfinished reviewed migration job';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM storage.objects AS object
    LEFT JOIN public.quote_attachment_object_ownership AS ownership
      ON ownership.object_path = object.name
    WHERE object.bucket_id = 'quote-attachments'
      AND (
        ownership.object_path IS NULL
        OR ownership.organization_id IS DISTINCT FROM public.quote_attachment_owner_id(object.name)
        OR NOT public.quote_attachment_is_canonical(object.name, ownership.organization_id)
      )
  ) THEN
    RAISE EXCEPTION 'Quote attachment cutover has an unregistered, noncanonical, or misowned Storage object';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.quote_attachment_object_ownership AS ownership
    LEFT JOIN storage.objects AS object
      ON object.bucket_id = 'quote-attachments'
     AND object.name = ownership.object_path
    WHERE object.name IS NULL
  ) THEN
    RAISE EXCEPTION 'Quote attachment ownership registry contains an object absent from Storage';
  END IF;

  FOR v_request IN
    SELECT request.id, request.organization_id, request.attachments, request.attachment_url
    FROM public.quote_requests AS request
    WHERE request.attachment_url IS NOT NULL OR request.attachments IS NOT NULL
  LOOP
    IF v_request.attachment_url IS NOT NULL THEN
      RAISE EXCEPTION 'Quote request % has an unresolved legacy attachment_url', v_request.id;
    END IF;
    IF jsonb_typeof(v_request.attachments) <> 'array' THEN
      RAISE EXCEPTION 'Quote request % has malformed attachment metadata', v_request.id;
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_request.attachments) AS entries(value) LOOP
      IF jsonb_typeof(v_item) <> 'object'
         OR jsonb_typeof(v_item -> 'storage_path') <> 'string'
         OR v_item ? 'public_url' THEN
        RAISE EXCEPTION 'Quote request % has an unresolved historical attachment reference', v_request.id;
      END IF;
      v_path := v_item ->> 'storage_path';
      IF NOT public.quote_attachment_is_canonical(v_path, v_request.organization_id)
         OR NOT EXISTS (
           SELECT 1 FROM public.quote_attachment_object_ownership AS ownership
           WHERE ownership.object_path = v_path
             AND ownership.organization_id = v_request.organization_id
         )
         OR NOT EXISTS (
           SELECT 1 FROM storage.objects AS object
           WHERE object.bucket_id = 'quote-attachments'
             AND object.name = v_path
         ) THEN
        RAISE EXCEPTION 'Quote request % references an unresolved or foreign quote attachment', v_request.id;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.assert_quote_attachment_cutover_complete()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assert_quote_attachment_cutover_complete()
  TO service_role;
COMMENT ON FUNCTION public.assert_quote_attachment_cutover_complete() IS
  'Service-only read-only cutover gate. Raises unless all quote-attachments objects and every current/legacy request reference have verified canonical UUID ownership.';

-- Version migration 203's erasure routine so direct RPC callers must pass the
-- attachment gate before any request or identity metadata is cleared.
CREATE OR REPLACE FUNCTION public.anonymize_organization_for_deletion(p_org_id UUID)
RETURNS TABLE(memberships_deactivated INT, profiles_anonymized INT, clients_anonymized INT, members_anonymized INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_memberships INT := 0;
  v_profiles INT := 0;
  v_clients INT := 0;
  v_members INT := 0;
BEGIN
  -- Serialize against quote_requests inserts, whose BEFORE INSERT guard takes
  -- FOR SHARE on this same organization row.
  PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_org_id
      AND deletion_scheduled_at IS NOT NULL
      AND deletion_scheduled_at <= now()
      AND anonymized_at IS NULL
  ) THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  PERFORM public.assert_quote_attachment_cutover_complete();
  -- Preserve known legacy invoice/quote context before any personal fields are scrubbed.
  PERFORM public.retain_unverified_legal_context(p_org_id);

  -- Stop future recurring generation and retire only open schedules. Sent
  -- schedules and issued invoices remain unchanged.
  UPDATE public.recurring_invoices
  SET is_active = false, cancelled_at = COALESCE(cancelled_at, now())
  WHERE organization_id = p_org_id
    AND (is_active IS DISTINCT FROM false OR cancelled_at IS NULL);
  -- Mirror the existing skip action for drafts attached to open schedules;
  -- issued/non-draft invoices remain untouched.
  UPDATE public.invoices i
  SET status = 'cancelled', is_archived = true
  WHERE i.organization_id = p_org_id
    AND i.status = 'draft'
    AND EXISTS (
      SELECT 1 FROM public.invoice_schedules s
      WHERE s.organization_id = p_org_id
        AND s.invoice_id = i.id
        AND s.status IN ('pending_confirmation', 'confirmed')
    );
  UPDATE public.invoice_schedules
  SET status = 'skipped'
  WHERE organization_id = p_org_id
    AND status IN ('pending_confirmation', 'confirmed');

  INSERT INTO public.account_deletion_storage_manifests (organization_id, logo_url)
  SELECT id, logo_url FROM public.organizations WHERE id = p_org_id
  ON CONFLICT (organization_id) DO NOTHING;

  UPDATE public.memberships SET is_active = false
  WHERE organization_id = p_org_id AND is_active = true;
  GET DIAGNOSTICS v_memberships = ROW_COUNT;
  -- Revoke public quote/contract signature and PDF capabilities only; signed
  -- legal content and snapshots are intentionally preserved.
  UPDATE public.quotes SET signature_token = NULL, signature_token_expires_at = NULL
  WHERE organization_id = p_org_id
    AND (signature_token IS NOT NULL OR signature_token_expires_at IS NOT NULL);
  UPDATE public.contracts SET signature_token = NULL, signature_token_expires_at = NULL
  WHERE organization_id = p_org_id
    AND (signature_token IS NOT NULL OR signature_token_expires_at IS NOT NULL);

  -- Profiles are global to an Auth identity. Preserve them while any active
  -- membership remains in another organization.
  UPDATE public.profiles p SET
    full_name = 'Compte supprimé',
    phone = NULL,
    avatar_url = NULL,
    job_title = NULL,
    email = 'deleted-' || p.id || '@anonymized.invalid'
  WHERE EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = p_org_id AND m.user_id = p.id
  )
    AND NOT EXISTS (
      SELECT 1 FROM public.memberships other_membership
      WHERE other_membership.user_id = p.id
        AND other_membership.organization_id <> p_org_id
        AND other_membership.is_active = true
    );
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  UPDATE public.clients SET
    company_name = CASE WHEN company_name IS NOT NULL THEN 'Client anonymisé' ELSE NULL END,
    first_name = CASE WHEN first_name IS NOT NULL THEN 'Anonyme' ELSE NULL END,
    last_name = NULL,
    email = NULL,
    phone = NULL,
    mobile = NULL,
    address_line1 = NULL,
    address_line2 = NULL,
    notes = NULL,
    contact_name = NULL,
    siret = NULL,
    vat_number = NULL,
    city = NULL,
    postal_code = NULL,
    tags = NULL,
    custom_fields = NULL,
    internal_notes = NULL
  WHERE organization_id = p_org_id
    AND company_name IS DISTINCT FROM 'Client anonymisé';
  GET DIAGNOSTICS v_clients = ROW_COUNT;

  UPDATE public.chantier_equipe_membres m SET
    name = 'Membre anonymisé',
    prenom = NULL,
    email = NULL
  WHERE m.equipe_id IN (
    SELECT id FROM public.chantier_equipes WHERE organization_id = p_org_id
  ) AND m.name IS DISTINCT FROM 'Membre anonymisé';
  GET DIAGNOSTICS v_members = ROW_COUNT;

  -- Contacts de chantier (034) et demandes de devis publiques.
  UPDATE public.chantiers SET
    contact_name = NULL, contact_email = NULL, contact_phone = NULL
  WHERE organization_id = p_org_id;

  -- Required columns receive neutral values; nullable personal payload is
  -- cleared. catalog_items/attachments are nullable JSONB with no JSON default.
  UPDATE public.quote_requests SET
    name = 'Demandeur anonymisé',
    email = 'deleted-' || id || '@anonymized.invalid',
    phone = NULL,
    company_name = NULL,
    subject = NULL,
    description = 'Demande anonymisée',
    prestation_type = NULL,
    dimensions = NULL,
    attachment_url = NULL,
    chantier_address_line1 = NULL,
    chantier_postal_code = NULL,
    chantier_city = NULL,
    freeform_notes = NULL,
    catalog_items = NULL,
    attachments = NULL,
    type = 'custom'
  WHERE organization_id = p_org_id;

  -- Corps d'emails de relance, invitations, exports, conversations Sarah.
  UPDATE public.reminders SET email_subject = NULL, email_body = NULL
  WHERE organization_id = p_org_id;
  DELETE FROM public.invitations WHERE organization_id = p_org_id;
  UPDATE public.organization_exports SET requested_by_email = NULL
  WHERE organization_id = p_org_id;
  DELETE FROM public.sarah_conversation_messages WHERE organization_id = p_org_id;

  -- Mémoire d'entreprise : le texte contient clients, prix et IBAN, et les
  -- vecteurs RAG continueraient de les resservir à Sarah.
  DELETE FROM public.company_memory WHERE organization_id = p_org_id;

  -- Canaux de notification et capacités d'accès.
  DELETE FROM public.push_subscriptions WHERE organization_id = p_org_id;
  DELETE FROM public.member_space_tokens
  WHERE member_id IN (
    SELECT m.id FROM public.chantier_equipe_membres m
    JOIN public.chantier_equipes e ON e.id = m.equipe_id
    WHERE e.organization_id = p_org_id
  );

  -- Secrets et identités d'intégration.
  DELETE FROM public.organization_ai_credentials WHERE organization_id = p_org_id;
  UPDATE public.organization_einvoicing_config SET
    super_pdp_connection_id = NULL, oauth_status = 'disconnected', oauth_connected_at = NULL
  WHERE organization_id = p_org_id;

  -- Métadonnées d'audit (noms, montants) : la trace reste, le contenu part.
  -- Les lignes audit.* sont append-only, d'où la levée temporaire du drapeau.
  PERFORM set_config('app.audit_purge', 'on', true);
  UPDATE public.activity_log SET metadata = NULL WHERE organization_id = p_org_id;
  PERFORM set_config('app.audit_purge', 'off', true);

  -- Coordonnées, IBAN et signature de l'organisation elle-même.
  -- organizations.email est NOT NULL : on garde une adresse neutre dérivée.
  UPDATE public.organizations SET
    email = 'deleted-' || p_org_id || '@anonymized.invalid',
    phone = NULL, address_line1 = NULL, address_line2 = NULL,
    city = NULL, postal_code = NULL, bank_iban = NULL, bank_bic = NULL,
    signature_image = NULL, email_signature = NULL, logo_url = NULL,
    public_form_enabled = false,
    auto_reminder_enabled = false,
    anonymized_at = now()
  WHERE id = p_org_id;

  RETURN QUERY SELECT v_memberships, v_profiles, v_clients, v_members;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_organization_for_deletion(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_organization_for_deletion(UUID) TO service_role;

-- The cron calls the gate explicitly for clear failure reporting; this database
-- guard also closes alternate service-role RPC paths before anonymization.
CREATE OR REPLACE FUNCTION public.guard_quote_attachment_erasure_cutover()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.anonymized_at IS NULL AND NEW.anonymized_at IS NOT NULL THEN
    PERFORM public.assert_quote_attachment_cutover_complete();
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_quote_attachment_erasure_cutover()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_quote_attachment_erasure_cutover ON public.organizations;
CREATE TRIGGER trg_guard_quote_attachment_erasure_cutover
  BEFORE UPDATE OF anonymized_at ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.guard_quote_attachment_erasure_cutover();

NOTIFY pgrst, 'reload schema';
COMMIT;
