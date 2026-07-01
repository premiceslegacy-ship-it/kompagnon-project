-- ============================================================
-- 141_ai_sarah_hardening.sql
--
-- Durcissement Sarah / assistants IA :
-- - RLS ai_briefs limitée aux membres ayant ai.sarah
-- - TTL explicite sur ai_briefs
-- - contraintes de statuts/assistants
-- - maximum 2 membres actifs avec ai.sarah par organisation
-- - unicité du daily brief par org/date
-- - indexes trigram pour search_client
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "pg_trgm" WITH SCHEMA extensions;
SET search_path = public, extensions;

-- ----------------------------------------------------------
-- ai_briefs : TTL, contraintes, indexes
-- ----------------------------------------------------------
ALTER TABLE public.ai_briefs
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

UPDATE public.ai_briefs
SET expires_at = created_at + INTERVAL '7 days'
WHERE expires_at IS NULL;

ALTER TABLE public.ai_briefs
  ALTER COLUMN expires_at SET DEFAULT (now() + INTERVAL '7 days'),
  ALTER COLUMN expires_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_briefs_assistants_check'
  ) THEN
    ALTER TABLE public.ai_briefs
      ADD CONSTRAINT ai_briefs_assistants_check
      CHECK (
        source_assistant IN ('sarah', 'chloe', 'marco', 'nora', 'lea')
        AND target_assistant IN ('sarah', 'chloe', 'marco', 'nora', 'lea')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ai_briefs_status_check'
  ) THEN
    ALTER TABLE public.ai_briefs
      ADD CONSTRAINT ai_briefs_status_check
      CHECK (status IN ('pending', 'consumed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_briefs_pending_lookup_idx
  ON public.ai_briefs (organization_id, target_assistant, created_at DESC)
  WHERE status = 'pending';

-- ----------------------------------------------------------
-- ai_briefs : RLS restreinte à ai.sarah
-- ----------------------------------------------------------
DROP POLICY IF EXISTS "ai_briefs_org_member" ON public.ai_briefs;
DROP POLICY IF EXISTS "ai_briefs_ai_member" ON public.ai_briefs;

CREATE POLICY "ai_briefs_ai_member" ON public.ai_briefs
  FOR ALL TO authenticated
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
        AND m.organization_id = ai_briefs.organization_id
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.memberships m
      JOIN public.role_permissions rp
        ON rp.role_id = m.role_id
       AND rp.permission_key = 'ai.sarah'
       AND rp.is_allowed = true
      WHERE m.user_id = auth.uid()
        AND m.is_active = true
        AND m.organization_id = ai_briefs.organization_id
    )
  );

REVOKE ALL ON public.ai_briefs FROM anon;

-- ----------------------------------------------------------
-- ai.sarah : max 2 membres actifs par organisation
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_ai_sarah_member_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  org_id UUID;
  org_ids UUID[];
  ai_count INTEGER;
  permission_key TEXT;
BEGIN
  IF TG_TABLE_NAME = 'role_permissions' THEN
    permission_key := CASE
      WHEN TG_OP = 'DELETE' THEN OLD.permission_key
      ELSE NEW.permission_key
    END;

    IF permission_key <> 'ai.sarah' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;

    IF TG_OP = 'INSERT' THEN
      SELECT ARRAY_AGG(DISTINCT r.organization_id)
      INTO org_ids
      FROM public.roles r
      WHERE r.id = NEW.role_id;
    ELSIF TG_OP = 'UPDATE' THEN
      SELECT ARRAY_AGG(DISTINCT r.organization_id)
      INTO org_ids
      FROM public.roles r
      WHERE r.id IN (NEW.role_id, OLD.role_id);
    ELSE
      SELECT ARRAY_AGG(DISTINCT r.organization_id)
      INTO org_ids
      FROM public.roles r
      WHERE r.id = OLD.role_id;
    END IF;
  ELSE
    org_ids := ARRAY[
      CASE
        WHEN TG_OP = 'DELETE' THEN OLD.organization_id
        ELSE NEW.organization_id
      END
    ];
  END IF;

  FOREACH org_id IN ARRAY COALESCE(org_ids, ARRAY[]::UUID[]) LOOP
    SELECT COUNT(*)
    INTO ai_count
    FROM public.memberships m
    JOIN public.role_permissions rp
      ON rp.role_id = m.role_id
     AND rp.permission_key = 'ai.sarah'
     AND rp.is_allowed = true
    WHERE m.organization_id = org_id
      AND m.is_active = true;

    IF ai_count > 2 THEN
      RAISE EXCEPTION 'ai.sarah can be granted to at most 2 active members per organization'
        USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ai_sarah_limit_role_permissions ON public.role_permissions;
CREATE TRIGGER trg_ai_sarah_limit_role_permissions
  AFTER INSERT OR UPDATE ON public.role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ai_sarah_member_limit();

DROP TRIGGER IF EXISTS trg_ai_sarah_limit_memberships ON public.memberships;
CREATE TRIGGER trg_ai_sarah_limit_memberships
  AFTER INSERT OR UPDATE OF organization_id, role_id, is_active ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ai_sarah_member_limit();

-- ----------------------------------------------------------
-- Daily brief : un seul brief actif par org/date
-- ----------------------------------------------------------
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY organization_id, metadata->>'date'
      ORDER BY created_at DESC
    ) AS rn
  FROM public.company_memory
  WHERE type = 'daily_brief'
    AND is_active = true
    AND metadata->>'date' IS NOT NULL
)
UPDATE public.company_memory cm
SET is_active = false
FROM ranked r
WHERE cm.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS company_memory_daily_brief_unique_idx
  ON public.company_memory (organization_id, (metadata->>'date'))
  WHERE type = 'daily_brief'
    AND is_active = true
    AND metadata->>'date' IS NOT NULL;

CREATE INDEX IF NOT EXISTS company_memory_daily_brief_lookup_idx
  ON public.company_memory (organization_id, (metadata->>'date'))
  WHERE type = 'daily_brief'
    AND is_active = true;

CREATE INDEX IF NOT EXISTS company_memory_sarah_conversation_idx
  ON public.company_memory (organization_id, (metadata->>'sarah_conversation_id'))
  WHERE type = 'sarah_memory'
    AND is_active = true
    AND metadata->>'sarah_conversation_id' IS NOT NULL;

-- ----------------------------------------------------------
-- Clients : accélérer search_client sur ILIKE "%query%"
-- ----------------------------------------------------------
CREATE INDEX IF NOT EXISTS clients_company_name_trgm_idx
  ON public.clients USING GIN (company_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS clients_contact_name_trgm_idx
  ON public.clients USING GIN (contact_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS clients_email_trgm_idx
  ON public.clients USING GIN (email gin_trgm_ops);

CREATE INDEX IF NOT EXISTS clients_first_name_trgm_idx
  ON public.clients USING GIN (first_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS clients_last_name_trgm_idx
  ON public.clients USING GIN (last_name gin_trgm_ops);
