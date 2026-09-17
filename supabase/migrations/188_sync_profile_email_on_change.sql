-- ============================================================
-- 188_sync_profile_email_on_change.sql
-- Synchronise profiles.email quand auth.users.email change.
-- Jusqu'ici seul l'INSERT (handle_new_user, 006/007) était couvert :
-- un changement d'email via supabase.auth.updateUser() confirmé par
-- l'utilisateur laissait profiles.email figé sur l'ancienne adresse.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_user_email_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
    SET email = NEW.email
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_email_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.handle_user_email_change();

-- Rattrapage ponctuel des comptes déjà désynchronisés avant ce trigger.
UPDATE public.profiles p
SET email = u.email
FROM auth.users u
WHERE p.id = u.id
  AND p.email IS DISTINCT FROM u.email;
