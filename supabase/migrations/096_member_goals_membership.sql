-- ============================================================
-- 096_member_goals_membership.sql
-- Étend member_goals pour accepter les membres org (membership_id)
-- sans exiger une fiche intervenant (chantier_equipe_membres).
-- ============================================================

-- 1. Rendre member_id nullable
ALTER TABLE public.member_goals
  ALTER COLUMN member_id DROP NOT NULL;

-- 2. Ajouter membership_id (FK vers memberships)
ALTER TABLE public.member_goals
  ADD COLUMN IF NOT EXISTS membership_id UUID REFERENCES public.memberships(id) ON DELETE CASCADE;

-- 3. Contrainte : exactement l'un des deux doit être non null
ALTER TABLE public.member_goals
  DROP CONSTRAINT IF EXISTS member_goals_member_xor_membership;

ALTER TABLE public.member_goals
  ADD CONSTRAINT member_goals_member_xor_membership
  CHECK (
    (member_id IS NOT NULL AND membership_id IS NULL)
    OR
    (member_id IS NULL AND membership_id IS NOT NULL)
  );

-- 4. Supprimer l'ancienne contrainte UNIQUE (basée sur member_id seul)
ALTER TABLE public.member_goals
  DROP CONSTRAINT IF EXISTS member_goals_member_id_period_year_period_month_metric_key;

-- 5. Nouvelles contraintes UNIQUE pour les deux cas
ALTER TABLE public.member_goals
  DROP CONSTRAINT IF EXISTS member_goals_uniq_intervenant;
ALTER TABLE public.member_goals
  ADD CONSTRAINT member_goals_uniq_intervenant
  UNIQUE NULLS NOT DISTINCT (member_id, period_year, period_month, metric);

ALTER TABLE public.member_goals
  DROP CONSTRAINT IF EXISTS member_goals_uniq_org_member;
ALTER TABLE public.member_goals
  ADD CONSTRAINT member_goals_uniq_org_member
  UNIQUE NULLS NOT DISTINCT (membership_id, period_year, period_month, metric);

-- 6. Index sur membership_id
CREATE INDEX IF NOT EXISTS idx_member_goals_membership
  ON public.member_goals(membership_id)
  WHERE membership_id IS NOT NULL;

COMMENT ON COLUMN public.member_goals.member_id IS
  'Intervenant terrain (chantier_equipe_membres) — exclusif avec membership_id';

COMMENT ON COLUMN public.member_goals.membership_id IS
  'Membre org avec compte app (memberships) — exclusif avec member_id';
