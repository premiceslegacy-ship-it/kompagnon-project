-- Run only against a disposable local Supabase database migrated through 226.
-- Exercises the authenticated skip RPC, cron-send serialization, tenant and
-- permission refusals, and rollback if draft cancellation fails. Fixtures roll back.
BEGIN;

-- Controlled failure point used to prove the RPC rolls back its occurrence
-- update if the linked draft cannot be cancelled.
CREATE FUNCTION public.test_reject_recurring_skip_cancel_226()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.status = 'cancelled'
     AND current_setting('test.recurring_skip_fail_invoice', true) = OLD.id::TEXT THEN
    RAISE EXCEPTION 'Controlled recurring skip cancellation failure';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE TRIGGER aaa_test_reject_recurring_skip_cancel_226
  BEFORE UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.test_reject_recurring_skip_cancel_226();

DO $test$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_foreign_org_id UUID := gen_random_uuid();
  v_editor_id UUID := gen_random_uuid();
  v_viewer_id UUID := gen_random_uuid();
  v_editor_role_id UUID := gen_random_uuid();
  v_viewer_role_id UUID := gen_random_uuid();
  v_client_id UUID := gen_random_uuid();
  v_foreign_client_id UUID := gen_random_uuid();
  v_model_id UUID := gen_random_uuid();
  v_foreign_model_id UUID := gen_random_uuid();
  v_success_invoice_id UUID := gen_random_uuid();
  v_sending_invoice_id UUID := gen_random_uuid();
  v_sent_invoice_id UUID := gen_random_uuid();
  v_stale_invoice_id UUID := gen_random_uuid();
  v_wrong_tenant_invoice_id UUID := gen_random_uuid();
  v_denied_invoice_id UUID := gen_random_uuid();
  v_rollback_invoice_id UUID := gen_random_uuid();
  v_success_schedule_id UUID := gen_random_uuid();
  v_sending_schedule_id UUID := gen_random_uuid();
  v_sent_schedule_id UUID := gen_random_uuid();
  v_stale_schedule_id UUID := gen_random_uuid();
  v_wrong_tenant_schedule_id UUID := gen_random_uuid();
  v_denied_schedule_id UUID := gen_random_uuid();
  v_rollback_schedule_id UUID := gen_random_uuid();
  v_blocked BOOLEAN;
  v_error_message TEXT;
  v_sending_schedule_before JSONB;
  v_sending_invoice_before JSONB;
  v_sent_schedule_before JSONB;
  v_sent_invoice_before JSONB;
  v_stale_schedule_before JSONB;
  v_stale_invoice_before JSONB;
  v_foreign_schedule_before JSONB;
  v_foreign_invoice_before JSONB;
  v_denied_schedule_before JSONB;
  v_denied_invoice_before JSONB;
  v_rollback_schedule_before JSONB;
  v_rollback_invoice_before JSONB;
  v_model_before JSONB;
  v_foreign_model_before JSONB;
  v_next_send_date DATE := DATE '2026-12-10';
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_editor_id::TEXT, true);

  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject)
  VALUES
    (v_org_id, 'Recurring skip tenant', 'recurring-skip-' || v_org_id::TEXT,
     'recurring-skip-' || v_org_id::TEXT || '@example.invalid', 'construction', true),
    (v_foreign_org_id, 'Foreign recurring skip tenant', 'recurring-skip-foreign-' || v_foreign_org_id::TEXT,
     'recurring-skip-foreign-' || v_foreign_org_id::TEXT || '@example.invalid', 'construction', true);

  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES
    (v_client_id, v_org_id, 'company', 'Recurring skip buyer', 'skip-buyer-' || v_client_id::TEXT || '@example.invalid'),
    (v_foreign_client_id, v_foreign_org_id, 'company', 'Foreign recurring buyer', 'foreign-skip-buyer-' || v_foreign_client_id::TEXT || '@example.invalid');

  INSERT INTO public.recurring_invoices (
    id, organization_id, client_id, title, frequency, next_send_date,
    requires_confirmation, confirmation_delay_days, is_active, base_amount_ht
  ) VALUES
    (v_model_id, v_org_id, v_client_id, 'Recurring skip model', 'monthly', v_next_send_date,
     true, 3, true, 100),
    (v_foreign_model_id, v_foreign_org_id, v_foreign_client_id, 'Foreign recurring model', 'monthly', v_next_send_date,
     true, 3, true, 100);

  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES
    (v_editor_role_id, v_org_id, 'Recurring editor', 'recurring-editor-226'),
    (v_viewer_role_id, v_org_id, 'Recurring viewer', 'recurring-viewer-226');

  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_editor_id, 'authenticated', 'authenticated', 'recurring-editor-' || v_editor_id::TEXT || '@example.invalid', now()),
    (v_viewer_id, 'authenticated', 'authenticated', 'recurring-viewer-' || v_viewer_id::TEXT || '@example.invalid', now());

  -- Auth bootstrap may create a private owner organization for these new users.
  -- Select only the memberships of the two fixture identities.
  UPDATE public.memberships SET is_active = false
  WHERE user_id IN (v_editor_id, v_viewer_id);

  INSERT INTO public.memberships (organization_id, user_id, role_id, accepted_at, is_active)
  VALUES
    (v_org_id, v_editor_id, v_editor_role_id, now(), true),
    (v_org_id, v_viewer_id, v_viewer_role_id, now(), true);

  -- The editor can read and edit invoices, but cannot delete or record payments.
  INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
  VALUES
    (v_editor_role_id, 'invoices.edit', true),
    (v_editor_role_id, 'invoices.view', true),
    (v_viewer_role_id, 'invoices.view', true);

  INSERT INTO public.invoices (
    id, organization_id, client_id, created_by, number, title, status,
    total_ht, total_tva, total_ttc, currency
  ) VALUES
    (v_success_invoice_id, v_org_id, v_client_id, v_editor_id,
     'FAC-SKIP-' || v_success_invoice_id::TEXT, 'Draft to skip', 'draft', 100, 20, 120, 'EUR'),
    (v_sending_invoice_id, v_org_id, v_client_id, v_editor_id,
     'FAC-SKIP-' || v_sending_invoice_id::TEXT, 'Sending invoice', 'draft', 100, 20, 120, 'EUR'),
    (v_sent_invoice_id, v_org_id, v_client_id, v_editor_id,
     'FAC-SKIP-' || v_sent_invoice_id::TEXT, 'Sent invoice', 'draft', 100, 20, 120, 'EUR'),
    (v_stale_invoice_id, v_org_id, v_client_id, v_editor_id,
     'FAC-SKIP-' || v_stale_invoice_id::TEXT, 'Stale occurrence invoice', 'draft', 100, 20, 120, 'EUR'),
    (v_wrong_tenant_invoice_id, v_foreign_org_id, v_foreign_client_id, v_editor_id,
     'FAC-SKIP-' || v_wrong_tenant_invoice_id::TEXT, 'Foreign invoice', 'draft', 100, 20, 120, 'EUR'),
    (v_denied_invoice_id, v_org_id, v_client_id, v_editor_id,
     'FAC-SKIP-' || v_denied_invoice_id::TEXT, 'Permission denied invoice', 'draft', 100, 20, 120, 'EUR'),
    (v_rollback_invoice_id, v_org_id, v_client_id, v_editor_id,
     'FAC-SKIP-' || v_rollback_invoice_id::TEXT, 'Cancellation rollback invoice', 'draft', 100, 20, 120, 'EUR');

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, total_ht, vat_amount, position
  )
  SELECT id, 'Recurring skip authority fixture', 1, 'forfait', 100, 20, 100, 20, 0
  FROM public.invoices
  WHERE id IN (
    v_success_invoice_id, v_sending_invoice_id, v_sent_invoice_id, v_stale_invoice_id,
    v_wrong_tenant_invoice_id, v_denied_invoice_id, v_rollback_invoice_id
  );

  -- These are service-owned cron lifecycle states.
  UPDATE public.invoices SET status = 'sending' WHERE id = v_sending_invoice_id;
  UPDATE public.invoices SET status = 'sent' WHERE id = v_sent_invoice_id;

  INSERT INTO public.invoice_schedules (
    id, organization_id, recurring_invoice_id, scheduled_date, status, invoice_id
  ) VALUES
    (v_success_schedule_id, v_org_id, v_model_id, DATE '2026-01-10', 'pending_confirmation', v_success_invoice_id),
    (v_sending_schedule_id, v_org_id, v_model_id, DATE '2026-02-10', 'pending_confirmation', v_sending_invoice_id),
    (v_sent_schedule_id, v_org_id, v_model_id, DATE '2026-03-10', 'pending_confirmation', v_sent_invoice_id),
    (v_stale_schedule_id, v_org_id, v_model_id, DATE '2026-04-10', 'sent', v_stale_invoice_id),
    (v_wrong_tenant_schedule_id, v_foreign_org_id, v_foreign_model_id, DATE '2026-05-10', 'pending_confirmation', v_wrong_tenant_invoice_id),
    (v_denied_schedule_id, v_org_id, v_model_id, DATE '2026-06-10', 'pending_confirmation', v_denied_invoice_id),
    (v_rollback_schedule_id, v_org_id, v_model_id, DATE '2026-07-10', 'pending_confirmation', v_rollback_invoice_id);

  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub', v_editor_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- The legacy direct-write path must remain denied even for an editor; only the
  -- authenticated RPC may use the scoped cancellation capability.
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = v_success_invoice_id) THEN
    RAISE EXCEPTION 'The editor cannot read its own draft before the direct-write refusal test';
  END IF;
  v_blocked := false;
  BEGIN
    UPDATE public.invoices
    SET status = 'cancelled', is_archived = true
    WHERE id = v_success_invoice_id;
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
  END;
  IF NOT v_blocked THEN
    RAISE EXCEPTION 'Direct cancellation unexpectedly worked with invoices.edit alone';
  END IF;

  PERFORM public.skip_recurring_invoice_occurrence(v_success_schedule_id);
  EXECUTE 'RESET ROLE';
  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_schedules
    WHERE id = v_success_schedule_id AND status = 'skipped'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_success_invoice_id AND status = 'cancelled'
      AND is_archived IS TRUE AND unissued_cancelled_at IS NOT NULL
  ) OR NOT EXISTS (
    SELECT 1 FROM public.recurring_invoices
    WHERE id = v_model_id AND next_send_date = v_next_send_date
  ) THEN
    RAISE EXCEPTION 'A pending draft occurrence did not skip and archive atomically without advancing next_send_date';
  END IF;

  -- Snapshot complete rows so refusals are checked for any mutation.
  SELECT to_jsonb(s) INTO v_sending_schedule_before
  FROM public.invoice_schedules AS s WHERE s.id = v_sending_schedule_id;
  SELECT to_jsonb(i) INTO v_sending_invoice_before
  FROM public.invoices AS i WHERE i.id = v_sending_invoice_id;
  SELECT to_jsonb(s) INTO v_sent_schedule_before
  FROM public.invoice_schedules AS s WHERE s.id = v_sent_schedule_id;
  SELECT to_jsonb(i) INTO v_sent_invoice_before
  FROM public.invoices AS i WHERE i.id = v_sent_invoice_id;
  SELECT to_jsonb(s) INTO v_stale_schedule_before
  FROM public.invoice_schedules AS s WHERE s.id = v_stale_schedule_id;
  SELECT to_jsonb(i) INTO v_stale_invoice_before
  FROM public.invoices AS i WHERE i.id = v_stale_invoice_id;
  SELECT to_jsonb(s) INTO v_foreign_schedule_before
  FROM public.invoice_schedules AS s WHERE s.id = v_wrong_tenant_schedule_id;
  SELECT to_jsonb(i) INTO v_foreign_invoice_before
  FROM public.invoices AS i WHERE i.id = v_wrong_tenant_invoice_id;
  SELECT to_jsonb(m) INTO v_model_before
  FROM public.recurring_invoices AS m WHERE m.id = v_model_id;
  SELECT to_jsonb(m) INTO v_foreign_model_before
  FROM public.recurring_invoices AS m WHERE m.id = v_foreign_model_id;
  -- Sending, sent, and stale occurrence refusals must preserve both rows and
  -- the recurring model date.
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  BEGIN
    PERFORM public.skip_recurring_invoice_occurrence(v_sending_schedule_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'A sending invoice occurrence was skipped'; END IF;

  v_blocked := false;
  BEGIN
    PERFORM public.skip_recurring_invoice_occurrence(v_sent_schedule_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'A sent invoice occurrence was skipped'; END IF;

  v_blocked := false;
  BEGIN
    PERFORM public.skip_recurring_invoice_occurrence(v_stale_schedule_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'A stale occurrence was skipped'; END IF;

  -- An active editor in this tenant cannot address another tenant's schedule.
  v_blocked := false;
  BEGIN
    PERFORM public.skip_recurring_invoice_occurrence(v_wrong_tenant_schedule_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'Cross-tenant recurring occurrence skip unexpectedly worked'; END IF;
  EXECUTE 'RESET ROLE';

  IF (SELECT to_jsonb(s) FROM public.invoice_schedules AS s WHERE s.id = v_sending_schedule_id)
       IS DISTINCT FROM v_sending_schedule_before
     OR (SELECT to_jsonb(i) FROM public.invoices AS i WHERE i.id = v_sending_invoice_id)
       IS DISTINCT FROM v_sending_invoice_before
     OR (SELECT to_jsonb(s) FROM public.invoice_schedules AS s WHERE s.id = v_sent_schedule_id)
       IS DISTINCT FROM v_sent_schedule_before
     OR (SELECT to_jsonb(i) FROM public.invoices AS i WHERE i.id = v_sent_invoice_id)
       IS DISTINCT FROM v_sent_invoice_before
     OR (SELECT to_jsonb(s) FROM public.invoice_schedules AS s WHERE s.id = v_stale_schedule_id)
       IS DISTINCT FROM v_stale_schedule_before
     OR (SELECT to_jsonb(i) FROM public.invoices AS i WHERE i.id = v_stale_invoice_id)
       IS DISTINCT FROM v_stale_invoice_before
     OR (SELECT to_jsonb(s) FROM public.invoice_schedules AS s WHERE s.id = v_wrong_tenant_schedule_id)
       IS DISTINCT FROM v_foreign_schedule_before
     OR (SELECT to_jsonb(i) FROM public.invoices AS i WHERE i.id = v_wrong_tenant_invoice_id)
       IS DISTINCT FROM v_foreign_invoice_before
     OR (SELECT to_jsonb(m) FROM public.recurring_invoices AS m WHERE m.id = v_model_id)
       IS DISTINCT FROM v_model_before
     OR (SELECT to_jsonb(m) FROM public.recurring_invoices AS m WHERE m.id = v_foreign_model_id)
       IS DISTINCT FROM v_foreign_model_before THEN
    RAISE EXCEPTION 'A refused sending, sent, stale, or cross-tenant skip changed fixture state';
  END IF;

  -- A same-tenant member without invoices.edit is refused before any write.
  SELECT to_jsonb(s) INTO v_denied_schedule_before
  FROM public.invoice_schedules AS s WHERE s.id = v_denied_schedule_id;
  SELECT to_jsonb(i) INTO v_denied_invoice_before
  FROM public.invoices AS i WHERE i.id = v_denied_invoice_id;
  PERFORM set_config('request.jwt.claim.sub', v_viewer_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  v_error_message := NULL;
  BEGIN
    PERFORM public.skip_recurring_invoice_occurrence(v_denied_schedule_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  END;
  IF NOT v_blocked OR v_error_message NOT LIKE '%invoices.edit%' THEN
    RAISE EXCEPTION 'A member without invoices.edit was not clearly refused';
  END IF;
  EXECUTE 'RESET ROLE';
  IF (SELECT to_jsonb(s) FROM public.invoice_schedules AS s WHERE s.id = v_denied_schedule_id)
       IS DISTINCT FROM v_denied_schedule_before
     OR (SELECT to_jsonb(i) FROM public.invoices AS i WHERE i.id = v_denied_invoice_id)
       IS DISTINCT FROM v_denied_invoice_before
     OR (SELECT to_jsonb(m) FROM public.recurring_invoices AS m WHERE m.id = v_model_id)
       IS DISTINCT FROM v_model_before THEN
    RAISE EXCEPTION 'A permission refusal changed the occurrence, invoice, or recurring model';
  END IF;

  SELECT to_jsonb(s) INTO v_rollback_schedule_before
  FROM public.invoice_schedules AS s WHERE s.id = v_rollback_schedule_id;
  SELECT to_jsonb(i) INTO v_rollback_invoice_before
  FROM public.invoices AS i WHERE i.id = v_rollback_invoice_id;
  -- A forced failure during draft cancellation must roll back the invoice and
  -- leave the schedule pending, proving the two writes share one transaction.
  PERFORM set_config('request.jwt.claim.sub', v_editor_id::TEXT, true);
  PERFORM set_config('test.recurring_skip_fail_invoice', v_rollback_invoice_id::TEXT, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_blocked := false;
  BEGIN
    PERFORM public.skip_recurring_invoice_occurrence(v_rollback_schedule_id);
  EXCEPTION WHEN OTHERS THEN
    v_blocked := true;
    GET STACKED DIAGNOSTICS v_error_message = MESSAGE_TEXT;
  END;
  IF NOT v_blocked OR v_error_message NOT LIKE '%Controlled recurring skip cancellation failure%' THEN
    RAISE EXCEPTION 'The controlled invoice cancellation failure did not abort recurring skip';
  END IF;
  EXECUTE 'RESET ROLE';
  PERFORM set_config('test.recurring_skip_fail_invoice', '', true);
  IF (SELECT to_jsonb(s) FROM public.invoice_schedules AS s WHERE s.id = v_rollback_schedule_id)
       IS DISTINCT FROM v_rollback_schedule_before
     OR (SELECT to_jsonb(i) FROM public.invoices AS i WHERE i.id = v_rollback_invoice_id)
       IS DISTINCT FROM v_rollback_invoice_before
     OR (SELECT to_jsonb(m) FROM public.recurring_invoices AS m WHERE m.id = v_model_id)
       IS DISTINCT FROM v_model_before THEN
    RAISE EXCEPTION 'Invoice cancellation failure did not roll back the whole skip operation';
  END IF;
END;
$test$;

ROLLBACK;
