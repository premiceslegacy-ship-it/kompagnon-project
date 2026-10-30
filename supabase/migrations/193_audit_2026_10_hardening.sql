-- ============================================================
-- 193 — Durcissement issu de l'audit adversarial du 26/10/2026
-- ------------------------------------------------------------
-- Chaque bloc corrige une faille vérifiée en lecture et reproduite
-- par un test de tests/isolation/hardening.test.ts (rouge avant,
-- vert après). Le client anon Supabase étant distribué au navigateur,
-- toute règle qui n'existe qu'en Server Action est contournable par
-- PostgREST direct : ces gardes sont donc posées en base.
--
-- Sommaire :
--   1. RPC SECURITY DEFINER fermées à anon/authenticated
--   2. memberships : permission + colonnes sensibles gelées
--   3. invitations : rôle appartenant à l'org, jamais owner
--   4. roles : slug 'owner' immuable
--   5. factures : immutabilité réelle après émission
--   6. devis : immutabilité après signature / acceptation
--   7. paiements : écriture gatée par permission
--   8. profiles : email géré par auth.users + unicité
--   9. organizations : colonnes réservées au serveur
--  10. organization_modules / organization_einvoicing_config : claims serveur
--  11. push_subscriptions : org vérifiée + endpoint https
--  12. activity_log : append-only, FK non bloquante, lecture gatée
--  13. quote_requests : plus d'INSERT anonyme direct
--  14. Storage : bucket chantier-photos reproductible et scopé,
--      quote-attachments privé et scopé
-- ============================================================

-- ─── 1. RPC SECURITY DEFINER ────────────────────────────────────────────────
-- 170 avait fermé match_company_memory(uuid,float8[],int,text) mais 191 a
-- ajouté une surcharge à 5 arguments, qui hérite des privilèges par défaut
-- (EXECUTE pour PUBLIC/anon/authenticated) et n'a pas de search_path.
-- L'unique appelant est src/lib/ai/rag.ts via le client service_role.
REVOKE ALL ON FUNCTION public.match_company_memory(uuid, double precision[], integer, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_company_memory(uuid, double precision[], integer, text, text)
  TO service_role;
ALTER FUNCTION public.match_company_memory(uuid, double precision[], integer, text, text)
  SET search_path = public, pg_temp;

DROP FUNCTION IF EXISTS public.match_company_memory(uuid, double precision[], integer, text);

-- initialize_organization_for_user : aucun appel applicatif, seulement le
-- trigger handle_new_user_init. Ouverte, elle permet de créer une org pour
-- n'importe quel uid (second membership actif => .single() casse) et
-- d'écraser profiles.email/full_name de la victime.
REVOKE ALL ON FUNCTION public.initialize_organization_for_user(uuid, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initialize_organization_for_user(uuid, text, text)
  TO service_role;

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, timestamptz)
  TO service_role;

REVOKE ALL ON FUNCTION public.anonymize_organization_for_deletion(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_organization_for_deletion(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

-- search_path oubliés par 157 sur les triggers de numérotation et d'agrégats.
ALTER FUNCTION public.auto_set_invoice_number() SET search_path = public, pg_temp;
ALTER FUNCTION public.auto_set_quote_number() SET search_path = public, pg_temp;
ALTER FUNCTION public.update_client_totals_from_invoice() SET search_path = public, pg_temp;
ALTER FUNCTION public.sync_prestation_type_totals() SET search_path = public, pg_temp;

-- ─── 2. memberships ────────────────────────────────────────────────────────
-- 156 ne gèle que role_id. is_active et labor_cost_per_hour restaient libres :
-- un viewer pouvait désactiver l'owner (get_user_org_id() devient NULL pour
-- lui) ou réécrire un coût horaire interne.
DROP POLICY IF EXISTS memberships_update ON public.memberships;
CREATE POLICY memberships_update ON public.memberships FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('team.manage')
      OR public.user_has_permission('team.remove_members')
      OR public.user_has_permission('team.edit_roles')
    )
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('team.manage')
      OR public.user_has_permission('team.remove_members')
      OR public.user_has_permission('team.edit_roles')
    )
  );

REVOKE UPDATE ON public.memberships FROM authenticated;
GRANT UPDATE (role_id, is_active, labor_cost_per_hour, notes) ON public.memberships TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_membership_sensitive_cols()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_owner  BOOLEAN;
  v_role_ok   BOOLEAN;
