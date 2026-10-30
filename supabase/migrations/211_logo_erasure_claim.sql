BEGIN;

-- SettingsClient stores public organization branding at <auth-user-id>/logo.ext.
-- Create the bucket on a fresh schema without rewriting an existing deployment's
-- public flag, size limit, or MIME allow-list.
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO NOTHING;


CREATE TABLE public.account_deletion_logo_object_claims (
  object_key TEXT PRIMARY KEY,
  target_organization_id UUID NOT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.account_deletion_logo_object_claims IS
  'Private durable tombstones for managed logo objects being removed by account erasure; claims remain after Storage deletion to prevent adoption.';
ALTER TABLE public.account_deletion_logo_object_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_logo_object_claims FROM PUBLIC, anon, authenticated, service_role;

-- Decode URL-encoding layers as bytes until no escapes remain, so nested
-- percent encoding cannot bypass validation of the final canonical path.
CREATE OR REPLACE FUNCTION public.decode_managed_storage_url_path(p_value TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_current TEXT := p_value;
  v_bytes BYTEA;
  v_decoded TEXT;
  v_index INTEGER;
  v_length INTEGER;
  v_character TEXT;
  v_escape TEXT;
BEGIN
  IF p_value IS NULL THEN
    RETURN NULL;
  END IF;
  LOOP
    v_bytes := decode('', 'hex');
    v_index := 1;
    v_length := char_length(v_current);
    WHILE v_index <= v_length LOOP
      v_character := substr(v_current, v_index, 1);
      IF v_character = '%' THEN
        IF v_index + 2 > v_length THEN
          RETURN NULL;
        END IF;
        v_escape := substr(v_current, v_index + 1, 2);
        IF v_escape !~ '^[0-9A-Fa-f]{2}$' THEN
          RETURN NULL;
        END IF;
        v_bytes := v_bytes || decode(v_escape, 'hex');
        v_index := v_index + 3;
      ELSE
        v_bytes := v_bytes || convert_to(v_character, 'UTF8');
        v_index := v_index + 1;
      END IF;
    END LOOP;
    v_decoded := convert_from(v_bytes, 'UTF8');
    IF strpos(v_decoded, '%') = 0 THEN
      RETURN v_decoded;
    END IF;
    v_current := v_decoded;
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.decode_managed_storage_url_path(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

-- Return a canonical origin-and-object key only for supported Supabase Storage
-- URL variants. Other origins remain distinct; malformed paths are not fenced.
CREATE OR REPLACE FUNCTION public.account_deletion_logo_object_key(p_logo_url TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_url_path TEXT;
  v_parts TEXT[];
  v_origin TEXT;
  v_bucket TEXT;
  v_object_key TEXT;
  v_owner_segment TEXT;
BEGIN
  IF p_logo_url IS NULL THEN
    RETURN NULL;
  END IF;
  v_url_path := split_part(split_part(p_logo_url, '#', 1), '?', 1);
  v_parts := regexp_match(
    v_url_path,
    '^((https?://[^/?#@|]+))/storage/v1/(object|render/image)/(public|sign|authenticated)/([^/]+)/(.+)$'
  );
  IF v_parts IS NULL THEN
    RETURN NULL;
  END IF;
  v_origin := lower(v_parts[1]);
  IF left(v_origin, 8) = 'https://' THEN
    v_origin := regexp_replace(v_origin, ':443$', '');
  ELSIF left(v_origin, 7) = 'http://' THEN
    v_origin := regexp_replace(v_origin, ':80$', '');
  END IF;
  v_bucket := public.decode_managed_storage_url_path(v_parts[5]);
  IF v_bucket IS DISTINCT FROM 'logos' THEN
    RETURN NULL;
  END IF;
  v_object_key := public.decode_managed_storage_url_path(v_parts[6]);
  IF v_object_key IS NULL
     OR position('/' IN v_object_key) < 2
     OR position('//' IN v_object_key) > 0
     OR right(v_object_key, 1) = '/'
     OR position(chr(92) IN v_object_key) > 0
     OR position('|' IN v_object_key) > 0
     OR v_object_key ~ '[[:cntrl:]]'
     OR EXISTS (
       SELECT 1 FROM unnest(string_to_array(v_object_key, '/')) AS segments(segment)
       WHERE segment IN ('', '.', '..')
     ) THEN
    RETURN NULL;
  END IF;
  v_owner_segment := split_part(v_object_key, '/', 1);
  IF v_owner_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR length(v_object_key) <= length(v_owner_segment) + 1 THEN
    RETURN NULL;
  END IF;
  RETURN v_origin || '|' || v_object_key;
END;
$$;
REVOKE ALL ON FUNCTION public.account_deletion_logo_object_key(TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.account_deletion_logo_object_key(TEXT)
  TO service_role;

CREATE OR REPLACE FUNCTION public.lock_account_deletion_logo_object(p_object_key TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtextextended('account-deletion:logos:' || p_object_key, 0)
  );
END;
$$;
REVOKE ALL ON FUNCTION public.lock_account_deletion_logo_object(TEXT)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_logo_object(
  p_org_id UUID,
  p_object_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_separator INTEGER;
  v_origin TEXT;
  v_object_path TEXT;
  v_owner_segment TEXT;
  v_owner_id UUID;
  v_auth_user_id UUID;
  v_claimed_org_id UUID;
  v_manifest_key TEXT;
  v_target_anonymized_at TIMESTAMPTZ;
  v_cleanup_completed_at TIMESTAMPTZ;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    RAISE EXCEPTION 'Action réservée au serveur' USING ERRCODE = '42501';
  END IF;

  v_separator := position('|' IN p_object_key);
  IF p_object_key IS NULL OR v_separator < 1
     OR position('|' IN substring(p_object_key FROM v_separator + 1)) > 0 THEN
    RETURN 'unmanaged';
  END IF;
  v_origin := substring(p_object_key FROM 1 FOR v_separator - 1);
  v_object_path := substring(p_object_key FROM v_separator + 1);
  IF v_origin !~ '^https?://[^/?#@|]+$'
     OR v_origin <> lower(v_origin)
     OR (left(v_origin, 8) = 'https://' AND v_origin ~ ':443$')
     OR (left(v_origin, 7) = 'http://' AND v_origin ~ ':80$')
     OR position('/' IN v_object_path) < 2
     OR position('//' IN v_object_path) > 0
     OR right(v_object_path, 1) = '/'
     OR position(chr(92) IN v_object_path) > 0
     OR position('%' IN v_object_path) > 0
     OR v_object_path ~ '[[:cntrl:]]'
     OR EXISTS (
       SELECT 1 FROM unnest(string_to_array(v_object_path, '/')) AS segments(segment)
       WHERE segment IN ('', '.', '..')
     ) THEN
    RETURN 'unmanaged';
  END IF;
  v_owner_segment := split_part(v_object_path, '/', 1);
  IF v_owner_segment !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RETURN 'unmanaged';
  END IF;
  v_owner_id := v_owner_segment::UUID;

  -- Adoption and deletion both take this transaction-level key lock before
  -- checking references or the durable tombstone.
  PERFORM public.lock_account_deletion_logo_object(p_object_key);

  SELECT o.anonymized_at, o.deletion_cleanup_completed_at
    INTO v_target_anonymized_at, v_cleanup_completed_at
  FROM public.organizations AS o
  WHERE o.id = p_org_id;
  IF NOT FOUND OR v_target_anonymized_at IS NULL OR v_cleanup_completed_at IS NOT NULL THEN
    RETURN 'ineligible';
  END IF;

  SELECT public.account_deletion_logo_object_key(m.logo_url)
    INTO v_manifest_key
  FROM public.account_deletion_storage_manifests AS m
  WHERE m.organization_id = p_org_id;

  SELECT u.id INTO v_auth_user_id
  FROM auth.users AS u
  WHERE u.id = v_owner_id;
  IF FOUND THEN
    SELECT c.target_organization_id INTO v_claimed_org_id
    FROM public.account_deletion_identity_claims AS c
    WHERE c.auth_user_id = v_owner_id;
    IF NOT FOUND THEN
      RETURN 'ineligible';
    END IF;
    IF v_claimed_org_id <> p_org_id THEN
      RETURN 'ineligible';
    END IF;
  ELSIF v_manifest_key IS DISTINCT FROM p_object_key THEN
    -- An Auth-absent uploader may only have its original manifest-owned logo
    -- purged; arbitrary orphaned files under its old UUID prefix are not enough.
    RETURN 'ineligible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.organizations AS o
    WHERE o.anonymized_at IS NULL
      AND public.account_deletion_logo_object_key(o.logo_url) = p_object_key
  ) THEN
    RETURN 'preserve';
  END IF;

  SELECT c.target_organization_id INTO v_claimed_org_id
  FROM public.account_deletion_logo_object_claims AS c
  WHERE c.object_key = p_object_key;
  IF FOUND THEN
    IF v_claimed_org_id = p_org_id THEN
      RETURN 'claimed';
    END IF;
    RETURN 'ineligible';
  END IF;

  INSERT INTO public.account_deletion_logo_object_claims (object_key, target_organization_id)
  VALUES (p_object_key, p_org_id);
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_account_deletion_logo_object(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_logo_object(UUID, TEXT)
  TO service_role;
COMMENT ON FUNCTION public.claim_account_deletion_logo_object(UUID, TEXT) IS
  'Service-only. Returns claimed, preserve (live organization reference), ineligible, or unmanaged. Claims are durable tombstones.';

CREATE OR REPLACE FUNCTION public.protect_claimed_account_deletion_logo()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_key TEXT;
  v_old_key TEXT;
BEGIN
  v_new_key := public.account_deletion_logo_object_key(NEW.logo_url);
  IF v_new_key IS NULL THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    v_old_key := public.account_deletion_logo_object_key(OLD.logo_url);
    IF v_old_key IS NOT DISTINCT FROM v_new_key THEN
      RETURN NEW;
    END IF;
  END IF;

  PERFORM public.lock_account_deletion_logo_object(v_new_key);
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_logo_object_claims AS c
    WHERE c.object_key = v_new_key
  ) THEN
    RAISE EXCEPTION 'Cannot adopt a logo object claimed for account erasure'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.protect_claimed_account_deletion_logo()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_protect_claimed_account_deletion_logo ON public.organizations;
CREATE TRIGGER trg_protect_claimed_account_deletion_logo
  BEFORE INSERT OR UPDATE OF logo_url ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_claimed_account_deletion_logo();

COMMIT;
