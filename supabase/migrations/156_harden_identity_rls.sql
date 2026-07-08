-- ============================================================
-- 156 — Durcissement RLS des identités (correctif audit C1)
-- ------------------------------------------------------------
-- Faille : la policy memberships_update ne protège aucune colonne.
-- Le client anon Supabase étant exposé au navigateur, un membre
-- non privilégié pouvait faire, depuis la console :
--   supabase.from('memberships').update({ role_id: <owner_id> }).eq('user_id', <soi>)
-- => élévation de privilège vers owner/admin => prise de contrôle du tenant.
--
-- Correctif chirurgical : un trigger BEFORE UPDATE bloque tout changement
-- de role_id sans la permission team.edit_roles, interdit l'auto-modification
-- de son propre rôle et la promotion/rétrogradation d'un owner. Les autres
-- colonnes (labor_cost_per_hour, is_active) restent modifiables par les flux
-- applicatifs existants, qui passent déjà par leurs propres vérifications.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_membership_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_is_owner BOOLEAN;
  v_new_is_owner BOOLEAN;
BEGIN
  -- Aucun changement de rôle : rien à vérifier
  IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
    RETURN NEW;
  END IF;

  -- Permission requise pour toute modification de rôle
  IF NOT public.user_has_permission('team.edit_roles') THEN
    RAISE EXCEPTION 'Modification de rôle interdite : permission team.edit_roles requise';
  END IF;

  -- Interdiction de modifier son propre rôle (anti auto-escalade)
  IF OLD.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Modification de son propre rôle interdite';
  END IF;

  -- Interdiction de promouvoir vers owner ou de rétrograder un owner via RLS
  SELECT (slug = 'owner') INTO v_old_is_owner FROM public.roles WHERE id = OLD.role_id;
  SELECT (slug = 'owner') INTO v_new_is_owner FROM public.roles WHERE id = NEW.role_id;
  IF COALESCE(v_old_is_owner, false) OR COALESCE(v_new_is_owner, false) THEN
    RAISE EXCEPTION 'Le rôle owner ne peut pas être attribué ni modifié via cette voie';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_membership_role_change ON public.memberships;
CREATE TRIGGER trg_enforce_membership_role_change
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_membership_role_change();

REVOKE ALL ON FUNCTION public.enforce_membership_role_change() FROM PUBLIC;