BEGIN
  -- Flux serveur (service_role) : les Server Actions ont déjà vérifié leurs
  -- permissions, et joinViaCode / invite/accept déplacent l'org volontairement.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'user_id d''un membership immuable';
  END IF;
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'organization_id d''un membership immuable';
  END IF;

  SELECT (r.slug = 'owner'), (r.organization_id = NEW.organization_id)
    INTO v_is_owner, v_role_ok
  FROM public.roles r WHERE r.id = NEW.role_id;
  IF NOT COALESCE(v_role_ok, false) THEN
    RAISE EXCEPTION 'Le rôle doit appartenir à la même organisation';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NOT (public.user_has_permission('team.remove_members')
            OR public.user_has_permission('team.manage')) THEN
      RAISE EXCEPTION 'team.remove_members requis pour activer/désactiver un membre';
    END IF;
    SELECT (slug = 'owner') INTO v_is_owner FROM public.roles WHERE id = OLD.role_id;
    IF COALESCE(v_is_owner, false) THEN
      RAISE EXCEPTION 'Le membership du dirigeant ne peut pas être désactivé';
    END IF;
  END IF;

  IF NEW.labor_cost_per_hour IS DISTINCT FROM OLD.labor_cost_per_hour
     AND NOT (public.user_has_permission('team.manage')
              OR public.user_has_permission('team.edit_roles')) THEN
    RAISE EXCEPTION 'Coût horaire modifiable uniquement par un administrateur';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_membership_sensitive_cols ON public.memberships;
CREATE TRIGGER trg_enforce_membership_sensitive_cols
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_membership_sensitive_cols();

REVOKE ALL ON FUNCTION public.enforce_membership_sensitive_cols() FROM PUBLIC;

-- ─── 3. invitations ────────────────────────────────────────────────────────
-- Le refus du rôle owner n'existait que dans sendTeamInvite. /invite/accept
-- insère le role_id brut avec le client admin (auth.uid() NULL, donc le
-- trigger 156 ne s'applique pas) : une invitation forgée via PostgREST
-- donnait un second compte owner.
CREATE OR REPLACE FUNCTION public.enforce_invitation_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
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

DROP TRIGGER IF EXISTS trg_enforce_invitation_role ON public.invitations;
CREATE TRIGGER trg_enforce_invitation_role
  BEFORE INSERT OR UPDATE ON public.invitations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_invitation_role();

REVOKE ALL ON FUNCTION public.enforce_invitation_role() FROM PUBLIC;

-- ─── 4. roles : slug owner immuable ────────────────────────────────────────
-- Le code traite roles.slug = 'owner' comme omnipotent et is_system=false
-- seulement pour DELETE. Renommer owner, puis son propre rôle, suffisait à
-- devenir « owner » applicatif.
CREATE OR REPLACE FUNCTION public.protect_system_roles()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.slug = 'owner' OR NEW.slug = 'owner' THEN
    IF NEW.slug IS DISTINCT FROM OLD.slug
       OR NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
      RAISE EXCEPTION 'Le rôle owner est immuable (slug et organisation)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_system_roles ON public.roles;
CREATE TRIGGER trg_protect_system_roles
  BEFORE UPDATE ON public.roles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_system_roles();

UPDATE public.roles SET is_system = true WHERE slug = 'owner' AND is_system IS DISTINCT FROM true;

REVOKE ALL ON FUNCTION public.protect_system_roles() FROM PUBLIC;

-- ─── 5. immutabilité des factures ──────────────────────────────────────────
-- 158 gelait 6 colonnes seulement et laissait `status` libre : un viewer
-- repassait une facture en draft, réécrivait tout, puis la remettait en sent.
-- L'approche par denylist couvre toutes les colonnes présentes et futures :
-- seules les colonnes de cycle de vie restent modifiables.
CREATE OR REPLACE FUNCTION public.enforce_invoice_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
      RAISE EXCEPTION 'Facture émise : le retour en brouillon est interdit';
    END IF;
    IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
      RAISE EXCEPTION 'Facture émise immuable (statut %) : corriger par un avoir', OLD.status;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Les lignes doivent être jugées sur les DEUX factures concernées : un
-- déplacement d'une ligne d'une facture émise vers un brouillon passait.
CREATE OR REPLACE FUNCTION public.enforce_invoice_items_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    SELECT status INTO v_status FROM public.invoices WHERE id = OLD.invoice_id;
    IF v_status IS NOT NULL AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'Lignes immuables : facture source au statut %', v_status;
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO v_status FROM public.invoices WHERE id = NEW.invoice_id;
    IF v_status IS NOT NULL AND v_status <> 'draft' THEN
      RAISE EXCEPTION 'Lignes immuables : facture cible au statut %', v_status;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Suppression : bloquer tout document émis, sauf quand l'organisation
-- elle-même est supprimée (cascade : la ligne parente a déjà disparu).
CREATE OR REPLACE FUNCTION public.block_nondraft_invoice_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.status <> 'draft'
     AND EXISTS (SELECT 1 FROM public.organizations o WHERE o.id = OLD.organization_id) THEN
    RAISE EXCEPTION 'Suppression d''une facture émise interdite (statut %)', OLD.status;
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_nondraft_invoice_delete ON public.invoices;
CREATE TRIGGER trg_block_nondraft_invoice_delete
  BEFORE DELETE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.block_nondraft_invoice_delete();

DROP POLICY IF EXISTS invoices_update ON public.invoices;
CREATE POLICY invoices_update ON public.invoices FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('invoices.edit')
      OR public.user_has_permission('invoices.send')
      OR public.user_has_permission('invoices.record_payment')
      OR public.user_has_permission('invoices.create_credit')
    )
  )
  WITH CHECK (organization_id = public.get_user_org_id());

