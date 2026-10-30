-- 207 — Preserve the last known legal-party context before anonymizing legacy
-- records. This is an UNVERIFIED observation, never an issued PDF/XML authority.
CREATE TABLE public.legacy_legal_retention_contexts (
  document_kind TEXT NOT NULL CHECK (document_kind IN ('invoice', 'accepted_quote', 'signed_contract')),
  document_id UUID NOT NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  observed_at TIMESTAMPTZ NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'unverified_live_records_at_erasure'
    CHECK (provenance = 'unverified_live_records_at_erasure'),
  seller_context JSONB NOT NULL,
  buyer_context JSONB,
  PRIMARY KEY (document_kind, document_id)
);
CREATE INDEX legacy_legal_retention_contexts_org_idx
  ON public.legacy_legal_retention_contexts (organization_id);
ALTER TABLE public.legacy_legal_retention_contexts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.legacy_legal_retention_contexts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.legacy_legal_retention_contexts TO service_role;
COMMENT ON TABLE public.legacy_legal_retention_contexts IS
  'Owner-written, unverified current legal-party context retained immediately before erasure when no verified issued snapshot exists. Not an original, not a substitute for issuance_snapshot/document_snapshot, and never consumed by document rendering or PDP eligibility. Original history still requires independent evidence.';

