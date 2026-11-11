-- 220 — Keep app permissions and SQL authority aligned; bind invitations to one
-- exact, expiring invitation and restrict team assignment writes at the database.

BEGIN;

ALTER TABLE public.invitations
  ADD COLUMN IF NOT EXISTS password_setup_required BOOLEAN NOT NULL DEFAULT TRUE;

CREATE OR REPLACE FUNCTION public.user_has_permission(perm_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.memberships AS m
    JOIN public.roles AS r
      ON r.id = m.role_id
     AND r.organization_id = m.organization_id
    WHERE m.user_id = auth.uid()
      AND m.is_active = true
      AND m.organization_id = public.get_user_org_id()
      AND (
        r.slug = 'owner'
        OR EXISTS (
          SELECT 1
          FROM public.role_permissions AS rp
          WHERE rp.role_id = r.id
            AND rp.permission_key = perm_key
            AND rp.is_allowed = true
        )
      )
  );
$function$;

REVOKE ALL ON FUNCTION public.user_has_permission(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_permission(TEXT) TO anon, authenticated, service_role;

-- Keep direct invitation inserts equivalent to the server action: the target
-- role must belong to this organization, exclude owner, and grant no new rights.
DROP POLICY IF EXISTS "invitations_insert" ON public.invitations;
CREATE POLICY "invitations_insert"
  ON public.invitations FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('team.invite')
    AND EXISTS (
      SELECT 1
      FROM public.roles AS target_role
      WHERE target_role.id = public.invitations.role_id
        AND target_role.organization_id = public.invitations.organization_id
        AND target_role.slug <> 'owner'
        AND target_role.is_active = true
        AND NOT EXISTS (
          SELECT 1
          FROM public.role_permissions AS rp
          WHERE rp.role_id = target_role.id
            AND rp.is_allowed = true
            AND NOT public.user_has_permission(rp.permission_key)
        )
    )
  );

-- Authenticated membership updates are limited to the three server-supported
-- fields; field-level checks keep role editing, removal and labor-cost access
-- distinct even when a caller has only one of those permissions.
CREATE OR REPLACE FUNCTION public.guard_membership_client_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_old_role_slug TEXT;
  v_new_role_slug TEXT;
BEGIN
  IF auth.role() = 'service_role'
     OR current_setting('app.accepting_team_invitation', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authenticated membership update required';
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at THEN
    RAISE EXCEPTION 'Membership identity fields are immutable';
  END IF;

  IF NEW.role_id IS DISTINCT FROM OLD.role_id THEN
    IF NOT public.user_has_permission('team.edit_roles') OR OLD.user_id = auth.uid() THEN
      RAISE EXCEPTION 'Role change is not authorized';
    END IF;

    SELECT r.slug INTO v_old_role_slug
    FROM public.roles AS r
    WHERE r.id = OLD.role_id
      AND r.organization_id = OLD.organization_id;

    SELECT r.slug INTO v_new_role_slug
    FROM public.roles AS r
    WHERE r.id = NEW.role_id
      AND r.organization_id = NEW.organization_id
      AND r.is_active = true;

    IF v_old_role_slug = 'owner' OR v_new_role_slug IS NULL OR v_new_role_slug = 'owner' THEN
      RAISE EXCEPTION 'Owner roles cannot be changed or assigned';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.role_permissions AS rp
      WHERE rp.role_id = NEW.role_id
        AND rp.is_allowed = true
        AND NOT public.user_has_permission(rp.permission_key)
    ) THEN
      RAISE EXCEPTION 'Target role exceeds caller permissions';
    END IF;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NEW.is_active IS DISTINCT FROM false
       OR NOT public.user_has_permission('team.remove_members')
       OR OLD.user_id = auth.uid()
       OR NOT EXISTS (
         SELECT 1
         FROM public.memberships AS actor
         JOIN public.roles AS actor_role
           ON actor_role.id = actor.role_id
          AND actor_role.organization_id = actor.organization_id
         WHERE actor.user_id = auth.uid()
           AND actor.organization_id = OLD.organization_id
           AND actor.is_active = true
           AND actor_role.slug IN ('owner', 'admin')
       ) THEN
      RAISE EXCEPTION 'Membership removal is not authorized';
    END IF;
    SELECT r.slug INTO v_old_role_slug
    FROM public.roles AS r
    WHERE r.id = OLD.role_id
      AND r.organization_id = OLD.organization_id;
    IF v_old_role_slug = 'owner' THEN
      RAISE EXCEPTION 'Owner membership cannot be removed';
    END IF;
  END IF;

  IF NEW.labor_cost_per_hour IS DISTINCT FROM OLD.labor_cost_per_hour
     AND NOT EXISTS (
       SELECT 1
       FROM public.memberships AS actor
       JOIN public.roles AS actor_role
         ON actor_role.id = actor.role_id
        AND actor_role.organization_id = actor.organization_id
       WHERE actor.user_id = auth.uid()
         AND actor.organization_id = OLD.organization_id
         AND actor.is_active = true
         AND actor_role.slug IN ('owner', 'admin')
     ) THEN
    RAISE EXCEPTION 'Labor costs are restricted to administrators';
  END IF;

  IF (to_jsonb(NEW) - ARRAY['updated_at', 'role_id', 'is_active', 'labor_cost_per_hour'])
     IS DISTINCT FROM
     (to_jsonb(OLD) - ARRAY['updated_at', 'role_id', 'is_active', 'labor_cost_per_hour']) THEN
    RAISE EXCEPTION 'Unsupported membership field update';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.guard_membership_client_update() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS guard_membership_client_update ON public.memberships;