DROP POLICY IF EXISTS invoices_delete ON public.invoices;
CREATE POLICY invoices_delete ON public.invoices FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.delete')
    AND status = 'draft'
  );

REVOKE ALL ON FUNCTION public.enforce_invoice_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enforce_invoice_items_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_nondraft_invoice_delete() FROM PUBLIC;

-- ─── 6. immutabilité des devis signés / acceptés ───────────────────────────
-- Un devis signé vaut engagement contractuel : le PDF régénéré doit
-- correspondre à ce qui a été signé. Seuls le statut, le lien facture et
-- l'archivage restent modifiables.
CREATE OR REPLACE FUNCTION public.enforce_quote_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mutable TEXT[] := ARRAY[
    'status', 'invoice_id', 'converted_at', 'is_archived', 'updated_at',
    'viewed_at', 'pdf_url', 'signature_token', 'variant_group_id', 'variant_label'
  ];
  v_locked BOOLEAN := OLD.signed_at IS NOT NULL
    OR OLD.status IN ('accepted', 'converted', 'fully_invoiced');
BEGIN
  IF v_locked THEN
    IF NEW.status = 'draft' AND OLD.status <> 'draft' THEN
      RAISE EXCEPTION 'Devis signé/accepté : le retour en brouillon est interdit';
    END IF;
    IF (to_jsonb(NEW) - v_mutable) IS DISTINCT FROM (to_jsonb(OLD) - v_mutable) THEN
      RAISE EXCEPTION 'Devis signé ou accepté immuable : dupliquer le devis pour corriger';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_quote_immutability ON public.quotes;
CREATE TRIGGER trg_enforce_quote_immutability
  BEFORE UPDATE ON public.quotes
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_quote_immutability();

REVOKE ALL ON FUNCTION public.enforce_quote_immutability() FROM PUBLIC;

-- ─── 7. paiements ──────────────────────────────────────────────────────────
-- payments_org_member était FOR ALL : DELETE ouvert à tout membre, y compris
-- sur une facture soldée, sans audit.
DROP POLICY IF EXISTS payments_org_member ON public.payments;
DROP POLICY IF EXISTS payments_select ON public.payments;
CREATE POLICY payments_select ON public.payments FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());
DROP POLICY IF EXISTS payments_insert ON public.payments;
CREATE POLICY payments_insert ON public.payments FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.record_payment')
  );
DROP POLICY IF EXISTS payments_update ON public.payments;
CREATE POLICY payments_update ON public.payments FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.record_payment')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.record_payment')
  );
DROP POLICY IF EXISTS payments_delete ON public.payments;
CREATE POLICY payments_delete ON public.payments FOR DELETE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('invoices.record_payment')
  );

-- ─── 8. profiles : email ───────────────────────────────────────────────────
-- profiles.email écrivable par l'utilisateur, non unique : deux lignes
-- suffisaient à casser forgotPassword (.maybeSingle() => null, « succès »
-- silencieux sans envoi) et à usurper un collègue dans la liste d'équipe.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique ON public.profiles (lower(email));

