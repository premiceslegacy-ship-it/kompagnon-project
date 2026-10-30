-- Run only against a disposable LOCAL Supabase database migrated through 210:
-- psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/isolation/invoice-resend-claims.sql
-- All fixture rows and claim mutations are rolled back on success.
BEGIN;
SET LOCAL request.jwt.claim.role = 'service_role';

DO $prepare$
DECLARE
  v_org_id UUID := gen_random_uuid();
  v_invoice_id UUID := gen_random_uuid();
BEGIN
  INSERT INTO public.organizations (id, name, slug, email, sector)
  VALUES (v_org_id, 'Resend claim smoke', 'resend-claim-' || v_org_id::TEXT,
          'resend-' || v_org_id::TEXT || '@example.invalid', 'construction');
  INSERT INTO public.invoices (
    id, organization_id, number, status, total_ht, total_tva, total_ttc, total_paid
  ) VALUES (
    v_invoice_id, v_org_id, 'RESEND-SMOKE', 'draft', 100, 20, 120, 0
  );
  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, position
  ) VALUES (
    v_invoice_id, 'Resend smoke line', 1, 'u', 100, 20, 0
  );
  PERFORM set_config('app.invoice_resend_claim_smoke_invoice', v_invoice_id::TEXT, true);
END;
$prepare$;

SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
  v_invoice_id UUID := current_setting('app.invoice_resend_claim_smoke_invoice')::UUID;
  v_token UUID := gen_random_uuid();
  v_other_token UUID := gen_random_uuid();
  v_privilege TEXT;
  v_rls_enabled BOOLEAN;
  v_status TEXT;
  v_sent_at TIMESTAMPTZ;
  v_total_ht NUMERIC;
  v_total_tva NUMERIC;
  v_total_ttc NUMERIC;
  v_total_paid NUMERIC;
BEGIN
  UPDATE public.invoices
  SET status = 'sending'
  WHERE id = v_invoice_id AND status = 'draft';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'service-role first-send transition did not claim the draft';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoices
    WHERE id = v_invoice_id
      AND issuance_snapshot->>'schema_version' = '1'
      AND issuance_snapshot->'invoice'->>'number' = 'RESEND-SMOKE'
      AND issuance_snapshot->'seller'->>'name' = 'Resend claim smoke'
  ) THEN
    RAISE EXCEPTION 'first-send transition did not capture issuance authority';
  END IF;
  UPDATE public.invoices
  SET status = 'sent', sent_at = '2026-10-26 12:00:00+00'
  WHERE id = v_invoice_id AND status = 'sending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'successful first-send transition did not mark invoice sent';
  END IF;
  UPDATE public.invoices
  SET status = 'paid', total_paid = 80, paid_at = '2026-10-26 13:00:00+00'
  WHERE id = v_invoice_id AND status = 'sent';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'authorized sent-to-paid lifecycle transition failed';
  END IF;

  SELECT c.relrowsecurity INTO v_rls_enabled
  FROM pg_catalog.pg_class c
  WHERE c.oid = 'public.invoice_resend_delivery_claims'::regclass;
  IF v_rls_enabled IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invoice_resend_delivery_claims must have RLS enabled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'invoice_resend_delivery_claims'
  ) THEN
    RAISE EXCEPTION 'invoice_resend_delivery_claims must not expose any RLS policy';
  END IF;
  FOREACH v_privilege IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE'] LOOP
    IF NOT has_table_privilege('service_role', 'public.invoice_resend_delivery_claims', v_privilege) THEN
      RAISE EXCEPTION 'service_role is missing % privilege', v_privilege;
    END IF;
    IF has_table_privilege('anon', 'public.invoice_resend_delivery_claims', v_privilege)
       OR has_table_privilege('authenticated', 'public.invoice_resend_delivery_claims', v_privilege) THEN
      RAISE EXCEPTION 'anon/authenticated must not have % privilege', v_privilege;
    END IF;
  END LOOP;

  INSERT INTO public.invoice_resend_delivery_claims (invoice_id, claim_token)
  VALUES (v_invoice_id, v_token);

  BEGIN
    INSERT INTO public.invoice_resend_delivery_claims (invoice_id, claim_token)
    VALUES (v_invoice_id, v_other_token);
    RAISE EXCEPTION 'a concurrent resend claim unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  UPDATE public.invoice_resend_delivery_claims
  SET state = 'ambiguous', ambiguous_at = now()
  WHERE invoice_id = v_invoice_id AND claim_token = v_other_token;
  IF FOUND THEN
    RAISE EXCEPTION 'a non-owner token unexpectedly changed the claim';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_resend_delivery_claims
    WHERE invoice_id = v_invoice_id AND claim_token = v_token AND state = 'claimed'
  ) THEN
    RAISE EXCEPTION 'the owned claim was changed by a non-owner token';
  END IF;

  UPDATE public.invoice_resend_delivery_claims
  SET state = 'ambiguous', ambiguous_at = now()
  WHERE invoice_id = v_invoice_id AND claim_token = v_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the owner could not retain an ambiguous delivery claim';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.invoice_resend_delivery_claims
    WHERE invoice_id = v_invoice_id AND state = 'ambiguous' AND ambiguous_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'ambiguous state and timestamp were not persisted';
  END IF;

  DELETE FROM public.invoice_resend_delivery_claims
  WHERE invoice_id = v_invoice_id AND claim_token = v_other_token;
  IF FOUND THEN
    RAISE EXCEPTION 'a non-owner token unexpectedly released the claim';
  END IF;
  DELETE FROM public.invoice_resend_delivery_claims
  WHERE invoice_id = v_invoice_id AND claim_token = v_token;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'the owner could not release its claim';
  END IF;
  INSERT INTO public.invoice_resend_delivery_claims (invoice_id, claim_token)
  VALUES (v_invoice_id, v_other_token);

  SELECT status, sent_at, total_ht, total_tva, total_ttc, total_paid
    INTO v_status, v_sent_at, v_total_ht, v_total_tva, v_total_ttc, v_total_paid
  FROM public.invoices WHERE id = v_invoice_id;
  IF (v_status, v_sent_at, v_total_ht, v_total_tva, v_total_ttc, v_total_paid)
     IS DISTINCT FROM ('paid'::TEXT, '2026-10-26 12:00:00+00'::TIMESTAMPTZ,
                       100::NUMERIC, 20::NUMERIC, 120::NUMERIC, 80::NUMERIC) THEN
    RAISE EXCEPTION 'resend claims altered the issued invoice lifecycle or amounts';
  END IF;
END;
$smoke$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $deny$
BEGIN
  BEGIN
    PERFORM 1 FROM public.invoice_resend_delivery_claims;
    RAISE EXCEPTION 'anonymous claim-table read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$deny$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $deny$
BEGIN
  BEGIN
    PERFORM 1 FROM public.invoice_resend_delivery_claims;
    RAISE EXCEPTION 'authenticated claim-table read unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$deny$;
RESET ROLE;

ROLLBACK;
