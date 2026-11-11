-- Disposable LOCAL Supabase migrated through 220. No emails/provider calls.
BEGIN;
DO $test$
DECLARE
  v_org UUID := gen_random_uuid();
  v_actor UUID := gen_random_uuid();
  v_new UUID := gen_random_uuid();
  v_existing UUID := gen_random_uuid();
  v_expired UUID := gen_random_uuid();
  v_role UUID := gen_random_uuid();
  v_invite UUID := gen_random_uuid();
  v_existing_invite UUID := gen_random_uuid();
  v_expired_invite UUID := gen_random_uuid();
  v_existing_org UUID;
  v_existing_role UUID;
  v_membership UUID;
  v_result JSONB;
  v_blocked BOOLEAN;
  v_new_email TEXT := 'new-invite-' || v_new || '@example.test';
  v_existing_email TEXT := 'existing-invite-' || v_existing || '@example.test';
  v_expired_email TEXT := 'expired-invite-' || v_expired || '@example.test';
BEGIN
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  INSERT INTO public.organizations(id,name,slug,email,sector)
  VALUES(v_org,'Invitation target','invite-target-'||v_org,'target@example.test','construction');
  INSERT INTO public.roles(id,organization_id,name,slug)
  VALUES(v_role,v_org,'Invited reader','reader');
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at)
  VALUES(v_actor,'authenticated','authenticated','inviter-'||v_actor||'@example.test',now()),
        (v_existing,'authenticated','authenticated',v_existing_email,now());
  SELECT organization_id,role_id INTO v_existing_org,v_existing_role
  FROM public.memberships WHERE user_id=v_existing AND is_active=true;
  IF v_existing_org IS NULL THEN RAISE EXCEPTION 'Existing-owner fixture was not initialized'; END IF;
  UPDATE public.profiles SET onboarding_done=false WHERE id=v_existing;
  INSERT INTO public.clients(organization_id,type,company_name,email)
  VALUES(v_existing_org,'company','Existing valuable customer','retained@example.test');
  INSERT INTO public.invitations(id,organization_id,invited_by,email,role_id,expires_at,password_setup_required)
  VALUES(v_invite,v_org,v_actor,v_new_email,v_role,now()+INTERVAL '1 day',true),
        (v_existing_invite,v_org,v_actor,v_existing_email,v_role,now()+INTERVAL '1 day',false),
        (v_expired_invite,v_org,v_actor,v_expired_email,v_role,now()-INTERVAL '1 minute',true);
  -- A new invite is registered before Auth creates the identity, as in the app.
  INSERT INTO auth.users(id,aud,role,email,email_confirmed_at)
  VALUES(v_new,'authenticated','authenticated',v_new_email,now()),
        (v_expired,'authenticated','authenticated',v_expired_email,now());

  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_existing::TEXT,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_result := public.accept_team_invitation(v_invite);
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' <> 'invalid' OR EXISTS(
    SELECT 1 FROM public.memberships WHERE user_id=v_existing AND organization_id=v_org
  ) THEN RAISE EXCEPTION 'A wrong verified email accepted the invitation'; END IF;

  EXECUTE 'SET LOCAL ROLE authenticated';
  v_result := public.accept_team_invitation(v_existing_invite);
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' <> 'already_member_elsewhere'
     OR NOT EXISTS(SELECT 1 FROM public.memberships WHERE user_id=v_existing AND organization_id=v_existing_org AND is_active=true)
     OR EXISTS(SELECT 1 FROM public.memberships WHERE user_id=v_existing AND organization_id=v_org)
     OR NOT EXISTS(SELECT 1 FROM public.clients WHERE organization_id=v_existing_org AND company_name='Existing valuable customer')
     OR EXISTS(SELECT 1 FROM public.invitations WHERE id=v_existing_invite AND accepted_at IS NOT NULL)
  THEN RAISE EXCEPTION 'An invitation silently abandoned an existing incomplete-onboarding organization'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_new::TEXT,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_result := public.accept_team_invitation(v_invite);
  IF public.user_has_permission('team.invite') THEN RAISE EXCEPTION 'An invited reader gained team invitation permission'; END IF;
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' <> 'accepted' OR v_result->>'organization_id' <> v_org::TEXT
     OR NOT EXISTS(SELECT 1 FROM public.memberships WHERE user_id=v_new AND organization_id=v_org AND role_id=v_role AND is_active=true)
     OR (SELECT count(*) FROM public.memberships WHERE user_id=v_new AND is_active=true) <> 1
     OR NOT EXISTS(SELECT 1 FROM public.invitations WHERE id=v_invite AND accepted_at IS NOT NULL)
     OR NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=v_new AND onboarding_done=true)
  THEN RAISE EXCEPTION 'The exact valid invitation failed to apply its tenant/role'; END IF;
  SELECT id INTO v_membership FROM public.memberships WHERE user_id=v_new AND organization_id=v_org;
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_result := public.accept_team_invitation(v_invite);
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' <> 'accepted'
     OR (SELECT count(*) FROM public.memberships WHERE user_id=v_new AND organization_id=v_org) <> 1
     OR NOT EXISTS(SELECT 1 FROM public.memberships WHERE id=v_membership AND role_id=v_role)
  THEN RAISE EXCEPTION 'Retrying acceptance duplicated or altered the accepted membership'; END IF;

  PERFORM set_config('request.jwt.claim.sub',v_expired::TEXT,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_result := public.accept_team_invitation(v_expired_invite);
  EXECUTE 'RESET ROLE';
  IF v_result->>'status' <> 'expired'
     OR EXISTS(SELECT 1 FROM public.memberships WHERE user_id=v_expired AND organization_id=v_org)
     OR EXISTS(SELECT 1 FROM public.invitations WHERE id=v_expired_invite AND accepted_at IS NOT NULL)
  THEN RAISE EXCEPTION 'An expired invitation changed membership authority'; END IF;

  -- SQL and application Owner wildcard semantics must agree without explicit rows.
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  DELETE FROM public.role_permissions WHERE role_id=v_existing_role;
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM set_config('request.jwt.claim.sub',v_existing::TEXT,true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  IF NOT public.user_has_permission('chantiers.manage_team') THEN RAISE EXCEPTION 'Owner wildcard was not honored by SQL'; END IF;
  EXECUTE 'RESET ROLE';

  EXECUTE 'SET LOCAL ROLE anon';
  v_blocked := false;
  BEGIN PERFORM public.accept_team_invitation(v_invite);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked THEN RAISE EXCEPTION 'Anonymous callers reached invitation acceptance'; END IF;
END;
$test$;
ROLLBACK;