CREATE OR REPLACE FUNCTION public.protect_profile_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- auth.uid() NULL => service_role ou trigger handle_user_email_change (188).
  IF auth.uid() IS NOT NULL AND NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'profiles.email est piloté par auth.users';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_email ON public.profiles;
CREATE TRIGGER trg_protect_profile_email
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_email();

REVOKE UPDATE ON public.profiles FROM authenticated;
GRANT UPDATE (full_name, avatar_url, phone, job_title, onboarding_done)
  ON public.profiles TO authenticated;

REVOKE ALL ON FUNCTION public.protect_profile_email() FROM PUBLIC;

-- ─── 9. organizations : colonnes réservées au serveur ──────────────────────
-- deletion_*/anonymized_at déclenchaient une anonymisation irréversible, et
-- les compteurs de numérotation légale + join_code étaient réécrivables.
-- Les compteurs légaux sont écrits par generate_invoice_number /
-- generate_quote_number, qui tournent en SECURITY DEFINER sous l'identité de
-- l'appelant : sans ce drapeau, le trigger refuserait leur propre UPDATE.
CREATE OR REPLACE FUNCTION public.generate_invoice_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  IF org_id IS DISTINCT FROM public.get_user_org_id() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Organisation non autorisée';
  END IF;

  PERFORM set_config('app.org_numbering', 'on', true);
  UPDATE public.organizations
  SET last_invoice_number = last_invoice_number + 1
  WHERE id = org_id
  RETURNING last_invoice_number, invoice_prefix INTO next_num, org_prefix;

  PERFORM set_config('app.org_numbering', 'off', true);
  RETURN COALESCE(org_prefix, 'FAC') || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_quote_number(org_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  next_num   INT;
  org_prefix TEXT;
BEGIN
  IF org_id IS DISTINCT FROM public.get_user_org_id() AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'Organisation non autorisée';
  END IF;

  PERFORM set_config('app.org_numbering', 'on', true);
  UPDATE public.organizations
  SET last_quote_number = last_quote_number + 1
  WHERE id = org_id
  RETURNING last_quote_number, quote_prefix INTO next_num, org_prefix;

  PERFORM set_config('app.org_numbering', 'off', true);
  RETURN COALESCE(org_prefix, 'DEV') || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(next_num::TEXT, 3, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.protect_org_server_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.uid() IS NULL OR current_setting('app.org_numbering', true) = 'on' THEN
    RETURN NEW;
  END IF;
  IF (NEW.deletion_requested_at, NEW.deletion_scheduled_at, NEW.anonymized_at,
      NEW.last_invoice_number, NEW.last_quote_number, NEW.join_code,
      NEW.pa_api_key_encrypted, NEW.pa_webhook_secret, NEW.pa_siren_declared,
      NEW.pa_activated_at, NEW.facturx_enabled)
     IS DISTINCT FROM
     (OLD.deletion_requested_at, OLD.deletion_scheduled_at, OLD.anonymized_at,
      OLD.last_invoice_number, OLD.last_quote_number, OLD.join_code,
      OLD.pa_api_key_encrypted, OLD.pa_webhook_secret, OLD.pa_siren_declared,
      OLD.pa_activated_at, OLD.facturx_enabled)
  THEN
    RAISE EXCEPTION 'Colonne d''organisation réservée au serveur';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_org_server_columns ON public.organizations;
CREATE TRIGGER trg_protect_org_server_columns
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_org_server_columns();

REVOKE ALL ON FUNCTION public.protect_org_server_columns() FROM PUBLIC;

-- ─── 10. claims serveur ────────────────────────────────────────────────────
-- organization_modules porteuse de quota_config / overflow_mode /
-- ai_billing_mode : un owner s'octroyait un usage IA et vocal illimité
-- (coût supporté par Orsayn) depuis la console.
REVOKE INSERT, UPDATE ON public.organization_modules FROM authenticated;
GRANT INSERT (organization_id, modules) ON public.organization_modules TO authenticated;
GRANT UPDATE (modules) ON public.organization_modules TO authenticated;

-- organization_einvoicing_config : tous les chemins d'écriture passent déjà
-- par createAdminClient ; un client pouvait forger oauth_status='connected'.
REVOKE INSERT, UPDATE ON public.organization_einvoicing_config FROM authenticated;

-- ─── 11. push_subscriptions ────────────────────────────────────────────────
-- organization_id n'était pas confronté à l'adhésion : un membre de A
-- s'abonnait à l'org B et recevait ses montants et noms de clients en push.
DROP POLICY IF EXISTS "users manage own subscriptions" ON public.push_subscriptions;
DROP POLICY IF EXISTS push_subscriptions_own ON public.push_subscriptions;
CREATE POLICY push_subscriptions_own ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid() AND organization_id = public.get_user_org_id());

ALTER TABLE public.push_subscriptions DROP CONSTRAINT IF EXISTS push_endpoint_https;
ALTER TABLE public.push_subscriptions ADD CONSTRAINT push_endpoint_https
  CHECK (endpoint ~ '^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/');

-- ─── 12. activity_log ──────────────────────────────────────────────────────
-- Le journal d'audit n'était append-only nulle part, la FK bloquait
-- auth.users.deleteUser (donc l'effacement RGPD), et tout membre lisait
-- montants et rôles.
ALTER TABLE public.activity_log DROP CONSTRAINT IF EXISTS activity_log_user_id_fkey;
ALTER TABLE public.activity_log ADD CONSTRAINT activity_log_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.audit_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.action LIKE 'audit.%'
     AND current_setting('app.audit_purge', true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Les entrées audit.* sont append-only';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_append_only ON public.activity_log;
CREATE TRIGGER trg_audit_append_only
  BEFORE UPDATE OR DELETE ON public.activity_log
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_append_only();

DROP POLICY IF EXISTS activity_log_org_member ON public.activity_log;
DROP POLICY IF EXISTS activity_log_select ON public.activity_log;
CREATE POLICY activity_log_select ON public.activity_log FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (action NOT LIKE 'audit.%' OR public.user_has_permission('settings.edit_org'))
  );

REVOKE ALL ON FUNCTION public.audit_append_only() FROM PUBLIC;

-- ─── 13. quote_requests ────────────────────────────────────────────────────
-- INSERT anonyme direct (WITH CHECK true) contournait le honeypot et le
-- rate-limit de submitQuoteRequest ; l'UPDATE sans WITH CHECK laissait
-- rattacher un client ou un devis d'une autre organisation.
DROP POLICY IF EXISTS public_insert_quote_requests ON public.quote_requests;
DROP POLICY IF EXISTS org_members_update_quote_requests ON public.quote_requests;
DROP POLICY IF EXISTS quote_requests_update ON public.quote_requests;
CREATE POLICY quote_requests_update ON public.quote_requests FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('leads.manage')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND public.user_has_permission('leads.manage')
    AND (
      client_id IS NULL
      OR client_id IN (SELECT id FROM public.clients WHERE organization_id = public.get_user_org_id())
    )
    AND (
      quote_id IS NULL
      OR quote_id IN (SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id())
    )
  );

-- ─── 14. Storage ───────────────────────────────────────────────────────────
-- chantier-photos n'existait que par une étape manuelle, avec une policy
-- « auth.role() = authenticated » : lecture/écriture/suppression de tous les
-- buckets de toutes les organisations, y compris les justificatifs de dépenses.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chantier-photos', 'chantier-photos', false, 10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "chantier_photos_read" ON storage.objects;
DROP POLICY IF EXISTS "chantier_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "chantier_photos_delete" ON storage.objects;
DROP POLICY IF EXISTS chantier_photos_rw ON storage.objects;

DROP POLICY IF EXISTS chantier_photos_read ON storage.objects;
CREATE POLICY chantier_photos_read ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'chantier-photos' AND (storage.foldername(name))[1] = public.get_user_org_id()::text);
DROP POLICY IF EXISTS chantier_photos_insert ON storage.objects;
CREATE POLICY chantier_photos_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'chantier-photos' AND (storage.foldername(name))[1] = public.get_user_org_id()::text);
DROP POLICY IF EXISTS chantier_photos_update ON storage.objects;
CREATE POLICY chantier_photos_update ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'chantier-photos' AND (storage.foldername(name))[1] = public.get_user_org_id()::text)
  WITH CHECK (bucket_id = 'chantier-photos' AND (storage.foldername(name))[1] = public.get_user_org_id()::text);
