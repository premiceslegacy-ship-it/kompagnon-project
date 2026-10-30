-- 204 — Immutable, transactionally captured invoice issuance authority.
-- Historical issued invoices intentionally remain NULL: current profile data is
-- not evidence of what was issued. New issuance snapshots are explicit allowlists.
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS issuance_snapshot JSONB;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS historical_import JSONB;
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS unissued_cancelled_at TIMESTAMPTZ DEFAULT NULL;

COMMENT ON COLUMN public.invoices.historical_import IS
  'Canonical provenance for a trusted historical CSV import; unverified historical facts are not original issuance authority.';

COMMENT ON COLUMN public.invoices.issuance_snapshot IS
  'Immutable versioned issuance facts captured from locked invoice, parties, quote, lines and payment schedule at first real issuance. NULL on legacy issued rows, including pre-existing cancellations, means historical authority is unavailable; NULL on a newly cancelled draft means it was never issued. Never backfill from current mutable records. logo_url is a design reference, not an archived image.';
COMMENT ON COLUMN public.invoices.unissued_cancelled_at IS
  'Database-owned timestamp marking a draft cancelled before issuance. Immutable; NULL on legacy rows does not establish whether they were issued.';

CREATE OR REPLACE FUNCTION public.capture_invoice_issuance_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller JSONB;
  v_buyer JSONB;
  v_quote JSONB;
  v_chantier JSONB;
  v_items JSONB;
  v_payment_schedule JSONB;
  v_issued_at TIMESTAMPTZ := clock_timestamp();
  v_is_vat_subject BOOLEAN;
  v_total_ht NUMERIC;
  v_total_tva NUMERIC;
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
    -- A definite pre-dispatch rollback returns to an editable draft. Discard
    -- its provisional authority automatically; the next claim recaptures it.
    NEW.issuance_snapshot := NULL;
    RETURN NEW;
  END IF;

  IF NEW.issuance_snapshot IS DISTINCT FROM OLD.issuance_snapshot THEN
    RAISE EXCEPTION 'L''autorité d''émission d''une facture est immuable';
  END IF;
  IF OLD.status = 'draft' AND NEW.status IS DISTINCT FROM 'draft' THEN
    IF OLD.issuance_snapshot IS NOT NULL OR NEW.issuance_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Un brouillon ne peut pas réutiliser une autorité d''émission antérieure';
    END IF;
    -- Parent invoice row is already locked by UPDATE. These key-share locks
    -- serialize party/quote edits with the capture and are held to transaction end.
    PERFORM 1 FROM public.organizations
    WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Organisation émettrice indisponible pendant l''émission' USING ERRCODE = '42501';
    END IF;

    -- Cancellation retires an unissued draft without validating VAT or creating
    -- original issuance authority. This DB-owned marker records that fact.
    IF NEW.status = 'cancelled' THEN
      NEW.unissued_cancelled_at := clock_timestamp();
      RETURN NEW;
    END IF;
    SELECT COALESCE(is_vat_subject, true) INTO v_is_vat_subject
    FROM public.organizations
    WHERE id = NEW.organization_id;

    SELECT COALESCE(SUM(i.quantity * i.unit_price), 0)
    INTO v_total_ht
    FROM public.invoice_items AS i
    WHERE i.invoice_id = NEW.id
      AND i.is_internal IS DISTINCT FROM TRUE
      AND i.unit IS DISTINCT FROM '__section__';

    IF v_is_vat_subject AND NEW.is_reverse_charge IS NOT TRUE THEN
      SELECT COALESCE(SUM(i.quantity * i.unit_price * COALESCE(i.vat_rate, 0) / 100), 0)
      INTO v_total_tva
      FROM public.invoice_items AS i
      WHERE i.invoice_id = NEW.id
        AND i.is_internal IS DISTINCT FROM TRUE
        AND i.unit IS DISTINCT FROM '__section__';
    ELSE
      v_total_tva := 0;
    END IF;

    IF ROUND(COALESCE(NEW.total_ht, 0), 2) IS DISTINCT FROM ROUND(v_total_ht, 2)
       OR ROUND(COALESCE(NEW.total_tva, 0), 2) IS DISTINCT FROM ROUND(v_total_tva, 2)
       OR ROUND(COALESCE(NEW.total_ttc, 0), 2) IS DISTINCT FROM ROUND(v_total_ht + v_total_tva, 2) THEN
      RAISE EXCEPTION 'Invoice totals do not match current issuance VAT treatment' USING ERRCODE = '23514';
    END IF;
    -- Nullable stored line totals are normal; snapshot their canonical value.
    -- A present subtotal must agree with the amount rendered from quantity and
    -- unit price, or a header-valid invoice could archive contradictory lines.
    IF EXISTS (
      SELECT 1
      FROM public.invoice_items AS i
      WHERE i.invoice_id = NEW.id
        AND i.is_internal IS DISTINCT FROM TRUE
        AND i.unit IS DISTINCT FROM '__section__'
        AND (
          (i.total_ht IS NOT NULL
           AND i.total_ht IS DISTINCT FROM ROUND(COALESCE(i.quantity, 0) * i.unit_price, 2))
          OR (i.vat_amount IS NOT NULL
              AND i.vat_amount IS DISTINCT FROM ROUND(
                COALESCE(i.quantity, 0) * i.unit_price * COALESCE(i.vat_rate, 0) / 100,
                2
              ))
        )
    ) THEN
      RAISE EXCEPTION 'Invoice line subtotals do not match their quantity, price and VAT rate'
        USING ERRCODE = '23514';
    END IF;
    SELECT jsonb_build_object(
      'id', o.id,
      'name', o.name,
      'siret', o.siret,
      'siren', o.siren,
      'vat_number', o.vat_number,
      'email', o.email,
      'email_from_name', o.email_from_name,
      'email_from_address', o.email_from_address,
      'phone', o.phone,
      'address_line1', o.address_line1,
      'address_line2', o.address_line2,
      'city', o.city,
      'postal_code', o.postal_code,
      'country', o.country,
      'logo_url', o.logo_url,
      'primary_color', o.primary_color,
      'forme_juridique', o.forme_juridique,
      'capital_social', o.capital_social,
      'rcs', o.rcs,
      'rcs_ville', o.rcs_ville,
      'insurance_info', o.insurance_info,
      'certifications', o.certifications,
      'decennale_enabled', o.decennale_enabled,
      'decennale_assureur', o.decennale_assureur,
      'decennale_police', o.decennale_police,
      'decennale_couverture', o.decennale_couverture,
      'decennale_date_debut', o.decennale_date_debut,
      'decennale_date_fin', o.decennale_date_fin,
      'payment_terms_days', o.payment_terms_days,
      'late_penalty_rate', o.late_penalty_rate,
      'court_competent', o.court_competent,
      'iban', o.iban,
      'bic', o.bic,
      'bank_name', o.bank_name,
      'recovery_indemnity_text', o.recovery_indemnity_text,
      'is_vat_subject', o.is_vat_subject,
      'tva_sur_debits', o.tva_sur_debits,
      'business_profile', o.business_profile,
      'default_vat_rate', o.default_vat_rate
    ) INTO v_seller
    FROM public.organizations AS o
    WHERE o.id = NEW.organization_id;

    IF NEW.client_id IS NOT NULL THEN
      PERFORM 1 FROM public.clients
      WHERE id = NEW.client_id AND organization_id = NEW.organization_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Client de la facture introuvable dans son organisation';
      END IF;
      SELECT jsonb_build_object(
        'id', c.id,
        'type', c.type,
        'company_name', c.company_name,
        'contact_name', c.contact_name,
        'first_name', c.first_name,
        'last_name', c.last_name,
        'email', c.email,
        'phone', c.phone,
        'address_line1', c.address_line1,
        'address_line2', c.address_line2,
        'postal_code', c.postal_code,
        'city', c.city,
        'country', c.country,
        'siret', c.siret,
        'siren', c.siren,
        'vat_number', c.vat_number
      ) INTO v_buyer
      FROM public.clients AS c
      WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id;
    END IF;

    IF NEW.quote_id IS NOT NULL THEN
      PERFORM 1 FROM public.quotes
      WHERE id = NEW.quote_id AND organization_id = NEW.organization_id
      FOR SHARE;
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
      WHERE id = NEW.chantier_id AND organization_id = NEW.organization_id
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Chantier lié introuvable dans son organisation';
      END IF;
      SELECT jsonb_build_object('id', ch.id, 'title', ch.title)
      INTO v_chantier
      FROM public.chantiers AS ch
      WHERE ch.id = NEW.chantier_id AND ch.organization_id = NEW.organization_id;
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', i.id,
      'description', i.description,
      'quantity', i.quantity,
      'unit', i.unit,
      'unit_price', i.unit_price,
      'unit_cost_ht', i.unit_cost_ht,
      'vat_rate', i.vat_rate,
      'vat_amount', COALESCE(i.vat_amount, ROUND(
        COALESCE(i.quantity, 0) * i.unit_price * COALESCE(i.vat_rate, 0) / 100,
        2
      )),
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
    ) ORDER BY i.position, i.id), '[]'::jsonb)
    INTO v_items
    FROM public.invoice_items AS i
    WHERE i.invoice_id = NEW.id;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id', s.id,
      'label', s.label,
      'due_date', s.due_date,
      'amount', s.amount,
      'amount_type', s.amount_type,
      'percentage', s.percentage,
      'position', s.position,
      'paid_payment_id', s.paid_payment_id
    ) ORDER BY s.position, s.id), '[]'::jsonb)
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
        'preceding_invoice_ref', NEW.preceding_invoice_ref,
        'preceding_invoice_date', NEW.preceding_invoice_date,
        'facturx_level', NEW.facturx_level,
        'operation_type', NEW.operation_type,
        'tva_sur_debits', NEW.tva_sur_debits,
        'delivery_address_line1', NEW.delivery_address_line1,
        'delivery_address_line2', NEW.delivery_address_line2,
        'delivery_city', NEW.delivery_city,
        'delivery_postal_code', NEW.delivery_postal_code,
        'delivery_country', NEW.delivery_country,
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
$$;

