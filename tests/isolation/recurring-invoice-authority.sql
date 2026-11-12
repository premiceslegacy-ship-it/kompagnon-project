-- Disposable LOCAL Supabase database migrated through 221.
-- Exercises recurring occurrence totals, internal-line preservation, confirmation,
-- and authority-level retry behavior. All fixture rows roll back on success.
BEGIN;

DO $test$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_client_id UUID := gen_random_uuid();
  v_model_id UUID := gen_random_uuid();
  v_first JSONB;
  v_retry JSONB;
  v_not_due JSONB;
  v_invoice_id UUID;
  v_schedule_date DATE;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject)
  VALUES (v_org_id, 'Recurring authority tenant', 'recurring-authority-' || v_org_id::TEXT,
          'recurring-authority-' || v_org_id::TEXT || '@example.invalid', 'construction', true);
  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES (v_client_id, v_org_id, 'company', 'Recurring buyer', 'recurring-buyer-' || v_client_id::TEXT || '@example.invalid');

  INSERT INTO public.recurring_invoices (
    id, organization_id, client_id, title, frequency, next_send_date,
    requires_confirmation, confirmation_delay_days, is_active, base_amount_ht
  ) VALUES (
    v_model_id, v_org_id, v_client_id, 'Modèle récurrent', 'monthly', CURRENT_DATE,
    true, 3, true, 503.03
  );
  INSERT INTO public.recurring_invoice_items (
    recurring_invoice_id, description, quantity, unit, unit_price, vat_rate, position, is_internal
  ) VALUES
    (v_model_id, 'Ligne visible', 8, 'u', 62.80, 20, 0, false),
    (v_model_id, 'Ligne visible fractionnaire', 0.001, 'u', 625.50, 20, 1, false),
    (v_model_id, 'Coût interne', 1, 'forfait', 9999, 20, 2, true);

  v_first := public.prepare_recurring_invoice_occurrence(v_model_id);
  v_invoice_id := (v_first->>'invoice_id')::UUID;
  v_schedule_date := (v_first->>'scheduled_date')::DATE;

  IF v_first->>'created' IS DISTINCT FROM 'true'
     OR (v_first->>'total_ht')::NUMERIC IS DISTINCT FROM 503.03
     OR (v_first->>'total_tva')::NUMERIC IS DISTINCT FROM 100.61
     OR (v_first->>'total_ttc')::NUMERIC IS DISTINCT FROM 603.64
     OR NOT EXISTS (
       SELECT 1 FROM public.invoices
       WHERE id = v_invoice_id AND organization_id = v_org_id
         AND status = 'draft' AND total_ht = 503.03 AND total_tva = 100.61 AND total_ttc = 603.64
     )
     OR (SELECT count(*) FROM public.invoice_items WHERE invoice_id = v_invoice_id) <> 3
     OR NOT EXISTS (
       SELECT 1 FROM public.invoice_items
       WHERE invoice_id = v_invoice_id AND is_internal IS TRUE AND unit_price = 9999
     )
     OR NOT EXISTS (
       SELECT 1 FROM public.invoice_schedules
       WHERE recurring_invoice_id = v_model_id AND invoice_id = v_invoice_id
         AND scheduled_date = v_schedule_date AND status = 'pending_confirmation'
     ) THEN
    RAISE EXCEPTION 'Recurring generation leaked internal value into totals, lost its line, or bypassed confirmation';
  END IF;

  -- A stale due-list entry after the first call advanced next_send_date is a
  -- normal no-op and must not create an invoice or schedule for the next period.
  v_not_due := public.prepare_recurring_invoice_occurrence(v_model_id);
  IF v_not_due->>'created' IS DISTINCT FROM 'false'
     OR v_not_due->>'reason' IS DISTINCT FROM 'not_due'
     OR v_not_due ? 'invoice_id'
     OR (SELECT count(*) FROM public.invoices
         WHERE organization_id = v_org_id AND generation_source = 'recurring_model') <> 1
     OR (SELECT count(*) FROM public.invoice_schedules
         WHERE recurring_invoice_id = v_model_id) <> 1 THEN
    RAISE EXCEPTION 'A not-due retry created another recurring invoice or schedule';
  END IF;

  -- A retry for the same scheduled occurrence must return its one invoice and
  -- must not produce a second invoice or schedule row.
  UPDATE public.recurring_invoices SET next_send_date = v_schedule_date WHERE id = v_model_id;
  v_retry := public.prepare_recurring_invoice_occurrence(v_model_id);
  IF v_retry->>'created' IS DISTINCT FROM 'false'
     OR (v_retry->>'invoice_id')::UUID IS DISTINCT FROM v_invoice_id
     OR (SELECT count(*) FROM public.invoices WHERE generation_source = 'recurring_model' AND id = v_invoice_id) <> 1
     OR (SELECT count(*) FROM public.invoice_schedules WHERE recurring_invoice_id = v_model_id AND scheduled_date = v_schedule_date) <> 1 THEN
    RAISE EXCEPTION 'Retry created a duplicate recurring invoice or schedule instead of returning the existing occurrence';
  END IF;
END;
$test$;

ROLLBACK;
