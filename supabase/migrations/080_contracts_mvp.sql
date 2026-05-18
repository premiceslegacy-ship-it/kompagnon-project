-- ============================================================
-- 080_contracts_mvp.sql
-- Module contrats MVP : contrats paramétrables, snapshots PDF, RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.contracts (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id           UUID        REFERENCES public.clients(id) ON DELETE SET NULL,
  chantier_id         UUID        REFERENCES public.chantiers(id) ON DELETE SET NULL,
  contract_type       TEXT        NOT NULL CHECK (contract_type IN ('sous_traitance', 'maintenance')),
  role                TEXT        NOT NULL CHECK (role IN ('donneur_ordre', 'sous_traitant')),
  status              TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'signed', 'archived')),
  title               TEXT        NOT NULL,
  counterparty_name   TEXT        NOT NULL,
  counterparty_email  TEXT,
  counterparty_phone  TEXT,
  counterparty_address TEXT,
  template_key        TEXT        NOT NULL,
  template_title      TEXT        NOT NULL,
  clauses             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  pdf_reference       TEXT,
  pdf_generated_at    TIMESTAMPTZ,
  pdf_snapshot        JSONB,
  sent_at             TIMESTAMPTZ,
  signed_at           TIMESTAMPTZ,
  archived_at         TIMESTAMPTZ,
  created_by          UUID        REFERENCES auth.users(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.contracts IS 'Contrats métier BTP générés depuis des modèles paramétrables';
COMMENT ON COLUMN public.contracts.contract_type IS 'sous_traitance | maintenance';
COMMENT ON COLUMN public.contracts.role IS 'donneur_ordre | sous_traitant';
COMMENT ON COLUMN public.contracts.status IS 'draft | sent | signed | archived';
COMMENT ON COLUMN public.contracts.pdf_snapshot IS 'Snapshot figé utilisé pour régénérer le PDF archivé';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_contracts'
  ) THEN
    CREATE TRIGGER set_updated_at_contracts
      BEFORE UPDATE ON public.contracts
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contracts_org ON public.contracts(organization_id);
CREATE INDEX IF NOT EXISTS idx_contracts_client ON public.contracts(client_id);
CREATE INDEX IF NOT EXISTS idx_contracts_chantier ON public.contracts(chantier_id);
CREATE INDEX IF NOT EXISTS idx_contracts_status ON public.contracts(organization_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS contracts_pdf_reference_unique
  ON public.contracts(organization_id, pdf_reference)
  WHERE pdf_reference IS NOT NULL;

ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "contracts_select"
  ON public.contracts FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('contracts.view')
  );

CREATE POLICY "contracts_insert"
  ON public.contracts FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('contracts.create')
  );

CREATE POLICY "contracts_update"
  ON public.contracts FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('contracts.edit')
  );

CREATE POLICY "contracts_delete"
  ON public.contracts FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('contracts.delete')
  );

INSERT INTO public.permissions (key, label, category, position) VALUES
  ('contracts.view', 'Voir les contrats', 'contracts', 1),
  ('contracts.create', 'Créer des contrats', 'contracts', 2),
  ('contracts.edit', 'Modifier les contrats', 'contracts', 3),
  ('contracts.delete', 'Supprimer les contrats', 'contracts', 4)
ON CONFLICT (key) DO UPDATE SET
  label = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, p.key, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.key LIKE 'contracts.%'
  AND r.slug IN ('owner', 'admin', 'manager')
ON CONFLICT (role_id, permission_key) DO UPDATE SET is_allowed = true;

