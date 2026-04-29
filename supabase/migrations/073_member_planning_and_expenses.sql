-- ============================================================
-- 073_member_planning_and_expenses.sql
-- Membres individuels + planning par membre + espace membre + rentabilité enrichie
-- Dépend de : 029, 030, 032, 067, 069, 002, 003
-- ============================================================

-- ─── 1. Membres individuels orphelins (sans équipe parente) ──────────────────

ALTER TABLE public.chantier_equipe_membres
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS prenom          TEXT,
  ADD COLUMN IF NOT EXISTS email           TEXT;

UPDATE public.chantier_equipe_membres m
   SET organization_id = e.organization_id
  FROM public.chantier_equipes e
 WHERE m.equipe_id = e.id
   AND m.organization_id IS NULL;

ALTER TABLE public.chantier_equipe_membres
  ALTER COLUMN organization_id SET NOT NULL,
  ALTER COLUMN equipe_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_equipe_membres_org
  ON public.chantier_equipe_membres(organization_id);

CREATE INDEX IF NOT EXISTS idx_chantier_equipe_membres_email
  ON public.chantier_equipe_membres(organization_id, lower(email))
  WHERE email IS NOT NULL;

DROP POLICY IF EXISTS "chantier_equipe_membres_all" ON public.chantier_equipe_membres;
CREATE POLICY "chantier_equipe_membres_all"
  ON public.chantier_equipe_membres FOR ALL
  USING (organization_id = public.get_user_org_id())
  WITH CHECK (organization_id = public.get_user_org_id());

COMMENT ON COLUMN public.chantier_equipe_membres.equipe_id       IS 'Équipe parente — NULL pour un membre individuel sans équipe';
COMMENT ON COLUMN public.chantier_equipe_membres.organization_id IS 'Org de rattachement (toujours requis, propage l''isolation RLS)';
COMMENT ON COLUMN public.chantier_equipe_membres.prenom          IS 'Prénom (le champ name continue à porter le nom de famille)';
COMMENT ON COLUMN public.chantier_equipe_membres.email           IS 'Email pour envoi du lien d''accès à /mon-espace + rapports d''heures';

-- ─── 2. Liaison many-to-many membre individuel ↔ chantier ────────────────────

CREATE TABLE IF NOT EXISTS public.chantier_individual_members (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  chantier_id UUID        NOT NULL REFERENCES public.chantiers(id) ON DELETE CASCADE,
  member_id   UUID        NOT NULL REFERENCES public.chantier_equipe_membres(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chantier_id, member_id)
);

CREATE INDEX IF NOT EXISTS idx_chantier_individual_members_c
  ON public.chantier_individual_members(chantier_id);
CREATE INDEX IF NOT EXISTS idx_chantier_individual_members_m
  ON public.chantier_individual_members(member_id);

ALTER TABLE public.chantier_individual_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chantier_individual_members_all"
  ON public.chantier_individual_members FOR ALL
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

COMMENT ON TABLE public.chantier_individual_members IS
  'Membres individuels (sans équipe) assignés directement à un chantier';

-- ─── 3. Planning par membre individuel ───────────────────────────────────────

