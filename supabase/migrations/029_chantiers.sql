-- ============================================================
-- 029_chantiers.sql
-- Suivi de chantier : tables, RLS, permissions, indexes
-- Dépend de : 002_core_tables.sql, 004_business_tables.sql
-- ============================================================

-- ----------------------------------------------------------
-- chantiers
-- Table principale, org-scoped, liée optionnellement à un devis accepté
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chantiers (
  id                   UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  quote_id             UUID          REFERENCES public.quotes(id) ON DELETE SET NULL,
  client_id            UUID          REFERENCES public.clients(id) ON DELETE SET NULL,
  title                TEXT          NOT NULL,
  description          TEXT,
  address_line1        TEXT,
  postal_code          TEXT,
  city                 TEXT,
  status               TEXT          NOT NULL DEFAULT 'planifie',
  -- 'planifie' | 'en_cours' | 'suspendu' | 'termine' | 'annule'
  start_date           DATE,
  end_date             DATE,
  estimated_end_date   DATE,
  budget_ht            DECIMAL(15,2) DEFAULT 0,
  is_archived          BOOLEAN       DEFAULT false,
  created_by           UUID          REFERENCES auth.users(id),
  created_at           TIMESTAMPTZ   DEFAULT now(),
  updated_at           TIMESTAMPTZ   DEFAULT now(),
  -- Un devis ne peut générer qu'un seul chantier
  CONSTRAINT chantiers_quote_unique UNIQUE (quote_id)
);

COMMENT ON TABLE public.chantiers IS 'Chantiers BTP liés optionnellement à un devis accepté';
COMMENT ON COLUMN public.chantiers.status IS 'planifie | en_cours | suspendu | termine | annule';

-- ----------------------------------------------------------
-- chantier_taches
-- Tâches d'un chantier, ordonnées par position (drag-and-drop)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chantier_taches (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id  UUID        NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  title        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'a_faire',
  -- 'a_faire' | 'en_cours' | 'termine'
  position     INT         NOT NULL DEFAULT 0,
  assigned_to  UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  due_date     DATE,
  completed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN public.chantier_taches.status IS 'a_faire | en_cours | termine';
COMMENT ON COLUMN public.chantier_taches.position IS 'Ordre dans la liste (drag-and-drop)';

-- ----------------------------------------------------------
-- chantier_pointages
-- Heures travaillées par chantier / tâche / utilisateur
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chantier_pointages (
  id          UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id UUID          NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  tache_id    UUID          REFERENCES public.chantier_taches(id) ON DELETE SET NULL,
  user_id     UUID          NOT NULL REFERENCES public.profiles(id),
  date        DATE          NOT NULL,
  hours       DECIMAL(4,1)  NOT NULL CHECK (hours > 0 AND hours <= 24),
  description TEXT,
  created_at  TIMESTAMPTZ   DEFAULT now()
);

COMMENT ON COLUMN public.chantier_pointages.hours IS 'Heures pointées (1 décimale, ex: 7.5)';

-- ----------------------------------------------------------
-- chantier_notes
-- Journal de chantier — entrées chronologiques
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chantier_notes (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id UUID        NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  author_id   UUID        NOT NULL REFERENCES public.profiles(id),
  content     TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ----------------------------------------------------------
-- chantier_photos
-- Photos de preuve liées à un chantier (et optionnellement une tâche)
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.chantier_photos (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id  UUID        NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  tache_id     UUID        REFERENCES public.chantier_taches(id) ON DELETE SET NULL,
  uploaded_by  UUID        NOT NULL REFERENCES public.profiles(id),
  storage_path TEXT        NOT NULL,
  caption      TEXT,
  taken_at     TIMESTAMPTZ DEFAULT now(),
  created_at   TIMESTAMPTZ DEFAULT now()
);

COMMENT ON COLUMN public.chantier_photos.storage_path IS 'Chemin dans Supabase Storage bucket chantier-photos';

-- ----------------------------------------------------------
-- Trigger updated_at sur chantiers
-- ----------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_chantiers'
  ) THEN
    CREATE TRIGGER set_updated_at_chantiers
      BEFORE UPDATE ON public.chantiers
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------
-- Indexes
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_chantiers_org        ON public.chantiers(organization_id);
CREATE INDEX IF NOT EXISTS idx_chantiers_client      ON public.chantiers(client_id);
CREATE INDEX IF NOT EXISTS idx_chantiers_quote       ON public.chantiers(quote_id);
CREATE INDEX IF NOT EXISTS idx_chantiers_status      ON public.chantiers(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_chantier_taches_c     ON public.chantier_taches(chantier_id, position);
CREATE INDEX IF NOT EXISTS idx_chantier_pointages_c  ON public.chantier_pointages(chantier_id);
CREATE INDEX IF NOT EXISTS idx_chantier_notes_c      ON public.chantier_notes(chantier_id);
CREATE INDEX IF NOT EXISTS idx_chantier_photos_c     ON public.chantier_photos(chantier_id);

-- ----------------------------------------------------------
-- RLS
-- ----------------------------------------------------------
ALTER TABLE public.chantiers         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chantier_taches   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chantier_pointages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chantier_notes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chantier_photos   ENABLE ROW LEVEL SECURITY;

-- chantiers : accès org + permission
CREATE POLICY "chantiers_select"
  ON public.chantiers FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.view')
  );

CREATE POLICY "chantiers_insert"
  ON public.chantiers FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.create')
  );

CREATE POLICY "chantiers_update"
  ON public.chantiers FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.edit')
  );

CREATE POLICY "chantiers_delete"
  ON public.chantiers FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.delete')
  );

-- Tables enfant : accès via le chantier parent (même pattern que quote_items/invoice_items)
CREATE POLICY "chantier_taches_member"
  ON public.chantier_taches FOR ALL TO authenticated
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

CREATE POLICY "chantier_pointages_member"
  ON public.chantier_pointages FOR ALL TO authenticated
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

CREATE POLICY "chantier_notes_member"
  ON public.chantier_notes FOR ALL TO authenticated
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

CREATE POLICY "chantier_photos_member"
  ON public.chantier_photos FOR ALL TO authenticated
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
-- Permissions chantiers (idempotentes)
-- ----------------------------------------------------------
INSERT INTO public.permissions (key, label, category, position) VALUES
  ('chantiers.view',   'Voir les chantiers',      'chantiers', 1),
  ('chantiers.create', 'Créer des chantiers',      'chantiers', 2),
  ('chantiers.edit',   'Modifier des chantiers',   'chantiers', 3),
  ('chantiers.delete', 'Supprimer des chantiers',  'chantiers', 4)
ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

-- Accorder toutes les permissions chantiers au rôle owner, admin et manager de chaque org existante
-- (les nouvelles orgs les reçoivent via initialize_organization_for_user — à mettre à jour séparément)
-- Note : role_permissions utilise permission_key TEXT (pas permission_id UUID)
INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, p.key, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.slug IN ('owner', 'admin', 'manager')
  AND p.key LIKE 'chantiers.%'
ON CONFLICT (role_id, permission_key) DO UPDATE SET is_allowed = true;
