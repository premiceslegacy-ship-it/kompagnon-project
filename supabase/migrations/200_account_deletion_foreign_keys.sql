-- Account deletion reaches auth.users directly; auth.users CASCADE-deletes the
-- matching profile. Retained application rows must not block either deletion.
-- Preserve those rows and clear only their identity reference.
--
-- Invitations and chantier notes retain useful records after the inviter/author
-- erases their account, so their erased-identity columns become nullable instead
-- of deleting the retained rows.
ALTER TABLE public.invitations
  ALTER COLUMN invited_by DROP NOT NULL;

COMMENT ON COLUMN public.invitations.invited_by IS
  'Inviting user when known; NULL after that account is erased. Invitation records are retained.';

ALTER TABLE public.chantier_notes
  ALTER COLUMN author_id DROP NOT NULL;

COMMENT ON COLUMN public.chantier_notes.author_id IS
  'Author profile when known; NULL after that account is erased. Note content is retained.';

-- Retained issued invoices have the same author FK. Preserve the fiscal freeze
-- while permitting only privileged removal of the erased author's reference.
CREATE OR REPLACE FUNCTION public.enforce_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mutable TEXT[] := ARRAY[
    'status', 'total_paid', 'paid_at', 'sent_at', 'viewed_at', 'pdf_url',
    'pa_message_id', 'pa_status', 'pa_status_updated_at', 'pa_rejection_reason',
    'is_archived', 'updated_at', 'balance_due_date', 'facturx_xml'
  ];
BEGIN
  IF OLD.status <> 'draft' THEN
    IF NEW.status = 'draft' THEN
      IF OLD.status = 'sending' AND auth.role() = 'service_role' THEN
        RETURN NEW;
      END IF;
      RAISE EXCEPTION 'Facture émise : le retour en brouillon est interdit';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by
       AND NOT (
         OLD.created_by IS NOT NULL
         AND NEW.created_by IS NULL
         AND session_user IN ('postgres', 'supabase_auth_admin')
       ) THEN
      RAISE EXCEPTION 'created_by ne peut être effacé que par la suppression Auth de son auteur';
    END IF;
    IF (to_jsonb(NEW) - v_mutable - 'created_by')
       IS DISTINCT FROM (to_jsonb(OLD) - v_mutable - 'created_by') THEN
      RAISE EXCEPTION 'Facture émise immuable (statut %) : corriger par un avoir', OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invoice_immutability() FROM PUBLIC, anon, authenticated;

-- Work/photo records still require an identifiable author at creation. An
-- erased-author marker admits only a retained row whose Auth/profile FK was
-- cleared by the privileged deletion connection, not anonymous new records.
ALTER TABLE public.chantier_pointages
  ADD COLUMN IF NOT EXISTS author_erased_at TIMESTAMPTZ;
ALTER TABLE public.chantier_photos
  ADD COLUMN IF NOT EXISTS author_erased_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.mark_erased_auth_reference()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_erased_at IS NOT NULL THEN
      RAISE EXCEPTION 'Une nouvelle écriture doit identifier son auteur' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.author_erased_at IS DISTINCT FROM OLD.author_erased_at THEN
    RAISE EXCEPTION 'La preuve d''effacement de l''auteur est réservée au serveur Auth' USING ERRCODE = '42501';
  END IF;
  IF session_user IN ('postgres', 'supabase_auth_admin')
     AND to_jsonb(OLD) ->> TG_ARGV[0] IS NOT NULL
     AND to_jsonb(NEW) ->> TG_ARGV[0] IS NULL
     AND (to_jsonb(NEW) - TG_ARGV[0] - 'updated_at')
         IS NOT DISTINCT FROM (to_jsonb(OLD) - TG_ARGV[0] - 'updated_at') THEN
    NEW.author_erased_at := now();
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_erased_auth_reference() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mark_erased_auth_reference ON public.chantier_pointages;
CREATE TRIGGER trg_mark_erased_auth_reference
  BEFORE INSERT OR UPDATE ON public.chantier_pointages
  FOR EACH ROW EXECUTE FUNCTION public.mark_erased_auth_reference('user_id');
DROP TRIGGER IF EXISTS trg_mark_erased_auth_reference ON public.chantier_photos;
CREATE TRIGGER trg_mark_erased_auth_reference
  BEFORE INSERT OR UPDATE ON public.chantier_photos
  FOR EACH ROW EXECUTE FUNCTION public.mark_erased_auth_reference('uploaded_by');