DROP POLICY IF EXISTS chantier_photos_delete ON storage.objects;
CREATE POLICY chantier_photos_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'chantier-photos' AND (storage.foldername(name))[1] = public.get_user_org_id()::text);

-- quote-attachments : bucket public listable par anon => toutes les pièces
-- jointes de tous les demandeurs énumérables. Le chemin est
-- quote-requests/<orgSlug>/..., la portée se vérifie donc sur le dossier 2.
UPDATE storage.buckets
SET public = false,
    allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
WHERE id = 'quote-attachments';

DROP POLICY IF EXISTS "quote_attachments_public_select" ON storage.objects;
DROP POLICY IF EXISTS "quote_attachments_anon_insert" ON storage.objects;
DROP POLICY IF EXISTS "quote_attachments_auth_insert" ON storage.objects;
DROP POLICY IF EXISTS "quote_attachments_auth_delete" ON storage.objects;

DROP POLICY IF EXISTS quote_attachments_anon_insert ON storage.objects;
CREATE POLICY quote_attachments_anon_insert ON storage.objects FOR INSERT TO anon
  WITH CHECK (
    bucket_id = 'quote-attachments'
    AND (storage.foldername(name))[1] = 'quote-requests'
    AND EXISTS (
      SELECT 1 FROM public.organizations o
      WHERE o.slug = (storage.foldername(name))[2]
    )
  );