CREATE OR REPLACE FUNCTION public.retain_unverified_legal_context(p_org_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seller JSONB;
  v_observed_at TIMESTAMPTZ := clock_timestamp();
BEGIN
  PERFORM 1 FROM public.organizations
  WHERE id = p_org_id AND anonymized_at IS NULL
    AND deletion_scheduled_at IS NOT NULL AND deletion_scheduled_at <= now()
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La rétention du contexte légal est réservée à un effacement arrivé à échéance'
      USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'id', o.id, 'name', o.name, 'siret', o.siret, 'siren', o.siren,
    'vat_number', o.vat_number, 'email', o.email, 'phone', o.phone,
    'address_line1', o.address_line1, 'address_line2', o.address_line2,
    'postal_code', o.postal_code, 'city', o.city, 'country', o.country,
    'forme_juridique', o.forme_juridique, 'capital_social', o.capital_social,
    'rcs', o.rcs, 'rcs_ville', o.rcs_ville, 'insurance_info', o.insurance_info,
    'is_vat_subject', o.is_vat_subject, 'tva_sur_debits', o.tva_sur_debits,
    'iban', o.iban, 'bic', o.bic, 'bank_name', o.bank_name,
    'payment_terms_days', o.payment_terms_days, 'late_penalty_rate', o.late_penalty_rate,
    'court_competent', o.court_competent, 'recovery_indemnity_text', o.recovery_indemnity_text
  ) INTO v_seller FROM public.organizations o WHERE o.id = p_org_id;

  -- The organization lock serializes new issuance. Lock referenced clients so
  -- the observation cannot mix a concurrently edited buyer with that seller.
  PERFORM 1 FROM public.clients c
  WHERE c.organization_id = p_org_id AND (
    EXISTS (SELECT 1 FROM public.invoices i
            WHERE i.organization_id = p_org_id AND i.client_id = c.id
              AND i.status <> 'draft' AND i.issuance_snapshot IS NULL
              AND i.unissued_cancelled_at IS NULL)
    OR EXISTS (SELECT 1 FROM public.quotes q
               WHERE q.organization_id = p_org_id AND q.client_id = c.id
                 AND (q.status IN ('accepted', 'converted', 'fully_invoiced') OR q.signed_at IS NOT NULL)
                 AND q.document_snapshot IS NULL)
    OR EXISTS (SELECT 1 FROM public.contracts k
               WHERE k.organization_id = p_org_id AND k.client_id = c.id
                 AND (k.status = 'signed' OR k.signed_at IS NOT NULL OR k.client_signed_at IS NOT NULL)
                 AND (k.pdf_snapshot IS NULL
                      OR k.pdf_snapshot ->> 'organizationId' IS DISTINCT FROM p_org_id::TEXT))
  ) ORDER BY c.id FOR SHARE;

  INSERT INTO public.legacy_legal_retention_contexts (
    document_kind, document_id, organization_id, observed_at, seller_context, buyer_context
  )
  SELECT 'invoice', i.id, p_org_id, v_observed_at, v_seller,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', c.id, 'type', c.type, 'company_name', c.company_name,
      'contact_name', c.contact_name, 'first_name', c.first_name, 'last_name', c.last_name,
      'email', c.email, 'phone', c.phone, 'address_line1', c.address_line1,
      'address_line2', c.address_line2, 'postal_code', c.postal_code, 'city', c.city,
      'country', c.country, 'siret', c.siret, 'siren', c.siren, 'vat_number', c.vat_number
    ) END
  FROM public.invoices i
  LEFT JOIN public.clients c ON c.id = i.client_id AND c.organization_id = p_org_id
  WHERE i.organization_id = p_org_id AND i.status <> 'draft' AND i.issuance_snapshot IS NULL
    AND i.unissued_cancelled_at IS NULL
  ON CONFLICT (document_kind, document_id) DO NOTHING;

  INSERT INTO public.legacy_legal_retention_contexts (
    document_kind, document_id, organization_id, observed_at, seller_context, buyer_context
  )
  SELECT 'accepted_quote', q.id, p_org_id, v_observed_at, v_seller,
    CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', c.id, 'type', c.type, 'company_name', c.company_name,
      'contact_name', c.contact_name, 'first_name', c.first_name, 'last_name', c.last_name,
      'email', c.email, 'phone', c.phone, 'address_line1', c.address_line1,
      'address_line2', c.address_line2, 'postal_code', c.postal_code, 'city', c.city,
      'country', c.country, 'siret', c.siret, 'siren', c.siren, 'vat_number', c.vat_number
    ) END
  FROM public.quotes q
  LEFT JOIN public.clients c ON c.id = q.client_id AND c.organization_id = p_org_id
  WHERE q.organization_id = p_org_id
    AND (q.status IN ('accepted', 'converted', 'fully_invoiced') OR q.signed_at IS NOT NULL)
    AND q.document_snapshot IS NULL
  ON CONFLICT (document_kind, document_id) DO NOTHING;

  -- Pre-cutover signed contracts without an organization-bound archive still
  -- retain their last known parties. This observation never repairs or replaces
  -- the missing original contract, nor depends on a later migration's columns.
  INSERT INTO public.legacy_legal_retention_contexts (
    document_kind, document_id, organization_id, observed_at, seller_context, buyer_context
  )
  SELECT 'signed_contract', k.id, p_org_id, v_observed_at, v_seller,
    jsonb_build_object(
      'counterparty_name', k.counterparty_name, 'counterparty_email', k.counterparty_email,
      'counterparty_phone', k.counterparty_phone, 'counterparty_address', k.counterparty_address,
      'client', CASE WHEN c.id IS NULL THEN NULL ELSE jsonb_build_object(
        'id', c.id, 'type', c.type, 'company_name', c.company_name,
        'contact_name', c.contact_name, 'first_name', c.first_name, 'last_name', c.last_name,
        'email', c.email, 'phone', c.phone, 'address_line1', c.address_line1,
        'address_line2', c.address_line2, 'postal_code', c.postal_code, 'city', c.city,
        'country', c.country, 'siret', c.siret, 'siren', c.siren, 'vat_number', c.vat_number
      ) END
    )
  FROM public.contracts k
  LEFT JOIN public.clients c ON c.id = k.client_id AND c.organization_id = p_org_id
  WHERE k.organization_id = p_org_id
    AND (k.status = 'signed' OR k.signed_at IS NOT NULL OR k.client_signed_at IS NOT NULL)
    AND (k.pdf_snapshot IS NULL OR k.pdf_snapshot ->> 'organizationId' IS DISTINCT FROM p_org_id::TEXT)
  ON CONFLICT (document_kind, document_id) DO NOTHING;
END;
$$;
-- Called only by the SECURITY DEFINER erasure RPC, not an alternate public API.
REVOKE ALL ON FUNCTION public.retain_unverified_legal_context(UUID)
  FROM PUBLIC, anon, authenticated, service_role;
NOTIFY pgrst, 'reload schema';
