-- ============================================================
-- 139_ai_permission_and_briefs.sql
--
-- 1. Permission ai.sarah : accès aux assistants IA (Sarah, Chloé, Marco, Nora, Léa)
--    - Owner : toujours autorisé (via slug 'owner' → wildcard '*' dans le code)
--    - Max 2 personnes par org : owner + 1 membre explicitement autorisé
--    - Par défaut : aucun autre rôle n'a cette permission
--
-- 2. Table ai_briefs : briefs inter-assistants persistants
--    - Sarah → Chloé (brief devis)
--    - Sarah → Nora (brief planning)
--    - Sarah → Marco (action chantier)
--    - Auto-expiration après 7 jours (filtrée en requête, pas de cron)
-- ============================================================

-- ----------------------------------------------------------
-- 1. Permission ai.sarah
-- ----------------------------------------------------------
INSERT INTO public.permissions (key, label, category, position)
VALUES ('ai.sarah', 'Accès aux assistants IA', 'ai', 1)
ON CONFLICT (key) DO UPDATE SET
  label    = EXCLUDED.label,
  category = EXCLUDED.category,
  position = EXCLUDED.position;

-- Accorder ai.sarah à tous les owners existants via leur role_permissions
-- (L'owner bypasse déjà tout via '*' dans le code, mais on l'insère
--  pour qu'il apparaisse correctement dans l'UI de gestion des rôles)
INSERT INTO public.role_permissions (role_id, permission_key, is_allowed)
SELECT r.id, 'ai.sarah', true
FROM public.roles r
WHERE r.slug = 'owner'
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_key = 'ai.sarah'
  );

-- Les autres rôles (admin, collaborateur, technicien, etc.) n'ont PAS ai.sarah par défaut.
-- L'owner doit manuellement cocher la permission dans Paramètres > Rôles pour un second membre.

-- ----------------------------------------------------------
-- 2. Table ai_briefs
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_briefs (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_assistant TEXT        NOT NULL,  -- 'sarah' | 'marco' | 'nora'
  target_assistant TEXT        NOT NULL,  -- 'chloe' | 'nora' | 'marco'
  payload          JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'pending',  -- 'pending' | 'consumed'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  consumed_at      TIMESTAMPTZ
);

-- Index pour les lookups fréquents (org + target + status + date)
CREATE INDEX IF NOT EXISTS ai_briefs_org_target_status_idx
  ON public.ai_briefs (organization_id, target_assistant, status, created_at DESC);

-- RLS
ALTER TABLE public.ai_briefs ENABLE ROW LEVEL SECURITY;

-- Les membres authentifiés d'une org peuvent lire et écrire les briefs de leur org
CREATE POLICY "ai_briefs_org_member" ON public.ai_briefs
  FOR ALL
  USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- ----------------------------------------------------------
-- 3. Révocation execute anon sur ai_briefs (sécurité)
-- ----------------------------------------------------------
-- Pas de fonction SQL sur cette table, RLS suffit.
