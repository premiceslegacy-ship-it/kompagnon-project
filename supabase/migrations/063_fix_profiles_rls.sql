-- ============================================================
-- 063_fix_profiles_rls.sql
-- Corrige la politique RLS de profiles :
-- La politique en prod ne permettait de lire que son propre profil.
-- On la remplace par une politique qui autorise aussi la lecture
-- des profils des membres de la même organisation.
-- ============================================================

DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select" ON public.profiles;

CREATE POLICY "profiles_select"
  ON public.profiles FOR SELECT TO authenticated
  USING (
    auth.uid() = public.profiles.id
    OR EXISTS (
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2
        ON m1.organization_id = m2.organization_id
      WHERE m1.user_id = auth.uid()
        AND m1.is_active = true
        AND m2.user_id = public.profiles.id
        AND m2.is_active = true
    )
  );
