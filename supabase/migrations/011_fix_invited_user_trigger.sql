-- ============================================================
-- 011_fix_invited_user_trigger.sql
-- Patch handle_new_user_init : ne crée pas d'org orpheline pour les
-- utilisateurs invités par email (invitation en attente dans public.invitations).
-- L'org sera assignée lors de l'acceptation (/invite/accept).
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user_init()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Si l'email a une invitation en attente et non expirée, ne pas créer d'org.
  -- L'utilisateur sera rattaché à l'org de l'invitant lors de l'acceptation.
  IF EXISTS (
    SELECT 1 FROM public.invitations
    WHERE email = NEW.email
      AND accepted_at IS NULL
      AND expires_at > now()
  ) THEN
    RETURN NEW;
  END IF;

  PERFORM public.initialize_organization_for_user(
    NEW.id,
    NEW.raw_user_meta_data->>'full_name',
    NEW.email
  );

  RETURN NEW;
END;
$$;
