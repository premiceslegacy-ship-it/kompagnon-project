-- Serialize intentional resends without changing issued financial lifecycle fields.
CREATE TABLE public.invoice_resend_delivery_claims (
  invoice_id UUID PRIMARY KEY REFERENCES public.invoices(id) ON DELETE CASCADE,
  claim_token UUID NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'claimed' CHECK (state IN ('claimed', 'ambiguous')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ambiguous_at TIMESTAMPTZ,
  CHECK ((state = 'ambiguous') = (ambiguous_at IS NOT NULL))
);

ALTER TABLE public.invoice_resend_delivery_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.invoice_resend_delivery_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.invoice_resend_delivery_claims TO service_role;
