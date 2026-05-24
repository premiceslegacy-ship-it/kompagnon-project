-- 106_chantier_task_assignments.sql
-- Assignations multiples des tâches chantier à des équipes ou membres terrain.

CREATE TABLE IF NOT EXISTS public.chantier_task_assignments (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tache_id    UUID        NOT NULL REFERENCES public.chantier_taches(id) ON DELETE CASCADE,
  equipe_id   UUID        REFERENCES public.chantier_equipes(id) ON DELETE CASCADE,
  member_id   UUID        REFERENCES public.chantier_equipe_membres(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chantier_task_assignments_target_check CHECK (
    (equipe_id IS NOT NULL AND member_id IS NULL)
    OR
    (equipe_id IS NULL AND member_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS chantier_task_assignments_unique_equipe
  ON public.chantier_task_assignments(tache_id, equipe_id)
  WHERE equipe_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS chantier_task_assignments_unique_member
  ON public.chantier_task_assignments(tache_id, member_id)
  WHERE member_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_task_assignments_tache
  ON public.chantier_task_assignments(tache_id);

CREATE INDEX IF NOT EXISTS idx_chantier_task_assignments_equipe
  ON public.chantier_task_assignments(equipe_id)
  WHERE equipe_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_task_assignments_member
  ON public.chantier_task_assignments(member_id)
  WHERE member_id IS NOT NULL;

ALTER TABLE public.chantier_task_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chantier_task_assignments_all"
  ON public.chantier_task_assignments FOR ALL TO authenticated
  USING (
    tache_id IN (
      SELECT t.id
      FROM public.chantier_taches t
      JOIN public.chantiers c ON c.id = t.chantier_id
      WHERE c.organization_id = public.get_user_org_id()
    )
  )
  WITH CHECK (
    tache_id IN (
      SELECT t.id
      FROM public.chantier_taches t
      JOIN public.chantiers c ON c.id = t.chantier_id
      WHERE c.organization_id = public.get_user_org_id()
    )
  );

COMMENT ON TABLE public.chantier_task_assignments IS
  'Assignations multiples des tâches chantier à une équipe ou un membre terrain.';
