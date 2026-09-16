-- Durcissement cross-tenant (2) : RPC SECURITY DEFINER acceptant un org_id
-- non revérifié. Même classe de faille que 170_cross_tenant_hardening.sql
-- (match_company_memory), trouvée sur generate_invoice_number,
-- generate_quote_number et organization_write_access_allowed lors de
-- l'audit du 2026-09-16 en amont de la mutualisation Supabase multi-clients.
--
-- 125_security_hardening_anon_revoke.sql avait révoqué EXECUTE pour `anon`
-- uniquement sur generate_invoice_number/generate_quote_number, en notant
-- explicitement "authenticated conserve ses droits inchangés" — hypothèse
-- sûre en déploiement single-tenant (l'appelant authentifié est forcément
-- de la même organisation), plus sûre du tout dès qu'une base Supabase
-- porte plusieurs organisations.
--
-- Correctif retenu : garde interne dans chaque fonction plutôt que REVOKE,
-- pour ne pas casser les appelants légitimes qui passent par un client
-- authentifié (src/lib/data/mutations/import-documents.ts:209,412) ou par
-- le trigger interne auto_set_invoice_number/auto_set_quote_number (appelé
-- avec NEW.organization_id sur un INSERT déjà filtré par RLS).

-- ─── 1. generate_invoice_number : n'agir que pour l'org de l'appelant ────────

CREATE OR REPLACE FUNCTION public.generate_invoice_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  IF org_id IS DISTINCT FROM public.get_user_org_id() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Organisation non autorisée';
  END IF;

  UPDATE public.organizations
  SET last_invoice_number = last_invoice_number + 1
  WHERE id = org_id
  RETURNING last_invoice_number, invoice_prefix INTO next_num, org_prefix;

  RETURN COALESCE(org_prefix, 'FAC') || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;

-- ─── 2. generate_quote_number : même garde ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.generate_quote_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  IF org_id IS DISTINCT FROM public.get_user_org_id() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Organisation non autorisée';
  END IF;

  UPDATE public.organizations
  SET last_quote_number = last_quote_number + 1
  WHERE id = org_id
  RETURNING last_quote_number, quote_prefix INTO next_num, org_prefix;

  RETURN COALESCE(org_prefix, 'DEV') || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;

-- ─── 3. organization_write_access_allowed : exiger l'org de l'appelant ───────
-- Fonction lecture seule (oracle d'entitlement, pas d'écriture), mais un
-- utilisateur authentifié pouvait sonder le statut d'abonnement de
-- n'importe quelle organisation en appelant la RPC directement via
-- PostgREST. Les policies RESTRICTIVE entitlement_*_guard (172) l'appellent
-- toujours avec l'organization_id de la ligne manipulée — déjà filtrée par
-- la policy permissive de base à organization_id = get_user_org_id() avant
-- que cette RESTRICTIVE ne s'exécute — donc la garde ci-dessous ne change
-- rien pour cet usage interne, seul l'appel RPC direct est fermé.
-- LANGUAGE sql → plpgsql : nécessaire pour l'instruction IF/RAISE de garde.

CREATE OR REPLACE FUNCTION public.organization_write_access_allowed(p_organization_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_organization_id IS DISTINCT FROM public.get_user_org_id() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Organisation non autorisée';
  END IF;

  RETURN NOT EXISTS (
    SELECT 1 FROM public.organization_entitlements e
    WHERE e.organization_id = p_organization_id
  ) OR EXISTS (
    SELECT 1 FROM public.organization_entitlements e
    WHERE e.organization_id = p_organization_id
      AND (
        e.access_status IN ('active', 'past_due')
        OR (e.access_status = 'trialing' AND e.trial_ends_at > now())
        OR (e.access_status = 'canceling' AND e.access_ends_at > now())
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.organization_write_access_allowed(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.organization_write_access_allowed(UUID) TO authenticated, service_role;
