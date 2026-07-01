-- Migration 149 : correctif RLS chantier_reserves
--
-- La politique initiale (migration 148) utilisait `= (... LIMIT 1)` sans `is_active`,
-- ce qui (a) ne couvrait qu'une seule org de façon non deterministe pour un user
-- multi-org et (b) laissait l'acces aux memberships desactives.
-- On l'aligne sur le standard du projet : FOR ALL + IN (...) + is_active = true.

DROP POLICY IF EXISTS "org_access_reserves" ON chantier_reserves;

DROP POLICY IF EXISTS "org_members_reserves" ON chantier_reserves;

CREATE POLICY "org_members_reserves" ON chantier_reserves
  FOR ALL USING (
    organization_id IN (
      SELECT organization_id FROM public.memberships
      WHERE user_id = auth.uid() AND is_active = true
    )
  );