CREATE TRIGGER guard_membership_client_update
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_membership_client_update();

DROP POLICY IF EXISTS "memberships_update" ON public.memberships;
CREATE POLICY "memberships_update"
  ON public.memberships FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('team.edit_roles')
      OR EXISTS (
        SELECT 1
        FROM public.memberships AS actor
        JOIN public.roles AS actor_role
          ON actor_role.id = actor.role_id
         AND actor_role.organization_id = actor.organization_id
        WHERE actor.user_id = auth.uid()
          AND actor.organization_id = public.get_user_org_id()
          AND actor.is_active = true
          AND actor_role.slug IN ('owner', 'admin')
      )
    )
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('team.edit_roles')
      OR EXISTS (
        SELECT 1
        FROM public.memberships AS actor
        JOIN public.roles AS actor_role
          ON actor_role.id = actor.role_id
         AND actor_role.organization_id = actor.organization_id
        WHERE actor.user_id = auth.uid()
          AND actor.organization_id = public.get_user_org_id()
          AND actor.is_active = true
          AND actor_role.slug IN ('owner', 'admin')
      )
    )
  );

-- Team lifecycle tables use the same manage-team permission as their Server
-- Actions, rather than the broader chantier-edit permission.
DROP POLICY IF EXISTS "chantier_equipes_insert" ON public.chantier_equipes;
CREATE POLICY "chantier_equipes_insert"
  ON public.chantier_equipes FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.manage_team')
  );

DROP POLICY IF EXISTS "chantier_equipes_update" ON public.chantier_equipes;
CREATE POLICY "chantier_equipes_update"
  ON public.chantier_equipes FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.manage_team')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.manage_team')
  );

DROP POLICY IF EXISTS "chantier_equipes_delete" ON public.chantier_equipes;
CREATE POLICY "chantier_equipes_delete"
  ON public.chantier_equipes FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.manage_team')
  );

DROP POLICY IF EXISTS "chantier_equipe_membres_all" ON public.chantier_equipe_membres;
CREATE POLICY "chantier_equipe_membres_select"
  ON public.chantier_equipe_membres FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());
CREATE POLICY "chantier_equipe_membres_insert"
  ON public.chantier_equipe_membres FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.manage_team')
    AND (
      equipe_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.chantier_equipes AS e
        WHERE e.id = chantier_equipe_membres.equipe_id
          AND e.organization_id = chantier_equipe_membres.organization_id
      )
    )
    AND (
      profile_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.memberships AS m
        WHERE m.user_id = chantier_equipe_membres.profile_id
          AND m.organization_id = chantier_equipe_membres.organization_id
          AND m.is_active = true
      )
    )
  );
CREATE POLICY "chantier_equipe_membres_update"
  ON public.chantier_equipe_membres FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.manage_team')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.manage_team')
    AND (
      equipe_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.chantier_equipes AS e
        WHERE e.id = chantier_equipe_membres.equipe_id
          AND e.organization_id = chantier_equipe_membres.organization_id
      )
    )
    AND (
      profile_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.memberships AS m
        WHERE m.user_id = chantier_equipe_membres.profile_id
          AND m.organization_id = chantier_equipe_membres.organization_id
          AND m.is_active = true
      )
    )
  );
