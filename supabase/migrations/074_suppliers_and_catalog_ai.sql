-- ─── Table fournisseurs ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS suppliers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  contact_name     TEXT,
  email            TEXT,
  phone            TEXT,
  address          TEXT,
  siret            TEXT,
  payment_terms    TEXT,
  notes            TEXT,
  is_active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_suppliers_organization_id ON suppliers (organization_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_org_name ON suppliers (organization_id, name);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'suppliers_member'
  ) THEN
    CREATE POLICY "suppliers_member"
      ON suppliers FOR ALL TO authenticated
      USING (organization_id = public.get_user_org_id())
      WITH CHECK (organization_id = public.get_user_org_id());
  END IF;
END $$;

SELECT create_updated_at_trigger('suppliers');

-- ─── FK supplier_id sur materials (legacy supplier TEXT conservé) ───────────

ALTER TABLE materials
  ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_materials_supplier_id ON materials (supplier_id);

-- ─── Module catalog_ai dans organization_modules ────────────────────────────
-- Les modules sont stockés en JSONB dans organization_modules.modules.
-- Pas de migration de données nécessaire : le module est off par défaut
-- (normalizeOrganizationModules retourne false si la clé est absente et le
-- DEFAULT_ORGANIZATION_MODULES ne la connaît pas encore — on ajoute la clé
-- dans le code TypeScript uniquement).
