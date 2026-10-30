-- 206 — Keep published and accepted quote facts independent of mutable parties.
-- No backfill: current parties cannot prove the content of a historical offer.
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS document_snapshot JSONB;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS historical_import JSONB;
COMMENT ON COLUMN public.quotes.historical_import IS
  'Canonical unverified CSV provenance. Historical finalization does not create original publication authority.';
COMMENT ON COLUMN public.quotes.document_snapshot IS
  'Versioned facts of the current publication. A content edit withdraws an unsigned publication and its public token. Accepted authority is immutable. NULL on a legacy published quote does not establish original historical facts; logo_url is not an archived image.';

CREATE OR REPLACE FUNCTION public.capture_quote_document_snapshot()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller JSONB;
  v_buyer JSONB;
  v_items JSONB;
  v_sections JSONB;
  v_total_ht NUMERIC;
  v_total_tva NUMERIC;
  v_publish BOOLEAN := false;
  v_metadata TEXT[] := ARRAY[
    'document_snapshot', 'status', 'signature_token', 'signature_token_expires_at',
    'sent_at', 'signed_at', 'accepted_at', 'signed_ip', 'signed_user_agent',
    'client_signature_image', 'client_signatory_name', 'client_signatory_role',
    'refused_at', 'refusal_reason', 'rejection_reason', 'last_viewed_at',
    'view_count', 'is_archived', 'archived_at', 'archived_by', 'created_by', 'updated_at'
  ];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.historical_import IS NOT NULL THEN
      IF auth.role() IS DISTINCT FROM 'service_role'
         OR NEW.historical_import->>'source' IS DISTINCT FROM 'csv'
         OR NEW.status IS DISTINCT FROM 'draft'
         OR NEW.document_snapshot IS NOT NULL THEN
        RAISE EXCEPTION 'Import historique CSV réservé au serveur en phase brouillon' USING ERRCODE = '42501';
      END IF;
      NEW.historical_import := jsonb_build_object(
        'source', 'csv', 'verification', 'unverified', 'state', 'staging',
        'imported_at', clock_timestamp()
      );
    END IF;
    IF NEW.document_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'L''autorité documentaire est créée exclusivement par la base' USING ERRCODE = '42501';
    END IF;
    IF NEW.status IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Un devis doit être créé en brouillon avant sa publication' USING ERRCODE = '23514';
    END IF;
    PERFORM 1 FROM public.organizations
    WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Une organisation effacée ne peut plus créer de devis' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.historical_import IS DISTINCT FROM OLD.historical_import THEN
    IF OLD.status = 'draft'
       AND OLD.historical_import->>'state' = 'staging'
       AND NEW.historical_import IS NOT DISTINCT FROM
         (OLD.historical_import || jsonb_build_object('state', 'finalized'))
       AND OLD.document_snapshot IS NULL AND NEW.document_snapshot IS NULL
       AND auth.role() = 'service_role'
       AND NEW.id IS NOT DISTINCT FROM OLD.id
       AND NEW.organization_id IS NOT DISTINCT FROM OLD.organization_id
       AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by THEN
      PERFORM 1 FROM public.organizations
      WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Organisation effacée : import historique impossible' USING ERRCODE = '42501';
      END IF;
      NEW.historical_import := NEW.historical_import || jsonb_build_object('finalized_at', clock_timestamp());
      NEW.signature_token := NULL;
      NEW.signature_token_expires_at := NULL;
      NEW.sent_at := NULL;
      NEW.signed_at := NULL;
      NEW.accepted_at := NULL;
      NEW.signed_ip := NULL;
      NEW.signed_user_agent := NULL;
      NEW.client_signature_image := NULL;
      NEW.client_signatory_name := NULL;
      NEW.client_signatory_role := NULL;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'La provenance d''un import historique est immuable' USING ERRCODE = '42501';
  END IF;
  IF OLD.historical_import->>'state' = 'staging' AND OLD.status = 'draft'
     AND NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Finalisez l''import historique avant de changer son statut' USING ERRCODE = '42501';
  END IF;

  IF NEW.document_snapshot IS DISTINCT FROM OLD.document_snapshot THEN
    RAISE EXCEPTION 'L''autorité documentaire du devis est protégée' USING ERRCODE = '42501';
  END IF;

  -- Existing immutable guards retain responsibility for accepted legal content,
  -- including their narrow Auth-erasure and public-capability revocation cases.
  IF OLD.status IN ('accepted', 'converted', 'fully_invoiced') OR OLD.signed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF OLD.status IN ('sent', 'viewed')
     AND (to_jsonb(NEW) - v_metadata) IS DISTINCT FROM (to_jsonb(OLD) - v_metadata) THEN
    IF NEW.status = 'accepted' OR NEW.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Le devis a changé avant son acceptation ; republiez la proposition' USING ERRCODE = '40001';
    END IF;
    -- Editing a published offer invalidates already loaded signature forms.
    NEW.status := 'draft';
  END IF;

  IF OLD.status IS DISTINCT FROM 'draft' AND NEW.status = 'draft' THEN
    NEW.document_snapshot := NULL;
    NEW.signature_token := NULL;
    NEW.signature_token_expires_at := NULL;
    NEW.sent_at := NULL;
    RETURN NEW;
  END IF;

  IF NEW.status = 'sent' THEN
    v_publish := OLD.status = 'draft'
      OR (NEW.signature_token IS NOT NULL
          AND NEW.signature_token IS DISTINCT FROM OLD.signature_token);
  ELSIF NEW.status = 'accepted' THEN
    IF OLD.status = 'draft' THEN
      v_publish := true; -- explicit manual acceptance of the current draft
    ELSIF OLD.document_snapshot IS NULL THEN
      RAISE EXCEPTION 'Autorité historique du devis indisponible ; une nouvelle proposition doit être publiée' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NOT v_publish THEN
    RETURN NEW;
  END IF;

  -- The quote row is locked by UPDATE. Child guards below acquire the same
  -- parent lock before changing lines or sections. Party edits serialize here.
  PERFORM 1 FROM public.organizations
  WHERE id = NEW.organization_id AND anonymized_at IS NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organisation émettrice indisponible' USING ERRCODE = '42501';
  END IF;
  SELECT jsonb_build_object(
    'id', o.id, 'name', o.name, 'siret', o.siret, 'siren', o.siren,
    'vat_number', o.vat_number, 'email', o.email,
    'email_from_name', o.email_from_name, 'email_from_address', o.email_from_address,
    'phone', o.phone, 'address_line1', o.address_line1, 'address_line2', o.address_line2,
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
  FROM public.organizations o WHERE o.id = NEW.organization_id;

  IF NEW.client_id IS NOT NULL THEN
    PERFORM 1 FROM public.clients
    WHERE id = NEW.client_id AND organization_id = NEW.organization_id FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Client du devis introuvable dans son organisation' USING ERRCODE = '23503';
    END IF;
    SELECT jsonb_build_object(
      'id', c.id, 'type', c.type, 'company_name', c.company_name,
      'contact_name', c.contact_name, 'first_name', c.first_name, 'last_name', c.last_name,
      'email', c.email, 'phone', c.phone, 'address_line1', c.address_line1,
      'address_line2', c.address_line2, 'postal_code', c.postal_code,
      'city', c.city, 'country', c.country, 'siret', c.siret,
      'siren', c.siren, 'vat_number', c.vat_number
    ) INTO v_buyer FROM public.clients c
    WHERE c.id = NEW.client_id AND c.organization_id = NEW.organization_id;
  END IF;

  IF EXISTS (SELECT 1 FROM public.quote_items WHERE quote_id = NEW.id AND quantity IS NULL) THEN
    RAISE EXCEPTION 'Une quantité de ligne est manquante ; corrigez le brouillon avant publication' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id, 'quote_id', i.quote_id, 'section_id', i.section_id, 'type', i.type,
    'material_id', i.material_id, 'labor_rate_id', i.labor_rate_id,
    'designation', i.designation, 'details', i.details, 'description', i.description,
    'quantity', i.quantity, 'unit', i.unit, 'unit_price', i.unit_price,
    'unit_cost_ht', i.unit_cost_ht, 'vat_rate', COALESCE(i.vat_rate, 20),
    'total_ht', i.total_ht, 'position', i.position,
    'length_m', i.length_m, 'width_m', i.width_m, 'height_m', i.height_m,
    'dim_quantity', COALESCE(i.dim_quantity, 1), 'is_internal', COALESCE(i.is_internal, false),
    'metal_grid_id', i.metal_grid_id, 'dimension_values', i.dimension_values,
    'variant_label', i.variant_label, 'catalog_variant_id', i.catalog_variant_id,
    'price_pending', COALESCE(i.price_pending, false), 'labor_category', i.labor_category
  ) ORDER BY i.position, i.id), '[]'::jsonb)
  INTO v_items FROM public.quote_items i WHERE i.quote_id = NEW.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id, 'quote_id', s.quote_id, 'title', s.title, 'position', s.position,
    'items', COALESCE((SELECT jsonb_agg(item ORDER BY (item->>'position')::int, item->>'id')
                      FROM jsonb_array_elements(v_items) item
                      WHERE item->>'section_id' = s.id::text), '[]'::jsonb)
  ) ORDER BY s.position, s.id), '[]'::jsonb)
  INTO v_sections FROM public.quote_sections s WHERE s.quote_id = NEW.id;

  -- Use the same visible quantity/price/rate facts as the quote renderer. The
  -- publication transaction, not a later request, fixes the applicable VAT flag.
  SELECT COALESCE(sum((item->>'quantity')::numeric * (item->>'unit_price')::numeric), 0),
         CASE WHEN (v_seller->>'is_vat_subject')::boolean IS FALSE THEN 0
              ELSE COALESCE(sum((item->>'quantity')::numeric * (item->>'unit_price')::numeric
                               * (item->>'vat_rate')::numeric / 100), 0) END
  INTO v_total_ht, v_total_tva
  FROM jsonb_array_elements(v_items) item
  WHERE (item->>'is_internal')::boolean IS NOT TRUE;
  NEW.total_ht := v_total_ht;
  NEW.total_tva := v_total_tva;
  NEW.total_ttc := v_total_ht + v_total_tva;

  NEW.document_snapshot := jsonb_build_object(
    'version', 1, 'captured_at', clock_timestamp(), 'organization', v_seller,
    'quote', jsonb_build_object(
      'id', NEW.id, 'organization_id', NEW.organization_id, 'number', NEW.number,
      'title', NEW.title, 'status', NEW.status, 'total_ht', NEW.total_ht,
      'total_tva', NEW.total_tva, 'total_ttc', NEW.total_ttc, 'currency', NEW.currency,
      'validity_days', NEW.validity_days, 'valid_until', NEW.valid_until,
      'sent_at', NEW.sent_at, 'created_at', NEW.created_at,
      'notes_client', NEW.notes_client, 'payment_conditions', NEW.payment_conditions,
      'discount_rate', NEW.discount_rate, 'deposit_rate', NEW.deposit_rate,
      'aid_label', NEW.aid_label, 'aid_amount', NEW.aid_amount,
      'show_section_subtotals', NEW.show_section_subtotals,
      'client_request_description', CASE WHEN NEW.client_request_visible_on_pdf THEN NEW.client_request_description ELSE NULL END,
      'client_request_visible_on_pdf', NEW.client_request_visible_on_pdf,
      'client', v_buyer, 'items', v_items, 'sections', v_sections,
      'unsectionedItems', COALESCE((SELECT jsonb_agg(item ORDER BY (item->>'position')::int, item->>'id')
                                  FROM jsonb_array_elements(v_items) item
                                  WHERE item->>'section_id' IS NULL), '[]'::jsonb)
    )
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER aaa_quote_document_authority
BEFORE INSERT OR UPDATE ON public.quotes
FOR EACH ROW EXECUTE FUNCTION public.capture_quote_document_snapshot();

CREATE OR REPLACE FUNCTION public.withdraw_quote_publication_before_child_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old_id UUID;
  v_new_id UUID;
  v_parent RECORD;
BEGIN
  IF TG_OP <> 'INSERT' THEN v_old_id := OLD.quote_id; END IF;
  IF TG_OP <> 'DELETE' THEN v_new_id := NEW.quote_id; END IF;
  FOR v_parent IN
    SELECT id, status, signed_at FROM public.quotes
    WHERE id IN (v_old_id, v_new_id) ORDER BY id FOR UPDATE
  LOOP
    IF v_parent.status IN ('accepted', 'converted', 'fully_invoiced') OR v_parent.signed_at IS NOT NULL THEN
      RAISE EXCEPTION 'Un devis accepté ne peut plus être modifié' USING ERRCODE = '42501';
    END IF;
    IF v_parent.status IN ('sent', 'viewed') THEN
      UPDATE public.quotes SET status = 'draft' WHERE id = v_parent.id;
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER aaa_quote_item_publication_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.quote_items
FOR EACH ROW EXECUTE FUNCTION public.withdraw_quote_publication_before_child_change();
CREATE TRIGGER aaa_quote_section_publication_guard
BEFORE INSERT OR UPDATE OR DELETE ON public.quote_sections
FOR EACH ROW EXECUTE FUNCTION public.withdraw_quote_publication_before_child_change();

REVOKE ALL ON FUNCTION public.capture_quote_document_snapshot() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.withdraw_quote_publication_before_child_change() FROM PUBLIC, anon, authenticated;
NOTIFY pgrst, 'reload schema';
