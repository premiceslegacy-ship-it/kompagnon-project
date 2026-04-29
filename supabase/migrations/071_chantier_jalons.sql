-- ============================================================
-- 071_chantier_jalons.sql
-- Jalons d'acompte par chantier — étapes structurées remplaçant
-- le curseur libre des factures de situation.
-- Chaque jalon regroupe des tâches (scope) et un % d'acompte.
-- Quand toutes les tâches sont terminées, l'utilisateur valide
-- le jalon (rapport) et peut générer la facture correspondante.
-- Dépend de : 029_chantiers.sql, 070_invoices_chantier_link.sql
-- ============================================================

CREATE TABLE IF NOT EXISTS public.chantier_jalons (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID          NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  chantier_id       UUID          NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  position          INT           NOT NULL DEFAULT 0,
  title             TEXT          NOT NULL,
  description       TEXT,
  acompte_pct       NUMERIC(5,2)  NOT NULL CHECK (acompte_pct >= 0 AND acompte_pct <= 100),
  status            TEXT          NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','completed','invoiced')),
  completion_report TEXT,
  completed_at      TIMESTAMPTZ,
  invoice_id        UUID          REFERENCES public.invoices(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now()
);

COMMENT ON TABLE  public.chantier_jalons             IS 'Jalons d''acompte d''un chantier — étape = ensemble de tâches + % du budget à facturer';
COMMENT ON COLUMN public.chantier_jalons.acompte_pct IS '% du budget chantier (ou du devis) facturé à la complétion du jalon';
COMMENT ON COLUMN public.chantier_jalons.status      IS 'pending | in_progress | completed | invoiced';

CREATE INDEX IF NOT EXISTS idx_chantier_jalons_chantier ON public.chantier_jalons(chantier_id, position);
CREATE INDEX IF NOT EXISTS idx_chantier_jalons_org      ON public.chantier_jalons(organization_id);

-- Lien tâche → jalon (scope du jalon)
ALTER TABLE public.chantier_taches
  ADD COLUMN IF NOT EXISTS jalon_id UUID REFERENCES public.chantier_jalons(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_taches_jalon ON public.chantier_taches(jalon_id);

-- Trigger updated_at
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'set_updated_at_chantier_jalons') THEN
    CREATE TRIGGER set_updated_at_chantier_jalons
      BEFORE UPDATE ON public.chantier_jalons
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- RLS — même pattern que chantier_taches
ALTER TABLE public.chantier_jalons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chantier_jalons_member"
  ON public.chantier_jalons FOR ALL TO authenticated
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