CREATE POLICY "chantier_equipe_membres_delete"
  ON public.chantier_equipe_membres FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.manage_team')
  );

DROP POLICY IF EXISTS "chantier_equipe_chantiers_all" ON public.chantier_equipe_chantiers;
CREATE POLICY "chantier_equipe_chantiers_select"
  ON public.chantier_equipe_chantiers FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipes AS e ON e.id = chantier_equipe_chantiers.equipe_id
      WHERE c.id = chantier_equipe_chantiers.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND e.organization_id = c.organization_id
    )
  );
CREATE POLICY "chantier_equipe_chantiers_insert"
  ON public.chantier_equipe_chantiers FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission('chantiers.manage_team')
    AND EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipes AS e ON e.id = chantier_equipe_chantiers.equipe_id
      WHERE c.id = chantier_equipe_chantiers.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND e.organization_id = c.organization_id
    )
  );
CREATE POLICY "chantier_equipe_chantiers_update"
  ON public.chantier_equipe_chantiers FOR UPDATE TO authenticated
  USING (
    public.user_has_permission('chantiers.manage_team')
    AND EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipes AS e ON e.id = chantier_equipe_chantiers.equipe_id
      WHERE c.id = chantier_equipe_chantiers.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND e.organization_id = c.organization_id
    )
  )
  WITH CHECK (
    public.user_has_permission('chantiers.manage_team')
    AND EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipes AS e ON e.id = chantier_equipe_chantiers.equipe_id
      WHERE c.id = chantier_equipe_chantiers.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND e.organization_id = c.organization_id
    )
  );
CREATE POLICY "chantier_equipe_chantiers_delete"
  ON public.chantier_equipe_chantiers FOR DELETE TO authenticated
  USING (
    public.user_has_permission('chantiers.manage_team')
    AND EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipes AS e ON e.id = chantier_equipe_chantiers.equipe_id
      WHERE c.id = chantier_equipe_chantiers.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND e.organization_id = c.organization_id
    )
  );

DROP POLICY IF EXISTS "chantier_individual_members_all" ON public.chantier_individual_members;
CREATE POLICY "chantier_individual_members_select"
  ON public.chantier_individual_members FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipe_membres AS m ON m.id = chantier_individual_members.member_id
      WHERE c.id = chantier_individual_members.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND m.organization_id = c.organization_id
    )
  );
CREATE POLICY "chantier_individual_members_insert"
  ON public.chantier_individual_members FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_permission('chantiers.manage_team')
    AND EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipe_membres AS m ON m.id = chantier_individual_members.member_id
      WHERE c.id = chantier_individual_members.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND m.organization_id = c.organization_id
    )
  );
CREATE POLICY "chantier_individual_members_update"
  ON public.chantier_individual_members FOR UPDATE TO authenticated
  USING (
    public.user_has_permission('chantiers.manage_team')
    AND EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipe_membres AS m ON m.id = chantier_individual_members.member_id
      WHERE c.id = chantier_individual_members.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND m.organization_id = c.organization_id
    )
  )
  WITH CHECK (
    public.user_has_permission('chantiers.manage_team')
    AND EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipe_membres AS m ON m.id = chantier_individual_members.member_id
      WHERE c.id = chantier_individual_members.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND m.organization_id = c.organization_id
    )
  );
CREATE POLICY "chantier_individual_members_delete"
  ON public.chantier_individual_members FOR DELETE TO authenticated
  USING (
    public.user_has_permission('chantiers.manage_team')
    AND EXISTS (
      SELECT 1
      FROM public.chantiers AS c
      JOIN public.chantier_equipe_membres AS m ON m.id = chantier_individual_members.member_id
      WHERE c.id = chantier_individual_members.chantier_id
        AND c.organization_id = public.get_user_org_id()
        AND m.organization_id = c.organization_id
    )
  );

