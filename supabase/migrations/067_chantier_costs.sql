-- ============================================================
-- 067_chantier_costs.sql
-- Suivi des coûts réels par chantier + taux horaires
-- Dépend de : 029_chantiers.sql, 005_advanced_tables.sql
-- ============================================================

-- ----------------------------------------------------------
-- chantier_expenses
-- Dépenses réelles saisies manuellement (matériaux, sous-traitants, etc.)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chantier_expenses (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  chantier_id           UUID          NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  category              TEXT          NOT NULL DEFAULT 'autre',
  -- 'materiel' | 'sous_traitance' | 'location' | 'transport' | 'autre'
  label                 TEXT          NOT NULL,
  amount_ht             NUMERIC(12,2) NOT NULL CHECK (amount_ht >= 0),
  vat_rate              NUMERIC(5,2)  NOT NULL DEFAULT 20,
  expense_date          DATE          NOT NULL DEFAULT CURRENT_DATE,
  supplier_name         TEXT,
  received_invoice_id   UUID          REFERENCES public.received_invoices(id) ON DELETE SET NULL,
  receipt_storage_path  TEXT,
  notes                 TEXT,
  created_by            UUID          REFERENCES auth.users(id),
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  CONSTRAINT chantier_expenses_category_check CHECK (
    category IN ('materiel','sous_traitance','location','transport','autre')
  )
);

COMMENT ON TABLE  public.chantier_expenses         IS 'Dépenses réelles par chantier (matériaux, sous-traitance, location, transport, autre)';
COMMENT ON COLUMN public.chantier_expenses.category IS 'materiel | sous_traitance | location | transport | autre';

CREATE INDEX IF NOT EXISTS idx_chantier_expenses_chantier ON public.chantier_expenses(chantier_id);
CREATE INDEX IF NOT EXISTS idx_chantier_expenses_org      ON public.chantier_expenses(organization_id);
CREATE INDEX IF NOT EXISTS idx_chantier_expenses_date     ON public.chantier_expenses(chantier_id, expense_date);

-- ----------------------------------------------------------
-- Lien optionnel : facture reçue → chantier
-- ----------------------------------------------------------
ALTER TABLE public.received_invoices
  ADD COLUMN IF NOT EXISTS chantier_id UUID REFERENCES public.chantiers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_received_invoices_chantier ON public.received_invoices(chantier_id);

-- ----------------------------------------------------------
-- Taux horaire de main-d'œuvre
-- organizations.default_hourly_rate existe déjà (002_core_tables.sql) mais représente le prix de vente.
-- On ajoute un champ "coût" distinct pour la rentabilité interne.
-- ----------------------------------------------------------
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS default_labor_cost_per_hour NUMERIC(8,2);

COMMENT ON COLUMN public.organizations.default_labor_cost_per_hour IS 'Coût horaire interne par défaut (€/h) — utilisé pour monétiser les pointages';

-- Taux override par membre (NULL = utilise le taux org)
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS labor_cost_per_hour NUMERIC(8,2);

COMMENT ON COLUMN public.memberships.labor_cost_per_hour IS 'Coût horaire interne de ce membre (€/h) — override du taux org si renseigné';

-- ----------------------------------------------------------
-- RLS chantier_expenses (même pattern que chantier_taches)
-- ----------------------------------------------------------
ALTER TABLE public.chantier_expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chantier_expenses_member"
  ON public.chantier_expenses FOR ALL TO authenticated
  USING (
    chantier_id IN (
      SELECT id FROM public.chantiers WHERE organization_id = public.get_user_org_id()
    )
  )
  WITH CHECK (
    chantier_id IN (
      SELECT id FROM public.chantiers WHERE organization_id = public.get_user_org_id()
    )
  );

-- ----------------------------------------------------------
-- Permissions chantier expenses
-- ----------------------------------------------------------
INSERT INTO public.permissions (key, label, category, position) VALUES
  ('chantiers.expenses.view',   'Voir les dépenses chantier',      'chantiers', 10),
  ('chantiers.expenses.create', 'Ajouter des dépenses chantier',   'chantiers', 11),
  ('chantiers.expenses.edit',   'Modifier des dépenses chantier',  'chantiers', 12),
  ('chantiers.expenses.delete', 'Supprimer des dépenses chantier', 'chantiers', 13)
ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, p.key, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug IN ('owner', 'admin', 'manager')
  AND p.key LIKE 'chantiers.expenses.%'
ON CONFLICT (role_id, permission_key) DO UPDATE SET is_allowed = true;
