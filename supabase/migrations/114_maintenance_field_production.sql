-- ============================================================
-- 114_maintenance_field_production.sql
-- Entretien = mini-chantier recurrent : production terrain,
-- coûts, pointages, facturation et reporting via le socle chantier.
-- ============================================================

ALTER TABLE public.chantiers
  ADD COLUMN IF NOT EXISTS is_maintenance BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS maintenance_contract_id UUID REFERENCES public.maintenance_contracts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_chantiers_maintenance_contract
  ON public.chantiers(maintenance_contract_id)
  WHERE maintenance_contract_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chantiers_maintenance
  ON public.chantiers(organization_id, is_maintenance);

COMMENT ON COLUMN public.chantiers.is_maintenance IS
  'Chantier technique cree pour piloter un contrat d''entretien dans les rapports, masque des vues chantier classiques.';
COMMENT ON COLUMN public.chantiers.maintenance_contract_id IS
  'Contrat d''entretien source quand le chantier sert de support de production maintenance.';

ALTER TABLE public.maintenance_contracts
  ADD COLUMN IF NOT EXISTS source_quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS site_name TEXT,
  ADD COLUMN IF NOT EXISTS site_contact_name TEXT,
  ADD COLUMN IF NOT EXISTS site_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS site_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS site_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS site_postal_code TEXT,
  ADD COLUMN IF NOT EXISTS site_city TEXT,
  ADD COLUMN IF NOT EXISTS period_cost_labor_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_cost_parts_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_cost_travel_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_cost_other_ht NUMERIC(12,2) NOT NULL DEFAULT 0;

ALTER TABLE public.maintenance_interventions
  ADD COLUMN IF NOT EXISTS intervenant_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS intervenant_member_id UUID REFERENCES public.chantier_equipe_membres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time TIME,
  ADD COLUMN IF NOT EXISTS duration_hours NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS chantier_pointage_id UUID REFERENCES public.chantier_pointages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS cost_parts_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_travel_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cost_other_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS billable_amount_ht NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS billable_vat_rate NUMERIC(5,2) NOT NULL DEFAULT 20,
  ADD COLUMN IF NOT EXISTS billed_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'maintenance_interventions_duration_check'
  ) THEN
    ALTER TABLE public.maintenance_interventions
      ADD CONSTRAINT maintenance_interventions_duration_check
      CHECK (duration_hours IS NULL OR (duration_hours > 0 AND duration_hours <= 24));
  END IF;
END $$;

UPDATE public.maintenance_interventions
   SET intervenant_member_id = intervenant_id
 WHERE intervenant_member_id IS NULL
   AND intervenant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS maintenance_interventions_user_idx
  ON public.maintenance_interventions(intervenant_user_id)
  WHERE intervenant_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS maintenance_interventions_member_idx
  ON public.maintenance_interventions(intervenant_member_id)
  WHERE intervenant_member_id IS NOT NULL;

ALTER TABLE public.chantier_pointages
  ADD COLUMN IF NOT EXISTS maintenance_intervention_id UUID REFERENCES public.maintenance_interventions(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_pointage_maintenance_intervention
  ON public.chantier_pointages(maintenance_intervention_id)
  WHERE maintenance_intervention_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_pointages_maintenance_intervention
  ON public.chantier_pointages(maintenance_intervention_id)
  WHERE maintenance_intervention_id IS NOT NULL;

ALTER TABLE public.chantier_expenses
  ADD COLUMN IF NOT EXISTS maintenance_intervention_id UUID REFERENCES public.maintenance_interventions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_expenses_maintenance_intervention
  ON public.chantier_expenses(maintenance_intervention_id)
  WHERE maintenance_intervention_id IS NOT NULL;

ALTER TABLE public.chantier_photos
  ADD COLUMN IF NOT EXISTS maintenance_intervention_id UUID REFERENCES public.maintenance_interventions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_photos_maintenance_intervention
  ON public.chantier_photos(maintenance_intervention_id)
  WHERE maintenance_intervention_id IS NOT NULL;

-- Marquer les chantiers deja lies a des contrats d'entretien.
UPDATE public.chantiers c
   SET is_maintenance = true,
       maintenance_contract_id = mc.id
  FROM public.maintenance_contracts mc
 WHERE mc.chantier_id = c.id
   AND (c.maintenance_contract_id IS NULL OR c.maintenance_contract_id = mc.id);

-- Backfill : un contrat d'entretien sans chantier obtient un chantier technique.
WITH inserted AS (
  INSERT INTO public.chantiers (
    organization_id,
    quote_id,
    client_id,
    title,
    description,
    status,
    start_date,
    end_date,
    budget_ht,
    is_maintenance,
    maintenance_contract_id,
    created_by,
    created_at
  )
  SELECT
    mc.organization_id,
    NULL::uuid,
    mc.client_id,
    'Entretien - ' || mc.title,
    mc.description,
    CASE WHEN mc.status IN ('résilié', 'terminé') THEN 'termine' ELSE 'en_cours' END,
    mc.date_debut,
    mc.date_fin,
    COALESCE(mc.montant_ht, 0),
    true,
    mc.id,
    mc.created_by,
    mc.created_at
  FROM public.maintenance_contracts mc
  WHERE mc.chantier_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.chantiers c
      WHERE c.maintenance_contract_id = mc.id
    )
  RETURNING id, maintenance_contract_id
)
UPDATE public.maintenance_contracts mc
   SET chantier_id = inserted.id
  FROM inserted
 WHERE mc.id = inserted.maintenance_contract_id
   AND mc.chantier_id IS NULL;

UPDATE public.maintenance_contracts mc
   SET chantier_id = c.id
  FROM public.chantiers c
 WHERE c.maintenance_contract_id = mc.id
   AND mc.chantier_id IS NULL;
