-- ============================================================
-- 095_member_goals.sql
-- Objectifs individuels par membre, fixés par owner/admin/manager
-- Dépend de : 073_member_planning_and_expenses.sql
-- ============================================================

-- ─── Table member_goals ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.member_goals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id       UUID        NOT NULL REFERENCES public.chantier_equipe_membres(id) ON DELETE CASCADE,
  period_year     INT         NOT NULL,
  period_month    INT         NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  metric          TEXT        NOT NULL,
  -- 'heures_terrain'       : heures pointées sur chantiers
  -- 'taches_completees'    : nombre de tâches marquées terminées
  -- 'chantiers_traites'    : nombre de chantiers distincts travaillés
  -- 'custom'               : objectif libre
  label           TEXT,       -- libellé affiché à l'utilisateur (ex: "Heures terrain")
  target          DECIMAL(10,2) NOT NULL,
  unit            TEXT        DEFAULT '',  -- 'h', '', 'chantiers', etc.
  note            TEXT,       -- note privée pour l'admin
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (member_id, period_year, period_month, metric)
);

CREATE INDEX IF NOT EXISTS idx_member_goals_org
  ON public.member_goals(organization_id);

CREATE INDEX IF NOT EXISTS idx_member_goals_member_period
  ON public.member_goals(member_id, period_year, period_month);

ALTER TABLE public.member_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_goals_all"
  ON public.member_goals FOR ALL
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

COMMENT ON TABLE public.member_goals IS
  'Objectifs individuels mensuels par membre (heures, tâches, chantiers, custom). Fixés par owner/admin/manager.';

COMMENT ON COLUMN public.member_goals.metric IS
  'heures_terrain | taches_completees | chantiers_traites | custom';

-- ─── Permission dashboard.view_goals sur employee/collaborateur/viewer ────────
-- Ces rôles voient leurs propres objectifs (pas les KPI CA)

INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, 'dashboard.view_goals', true
FROM public.roles r
WHERE r.slug IN ('employee', 'collaborateur', 'viewer')
  AND r.organization_id IN (SELECT id FROM public.organizations)
ON CONFLICT DO NOTHING;
