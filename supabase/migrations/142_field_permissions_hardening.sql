-- 142_field_permissions_hardening.sql
-- Tighten field-production permissions for maintenance and global time logs.
-- Server actions already enforce these checks; these RLS policies make the
-- database enforce the same boundary for authenticated Supabase clients.

-- Maintenance contracts: chantier domain permissions.
DROP POLICY IF EXISTS "maintenance_contracts_select" ON public.maintenance_contracts;
DROP POLICY IF EXISTS "maintenance_contracts_insert" ON public.maintenance_contracts;
DROP POLICY IF EXISTS "maintenance_contracts_update" ON public.maintenance_contracts;
DROP POLICY IF EXISTS "maintenance_contracts_delete" ON public.maintenance_contracts;

CREATE POLICY "maintenance_contracts_select"
  ON public.maintenance_contracts FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.view')
  );

CREATE POLICY "maintenance_contracts_insert"
  ON public.maintenance_contracts FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.create')
  );

CREATE POLICY "maintenance_contracts_update"
  ON public.maintenance_contracts FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('chantiers.edit')
      OR public.user_has_permission('chantiers.delete')
    )
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('chantiers.edit')
      OR public.user_has_permission('chantiers.delete')
    )
  );

CREATE POLICY "maintenance_contracts_delete"
  ON public.maintenance_contracts FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.delete')
  );

-- Maintenance interventions: edit permission for production writes.
DROP POLICY IF EXISTS "maintenance_interventions_select" ON public.maintenance_interventions;
DROP POLICY IF EXISTS "maintenance_interventions_insert" ON public.maintenance_interventions;
DROP POLICY IF EXISTS "maintenance_interventions_update" ON public.maintenance_interventions;
DROP POLICY IF EXISTS "maintenance_interventions_delete" ON public.maintenance_interventions;

CREATE POLICY "maintenance_interventions_select"
  ON public.maintenance_interventions FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.view')
  );

CREATE POLICY "maintenance_interventions_insert"
  ON public.maintenance_interventions FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.edit')
  );

CREATE POLICY "maintenance_interventions_update"
  ON public.maintenance_interventions FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.edit')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.edit')
  );

CREATE POLICY "maintenance_interventions_delete"
  ON public.maintenance_interventions FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('chantiers.edit')
  );

-- Time logs: everyone with chantiers.view may read chantier detail totals, but
-- writes are split between self pointage and team pointage management.
DROP POLICY IF EXISTS "chantier_pointages_member" ON public.chantier_pointages;
DROP POLICY IF EXISTS "chantier_pointages_select" ON public.chantier_pointages;
DROP POLICY IF EXISTS "chantier_pointages_insert" ON public.chantier_pointages;
DROP POLICY IF EXISTS "chantier_pointages_update" ON public.chantier_pointages;
DROP POLICY IF EXISTS "chantier_pointages_delete" ON public.chantier_pointages;

CREATE POLICY "chantier_pointages_select"
  ON public.chantier_pointages FOR SELECT TO authenticated
  USING (
    chantier_id IN (
      SELECT id
      FROM public.chantiers
      WHERE organization_id = public.get_user_org_id()
        AND public.user_has_permission('chantiers.view')
    )
  );

CREATE POLICY "chantier_pointages_insert"
  ON public.chantier_pointages FOR INSERT TO authenticated
  WITH CHECK (
    chantier_id IN (
      SELECT id
      FROM public.chantiers
      WHERE organization_id = public.get_user_org_id()
    )
    AND (
      (
        user_id = auth.uid()
        AND member_id IS NULL
        AND public.user_has_permission('chantiers.pointage')
        AND (
          EXISTS (
            SELECT 1
            FROM public.chantier_taches t
            WHERE t.chantier_id = chantier_pointages.chantier_id
              AND t.assigned_to = auth.uid()
          )
          OR EXISTS (
            SELECT 1
            FROM public.chantier_equipe_membres m
            JOIN public.chantier_individual_members cim ON cim.member_id = m.id
            WHERE m.organization_id = public.get_user_org_id()
              AND m.profile_id = auth.uid()
              AND cim.chantier_id = chantier_pointages.chantier_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.chantier_equipe_membres m
            JOIN public.chantier_equipe_chantiers cec ON cec.equipe_id = m.equipe_id
            WHERE m.organization_id = public.get_user_org_id()
              AND m.profile_id = auth.uid()
              AND cec.chantier_id = chantier_pointages.chantier_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.chantier_equipe_membres m
            JOIN public.chantier_plannings cp
              ON cp.member_id = m.id
              OR (m.equipe_id IS NOT NULL AND cp.equipe_id = m.equipe_id)
            WHERE m.organization_id = public.get_user_org_id()
              AND m.profile_id = auth.uid()
              AND cp.chantier_id = chantier_pointages.chantier_id
          )
          OR EXISTS (
            SELECT 1
            FROM public.chantier_equipe_membres m
            JOIN public.chantier_task_assignments cta
              ON cta.member_id = m.id
              OR (m.equipe_id IS NOT NULL AND cta.equipe_id = m.equipe_id)
            JOIN public.chantier_taches t ON t.id = cta.tache_id
            WHERE m.organization_id = public.get_user_org_id()
              AND m.profile_id = auth.uid()
              AND t.chantier_id = chantier_pointages.chantier_id
          )
        )
      )
      OR public.user_has_permission('chantiers.manage_pointages')
      OR public.user_has_permission('chantiers.edit')
      OR (
        maintenance_intervention_id IS NOT NULL
        AND public.user_has_permission('chantiers.edit')
      )
    )
  );

CREATE POLICY "chantier_pointages_update"
  ON public.chantier_pointages FOR UPDATE TO authenticated
  USING (
    chantier_id IN (
      SELECT id
      FROM public.chantiers
      WHERE organization_id = public.get_user_org_id()
    )
    AND (
      public.user_has_permission('chantiers.manage_pointages')
      OR (
        maintenance_intervention_id IS NOT NULL
        AND public.user_has_permission('chantiers.edit')
      )
    )
  )
  WITH CHECK (
    chantier_id IN (
      SELECT id
      FROM public.chantiers
      WHERE organization_id = public.get_user_org_id()
    )
    AND (
      public.user_has_permission('chantiers.manage_pointages')
      OR (
        maintenance_intervention_id IS NOT NULL
        AND public.user_has_permission('chantiers.edit')
      )
    )
  );

CREATE POLICY "chantier_pointages_delete"
  ON public.chantier_pointages FOR DELETE TO authenticated
  USING (
    chantier_id IN (
      SELECT id
      FROM public.chantiers
      WHERE organization_id = public.get_user_org_id()
    )
    AND (
      public.user_has_permission('chantiers.manage_pointages')
      OR (
        maintenance_intervention_id IS NOT NULL
        AND public.user_has_permission('chantiers.edit')
      )
    )
  );
