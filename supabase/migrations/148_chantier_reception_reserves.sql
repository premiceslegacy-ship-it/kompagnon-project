-- Migration 148 : réception chantier et gestion des réserves BTP
--
-- Flux :
--   1. PV de réception prononcé → chantier.reception_at + chantier.reception_status
--   2. Les réserves sont listées dans chantier_reserves
--   3. Chaque réserve peut être levée (resolved_at renseigné)
--   4. Quand toutes les réserves sont levées → libération de la retenue de garantie

-- ── Réception sur le chantier ────────────────────────────────────────────────

ALTER TABLE chantiers
  ADD COLUMN IF NOT EXISTS reception_status TEXT
    CHECK (reception_status IN ('sans_reserve', 'avec_reserve', 'reserve_levee'))
    DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reception_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS reception_notes TEXT DEFAULT NULL;

COMMENT ON COLUMN chantiers.reception_status IS 'sans_reserve | avec_reserve | reserve_levee';
COMMENT ON COLUMN chantiers.reception_at IS 'Date de prononcé du PV de réception';

-- ── Table des réserves ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chantier_reserves (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id   UUID NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL,
  description   TEXT NOT NULL,
  lot           TEXT DEFAULT NULL,           -- lot concerné (ex: "Menuiserie", "Peinture")
  status        TEXT NOT NULL DEFAULT 'ouverte'
                  CHECK (status IN ('ouverte', 'levee')),
  resolved_at   TIMESTAMPTZ DEFAULT NULL,
  resolved_notes TEXT DEFAULT NULL,
  position      INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chantier_reserves_chantier ON chantier_reserves(chantier_id);
CREATE INDEX IF NOT EXISTS idx_chantier_reserves_org ON chantier_reserves(organization_id);

ALTER TABLE chantier_reserves ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_members_reserves" ON chantier_reserves
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
