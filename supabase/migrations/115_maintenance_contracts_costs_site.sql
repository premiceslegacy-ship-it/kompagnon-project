-- Colonnes de coûts de référence par période et informations de site
-- (manquantes suite à application partielle de la migration 114)

ALTER TABLE public.maintenance_contracts
  ADD COLUMN IF NOT EXISTS site_name          TEXT,
  ADD COLUMN IF NOT EXISTS site_contact_name  TEXT,
  ADD COLUMN IF NOT EXISTS site_contact_email TEXT,
  ADD COLUMN IF NOT EXISTS site_contact_phone TEXT,
  ADD COLUMN IF NOT EXISTS site_address_line1 TEXT,
  ADD COLUMN IF NOT EXISTS site_postal_code   TEXT,
  ADD COLUMN IF NOT EXISTS site_city          TEXT,
  ADD COLUMN IF NOT EXISTS period_cost_labor_ht  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_cost_parts_ht  NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_cost_travel_ht NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS period_cost_other_ht  NUMERIC(12,2) NOT NULL DEFAULT 0;

-- Backfill chantier_id manquants sur contrats existants sans chantier lié
WITH inserted AS (
  INSERT INTO public.chantiers (
    organization_id, quote_id, client_id, title, description, status,
    start_date, end_date, budget_ht, is_maintenance, maintenance_contract_id,
    created_by, created_at
  )
  SELECT
    mc.organization_id, NULL::uuid, mc.client_id,
    'Entretien - ' || mc.title, mc.description,
    CASE WHEN mc.status IN ('résilié', 'terminé') THEN 'termine' ELSE 'en_cours' END,
    mc.date_debut, mc.date_fin, COALESCE(mc.montant_ht, 0),
    true, mc.id, mc.created_by, mc.created_at
  FROM public.maintenance_contracts mc
  WHERE mc.chantier_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.chantiers c WHERE c.maintenance_contract_id = mc.id
    )
  RETURNING id, maintenance_contract_id
)
UPDATE public.maintenance_contracts mc
   SET chantier_id = inserted.id
  FROM inserted
 WHERE mc.id = inserted.maintenance_contract_id
   AND mc.chantier_id IS NULL;

-- Sync chantier_id depuis les chantiers déjà liés
UPDATE public.maintenance_contracts mc
   SET chantier_id = c.id
  FROM public.chantiers c
 WHERE c.maintenance_contract_id = mc.id
   AND mc.chantier_id IS NULL;
