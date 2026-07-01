-- Demandes de prix fournisseur
-- Permet de suivre les demandes envoyées à des fournisseurs pour un devis en cours
-- Statuts : a_demander → demande → recu → integre

CREATE TABLE IF NOT EXISTS public.supplier_price_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supplier_id     uuid NULL REFERENCES public.suppliers(id) ON DELETE SET NULL,
  quote_id        uuid NULL REFERENCES public.quotes(id) ON DELETE SET NULL,
  quote_item_id   uuid NULL REFERENCES public.quote_items(id) ON DELETE SET NULL,

  designation     text NOT NULL,
  description     text NULL,
  quantity        numeric(12, 3) NULL,
  unit            text NULL,

  status          text NOT NULL DEFAULT 'a_demander'
                  CHECK (status IN ('a_demander', 'demande', 'recu', 'integre')),

  sent_at         timestamptz NULL,
  response_at     timestamptz NULL,
  valid_until     date NULL,

  unit_price_ht   numeric(12, 2) NULL,
  currency        text NOT NULL DEFAULT 'EUR',

  attachment_url  text NULL,
  notes           text NULL,

  created_by      uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.supplier_price_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org members can manage supplier price requests"
  ON public.supplier_price_requests FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_spr_org_status
  ON public.supplier_price_requests (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_spr_quote
  ON public.supplier_price_requests (quote_id)
  WHERE quote_id IS NOT NULL;

COMMENT ON TABLE public.supplier_price_requests IS
  'Demandes de prix envoyées à des fournisseurs, liées optionnellement à un devis et une ligne de devis.';
