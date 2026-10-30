-- ============================================================
-- 195 — Correctifs de la revue de sécurité du lot 193 (26/10/2026)
-- ------------------------------------------------------------
-- 1. `joinViaCode` était cassé : le trigger 156 exige `team.edit_roles` dès
--    qu'on touche `role_id`, y compris pour le client admin. `SECURITY DEFINER`
--    ne change pas les claims JWT, donc `user_has_permission()` est faux et
--    l'UPDATE lève. Le bon critère est le rôle de session, pas `auth.uid()`.
-- 2. Les colonnes de cycle de vie de paiement étaient modifiables par toute
--    permission d'édition de facture. Un collaborateur sans
--    `invoices.record_payment` pouvait marquer une facture payée.
-- 3. Le rollback `sending -> draft` utilisé par le cron récurrent était refusé
--    par le gel de 193 : la facture restait bloquée en `sending` à vie.
-- ============================================================

-- ─── 1. Trigger de rôle : bypass serveur explicite ─────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_membership_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.role_id IS NOT DISTINCT FROM OLD.role_id THEN
    RETURN NEW;
  END IF;

  -- service_role : joinViaCode, /invite/accept et les Server Actions ont déjà
  -- vérifié leurs permissions côté serveur.
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NOT public.user_has_permission('team.edit_roles') THEN
    RAISE EXCEPTION 'Modification de rôle interdite : permission team.edit_roles requise';
  END IF;

  IF OLD.user_id = auth.uid() THEN
    RAISE EXCEPTION 'Modification de son propre rôle interdite';
  END IF;

  RETURN NEW;
END;
$$;

-- Même critère dans le trigger de 193 : `auth.uid()` NULL ne suffit pas,
-- il est aussi NULL pour un rôle anonyme non connecté.
CREATE OR REPLACE FUNCTION public.enforce_membership_sensitive_cols()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_owner BOOLEAN;
  v_role_ok  BOOLEAN;
BEGIN
  IF auth.role() = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id d''un membership immuable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id d''un membership immuable';
  END IF;

  SELECT (r.slug = 'owner'), (r.organization_id = NEW.organization_id)
    INTO v_is_owner, v_role_ok
  FROM public.roles r WHERE r.id = NEW.role_id;
  IF NOT COALESCE(v_role_ok, false) THEN
    RAISE EXCEPTION 'Le rôle doit appartenir à la même organisation';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NOT (public.user_has_permission('team.remove_members')
            OR public.user_has_permission('team.manage')) THEN
      RAISE EXCEPTION 'team.remove_members requis pour activer/désactiver un membre';
    END IF;
    SELECT (slug = 'owner') INTO v_is_owner FROM public.roles WHERE id = OLD.role_id;
    IF COALESCE(v_is_owner, false) THEN
      RAISE EXCEPTION 'Le membership du dirigeant ne peut pas être désactivé';
    END IF;
  END IF;

  IF NEW.labor_cost_per_hour IS DISTINCT FROM OLD.labor_cost_per_hour
     AND NOT (public.user_has_permission('team.manage')
              OR public.user_has_permission('team.edit_roles')) THEN
    RAISE EXCEPTION 'Coût horaire modifiable uniquement par un administrateur';
  END IF;

  RETURN NEW;
END;
$$;

-- ─── 2. Transitions de facture gatées par permission ───────────────────────
-- Le gel de 193 laisse libres `status`, `total_paid`, `paid_at` et les champs
-- `pa_*`. Il faut donc vérifier *qui* les écrit :
--  - enregistrer un paiement exige invoices.record_payment ;
--  - les champs de transmission e-facturation sont pilotés par le serveur ;
--  - `sending` est une revendication de job, réversible par le serveur seul.
CREATE OR REPLACE FUNCTION public.enforce_invoice_lifecycle_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_server BOOLEAN := auth.role() = 'service_role';
BEGIN
  IF OLD.status = 'draft' THEN
    RETURN NEW; -- un brouillon se modifie librement
  END IF;

  -- Revendication / relâchement par les jobs (récurrent, envoi).
  IF NOT v_server AND (
       NEW.status IN ('sending', 'draft')
       OR (OLD.status = 'sending' AND NEW.status IN ('sent', 'draft'))
     ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.total_paid IS DISTINCT FROM OLD.total_paid
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
  THEN
    IF NOT v_server AND NOT public.user_has_permission('invoices.record_payment') THEN
      RAISE EXCEPTION 'invoices.record_payment requis pour modifier paiement ou statut';
    END IF;
  END IF;

  IF NOT v_server AND (
       NEW.pa_status IS DISTINCT FROM OLD.pa_status
       OR NEW.pa_message_id IS DISTINCT FROM OLD.pa_message_id
       OR NEW.facturx_xml IS DISTINCT FROM OLD.facturx_xml
     )
     AND NOT public.user_has_permission('einvoicing.configure')
  THEN
    RAISE EXCEPTION 'einvoicing.configure requis pour modifier le statut e-facturation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoice_lifecycle_permissions ON public.invoices;
CREATE TRIGGER trg_enforce_invoice_lifecycle_permissions
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invoice_lifecycle_permissions();

REVOKE ALL ON FUNCTION public.enforce_invoice_lifecycle_permissions() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_membership_role_change() FROM PUBLIC;

-- ─── 3. Réconciliation des réservations de quota orphelines ────────────────
-- `settleUsageLog` peut échouer (réseau) : la ligne reste `reserved` et bloque
-- le quota jusqu'au mois suivant. Une réservation non close après 30 minutes
-- est un appel interrompu, pas une consommation en vol.
CREATE OR REPLACE FUNCTION public.expire_stale_quota_reservations(p_older_than interval DEFAULT '30 minutes')
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.usage_logs
  SET status = 'error'
  WHERE status = 'reserved'
    AND created_at < now() - p_older_than;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.expire_stale_quota_reservations(interval)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_quota_reservations(interval) TO service_role;

-- ─── 4. `sending` est un état de job, réversible par le serveur ────────────
-- Le gel de 193 refuse `NEW.status = 'draft'` dès que `OLD.status <> 'draft'`.
-- Une facture revendiquée `sending` puis dont l'envoi échoue restait donc
-- bloquée définitivement. Le retour en brouillon n'est autorisé que depuis
-- `sending`, et seulement pour le serveur.
CREATE OR REPLACE FUNCTION public.enforce_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mutable TEXT[] := ARRAY[
    'status', 'total_paid', 'paid_at', 'sent_at', 'viewed_at', 'pdf_url',
    'pa_message_id', 'pa_status', 'pa_status_updated_at', 'pa_rejection_reason',
    'is_archived', 'updated_at', 'balance_due_date', 'facturx_xml'
  ];
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.status = 'draft' THEN
      IF OLD.status = 'sending' AND auth.role() = 'service_role' THEN
        RETURN NEW; -- relâchement de revendication après échec d'envoi
      END IF;
      RAISE EXCEPTION 'Facture émise : le retour en brouillon est interdit';
    END IF;
    IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
      RAISE EXCEPTION 'Facture émise immuable (statut %) : corriger par un avoir', OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invoice_immutability() FROM PUBLIC;
