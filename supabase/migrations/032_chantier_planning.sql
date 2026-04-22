-- 032_chantier_planning.sql
-- Planification d'équipes sur les chantiers (date + heure)
-- Distinct des pointages (réel) : ici c'est le prévisionnel
-- Dépend de : 029_chantiers.sql, 030_chantiers_equipes.sql

CREATE TABLE IF NOT EXISTS public.chantier_plannings (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id     UUID        NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  planned_date    DATE        NOT NULL,
  start_time      TIME,
  end_time        TIME,
  -- Équipe formelle (créée dans chantier_equipes) — optionnelle
  equipe_id       UUID        REFERENCES public.chantier_equipes(id) ON DELETE SET NULL,
  -- Libellé libre : nom d'équipe ou de personne sans compte app
  label           TEXT        NOT NULL,   -- ex: "Équipe Nettoyage", "Jean-Pierre", "Sous-traitant Dupont"
  team_size       INT         DEFAULT 1 CHECK (team_size > 0),
  notes           TEXT,
  created_by      UUID        REFERENCES auth.users(id),
  created_at      TIMESTAMPTZ DEFAULT now()
);

COMMENT ON TABLE public.chantier_plannings IS
  'Plannings prévisionnels : qui travaille sur quel chantier, quelle date, quelle heure';
COMMENT ON COLUMN public.chantier_plannings.label IS
  'Nom libre : équipe, personne, sous-traitant — pré-rempli depuis equipe_id si fourni';
COMMENT ON COLUMN public.chantier_plannings.equipe_id IS
  'Équipe formelle (optionnel) — permet de lier au registre des équipes';
COMMENT ON COLUMN public.chantier_plannings.team_size IS
  'Nombre de personnes prévues pour ce créneau';

-- Index
CREATE INDEX IF NOT EXISTS idx_chantier_plannings_chantier
  ON public.chantier_plannings(chantier_id, planned_date);

CREATE INDEX IF NOT EXISTS idx_chantier_plannings_date
  ON public.chantier_plannings(planned_date);

-- RLS
ALTER TABLE public.chantier_plannings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chantier_plannings_all"
  ON public.chantier_plannings FOR ALL TO authenticated
  USING (
    chantier_id IN (
      SELECT id FROM public.chantiers
      WHERE organization_id = public.get_user_org_id()
    )
  )
  WITH CHECK (
    chantier_id IN (
      SELECT id FROM public.chantiers
      WHERE organization_id = public.get_user_org_id()
    )
  );