ALTER TABLE public.chantier_plannings
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES public.chantier_equipe_membres(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_chantier_plannings_member
  ON public.chantier_plannings(member_id)
  WHERE member_id IS NOT NULL;

COMMENT ON COLUMN public.chantier_plannings.member_id IS
  'Membre individuel planifié — alternative à equipe_id pour les créneaux solo';

-- ─── 4. Pointages : permettre member_id pour les pointages sans compte ──────

ALTER TABLE public.chantier_pointages
  ADD COLUMN IF NOT EXISTS member_id UUID REFERENCES public.chantier_equipe_membres(id) ON DELETE SET NULL;

ALTER TABLE public.chantier_pointages
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.chantier_pointages
  DROP CONSTRAINT IF EXISTS chantier_pointages_who;

ALTER TABLE public.chantier_pointages
  ADD CONSTRAINT chantier_pointages_who
  CHECK (user_id IS NOT NULL OR member_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_chantier_pointages_member
  ON public.chantier_pointages(member_id)
  WHERE member_id IS NOT NULL;

COMMENT ON COLUMN public.chantier_pointages.member_id IS
  'Auteur du pointage quand il s''agit d''un membre individuel sans compte auth';

-- ─── 5. Magic link pour /mon-espace ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.member_space_tokens (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id    UUID        NOT NULL REFERENCES public.chantier_equipe_membres(id) ON DELETE CASCADE,
  token_hash   TEXT        NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_member_space_tokens_member
  ON public.member_space_tokens(member_id);

CREATE INDEX IF NOT EXISTS idx_member_space_tokens_expires
  ON public.member_space_tokens(expires_at);

ALTER TABLE public.member_space_tokens ENABLE ROW LEVEL SECURITY;

-- Aucun accès via clé anon : la vérification passe exclusivement par service role
CREATE POLICY "member_space_tokens_deny_all"
  ON public.member_space_tokens FOR ALL
  USING (false)
  WITH CHECK (false);

COMMENT ON TABLE public.member_space_tokens IS
  'Tokens magic link pour accès à /mon-espace (token_hash = sha256 du token brut)';

-- ─── 6. Toggle org : envoi automatique du rapport mensuel ────────────────────

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS auto_send_member_reports BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.auto_send_member_reports IS
  'Si true, envoi automatique le 1er du mois du rapport d''heures du mois précédent à chaque membre avec email';

-- ─── 7. Rentabilité chantier : enrichissement chantier_expenses ──────────────

ALTER TABLE public.chantier_expenses
  ADD COLUMN IF NOT EXISTS quantity              NUMERIC(12,3),
  ADD COLUMN IF NOT EXISTS unit                  TEXT,
  ADD COLUMN IF NOT EXISTS unit_price_ht         NUMERIC(12,4),
  ADD COLUMN IF NOT EXISTS material_id           UUID REFERENCES public.materials(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS subcategory           TEXT,
  -- Détails carburant (si category='transport' et subcategory='carburant')
  ADD COLUMN IF NOT EXISTS transport_km          NUMERIC(10,2),
  ADD COLUMN IF NOT EXISTS transport_consumption NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS transport_fuel_price  NUMERIC(6,3),
  -- Détails location (si category='location')
  ADD COLUMN IF NOT EXISTS rental_item_label     TEXT,
  ADD COLUMN IF NOT EXISTS rental_start_date     DATE,
  ADD COLUMN IF NOT EXISTS rental_end_date       DATE;

CREATE INDEX IF NOT EXISTS idx_chantier_expenses_material
  ON public.chantier_expenses(material_id)
  WHERE material_id IS NOT NULL;

COMMENT ON COLUMN public.chantier_expenses.quantity        IS 'Quantité (multiplie unit_price_ht pour donner amount_ht)';
COMMENT ON COLUMN public.chantier_expenses.unit            IS 'Unité libre : h|j|sem|mois|u|m²|ml|kg|L|km|forfait…';
COMMENT ON COLUMN public.chantier_expenses.unit_price_ht   IS 'Prix unitaire HT (× quantity = amount_ht)';
COMMENT ON COLUMN public.chantier_expenses.material_id     IS 'Lien facultatif vers le catalogue matériaux/services (table materials)';
COMMENT ON COLUMN public.chantier_expenses.subcategory     IS 'Sous-catégorie : carburant|peage|echafaudage|nacelle|auto_laveuse… (selon category + secteur org)';
COMMENT ON COLUMN public.chantier_expenses.transport_km    IS 'Kilomètres parcourus (si subcategory=carburant)';
COMMENT ON COLUMN public.chantier_expenses.transport_consumption IS 'Consommation L/100km du véhicule';
COMMENT ON COLUMN public.chantier_expenses.transport_fuel_price  IS 'Prix carburant €/L au moment de la dépense';
COMMENT ON COLUMN public.chantier_expenses.rental_item_label     IS 'Libellé de l''équipement loué (rempli depuis le catalogue secteur ou saisie libre)';
