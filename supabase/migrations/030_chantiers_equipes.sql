-- 030_chantiers_equipes.sql
-- Équipes terrain + récurrence avancée sur chantiers
-- Dépend de : 029_chantiers.sql

-- ─── 1. Colonnes récurrence sur chantiers ────────────────────────────────────

ALTER TABLE chantiers
  ADD COLUMN IF NOT EXISTS recurrence TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS recurrence_times INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS recurrence_team_size INT,
  ADD COLUMN IF NOT EXISTS recurrence_duration_h DECIMAL(4,1),
  ADD COLUMN IF NOT EXISTS recurrence_notes TEXT;

COMMENT ON COLUMN chantiers.recurrence IS
  'Fréquence de récurrence : none|quotidien|plurihebdomadaire|hebdomadaire|mensuel|bimensuel|trimestriel';
COMMENT ON COLUMN chantiers.recurrence_times IS
  'Nombre de passages par période (ex : 3 pour 3x/semaine en plurihebdomadaire)';
COMMENT ON COLUMN chantiers.recurrence_team_size IS
  'Nombre de personnes par passage terrain';
COMMENT ON COLUMN chantiers.recurrence_duration_h IS
  'Durée estimée par passage en heures (ex : 2.5)';
COMMENT ON COLUMN chantiers.recurrence_notes IS
  'Informations complémentaires sur la récurrence (accès, matériel, consignes…)';

-- ─── 2. Colonne start_time sur chantier_pointages ────────────────────────────

ALTER TABLE chantier_pointages
  ADD COLUMN IF NOT EXISTS start_time TIME;

COMMENT ON COLUMN chantier_pointages.start_time IS
  'Heure de début optionnelle pour affichage calendrier (format HH:MM)';

-- ─── 3. Table chantier_equipes ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chantier_equipes (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  color           TEXT        NOT NULL DEFAULT '#6366f1',
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE chantier_equipes IS
  'Équipes terrain créées librement, sans compte app requis';

-- ─── 4. Table chantier_equipe_membres ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chantier_equipe_membres (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  equipe_id   UUID        NOT NULL REFERENCES chantier_equipes(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  role_label  TEXT,
  profile_id  UUID        REFERENCES profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE chantier_equipe_membres IS
  'Membres d''une équipe, nom libre sans compte requis';
COMMENT ON COLUMN chantier_equipe_membres.role_label IS
  'Libellé libre du rôle (ex : Chef d''équipe, Agent de nettoyage)';
COMMENT ON COLUMN chantier_equipe_membres.profile_id IS
  'Lien optionnel vers un profil utilisateur ayant un compte dans l''app';

-- ─── 5. Table chantier_equipe_chantiers ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS chantier_equipe_chantiers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id UUID        NOT NULL REFERENCES chantiers(id) ON DELETE CASCADE,
  equipe_id   UUID        NOT NULL REFERENCES chantier_equipes(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chantier_id, equipe_id)
);

COMMENT ON TABLE chantier_equipe_chantiers IS
  'Liaison équipes ↔ chantiers (plusieurs équipes par chantier)';

-- ─── 6. Trigger set_updated_at sur chantier_equipes ─────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'set_updated_at_chantier_equipes'
      AND tgrelid = 'chantier_equipes'::regclass
  ) THEN
    CREATE TRIGGER set_updated_at_chantier_equipes
      BEFORE UPDATE ON chantier_equipes
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;

-- ─── 7. Index ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_chantier_equipes_org
  ON chantier_equipes(organization_id);

CREATE INDEX IF NOT EXISTS idx_chantier_equipe_membres_eq
  ON chantier_equipe_membres(equipe_id);

CREATE INDEX IF NOT EXISTS idx_chantier_eq_chantiers_c
  ON chantier_equipe_chantiers(chantier_id);

CREATE INDEX IF NOT EXISTS idx_chantier_eq_chantiers_e
  ON chantier_equipe_chantiers(equipe_id);

CREATE INDEX IF NOT EXISTS idx_chantiers_recurrence
  ON chantiers(organization_id, recurrence)
  WHERE recurrence IS DISTINCT FROM 'none';

-- ─── 8. Row Level Security ───────────────────────────────────────────────────

ALTER TABLE chantier_equipes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE chantier_equipe_membres    ENABLE ROW LEVEL SECURITY;
ALTER TABLE chantier_equipe_chantiers  ENABLE ROW LEVEL SECURITY;

-- ─── 9. Politiques RLS ───────────────────────────────────────────────────────

-- chantier_equipes : 4 politiques (select / insert / update / delete)

CREATE POLICY "chantier_equipes_select"
  ON chantier_equipes FOR SELECT
  USING (organization_id = get_user_org_id());

CREATE POLICY "chantier_equipes_insert"
  ON chantier_equipes FOR INSERT
  WITH CHECK (
    organization_id = get_user_org_id()
    AND user_has_permission('chantiers.edit')
  );

CREATE POLICY "chantier_equipes_update"
  ON chantier_equipes FOR UPDATE
  USING (
    organization_id = get_user_org_id()
    AND user_has_permission('chantiers.edit')
  )
  WITH CHECK (
    organization_id = get_user_org_id()
    AND user_has_permission('chantiers.edit')
  );

CREATE POLICY "chantier_equipes_delete"
  ON chantier_equipes FOR DELETE
  USING (
    organization_id = get_user_org_id()
    AND user_has_permission('chantiers.edit')
  );

-- chantier_equipe_membres : 1 politiques ALL via l'organisation de l'équipe

CREATE POLICY "chantier_equipe_membres_all"
  ON chantier_equipe_membres FOR ALL
  USING (
    equipe_id IN (
      SELECT id FROM chantier_equipes
      WHERE organization_id = get_user_org_id()
    )
  )
  WITH CHECK (
    equipe_id IN (
      SELECT id FROM chantier_equipes
      WHERE organization_id = get_user_org_id()
    )
  );

-- chantier_equipe_chantiers : 1 politique ALL via l'organisation du chantier

CREATE POLICY "chantier_equipe_chantiers_all"
  ON chantier_equipe_chantiers FOR ALL
  USING (
    chantier_id IN (
      SELECT id FROM chantiers
      WHERE organization_id = get_user_org_id()
    )
  )
  WITH CHECK (
    chantier_id IN (
      SELECT id FROM chantiers
      WHERE organization_id = get_user_org_id()
    )
  );
