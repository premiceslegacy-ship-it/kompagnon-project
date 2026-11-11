BEGIN;

-- Export audit records survive erasure, but their requester's personal email
-- must be removable by the existing organization-erasure routine.
ALTER TABLE public.organization_exports
  ALTER COLUMN requested_by_email DROP NOT NULL;

-- Stop new intake immediately when deletion is requested. Existing records
-- remain available during the cancellation period. The row lock serializes
-- this check with a concurrent deletion request, not merely a page lookup.
CREATE OR REPLACE FUNCTION public.block_quote_request_for_anonymized_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public.organizations
  WHERE id = NEW.organization_id
    AND anonymized_at IS NULL
    AND deletion_scheduled_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization is unavailable for quote requests'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.block_quote_request_for_anonymized_organization()
  FROM PUBLIC, anon, authenticated;

-- Preserve the complete, audited erasure implementation as a private helper.
-- The public service RPC below adds the missing organization-scoped individual
-- staff cleanup without reimplementing unrelated legal-retention behavior.
ALTER FUNCTION public.anonymize_organization_for_deletion(UUID)
  RENAME TO anonymize_organization_for_deletion_existing;
REVOKE ALL ON FUNCTION public.anonymize_organization_for_deletion_existing(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.anonymize_organization_for_deletion(p_org_id UUID)
RETURNS TABLE(memberships_deactivated INT, profiles_anonymized INT, clients_anonymized INT, members_anonymized INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_memberships INT := 0;
  v_profiles INT := 0;
  v_clients INT := 0;
  v_members_to_anonymize INT := 0;
  v_members INT := 0;
BEGIN
  PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT count(*)::INT
    INTO v_members_to_anonymize
  FROM public.chantier_equipe_membres AS m
  WHERE m.organization_id = p_org_id
    AND (
      m.name IS DISTINCT FROM 'Membre anonymisé'
      OR m.prenom IS NOT NULL
      OR m.email IS NOT NULL
      OR m.profile_id IS NOT NULL
    );

  SELECT r.memberships_deactivated, r.profiles_anonymized, r.clients_anonymized, r.members_anonymized
    INTO v_memberships, v_profiles, v_clients, v_members
  FROM public.anonymize_organization_for_deletion_existing(p_org_id) AS r;

  v_memberships := COALESCE(v_memberships, 0);
  v_profiles := COALESCE(v_profiles, 0);
  v_clients := COALESCE(v_clients, 0);
  v_members := COALESCE(v_members, 0);

  -- The existing routine is intentionally a no-op for organizations that are
  -- not due for erasure. On retries, anonymized_at remains set, so finish these
  -- idempotent staff-specific steps even after the original run completed.
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_org_id AND anonymized_at IS NOT NULL
  ) THEN
    RETURN QUERY SELECT v_memberships, v_profiles, v_clients, v_members;
    RETURN;
  END IF;

  -- organization_id is NOT NULL and is the canonical tenant scope for both
  -- team and individual (equipe_id IS NULL) staff rows. Clear the profile link
  -- as well as direct PII so a retained timesheet cannot identify this member.
  UPDATE public.chantier_equipe_membres AS m
  SET name = 'Membre anonymisé',
      prenom = NULL,
      email = NULL,
      profile_id = NULL
  WHERE m.organization_id = p_org_id
    AND (
      m.name IS DISTINCT FROM 'Membre anonymisé'
      OR m.prenom IS NOT NULL
      OR m.email IS NOT NULL
      OR m.profile_id IS NOT NULL
    );
  v_members := v_members_to_anonymize;

  -- Member-space links are capabilities, including those issued to standalone
  -- members without an equipe. Keep foreign-organization capabilities intact.
  DELETE FROM public.member_space_tokens AS token
  USING public.chantier_equipe_membres AS member
  WHERE token.member_id = member.id
    AND member.organization_id = p_org_id;

  RETURN QUERY SELECT v_memberships, v_profiles, v_clients, v_members;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_organization_for_deletion(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_organization_for_deletion(UUID)
  TO service_role;

COMMENT ON FUNCTION public.anonymize_organization_for_deletion(UUID) IS
  'Service-only organization erasure. Preserves existing legal/document retention behavior and additionally scrubs organization-scoped individual staff and revokes every member-space token.';

NOTIFY pgrst, 'reload schema';
COMMIT;