DROP POLICY IF EXISTS quote_attachments_read ON storage.objects;
CREATE POLICY quote_attachments_read ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'quote-attachments'
    AND (storage.foldername(name))[1] = 'quote-requests'
    AND (
      (storage.foldername(name))[2] = (
        SELECT o.slug FROM public.organizations o WHERE o.id = public.get_user_org_id()
      )
      OR public.user_has_permission('leads.manage')
    )
  );
DROP POLICY IF EXISTS quote_attachments_delete ON storage.objects;
CREATE POLICY quote_attachments_delete ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'quote-attachments'
    AND (storage.foldername(name))[1] = 'quote-requests'
    AND (storage.foldername(name))[2] = (
      SELECT o.slug FROM public.organizations o WHERE o.id = public.get_user_org_id()
    )
  );

-- ─── 15. périmètres restés en FOR ALL sans permission ──────────────────────
-- quote_items / quote_sections : gatés par quotes.edit.
DROP POLICY IF EXISTS quote_items_org_member ON public.quote_items;
DROP POLICY IF EXISTS quote_items_select ON public.quote_items;
CREATE POLICY quote_items_select ON public.quote_items FOR SELECT TO authenticated
  USING (quote_id IN (SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()));
DROP POLICY IF EXISTS quote_items_write ON public.quote_items;
CREATE POLICY quote_items_write ON public.quote_items FOR INSERT TO authenticated
  WITH CHECK (quote_id IN (SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()));
DROP POLICY IF EXISTS quote_items_update ON public.quote_items;
CREATE POLICY quote_items_update ON public.quote_items FOR UPDATE TO authenticated
  USING (quote_id IN (SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()))
  WITH CHECK (quote_id IN (SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()));
DROP POLICY IF EXISTS quote_items_delete ON public.quote_items;
CREATE POLICY quote_items_delete ON public.quote_items FOR DELETE TO authenticated
  USING (quote_id IN (SELECT id FROM public.quotes WHERE organization_id = public.get_user_org_id()));

-- reminders : mutations réservées à ceux qui gèrent les relances.
DROP POLICY IF EXISTS reminders_org_member ON public.reminders;
DROP POLICY IF EXISTS reminders_select ON public.reminders;
CREATE POLICY reminders_select ON public.reminders FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id());
DROP POLICY IF EXISTS reminders_write ON public.reminders;
CREATE POLICY reminders_write ON public.reminders FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('invoices.send')
      OR public.user_has_permission('quotes.send')
      OR public.user_has_permission('settings.edit_org')
    )
  )
  WITH CHECK (
    organization_id = public.get_user_org_id()
    AND (
      public.user_has_permission('invoices.send')
      OR public.user_has_permission('quotes.send')
      OR public.user_has_permission('settings.edit_org')
    )
  );

-- ─── 16. idempotence des occurrences récurrentes ───────────────────────────
-- Le cron `recurring-invoices` faisait « SELECT count puis INSERT » : deux
-- exécutions concurrentes créaient deux factures pour la même échéance.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoice_schedule_occurrence
  ON public.invoice_schedules (recurring_invoice_id, scheduled_date)
  WHERE status IN ('pending_confirmation', 'confirmed', 'sent');

