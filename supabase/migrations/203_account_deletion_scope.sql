-- Scope account-erasure changes to this organization and private identities.
-- Issued fiscal/legal content is preserved; only open recurring drafts are retired.
-- The logo URL is cleared on organizations, so retain the original pointer
-- until external cleanup is complete. Access is restricted to service_role
-- and the RPC owner. Historical anonymized organizations without a manifest
-- have no recoverable original pointer in organizations.logo_url.
CREATE TABLE IF NOT EXISTS public.account_deletion_storage_manifests (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  logo_url TEXT,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.account_deletion_storage_manifests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_deletion_storage_manifests FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.account_deletion_storage_manifests TO service_role;

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
  -- Serialize against quote_requests inserts, whose BEFORE INSERT guard takes
  -- FOR SHARE on this same organization row.
  PERFORM 1 FROM public.organizations WHERE id = p_org_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 0, 0, 0, 0;
    RETURN;
  END IF;

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
  -- Preserve known legacy invoice/quote context before any personal fields are scrubbed.
  PERFORM public.retain_unverified_legal_context(p_org_id);

  -- Stop future recurring generation and retire only open schedules. Sent
  -- schedules and issued invoices remain unchanged.
  UPDATE public.recurring_invoices
  SET is_active = false, cancelled_at = COALESCE(cancelled_at, now())
  WHERE organization_id = p_org_id
    AND (is_active IS DISTINCT FROM false OR cancelled_at IS NULL);
  -- Mirror the existing skip action for drafts attached to open schedules;
  -- issued/non-draft invoices remain untouched.
  UPDATE public.invoices i
  SET status = 'cancelled', is_archived = true
  WHERE i.organization_id = p_org_id
    AND i.status = 'draft'
    AND EXISTS (
      SELECT 1 FROM public.invoice_schedules s
      WHERE s.organization_id = p_org_id
        AND s.invoice_id = i.id
        AND s.status IN ('pending_confirmation', 'confirmed')
    );
  UPDATE public.invoice_schedules
  SET status = 'skipped'
  WHERE organization_id = p_org_id
    AND status IN ('pending_confirmation', 'confirmed');

  INSERT INTO public.account_deletion_storage_manifests (organization_id, logo_url)
  SELECT id, logo_url FROM public.organizations WHERE id = p_org_id
  ON CONFLICT (organization_id) DO NOTHING;


  UPDATE public.memberships SET is_active = false
  WHERE organization_id = p_org_id AND is_active = true;
  GET DIAGNOSTICS v_memberships = ROW_COUNT;
  -- Revoke public quote/contract signature and PDF capabilities only; signed
  -- legal content and snapshots are intentionally preserved.
  UPDATE public.quotes SET signature_token = NULL, signature_token_expires_at = NULL
  WHERE organization_id = p_org_id
    AND (signature_token IS NOT NULL OR signature_token_expires_at IS NOT NULL);
  UPDATE public.contracts SET signature_token = NULL, signature_token_expires_at = NULL
  WHERE organization_id = p_org_id
    AND (signature_token IS NOT NULL OR signature_token_expires_at IS NOT NULL);


  -- Profiles are global to an Auth identity. Preserve them while any active
  -- membership remains in another organization.
  UPDATE public.profiles p SET
    full_name = 'Compte supprimé',
    phone = NULL,
    avatar_url = NULL,
    job_title = NULL,
    email = 'deleted-' || p.id || '@anonymized.invalid'
  WHERE EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.organization_id = p_org_id AND m.user_id = p.id
  )
    AND NOT EXISTS (
      SELECT 1 FROM public.memberships other_membership
      WHERE other_membership.user_id = p.id
        AND other_membership.organization_id <> p_org_id
        AND other_membership.is_active = true
    );
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

  -- Required columns receive neutral values; nullable personal payload is
  -- cleared. catalog_items/attachments are nullable JSONB with no JSON default.
  UPDATE public.quote_requests SET
    name = 'Demandeur anonymisé',
    email = 'deleted-' || id || '@anonymized.invalid',
    phone = NULL,
    company_name = NULL,
    subject = NULL,
    description = 'Demande anonymisée',
    prestation_type = NULL,
    dimensions = NULL,
    attachment_url = NULL,
    chantier_address_line1 = NULL,
    chantier_postal_code = NULL,
    chantier_city = NULL,
    freeform_notes = NULL,
    catalog_items = NULL,
    attachments = NULL,
    type = 'custom'
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
    public_form_enabled = false,
    auto_reminder_enabled = false,
    anonymized_at = now()
  WHERE id = p_org_id;

  RETURN QUERY SELECT v_memberships, v_profiles, v_clients, v_members;
END;
$$;

REVOKE ALL ON FUNCTION public.anonymize_organization_for_deletion(UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.anonymize_organization_for_deletion(UUID) TO service_role;

-- Active memberships serialize with erasure so a service-role invite/join path
-- cannot reactivate access after the organization has been anonymized.
CREATE OR REPLACE FUNCTION public.prevent_membership_in_anonymized_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.is_active IS TRUE THEN
    PERFORM 1 FROM public.organizations
    WHERE id = NEW.organization_id AND anonymized_at IS NULL
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cannot activate membership in an unavailable organization'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.prevent_membership_in_anonymized_organization()
  FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_prevent_membership_in_anonymized_organization ON public.memberships;
CREATE TRIGGER trg_prevent_membership_in_anonymized_organization
  BEFORE INSERT OR UPDATE OF organization_id, is_active ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_membership_in_anonymized_organization();

-- Authenticated logo writes require both a surviving profile and at least one
-- active organization membership; stale JWTs cannot repopulate erased folders.
DROP POLICY IF EXISTS "logos_auth_insert" ON storage.objects;
CREATE POLICY "logos_auth_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.get_user_org_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
  );

DROP POLICY IF EXISTS "logos_auth_update" ON storage.objects;
CREATE POLICY "logos_auth_update" ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.get_user_org_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
  )
  WITH CHECK (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.get_user_org_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
  );

DROP POLICY IF EXISTS "logos_auth_delete" ON storage.objects;
CREATE POLICY "logos_auth_delete" ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'logos'
    AND (storage.foldername(name))[1] = auth.uid()::text
    AND public.get_user_org_id() IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid())
  );

CREATE OR REPLACE FUNCTION public.block_quote_request_for_anonymized_organization()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public.organizations
  WHERE id = NEW.organization_id AND anonymized_at IS NULL
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Organization is unavailable for quote requests'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.block_quote_request_for_anonymized_organization() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_block_quote_request_for_anonymized_organization ON public.quote_requests;
CREATE TRIGGER trg_block_quote_request_for_anonymized_organization
  BEFORE INSERT ON public.quote_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.block_quote_request_for_anonymized_organization();
NOTIFY pgrst, 'reload schema';
