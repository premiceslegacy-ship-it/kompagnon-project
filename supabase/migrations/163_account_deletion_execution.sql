-- ============================================================
-- 163 — Exécution réelle de la suppression de compte RGPD (correctif audit I15)
-- ------------------------------------------------------------
-- Constat : requestAccountDeletion() pose deletion_requested_at/deletion_scheduled_at
-- (J+30) mais rien ne les exécute jamais — la promesse RGPD (droit à l'effacement,
-- art. 17) n'est jamais tenue. Un cron quotidien (data-retention ou dédié) doit
-- appeler la fonction ci-dessous pour chaque organisation dont
-- deletion_scheduled_at <= now().
--
-- Choix de conception (conciliation RGPD / obligation fiscale) : les factures et
-- documents comptables doivent être conservés 10 ans (CGI) — on ne les supprime
-- JAMAIS, mais on anonymise les données personnelles qu'ils référencent
-- (coordonnées client) et on coupe tout accès à l'application. C'est ce que fait
-- anonymize_organization_for_deletion : anonymiser, pas purger.
-- ============================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS anonymized_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN public.organizations.anonymized_at IS
  'Date à laquelle la purge RGPD (anonymisation PII + désactivation accès) a été exécutée par le cron account-deletion. NULL tant que non traité.';

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
  -- Garde : n'anonymise que si la suppression a réellement été demandée et le
  -- délai est passé. Le cron appelant vérifie déjà cette condition, mais la
  -- fonction ne fait jamais confiance à l'appelant seul.
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

  -- 1. Désactiver tous les accès à l'application (coupe l'auth applicative ;
  --    les comptes auth.users ne sont pas supprimés ici pour ne pas casser la
  --    référence created_by/user_id des documents légaux conservés).
  UPDATE public.memberships SET is_active = false
  WHERE organization_id = p_org_id AND is_active = true;
  GET DIAGNOSTICS v_memberships = ROW_COUNT;

  -- 2. Anonymiser les profils des membres de cette organisation (PII : nom,
  --    téléphone, avatar). L'email est neutralisé mais reste unique (contrainte
  --    NOT NULL sur profiles.email) pour ne pas violer le schéma.
  UPDATE public.profiles p SET
    full_name = 'Compte supprimé',
    phone = NULL,
    avatar_url = NULL,
    job_title = NULL,
    email = 'deleted-' || p.id || '@anonymized.invalid'
  WHERE p.id IN (
    SELECT user_id FROM public.memberships WHERE organization_id = p_org_id
  ) AND p.full_name IS DISTINCT FROM 'Compte supprimé';
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  -- 3. Anonymiser les coordonnées clients — total_revenue/total_paid et les
  --    factures/devis (client_id, montants, numéros) restent intacts pour
  --    l'obligation de conservation fiscale 10 ans.
  UPDATE public.clients SET
    company_name = CASE WHEN company_name IS NOT NULL THEN 'Client anonymisé' ELSE NULL END,
    first_name = CASE WHEN first_name IS NOT NULL THEN 'Anonyme' ELSE NULL END,
    last_name = NULL,
    email = NULL,
    phone = NULL,
    mobile = NULL,
    address_line1 = NULL,
    address_line2 = NULL,
    notes = NULL
  WHERE organization_id = p_org_id
    AND company_name IS DISTINCT FROM 'Client anonymisé';
  GET DIAGNOSTICS v_clients = ROW_COUNT;

  -- 4. Anonymiser les membres d'équipe terrain (chantier_equipe_membres) —
  --    les pointages (chantier_pointages) référencent member_id/user_id et
  --    restent intacts (traçabilité heures travaillées).
  UPDATE public.chantier_equipe_membres m SET
    name = 'Membre anonymisé',
    prenom = NULL,
    email = NULL
  WHERE m.equipe_id IN (
    SELECT id FROM public.chantier_equipes WHERE organization_id = p_org_id
  ) AND m.name IS DISTINCT FROM 'Membre anonymisé';
  GET DIAGNOSTICS v_members = ROW_COUNT;

  -- 5. Marquer l'organisation comme traitée.
  UPDATE public.organizations SET anonymized_at = now() WHERE id = p_org_id;

  RETURN QUERY SELECT v_memberships, v_profiles, v_clients, v_members;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_organization_for_deletion(UUID) FROM PUBLIC;
