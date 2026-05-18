-- Point de départ par défaut des tournées (adresse de l'org, distincte de l'adresse de domiciliation)
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS departure_address   TEXT,
  ADD COLUMN IF NOT EXISTS departure_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS departure_city      TEXT;

-- Table pour stocker les métadonnées par tournée (route_id), dont le point de départ spécifique
CREATE TABLE IF NOT EXISTS public.tournee_routes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  planned_date   DATE NOT NULL,
  departure_address    TEXT,
  departure_postal_code TEXT,
  departure_city       TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tournee_routes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_tournee_routes" ON public.tournee_routes
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships WHERE user_id = auth.uid()
    )
  );

CREATE INDEX IF NOT EXISTS tournee_routes_org_date_idx ON public.tournee_routes(organization_id, planned_date);
