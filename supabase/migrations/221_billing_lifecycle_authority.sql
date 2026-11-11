-- 221 — Atomic, quote-bounded balance drafts, legally linked credit notes, and
-- transactionally idempotent recurring invoice occurrences.

BEGIN;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vat_breakdown JSONB,
  ADD COLUMN IF NOT EXISTS applied_acompte_ht NUMERIC(12,2);
COMMENT ON COLUMN public.invoices.vat_breakdown IS
  'Validated per-rate invoice tax breakdown; solde/avoir values are authority-derived and immutable after issue.';
COMMENT ON COLUMN public.invoices.applied_acompte_ht IS
  'Frozen HT apurement of issued acomptes on a solde, informational only; never deducted again from solde totals.';


ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_invoice_type_check;
ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_invoice_type_check
  CHECK (invoice_type IN ('standard', 'acompte', 'situation', 'solde', 'avoir'));

CREATE OR REPLACE FUNCTION public.vat_breakdown_from_items_v221(
  p_items JSONB,
  p_is_vat_subject BOOLEAN,
  p_is_reverse_charge BOOLEAN,
  p_default_rate NUMERIC DEFAULT 0
)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'rate', buckets.vat_rate,
        'taxable_basis', buckets.taxable_basis,
        'tax_amount', CASE
          WHEN COALESCE(p_is_vat_subject, true) AND NOT COALESCE(p_is_reverse_charge, false)
            THEN ROUND(buckets.taxable_basis * buckets.vat_rate / 100, 2)
          ELSE 0
        END
      )
      ORDER BY buckets.vat_rate
    ),
    '[]'::JSONB
  )
  FROM (
    SELECT lines.vat_rate, ROUND(SUM(lines.line_ht), 2) AS taxable_basis
    FROM (
      SELECT COALESCE((item->>'vat_rate')::NUMERIC, p_default_rate, 0) AS vat_rate,
             ROUND(
               COALESCE((item->>'quantity')::NUMERIC, 0)
               * COALESCE((item->>'unit_price')::NUMERIC, 0),
               2
             ) AS line_ht
      FROM jsonb_array_elements(COALESCE(p_items, '[]'::JSONB)) AS source(item)
      WHERE COALESCE((item->>'is_internal')::BOOLEAN, false) IS NOT TRUE
        AND item->>'unit' IS DISTINCT FROM '__section__'
    ) AS lines
    GROUP BY lines.vat_rate
    HAVING ROUND(SUM(lines.line_ht), 2) > 0
  ) AS buckets;
