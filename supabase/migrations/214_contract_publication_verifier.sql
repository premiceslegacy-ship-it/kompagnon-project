-- Verify a persisted contract publication against row authority without
-- re-hashing JSON that may have crossed a lossy numeric serialization boundary.
BEGIN;

CREATE OR REPLACE FUNCTION public.verify_contract_document_publication(
  p_contract_id UUID,
  p_organization_id UUID,
  p_expected_hash TEXT,
  p_pdf_snapshot JSONB,
  p_linked_quote_document JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.contracts AS c
    WHERE c.id = p_contract_id
      AND c.organization_id = p_organization_id
      AND c.signature_document_hash = p_expected_hash
      AND c.pdf_snapshot IS NOT DISTINCT FROM p_pdf_snapshot
      AND c.linked_quote_document IS NOT DISTINCT FROM p_linked_quote_document
      AND c.signature_document_hash = public.contract_document_hash(
        c.pdf_snapshot,
        c.linked_quote_document
      )
  );
$$;

REVOKE ALL ON FUNCTION public.verify_contract_document_publication(UUID, UUID, TEXT, JSONB, JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_contract_document_publication(UUID, UUID, TEXT, JSONB, JSONB)
  TO service_role;

COMMIT;
