-- Demande d'un nouveau lien de signature par le client d'un artisan.
--
-- Le client ouvre un lien de signature expiré et demande un nouveau lien.
-- L'artisan est prévenu ; un lien neuf ne part qu'après son accord, en renvoyant
-- le devis (sendQuote), ce qui clôt la demande.
--
-- La demande vit dans sa propre table : toute colonne ajoutée à `quotes` et
-- modifiée sur un devis publié ferait repasser le devis en brouillon
-- (déclencheur d'autorité documentaire, migration 206).

CREATE TABLE IF NOT EXISTS public.signature_link_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

COMMENT ON TABLE public.signature_link_requests IS
  'Demandes de nouveau lien de signature faites par un client sur un lien expiré. Une seule demande ouverte par devis ; resolved_at est posé quand l''artisan renvoie le devis.';

-- Une seule demande ouverte par devis : un client qui insiste ne crée pas de doublon.
CREATE UNIQUE INDEX IF NOT EXISTS signature_link_requests_one_open_per_quote
  ON public.signature_link_requests (quote_id)
  WHERE resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS signature_link_requests_open_by_org
  ON public.signature_link_requests (organization_id)
  WHERE resolved_at IS NULL;

ALTER TABLE public.signature_link_requests ENABLE ROW LEVEL SECURITY;

-- Les membres lisent les demandes de leur organisation s'ils voient les devis.
CREATE POLICY "signature_link_requests_select"
  ON public.signature_link_requests FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.user_has_permission('quotes.view'));

-- Seul l'envoi d'un devis clôt une demande ; la création passe par le serveur (service_role).
CREATE POLICY "signature_link_requests_resolve"
  ON public.signature_link_requests FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id() AND public.user_has_permission('quotes.send'))
  WITH CHECK (organization_id = public.get_user_org_id() AND resolved_at IS NOT NULL);

REVOKE ALL ON public.signature_link_requests FROM anon;
GRANT SELECT, UPDATE (resolved_at) ON public.signature_link_requests TO authenticated;