$function$;
REVOKE ALL ON FUNCTION public.vat_breakdown_from_items_v221(JSONB, BOOLEAN, BOOLEAN, NUMERIC) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.invoice_vat_breakdown_from_snapshot_v221(p_snapshot JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_invoice JSONB;
  v_items JSONB;
  v_seller JSONB;
  v_breakdown JSONB;
  v_canonical JSONB;
  v_entry JSONB;
  v_rate NUMERIC;
  v_basis NUMERIC;
  v_tax NUMERIC;
  v_expected_basis NUMERIC;
  v_previous_rate NUMERIC;
  v_total_ht NUMERIC := 0;
  v_total_tva NUMERIC := 0;
  v_total_ttc NUMERIC;
  v_count INTEGER := 0;
  v_is_vat_subject BOOLEAN;
  v_is_reverse_charge BOOLEAN;
BEGIN
  IF jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
     OR p_snapshot->>'schema_version' IS DISTINCT FROM '1'
     OR jsonb_typeof(p_snapshot->'invoice') IS DISTINCT FROM 'object'
     OR jsonb_typeof(p_snapshot->'items') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Autorité de facture émise indisponible' USING ERRCODE = '23514';
  END IF;

  v_invoice := p_snapshot->'invoice';
  v_items := p_snapshot->'items';
  v_seller := p_snapshot->'seller';
  IF NULLIF(v_invoice->>'id', '') IS NULL
     OR NULLIF(v_invoice->>'total_ht', '') IS NULL
     OR NULLIF(v_invoice->>'total_tva', '') IS NULL
     OR NULLIF(v_invoice->>'total_ttc', '') IS NULL THEN
    RAISE EXCEPTION 'Totaux d’autorité de facture émise indisponibles' USING ERRCODE = '23514';
  END IF;

  v_is_vat_subject := COALESCE((v_seller->>'is_vat_subject')::BOOLEAN, true);
  v_is_reverse_charge := COALESCE((v_invoice->>'is_reverse_charge')::BOOLEAN, false);
  v_breakdown := v_invoice->'vat_breakdown';
  v_canonical := public.vat_breakdown_from_items_v221(
    v_items, v_is_vat_subject, v_is_reverse_charge, 0
  );
  IF v_breakdown IS NULL OR jsonb_typeof(v_breakdown) = 'null' THEN
    v_breakdown := v_canonical;
  ELSIF jsonb_typeof(v_breakdown) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Répartition TVA invalide dans l’autorité de facture émise' USING ERRCODE = '23514';
  END IF;

  IF jsonb_array_length(v_breakdown) IS DISTINCT FROM jsonb_array_length(v_canonical) THEN
    RAISE EXCEPTION 'Répartition TVA incomplète dans l’autorité de facture émise' USING ERRCODE = '23514';
  END IF;

  FOR v_entry IN SELECT value FROM jsonb_array_elements(v_breakdown)
  LOOP
    IF jsonb_typeof(v_entry) IS DISTINCT FROM 'object'
       OR (SELECT COUNT(*) FROM jsonb_object_keys(v_entry)) <> 3 THEN
      RAISE EXCEPTION 'Ligne de répartition TVA invalide dans l’autorité émise' USING ERRCODE = '23514';
    END IF;
    v_rate := (v_entry->>'rate')::NUMERIC;
    v_basis := (v_entry->>'taxable_basis')::NUMERIC;
    v_tax := (v_entry->>'tax_amount')::NUMERIC;
    IF v_rate < 0 OR v_rate > 100
       OR v_basis <= 0 OR ROUND(v_basis, 2) IS DISTINCT FROM v_basis
       OR v_tax < 0 OR ROUND(v_tax, 2) IS DISTINCT FROM v_tax
       OR (v_previous_rate IS NOT NULL AND v_rate <= v_previous_rate) THEN
      RAISE EXCEPTION 'Montant ou ordre invalide dans la répartition TVA émise' USING ERRCODE = '23514';
    END IF;
    SELECT (bucket->>'taxable_basis')::NUMERIC
    INTO v_expected_basis
    FROM jsonb_array_elements(v_canonical) AS canonical(bucket)
    WHERE (bucket->>'rate')::NUMERIC = v_rate;
    IF NOT FOUND OR v_basis IS DISTINCT FROM v_expected_basis THEN
      RAISE EXCEPTION 'Base par taux différente des lignes de l’autorité émise' USING ERRCODE = '23514';
    END IF;
    IF (NOT v_is_vat_subject OR v_is_reverse_charge OR v_rate = 0) AND v_tax <> 0 THEN
      RAISE EXCEPTION 'TVA incompatible avec le régime de la facture émise' USING ERRCODE = '23514';
    END IF;
    v_total_ht := v_total_ht + v_basis;
    v_total_tva := v_total_tva + v_tax;
    v_previous_rate := v_rate;
    v_count := v_count + 1;
  END LOOP;

  v_total_ht := ROUND(v_total_ht, 2);
  v_total_tva := ROUND(v_total_tva, 2);
  v_total_ttc := ROUND(v_total_ht + v_total_tva, 2);
  IF v_total_ht IS DISTINCT FROM ROUND((v_invoice->>'total_ht')::NUMERIC, 2)
     OR v_total_tva IS DISTINCT FROM ROUND((v_invoice->>'total_tva')::NUMERIC, 2)
     OR v_total_ttc IS DISTINCT FROM ROUND((v_invoice->>'total_ttc')::NUMERIC, 2) THEN
    RAISE EXCEPTION 'Totaux de la répartition TVA différents de l’autorité émise' USING ERRCODE = '23514';
  END IF;
  RETURN v_breakdown;
END;
$function$;
REVOKE ALL ON FUNCTION public.invoice_vat_breakdown_from_snapshot_v221(JSONB) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.quote_balance_authority_v221(
  p_organization_id UUID,
  p_quote_id UUID,
  p_current_invoice_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_quote_snapshot JSONB;
  v_quote_facts JSONB;
  v_quote_breakdown JSONB;
  v_prior RECORD;
  v_prior_snapshot JSONB;
  v_prior_breakdown JSONB;
  v_prior_bucket JSONB;
  v_prior_bucket_map JSONB := '{}'::JSONB;
  v_existing_bucket JSONB;
  v_source_snapshot JSONB;
  v_credit_source_id UUID;
  v_credit_source_type TEXT;
  v_rate RECORD;
  v_rate_key TEXT;
  v_quote_basis NUMERIC(12,2);
  v_quote_tax NUMERIC(12,2);
  v_prior_basis NUMERIC(12,2);
  v_prior_tax NUMERIC(12,2);
  v_remaining_basis NUMERIC(12,2);
  v_remaining_tax NUMERIC(12,2);
  v_quote_ht NUMERIC(12,2) := 0;
  v_quote_tva NUMERIC(12,2) := 0;
  v_quote_ttc NUMERIC(12,2) := 0;
  v_billed_ht NUMERIC(12,2) := 0;
  v_billed_ttc NUMERIC(12,2) := 0;
  v_remaining_ht NUMERIC(12,2) := 0;
  v_remaining_tva NUMERIC(12,2) := 0;
  v_remaining_breakdown JSONB := '[]'::JSONB;
  v_applied_acompte_ht NUMERIC(12,2) := 0;
  v_is_vat_subject BOOLEAN;
  v_is_reverse_charge BOOLEAN := false;
  v_has_regime BOOLEAN := false;
  v_prior_reverse_charge BOOLEAN;
  v_sign NUMERIC(2,0);
BEGIN
  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id AND organization_id = p_organization_id
  FOR SHARE;
  IF NOT FOUND OR v_quote.status NOT IN ('accepted', 'converted', 'fully_invoiced')
     OR v_quote.historical_import IS NOT NULL THEN
    RAISE EXCEPTION 'Le devis accepté ne dispose pas d’une autorité vérifiée' USING ERRCODE = '23514';
  END IF;

  v_quote_snapshot := v_quote.document_snapshot;
  IF jsonb_typeof(v_quote_snapshot) IS DISTINCT FROM 'object'
     OR v_quote_snapshot->>'version' IS DISTINCT FROM '1'
     OR v_quote_snapshot #>> '{quote,id}' IS DISTINCT FROM v_quote.id::TEXT
     OR v_quote_snapshot #>> '{organization,id}' IS DISTINCT FROM p_organization_id::TEXT
     OR jsonb_typeof(v_quote_snapshot #> '{quote,items}') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Autorité de publication du devis accepté indisponible' USING ERRCODE = '23514';
  END IF;

  v_quote_facts := v_quote_snapshot->'quote';
  v_is_vat_subject := COALESCE((v_quote_snapshot #>> '{organization,is_vat_subject}')::BOOLEAN, true);
  v_quote_breakdown := public.vat_breakdown_from_items_v221(
    v_quote_facts->'items', v_is_vat_subject, false, 20
  );
  SELECT ROUND(COALESCE(SUM((bucket->>'taxable_basis')::NUMERIC), 0), 2),
         ROUND(COALESCE(SUM((bucket->>'tax_amount')::NUMERIC), 0), 2)
  INTO v_quote_ht, v_quote_tva
  FROM jsonb_array_elements(v_quote_breakdown) AS quote_bucket(bucket);
  v_quote_ttc := ROUND(v_quote_ht + v_quote_tva, 2);
  IF v_quote_ht <= 0
     OR ROUND(COALESCE((v_quote_facts->>'total_ht')::NUMERIC, 0), 2) IS DISTINCT FROM v_quote_ht
     OR ROUND(COALESCE((v_quote_facts->>'total_tva')::NUMERIC, 0), 2) IS DISTINCT FROM v_quote_tva
     OR ROUND(COALESCE((v_quote_facts->>'total_ttc')::NUMERIC, 0), 2) IS DISTINCT FROM v_quote_ttc
     OR ROUND(COALESCE(v_quote.total_ht, 0), 2) IS DISTINCT FROM v_quote_ht
     OR ROUND(COALESCE(v_quote.total_tva, 0), 2) IS DISTINCT FROM v_quote_tva
     OR ROUND(COALESCE(v_quote.total_ttc, 0), 2) IS DISTINCT FROM v_quote_ttc THEN
    RAISE EXCEPTION 'Les totaux du devis accepté ne correspondent pas à son autorité publiée' USING ERRCODE = '23514';
  END IF;

  FOR v_prior IN
    SELECT prior.id, prior.invoice_type, prior.status, prior.number, prior.issue_date,
           prior.total_ht, prior.total_tva, prior.total_ttc, prior.is_reverse_charge,
           prior.issuance_snapshot
    FROM public.invoices AS prior
    WHERE prior.organization_id = p_organization_id
      AND prior.quote_id = p_quote_id
      AND prior.id IS DISTINCT FROM p_current_invoice_id
      AND (prior.status IN ('sending', 'sent', 'viewed', 'partial', 'paid', 'overdue')
           OR (prior.status = 'cancelled' AND prior.unissued_cancelled_at IS NULL))
    ORDER BY prior.issue_date NULLS FIRST, prior.id
  LOOP
    v_prior_snapshot := v_prior.issuance_snapshot;
    IF v_prior_snapshot IS NULL
       OR v_prior_snapshot #>> '{invoice,id}' IS DISTINCT FROM v_prior.id::TEXT
       OR v_prior_snapshot #>> '{invoice,invoice_type}' IS DISTINCT FROM v_prior.invoice_type
       OR v_prior_snapshot #>> '{invoice,quote_id}' IS DISTINCT FROM p_quote_id::TEXT
       OR v_prior_snapshot #>> '{invoice,number}' IS DISTINCT FROM v_prior.number
       OR v_prior_snapshot #>> '{invoice,issue_date}' IS DISTINCT FROM v_prior.issue_date::TEXT
       OR ROUND(COALESCE((v_prior_snapshot #>> '{invoice,total_ht}')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_prior.total_ht, 0), 2)
       OR ROUND(COALESCE((v_prior_snapshot #>> '{invoice,total_tva}')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_prior.total_tva, 0), 2)
       OR ROUND(COALESCE((v_prior_snapshot #>> '{invoice,total_ttc}')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_prior.total_ttc, 0), 2)
       OR COALESCE((v_prior_snapshot #>> '{invoice,is_reverse_charge}')::BOOLEAN, false) IS DISTINCT FROM v_prior.is_reverse_charge THEN
      RAISE EXCEPTION 'Une facture ou un avoir lié au devis ne possède pas d’autorité émise vérifiable' USING ERRCODE = '23514';
    END IF;
    v_prior_breakdown := public.invoice_vat_breakdown_from_snapshot_v221(v_prior_snapshot);
    v_sign := CASE WHEN v_prior.invoice_type = 'avoir' THEN -1 ELSE 1 END;
    v_billed_ht := ROUND(v_billed_ht + v_sign * COALESCE((
      SELECT SUM((bucket->>'taxable_basis')::NUMERIC)
      FROM jsonb_array_elements(v_prior_breakdown) AS prior_bucket(bucket)
    ), 0), 2);
    v_billed_ttc := ROUND(v_billed_ttc + v_sign * ROUND((v_prior_snapshot #>> '{invoice,total_ttc}')::NUMERIC, 2), 2);

    IF v_prior.invoice_type <> 'avoir' THEN
      v_prior_reverse_charge := COALESCE((v_prior_snapshot #>> '{invoice,is_reverse_charge}')::BOOLEAN, false);
      IF v_has_regime AND v_is_reverse_charge IS DISTINCT FROM v_prior_reverse_charge THEN
        RAISE EXCEPTION 'Les factures précédentes du devis utilisent des régimes de TVA différents' USING ERRCODE = '23514';
      END IF;
      v_is_reverse_charge := v_prior_reverse_charge;
      v_has_regime := true;
    END IF;

    FOR v_prior_bucket IN SELECT value FROM jsonb_array_elements(v_prior_breakdown)
    LOOP
      v_rate_key := TO_CHAR((v_prior_bucket->>'rate')::NUMERIC, 'FM999999990.00');
      v_existing_bucket := COALESCE(v_prior_bucket_map->v_rate_key, '{}'::JSONB);
      v_prior_bucket_map := jsonb_set(
        v_prior_bucket_map,
        ARRAY[v_rate_key],
        jsonb_build_object(
          'taxable_basis', ROUND(
            COALESCE((v_existing_bucket->>'taxable_basis')::NUMERIC, 0)
            + v_sign * (v_prior_bucket->>'taxable_basis')::NUMERIC,
            2
          ),
          'tax_amount', ROUND(
            COALESCE((v_existing_bucket->>'tax_amount')::NUMERIC, 0)
            + v_sign * (v_prior_bucket->>'tax_amount')::NUMERIC,
            2
          )
        ),
        true
      );
    END LOOP;

    IF v_prior.invoice_type = 'acompte' THEN
      v_applied_acompte_ht := ROUND(v_applied_acompte_ht + ROUND((v_prior_snapshot #>> '{invoice,total_ht}')::NUMERIC, 2), 2);
    ELSIF v_prior.invoice_type = 'avoir' THEN
      v_credit_source_id := NULLIF(v_prior_snapshot #>> '{invoice,credit_note_for}', '')::UUID;
      IF v_credit_source_id IS NULL THEN
        RAISE EXCEPTION 'L’avoir lié au devis ne référence pas sa facture source' USING ERRCODE = '23514';
      END IF;
      SELECT source.invoice_type, source.issuance_snapshot
      INTO v_credit_source_type, v_source_snapshot
      FROM public.invoices AS source
      WHERE source.id = v_credit_source_id
        AND source.organization_id = p_organization_id;
      IF NOT FOUND OR v_source_snapshot IS NULL
         OR v_source_snapshot #>> '{invoice,id}' IS DISTINCT FROM v_credit_source_id::TEXT THEN
        RAISE EXCEPTION 'Autorité source de l’avoir lié au devis indisponible' USING ERRCODE = '23514';
      END IF;
      PERFORM public.invoice_vat_breakdown_from_snapshot_v221(v_source_snapshot);
      IF v_credit_source_type = 'acompte' THEN
        v_applied_acompte_ht := ROUND(v_applied_acompte_ht - ROUND((v_prior_snapshot #>> '{invoice,total_ht}')::NUMERIC, 2), 2);
      END IF;
    END IF;
  END LOOP;

  IF v_billed_ht < 0 OR v_billed_ht > v_quote_ht OR v_billed_ttc < 0 THEN
    RAISE EXCEPTION 'Les factures et avoirs précédents dépassent le montant accepté du devis' USING ERRCODE = '23514';
  END IF;

  FOR v_rate IN
    SELECT DISTINCT rate
    FROM (
      SELECT (bucket->>'rate')::NUMERIC AS rate
      FROM jsonb_array_elements(v_quote_breakdown) AS quote_bucket(bucket)
      UNION
      SELECT key::NUMERIC AS rate FROM jsonb_each(v_prior_bucket_map)
    ) AS rates
    ORDER BY rate
  LOOP
    v_rate_key := TO_CHAR(v_rate.rate, 'FM999999990.00');
    SELECT (bucket->>'taxable_basis')::NUMERIC,
           (bucket->>'tax_amount')::NUMERIC
    INTO v_quote_basis, v_quote_tax
    FROM jsonb_array_elements(v_quote_breakdown) AS quote_bucket(bucket)
    WHERE (bucket->>'rate')::NUMERIC = v_rate.rate;
    IF NOT FOUND THEN
      v_quote_basis := 0;
      v_quote_tax := 0;
    END IF;
    v_existing_bucket := COALESCE(v_prior_bucket_map->v_rate_key, '{}'::JSONB);
    v_prior_basis := COALESCE((v_existing_bucket->>'taxable_basis')::NUMERIC, 0);
    v_prior_tax := COALESCE((v_existing_bucket->>'tax_amount')::NUMERIC, 0);
    v_remaining_basis := ROUND(v_quote_basis - v_prior_basis, 2);
    v_remaining_tax := ROUND(
      CASE WHEN v_is_vat_subject AND NOT v_is_reverse_charge THEN v_quote_tax ELSE 0 END
      - v_prior_tax,
      2
    );
    IF v_remaining_basis < 0 OR v_remaining_tax < 0
       OR (v_remaining_basis = 0 AND v_remaining_tax <> 0) THEN
      RAISE EXCEPTION 'Les factures précédentes dépassent le montant accepté pour une tranche de TVA' USING ERRCODE = '23514';
    END IF;
    IF v_remaining_basis > 0 THEN
      v_remaining_ht := ROUND(v_remaining_ht + v_remaining_basis, 2);
      v_remaining_tva := ROUND(v_remaining_tva + v_remaining_tax, 2);
      v_remaining_breakdown := v_remaining_breakdown || jsonb_build_array(
        jsonb_build_object(
          'rate', v_rate.rate,
          'taxable_basis', v_remaining_basis,
          'tax_amount', v_remaining_tax
        )
      );
    END IF;
  END LOOP;

  v_remaining_ht := ROUND(v_remaining_ht, 2);
  v_remaining_tva := ROUND(v_remaining_tva, 2);
  v_quote_ttc := ROUND(v_quote_ht + CASE WHEN v_is_vat_subject AND NOT v_is_reverse_charge THEN v_quote_tva ELSE 0 END, 2);
  IF v_remaining_ht <= 0 OR v_remaining_ht + v_remaining_tva + v_billed_ttc > v_quote_ttc THEN
    RAISE EXCEPTION 'Aucun solde positif ne reste dans le montant accepté du devis' USING ERRCODE = '23514';
  END IF;
  IF v_applied_acompte_ht < 0 OR v_applied_acompte_ht > v_quote_ht THEN
    RAISE EXCEPTION 'Les acomptes HT nets ne sont pas cohérents avec le devis accepté' USING ERRCODE = '23514';
  END IF;

  RETURN jsonb_build_object(
    'vat_breakdown', v_remaining_breakdown,
    'total_ht', v_remaining_ht,
    'total_tva', v_remaining_tva,
    'total_ttc', ROUND(v_remaining_ht + v_remaining_tva, 2),
    'applied_acompte_ht', v_applied_acompte_ht,
    'is_vat_subject', v_is_vat_subject,
    'is_reverse_charge', v_is_reverse_charge
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.quote_balance_authority_v221(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.credit_note_authority_vat_breakdown_v221(
  p_organization_id UUID,
  p_source_invoice_id UUID,
  p_current_credit_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source public.invoices%ROWTYPE;
  v_source_snapshot JSONB;
  v_source_facts JSONB;
  v_source_breakdown JSONB;
  v_source_bucket JSONB;
  v_prior RECORD;
  v_prior_snapshot JSONB;
  v_prior_breakdown JSONB;
  v_prior_bucket JSONB;
  v_credited_map JSONB := '{}'::JSONB;
  v_existing_bucket JSONB;
  v_rate RECORD;
  v_rate_key TEXT;
  v_source_basis NUMERIC(12,2);
  v_source_tax NUMERIC(12,2);
  v_prior_basis NUMERIC(12,2);
  v_prior_tax NUMERIC(12,2);
  v_remaining_basis NUMERIC(12,2);
  v_remaining_tax NUMERIC(12,2);
  v_total_ht NUMERIC(12,2) := 0;
  v_total_tva NUMERIC(12,2) := 0;
  v_total_ttc NUMERIC(12,2);
  v_source_applied_acompte_ht NUMERIC(12,2);
  v_credited_applied_acompte_ht NUMERIC(12,2) := 0;
  v_remaining_applied_acompte_ht NUMERIC(12,2);
  v_breakdown JSONB := '[]'::JSONB;
BEGIN
  SELECT * INTO v_source
  FROM public.invoices
  WHERE id = p_source_invoice_id
    AND organization_id = p_organization_id
  FOR SHARE;
  IF NOT FOUND OR v_source.status NOT IN ('sent', 'viewed', 'partial', 'paid', 'overdue')
     OR v_source.invoice_type = 'avoir'
     OR v_source.issuance_snapshot IS NULL THEN
    RAISE EXCEPTION 'La facture source émise ne dispose pas d’une autorité vérifiée' USING ERRCODE = '23514';
  END IF;
  v_source_snapshot := v_source.issuance_snapshot;
  v_source_facts := v_source_snapshot->'invoice';
  IF v_source_snapshot->>'schema_version' IS DISTINCT FROM '1'
     OR v_source_facts->>'id' IS DISTINCT FROM v_source.id::TEXT
     OR v_source_facts->>'number' IS DISTINCT FROM v_source.number
     OR v_source_facts->>'issue_date' IS DISTINCT FROM v_source.issue_date::TEXT
     OR v_source_facts->>'invoice_type' IS DISTINCT FROM v_source.invoice_type
     OR ROUND(COALESCE((v_source_facts->>'total_ht')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_source.total_ht, 0), 2)
     OR ROUND(COALESCE((v_source_facts->>'total_tva')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_source.total_tva, 0), 2)
     OR ROUND(COALESCE((v_source_facts->>'total_ttc')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_source.total_ttc, 0), 2) THEN
    RAISE EXCEPTION 'Les faits de la facture source ne correspondent pas à son autorité émise' USING ERRCODE = '23514';
  END IF;
  v_source_breakdown := public.invoice_vat_breakdown_from_snapshot_v221(v_source_snapshot);
  v_source_applied_acompte_ht := NULLIF(v_source_facts->>'applied_acompte_ht', '')::NUMERIC;

  FOR v_prior IN
    SELECT credit.id, credit.invoice_type, credit.status, credit.number, credit.issue_date,
           credit.total_ht, credit.total_tva, credit.total_ttc, credit.issuance_snapshot
    FROM public.invoices AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.credit_note_for = p_source_invoice_id
      AND credit.invoice_type = 'avoir'
      AND credit.id IS DISTINCT FROM p_current_credit_id
      AND (credit.status IN ('sending', 'sent', 'viewed', 'partial', 'paid', 'overdue')
           OR (credit.status = 'cancelled' AND credit.unissued_cancelled_at IS NULL))
    ORDER BY credit.issue_date NULLS FIRST, credit.id
  LOOP
    v_prior_snapshot := v_prior.issuance_snapshot;
    IF v_prior_snapshot IS NULL
       OR v_prior_snapshot #>> '{invoice,id}' IS DISTINCT FROM v_prior.id::TEXT
       OR v_prior_snapshot #>> '{invoice,invoice_type}' IS DISTINCT FROM 'avoir'
       OR v_prior_snapshot #>> '{invoice,credit_note_for}' IS DISTINCT FROM p_source_invoice_id::TEXT
       OR v_prior_snapshot #>> '{invoice,number}' IS DISTINCT FROM v_prior.number
       OR v_prior_snapshot #>> '{invoice,issue_date}' IS DISTINCT FROM v_prior.issue_date::TEXT
       OR ROUND(COALESCE((v_prior_snapshot #>> '{invoice,total_ht}')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_prior.total_ht, 0), 2)
       OR ROUND(COALESCE((v_prior_snapshot #>> '{invoice,total_tva}')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_prior.total_tva, 0), 2)
       OR ROUND(COALESCE((v_prior_snapshot #>> '{invoice,total_ttc}')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_prior.total_ttc, 0), 2) THEN
      RAISE EXCEPTION 'Un avoir précédent ne possède pas d’autorité émise vérifiable' USING ERRCODE = '23514';
    END IF;
    v_prior_breakdown := public.invoice_vat_breakdown_from_snapshot_v221(v_prior_snapshot);
    FOR v_prior_bucket IN SELECT value FROM jsonb_array_elements(v_prior_breakdown)
    LOOP
      v_rate_key := TO_CHAR((v_prior_bucket->>'rate')::NUMERIC, 'FM999999990.00');
      v_existing_bucket := COALESCE(v_credited_map->v_rate_key, '{}'::JSONB);
      v_credited_map := jsonb_set(
        v_credited_map,
        ARRAY[v_rate_key],
        jsonb_build_object(
          'taxable_basis', ROUND(
            COALESCE((v_existing_bucket->>'taxable_basis')::NUMERIC, 0)
            + (v_prior_bucket->>'taxable_basis')::NUMERIC,
            2
          ),
          'tax_amount', ROUND(
            COALESCE((v_existing_bucket->>'tax_amount')::NUMERIC, 0)
            + (v_prior_bucket->>'tax_amount')::NUMERIC,
            2
          )
        ),
        true
      );
    END LOOP;
    v_credited_applied_acompte_ht := ROUND(
      v_credited_applied_acompte_ht
      + COALESCE(NULLIF(v_prior_snapshot #>> '{invoice,applied_acompte_ht}', '')::NUMERIC, 0),
      2
    );
  END LOOP;

  FOR v_source_bucket IN SELECT value FROM jsonb_array_elements(v_source_breakdown)
  LOOP
    v_rate_key := TO_CHAR((v_source_bucket->>'rate')::NUMERIC, 'FM999999990.00');
    v_existing_bucket := COALESCE(v_credited_map->v_rate_key, '{}'::JSONB);
    v_source_basis := (v_source_bucket->>'taxable_basis')::NUMERIC;
    v_source_tax := (v_source_bucket->>'tax_amount')::NUMERIC;
    v_prior_basis := COALESCE((v_existing_bucket->>'taxable_basis')::NUMERIC, 0);
    v_prior_tax := COALESCE((v_existing_bucket->>'tax_amount')::NUMERIC, 0);
    v_remaining_basis := ROUND(v_source_basis - v_prior_basis, 2);
    v_remaining_tax := ROUND(v_source_tax - v_prior_tax, 2);
    IF v_remaining_basis < 0 OR v_remaining_tax < 0
       OR (v_remaining_basis = 0 AND v_remaining_tax <> 0) THEN
      RAISE EXCEPTION 'Les avoirs précédents dépassent une tranche de la facture source' USING ERRCODE = '23514';
    END IF;
    IF v_remaining_basis > 0 THEN
      v_total_ht := ROUND(v_total_ht + v_remaining_basis, 2);
      v_total_tva := ROUND(v_total_tva + v_remaining_tax, 2);
      v_breakdown := v_breakdown || jsonb_build_array(
        jsonb_build_object(
          'rate', (v_source_bucket->>'rate')::NUMERIC,
          'taxable_basis', v_remaining_basis,
          'tax_amount', v_remaining_tax
        )
      );
    END IF;
  END LOOP;
  v_total_ttc := ROUND(v_total_ht + v_total_tva, 2);
  IF v_total_ht <= 0 THEN
    RAISE EXCEPTION 'La facture source a déjà été intégralement créditée' USING ERRCODE = '23514';
  END IF;
  IF v_source_applied_acompte_ht IS NULL THEN
    v_remaining_applied_acompte_ht := NULL;
  ELSE
    v_remaining_applied_acompte_ht := ROUND(v_source_applied_acompte_ht - v_credited_applied_acompte_ht, 2);
    IF v_remaining_applied_acompte_ht < 0 THEN
      RAISE EXCEPTION 'L’apurement d’acompte des avoirs précédents dépasse la facture source' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'vat_breakdown', v_breakdown,
    'total_ht', v_total_ht,
    'total_tva', v_total_tva,
    'total_ttc', v_total_ttc,
    'applied_acompte_ht', v_remaining_applied_acompte_ht,
    'is_reverse_charge', COALESCE((v_source_facts->>'is_reverse_charge')::BOOLEAN, false),
    'is_vat_subject', COALESCE((v_source_snapshot #>> '{seller,is_vat_subject}')::BOOLEAN, true)
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.credit_note_authority_vat_breakdown_v221(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.invoice_credited_ttc_v221(
  p_organization_id UUID,
  p_invoice_id UUID
)
RETURNS NUMERIC(12,2)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source public.invoices%ROWTYPE;
  v_credit RECORD;
  v_snapshot JSONB;
  v_breakdown JSONB;
  v_credit_ttc NUMERIC(12,2);
  v_total NUMERIC(12,2) := 0;
  v_snapshot_source_id UUID;
BEGIN
  SELECT * INTO v_source
  FROM public.invoices AS source
  WHERE source.id = p_invoice_id
    AND source.organization_id = p_organization_id;
  IF NOT FOUND OR v_source.invoice_type = 'avoir' THEN
    RAISE EXCEPTION 'Facture source indisponible pour le calcul des avoirs' USING ERRCODE = '23514';
  END IF;

  FOR v_credit IN
    SELECT credit.id, credit.credit_note_for, credit.issuance_snapshot
    FROM public.invoices AS credit
    WHERE credit.organization_id = p_organization_id
      AND credit.invoice_type = 'avoir'
      AND (credit.status IN ('sent', 'viewed', 'partial', 'paid', 'overdue')
           OR (credit.status = 'cancelled' AND credit.unissued_cancelled_at IS NULL))
    ORDER BY credit.id
  LOOP
    v_snapshot := v_credit.issuance_snapshot;
    v_snapshot_source_id := NULLIF(v_snapshot #>> '{invoice,credit_note_for}', '')::UUID;
    IF v_snapshot IS NULL
       OR v_snapshot->>'schema_version' IS DISTINCT FROM '1'
       OR v_snapshot #>> '{invoice,id}' IS DISTINCT FROM v_credit.id::TEXT
       OR v_snapshot #>> '{invoice,invoice_type}' IS DISTINCT FROM 'avoir' THEN
      IF v_credit.credit_note_for = p_invoice_id OR v_snapshot_source_id = p_invoice_id THEN
        RAISE EXCEPTION 'Autorité d’un avoir émis indisponible pour le calcul du solde' USING ERRCODE = '23514';
      END IF;
      CONTINUE;
    END IF;
    IF v_snapshot_source_id IS DISTINCT FROM v_credit.credit_note_for THEN
      IF v_snapshot_source_id = p_invoice_id OR v_credit.credit_note_for = p_invoice_id THEN
        RAISE EXCEPTION 'La référence mutable d’un avoir contredit son autorité émise' USING ERRCODE = '23514';
      END IF;
      CONTINUE;
    END IF;
    IF v_snapshot_source_id IS DISTINCT FROM p_invoice_id THEN
      CONTINUE;
    END IF;
    v_breakdown := public.invoice_vat_breakdown_from_snapshot_v221(v_snapshot);
    v_credit_ttc := ROUND((v_snapshot #>> '{invoice,total_ttc}')::NUMERIC, 2);
    IF v_credit_ttc <= 0
       OR v_credit_ttc IS DISTINCT FROM ROUND(
         COALESCE((v_snapshot #>> '{invoice,total_ht}')::NUMERIC, 0)
         + COALESCE((v_snapshot #>> '{invoice,total_tva}')::NUMERIC, 0),
         2
       ) THEN
      RAISE EXCEPTION 'Montant TTC invalide dans l’autorité d’un avoir émis' USING ERRCODE = '23514';
    END IF;
    v_total := ROUND(v_total + v_credit_ttc, 2);
  END LOOP;
  RETURN v_total;
END;
$function$;
REVOKE ALL ON FUNCTION public.invoice_credited_ttc_v221(UUID, UUID) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.capture_invoice_issuance_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_seller JSONB;
  v_buyer JSONB;
  v_quote JSONB;
  v_quote_snapshot JSONB;
  v_chantier JSONB;
  v_items JSONB;
  v_payment_schedule JSONB;
  v_source_snapshot JSONB;
  v_authority JSONB;
  v_expected_breakdown JSONB;
  v_line_breakdown JSONB;
  v_line_bucket JSONB;
  v_expected_bucket JSONB;
  v_issued_at TIMESTAMPTZ := clock_timestamp();
  v_is_vat_subject BOOLEAN;
  v_total_ht NUMERIC;
  v_total_tva NUMERIC;
  v_line_basis NUMERIC;
  v_expected_rate NUMERIC;
  v_expected_basis NUMERIC;
  v_special BOOLEAN := false;
BEGIN
  IF TG_OP = 'INSERT' AND NEW.unissued_cancelled_at IS NOT NULL THEN
    RAISE EXCEPTION 'Unissued-cancellation provenance is created exclusively by the database';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.historical_import IS NOT NULL THEN
      IF auth.role() IS DISTINCT FROM 'service_role'
         OR NEW.historical_import->>'source' IS DISTINCT FROM 'csv'
         OR NEW.status IS DISTINCT FROM 'draft'
         OR NEW.issuance_snapshot IS NOT NULL THEN
        RAISE EXCEPTION 'Historical invoice imports require trusted CSV staging';
      END IF;
      NEW.historical_import := jsonb_build_object(
        'source', 'csv',
        'verification', 'unverified',
        'state', 'staging',
        'imported_at', clock_timestamp()
      );
    END IF;
    IF NEW.issuance_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Invoice issuance authority is created exclusively by the database';
    END IF;
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Invoices must be inserted as drafts before issuance';
    END IF;
    PERFORM 1 FROM public.organizations
    WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'An erased organization cannot create an invoice' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.unissued_cancelled_at IS DISTINCT FROM OLD.unissued_cancelled_at THEN
    RAISE EXCEPTION 'Unissued-cancellation provenance is immutable';
  END IF;
  IF OLD.unissued_cancelled_at IS NOT NULL
     AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'An unissued cancelled invoice cannot be reopened';
  END IF;

  IF NEW.historical_import IS DISTINCT FROM OLD.historical_import THEN
    IF OLD.status = 'draft'
       AND OLD.historical_import->>'state' = 'staging'
       AND NEW.historical_import IS NOT DISTINCT FROM
         (OLD.historical_import || jsonb_build_object('state', 'finalized'))
       AND OLD.issuance_snapshot IS NULL
       AND NEW.issuance_snapshot IS NULL
       AND auth.role() = 'service_role'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by THEN
      PERFORM 1 FROM public.organizations
      WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'An erased organization cannot finalize a historical invoice import' USING ERRCODE = '42501';
      END IF;
      NEW.historical_import := NEW.historical_import || jsonb_build_object('finalized_at', clock_timestamp());
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Historical invoice import provenance is immutable';
  END IF;

  IF OLD.historical_import->>'state' = 'staging'
     AND OLD.status = 'draft'
     AND NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'A historical invoice import must be finalized before changing its status';
  END IF;
  IF OLD.status = 'sending'
     AND NEW.status = 'draft'
     AND OLD.sent_at IS NULL
     AND NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at
     AND auth.role() = 'service_role' THEN
    NEW.issuance_snapshot := NULL;
    RETURN NEW;
  END IF;

  IF NEW.issuance_snapshot IS DISTINCT FROM OLD.issuance_snapshot THEN
    RAISE EXCEPTION 'L''autorité d''émission d''une facture est immuable';
  END IF;
  IF OLD.issuance_snapshot IS NOT NULL
     AND (NEW.vat_breakdown IS DISTINCT FROM OLD.vat_breakdown
          OR NEW.applied_acompte_ht IS DISTINCT FROM OLD.applied_acompte_ht) THEN
    RAISE EXCEPTION 'La répartition TVA et l’apurement d’acompte d’une facture émise sont immuables';
  END IF;

  IF OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft' THEN
    IF OLD.issuance_snapshot IS NOT NULL OR NEW.issuance_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Un brouillon ne peut pas réutiliser une autorité d''émission antérieure';
    END IF;
    PERFORM 1 FROM public.organizations
    WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Organisation émettrice indisponible pendant l''émission' USING ERRCODE = '42501';
    END IF;
    IF NEW.status = 'cancelled' THEN
      NEW.unissued_cancelled_at := clock_timestamp();
      RETURN NEW;
    END IF;
    SELECT COALESCE(is_vat_subject, true) INTO v_is_vat_subject
    FROM public.organizations
    WHERE id = NEW.organization_id;

    IF NEW.invoice_type = 'solde' THEN
      v_authority := public.quote_balance_authority_v221(NEW.organization_id, NEW.quote_id, NEW.id);
      v_special := true;
    ELSIF NEW.invoice_type = 'avoir' THEN
      SELECT source.issuance_snapshot INTO v_source_snapshot
      FROM public.invoices AS source
      WHERE source.id = NEW.credit_note_for
        AND source.organization_id = NEW.organization_id
      FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'La facture source de l’avoir est indisponible' USING ERRCODE = '23514';
      END IF;
      v_authority := public.credit_note_authority_vat_breakdown_v221(
        NEW.organization_id, NEW.credit_note_for, NEW.id
      );
      v_special := true;
    END IF;

    IF v_special THEN
      v_expected_breakdown := v_authority->'vat_breakdown';
      IF NEW.total_ht IS DISTINCT FROM (v_authority->>'total_ht')::NUMERIC
         OR NEW.total_tva IS DISTINCT FROM (v_authority->>'total_tva')::NUMERIC
         OR NEW.total_ttc IS DISTINCT FROM (v_authority->>'total_ttc')::NUMERIC
         OR NEW.is_reverse_charge IS DISTINCT FROM COALESCE((v_authority->>'is_reverse_charge')::BOOLEAN, false)
         OR NEW.vat_breakdown IS DISTINCT FROM v_expected_breakdown
         OR NEW.applied_acompte_ht IS DISTINCT FROM NULLIF(v_authority->>'applied_acompte_ht', '')::NUMERIC THEN
        RAISE EXCEPTION 'Les totaux, la TVA ou l’imputation ne correspondent pas à l’autorité acceptée' USING ERRCODE = '23514';
      END IF;
      IF EXISTS (
        SELECT 1 FROM public.invoice_items AS i
        WHERE i.invoice_id = NEW.id
          AND i.is_internal IS DISTINCT FROM TRUE
          AND i.unit IS DISTINCT FROM '__section__'
          AND (COALESCE(i.quantity, 0) < 0 OR i.unit_price < 0
               OR (i.total_ht IS NOT NULL
                   AND i.total_ht IS DISTINCT FROM ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2)))
      ) THEN
        RAISE EXCEPTION 'Les lignes d’un solde ou avoir doivent correspondre à des montants positifs vérifiables' USING ERRCODE = '23514';
      END IF;
      SELECT COALESCE(jsonb_agg(bucket ORDER BY (bucket->>'rate')::NUMERIC), '[]'::JSONB)
      INTO v_line_breakdown
      FROM jsonb_array_elements(public.vat_breakdown_from_items_v221(
        COALESCE((
          SELECT jsonb_agg(jsonb_build_object(
            'quantity', i.quantity, 'unit_price', i.unit_price, 'vat_rate', i.vat_rate,
            'unit', i.unit, 'is_internal', i.is_internal
          ) ORDER BY i.position, i.id)
          FROM public.invoice_items AS i WHERE i.invoice_id = NEW.id
        ), '[]'::JSONB),
        COALESCE((v_authority->>'is_vat_subject')::BOOLEAN, v_is_vat_subject),
        COALESCE((v_authority->>'is_reverse_charge')::BOOLEAN, false),
        0
      )) AS line_bucket(bucket);
      IF jsonb_array_length(v_line_breakdown) <> jsonb_array_length(v_expected_breakdown) THEN
        RAISE EXCEPTION 'Les bases des lignes ne correspondent pas à l’autorité TVA' USING ERRCODE = '23514';
      END IF;
      FOR v_expected_bucket IN SELECT value FROM jsonb_array_elements(v_expected_breakdown)
      LOOP
        v_expected_rate := (v_expected_bucket->>'rate')::NUMERIC;
        v_expected_basis := (v_expected_bucket->>'taxable_basis')::NUMERIC;
        SELECT value INTO v_line_bucket
        FROM jsonb_array_elements(v_line_breakdown)
        WHERE (value->>'rate')::NUMERIC = v_expected_rate;
        IF NOT FOUND
           OR (v_line_bucket->>'taxable_basis')::NUMERIC IS DISTINCT FROM v_expected_basis THEN
          RAISE EXCEPTION 'Les bases des lignes ne correspondent pas à l’autorité TVA' USING ERRCODE = '23514';
        END IF;
      END LOOP;
      v_total_ht := (v_authority->>'total_ht')::NUMERIC;
      v_total_tva := (v_authority->>'total_tva')::NUMERIC;
      v_is_vat_subject := COALESCE((v_authority->>'is_vat_subject')::BOOLEAN, true);
      IF NEW.invoice_type = 'avoir' THEN
        IF NEW.invoice_type_code IS DISTINCT FROM '381'
           OR NEW.preceding_invoice_ref IS DISTINCT FROM v_source_snapshot #>> '{invoice,number}'
           OR NEW.preceding_invoice_date::TEXT IS DISTINCT FROM v_source_snapshot #>> '{invoice,issue_date}' THEN
          RAISE EXCEPTION 'La référence légale de l’avoir ne correspond pas à sa facture source' USING ERRCODE = '23514';
        END IF;
      END IF;
    ELSE
      IF NEW.vat_breakdown IS NOT NULL OR NEW.applied_acompte_ht IS NOT NULL THEN
        RAISE EXCEPTION 'La répartition TVA et l’apurement sont réservés aux autorités de solde ou d’avoir' USING ERRCODE = '23514';
      END IF;
      WITH invoice_lines AS (
        SELECT COALESCE(i.vat_rate, 0) AS vat_rate,
               ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2) AS line_ht
        FROM public.invoice_items AS i
        WHERE i.invoice_id = NEW.id
          AND i.is_internal IS DISTINCT FROM TRUE
          AND i.unit IS DISTINCT FROM '__section__'
      ),
      vat_buckets AS (
        SELECT vat_rate, ROUND(SUM(line_ht), 2) AS taxable_basis
        FROM invoice_lines
        GROUP BY vat_rate
      )
      SELECT COALESCE(SUM(b.taxable_basis), 0),
             CASE
               WHEN v_is_vat_subject AND NEW.is_reverse_charge IS NOT TRUE
                 THEN COALESCE(SUM(ROUND(b.taxable_basis * b.vat_rate / 100, 2)), 0)
               ELSE 0
             END
      INTO v_total_ht, v_total_tva
      FROM vat_buckets AS b;
      IF ROUND(COALESCE(NEW.total_ht, 0), 2) IS DISTINCT FROM ROUND(v_total_ht, 2)
         OR ROUND(COALESCE(NEW.total_tva, 0), 2) IS DISTINCT FROM ROUND(v_total_tva, 2)
         OR ROUND(COALESCE(NEW.total_ttc, 0), 2) IS DISTINCT FROM ROUND(v_total_ht + v_total_tva, 2) THEN
        RAISE EXCEPTION 'Invoice totals do not match current issuance VAT treatment' USING ERRCODE = '23514';
      END IF;
    END IF;

    IF NOT v_is_vat_subject AND NEW.is_reverse_charge IS TRUE THEN
      RAISE EXCEPTION 'L’autoliquidation n’est pas compatible avec la franchise de TVA.' USING ERRCODE = '23514';
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.invoice_items AS i
      WHERE i.invoice_id = NEW.id
        AND i.is_internal IS DISTINCT FROM TRUE
        AND i.unit IS DISTINCT FROM '__section__'
        AND (
          (i.total_ht IS NOT NULL
           AND i.total_ht IS DISTINCT FROM ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2))
          OR (NOT v_special AND i.vat_amount IS NOT NULL
              AND i.vat_amount IS DISTINCT FROM ROUND(
                ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2) * COALESCE(i.vat_rate, 0) / 100,
                2
              ))
        )
    ) THEN
      RAISE EXCEPTION 'Invoice line subtotals do not match their quantity, price and VAT rate'
        USING ERRCODE = '23514';
    END IF;

    SELECT jsonb_build_object(
      'id', o.id, 'name', o.name, 'siret', o.siret, 'siren', o.siren,
      'vat_number', o.vat_number, 'email', o.email, 'email_from_name', o.email_from_name,
      'email_from_address', o.email_from_address, 'phone', o.phone,
      'address_line1', o.address_line1, 'address_line2', o.address_line2,
      'city', o.city, 'postal_code', o.postal_code, 'country', o.country,
      'logo_url', o.logo_url, 'primary_color', o.primary_color,
      'forme_juridique', o.forme_juridique, 'capital_social', o.capital_social,
      'rcs', o.rcs, 'rcs_ville', o.rcs_ville, 'insurance_info', o.insurance_info,
      'certifications', o.certifications, 'decennale_enabled', o.decennale_enabled,
      'decennale_assureur', o.decennale_assureur, 'decennale_police', o.decennale_police,
      'decennale_couverture', o.decennale_couverture,
      'decennale_date_debut', o.decennale_date_debut, 'decennale_date_fin', o.decennale_date_fin,
      'payment_terms_days', o.payment_terms_days, 'late_penalty_rate', o.late_penalty_rate,
      'court_competent', o.court_competent, 'iban', o.iban, 'bic', o.bic,
      'bank_name', o.bank_name, 'recovery_indemnity_text', o.recovery_indemnity_text,
      'is_vat_subject', o.is_vat_subject, 'tva_sur_debits', o.tva_sur_debits,
      'business_profile', o.business_profile, 'default_vat_rate', o.default_vat_rate
    ) INTO v_seller
    FROM public.organizations AS o WHERE o.id = NEW.organization_id;

    IF NEW.invoice_type = 'avoir'
       AND (
         v_seller->>'id' IS DISTINCT FROM v_source_snapshot #>> '{seller,id}'
         OR v_seller->>'siren' IS DISTINCT FROM v_source_snapshot #>> '{seller,siren}'
       ) THEN
      RAISE EXCEPTION 'Le SIREN de l’émetteur a changé depuis l’émission source ; aucun avoir ne peut être émis' USING ERRCODE = '23514';
    END IF;

    IF NEW.client_id IS NOT NULL THEN
      PERFORM 1 FROM public.clients
      WHERE id = NEW.client_id AND organization_id = NEW.organization_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Client de la facture introuvable dans son organisation';
      END IF;
      SELECT jsonb_build_object(
        'id', c.id, 'type', c.type, 'company_name', c.company_name,
        'contact_name', c.contact_name, 'first_name', c.first_name, 'last_name', c.last_name,
        'email', c.email, 'phone', c.phone, 'address_line1', c.address_line1,
        'address_line2', c.address_line2, 'postal_code', c.postal_code,
        'city', c.city, 'country', c.country, 'siret', c.siret, 'siren', c.siren,
        'vat_number', c.vat_number
      ) INTO v_buyer
      FROM public.clients AS c
      WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id;
    END IF;

    IF NEW.quote_id IS NOT NULL THEN
      PERFORM 1 FROM public.quotes
      WHERE id = NEW.quote_id AND organization_id = NEW.organization_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Devis lié introuvable dans son organisation';
      END IF;
      SELECT jsonb_build_object('id', q.id, 'number', q.number, 'title', q.title)
      INTO v_quote
      FROM public.quotes AS q
      WHERE q.id = NEW.quote_id AND q.organization_id = NEW.organization_id;
    END IF;
    IF NEW.chantier_id IS NOT NULL THEN
      PERFORM 1 FROM public.chantiers
      WHERE id = NEW.chantier_id AND organization_id = NEW.organization_id FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Chantier lié introuvable dans son organisation';
      END IF;
      SELECT jsonb_build_object('id', ch.id, 'title', ch.title)
      INTO v_chantier
      FROM public.chantiers AS ch
      WHERE ch.id = NEW.chantier_id AND ch.organization_id = NEW.organization_id;
    END IF;

    IF NEW.invoice_type = 'solde' THEN
      SELECT q.document_snapshot INTO v_quote_snapshot
      FROM public.quotes AS q
      WHERE q.id = NEW.quote_id AND q.organization_id = NEW.organization_id;
      v_seller := v_quote_snapshot->'organization';
      v_buyer := v_quote_snapshot #> '{quote,client}';
      v_quote := v_quote_snapshot->'quote';
    ELSIF NEW.invoice_type = 'avoir' THEN
      v_seller := v_source_snapshot->'seller';
      v_buyer := v_source_snapshot->'buyer';
      v_quote := v_source_snapshot->'quote';
      v_chantier := v_source_snapshot->'chantier';
    END IF;
    IF v_special AND NEW.client_id IS DISTINCT FROM NULLIF(v_buyer->>'id', '')::UUID THEN
      RAISE EXCEPTION 'Le destinataire du décompte ne correspond pas au document source.' USING ERRCODE = '23514';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'description', i.description,
      'quantity', i.quantity,
      'unit', i.unit,
      'unit_price', i.unit_price,
      'unit_cost_ht', i.unit_cost_ht,
      'vat_rate', i.vat_rate,
      'vat_amount', CASE
        WHEN NOT COALESCE((v_seller->>'is_vat_subject')::BOOLEAN, true)
             OR COALESCE(NEW.is_reverse_charge, false) THEN 0
        WHEN v_special THEN ROUND(
          ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2) * COALESCE(i.vat_rate, 0) / 100, 2
        )
        ELSE COALESCE(i.vat_amount, ROUND(
          ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2) * COALESCE(i.vat_rate, 0) / 100, 2
        ))
      END,
      'vat_exemption_code', i.vat_exemption_code,
      'total_ht', COALESCE(i.total_ht, ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2)),
      'position', i.position,
      'length_m', i.length_m,
      'width_m', i.width_m,
      'height_m', i.height_m,
      'dim_quantity', i.dim_quantity,
      'is_internal', i.is_internal,
      'dimension_values', i.dimension_values,
      'variant_label', i.variant_label
    ) ORDER BY i.position, i.id), '[]'::JSONB)
    INTO v_items
    FROM public.invoice_items AS i
    WHERE i.invoice_id = NEW.id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id, 'label', s.label, 'due_date', s.due_date, 'amount', s.amount,
      'amount_type', s.amount_type, 'percentage', s.percentage,
      'position', s.position, 'paid_payment_id', s.paid_payment_id
    ) ORDER BY s.position, s.id), '[]'::JSONB)
    INTO v_payment_schedule
    FROM public.invoice_payment_schedule AS s
    WHERE s.invoice_id = NEW.id AND s.organization_id = NEW.organization_id;

    NEW.issuance_snapshot := jsonb_build_object(
      'schema_version', 1,
      'issued_at', v_issued_at,
      'invoice', jsonb_build_object(
        'id', NEW.id,
        'number', NEW.number,
        'title', NEW.title,
        'invoice_type', NEW.invoice_type,
        'total_ht', NEW.total_ht,
        'total_tva', NEW.total_tva,
        'total_ttc', NEW.total_ttc,
        'currency', NEW.currency,
        'issue_date', NEW.issue_date,
        'due_date', NEW.due_date,
        'balance_due_date', NEW.balance_due_date,
        'payment_terms_days', NEW.payment_terms_days,
        'notes_client', NEW.notes_client,
        'payment_conditions', NEW.payment_conditions,
        'discount_rate', NEW.discount_rate,
        'discount_amount', NEW.discount_amount,
        'deposit_rate', NEW.deposit_rate,
        'deposit_amount', NEW.deposit_amount,
        'aid_label', NEW.aid_label,
        'aid_amount', NEW.aid_amount,
        'quote_id', NEW.quote_id,
        'client_id', NEW.client_id,
        'chantier_id', NEW.chantier_id,
        'situation_number', NEW.situation_number,
        'cumulative_pct', NEW.cumulative_pct,
        'period_from', NEW.period_from,
        'period_to', NEW.period_to,
        'retention_pct', NEW.retention_pct,
        'retention_amount', NEW.retention_amount,
        'market_reference', NEW.market_reference,
        'is_reverse_charge', NEW.is_reverse_charge,
        'recipient_siren', NEW.recipient_siren,
        'recipient_siret', NEW.recipient_siret,
        'einvoicing_mandatory', NEW.einvoicing_mandatory,
        'buyer_reference', NEW.buyer_reference,
        'purchase_order_ref', NEW.purchase_order_ref,
        'invoice_type_code', NEW.invoice_type_code,
        'credit_note_for', NEW.credit_note_for,
        'preceding_invoice_ref', NEW.preceding_invoice_ref,
        'preceding_invoice_date', NEW.preceding_invoice_date,
        'facturx_level', NEW.facturx_level,
        'operation_type', NEW.operation_type,
        'tva_sur_debits', NEW.tva_sur_debits,
        'delivery_address_line1', NEW.delivery_address_line1,
        'delivery_address_line2', NEW.delivery_address_line2,
        'delivery_city', NEW.delivery_city,
        'delivery_postal_code', NEW.delivery_postal_code,
        'delivery_country', NEW.delivery_country
      ) || jsonb_build_object(
        'vat_breakdown', NEW.vat_breakdown,
        'applied_acompte_ht', NEW.applied_acompte_ht,
        'created_at', NEW.created_at
      ),
      'seller', v_seller,
      'buyer', v_buyer,
      'chantier', v_chantier,
      'quote', v_quote,
      'items', v_items,
      'payment_schedule', v_payment_schedule
    );
  END IF;

  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION public.guard_single_quote_solde()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_authority JSONB;
BEGIN
  IF NEW.invoice_type = 'solde'
     AND (TG_OP = 'INSERT' OR OLD.invoice_type IS DISTINCT FROM 'solde')
     AND auth.role() = 'authenticated'
     AND NOT public.user_has_permission('invoices.create_solde') THEN
    RAISE EXCEPTION 'Permission refusée' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.invoice_type = 'solde'
     AND NEW.invoice_type IS DISTINCT FROM 'solde' THEN
    RAISE EXCEPTION 'Le type solde d’une facture est immuable' USING ERRCODE = '23514';
  END IF;
  IF NEW.invoice_type IS DISTINCT FROM 'solde' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  IF NEW.quote_id IS NULL THEN
    RAISE EXCEPTION 'Un solde doit rester lié à son devis accepté' USING ERRCODE = '23514';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.organization_id::TEXT), hashtext(NEW.quote_id::TEXT));
  IF EXISTS (
    SELECT 1
    FROM public.invoices AS prior
    WHERE prior.organization_id = NEW.organization_id
      AND prior.quote_id = NEW.quote_id
      AND prior.invoice_type = 'solde'
      AND prior.id IS DISTINCT FROM NEW.id
      AND (prior.status <> 'cancelled' OR prior.unissued_cancelled_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'Un solde existe déjà pour ce devis' USING ERRCODE = '23505';
  END IF;

  v_authority := public.quote_balance_authority_v221(NEW.organization_id, NEW.quote_id, NEW.id);
  IF NEW.total_ht IS DISTINCT FROM (v_authority->>'total_ht')::NUMERIC
     OR NEW.total_tva IS DISTINCT FROM (v_authority->>'total_tva')::NUMERIC
     OR NEW.total_ttc IS DISTINCT FROM (v_authority->>'total_ttc')::NUMERIC
     OR NEW.is_reverse_charge IS DISTINCT FROM COALESCE((v_authority->>'is_reverse_charge')::BOOLEAN, false)
     OR NEW.vat_breakdown IS DISTINCT FROM v_authority->'vat_breakdown'
     OR NEW.applied_acompte_ht IS DISTINCT FROM NULLIF(v_authority->>'applied_acompte_ht', '')::NUMERIC THEN
    RAISE EXCEPTION 'Les totaux, la TVA ou l’imputation ne correspondent pas à l’autorité acceptée' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_guard_single_quote_solde ON public.invoices;
CREATE TRIGGER trg_guard_single_quote_solde
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.guard_single_quote_solde();
REVOKE ALL ON FUNCTION public.guard_single_quote_solde() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.create_quote_balance_invoice(p_quote_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_quote public.quotes%ROWTYPE;
  v_authority JSONB;
  v_breakdown JSONB;
  v_client_terms INTEGER;
  v_org_terms INTEGER;
  v_payment_terms INTEGER;
  v_issue_date DATE := CURRENT_DATE;
  v_due_date DATE;
  v_invoice_id UUID;
  v_situation_number INTEGER;
  v_total_ht NUMERIC(12,2);
  v_total_tva NUMERIC(12,2);
  v_total_ttc NUMERIC(12,2);
  v_applied_acompte_ht NUMERIC(12,2);
  v_is_reverse_charge BOOLEAN;
  v_rate RECORD;
  v_position INTEGER := 0;
  v_notes TEXT;
  v_quote_number TEXT;
  v_quote_title TEXT;
BEGIN
  v_user_id := auth.uid();
  v_org_id := public.get_user_org_id();
  IF v_user_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_permission('invoices.create_solde') THEN
    RAISE EXCEPTION 'Permission refusée' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = p_quote_id AND organization_id = v_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Devis introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_quote.status NOT IN ('accepted', 'converted', 'fully_invoiced') THEN
    RAISE EXCEPTION 'Le devis doit être accepté avant de créer son solde' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoices AS prior
    WHERE prior.organization_id = v_org_id
      AND prior.quote_id = v_quote.id
      AND prior.invoice_type = 'solde'
      AND (prior.status <> 'cancelled' OR prior.unissued_cancelled_at IS NULL)
  ) THEN
    RAISE EXCEPTION 'Un solde existe déjà pour ce devis' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoices AS pending
    WHERE pending.organization_id = v_org_id
      AND pending.quote_id = v_quote.id
      AND pending.invoice_type <> 'avoir'
      AND pending.status IN ('draft', 'sending')
  ) THEN
    RAISE EXCEPTION 'Finalisez ou annulez le brouillon de facture déjà lié à ce devis avant de créer son solde' USING ERRCODE = '23514';
  END IF;

  v_authority := public.quote_balance_authority_v221(v_org_id, v_quote.id, NULL);
  v_breakdown := v_authority->'vat_breakdown';
  v_total_ht := (v_authority->>'total_ht')::NUMERIC;
  v_total_tva := (v_authority->>'total_tva')::NUMERIC;
  v_total_ttc := (v_authority->>'total_ttc')::NUMERIC;
  v_applied_acompte_ht := (v_authority->>'applied_acompte_ht')::NUMERIC;
  v_is_reverse_charge := COALESCE((v_authority->>'is_reverse_charge')::BOOLEAN, false);
  v_quote_number := NULLIF(v_quote.document_snapshot #>> '{quote,number}', '');
  v_quote_title := COALESCE(NULLIF(v_quote.document_snapshot #>> '{quote,title}', ''), 'devis ' || v_quote_number);
  IF v_quote_number IS NULL OR NULLIF(v_quote.document_snapshot #>> '{quote,client,id}', '') IS NULL THEN
    RAISE EXCEPTION 'Les informations publiées du devis accepté sont incomplètes' USING ERRCODE = '23514';
  END IF;

  SELECT o.payment_terms_days
  INTO v_org_terms
  FROM public.organizations AS o
  WHERE o.id = v_org_id AND o.anonymized_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation indisponible' USING ERRCODE = '42501';
  END IF;
  SELECT c.payment_terms_days INTO v_client_terms
  FROM public.clients AS c
  WHERE c.id = v_quote.client_id AND c.organization_id = v_org_id;
  v_payment_terms := LEAST(90, GREATEST(0, ROUND(COALESCE(v_client_terms, v_org_terms, 30))::INTEGER));
  v_due_date := v_issue_date + v_payment_terms;

  SELECT COALESCE(MAX(prior.situation_number), 0) + 1
  INTO v_situation_number
  FROM public.invoices AS prior
  WHERE prior.organization_id = v_org_id
    AND prior.quote_id = v_quote.id
    AND prior.invoice_type IN ('situation', 'solde');

  v_notes := 'Solde du devis ' || v_quote_number ||
    '. Les acomptes et factures d’avancement déjà émis sont déduits.';
  IF v_applied_acompte_ht > 0 THEN
    v_notes := v_notes || ' Acomptes HT déjà facturés et déjà déduits : ' ||
      REPLACE(TO_CHAR(v_applied_acompte_ht, 'FM999999990.00'), '.', ',') || ' €.';
  END IF;

  INSERT INTO public.invoices (
    organization_id, client_id, quote_id, chantier_id, invoice_type, title,
    currency, status, created_by, issue_date, due_date, payment_terms_days,
    total_ht, total_tva, total_ttc, payment_conditions, notes_client,
    situation_number, cumulative_pct, is_reverse_charge, vat_breakdown,
    applied_acompte_ht
  ) VALUES (
    v_org_id, (v_quote.document_snapshot #>> '{quote,client,id}')::UUID, v_quote.id,
    NULL,
    'solde', 'Solde · ' || v_quote_title,
    COALESCE(v_quote.document_snapshot #>> '{quote,currency}', 'EUR'),
    'draft', v_user_id, v_issue_date, v_due_date, v_payment_terms,
    v_total_ht, v_total_tva, v_total_ttc,
    v_quote.document_snapshot #>> '{quote,payment_conditions}', v_notes, v_situation_number, 100, v_is_reverse_charge,
    v_breakdown, v_applied_acompte_ht
  ) RETURNING id INTO v_invoice_id;

  FOR v_rate IN
    SELECT (bucket->>'rate')::NUMERIC AS vat_rate,
           (bucket->>'taxable_basis')::NUMERIC AS remaining_ht
    FROM jsonb_array_elements(v_breakdown) AS authority_bucket(bucket)
    ORDER BY (bucket->>'rate')::NUMERIC
  LOOP
    INSERT INTO public.invoice_items (
      invoice_id, description, quantity, unit, unit_price, unit_cost_ht,
      vat_rate, position, is_internal
    ) VALUES (
      v_invoice_id,
      'Solde du devis ' || v_quote_number || ' · TVA ' ||
        REPLACE(TO_CHAR(v_rate.vat_rate, 'FM990.00'), '.', ',') || ' %',
      1, 'forfait', v_rate.remaining_ht, NULL, v_rate.vat_rate, v_position, false
    );
    v_position := v_position + 1;
  END LOOP;

  RETURN v_invoice_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_quote_balance_invoice(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_quote_balance_invoice(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_invoice_credit_note(p_invoice_id UUID, p_reason TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_org_id UUID;
  v_user_id UUID;
  v_source public.invoices%ROWTYPE;
  v_snapshot JSONB;
  v_source_facts JSONB;
  v_authority JSONB;
  v_breakdown JSONB;
  v_credit_id UUID;
  v_credit_count INTEGER;
  v_is_reverse_charge BOOLEAN;
  v_applied_acompte_ht NUMERIC(12,2);
  v_total_ht NUMERIC(12,2);
  v_total_tva NUMERIC(12,2);
  v_total_ttc NUMERIC(12,2);
  v_rate RECORD;
  v_position INTEGER := 0;
  v_notes TEXT;
  v_current_siren TEXT;
BEGIN
  v_user_id := auth.uid();
  v_org_id := public.get_user_org_id();
  IF v_user_id IS NULL OR v_org_id IS NULL THEN
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;
  IF NOT public.user_has_permission('invoices.create_credit') THEN
    RAISE EXCEPTION 'Permission refusée' USING ERRCODE = '42501';
  END IF;
  IF p_reason IS NULL OR LENGTH(BTRIM(p_reason)) < 1 OR LENGTH(BTRIM(p_reason)) > 500 THEN
    RAISE EXCEPTION 'Le motif de l’avoir doit contenir entre 1 et 500 caractères' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source
  FROM public.invoices
  WHERE id = p_invoice_id AND organization_id = v_org_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Facture introuvable' USING ERRCODE = 'P0002';
  END IF;
  IF v_source.status NOT IN ('sent', 'viewed', 'partial', 'paid', 'overdue')
     OR v_source.invoice_type = 'avoir' THEN
    RAISE EXCEPTION 'Un avoir ne peut corriger qu’une facture émise' USING ERRCODE = '23514';
  END IF;

  v_snapshot := v_source.issuance_snapshot;
  v_source_facts := v_snapshot->'invoice';
  IF v_snapshot IS NULL
     OR v_snapshot #>> '{seller,id}' IS DISTINCT FROM v_org_id::TEXT
     OR v_source_facts->>'id' IS DISTINCT FROM v_source.id::TEXT
     OR v_source_facts->>'invoice_type' IS DISTINCT FROM v_source.invoice_type
     OR v_source_facts->>'number' IS DISTINCT FROM v_source.number
     OR v_source_facts->>'issue_date' IS DISTINCT FROM v_source.issue_date::TEXT
     OR v_source_facts->>'currency' IS DISTINCT FROM v_source.currency
     OR NULLIF(v_source_facts->>'number', '') IS NULL
     OR v_source.issue_date IS NULL
     OR ROUND(COALESCE((v_source_facts->>'total_ht')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_source.total_ht, 0), 2)
     OR ROUND(COALESCE((v_source_facts->>'total_tva')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_source.total_tva, 0), 2)
     OR ROUND(COALESCE((v_source_facts->>'total_ttc')::NUMERIC, 0), 2) IS DISTINCT FROM ROUND(COALESCE(v_source.total_ttc, 0), 2)
     OR COALESCE((v_source_facts->>'is_reverse_charge')::BOOLEAN, false) IS DISTINCT FROM v_source.is_reverse_charge THEN
    RAISE EXCEPTION 'L’autorité d’émission de cette facture historique est indisponible pour créer un avoir' USING ERRCODE = '23514';
  END IF;
  SELECT o.siren INTO v_current_siren
  FROM public.organizations AS o
  WHERE o.id = v_org_id AND o.anonymized_at IS NULL
  FOR SHARE;
  IF NOT FOUND OR v_current_siren IS DISTINCT FROM v_snapshot #>> '{seller,siren}' THEN
    RAISE EXCEPTION 'Le SIREN de l’émetteur a changé depuis l’émission source ; aucun avoir ne peut être créé' USING ERRCODE = '23514';
  END IF;

  IF jsonb_typeof(v_snapshot->'items') IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_snapshot->'items') = 0 THEN
    RAISE EXCEPTION 'Les lignes émises de cette facture sont indisponibles' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.invoices AS cn
    WHERE cn.organization_id = v_org_id
      AND cn.credit_note_for = v_source.id
      AND cn.invoice_type = 'avoir'
      AND cn.status IN ('draft', 'sending')
  ) THEN
    RAISE EXCEPTION 'Un avoir lié à cette facture est déjà en préparation ou reste à imputer' USING ERRCODE = '23505';
  END IF;

  SELECT COUNT(*)::INTEGER INTO v_credit_count
  FROM public.invoices AS cn
  WHERE cn.organization_id = v_org_id
    AND cn.credit_note_for = v_source.id
    AND cn.invoice_type = 'avoir'
    AND (cn.status IN ('sent', 'viewed', 'partial', 'paid', 'overdue')
         OR (cn.status = 'cancelled' AND cn.unissued_cancelled_at IS NULL));

  v_authority := public.credit_note_authority_vat_breakdown_v221(v_org_id, v_source.id, NULL);
  v_breakdown := v_authority->'vat_breakdown';
  v_total_ht := (v_authority->>'total_ht')::NUMERIC;
  v_total_tva := (v_authority->>'total_tva')::NUMERIC;
  v_total_ttc := (v_authority->>'total_ttc')::NUMERIC;
  v_applied_acompte_ht := NULLIF(v_authority->>'applied_acompte_ht', '')::NUMERIC;
  v_is_reverse_charge := COALESCE((v_authority->>'is_reverse_charge')::BOOLEAN, false);

  v_notes := 'Avoir relatif à la facture n° ' || (v_source_facts->>'number') ||
    ' du ' || TO_CHAR((v_source_facts->>'issue_date')::DATE, 'DD/MM/YYYY') ||
    '. Motif : ' || BTRIM(p_reason);
  INSERT INTO public.invoices (
    organization_id, client_id, quote_id, chantier_id, invoice_type, is_credit_note,
    credit_note_for, invoice_type_code, preceding_invoice_ref, preceding_invoice_date,
    title, currency, status, created_by, issue_date, due_date, total_ht, total_tva,
    total_ttc, payment_conditions, notes_client, is_reverse_charge, facturx_level,
    vat_breakdown, applied_acompte_ht
  ) VALUES (
    v_org_id,
    NULLIF(v_source_facts->>'client_id', '')::UUID,
    NULLIF(v_source_facts->>'quote_id', '')::UUID,
    NULLIF(v_source_facts->>'chantier_id', '')::UUID,
    'avoir', true, v_source.id, '381', v_source_facts->>'number',
    (v_source_facts->>'issue_date')::DATE,
    'Avoir · facture ' || (v_source_facts->>'number'),
    COALESCE(v_source_facts->>'currency', 'EUR'), 'draft', v_user_id,
    CURRENT_DATE, CURRENT_DATE, v_total_ht, v_total_tva, v_total_ttc,
    v_source_facts->>'payment_conditions', v_notes, v_is_reverse_charge,
    COALESCE(v_source_facts->>'facturx_level', 'EN_16931'),
    v_breakdown, v_applied_acompte_ht
  ) RETURNING id INTO v_credit_id;

  IF v_credit_count = 0 THEN
    INSERT INTO public.invoice_items (
      invoice_id, description, quantity, unit, unit_price, unit_cost_ht,
      vat_rate, position, length_m, width_m, height_m, dim_quantity,
      is_internal, material_id
    )
    SELECT v_credit_id,
           line->>'description',
           COALESCE((line->>'quantity')::NUMERIC, 0),
           NULLIF(line->>'unit', ''),
           COALESCE((line->>'unit_price')::NUMERIC, 0),
           (line->>'unit_cost_ht')::NUMERIC,
           COALESCE((line->>'vat_rate')::NUMERIC, 0),
           COALESCE((line->>'position')::INTEGER, (ordinality - 1)::INTEGER),
           (line->>'length_m')::NUMERIC,
           (line->>'width_m')::NUMERIC,
           (line->>'height_m')::NUMERIC,
           COALESCE((line->>'dim_quantity')::NUMERIC, 1),
           COALESCE((line->>'is_internal')::BOOLEAN, false),
           NULL
    FROM jsonb_array_elements(v_snapshot->'items') WITH ORDINALITY AS source_line(line, ordinality);
  ELSE
    FOR v_rate IN
      SELECT (bucket->>'rate')::NUMERIC AS vat_rate,
             (bucket->>'taxable_basis')::NUMERIC AS remaining_ht
      FROM jsonb_array_elements(v_breakdown) AS authority_bucket(bucket)
      ORDER BY (bucket->>'rate')::NUMERIC
    LOOP
      INSERT INTO public.invoice_items (
        invoice_id, description, quantity, unit, unit_price, vat_rate, position, is_internal
      ) VALUES (
        v_credit_id,
        'Avoir complémentaire · facture ' || (v_source_facts->>'number') || ' · TVA ' ||
          REPLACE(TO_CHAR(v_rate.vat_rate, 'FM990.00'), '.', ',') || ' %',
        1, 'forfait', v_rate.remaining_ht, v_rate.vat_rate, v_position, false
      );
      v_position := v_position + 1;
    END LOOP;
  END IF;

  RETURN v_credit_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_invoice_credit_note(UUID, TEXT) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.create_invoice_credit_note(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.validate_invoice_adjustments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_source public.invoices%ROWTYPE;
  v_authority JSONB;
  v_source_ht NUMERIC(12,2);
  v_source_tva NUMERIC(12,2);
  v_source_ttc NUMERIC(12,2);
  v_credit_ht NUMERIC(12,2);
  v_credit_tva NUMERIC(12,2);
  v_credit_ttc NUMERIC(12,2);
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.invoice_type = 'avoir'
     AND NEW.invoice_type IS DISTINCT FROM 'avoir' THEN
    RAISE EXCEPTION 'Le type Avoir est immuable' USING ERRCODE = '23514';
  END IF;
  IF NEW.invoice_type IS DISTINCT FROM 'avoir' THEN
    RETURN NEW;
  END IF;
  IF NEW.is_credit_note IS NOT TRUE
     OR NEW.credit_note_for IS NULL
     OR NEW.invoice_type_code IS DISTINCT FROM '381'
     OR NULLIF(BTRIM(NEW.preceding_invoice_ref), '') IS NULL
     OR NEW.preceding_invoice_date IS NULL THEN
    RAISE EXCEPTION 'Un avoir doit référencer la facture corrigée et porter le code UNTDID 381' USING ERRCODE = '23514';
  END IF;
  IF auth.role() = 'authenticated' AND NOT public.user_has_permission('invoices.create_credit') THEN
    RAISE EXCEPTION 'Permission refusée' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_source
  FROM public.invoices
  WHERE id = NEW.credit_note_for
    AND organization_id = NEW.organization_id;
  IF NOT FOUND
     OR v_source.status NOT IN ('sent', 'viewed', 'partial', 'paid', 'overdue')
     OR v_source.invoice_type = 'avoir'
     OR v_source.issuance_snapshot IS NULL
     OR NULLIF(v_source.issuance_snapshot #>> '{invoice,client_id}', '')::UUID IS DISTINCT FROM NEW.client_id
     OR NULLIF(v_source.issuance_snapshot #>> '{invoice,quote_id}', '')::UUID IS DISTINCT FROM NEW.quote_id
     OR NULLIF(v_source.issuance_snapshot #>> '{invoice,chantier_id}', '')::UUID IS DISTINCT FROM NEW.chantier_id
     OR v_source.issuance_snapshot #>> '{invoice,number}' IS DISTINCT FROM NEW.preceding_invoice_ref
     OR NULLIF(v_source.issuance_snapshot #>> '{invoice,issue_date}', '')::DATE IS DISTINCT FROM NEW.preceding_invoice_date
     OR v_source.issuance_snapshot #>> '{invoice,currency}' IS DISTINCT FROM NEW.currency THEN
    RAISE EXCEPTION 'La facture de référence de l’avoir est indisponible ou ne correspond pas' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.invoices AS pending
    WHERE pending.organization_id = NEW.organization_id
      AND pending.credit_note_for = NEW.credit_note_for
      AND pending.invoice_type = 'avoir'
      AND pending.id IS DISTINCT FROM NEW.id
      AND pending.status IN ('draft', 'sending')
  ) AND NEW.status IN ('draft', 'sending') THEN
    RAISE EXCEPTION 'Un avoir est déjà en préparation pour cette facture' USING ERRCODE = '23505';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM 'draft' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.status = 'cancelled' THEN
    RETURN NEW;
  END IF;
  v_authority := public.credit_note_authority_vat_breakdown_v221(
    NEW.organization_id, NEW.credit_note_for, NEW.id
  );
  IF NEW.total_ht IS DISTINCT FROM (v_authority->>'total_ht')::NUMERIC
     OR NEW.total_tva IS DISTINCT FROM (v_authority->>'total_tva')::NUMERIC
     OR NEW.total_ttc IS DISTINCT FROM (v_authority->>'total_ttc')::NUMERIC
     OR NEW.is_reverse_charge IS DISTINCT FROM COALESCE((v_authority->>'is_reverse_charge')::BOOLEAN, false)
     OR NEW.vat_breakdown IS DISTINCT FROM v_authority->'vat_breakdown'
     OR NEW.applied_acompte_ht IS DISTINCT FROM NULLIF(v_authority->>'applied_acompte_ht', '')::NUMERIC THEN
    RAISE EXCEPTION 'Les totaux, la TVA ou l’apurement de l’avoir ne correspondent pas à la facture source' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'sending' THEN
    SELECT * INTO v_source
    FROM public.invoices
    WHERE id = NEW.credit_note_for
      AND organization_id = NEW.organization_id
    FOR UPDATE;
    v_source_ht := ROUND(COALESCE((v_source.issuance_snapshot->'invoice'->>'total_ht')::NUMERIC, 0), 2);
    v_source_tva := ROUND(COALESCE((v_source.issuance_snapshot->'invoice'->>'total_tva')::NUMERIC, 0), 2);
    v_source_ttc := ROUND(COALESCE((v_source.issuance_snapshot->'invoice'->>'total_ttc')::NUMERIC, 0), 2);
    SELECT ROUND(COALESCE(SUM(cn.total_ht), 0) + NEW.total_ht, 2),
           ROUND(COALESCE(SUM(cn.total_tva), 0) + NEW.total_tva, 2),
           ROUND(COALESCE(SUM(cn.total_ttc), 0) + NEW.total_ttc, 2)
    INTO v_credit_ht, v_credit_tva, v_credit_ttc
    FROM public.invoices AS cn
    WHERE cn.organization_id = NEW.organization_id
      AND cn.credit_note_for = NEW.credit_note_for
      AND cn.invoice_type = 'avoir'
      AND cn.id IS DISTINCT FROM NEW.id
      AND (cn.status IN ('sending', 'sent', 'viewed', 'partial', 'paid', 'overdue')
           OR (cn.status = 'cancelled' AND cn.unissued_cancelled_at IS NULL));
    IF NEW.total_ht <= 0 OR NEW.total_tva < 0 OR NEW.total_ttc <= 0
       OR NEW.total_ht IS NULL OR NEW.total_tva IS NULL OR NEW.total_ttc IS NULL
       OR v_credit_ht > v_source_ht OR v_credit_tva > v_source_tva OR v_credit_ttc > v_source_ttc THEN
      RAISE EXCEPTION 'Le montant cumulé des avoirs dépasse la facture émise de référence' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_invoice_adjustments ON public.invoices;
CREATE TRIGGER trg_validate_invoice_adjustments
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_invoice_adjustments();
REVOKE ALL ON FUNCTION public.validate_invoice_adjustments() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.validate_quote_invoice_cap()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_quote public.quotes%ROWTYPE;
  v_billed_ht NUMERIC(12,2);
  v_billed_ttc NUMERIC(12,2);
BEGIN
  IF TG_OP <> 'UPDATE'
     OR OLD.status IS DISTINCT FROM 'draft'
     OR NEW.status IS DISTINCT FROM 'sending'
     OR NEW.invoice_type = 'avoir'
     OR NEW.quote_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_quote
  FROM public.quotes
  WHERE id = NEW.quote_id AND organization_id = NEW.organization_id
  FOR UPDATE;
  IF NOT FOUND OR v_quote.status NOT IN ('accepted', 'converted', 'fully_invoiced') THEN
    RAISE EXCEPTION 'La facture ne référence pas un devis accepté de cette organisation' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(ROUND(SUM(prior.total_ht * CASE WHEN prior.invoice_type = 'avoir' THEN -1 ELSE 1 END), 2), 0),
         COALESCE(ROUND(SUM(prior.total_ttc * CASE WHEN prior.invoice_type = 'avoir' THEN -1 ELSE 1 END), 2), 0)
  INTO v_billed_ht, v_billed_ttc
  FROM public.invoices AS prior
  WHERE prior.organization_id = NEW.organization_id
    AND prior.quote_id = NEW.quote_id
    AND prior.id IS DISTINCT FROM NEW.id
    AND (prior.status IN ('sending', 'sent', 'viewed', 'partial', 'paid', 'overdue')
         OR (prior.status = 'cancelled' AND prior.unissued_cancelled_at IS NULL));

  IF v_billed_ht + ROUND(COALESCE(NEW.total_ht, 0), 2) > ROUND(COALESCE(v_quote.total_ht, 0), 2)
     OR v_billed_ttc + ROUND(COALESCE(NEW.total_ttc, 0), 2) > ROUND(COALESCE(v_quote.total_ttc, 0), 2) THEN
    RAISE EXCEPTION 'Le total des factures dépasserait le montant accepté du devis' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_validate_quote_invoice_cap ON public.invoices;
CREATE TRIGGER trg_validate_quote_invoice_cap
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.validate_quote_invoice_cap();
REVOKE ALL ON FUNCTION public.validate_quote_invoice_cap() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mark_quote_fully_invoiced_after_solde()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
BEGIN
  IF OLD.status = 'sending' AND NEW.status = 'sent'
     AND NEW.invoice_type = 'solde' AND NEW.quote_id IS NOT NULL THEN
    UPDATE public.quotes
    SET status = 'fully_invoiced'
    WHERE id = NEW.quote_id
      AND organization_id = NEW.organization_id
      AND status IN ('accepted', 'converted');
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_mark_quote_fully_invoiced_after_solde ON public.invoices;
CREATE TRIGGER trg_mark_quote_fully_invoiced_after_solde
  AFTER UPDATE OF status ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.mark_quote_fully_invoiced_after_solde();
REVOKE ALL ON FUNCTION public.mark_quote_fully_invoiced_after_solde() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.prepare_recurring_invoice_occurrence(p_recurring_invoice_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_model public.recurring_invoices%ROWTYPE;
  v_client_terms INTEGER;
  v_org_terms INTEGER;
  v_terms INTEGER;
  v_due_date DATE;
  v_following_date DATE;
  v_month_start DATE;
  v_invoice_id UUID;
  v_schedule_status TEXT;
  v_existing RECORD;
  v_invoice RECORD;
  v_is_vat_subject BOOLEAN;
  v_total_ht NUMERIC(12,2);
  v_total_tva NUMERIC(12,2);
  v_total_ttc NUMERIC(12,2);
BEGIN
  IF auth.role() = 'authenticated' THEN
    v_org_id := public.get_user_org_id();
    IF v_user_id IS NULL OR v_org_id IS NULL
       OR NOT public.user_has_permission('invoices.create') THEN
      RAISE EXCEPTION 'Permission refusée' USING ERRCODE = '42501';
    END IF;
  ELSIF auth.role() = 'service_role' THEN
    v_org_id := NULL;
  ELSE
    RAISE EXCEPTION 'Non authentifié' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_model
  FROM public.recurring_invoices AS ri
  WHERE ri.id = p_recurring_invoice_id
    AND (v_org_id IS NULL OR ri.organization_id = v_org_id)
    AND ri.is_active IS TRUE
    AND ri.cancelled_at IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Modèle récurrent introuvable ou inactif' USING ERRCODE = 'P0002';
  END IF;
  v_org_id := v_model.organization_id;
  IF CURRENT_DATE < v_model.next_send_date -
      (CASE WHEN v_model.requires_confirmation THEN COALESCE(v_model.confirmation_delay_days, 3) ELSE 0 END) THEN
    RETURN jsonb_build_object('created', false, 'reason', 'not_due');
  END IF;

  SELECT id, invoice_id, status INTO v_existing
  FROM public.invoice_schedules
  WHERE recurring_invoice_id = v_model.id
    AND scheduled_date = v_model.next_send_date
    AND status IN ('pending_confirmation', 'confirmed', 'sent', 'overdue', 'skipped')
  LIMIT 1;
  IF FOUND THEN
    IF v_existing.invoice_id IS NULL THEN
      RAISE EXCEPTION 'Une occurrence existe sans facture rattachée; aucune nouvelle facture n’a été créée' USING ERRCODE = '23514';
    END IF;
    SELECT id, total_ht, total_tva, total_ttc INTO v_invoice
    FROM public.invoices
    WHERE id = v_existing.invoice_id AND organization_id = v_org_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'La facture de l’occurrence existante est introuvable' USING ERRCODE = '23514';
    END IF;
    RETURN jsonb_build_object(
      'invoice_id', v_invoice.id,
      'created', false,
      'scheduled_date', v_model.next_send_date,
      'total_ht', v_invoice.total_ht,
      'total_tva', v_invoice.total_tva,
      'total_ttc', v_invoice.total_ttc
    );
  END IF;

  SELECT COALESCE(o.is_vat_subject, true), o.payment_terms_days
  INTO v_is_vat_subject, v_org_terms
  FROM public.organizations AS o
  WHERE o.id = v_org_id AND o.anonymized_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation indisponible' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(c.payment_terms_days, 30) INTO v_client_terms
  FROM public.clients AS c
  WHERE c.id = v_model.client_id AND c.organization_id = v_org_id;
  v_terms := LEAST(90, GREATEST(0, ROUND(COALESCE(v_client_terms, v_org_terms, 30))::INTEGER));
  v_due_date := v_model.next_send_date + v_terms;

  WITH line_bases AS (
    SELECT ROUND(COALESCE(ri.quantity, 0) * COALESCE(ri.unit_price, 0), 2) AS line_ht,
           COALESCE(ri.vat_rate, 0)::NUMERIC AS vat_rate
    FROM public.recurring_invoice_items AS ri
    WHERE ri.recurring_invoice_id = v_model.id
      AND ri.is_internal IS DISTINCT FROM TRUE
      AND ri.unit IS DISTINCT FROM '__section__'
  ), rate_bases AS (
    SELECT vat_rate, ROUND(SUM(line_ht), 2) AS basis_ht
    FROM line_bases
    GROUP BY vat_rate
  )
  SELECT ROUND(COALESCE(SUM(basis_ht), 0), 2),
         CASE WHEN v_is_vat_subject
           THEN ROUND(COALESCE(SUM(ROUND(basis_ht * vat_rate / 100, 2)), 0), 2)
           ELSE 0
         END
  INTO v_total_ht, v_total_tva
  FROM rate_bases;
  v_total_ttc := v_total_ht + v_total_tva;
  IF v_total_ht <= 0 THEN
    RAISE EXCEPTION 'Le modèle ne contient aucune ligne visible à facturer' USING ERRCODE = '23514';
  END IF;

  v_schedule_status := CASE WHEN v_model.requires_confirmation THEN 'pending_confirmation' ELSE 'confirmed' END;
  INSERT INTO public.invoices (
    organization_id, client_id, title, currency, status, created_by,
    issue_date, due_date, payment_terms_days, total_ht, total_tva, total_ttc,
    generation_source
  ) VALUES (
    v_org_id, v_model.client_id, v_model.title, COALESCE(v_model.currency, 'EUR'),
    'draft', v_user_id, v_model.next_send_date, v_due_date, v_terms,
    v_total_ht, v_total_tva, v_total_ttc, 'recurring_model'
  ) RETURNING id INTO v_invoice_id;

  INSERT INTO public.invoice_items (
    invoice_id, description, quantity, unit, unit_price, vat_rate, position, is_internal
  )
  SELECT v_invoice_id, ri.description, ri.quantity, ri.unit, ri.unit_price,
         ri.vat_rate, ri.position, COALESCE(ri.is_internal, false)
  FROM public.recurring_invoice_items AS ri
  WHERE ri.recurring_invoice_id = v_model.id
  ORDER BY ri.position, ri.id;

  INSERT INTO public.invoice_schedules (
    organization_id, recurring_invoice_id, scheduled_date, status,
    invoice_id, amount_ht, notified_at
  ) VALUES (
    v_org_id, v_model.id, v_model.next_send_date, v_schedule_status,
    v_invoice_id, v_total_ht, NULL
  );

  IF v_model.frequency = 'weekly' THEN
    v_following_date := v_model.next_send_date + 7;
  ELSIF v_model.frequency = 'custom' THEN
    v_following_date := v_model.next_send_date + GREATEST(COALESCE(v_model.custom_interval_days, 30), 1);
  ELSIF v_model.frequency IN ('monthly', 'quarterly') THEN
    v_month_start := DATE_TRUNC('month', v_model.next_send_date +
      CASE WHEN v_model.frequency = 'monthly' THEN INTERVAL '1 month' ELSE INTERVAL '3 months' END)::DATE;
    IF v_model.send_day IS NOT NULL THEN
      v_following_date := v_month_start + (LEAST(v_model.send_day, 28) - 1);
    ELSE
      v_following_date := v_month_start + (EXTRACT(DAY FROM v_model.next_send_date)::INTEGER - 1);
    END IF;
  ELSE
    RAISE EXCEPTION 'Fréquence de facturation récurrente inconnue' USING ERRCODE = '23514';
  END IF;

  UPDATE public.recurring_invoices
  SET next_send_date = v_following_date
  WHERE id = v_model.id AND organization_id = v_org_id;

  RETURN jsonb_build_object(
    'invoice_id', v_invoice_id,
    'created', true,
    'scheduled_date', v_model.next_send_date,
    'total_ht', v_total_ht,
    'total_tva', v_total_tva,
    'total_ttc', v_total_ttc
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.prepare_recurring_invoice_occurrence(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.prepare_recurring_invoice_occurrence(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
