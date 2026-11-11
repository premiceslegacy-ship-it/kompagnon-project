BEGIN;

-- A transaction-local, non-client-writable capability lets this exact RPC
-- cancel a draft using invoices.edit without widening direct invoice DML.
CREATE TABLE public.recurring_invoice_skip_authorizations (
  backend_pid INTEGER NOT NULL,
  transaction_id BIGINT NOT NULL,
  user_id UUID NOT NULL,
  invoice_id UUID NOT NULL,
  PRIMARY KEY (backend_pid, transaction_id, user_id, invoice_id)
);
ALTER TABLE public.recurring_invoice_skip_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.recurring_invoice_skip_authorizations
  FROM PUBLIC, anon, authenticated, service_role;

-- Preserve the existing invoice lifecycle rules while allowing the narrowly
-- scoped recurring-skip operation to cancel its locked draft with invoices.edit.
CREATE OR REPLACE FUNCTION public.enforce_invoice_lifecycle_permissions()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF COALESCE(auth.role() = 'service_role', false) THEN
    RETURN NEW;
  END IF;
  -- The state `sending` is a job claim, not a payment shortcut: no user identity
  -- may claim it or close it.
  IF (NEW.status = 'sending' OR OLD.status = 'sending')
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'La transition sending est réservée au serveur';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF OLD.status = 'draft' AND NEW.status = 'sent' THEN
      IF NOT public.user_has_permission('invoices.send') THEN
        RAISE EXCEPTION 'invoices.send requis pour émettre une facture';
      END IF;
    ELSIF NEW.status = 'cancelled' THEN
      IF NOT (
        public.user_has_permission('invoices.delete')
        OR public.user_has_permission('invoices.record_payment')
        OR (
          OLD.status = 'draft'
          AND NEW.is_archived IS TRUE
          AND public.user_has_permission('invoices.edit')
          AND EXISTS (
            SELECT 1
            FROM public.recurring_invoice_skip_authorizations AS skip_auth
            WHERE skip_auth.backend_pid = pg_catalog.pg_backend_pid()
              AND skip_auth.transaction_id = pg_catalog.txid_current()
              AND skip_auth.user_id = auth.uid()
              AND skip_auth.invoice_id = OLD.id
          )
        )
      ) THEN
        RAISE EXCEPTION 'invoices.delete requis pour annuler une facture';
      END IF;
    ELSIF NOT public.user_has_permission('invoices.record_payment') THEN
      RAISE EXCEPTION 'invoices.record_payment requis pour modifier le statut';
    END IF;
  END IF;

  IF (NEW.total_paid IS DISTINCT FROM OLD.total_paid
      OR NEW.paid_at IS DISTINCT FROM OLD.paid_at)
     AND NOT public.user_has_permission('invoices.record_payment') THEN
    RAISE EXCEPTION 'invoices.record_payment requis pour modifier un paiement';
  END IF;

  IF (NEW.pa_status IS DISTINCT FROM OLD.pa_status
      OR NEW.pa_message_id IS DISTINCT FROM OLD.pa_message_id
      OR NEW.facturx_xml IS DISTINCT FROM OLD.facturx_xml)
     AND NOT public.user_has_permission('einvoicing.configure') THEN
    RAISE EXCEPTION 'einvoicing.configure requis pour modifier le statut e-facturation';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.skip_recurring_invoice_occurrence(p_schedule_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id UUID;
  v_active_membership_count BIGINT;
  v_organization_id UUID;
  v_role_id UUID;
  v_invoice_id UUID;
  v_locked_invoice_id UUID;
  v_invoice_status TEXT;
  v_schedule_status TEXT;
  v_row_count BIGINT;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL OR auth.role() IS DISTINCT FROM 'authenticated' THEN
    RAISE EXCEPTION 'Non authentifié.' USING ERRCODE = '42501';
  END IF;

  -- Match the app's single-current-membership contract and fail closed on
  -- ambiguous or inactive membership state.
  SELECT count(*), (array_agg(m.organization_id ORDER BY m.created_at, m.id))[1]
  INTO v_active_membership_count, v_organization_id
  FROM public.memberships AS m
  WHERE m.user_id = v_user_id
    AND m.is_active IS TRUE;

  IF v_active_membership_count <> 1 OR v_organization_id IS NULL THEN
    RAISE EXCEPTION 'Organisation active introuvable.' USING ERRCODE = '42501';
  END IF;

  -- Match the organization-first lock order used by account erasure, then
  -- stabilize this user's current membership and its exact role.
  PERFORM 1
  FROM public.organizations AS o
  WHERE o.id = v_organization_id
    AND o.anonymized_at IS NULL
    AND o.deletion_scheduled_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation indisponible.' USING ERRCODE = '42501';
  END IF;

  SELECT m.role_id
  INTO v_role_id
  FROM public.memberships AS m
  JOIN public.roles AS r
    ON r.id = m.role_id
   AND r.organization_id = m.organization_id
  WHERE m.user_id = v_user_id
    AND m.organization_id = v_organization_id
    AND m.is_active IS TRUE
  FOR SHARE OF m;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Appartenance active introuvable.' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.roles AS r
    WHERE r.id = v_role_id
      AND r.organization_id = v_organization_id
      AND (
        r.slug = 'owner'
        OR EXISTS (
          SELECT 1
          FROM public.role_permissions AS rp
          WHERE rp.role_id = r.id
            AND rp.permission_key = 'invoices.edit'
            AND rp.is_allowed IS TRUE
        )
      )
  ) THEN
    RAISE EXCEPTION 'Permission invoices.edit requise.' USING ERRCODE = '42501';
  END IF;

  -- Read the link first, then lock the invoice before the occurrence. The cron
  -- claims an invoice row as `sending` before it sends mail and closes the
  -- schedule later; this shared invoice lock serializes the two transitions
  -- without taking the occurrence lock ahead of the cron's invoice lock.
  SELECT s.invoice_id
  INTO v_invoice_id
  FROM public.invoice_schedules AS s
  WHERE s.id = p_schedule_id
    AND s.organization_id = v_organization_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Occurrence récurrente introuvable dans l’organisation active.' USING ERRCODE = 'P0002';
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    SELECT i.status
    INTO v_invoice_status
    FROM public.invoices AS i
    WHERE i.id = v_invoice_id
      AND i.organization_id = v_organization_id
    FOR UPDATE OF i;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Facture liée indisponible dans l’organisation active.' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  SELECT s.status, s.invoice_id
  INTO v_schedule_status, v_locked_invoice_id
  FROM public.invoice_schedules AS s
  WHERE s.id = p_schedule_id
    AND s.organization_id = v_organization_id
  FOR UPDATE OF s;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Occurrence récurrente introuvable dans l’organisation active.' USING ERRCODE = 'P0002';
  END IF;
  IF v_locked_invoice_id IS DISTINCT FROM v_invoice_id THEN
    RAISE EXCEPTION 'Occurrence récurrente modifiée pendant la demande ; réessayez.' USING ERRCODE = '40001';
  END IF;
  IF v_schedule_status IS DISTINCT FROM 'pending_confirmation' THEN
    RAISE EXCEPTION 'Cette occurrence n’est plus en attente de confirmation.' USING ERRCODE = '22023';
  END IF;
  IF v_invoice_id IS NOT NULL AND v_invoice_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Cette occurrence ne peut plus être ignorée : la facture est en cours d’envoi ou déjà émise.' USING ERRCODE = '22023';
  END IF;

  IF v_invoice_id IS NOT NULL THEN
    INSERT INTO public.recurring_invoice_skip_authorizations (
      backend_pid, transaction_id, user_id, invoice_id
    ) VALUES (
      pg_catalog.pg_backend_pid(), pg_catalog.txid_current(), v_user_id, v_invoice_id
    );

    UPDATE public.invoices AS i
    SET status = 'cancelled', is_archived = true
    WHERE i.id = v_invoice_id
      AND i.organization_id = v_organization_id
      AND i.status = 'draft';
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'Le brouillon lié n’a pas pu être annulé.' USING ERRCODE = 'P0001';
    END IF;

    DELETE FROM public.recurring_invoice_skip_authorizations AS skip_auth
    WHERE skip_auth.backend_pid = pg_catalog.pg_backend_pid()
      AND skip_auth.transaction_id = pg_catalog.txid_current()
      AND skip_auth.user_id = v_user_id
      AND skip_auth.invoice_id = v_invoice_id;
    GET DIAGNOSTICS v_row_count = ROW_COUNT;
    IF v_row_count <> 1 THEN
      RAISE EXCEPTION 'Autorisation interne d’annulation introuvable.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  UPDATE public.invoice_schedules AS s
  SET status = 'skipped'
  WHERE s.id = p_schedule_id
    AND s.organization_id = v_organization_id
    AND s.status = 'pending_confirmation'
    AND s.invoice_id IS NOT DISTINCT FROM v_invoice_id;
  GET DIAGNOSTICS v_row_count = ROW_COUNT;
  IF v_row_count <> 1 THEN
    RAISE EXCEPTION 'L’occurrence n’a pas pu être ignorée.' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.skip_recurring_invoice_occurrence(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.skip_recurring_invoice_occurrence(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
COMMIT;
