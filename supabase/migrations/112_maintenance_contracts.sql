-- Contrats d'entretien (générique tous métiers : PAC, clim, espaces verts, nettoyage, etc.)
CREATE TABLE IF NOT EXISTS public.maintenance_contracts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id             UUID REFERENCES public.clients(id) ON DELETE SET NULL,
  chantier_id           UUID REFERENCES public.chantiers(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  description           TEXT,
  status                TEXT NOT NULL DEFAULT 'actif'
                          CHECK (status IN ('actif', 'suspendu', 'résilié', 'terminé')),
  -- Équipements à entretenir (JSONB : [{nom, ref, localisation}])
  equipements           JSONB NOT NULL DEFAULT '[]',
  -- Fréquence d'intervention
  frequence             TEXT NOT NULL DEFAULT 'annuelle'
                          CHECK (frequence IN ('mensuelle', 'bimestrielle', 'trimestrielle', 'semestrielle', 'annuelle', 'sur_demande')),
  -- Facturation
  montant_ht            NUMERIC(12,2),
  vat_rate              NUMERIC(5,2) DEFAULT 20,
  facturation_auto      BOOLEAN NOT NULL DEFAULT false,
  recurring_invoice_id  UUID REFERENCES public.recurring_invoices(id) ON DELETE SET NULL,
  -- Dates
  date_debut            DATE,
  date_fin              DATE,
  prochaine_intervention DATE,
  -- Meta
  created_by            UUID REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Interventions réalisées ou planifiées sur un contrat d'entretien
CREATE TABLE IF NOT EXISTS public.maintenance_interventions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maintenance_contract_id  UUID NOT NULL REFERENCES public.maintenance_contracts(id) ON DELETE CASCADE,
  organization_id          UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  date_intervention        DATE NOT NULL DEFAULT CURRENT_DATE,
  intervenant_id           UUID REFERENCES public.chantier_equipe_membres(id) ON DELETE SET NULL,
  statut                   TEXT NOT NULL DEFAULT 'réalisée'
                             CHECK (statut IN ('planifiée', 'réalisée', 'annulée')),
  rapport                  TEXT,
  observations             TEXT,
  invoice_id               UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_by               UUID REFERENCES auth.users(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Trigger updated_at sur maintenance_contracts
CREATE OR REPLACE FUNCTION public.touch_maintenance_contracts()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER maintenance_contracts_updated_at
  BEFORE UPDATE ON public.maintenance_contracts
  FOR EACH ROW EXECUTE FUNCTION public.touch_maintenance_contracts();

-- Index utiles
CREATE INDEX IF NOT EXISTS maintenance_contracts_org_idx ON public.maintenance_contracts(organization_id);
CREATE INDEX IF NOT EXISTS maintenance_contracts_client_idx ON public.maintenance_contracts(client_id);
CREATE INDEX IF NOT EXISTS maintenance_interventions_contract_idx ON public.maintenance_interventions(maintenance_contract_id);
CREATE INDEX IF NOT EXISTS maintenance_interventions_org_idx ON public.maintenance_interventions(organization_id);

-- RLS
ALTER TABLE public.maintenance_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_interventions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "maintenance_contracts_select"
  ON public.maintenance_contracts FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "maintenance_contracts_insert"
  ON public.maintenance_contracts FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "maintenance_contracts_update"
  ON public.maintenance_contracts FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "maintenance_contracts_delete"
  ON public.maintenance_contracts FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "maintenance_interventions_select"
  ON public.maintenance_interventions FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

CREATE POLICY "maintenance_interventions_insert"
  ON public.maintenance_interventions FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "maintenance_interventions_update"
  ON public.maintenance_interventions FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

CREATE POLICY "maintenance_interventions_delete"
  ON public.maintenance_interventions FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id());
