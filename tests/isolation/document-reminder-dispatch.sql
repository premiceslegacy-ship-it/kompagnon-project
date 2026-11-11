-- Disposable LOCAL database migrated through 222. No provider calls.
BEGIN;
DO $test$
DECLARE
  v_org UUID := gen_random_uuid();
  v_other UUID := gen_random_uuid();
  v_client UUID := gen_random_uuid();
  v_invoice UUID := gen_random_uuid();
  v_quote UUID := gen_random_uuid();
  v_claim UUID;
  v_blocked BOOLEAN;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.organizations(id,name,slug,email,is_vat_subject,sector)
  VALUES (v_org,'Reminder owner','reminder-'||v_org,'reminder@example.test',true,'construction'),
         (v_other,'Foreign owner','reminder-other-'||v_other,'foreign@example.test',true,'construction');
  INSERT INTO public.clients(id,organization_id,type,company_name,email)
  VALUES(v_client,v_org,'company','Reminder buyer','buyer@example.test');
  INSERT INTO public.invoices(id,organization_id,client_id,number,status,total_ht,total_tva,total_ttc)
  VALUES(v_invoice,v_org,v_client,'FAC-REMINDER','draft',100,20,120);
  INSERT INTO public.invoice_items(invoice_id,description,quantity,unit_price,vat_rate,total_ht,vat_amount)
  VALUES(v_invoice,'Reminder work',1,100,20,100,20);
  UPDATE public.invoices SET status='sending' WHERE id=v_invoice;
  UPDATE public.invoices SET status='sent',sent_at=now() WHERE id=v_invoice;
  INSERT INTO public.quotes(id,organization_id,client_id,number,status)
  VALUES(v_quote,v_org,v_client,'DEV-REMINDER','draft');
  INSERT INTO public.quote_items(quote_id,type,description,quantity,unit_price,vat_rate)
  VALUES(v_quote,'custom','Reminder offer',1,100,20);
  UPDATE public.quotes SET status='sent',sent_at=now() WHERE id=v_quote;

  EXECUTE 'SET LOCAL ROLE service_role';
  v_claim := public.claim_document_reminder(v_org,v_invoice,NULL);
  IF v_claim IS NULL THEN RAISE EXCEPTION 'A legitimate first invoice reminder was refused'; END IF;
  IF public.claim_document_reminder(v_org,v_invoice,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'Concurrent-channel claim was admitted twice';
  END IF;
  EXECUTE 'RESET ROLE';
  UPDATE public.document_reminder_dispatches SET delivery='unknown',dispatch_date=dispatch_date-1 WHERE id=v_claim;
  EXECUTE 'SET LOCAL ROLE service_role';
  IF public.claim_document_reminder(v_org,v_invoice,NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'An unknown provider outcome was automatically retried the next day';
  END IF;
  EXECUTE 'RESET ROLE';
  UPDATE public.document_reminder_dispatches SET delivery='accepted' WHERE id=v_claim;
  EXECUTE 'SET LOCAL ROLE service_role';
  IF public.claim_document_reminder(v_org,v_invoice,NULL) IS NULL THEN
    RAISE EXCEPTION 'A later reminder after a verified prior-day delivery was refused';
  END IF;
  EXECUTE 'RESET ROLE';

  -- Pre-existing manual log protects against the cron channel as well.
  INSERT INTO public.reminders(organization_id,quote_id,type,rank,is_auto,sent_at)
  VALUES(v_org,v_quote,'quote_followup',1,false,now());
  EXECUTE 'SET LOCAL ROLE service_role';
  IF public.claim_document_reminder(v_org,NULL,v_quote) IS NOT NULL THEN
    RAISE EXCEPTION 'Cron duplicated an existing manual quote reminder';
  END IF;
  v_blocked := false;
  BEGIN PERFORM public.claim_document_reminder(v_other,v_invoice,NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  IF NOT v_blocked THEN RAISE EXCEPTION 'A foreign organization acquired a reminder claim'; END IF;
  EXECUTE 'RESET ROLE';

  -- A second document is a positive witness for quote dispatch, not a log echo.
  DELETE FROM public.reminders WHERE quote_id=v_quote;
  EXECUTE 'SET LOCAL ROLE service_role';
  IF public.claim_document_reminder(v_org,NULL,v_quote) IS NULL THEN
    RAISE EXCEPTION 'A legitimate first quote reminder was refused';
  END IF;
  EXECUTE 'RESET ROLE';
  v_blocked := false;
  EXECUTE 'SET LOCAL ROLE authenticated';
  BEGIN PERFORM public.claim_document_reminder(v_org,v_invoice,NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked THEN RAISE EXCEPTION 'Authenticated clients bypassed the server permission gate'; END IF;
  v_blocked := false;
  EXECUTE 'SET LOCAL ROLE anon';
  BEGIN PERFORM public.claim_document_reminder(v_org,v_invoice,NULL);
  EXCEPTION WHEN insufficient_privilege THEN v_blocked := true; END;
  EXECUTE 'RESET ROLE';
  IF NOT v_blocked THEN RAISE EXCEPTION 'Anonymous clients acquired a reminder claim'; END IF;
END;
$test$;
ROLLBACK;