DROP TRIGGER IF EXISTS trg_capture_invoice_issuance_snapshot ON public.invoices;
CREATE TRIGGER trg_capture_invoice_issuance_snapshot
  BEFORE INSERT OR UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.capture_invoice_issuance_snapshot();

REVOKE ALL ON FUNCTION public.capture_invoice_issuance_snapshot() FROM PUBLIC, anon, authenticated;

-- Keep the legacy column (it may contain historically stored XML) but it is no
-- longer an alternate mutable authority on any issued invoice.
CREATE OR REPLACE FUNCTION public.enforce_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mutable TEXT[] := ARRAY[
    'status', 'total_paid', 'paid_at', 'sent_at', 'viewed_at', 'pdf_url',
    'pa_message_id', 'pa_status', 'pa_status_updated_at', 'pa_rejection_reason',
    'is_archived', 'updated_at', 'balance_due_date'
  ];
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.status = 'draft' THEN
      IF OLD.status = 'sending' AND auth.role() = 'service_role' THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Facture émise : le retour en brouillon est interdit';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by
       AND NOT (
         OLD.created_by IS NOT NULL
         AND NEW.created_by IS NULL
         AND session_user IN ('postgres', 'supabase_auth_admin')
       ) THEN
      RAISE EXCEPTION 'created_by ne peut être effacé que par la suppression Auth de son auteur';
    END IF;
    IF (to_jsonb(NEW) - v_mutable - 'created_by')
       IS DISTINCT FROM (to_jsonb(OLD) - v_mutable - 'created_by') THEN
      RAISE EXCEPTION 'Facture émise immuable (statut %) : corriger par un avoir', OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invoice_immutability() FROM PUBLIC, anon, authenticated;

