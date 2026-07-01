-- ============================================================
-- 150_sarah_action_proposals.sql
--
-- Propositions d'actions persistantes pour Sarah.
-- Sarah peut les créer depuis le chat ou les crons proactifs, puis
-- l'utilisateur les confirme explicitement avant toute action métier.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sarah_action_proposals (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID       NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         UUID       REFERENCES auth.users(id) ON DELETE SET NULL,
  type            TEXT       NOT NULL,
  risk            TEXT       NOT NULL DEFAULT 'low',
  title           TEXT       NOT NULL,
  description     TEXT       NOT NULL,
  payload         JSONB      NOT NULL DEFAULT '{}',
  deep_link       TEXT,
  status          TEXT       NOT NULL DEFAULT 'pending',
  dedupe_key      TEXT,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '7 days'),
  executed_at     TIMESTAMPTZ,
  dismissed_at    TIMESTAMPTZ,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sarah_action_proposals_risk_check
    CHECK (risk IN ('low', 'medium', 'high')),
  CONSTRAINT sarah_action_proposals_status_check
    CHECK (status IN ('pending', 'executed', 'dismissed', 'expired', 'failed')),
  CONSTRAINT sarah_action_proposals_deep_link_check
    CHECK (deep_link IS NULL OR deep_link LIKE '/%')
);

CREATE INDEX IF NOT EXISTS sarah_action_proposals_lookup_idx
  ON public.sarah_action_proposals (organization_id, user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS sarah_action_proposals_pending_idx
  ON public.sarah_action_proposals (organization_id, created_at DESC)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS sarah_action_proposals_dedupe_pending_idx
  ON public.sarah_action_proposals (organization_id, dedupe_key)
  WHERE status = 'pending'
    AND dedupe_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.touch_sarah_action_proposals_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sarah_action_proposals_updated_at ON public.sarah_action_proposals;
CREATE TRIGGER trg_sarah_action_proposals_updated_at
  BEFORE UPDATE ON public.sarah_action_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_sarah_action_proposals_updated_at();

ALTER TABLE public.sarah_action_proposals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sarah_action_proposals_ai_member_select" ON public.sarah_action_proposals;
DROP POLICY IF EXISTS "sarah_action_proposals_ai_member_update" ON public.sarah_action_proposals;
DROP POLICY IF EXISTS "sarah_action_proposals_ai_member_dismiss" ON public.sarah_action_proposals;

CREATE POLICY "sarah_action_proposals_ai_member_select" ON public.sarah_action_proposals
  FOR SELECT TO authenticated
  USING (
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

REVOKE ALL ON public.sarah_action_proposals FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.sarah_action_proposals FROM authenticated;
GRANT SELECT ON public.sarah_action_proposals TO authenticated;
GRANT UPDATE (status, dismissed_at) ON public.sarah_action_proposals TO authenticated;
