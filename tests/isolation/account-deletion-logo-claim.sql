-- Run only against a disposable LOCAL Supabase database migrated through 211:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/account-deletion-logo-claim.sql
-- Exercises canonical URL ownership and both object-adoption/deletion orderings.
BEGIN;

DO $test$
DECLARE
  v_target_adopt UUID := gen_random_uuid();
  v_live_adopt UUID := gen_random_uuid();
  v_target_delete UUID := gen_random_uuid();
  v_live_delete UUID := gen_random_uuid();
  v_actor UUID := gen_random_uuid();
  v_user_adopt UUID := gen_random_uuid();
  v_user_delete UUID := gen_random_uuid();
  v_role_target_adopt UUID := gen_random_uuid();
  v_role_live_adopt UUID := gen_random_uuid();
  v_role_target_delete UUID := gen_random_uuid();
  v_role_live_delete UUID := gen_random_uuid();
  v_email_adopt TEXT := 'logo-adopt-' || gen_random_uuid()::TEXT || '@example.invalid';
  v_email_delete TEXT := 'logo-delete-' || gen_random_uuid()::TEXT || '@example.invalid';
  v_path_adopt TEXT;
  v_path_delete TEXT;
  v_key_adopt TEXT;
  v_key_delete TEXT;
  v_url TEXT;
  v_outcome TEXT;
  v_blocked BOOLEAN := false;
  v_rls_enabled BOOLEAN;
  v_bucket_public BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

  INSERT INTO public.organizations (id, name, slug, email, sector, deletion_scheduled_at, anonymized_at)
  VALUES
    (v_target_adopt, 'Logo claim adopt target', 'logo-adopt-target-' || v_target_adopt::TEXT,
     'logo-adopt-target-' || v_target_adopt::TEXT || '@example.invalid', 'construction', now() - INTERVAL '1 day', now()),
    (v_live_adopt, 'Logo claim adopt survivor', 'logo-adopt-live-' || v_live_adopt::TEXT,
     'logo-adopt-live-' || v_live_adopt::TEXT || '@example.invalid', 'construction', NULL, NULL),
    (v_target_delete, 'Logo claim deletion target', 'logo-delete-target-' || v_target_delete::TEXT,
     'logo-delete-target-' || v_target_delete::TEXT || '@example.invalid', 'construction', now() - INTERVAL '1 day', now()),
    (v_live_delete, 'Logo claim deletion survivor', 'logo-delete-live-' || v_live_delete::TEXT,
     'logo-delete-live-' || v_live_delete::TEXT || '@example.invalid', 'construction', NULL, NULL);

  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_role_target_adopt, v_target_adopt, 'Logo adoption target', 'logo-adopt-target'),
    (v_role_live_adopt, v_live_adopt, 'Logo adoption survivor', 'logo-adopt-live'),
    (v_role_target_delete, v_target_delete, 'Logo deletion target', 'logo-delete-target'),
    (v_role_live_delete, v_live_delete, 'Logo deletion survivor', 'logo-delete-live');

  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES (v_actor, 'authenticated', 'authenticated', 'logo-actor-' || v_actor::TEXT || '@example.invalid', now());
  INSERT INTO public.profiles (id, email)
  VALUES (v_actor, 'logo-actor-' || v_actor::TEXT || '@example.invalid')
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.invitations (organization_id, invited_by, email, role_id)
  VALUES
    (v_target_adopt, v_actor, v_email_adopt, v_role_target_adopt),
    (v_target_delete, v_actor, v_email_delete, v_role_target_delete);
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_user_adopt, 'authenticated', 'authenticated', v_email_adopt, now()),
    (v_user_delete, 'authenticated', 'authenticated', v_email_delete, now());
  UPDATE public.invitations SET accepted_at = now()
  WHERE email IN (v_email_adopt, v_email_delete);
  INSERT INTO public.profiles (id, email)
  VALUES (v_user_adopt, v_email_adopt), (v_user_delete, v_email_delete)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.memberships (organization_id, user_id, role_id, invited_by, is_active)
  VALUES
    (v_target_adopt, v_user_adopt, v_role_target_adopt, v_actor, false),
    (v_live_adopt, v_user_adopt, v_role_live_adopt, v_actor, false),
    (v_target_delete, v_user_delete, v_role_target_delete, v_actor, false),
    (v_live_delete, v_user_delete, v_role_live_delete, v_actor, false);

  v_path_adopt := v_user_adopt::TEXT || '/logo.png';
  v_path_delete := v_user_delete::TEXT || '/logo.png';
  v_key_adopt := 'https://supabase.local|' || v_path_adopt;
  v_key_delete := 'https://supabase.local|' || v_path_delete;
  INSERT INTO public.account_deletion_storage_manifests (organization_id, logo_url)
  VALUES
    (v_target_adopt, 'https://supabase.local/storage/v1/object/public/logos/' || v_path_adopt),
    (v_target_delete, 'https://supabase.local/storage/v1/object/sign/logos/' || v_path_delete || '?token=fixture');

  -- All supported public/signed/authenticated and image-render URL forms must
  -- converge on the same Storage object; query strings cannot change its key.
  FOREACH v_url IN ARRAY ARRAY[
    'https://supabase.local/storage/v1/object/public/logos/' || v_path_delete,
    'https://supabase.local/storage/v1/object/sign/logos/' || v_path_delete || '?token=one',
    'https://supabase.local/storage/v1/object/authenticated/logos/' || v_path_delete,
    'https://supabase.local/storage/v1/render/image/public/logos/' || v_path_delete || '?width=64',
    'https://supabase.local/storage/v1/render/image/sign/logos/' || v_path_delete || '?token=two',
    'https://supabase.local/storage/v1/render/image/authenticated/logos/' || v_path_delete,
    'https://supabase.local/storage/v1/object/public/%6Cogos/' || v_user_delete::TEXT || '%2Flogo%2Epng?download=1'
  ] LOOP
    IF public.account_deletion_logo_object_key(v_url) IS DISTINCT FROM v_key_delete THEN
      RAISE EXCEPTION 'Managed Storage URL variant did not normalize to %: %', v_key_delete, v_url;
    END IF;
  END LOOP;
  IF public.account_deletion_logo_object_key(
       'https://supabase.local/storage/v1/object/public/logos/' || v_user_delete::TEXT || '%252Flogo.png'
     ) IS DISTINCT FROM v_key_delete THEN
    RAISE EXCEPTION 'Repeated URL percent encoding bypassed the canonical logo key';
  END IF;
  IF public.account_deletion_logo_object_key(
       'https://other.supabase.local/storage/v1/object/public/logos/' || v_path_delete
     ) IS DISTINCT FROM 'https://other.supabase.local|' || v_path_delete THEN
    RAISE EXCEPTION 'A different Storage origin was not kept distinct from the managed project origin';
  END IF;
  IF public.account_deletion_logo_object_key('https://cdn.example.invalid/branding/logo.png') IS NOT NULL THEN
    RAISE EXCEPTION 'An unrelated external branding URL was classified as managed Storage';
  END IF;

  IF public.claim_account_deletion_identity(v_target_adopt, v_user_adopt) <> 'claimed' THEN
    RAISE EXCEPTION 'Target identity was not claimed before logo cleanup';
  END IF;
  -- Adoption wins the object lock first. The later erasure RPC must see the
  -- normalized live reference and preserve the object without a tombstone.
  UPDATE public.organizations
  SET logo_url = 'https://supabase.local/storage/v1/render/image/public/logos/'
    || v_user_adopt::TEXT || '%2Flogo.png?width=96'
  WHERE id = v_live_adopt;
  v_outcome := public.claim_account_deletion_logo_object(v_target_adopt, v_key_adopt);
  IF v_outcome <> 'preserve' THEN
    RAISE EXCEPTION 'A logo adopted by a surviving organization was not preserved: %', v_outcome;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.account_deletion_logo_object_claims WHERE object_key = v_key_adopt
  ) THEN
    RAISE EXCEPTION 'A referenced logo object received a deletion tombstone';
  END IF;

  IF public.claim_account_deletion_identity(v_target_delete, v_user_delete) <> 'claimed' THEN
    RAISE EXCEPTION 'Target identity was not claimed before logo deletion';
  END IF;
  -- Deletion wins the object lock first. The tombstone is durable protocol
  -- state written before external Storage removal; later URL spellings are blocked.
  v_outcome := public.claim_account_deletion_logo_object(v_target_delete, v_key_delete);
  IF v_outcome <> 'claimed' THEN
    RAISE EXCEPTION 'Unreferenced original manifest logo did not receive a claim: %', v_outcome;
  END IF;
  IF public.claim_account_deletion_logo_object(v_target_delete, v_key_delete) <> 'claimed' THEN
    RAISE EXCEPTION 'An idempotent logo cleanup retry lost its durable tombstone';
  END IF;

  v_blocked := false;
  BEGIN
    UPDATE public.organizations
    SET logo_url = 'https://supabase.local/storage/v1/object/authenticated/logos/'
      || v_user_delete::TEXT || '%2Flogo.png?cache=1'
    WHERE id = v_live_delete;
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'A surviving organization adopted a tombstoned logo object';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.account_deletion_logo_object_claims
    WHERE object_key = v_key_delete AND target_organization_id = v_target_delete
  ) THEN
    RAISE EXCEPTION 'A logo deletion tombstone did not remain after rejected adoption';
  END IF;

  -- Non-Storage branding and a matching path at another origin are not fenced.
  UPDATE public.organizations SET logo_url = 'https://other.supabase.local/storage/v1/object/public/logos/'
    || v_path_delete
  WHERE id = v_live_delete;
  UPDATE public.organizations SET logo_url = 'https://cdn.example.invalid/branding/logo.png'
  WHERE id = v_live_delete;

  SELECT b.public INTO v_bucket_public
  FROM storage.buckets AS b WHERE b.id = 'logos';
  IF NOT FOUND OR v_bucket_public IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Fresh schema did not create a public logos branding bucket';
  END IF;

  SELECT c.relrowsecurity INTO v_rls_enabled
  FROM pg_catalog.pg_class AS c
  WHERE c.oid = 'public.account_deletion_logo_object_claims'::regclass;
  IF NOT v_rls_enabled
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS p
       WHERE p.polrelid = 'public.account_deletion_logo_object_claims'::regclass
     ) THEN
    RAISE EXCEPTION 'Logo object claims are not private under RLS';
  END IF;
  IF has_table_privilege('service_role', 'public.account_deletion_logo_object_claims', 'SELECT')
     OR has_table_privilege('service_role', 'public.account_deletion_logo_object_claims', 'INSERT')
     OR has_table_privilege('service_role', 'public.account_deletion_logo_object_claims', 'UPDATE')
     OR has_table_privilege('service_role', 'public.account_deletion_logo_object_claims', 'DELETE') THEN
    RAISE EXCEPTION 'service_role can forge or read logo object claim rows directly';
  END IF;
  IF NOT has_function_privilege(
       'service_role', 'public.claim_account_deletion_logo_object(uuid,text)', 'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated', 'public.claim_account_deletion_logo_object(uuid,text)', 'EXECUTE'
     )
     OR has_function_privilege(
       'anon', 'public.claim_account_deletion_logo_object(uuid,text)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'Logo object claim RPC execute grants are not service-only';
  END IF;
END;
$test$;

ROLLBACK;
