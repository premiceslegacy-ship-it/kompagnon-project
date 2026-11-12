-- Disposable LOCAL database migrated through 223. All data rolls back.
BEGIN;
DO $test$
DECLARE
  v_org UUID := gen_random_uuid();
  v_foreign_org UUID := gen_random_uuid();
  v_owner UUID := gen_random_uuid();
  v_viewer UUID := gen_random_uuid();
  v_owner_role UUID := gen_random_uuid();
  v_viewer_role UUID := gen_random_uuid();
  v_client UUID := gen_random_uuid();
  v_foreign_client UUID := gen_random_uuid();
  v_invoice UUID := gen_random_uuid();
  v_foreign_invoice UUID := gen_random_uuid();
  v_first_schedule UUID := gen_random_uuid();
  v_second_schedule UUID := gen_random_uuid();
  v_ledger JSONB;
  v_receipt JSONB;
  v_denied BOOLEAN := false;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM set_config('request.jwt.claim.sub', v_owner::TEXT, true);
  INSERT INTO public.organizations (id, name, slug, email, sector, is_vat_subject)
  VALUES
    (v_org, 'Accounting ledger owner', 'ledger-' || v_org, 'ledger-owner@atelier.test', 'construction', true),
    (v_foreign_org, 'Accounting foreign tenant', 'ledger-foreign-' || v_foreign_org, 'ledger-foreign@atelier.test', 'construction', true);
  INSERT INTO public.clients (id, organization_id, type, company_name, email)
  VALUES
    (v_client, v_org, 'company', 'Ledger buyer', 'ledger-buyer@atelier.test'),
    (v_foreign_client, v_foreign_org, 'company', 'Foreign ledger buyer', 'ledger-other@atelier.test');
  INSERT INTO public.roles (id, organization_id, name, slug)
  VALUES (v_owner_role, v_org, 'Ledger owner', 'owner'), (v_viewer_role, v_org, 'Ledger viewer', 'ledger-viewer');
  INSERT INTO auth.users (id, aud, role, email, email_confirmed_at)
  VALUES
    (v_owner, 'authenticated', 'authenticated', 'ledger-owner-' || v_owner || '@atelier.test', now()),
    (v_viewer, 'authenticated', 'authenticated', 'ledger-viewer-' || v_viewer || '@atelier.test', now());
  UPDATE public.memberships SET is_active = false WHERE user_id IN (v_owner, v_viewer);
  INSERT INTO public.memberships (organization_id, user_id, role_id, accepted_at, is_active)
  VALUES (v_org, v_owner, v_owner_role, now(), true), (v_org, v_viewer, v_viewer_role, now(), true);

  INSERT INTO public.invoices (id, organization_id, client_id, created_by, number, title, status, issue_date, total_ht, total_tva, total_ttc, currency)
  VALUES
    (v_invoice, v_org, v_client, v_owner, 'FAC-LEDGER-' || v_invoice, 'Cross-year actual receipts', 'draft', '2025-12-15', 100, 20, 120, 'EUR'),
    (v_foreign_invoice, v_foreign_org, v_foreign_client, v_owner, 'FAC-FOREIGN-' || v_foreign_invoice, 'Foreign receipt witness', 'draft', '2025-12-15', 100, 20, 120, 'EUR');
  INSERT INTO public.invoice_items (invoice_id, description, quantity, unit, unit_price, vat_rate, position)
  VALUES (v_invoice, 'Ledger service', 1, 'u', 100, 20, 0), (v_foreign_invoice, 'Foreign service', 1, 'u', 100, 20, 0);
  INSERT INTO public.invoice_payment_schedule (id, organization_id, invoice_id, label, due_date, amount, amount_type, position)
  VALUES
    (v_first_schedule, v_org, v_invoice, 'First receipt', '2025-12-31', 60, 'amount', 0),
    (v_second_schedule, v_org, v_invoice, 'Second receipt', '2026-01-31', 60, 'amount', 1);
  UPDATE public.invoices SET status = 'sending' WHERE id IN (v_invoice, v_foreign_invoice);
  UPDATE public.invoices SET status = 'sent', sent_at = now() WHERE id IN (v_invoice, v_foreign_invoice);
  INSERT INTO public.payments (organization_id, invoice_id, client_id, amount, payment_date, method, created_by)
  VALUES (v_foreign_org, v_foreign_invoice, v_foreign_client, 120, '2026-01-15', 'manual', v_owner);

  IF has_function_privilege('anon', 'public.get_accounting_payment_ledger(date,date,uuid[],boolean)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.get_accounting_payment_ledger(date,date,uuid[],boolean)', 'EXECUTE') THEN
    RAISE EXCEPTION 'The accounting receipt ledger is not restricted to authenticated human scope';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('role', 'authenticated', true);
  PERFORM public.record_invoice_schedule_payment(v_invoice, v_first_schedule, 60, '2025-12-30', 'bank_transfer', 'LEDGER-DEC', NULL);
  PERFORM public.record_invoice_schedule_payment(v_invoice, v_second_schedule, 60, '2026-01-20', 'bank_transfer', 'LEDGER-JAN', NULL);
  v_ledger := public.get_accounting_payment_ledger('2026-01-01', '2026-01-31', ARRAY[]::UUID[], true);
  IF jsonb_array_length(v_ledger->'payments') <> 1 THEN
    RAISE EXCEPTION 'The period ledger omitted the actual receipt or included another period/tenant';
  END IF;
  v_receipt := v_ledger #> '{payments,0}';
  IF v_receipt->>'invoice_id' <> v_invoice::TEXT
     OR (v_receipt->>'amount')::NUMERIC <> 60
     OR (v_receipt->>'prior_paid_amount')::NUMERIC <> 60
     OR v_receipt->>'payment_date' <> '2026-01-20'
     OR v_receipt->>'reference' <> 'LEDGER-JAN' THEN
    RAISE EXCEPTION 'Receipt date, real amount or pre-period cumulative basis was reconstructed incorrectly';
  END IF;
  IF (SELECT status FROM public.invoices WHERE id = v_invoice) <> 'paid' THEN
    RAISE EXCEPTION 'The real receipt RPC failed under authenticated role';
  END IF;
  v_ledger := public.get_accounting_payment_ledger('2026-01-01', '2026-01-31', ARRAY[]::UUID[], false);
  IF v_ledger->'payments' <> '[]'::JSONB THEN RAISE EXCEPTION 'Payment exclusion was ignored'; END IF;

  PERFORM set_config('request.jwt.claim.sub', v_viewer::TEXT, true);
  BEGIN
    PERFORM public.get_accounting_payment_ledger('2026-01-01', '2026-01-31', ARRAY[]::UUID[], true);
  EXCEPTION WHEN insufficient_privilege THEN v_denied := true;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'A non-administrator could read the accounting export ledger'; END IF;
  RESET ROLE;
END;
$test$;
ROLLBACK;