-- Relances automatiques : même classe de faille (double email au client).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_auto_reminder_invoice_rank
  ON public.reminders (invoice_id, rank) WHERE is_auto AND invoice_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_auto_reminder_quote_rank
  ON public.reminders (quote_id, rank) WHERE is_auto AND quote_id IS NOT NULL;

-- ─── 17. réservation de quota atomique ─────────────────────────────────────
-- `checkQuota` lisait la consommation puis `callAI` insérait la ligne APRÈS la
-- réponse du fournisseur : N requêtes lancées dans cette fenêtre passaient
-- toutes. La somme était en plus tronquée par `max_rows` (1000).
--
-- La réservation insère la ligne `status='reserved'` sous verrou consultatif
-- par (org, feature) : la somme inclut donc les appels en vol. L'appelant
-- bascule ensuite la ligne en `success` ou `error`.
CREATE OR REPLACE FUNCTION public.reserve_quota(
  p_org uuid,
  p_feature text,
  p_quantity numeric,
  p_limit numeric,
  p_month_start timestamptz,
  p_provider text,
  p_model text,
  p_input_kind text
)
RETURNS TABLE (allowed boolean, used numeric, reservation_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_used numeric;
  v_id   uuid;
BEGIN
  -- Sérialise les réservations concurrentes de la même paire (org, feature).
  PERFORM pg_advisory_xact_lock(hashtext(p_org::text || ':' || p_feature));

  SELECT COALESCE(SUM(quota_quantity), 0) INTO v_used
  FROM public.usage_logs
  WHERE organization_id = p_org
    AND quota_feature = p_feature
    AND created_at >= p_month_start
    -- `error` compte aussi : une requête peut avoir été traitée par le
    -- fournisseur puis échouer sur la réponse (timeout, coupure), et le coût
    -- est réel. Les refus avant émission suppriment leur réservation.
    AND status IN ('success', 'reserved', 'error');

  IF p_limit >= 0 AND v_used + p_quantity > p_limit THEN
    RETURN QUERY SELECT false, v_used, NULL::uuid;
    RETURN;
  END IF;

  INSERT INTO public.usage_logs (
    organization_id, provider, feature, model, input_kind, status,
    quota_feature, quota_quantity, currency
  ) VALUES (
    p_org, p_provider, p_feature, p_model, p_input_kind, 'reserved',
    p_feature, p_quantity, 'EUR'
  )
  RETURNING id INTO v_id;

  RETURN QUERY SELECT true, v_used + p_quantity, v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reserve_quota(uuid, text, numeric, numeric, timestamptz, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_quota(uuid, text, numeric, numeric, timestamptz, text, text, text)
  TO service_role;

-- ─── 18. anonymisation RGPD réellement complète ────────────────────────────
-- 163 ne couvrait que profils, clients et membres d'équipe. Restaient en clair :
-- contacts de chantier, demandes de devis publiques, corps d'emails de relance,
-- invitations, exports, conversations Sarah, mémoire d'entreprise (texte ET
-- vecteurs RAG), abonnements push, tokens d'espace membre, coordonnées et IBAN
-- de l'organisation, secrets IA et tokens OAuth e-facturation, métadonnées
-- d'audit. `auth.users` n'était jamais touché : l'email réel restait, et un
-- reset de mot de passe fonctionnait encore.
--
-- Les factures restent conservées (obligation fiscale) : on anonymise ce qui
-- les entoure, pas les documents.
CREATE OR REPLACE FUNCTION public.anonymize_organization_for_deletion(p_org_id UUID)
RETURNS TABLE(memberships_deactivated INT, profiles_anonymized INT, clients_anonymized INT, members_anonymized INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_memberships INT := 0;
  v_profiles INT := 0;
  v_clients INT := 0;
  v_members INT := 0;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.organizations
    WHERE id = p_org_id
      AND deletion_scheduled_at IS NOT NULL
      AND deletion_scheduled_at <= now()
      AND anonymized_at IS NULL
  ) THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

  UPDATE public.memberships SET is_active = false
  WHERE organization_id = p_org_id AND is_active = true;
  GET DIAGNOSTICS v_memberships = ROW_COUNT;

  UPDATE public.profiles p SET
    full_name = 'Compte supprimé',
    phone = NULL,
    avatar_url = NULL,
    job_title = NULL,
    email = 'deleted-' || p.id || '@anonymized.invalid'
  WHERE p.id IN (
    SELECT user_id FROM public.memberships WHERE organization_id = p_org_id
  ) AND p.full_name IS DISTINCT FROM 'Compte supprimé';
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  UPDATE public.clients SET
    company_name = CASE WHEN company_name IS NOT NULL THEN 'Client anonymisé' ELSE NULL END,
    first_name = CASE WHEN first_name IS NOT NULL THEN 'Anonyme' ELSE NULL END,
    last_name = NULL,
    email = NULL,
    phone = NULL,
    mobile = NULL,
    address_line1 = NULL,
    address_line2 = NULL,
    notes = NULL,
    contact_name = NULL,
    siret = NULL,
    vat_number = NULL,
    city = NULL,
    postal_code = NULL,
    tags = NULL,
    custom_fields = NULL,
    internal_notes = NULL
  WHERE organization_id = p_org_id
    AND company_name IS DISTINCT FROM 'Client anonymisé';
  GET DIAGNOSTICS v_clients = ROW_COUNT;

  UPDATE public.chantier_equipe_membres m SET
    name = 'Membre anonymisé',
    prenom = NULL,
    email = NULL
  WHERE m.equipe_id IN (
    SELECT id FROM public.chantier_equipes WHERE organization_id = p_org_id
  ) AND m.name IS DISTINCT FROM 'Membre anonymisé';
  GET DIAGNOSTICS v_members = ROW_COUNT;

  -- Contacts de chantier (034) et demandes de devis publiques.
  UPDATE public.chantiers SET
    contact_name = NULL, contact_email = NULL, contact_phone = NULL
  WHERE organization_id = p_org_id;

  -- name/email/description sont NOT NULL sur quote_requests.
  UPDATE public.quote_requests SET
    name = 'Demandeur anonymisé',
    email = 'deleted-' || id || '@anonymized.invalid',
    phone = NULL, company_name = NULL, subject = NULL, attachments = NULL,
    description = 'Demande anonymisée'
  WHERE organization_id = p_org_id;

  -- Corps d'emails de relance, invitations, exports, conversations Sarah.
  UPDATE public.reminders SET email_subject = NULL, email_body = NULL
  WHERE organization_id = p_org_id;
  DELETE FROM public.invitations WHERE organization_id = p_org_id;
  UPDATE public.organization_exports SET requested_by_email = NULL
  WHERE organization_id = p_org_id;
  DELETE FROM public.sarah_conversation_messages WHERE organization_id = p_org_id;

  -- Mémoire d'entreprise : le texte contient clients, prix et IBAN, et les
  -- vecteurs RAG continueraient de les resservir à Sarah.
  DELETE FROM public.company_memory WHERE organization_id = p_org_id;

  -- Canaux de notification et capacités d'accès.
  DELETE FROM public.push_subscriptions WHERE organization_id = p_org_id;
  DELETE FROM public.member_space_tokens
  WHERE member_id IN (
    SELECT m.id FROM public.chantier_equipe_membres m
    JOIN public.chantier_equipes e ON e.id = m.equipe_id
    WHERE e.organization_id = p_org_id
  );

  -- Secrets et identités d'intégration.
  DELETE FROM public.organization_ai_credentials WHERE organization_id = p_org_id;
  UPDATE public.organization_einvoicing_config SET
    super_pdp_connection_id = NULL, oauth_status = 'disconnected', oauth_connected_at = NULL
  WHERE organization_id = p_org_id;

  -- Métadonnées d'audit (noms, montants) : la trace reste, le contenu part.
  -- Les lignes audit.* sont append-only, d'où la levée temporaire du drapeau.
  PERFORM set_config('app.audit_purge', 'on', true);
  UPDATE public.activity_log SET metadata = NULL WHERE organization_id = p_org_id;
  PERFORM set_config('app.audit_purge', 'off', true);

  -- Coordonnées, IBAN et signature de l'organisation elle-même.
  -- organizations.email est NOT NULL : on garde une adresse neutre dérivée.
  UPDATE public.organizations SET
    email = 'deleted-' || p_org_id || '@anonymized.invalid',
    phone = NULL, address_line1 = NULL, address_line2 = NULL,
    city = NULL, postal_code = NULL, bank_iban = NULL, bank_bic = NULL,
    signature_image = NULL, email_signature = NULL, logo_url = NULL,
    anonymized_at = now()
  WHERE id = p_org_id;

  RETURN QUERY SELECT v_memberships, v_profiles, v_clients, v_members;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_organization_for_deletion(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_organization_for_deletion(UUID) TO service_role;