CREATE OR REPLACE FUNCTION public.accept_team_invitation(p_invitation_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_email_confirmed_at TIMESTAMPTZ;
  v_invitation public.invitations%ROWTYPE;
  v_role_slug TEXT;
  v_active_count INTEGER;
  v_active_org_id UUID;
  v_active_role_slug TEXT;
  v_target_membership_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object('status', 'unauthenticated');
  END IF;

  SELECT u.email, u.email_confirmed_at
  INTO v_email, v_email_confirmed_at
  FROM auth.users AS u
  WHERE u.id = v_user_id;

  IF v_email IS NULL OR v_email_confirmed_at IS NULL THEN
    RETURN jsonb_build_object('status', 'email_not_verified');
  END IF;

  -- Serialize all invitation acceptances for this user across tenants.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_user_id::TEXT, 0)
  );

  SELECT i.* INTO v_invitation
  FROM public.invitations AS i
  WHERE i.id = p_invitation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF lower(btrim(v_invitation.email)) IS DISTINCT FROM lower(btrim(v_email)) THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_invitation.accepted_at IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.memberships AS m
      WHERE m.user_id = v_user_id
        AND m.organization_id = v_invitation.organization_id
        AND m.role_id = v_invitation.role_id
        AND m.is_active = true
    ) THEN
      RETURN jsonb_build_object(
        'status', 'accepted',
        'organization_id', v_invitation.organization_id,
        'password_setup_required', v_invitation.password_setup_required
      );
    END IF;
    RETURN jsonb_build_object('status', 'already_used');
  END IF;

  IF v_invitation.expires_at IS NULL OR v_invitation.expires_at <= transaction_timestamp() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  SELECT r.slug INTO v_role_slug
  FROM public.roles AS r
  WHERE r.id = v_invitation.role_id
    AND r.organization_id = v_invitation.organization_id
    AND r.is_active = true;

  IF v_role_slug IS NULL OR v_role_slug = 'owner' THEN
    RETURN jsonb_build_object('status', 'invalid_role');
  END IF;

  PERFORM 1
  FROM public.memberships AS m
  WHERE m.user_id = v_user_id
    AND m.is_active = true
  FOR UPDATE;

  SELECT count(*) INTO v_active_count
  FROM public.memberships AS m
  WHERE m.user_id = v_user_id
    AND m.is_active = true;

  IF v_active_count > 1 THEN
    RETURN jsonb_build_object('status', 'membership_conflict');
  END IF;

  IF v_active_count = 1 THEN
    SELECT m.organization_id, r.slug
    INTO v_active_org_id, v_active_role_slug
    FROM public.memberships AS m
    JOIN public.roles AS r
      ON r.id = m.role_id
     AND r.organization_id = m.organization_id
    WHERE m.user_id = v_user_id
      AND m.is_active = true
    LIMIT 1;
    IF v_active_org_id = v_invitation.organization_id
       AND v_active_role_slug = 'owner' THEN
      UPDATE public.invitations
      SET accepted_at = transaction_timestamp()
      WHERE id = v_invitation.id
        AND accepted_at IS NULL;
      RETURN jsonb_build_object('status', 'already_member');
    END IF;


    -- Joining another tenant is not permission to abandon an existing one,
    -- even when onboarding is incomplete. No membership is silently moved.
    IF v_active_org_id <> v_invitation.organization_id THEN
      RETURN jsonb_build_object('status', 'already_member_elsewhere');
    END IF;
  END IF;

  SELECT m.id INTO v_target_membership_id
  FROM public.memberships AS m
  WHERE m.user_id = v_user_id
    AND m.organization_id = v_invitation.organization_id
  FOR UPDATE;

  PERFORM set_config('app.accepting_team_invitation', 'on', true);
  IF v_target_membership_id IS NULL THEN
    INSERT INTO public.memberships (
      organization_id, user_id, role_id, invited_by, accepted_at, is_active
    ) VALUES (
      v_invitation.organization_id,
      v_user_id,
      v_invitation.role_id,
      v_invitation.invited_by,
      transaction_timestamp(),
      true
    );
  ELSE
    UPDATE public.memberships
    SET role_id = v_invitation.role_id,
        invited_by = v_invitation.invited_by,
        accepted_at = coalesce(accepted_at, transaction_timestamp()),
        is_active = true
    WHERE id = v_target_membership_id
      AND user_id = v_user_id
      AND organization_id = v_invitation.organization_id;
  END IF;
  UPDATE public.invitations
  SET accepted_at = transaction_timestamp()
  WHERE id = v_invitation.id
    AND accepted_at IS NULL;
  UPDATE public.profiles
  SET onboarding_done = true
  WHERE id = v_user_id;
  PERFORM set_config('app.accepting_team_invitation', 'off', true);

  RETURN jsonb_build_object(
    'status', 'accepted',
    'organization_id', v_invitation.organization_id,
    'password_setup_required', v_invitation.password_setup_required
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.accept_team_invitation(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.accept_team_invitation(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