-- Lock the parent invoice before any line mutation. Issuance also owns that row,
-- so a concurrent line change is either captured first or rejected after issue.
CREATE OR REPLACE FUNCTION public.enforce_invoice_items_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_id UUID;
  v_status TEXT;
BEGIN
  FOR v_invoice_id IN
    SELECT DISTINCT candidate
    FROM unnest(ARRAY[
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.invoice_id END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.invoice_id END
    ]) AS ids(candidate)
    WHERE candidate IS NOT NULL
    ORDER BY candidate
  LOOP
    SELECT status INTO v_status
    FROM public.invoices
    WHERE id = v_invoice_id
    FOR UPDATE;

    -- A missing parent is only the invoice/organization cascade path; the FK
    -- still rejects an ordinary insert with a missing parent.
    IF FOUND AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'Lignes immuables : facture source au statut %', v_status;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invoice_items_immutability() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_invoice_payment_schedule_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_invoice_id UUID;
  v_status TEXT;
BEGIN
  FOR v_invoice_id IN
    SELECT DISTINCT candidate
    FROM unnest(ARRAY[
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.invoice_id END,
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.invoice_id END
    ]) AS ids(candidate)
    WHERE candidate IS NOT NULL
    ORDER BY candidate
  LOOP
    SELECT status INTO v_status
    FROM public.invoices
    WHERE id = v_invoice_id
    FOR UPDATE;

    IF FOUND AND v_status <> 'draft' THEN
      IF TG_OP = 'UPDATE'
         AND (to_jsonb(NEW) - 'paid_payment_id' - 'updated_at')
             IS NOT DISTINCT FROM (to_jsonb(OLD) - 'paid_payment_id' - 'updated_at')
         AND (
           (OLD.paid_payment_id IS NULL AND NEW.paid_payment_id IS NOT NULL)
           OR (OLD.paid_payment_id IS NOT NULL AND NEW.paid_payment_id IS NULL AND pg_trigger_depth() > 1)
         ) THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Échéancier immuable : facture émise (statut %)', v_status;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_invoice_payment_schedule_immutability ON public.invoice_payment_schedule;
CREATE TRIGGER trg_enforce_invoice_payment_schedule_immutability
  BEFORE INSERT OR UPDATE OR DELETE ON public.invoice_payment_schedule
  FOR EACH ROW EXECUTE FUNCTION public.enforce_invoice_payment_schedule_immutability();

REVOKE ALL ON FUNCTION public.enforce_invoice_payment_schedule_immutability() FROM PUBLIC, anon, authenticated;