ALTER TABLE public.chantier_pointages DROP CONSTRAINT IF EXISTS chantier_pointages_who;
ALTER TABLE public.chantier_pointages ADD CONSTRAINT chantier_pointages_who CHECK (
  user_id IS NOT NULL OR member_id IS NOT NULL
  OR maintenance_intervention_id IS NOT NULL OR author_erased_at IS NOT NULL
);
ALTER TABLE public.chantier_photos DROP CONSTRAINT IF EXISTS chantier_photos_who;
ALTER TABLE public.chantier_photos ADD CONSTRAINT chantier_photos_who CHECK (
  uploaded_by IS NOT NULL OR member_id IS NOT NULL OR author_erased_at IS NOT NULL
);

-- Erasing the actor must not erase or rewrite the append-only audit event.
CREATE OR REPLACE FUNCTION public.audit_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.user_id IS NOT NULL
       AND NEW.user_id IS NULL
       AND session_user IN ('postgres', 'supabase_auth_admin')
       AND (to_jsonb(NEW) - 'user_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'user_id') THEN
      RETURN NEW;
    END IF;
  END IF;
  IF OLD.action LIKE 'audit.%'
     AND current_setting('app.audit_purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Les entrées audit.* sont append-only';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.audit_append_only() FROM PUBLIC, anon, authenticated;

-- The FK action is an UPDATE. Keep signed quote immutability intact and allow
-- only clearing created_by from a privileged Auth deletion connection; ordinary
-- callers still cannot alter authorship or any signed content.
CREATE OR REPLACE FUNCTION public.enforce_quote_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_mutable TEXT[] := ARRAY[
    'status', 'invoice_id', 'converted_at', 'is_archived', 'updated_at',
    'viewed_at', 'pdf_url', 'signature_token', 'signature_token_expires_at',
    'variant_group_id', 'variant_label'
  ];
  v_locked BOOLEAN := OLD.signed_at IS NOT NULL
    OR OLD.status IN ('accepted', 'converted', 'fully_invoiced');
BEGIN
  IF v_locked THEN
    IF (NEW.signature_token IS DISTINCT FROM OLD.signature_token
        OR NEW.signature_token_expires_at IS DISTINCT FROM OLD.signature_token_expires_at)
       AND NOT COALESCE(auth.role() = 'service_role', false) THEN
      RAISE EXCEPTION 'Les jetons de signature sont réservés au serveur après acceptation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NOT COALESCE(NEW.status IN ('accepted', 'converted', 'fully_invoiced'), false) THEN
      RAISE EXCEPTION 'Devis signé ou accepté : le retour à un statut déverrouillant est interdit';
    END IF;
    IF NEW.created_by IS DISTINCT FROM OLD.created_by
       AND NOT (
         OLD.created_by IS NOT NULL
         AND NEW.created_by IS NULL
         AND session_user IN ('postgres', 'supabase_auth_admin')
       ) THEN
      RAISE EXCEPTION 'created_by ne peut être effacé que par la suppression Auth de son auteur';
    END IF;
    IF (to_jsonb(NEW) - v_mutable - 'created_by')
       IS DISTINCT FROM (to_jsonb(OLD) - v_mutable - 'created_by') THEN
      RAISE EXCEPTION 'Devis signé ou accepté immuable : dupliquer le devis pour corriger';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_quote_immutability() FROM PUBLIC, anon, authenticated;

-- An inviter FK action must not be rejected by the role-validation trigger or
-- normalize recipient data as a side effect. This exception is limited to the
-- exact invited_by -> NULL update from the Auth service/DB owner.
CREATE OR REPLACE FUNCTION public.enforce_invitation_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.invited_by IS NOT NULL
     AND NEW.invited_by IS NULL
     AND session_user IN ('postgres', 'supabase_auth_admin')
     AND (to_jsonb(NEW) - 'invited_by') IS NOT DISTINCT FROM
         (to_jsonb(OLD) - 'invited_by')
  THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.roles r
    WHERE r.id = NEW.role_id
      AND r.organization_id = NEW.organization_id
      AND r.slug <> 'owner'
  ) THEN
    RAISE EXCEPTION 'Rôle d''invitation invalide (même organisation, hors owner)';
  END IF;
  NEW.email := lower(btrim(NEW.email));
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_invitation_role() FROM PUBLIC, anon, authenticated;

-- This quota trigger only needs to observe permission/role changes. A metadata
-- FK nullification must not be able to fail because an organization is already
-- above its configured AI-member limit.
DROP TRIGGER IF EXISTS trg_ai_sarah_limit_role_permissions ON public.role_permissions;
CREATE TRIGGER trg_ai_sarah_limit_role_permissions
  AFTER INSERT OR UPDATE OF role_id, permission_key, is_allowed
  ON public.role_permissions
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_ai_sarah_member_limit();


-- Convert every current NO ACTION FK from public tables to auth.users/profiles
-- into SET NULL. This is intentionally metadata-scoped: it grants no bypass,
-- deletes no business rows, and leaves existing CASCADE/SET NULL actions intact.
DO $migration$
DECLARE
  v_fk RECORD;
  v_child_columns TEXT;
  v_parent_columns TEXT;
  v_child_relation TEXT;
  v_parent_relation TEXT;
  v_match_clause TEXT;
  v_update_action TEXT;
  v_deferrable_clause TEXT;
  v_has_required_column BOOLEAN;
BEGIN
  FOR v_fk IN
    SELECT
      c.oid,
      c.conrelid,
      c.conname,
      c.confrelid,
      c.conkey,
      c.confkey,
      c.confmatchtype,
      c.confupdtype,
      c.condeferrable,
      c.condeferred
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_namespace AS child_schema
      ON child_schema.oid = (SELECT relnamespace FROM pg_catalog.pg_class WHERE oid = c.conrelid)
    WHERE c.contype = 'f'
      AND child_schema.nspname = 'public'
      AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
      AND c.confdeltype = 'a'
    ORDER BY c.conrelid, c.conname
  LOOP
    SELECT
      string_agg(format('%I', a.attname), ', ' ORDER BY k.ordinality),
      bool_or(a.attnotnull)
    INTO v_child_columns, v_has_required_column
    FROM unnest(v_fk.conkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = v_fk.conrelid
     AND a.attnum = k.attnum
     AND NOT a.attisdropped;

    IF v_has_required_column THEN
      RAISE EXCEPTION 'Cannot make %.% nullable for account erasure',
        v_fk.conrelid::regclass, v_fk.conname;
    END IF;

    SELECT string_agg(format('%I', a.attname), ', ' ORDER BY k.ordinality)
    INTO v_parent_columns
    FROM unnest(v_fk.confkey) WITH ORDINALITY AS k(attnum, ordinality)
    JOIN pg_catalog.pg_attribute AS a
      ON a.attrelid = v_fk.confrelid
     AND a.attnum = k.attnum
     AND NOT a.attisdropped;

    SELECT format('%I.%I', n.nspname, t.relname)
    INTO v_child_relation
    FROM pg_catalog.pg_class AS t
    JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
    WHERE t.oid = v_fk.conrelid;

    SELECT format('%I.%I', n.nspname, t.relname)
    INTO v_parent_relation
    FROM pg_catalog.pg_class AS t
    JOIN pg_catalog.pg_namespace AS n ON n.oid = t.relnamespace
    WHERE t.oid = v_fk.confrelid;

    v_match_clause := CASE v_fk.confmatchtype
      WHEN 'f' THEN ' MATCH FULL'
      WHEN 'p' THEN ' MATCH PARTIAL'
      ELSE ''
    END;
    v_update_action := CASE v_fk.confupdtype
      WHEN 'r' THEN 'RESTRICT'
      WHEN 'c' THEN 'CASCADE'
      WHEN 'n' THEN 'SET NULL'
      WHEN 'd' THEN 'SET DEFAULT'
      ELSE 'NO ACTION'
    END;
    v_deferrable_clause := CASE
      WHEN v_fk.condeferrable AND v_fk.condeferred THEN ' DEFERRABLE INITIALLY DEFERRED'
      WHEN v_fk.condeferrable THEN ' DEFERRABLE INITIALLY IMMEDIATE'
      ELSE ' NOT DEFERRABLE'
    END;

    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', v_child_relation, v_fk.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES %s (%s)%s ON DELETE SET NULL ON UPDATE %s%s',
      v_child_relation,
      v_fk.conname,
      v_child_columns,
      v_parent_relation,
      v_parent_columns,
      v_match_clause,
      v_update_action,
      v_deferrable_clause
    );
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS c
    JOIN pg_catalog.pg_namespace AS child_schema
      ON child_schema.oid = (SELECT relnamespace FROM pg_catalog.pg_class WHERE oid = c.conrelid)
    WHERE c.contype = 'f'
      AND child_schema.nspname = 'public'
      AND c.confrelid IN ('auth.users'::regclass, 'public.profiles'::regclass)
      AND c.confdeltype IN ('a', 'r')
  ) THEN
    RAISE EXCEPTION 'Blocking NO ACTION/RESTRICT account foreign key remains';
  END IF;
END;
$migration$;
