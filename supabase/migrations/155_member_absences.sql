-- Absences / indisponibilités déclarées pour un membre (équipe ou intervenant
-- /mon-espace). Déclaratif uniquement : ne modifie jamais chantier_plannings
-- automatiquement. Sert de source de vérité pour exclure un membre absent des
-- suggestions de remplacement (Sarah, Nora).

CREATE TABLE IF NOT EXISTS public.member_absences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  member_id UUID NOT NULL REFERENCES public.chantier_equipe_membres(id) ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  reason TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_member_id UUID REFERENCES public.chantier_equipe_membres(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT member_absences_date_range CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_member_absences_member_dates
  ON public.member_absences(member_id, start_date, end_date);

CREATE INDEX IF NOT EXISTS idx_member_absences_org_dates
  ON public.member_absences(organization_id, start_date, end_date);

ALTER TABLE public.member_absences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "member_absences_all"
  ON public.member_absences FOR ALL
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

COMMENT ON TABLE public.member_absences IS
  'Absences/indisponibilités déclarées pour un membre. Ne modifie jamais chantier_plannings automatiquement : sert uniquement à exclure un membre absent des suggestions de remplacement.';
COMMENT ON COLUMN public.member_absences.created_by_member_id IS
  'Renseigné quand l''absence est déclarée par le membre lui-même depuis /mon-espace (sans compte app).';
