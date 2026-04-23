-- ============================================================
-- 053_organization_exports.sql
-- Exports d'organisation pour offboarding / reversibilite
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_exports (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  requested_by_user_id  UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_email    TEXT        NOT NULL,
  status                TEXT        NOT NULL DEFAULT 'processing',
  bundle_path           TEXT,
  bundle_size_bytes     BIGINT,
  summary_json          JSONB       NOT NULL DEFAULT '{}'::jsonb,
  error_message         TEXT,
  completed_at          TIMESTAMPTZ,
  expires_at            TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT organization_exports_status_check
    CHECK (status IN ('processing', 'ready', 'failed', 'expired'))
);

COMMENT ON TABLE public.organization_exports IS
  'Journal des exports de reversibilite generes pour une organisation.';
COMMENT ON COLUMN public.organization_exports.summary_json IS
  'Resume du bundle exporte : compteurs, avertissements et metadonnees.';

CREATE INDEX IF NOT EXISTS idx_organization_exports_org_created
  ON public.organization_exports(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_organization_exports_status
  ON public.organization_exports(status, created_at DESC);

SELECT create_updated_at_trigger('organization_exports');

ALTER TABLE public.organization_exports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organization_exports_select"
  ON public.organization_exports FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'organization-exports'
  ) THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES (
      'organization-exports',
      'organization-exports',
      false,
      524288000,
      ARRAY['application/zip']
    );
  END IF;
END $$;
