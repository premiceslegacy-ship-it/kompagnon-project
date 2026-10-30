BEGIN;

-- A claim is durable across retries and serializes all active-membership writes
-- for one Auth identity until Auth deletion cascades the row away.
CREATE TABLE public.account_deletion_identity_claims (
  auth_user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  target_organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.account_deletion_identity_claims IS
  'Private durable account-erasure claims; Auth deletion removes the claim through ON DELETE CASCADE.';
ALTER TABLE public.account_deletion_identity_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_identity_claims FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_identity(
  p_org_id UUID,
  p_user_id UUID
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_auth_user_id UUID;
  v_target_anonymized_at TIMESTAMPTZ;
  v_cleanup_completed_at TIMESTAMPTZ;
  v_claimed_org_id UUID;
BEGIN
  IF NOT COALESCE(auth.role() = 'service_role', false) THEN
    RAISE EXCEPTION 'Action réservée au serveur' USING ERRCODE = '42501';
  END IF;

  -- Every activation takes this same row lock before it can inspect claims.
  -- Auth deletion also serializes on the row through its FK/cascade work.
  SELECT u.id INTO v_auth_user_id
  FROM auth.users AS u
  WHERE u.id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'absent';
  END IF;

  SELECT o.anonymized_at, o.deletion_cleanup_completed_at
    INTO v_target_anonymized_at, v_cleanup_completed_at
  FROM public.organizations AS o
  WHERE o.id = p_org_id;
  IF NOT FOUND OR v_target_anonymized_at IS NULL OR v_cleanup_completed_at IS NOT NULL THEN
    RETURN 'ineligible';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.memberships AS m
    WHERE m.organization_id = p_org_id AND m.user_id = p_user_id
  ) THEN
    RETURN 'ineligible';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.memberships AS m
    JOIN public.organizations AS o ON o.id = m.organization_id
    WHERE m.user_id = p_user_id
      AND m.organization_id <> p_org_id
      AND m.is_active = true
      AND o.anonymized_at IS NULL
  ) THEN
    RETURN 'preserve';
  END IF;

  SELECT c.target_organization_id INTO v_claimed_org_id
  FROM public.account_deletion_identity_claims AS c
  WHERE c.auth_user_id = p_user_id;
  IF FOUND THEN
    IF v_claimed_org_id = p_org_id THEN
      RETURN 'claimed';
    END IF;
    RETURN 'ineligible';
  END IF;

  INSERT INTO public.account_deletion_identity_claims (auth_user_id, target_organization_id)
  VALUES (p_user_id, p_org_id);
  RETURN 'claimed';
END;
$$;
REVOKE ALL ON FUNCTION public.claim_account_deletion_identity(UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_account_deletion_identity(UUID, UUID)
  TO service_role;
COMMENT ON FUNCTION public.claim_account_deletion_identity(UUID, UUID) IS
  'Service-only. Returns claimed (durable same-target claim), preserve (active membership in another live organization), absent (no Auth row), or ineligible (target/state/claim mismatch).';


CREATE OR REPLACE FUNCTION public.guard_active_membership_for_erasure_claim()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
  IF NEW.is_active IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND NEW.user_id IS NOT DISTINCT FROM OLD.user_id
     AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active THEN
    RETURN NEW;
  END IF;

  -- Lock before checking the claim. Claim creation locks this same Auth row,
  -- so exactly one ordering wins: membership first (claim preserves), or claim
  -- first (membership activation is rejected before access is granted).
  PERFORM 1 FROM auth.users AS u WHERE u.id = NEW.user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot activate membership for an absent Auth identity'
      USING ERRCODE = '23503';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.account_deletion_identity_claims AS c
    WHERE c.auth_user_id = NEW.user_id
  ) THEN
    RAISE EXCEPTION 'Cannot activate membership for an identity claimed for erasure'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_active_membership_for_erasure_claim()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_guard_active_membership_for_erasure_claim ON public.memberships;
CREATE TRIGGER trg_guard_active_membership_for_erasure_claim
  BEFORE INSERT OR UPDATE OF user_id, is_active ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_active_membership_for_erasure_claim();

COMMIT;
