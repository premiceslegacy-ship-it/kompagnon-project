-- ============================================================
-- 151_sarah_action_proposals_harden_update_policy.sql
--
-- Les propositions Sarah sont exécutées côté serveur. Le client
-- authenticated peut seulement masquer une proposition pending.
-- ============================================================

DROP POLICY IF EXISTS "sarah_action_proposals_ai_member_update" ON public.sarah_action_proposals;
DROP POLICY IF EXISTS "sarah_action_proposals_ai_member_dismiss" ON public.sarah_action_proposals;

CREATE POLICY "sarah_action_proposals_ai_member_dismiss" ON public.sarah_action_proposals
  FOR UPDATE TO authenticated
  USING (
    status = 'pending'
    AND expires_at > now()
    AND
    EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.role_permissions rp
        ON rp.role_id = m.role_id
       AND rp.permission_key = 'ai.sarah'
       AND rp.is_allowed = true
      WHERE m.user_id = auth.uid()
        AND m.is_active = true
        AND m.organization_id = sarah_action_proposals.organization_id
    )
    AND (user_id IS NULL OR user_id = auth.uid())
  )
  WITH CHECK (
    status = 'dismissed'
    AND dismissed_at IS NOT NULL
    AND executed_at IS NULL
    AND error IS NULL
    AND
    EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.role_permissions rp
        ON rp.role_id = m.role_id
       AND rp.permission_key = 'ai.sarah'
       AND rp.is_allowed = true
      WHERE m.user_id = auth.uid()
        AND m.is_active = true
        AND m.organization_id = sarah_action_proposals.organization_id
    )
    AND (user_id IS NULL OR user_id = auth.uid())
  );

REVOKE INSERT, UPDATE, DELETE ON public.sarah_action_proposals FROM authenticated;
GRANT SELECT ON public.sarah_action_proposals TO authenticated;
GRANT UPDATE (status, dismissed_at) ON public.sarah_action_proposals TO authenticated;
